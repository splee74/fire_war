// 주인공 3D 모델(GLB)을 게임에 넣는 도구
//
// 사용법: node tools/make-hero.js <모델.glb> [남길 애니메이션 이름 ...]
//   예) node tools/make-hero.js Knight.glb Idle Running_A 2H_Melee_Attack_Slice Death_A Cheer
//
// 1. 남길 애니메이션만 고르고 쓰이지 않는 데이터를 지워 파일을 줄인다
//    (애니메이션 이름을 안 주면 모두 남긴다. 이름 목록만 보려면 --list)
// 2. 결과를 models/hero.js 에 base64로 담는다.
//    브라우저는 file://로 연 페이지에서 .glb 파일을 직접 읽지 못하게 막지만,
//    <script>로 불러온 JS 안의 데이터는 읽을 수 있어서 어디서 열어도 동작한다.
const fs = require('fs');
const path = require('path');

const [, , input, ...keep] = process.argv;
if (!input) {
  console.log('사용법: node tools/make-hero.js <모델.glb> [남길 애니메이션 이름 ...] | --list');
  process.exit(1);
}

// ---------- GLB 읽기 ----------
const glb = fs.readFileSync(input);
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error('GLB 파일이 아니에요');
let offset = 12, json = null, bin = null;
while (offset < glb.length) {
  const len = glb.readUInt32LE(offset), type = glb.readUInt32LE(offset + 4);
  const data = glb.subarray(offset + 8, offset + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
  else if (type === 0x004e4942) bin = data;
  offset += 8 + len;
}
const anims = json.animations || [];
if (keep[0] === '--list') {
  console.log(anims.map(a => a.name).join('\n'));
  process.exit(0);
}

// ---------- 애니메이션 고르기 ----------
if (keep.length) {
  const missing = keep.filter(n => !anims.some(a => a.name === n));
  if (missing.length) throw new Error('모델에 없는 애니메이션: ' + missing.join(', '));
  json.animations = anims.filter(a => keep.includes(a.name));
}

// ---------- 쓰이는 데이터만 남기고 다시 묶기 ----------
const usedAcc = new Set();
for (const m of json.meshes || []) {
  for (const p of m.primitives) {
    Object.values(p.attributes).forEach(i => usedAcc.add(i));
    if (p.indices !== undefined) usedAcc.add(p.indices);
    for (const t of p.targets || []) Object.values(t).forEach(i => usedAcc.add(i));
  }
}
for (const s of json.skins || []) if (s.inverseBindMatrices !== undefined) usedAcc.add(s.inverseBindMatrices);
for (const a of json.animations || []) for (const s of a.samplers) { usedAcc.add(s.input); usedAcc.add(s.output); }

const usedView = new Set();
for (const i of usedAcc) {
  const a = json.accessors[i];
  if (a.bufferView !== undefined) usedView.add(a.bufferView);
  if (a.sparse) { usedView.add(a.sparse.indices.bufferView); usedView.add(a.sparse.values.bufferView); }
}
for (const im of json.images || []) if (im.bufferView !== undefined) usedView.add(im.bufferView);

const viewMap = new Map(), newViews = [], chunks = [];
let binLen = 0;
[...usedView].sort((a, b) => a - b).forEach(i => {
  const v = { ...json.bufferViews[i] };
  const data = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
  const pad = (4 - (binLen % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); binLen += pad; }
  v.byteOffset = binLen;
  v.buffer = 0;
  chunks.push(data);
  binLen += data.length;
  viewMap.set(i, newViews.length);
  newViews.push(v);
});
const accMap = new Map(), newAcc = [];
[...usedAcc].sort((a, b) => a - b).forEach(i => {
  const a = { ...json.accessors[i] };
  if (a.bufferView !== undefined) a.bufferView = viewMap.get(a.bufferView);
  if (a.sparse) {
    a.sparse = JSON.parse(JSON.stringify(a.sparse));
    a.sparse.indices.bufferView = viewMap.get(a.sparse.indices.bufferView);
    a.sparse.values.bufferView = viewMap.get(a.sparse.values.bufferView);
  }
  accMap.set(i, newAcc.length);
  newAcc.push(a);
});
for (const m of json.meshes || []) {
  for (const p of m.primitives) {
    for (const k in p.attributes) p.attributes[k] = accMap.get(p.attributes[k]);
    if (p.indices !== undefined) p.indices = accMap.get(p.indices);
    for (const t of p.targets || []) for (const k in t) t[k] = accMap.get(t[k]);
  }
}
for (const s of json.skins || []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = accMap.get(s.inverseBindMatrices);
for (const a of json.animations || []) for (const s of a.samplers) { s.input = accMap.get(s.input); s.output = accMap.get(s.output); }
for (const im of json.images || []) if (im.bufferView !== undefined) im.bufferView = viewMap.get(im.bufferView);
json.accessors = newAcc;
json.bufferViews = newViews;
json.buffers = [{ byteLength: binLen }];

// ---------- GLB 쓰기 ----------
let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
let binBuf = Buffer.concat(chunks);
binBuf = Buffer.concat([binBuf, Buffer.alloc((4 - (binBuf.length % 4)) % 4)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
const chunkHead = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
const outGlb = Buffer.concat([header, chunkHead(jsonBuf.length, 0x4e4f534a), jsonBuf, chunkHead(binBuf.length, 0x004e4942), binBuf]);

const outDir = path.join(__dirname, '..', 'models');
fs.mkdirSync(outDir, { recursive: true });
const outJs = path.join(outDir, 'hero.js');
fs.writeFileSync(outJs,
  `// 주인공 3D 모델 (tools/make-hero.js로 ${path.basename(input)}에서 생성)\n` +
  `window.HERO_MODEL = '${outGlb.toString('base64')}';\n`);
console.log(`원본 ${(glb.length / 1024).toFixed(0)}KB → GLB ${(outGlb.length / 1024).toFixed(0)}KB → ${outJs} ${(fs.statSync(outJs).size / 1024).toFixed(0)}KB`);
console.log('애니메이션:', (json.animations || []).map(a => a.name).join(', '));
