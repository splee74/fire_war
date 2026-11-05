// ===================== 3D 렌더러 (Three.js 쿼터뷰) =====================
// 게임 로직은 그대로 두고, 게임 상태 G를 받아 3D로 그리기만 한다.
// 2D 좌표 (x, y) → 3D 바닥 (x, 0, y). 정사영 카메라라서 가로 1단위 = 화면 1px.
// 모델은 외부 파일 없이 기본 도형을 이어 붙인 로우폴리로 만든다.
// (file://로 열면 브라우저가 그림 파일을 WebGL 텍스처로 쓰지 못하게 막으므로, 텍스처도 코드로 그린다)
const Render3D = (() => {
  if (typeof THREE === 'undefined') return { ok: false };

  const ELEV = 55 * Math.PI / 180; // 카메라가 바닥을 내려다보는 각도
  const TILE = 640;                // 바닥 무늬 한 장의 크기
  const STAIN = 1700;              // 넓은 얼룩 무늬 한 장의 크기
  const CAP = 450;                 // 종류별 최대 개수

  let renderer, scene, camera, W = 1, H = 1;
  let frame = 0;
  const target = new THREE.Vector3();

  // ---------- 도형 조립 도구 ----------
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
  // 기본 도형 하나를 원하는 위치·회전·크기·색으로 만든다
  function part(geo, color, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0);
    _m.compose(_p.set(o.x || 0, o.y || 0, o.z || 0), _q.setFromEuler(_e), _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1));
    g.applyMatrix4(_m);
    _c.set(color);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }
  // 여러 도형을 하나의 모델로 합친다 (인스턴싱으로 한 번에 그리기 위해)
  function merge(parts) {
    let n = 0;
    for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o);
      nor.set(g.attributes.normal.array, o);
      col.set(g.attributes.color.array, o);
      o += g.attributes.position.count * 3;
      g.dispose();
    }
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    m.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return m;
  }
  const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const Ball = (r, detail = 1) => new THREE.IcosahedronGeometry(r, detail);
  const Cone = (r, h, seg = 6) => new THREE.ConeGeometry(r, h, seg);
  const Cyl = (rt, rb, h, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg);

  // ---------- 몬스터 모델 (높이 약 1, 발이 y=0, 앞쪽이 +z) ----------
  function batModel(body, wing, eye, horn) {
    return merge([
      part(Ball(0.28), body, { y: 0.55, sy: 0.9 }),
      part(Ball(0.21), body, { y: 0.86, z: 0.05 }),
      part(Cone(0.06, 0.22, 4), horn, { x: 0.12, y: 1.05, rz: -0.35 }),
      part(Cone(0.06, 0.22, 4), horn, { x: -0.12, y: 1.05, rz: 0.35 }),
      part(Box(0.6, 0.04, 0.32), wing, { x: 0.42, y: 0.66, z: -0.05, rz: 0.35 }),
      part(Box(0.6, 0.04, 0.32), wing, { x: -0.42, y: 0.66, z: -0.05, rz: -0.35 }),
      part(Box(0.07, 0.05, 0.03), eye, { x: 0.08, y: 0.9, z: 0.2 }),
      part(Box(0.07, 0.05, 0.03), eye, { x: -0.08, y: 0.9, z: 0.2 }),
      part(Cone(0.05, 0.14, 4), '#f4efe6', { x: 0.05, y: 0.74, z: 0.19, rx: Math.PI }),
      part(Cone(0.05, 0.14, 4), '#f4efe6', { x: -0.05, y: 0.74, z: 0.19, rx: Math.PI }),
    ]);
  }
  function skeletonModel(bone, withBow) {
    const parts = [
      part(Ball(0.2), bone, { y: 0.9 }),
      part(Box(0.17, 0.07, 0.14), bone, { y: 0.73, z: 0.03 }),
      part(Box(0.06, 0.06, 0.03), '#140c0c', { x: 0.07, y: 0.92, z: 0.18 }),
      part(Box(0.06, 0.06, 0.03), '#140c0c', { x: -0.07, y: 0.92, z: 0.18 }),
      part(Cyl(0.15, 0.1, 0.3, 6), bone, { y: 0.5 }),
      part(Box(0.24, 0.06, 0.12), bone, { y: 0.32 }),
      part(Box(0.06, 0.32, 0.06), bone, { x: 0.08, y: 0.15 }),
      part(Box(0.06, 0.32, 0.06), bone, { x: -0.08, y: 0.15 }),
      part(Box(0.05, 0.32, 0.05), bone, { x: 0.22, y: 0.5, rz: 0.25 }),
      part(Box(0.05, 0.32, 0.05), bone, { x: -0.22, y: 0.5, rz: -0.25 }),
    ];
    if (withBow) {
      parts.push(part(new THREE.TorusGeometry(0.26, 0.025, 4, 10, Math.PI), '#6b3b1c', { x: 0.3, y: 0.55, z: 0.12, rz: -Math.PI / 2, ry: 0.3 }));
      parts.push(part(Box(0.01, 0.52, 0.01), '#e8e0c8', { x: 0.3, y: 0.55, z: 0.12 }));
    }
    return merge(parts);
  }
  function slimeModel(body, dark) {
    return merge([
      part(Ball(0.42, 2), body, { y: 0.3, sy: 0.72 }),
      part(Ball(0.2, 1), body, { y: 0.58, z: -0.04 }),
      part(Ball(0.2, 1), dark, { y: 0.12, sy: 0.4, sx: 2.1, sz: 2.1 }),
      part(Ball(0.075, 1), '#ffffff', { x: 0.13, y: 0.42, z: 0.32 }),
      part(Ball(0.075, 1), '#ffffff', { x: -0.13, y: 0.42, z: 0.32 }),
      part(Ball(0.04, 0), '#111111', { x: 0.13, y: 0.42, z: 0.39 }),
      part(Ball(0.04, 0), '#111111', { x: -0.13, y: 0.42, z: 0.39 }),
    ]);
  }
  function golemModel(stone, dark, glow) {
    return merge([
      part(Box(0.62, 0.46, 0.42), stone, { y: 0.62 }),
      part(Box(0.32, 0.26, 0.3), stone, { y: 0.98 }),
      part(Box(0.07, 0.05, 0.03), glow, { x: 0.08, y: 1.0, z: 0.16 }),
      part(Box(0.07, 0.05, 0.03), glow, { x: -0.08, y: 1.0, z: 0.16 }),
      part(Box(0.2, 0.55, 0.22), dark, { x: 0.43, y: 0.56 }),
      part(Box(0.2, 0.55, 0.22), dark, { x: -0.43, y: 0.56 }),
      part(Box(0.26, 0.22, 0.26), stone, { x: 0.45, y: 0.22, z: 0.03 }),
      part(Box(0.26, 0.22, 0.26), stone, { x: -0.45, y: 0.22, z: 0.03 }),
      part(Box(0.2, 0.34, 0.24), dark, { x: 0.16, y: 0.17 }),
      part(Box(0.2, 0.34, 0.24), dark, { x: -0.16, y: 0.17 }),
      part(Box(0.16, 0.12, 0.05), glow, { y: 0.66, z: 0.22 }),
    ]);
  }
  function ghostModel(body) {
    return merge([
      part(Cone(0.3, 0.75, 7), body, { y: 0.42, rx: Math.PI }),
      part(Ball(0.25), body, { y: 0.82 }),
      part(Box(0.07, 0.09, 0.03), '#0c1830', { x: 0.08, y: 0.85, z: 0.22 }),
      part(Box(0.07, 0.09, 0.03), '#0c1830', { x: -0.08, y: 0.85, z: 0.22 }),
      part(Cone(0.07, 0.3, 4), body, { x: 0.28, y: 0.6, rz: 1.2 }),
      part(Cone(0.07, 0.3, 4), body, { x: -0.28, y: 0.6, rz: -1.2 }),
    ]);
  }

  // ---------- 바닥 장식물 (높이 약 1, 바닥이 y=0) ----------
  const PROP_MODELS = {
    rock: () => merge([
      part(new THREE.IcosahedronGeometry(0.5, 0), '#4a4560', { y: 0.25, sy: 0.6, sx: 1.2 }),
      part(new THREE.IcosahedronGeometry(0.28, 0), '#5a5472', { x: 0.55, y: 0.14, sy: 0.7, ry: 0.6 }),
      part(new THREE.IcosahedronGeometry(0.18, 0), '#3c3852', { x: -0.5, y: 0.1, z: 0.3 }),
    ]),
    pillar: () => merge([
      part(Box(0.8, 0.18, 0.8), '#5d5878', { y: 0.09 }),
      part(Cyl(0.27, 0.3, 1.3, 8), '#6e6a8a', { y: 0.82 }),
      part(Cyl(0.24, 0.27, 0.35, 8), '#6e6a8a', { y: 1.6, x: 0.05, rz: 0.25 }),
      part(Box(0.4, 0.25, 0.3), '#5d5878', { x: 0.55, y: 0.12, z: 0.25, ry: 0.7, rz: 0.4 }),
    ]),
    bones: () => merge([
      part(Ball(0.16), '#d8d2c0', { y: 0.15 }),
      part(Box(0.05, 0.05, 0.14), '#141010', { x: 0.06, y: 0.17, z: 0.12 }),
      part(Box(0.05, 0.05, 0.14), '#141010', { x: -0.06, y: 0.17, z: 0.12 }),
      part(Cyl(0.03, 0.03, 0.6, 5), '#cfc8b4', { x: 0.35, y: 0.04, rz: Math.PI / 2, ry: 0.5 }),
      part(Cyl(0.03, 0.03, 0.5, 5), '#cfc8b4', { x: -0.2, y: 0.04, z: -0.3, rz: Math.PI / 2, ry: -0.8 }),
      part(Box(0.4, 0.04, 0.06), '#cfc8b4', { x: 0.1, y: 0.03, z: -0.25, ry: 0.2 }),
    ]),
    tree: () => merge([
      part(Cyl(0.08, 0.16, 1.1, 6), '#3a2a2a', { y: 0.55, rz: 0.08 }),
      part(Cyl(0.03, 0.07, 0.6, 5), '#3a2a2a', { x: 0.22, y: 1.05, rz: -0.9 }),
      part(Cyl(0.03, 0.06, 0.5, 5), '#3a2a2a', { x: -0.2, y: 0.9, rz: 1.0 }),
      part(Cyl(0.02, 0.04, 0.4, 5), '#3a2a2a', { x: 0.05, y: 1.3, z: 0.1, rx: 0.6 }),
      part(Cyl(0.3, 0.35, 0.08, 7), '#2a2030', { y: 0.04 }),
    ]),
    crystal: () => merge([
      part(Cone(0.16, 0.95, 5), '#ffffff', { y: 0.47 }),
      part(Cone(0.12, 0.65, 5), '#ffffff', { x: 0.22, y: 0.3, rz: -0.45 }),
      part(Cone(0.1, 0.5, 5), '#ffffff', { x: -0.2, y: 0.24, z: 0.08, rz: 0.5 }),
      part(Cone(0.08, 0.4, 5), '#ffffff', { x: 0.05, y: 0.18, z: 0.22, rx: 0.5 }),
      part(new THREE.IcosahedronGeometry(0.22, 0), '#3c3852', { y: 0.05, sy: 0.4 }),
    ]),
  };
  // 장식물 종류별 등장 비중과 크기
  const PROP_KINDS = [
    { kind: 'rock', w: 34, size: [30, 55] },
    { kind: 'crystal', w: 18, size: [45, 75] },
    { kind: 'pillar', w: 12, size: [55, 80] },
    { kind: 'rune', w: 12, size: [110, 170] },
    { kind: 'bones', w: 14, size: [38, 55] },
    { kind: 'tree', w: 10, size: [70, 100] },
  ];
  const CHUNK = 520;

  // fly: 공중에 떠 있는 높이(모델 크기 대비), hop: 걸을 때 통통 튀기, squash: 출렁임
  const ENEMY_MODELS = {
    enemy_bat:      { geo: () => batModel('#4a2a6e', '#2a1640', '#ff3a3a', '#d8c8ff'), fly: 0.35 },
    enemy_charger:  { geo: () => batModel('#d0571f', '#7a2a0c', '#ffe14d', '#ffd9a0'), hop: 1 },
    enemy_ghost:    { geo: () => ghostModel('#bfe9ff'), fly: 0.3, opacity: 0.7 },
    enemy_skull:    { geo: () => skeletonModel('#eee8d6', false), hop: 1 },
    enemy_archer:   { geo: () => skeletonModel('#e07055', true), hop: 1 },
    enemy_slime:    { geo: () => slimeModel('#9b5cff', '#5b2aa8'), squash: true },
    enemy_poison:   { geo: () => slimeModel('#62d65a', '#2c7a2a'), squash: true },
    enemy_golem:    { geo: () => golemModel('#8f826f', '#5e5446', '#ffb03a'), hop: 0.4 },
    enemy_icegolem: { geo: () => golemModel('#9edcff', '#5aa7d6', '#ffffff'), hop: 0.4 },
  };

  // ---------- 코드로 그리는 텍스처 ----------
  function canvasTex(size, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
    return t;
  }
  function seeded(seed) {
    return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  }
  // 바닥: 짙은 남보라 돌판 + 보랏빛으로 빛나는 균열
  // mask=true면 같은 무늬에서 균열만 하얗게 그린다 (균열을 빛나게 하는 발광 지도로 쓴다)
  const groundDraw = (g, S, mask = false) => {
    const rnd = seeded(11);
    g.fillStyle = mask ? '#000' : '#0d0f22';
    g.fillRect(0, 0, S, S);
    const n = 10, T = S / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const l = 12 + rnd() * 8;
        const hue = 228 + rnd() * 26;
        if (mask) { for (let k = 0; k < 12; k++) rnd(); continue; } // 같은 난수 순서를 유지
        g.fillStyle = `hsl(${hue}, 22%, ${l}%)`;
        g.fillRect(i * T + 3, j * T + 3, T - 6, T - 6);
        g.fillStyle = `hsla(235, 30%, ${l + 6}%, 0.6)`;
        g.fillRect(i * T + 3, j * T + 3, T - 6, 4);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(i * T + 3, j * T + T - 7, T - 6, 4);
        for (let k = 0; k < 6; k++) {
          g.fillStyle = 'rgba(255,255,255,0.04)';
          g.fillRect(i * T + rnd() * T, j * T + rnd() * T, 2 + rnd() * 6, 2 + rnd() * 6);
        }
      }
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let k = 0; k < 9; k++) {
      let x = rnd() * S, y = rnd() * S;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 8 + rnd() * 10; s++) { x += (rnd() - 0.5) * 80; y += (rnd() - 0.5) * 80; g.lineTo(x, y); }
      if (mask) {
        g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 9; g.stroke();
        g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.stroke();
      } else {
        g.strokeStyle = 'rgba(20,10,40,0.9)'; g.lineWidth = 6; g.stroke();
        g.strokeStyle = 'rgba(120,90,160,0.5)'; g.lineWidth = 2; g.stroke();
      }
    }
  };
  // 넓은 얼룩: 바닥 무늬의 반복을 가리려고 훨씬 큰 간격으로 어둡고 색 있는 얼룩을 덮는다
  const stainDraw = (g, S) => {
    const rnd = seeded(29);
    for (let k = 0; k < 26; k++) {
      const x = rnd() * S, y = rnd() * S, r = 60 + rnd() * 180;
      const dark = rnd() < 0.65;
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        gr.addColorStop(0, dark ? 'rgba(0,0,10,0.55)' : 'rgba(120,80,200,0.22)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  };
  // 룬 마법진 무늬
  const runeDraw = (g, S) => {
    const m = S / 2;
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    g.lineWidth = 3;
    for (const r of [0.92, 0.78, 0.42]) { g.beginPath(); g.arc(m, m, m * r, 0, Math.PI * 2); g.stroke(); }
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i * 2 / 6) * Math.PI * 2 - Math.PI / 2;
      const px = m + Math.cos(a) * m * 0.78, py = m + Math.sin(a) * m * 0.78;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
    g.font = `bold ${S * 0.07}px serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊ';
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      g.save();
      g.translate(m + Math.cos(a) * m * 0.85, m + Math.sin(a) * m * 0.85);
      g.rotate(a + Math.PI / 2);
      g.fillText(RUNES[i], 0, 0);
      g.restore();
    }
  };
  const glowDraw = (g, S) => {
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  };
  const burstDraw = (g, S) => {
    const m = S / 2;
    g.translate(m, m);
    for (let i = 0; i < 10; i++) {
      g.rotate(Math.PI * 2 / 10);
      const gr = g.createLinearGradient(0, 0, m, 0);
      gr.addColorStop(0, 'rgba(255,240,180,1)');
      gr.addColorStop(1, 'rgba(255,90,20,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, -m * 0.08); g.lineTo(m * (0.7 + (i % 2) * 0.3), 0); g.lineTo(0, m * 0.08); g.fill();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    glowDraw(g, S);
  };
  const vortexDraw = (g, S) => {
    const m = S / 2;
    g.translate(m, m);
    for (let arm = 0; arm < 4; arm++) {
      g.rotate(Math.PI / 2);
      g.beginPath();
      for (let t = 0; t < 1; t += 0.02) {
        const a = t * 5, r = t * m * 0.95;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.strokeStyle = 'rgba(190,110,255,0.9)'; g.lineWidth = 10; g.stroke();
      g.strokeStyle = 'rgba(255,230,255,0.9)'; g.lineWidth = 3; g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    const gr = g.createRadialGradient(m, m, 0, m, m, m);
    gr.addColorStop(0, 'rgba(20,0,40,0.9)');
    gr.addColorStop(0.3, 'rgba(120,40,220,0.5)');
    gr.addColorStop(1, 'rgba(120,40,220,0)');
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  };

  // ---------- 공용 재질 ----------
  const phong = (o = {}) => new THREE.MeshPhongMaterial({ flatShading: true, shininess: 25, ...o });
  const additive = (o = {}) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...o });

  function instanced(geo, mat, cap = CAP) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // 색을 따로 주지 않는 인스턴스는 원래 색 그대로 보이도록 전부 흰색(곱하기 1)으로 채워 둔다
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < cap; i++) m.setColorAt(i, white);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    scene.add(m);
    return m;
  }
  // 인스턴스 하나를 위치·회전·크기·색으로 채운다
  const _o = new THREE.Object3D();
  function put(mesh, x, y, z, ry, sx, sy, sz, color, rx = 0, rz = 0) {
    const i = mesh.count++;
    if (i >= mesh.instanceMatrix.count) { mesh.count--; return; }
    _o.position.set(x, y, z);
    _o.rotation.set(rx, ry, rz);
    _o.scale.set(sx, sy, sz);
    _o.updateMatrix();
    mesh.setMatrixAt(i, _o.matrix);
    if (color) mesh.setColorAt(i, color);
  }
  function finish(mesh) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // 화면을 향하는 빛 번짐 (탄막·보석·불덩이 후광)
  function putGlow(x, y, z, size, color) {
    const i = R.glow.count++;
    if (i >= R.glow.instanceMatrix.count) { R.glow.count--; return; }
    _o.position.set(x, y, z);
    _o.quaternion.copy(camera.quaternion);
    _o.scale.set(size, size, size);
    _o.updateMatrix();
    R.glow.setMatrixAt(i, _o.matrix);
    R.glow.setColorAt(i, color);
    _o.rotation.set(0, 0, 0);
  }

  // 키로 묶어 재사용하는 개별 오브젝트 풀 (정예·보스·상자·범위 효과)
  function keyedPool(create) {
    const live = new Map(), free = [];
    return {
      get(key) {
        let o = live.get(key);
        if (!o) {
          o = free.pop() || create();
          o.visible = true;
          live.set(key, o);
        }
        o.userData.seen = frame;
        return o;
      },
      sweep() {
        for (const [k, o] of live) {
          if (o.userData.seen !== frame) { o.visible = false; live.delete(k); free.push(o); }
        }
      },
    };
  }

  // ---------- 주인공 (부위별로 움직이는 모델) ----------
  function makeHero() {
    const g = new THREE.Group();
    const mats = [];
    const mat = (c, o) => { const m = phong({ color: c, ...o }); mats.push(m); return m; };
    const mesh = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); return o; };
    const armor = mat('#2b2533'), trim = mat('#c9a24a'), skin = mat('#f1c9a5'), hair = mat('#3a2620'), cape = mat('#8a1525');
    const blade = mat('#9b5cff', { emissive: '#5a1fc8', emissiveIntensity: 0.9 });

    const legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.09, 0.42, 0);
      hip.add(mesh(Box(0.13, 0.36, 0.15), armor, 0, -0.18, 0));
      hip.add(mesh(Box(0.15, 0.09, 0.22), mat('#1a1620'), 0, -0.38, 0.03));
      g.add(hip);
      legs.push(hip);
    }
    g.add(mesh(Box(0.42, 0.42, 0.25), armor, 0, 0.64, 0));
    g.add(mesh(Box(0.44, 0.06, 0.27), trim, 0, 0.45, 0));
    g.add(mesh(Box(0.12, 0.12, 0.02), mat('#b05cff', { emissive: '#7a2bd8' }), 0, 0.7, 0.13));
    for (const s of [-1, 1]) g.add(mesh(Box(0.16, 0.1, 0.3), trim, s * 0.26, 0.86, 0)); // 어깨 갑옷
    g.add(mesh(Ball(0.19), skin, 0, 1.02, 0.01));
    const hairTop = mesh(Ball(0.22), hair, 0, 1.08, -0.03);
    hairTop.scale.set(1.05, 0.85, 1.05);
    g.add(hairTop);
    g.add(mesh(Box(0.36, 0.1, 0.1), hair, 0, 1.13, 0.13));
    for (const s of [-1, 1]) g.add(mesh(Box(0.05, 0.035, 0.02), mat('#b47cff', { emissive: '#8a4cff' }), s * 0.07, 1.0, 0.19));

    const capePivot = new THREE.Group();
    capePivot.position.set(0, 0.86, -0.13);
    const capeMesh = mesh(Box(0.46, 0.66, 0.03), cape, 0, -0.33, 0);
    capePivot.add(capeMesh);
    g.add(capePivot);

    const arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.27, 0.8, 0);
      sh.add(mesh(Box(0.11, 0.36, 0.12), armor, 0, -0.18, 0));
      if (s === 1) {
        // 오른손의 큰 보라색 검
        const hand = new THREE.Group();
        hand.position.set(0, -0.36, 0.04);
        hand.add(mesh(Box(0.05, 0.16, 0.05), mat('#4a3020'), 0, 0, 0));
        hand.add(mesh(Box(0.24, 0.04, 0.07), trim, 0, 0.08, 0));
        hand.add(mesh(Box(0.08, 0.8, 0.025), blade, 0, 0.5, 0));
        hand.rotation.x = Math.PI / 2.2;
        sh.add(hand);
      }
      g.add(sh);
      arms.push(sh);
    }
    g.userData = { legs, arms, capePivot, mats };
    return g;
  }

  // ---------- 드래곤 (정예·보스) ----------
  const DRAGONS = {
    enemy_elite: { body: '#3b2357', belly: '#7a4ea0', wing: '#24133a', eye: '#ff4040', glow: 0.3 },
    boss_fire:   { body: '#a8321a', belly: '#ff9a3c', wing: '#5a1408', eye: '#ffd23f', glow: 0.5 },
    boss_void:   { body: '#22123e', belly: '#5a2a9a', wing: '#0d0618', eye: '#d07bff', glow: 0.7 },
    boss_final:  { body: '#1d5f7a', belly: '#7ae3ff', wing: '#0b2a3a', eye: '#ffffff', glow: 0.8 },
  };
  function makeDragon(c) {
    const g = new THREE.Group();
    const mats = [];
    const mat = (col, o) => { const m = phong({ color: col, ...o }); mats.push(m); return m; };
    const mesh = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); return o; };
    const body = mat(c.body), belly = mat(c.belly), wingM = mat(c.wing, { side: THREE.DoubleSide });
    const eye = mat(c.eye, { emissive: c.eye, emissiveIntensity: 1 });
    const torso = mesh(Ball(0.38, 1), body, 0, 0.5, 0);
    torso.scale.set(1.0, 0.9, 1.35);
    g.add(torso);
    const bellyM = mesh(Ball(0.3, 1), belly, 0, 0.42, 0.12);
    bellyM.scale.set(0.9, 0.8, 1.2);
    g.add(bellyM);
    const neck = mesh(Cyl(0.13, 0.2, 0.4, 6), body, 0, 0.78, 0.36);
    neck.rotation.x = 0.7;
    g.add(neck);
    const head = new THREE.Group();
    head.position.set(0, 0.98, 0.52);
    head.add(mesh(Box(0.3, 0.22, 0.36), body, 0, 0, 0));
    head.add(mesh(Box(0.24, 0.08, 0.28), belly, 0, -0.1, 0.06));
    for (const s of [-1, 1]) {
      head.add(mesh(Box(0.06, 0.05, 0.03), eye, s * 0.1, 0.04, 0.18));
      const horn = mesh(Cone(0.05, 0.3, 4), belly, s * 0.1, 0.2, -0.12);
      horn.rotation.x = -0.6;
      head.add(horn);
    }
    g.add(head);
    const wings = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.25, 0.75, -0.05);
      const w = mesh(Box(0.95, 0.03, 0.6), wingM, s * 0.48, 0, -0.1);
      pivot.add(w);
      const spike = mesh(Cone(0.04, 0.25, 4), belly, s * 0.95, 0.02, 0.18);
      spike.rotation.z = -s * Math.PI / 2;
      pivot.add(spike);
      g.add(pivot);
      wings.push(pivot);
    }
    const tail = mesh(Cone(0.16, 0.8, 6), body, 0, 0.42, -0.72);
    tail.rotation.x = -Math.PI / 2 - 0.25;
    g.add(tail);
    for (const s of [-1, 1]) for (const z of [-0.25, 0.25]) g.add(mesh(Box(0.12, 0.3, 0.14), body, s * 0.22, 0.15, z));
    g.userData = { wings, head, mats, glow: c.glow };
    scene.add(g);
    return g;
  }

  function makeChest() {
    const g = new THREE.Group();
    const wood = phong({ color: '#8a5326' }), gold = phong({ color: '#f2c14e', emissive: '#7a5a10' });
    const base = new THREE.Mesh(Box(0.9, 0.5, 0.6), wood); base.position.y = 0.25; g.add(base);
    const lid = new THREE.Mesh(Cyl(0.3, 0.3, 0.9, 8, 1), wood); lid.rotation.z = Math.PI / 2; lid.scale.set(1, 1, 1); lid.position.y = 0.5; g.add(lid);
    for (const x of [-0.3, 0.3]) { const b = new THREE.Mesh(Box(0.08, 0.86, 0.64), gold); b.position.set(x, 0.42, 0); g.add(b); }
    const lock = new THREE.Mesh(Box(0.14, 0.16, 0.05), gold); lock.position.set(0, 0.45, 0.31); g.add(lock);
    scene.add(g);
    return g;
  }

  // ---------- 장면 구성 ----------
  const R = {};
  function build() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#05060f');
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000);
    R.hemi = new THREE.HemisphereLight('#c7ccff', '#2a1830', 2.2);
    scene.add(R.hemi);
    const sun = new THREE.DirectionalLight('#ffffff', 2.6);
    sun.position.set(-0.5, 1, 0.7);
    scene.add(sun);
    scene.add(sun.target);
    R.sun = sun;

    // 바닥은 주인공을 따라다니고, 무늬 한 장 크기 단위로만 움직여 이음매가 보이지 않는다
    // 균열은 발광 지도로 따로 그려 단계별 색으로 숨 쉬듯 빛나게 한다
    const gtex = canvasTex(1280, groundDraw, true);
    const gglow = canvasTex(1280, (g, S) => groundDraw(g, S, true), true);
    const GS = 6000;
    gtex.repeat.set(GS / TILE, GS / TILE);
    gglow.repeat.set(GS / TILE, GS / TILE);
    R.ground = new THREE.Mesh(new THREE.PlaneGeometry(GS, GS),
      new THREE.MeshLambertMaterial({ map: gtex, emissiveMap: gglow, emissive: '#8a4dff', emissiveIntensity: 1 }));
    R.ground.rotation.x = -Math.PI / 2;

    // 넓은 얼룩 (바닥 무늬보다 훨씬 큰 간격으로 반복)
    const stex = canvasTex(512, stainDraw, true);
    stex.repeat.set(GS / STAIN, GS / STAIN);
    R.stain = new THREE.Mesh(new THREE.PlaneGeometry(GS, GS), new THREE.MeshBasicMaterial({ map: stex, transparent: true, depthWrite: false }));
    R.stain.rotation.x = -Math.PI / 2;
    R.stain.position.y = 0.2;
    scene.add(R.stain);

    // 바닥 장식물: 종류마다 인스턴싱. 수정은 스스로 빛나고, 룬 마법진은 바닥에서 돌며 깜빡인다
    R.props = {};
    for (const [k, make] of Object.entries(PROP_MODELS)) {
      const mat = k === 'crystal'
        ? phong({ vertexColors: true, color: '#b48cff', emissive: '#6a2bd8', emissiveIntensity: 0.9, shininess: 80 })
        : phong({ vertexColors: true });
      R.props[k] = instanced(make(), mat, 200);
    }
    const runeGeo = new THREE.PlaneGeometry(1, 1);
    runeGeo.rotateX(-Math.PI / 2);
    R.props.rune = instanced(runeGeo, additive({ map: canvasTex(256, runeDraw), color: '#ffffff' }), 120);
    R.props.rune.renderOrder = 1;
    R.propCache = new Map();
    // 지금 단계의 분위기 색 (목표 색으로 서서히 바뀐다)
    R.theme = { accent: new THREE.Color('#8a4dff'), sky: new THREE.Color('#c7ccff') };
    scene.add(R.ground);

    const shadowGeo = new THREE.CircleGeometry(1, 16);
    shadowGeo.rotateX(-Math.PI / 2);
    R.shadow = instanced(shadowGeo, new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.4, depthWrite: false }), 900);

    R.enemies = {};
    for (const [k, def] of Object.entries(ENEMY_MODELS)) {
      const opts = { vertexColors: true };
      if (def.opacity) Object.assign(opts, { transparent: true, opacity: def.opacity, depthWrite: false });
      R.enemies[k] = instanced(def.geo(), phong(opts));
    }

    R.gem = instanced(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial(), 420);
    R.glowTex = canvasTex(64, glowDraw);
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    R.glow = instanced(glowGeo, additive({ map: R.glowTex }), 1600);
    R.glow.renderOrder = 5;

    // 투사체 (모두 +x 방향을 향하게 만든다)
    R.proj = {
      dagger: instanced(merge([
        part(Box(1, 0.14, 0.05), '#dfe6ee', { x: 0.2 }),
        part(Cone(0.07, 0.25, 4), '#ffffff', { x: 0.82, rz: -Math.PI / 2 }),
        part(Box(0.12, 0.4, 0.08), '#c9a24a', { x: -0.32 }),
        part(Box(0.3, 0.1, 0.08), '#6b3b1c', { x: -0.52 }),
      ]), phong({ vertexColors: true, emissive: '#333333' }), 300),
      trident: instanced(merge([
        part(Cyl(0.05, 0.05, 1.4, 5), '#c9a24a', { rz: Math.PI / 2 }),
        part(Cone(0.12, 0.35, 4), '#e8f6ff', { x: 0.85, rz: -Math.PI / 2 }),
        part(Box(0.06, 0.34, 0.06), '#c9a24a', { x: 0.6 }),
      ]), phong({ vertexColors: true, emissive: '#3a2a00' }), 200),
      bow: instanced(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffd27a' }), 300),
    };
    R.star = instanced(merge([
      part(Cone(0.18, 0.75, 4), '#f2c14e', { x: 0.37, rz: -Math.PI / 2 }),
      part(Cone(0.18, 0.75, 4), '#f2c14e', { x: -0.37, rz: Math.PI / 2 }),
      part(Cone(0.18, 0.75, 4), '#f2c14e', { z: 0.37, rx: Math.PI / 2 }),
      part(Cone(0.18, 0.75, 4), '#f2c14e', { z: -0.37, rx: -Math.PI / 2 }),
      part(Cyl(0.16, 0.16, 0.12, 8), '#7a4a10'),
    ]), phong({ vertexColors: true, emissive: '#5a3a00' }), 16);
    R.bullet = instanced(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial(), 620);

    // 정예·보스·상자·범위 효과는 개수가 적어 개별 오브젝트로 그린다
    R.hero = makeHero();
    scene.add(R.hero);
    R.dragons = {};
    for (const [k, c] of Object.entries(DRAGONS)) R.dragons[k] = keyedPool(() => makeDragon(c));
    R.chests = keyedPool(makeChest);

    const burstTex = canvasTex(128, burstDraw);
    R.bursts = keyedPool(() => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: burstTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      scene.add(s);
      return s;
    });
    R.bolts = keyedPool(() => {
      const g = new THREE.Group();
      // 기둥이 바닥에서 위로 솟도록 아랫면을 원점에 맞춘다
      const beam = new THREE.Mesh(Cyl(5, 9, 1, 6).translate(0, 0.5, 0), additive({ color: '#bfe6ff' }));
      g.add(beam);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 1, 24), additive({ color: '#7fc8ff', side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.01;
      g.add(ring);
      g.userData = { beam, ring };
      scene.add(g);
      return g;
    });
    R.novas = keyedPool(() => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), additive({ color: '#a8e0ff', side: THREE.DoubleSide }));
      const disk = new THREE.Mesh(new THREE.CircleGeometry(0.86, 48), additive({ color: '#3a7ab8', side: THREE.DoubleSide }));
      for (const m of [ring, disk]) { m.rotation.x = -Math.PI / 2; g.add(m); }
      g.position.y = 2;
      g.userData = { ring, disk };
      scene.add(g);
      return g;
    });
    const vortexTex = canvasTex(256, vortexDraw);
    R.vortexes = keyedPool(() => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive({ map: vortexTex, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      const g = new THREE.Group();
      g.add(m);
      g.position.y = 3;
      g.userData = { m };
      scene.add(g);
      return g;
    });
    R.slashes = keyedPool(() => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.RingGeometry(0.55, 1, 32, 1, -1.2, 2.4), additive({ color: '#ffb8f0', side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      g.add(m);
      g.position.y = 18;
      g.userData = { m };
      scene.add(g);
      return g;
    });
  }

  // ---------- pixelfx 이펙트 (카메라를 향한 판) ----------
  // 이펙트마다 그림 한 장을 공유하고, 판마다 텍스처 복사본의 위치(offset)만 바꿔 프레임을 고른다
  const SP = {};
  function initSprites(data, images) {
    for (const [key, d] of Object.entries(data)) {
      const im = images[key];
      if (!im) continue;
      const tex = new THREE.Texture(im);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter; // 픽셀 아트가 번지지 않게
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      const rows = Math.ceil(d.n / d.cols);
      tex.repeat.set(1 / d.cols, 1 / rows);
      tex.needsUpdate = true;
      // 판의 원점이 이펙트의 기준점(발밑·중심)에 오도록 옮긴다
      const geo = new THREE.PlaneGeometry(d.w, d.h).translate(d.w / 2 - d.px, d.py - d.h / 2, 0);
      SP[key] = { d, rows, tex, geo, meshes: [], used: 0 };
    }
  }
  function spriteMesh(s) {
    let m = s.meshes[s.used];
    if (!m) {
      const map = s.tex.clone();
      map.needsUpdate = true;
      m = new THREE.Mesh(s.geo, new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false }));
      m.renderOrder = 20;
      scene.add(m);
      s.meshes.push(m);
    }
    s.used++;
    m.visible = true;
    return m;
  }
  const _rz = new THREE.Quaternion(), _zAxis = new THREE.Vector3(0, 0, 1);
  function drawSprites(list) {
    for (const k in SP) SP[k].used = 0;
    for (const sp of list) {
      const s = SP[sp.key];
      if (!s) continue;
      const m = spriteMesh(s);
      const col = sp.f % s.d.cols, row = Math.floor(sp.f / s.d.cols);
      m.material.map.offset.set(col / s.d.cols, 1 - (row + 1) / s.rows);
      m.material.opacity = sp.a;
      m.position.set(sp.x, sp.h, sp.y);
      m.scale.setScalar(sp.s);
      // 바닥 위 진행 방향을 화면에 비친 각도로 바꿔 판을 돌린다 (화면 위쪽이 +y라 부호가 반대)
      const screenAngle = sp.rot ? Math.atan2(Math.sin(sp.rot) * Math.sin(ELEV), Math.cos(sp.rot)) : 0;
      m.quaternion.copy(camera.quaternion).multiply(_rz.setFromAxisAngle(_zAxis, -screenAngle));
    }
    for (const k in SP) {
      const s = SP[k];
      for (let i = s.used; i < s.meshes.length; i++) s.meshes[i].visible = false;
    }
  }

  // ---------- 매 프레임 ----------
  const WHITE = new THREE.Color(1, 1, 1), FLASH = new THREE.Color(2.4, 2.4, 2.4);
  const SLOW = new THREE.Color(0.6, 0.85, 1.7), WINDUP = new THREE.Color(2.2, 0.6, 0.5);
  const GEM_COLORS = { 1: new THREE.Color('#2fa4ff'), 3: new THREE.Color('#b45cff'), 8: new THREE.Color('#ff3d6e') };
  const STONE = new THREE.Color('#50e6ff'), SCALE = new THREE.Color('#ff7a50');
  const FIRE = new THREE.Color('#ff8a2a'), GOLD = new THREE.Color('#ffd166');
  const tmpColor = new THREE.Color();

  function setCamera(x, y) {
    target.set(x, 0, y);
    camera.position.set(x, Math.sin(ELEV) * 2500, y + Math.cos(ELEV) * 2500);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    R.sun.position.set(x - 400, 900, y + 600);
    R.sun.target.position.copy(target);
    R.ground.position.set(Math.round(x / TILE) * TILE, 0, Math.round(y / TILE) * TILE);
    R.stain.position.set(Math.round(x / STAIN) * STAIN, 0.2, Math.round(y / STAIN) * STAIN);
  }

  // ---------- 단계별 분위기 ----------
  // 시작은 보라, 첫 보스를 잡으면 불씨색, 둘째 보스를 잡으면 얼음빛. 보스가 있는 동안은 붉게 깜빡인다
  const THEMES = [
    { accent: new THREE.Color('#8a4dff'), sky: new THREE.Color('#c7ccff') },
    { accent: new THREE.Color('#ff5a1f'), sky: new THREE.Color('#ffd6c0') },
    { accent: new THREE.Color('#22d4ff'), sky: new THREE.Color('#c8f0ff') },
  ];
  const BOSS_THEME = { accent: new THREE.Color('#ff1e3c'), sky: new THREE.Color('#ffc0c8') };
  function updateTheme(G, t, dt) {
    const bossOn = G && G.boss;
    const want = bossOn ? BOSS_THEME : THEMES[Math.min(THEMES.length - 1, G ? G.bossKills : 0)];
    const k = Math.min(1, dt * 1.2);
    R.theme.accent.lerp(want.accent, k);
    R.theme.sky.lerp(want.sky, k);
    const pulse = bossOn ? 0.65 + 0.35 * Math.sin(t * 6) : 0.6 + 0.3 * Math.sin(t * 1.6);
    R.ground.material.emissive.copy(R.theme.accent);
    R.ground.material.emissiveIntensity = pulse;
    R.hemi.color.copy(R.theme.sky);
    R.props.crystal.material.emissive.copy(R.theme.accent).multiplyScalar(0.8);
    R.props.rune.material.color.copy(R.theme.accent);
  }

  // ---------- 바닥 장식물 ----------
  // 세상을 CHUNK 크기 칸으로 나누고, 칸 번호로 정해지는 난수로 장식을 놓는다.
  // 그래서 어디로 가도 끝없이 나오고, 다시 돌아오면 같은 자리에 같은 장식이 있다
  function chunkProps(cx, cy) {
    const key = cx + ',' + cy;
    let list = R.propCache.get(key);
    if (list) return list;
    const h = Math.abs((cx * 73856093) ^ (cy * 19349663));
    const rnd = seeded((h % 2147483646) + 1);
    rnd(); rnd();
    const total = PROP_KINDS.reduce((a, p) => a + p.w, 0);
    const n = 2 + Math.floor(rnd() * 4);
    list = [];
    for (let i = 0; i < n; i++) {
      let r = rnd() * total;
      const k = PROP_KINDS.find(p => (r -= p.w) < 0) || PROP_KINDS[0];
      list.push({
        kind: k.kind,
        x: (cx + rnd()) * CHUNK, y: (cy + rnd()) * CHUNK,
        rot: rnd() * Math.PI * 2,
        s: k.size[0] + rnd() * (k.size[1] - k.size[0]),
        ph: rnd() * 10,
      });
    }
    list = list.filter(p => Math.hypot(p.x, p.y) > 180); // 출발 지점은 비워 둔다
    if (R.propCache.size > 600) R.propCache.clear();
    R.propCache.set(key, list);
    return list;
  }

  function drawProps(t) {
    for (const k in R.props) R.props[k].count = 0;
    const spanX = W / 2 + 200, spanZ = H / 2 / Math.sin(ELEV) + 260;
    const x0 = Math.floor((target.x - spanX) / CHUNK), x1 = Math.floor((target.x + spanX) / CHUNK);
    const z0 = Math.floor((target.z - spanZ) / CHUNK), z1 = Math.floor((target.z + spanZ) / CHUNK);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        for (const p of chunkProps(cx, cz)) {
          if (p.kind === 'rune') {
            // 룬 마법진: 천천히 돌며 밝기가 오르내린다
            const b = 0.35 + 0.25 * Math.sin(t * 1.5 + p.ph);
            put(R.props.rune, p.x, 0.6, p.y, p.rot + t * 0.25, p.s, 1, p.s, tmpColor.setScalar(b));
            continue;
          }
          put(R.props[p.kind], p.x, 0, p.y, p.rot, p.s, p.s, p.s);
          put(R.shadow, p.x, 0.5, p.y, 0, p.s * 0.5, 1, p.s * 0.4);
          if (p.kind === 'crystal') {
            const b = 0.5 + 0.3 * Math.sin(t * 2.2 + p.ph);
            putGlow(p.x, p.s * 0.45, p.y, p.s * 2.4, tmpColor.copy(R.theme.accent).multiplyScalar(b));
          }
        }
      }
    }
    for (const k in R.props) finish(R.props[k]);
  }

  // 떠다니는 빛 알갱이: 바닥에서 천천히 떠올라 사라진다 (세상에 고정되고 화면 둘레로 감겨 돈다)
  function drawMotes(t) {
    const spanX = W + 240, spanZ = H / Math.sin(ELEV) + 240, TOP = 240;
    const wrap = (v, span) => ((v % span) + span) % span;
    for (let i = 0; i < 60; i++) {
      const a = (i * 0.6180339) % 1, b = (i * 0.3819660 + 0.37) % 1;
      const drift = Math.sin(t * 0.5 + i) * 30;
      const x = target.x + wrap(a * spanX + drift - target.x, spanX) - spanX / 2;
      const z = target.z + wrap(b * spanZ - target.z, spanZ) - spanZ / 2;
      const h = wrap(b * TOP + t * (14 + (i % 5) * 5), TOP);
      const fade = Math.sin((h / TOP) * Math.PI); // 바닥과 꼭대기에서 흐려진다
      putGlow(x, h, z, 10 + (i % 4) * 4, tmpColor.copy(R.theme.accent).multiplyScalar(0.9 * fade));
    }
  }

  // ---------- 주인공 3D 모델 (models/hero.js에 담긴 GLB) ----------
  // 모델마다 애니메이션 이름이 달라서, 상태별로 후보 이름을 순서대로 찾는다
  const HERO_ANIMS = {
    idle:   ['2H_Melee_Idle', 'Idle', 'idle'],
    run:    ['Running_A', 'Run', 'Running', 'run', 'Walking_A', 'Walk'],
    slice:  ['2H_Melee_Attack_Slice', 'Attack', 'attack', '1H_Melee_Attack_Slice_Horizontal'],
    spin:   ['2H_Melee_Attack_Spin', '2H_Melee_Attack_Slice', 'Attack'],
    death:  ['Death_A', 'Death', 'death'],
    cheer:  ['Cheer', 'Victory', 'cheer'],
  };
  const ONE_SHOT = { slice: 2.3, spin: 2.0, death: 1, cheer: 1 }; // 한 번만 재생 (값은 재생 속도)
  const SWING_RANGE = 300; // 이 거리 안에 적이 있으면 쉬지 않고 칼을 휘두른다
  const HERO_HEIGHT = 125;
  // 상체 뼈 (three.js가 이름의 '.'을 지워 'upperarm.l'은 'upperarml'이 된다). 나머지는 하체
  const UPPER_BONES = /^(spine|chest|head|(upperarm|lowerarm|wrist|hand|handslot|elbowIK|handIK)\.?[lr])$/;
  // 보조 무기·방패는 숨기고 양손검만 들게 한다
  const HERO_HIDE = /^(1H_Sword|1H_Sword_Offhand|Badge_Shield|Rectangle_Shield|Round_Shield|Spike_Shield)$/;

  function loadHeroModel() {
    if (!window.HERO_MODEL || !THREE.GLTFLoader) return;
    const bin = atob(window.HERO_MODEL);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    new THREE.GLTFLoader().parse(buf.buffer, '', setupHeroModel, err => console.warn('주인공 모델을 불러오지 못해 기본 모델을 씁니다', err));
  }

  function setupHeroModel(gltf) {
    const root = gltf.scene;
    const mats = [];
    root.traverse(o => {
      if (HERO_HIDE.test(o.name)) o.visible = false;
      if (!o.isMesh) return;
      o.frustumCulled = false; // 뼈대로 움직이는 모델은 경계 상자가 정확하지 않다
      o.material = o.material.clone();
      if (/2H_Sword/.test(o.name) || /2H_Sword/.test(o.parent && o.parent.name)) {
        // 검은 보랏빛으로 빛나게
        o.material.color.set('#c9a6ff');
        o.material.emissive = new THREE.Color('#6a1fff');
        o.material.emissiveIntensity = 0.8;
      } else {
        // 갑옷을 어두운 보랏빛으로 물들인다
        o.material.color.setRGB(0.6, 0.52, 0.78);
      }
      o.material.userData.baseEmissive = o.material.emissive.clone();
      mats.push(o.material);
    });
    const box = new THREE.Box3().setFromObject(root);
    const h = box.max.y - box.min.y || 1;
    root.scale.setScalar(HERO_HEIGHT / h);
    root.position.y = -box.min.y * HERO_HEIGHT / h;
    const holder = new THREE.Group();
    holder.add(root);
    scene.add(holder);

    // 애니메이션을 상체와 하체로 나눠 두 층으로 재생한다.
    // 그래야 달리면서(하체) 칼을 휘두를(상체) 수 있다
    const mixer = new THREE.AnimationMixer(root);
    const actions = { upper: {}, lower: {} };
    const boneOf = track => track.name.slice(0, track.name.lastIndexOf('.'));
    for (const [state, names] of Object.entries(HERO_ANIMS)) {
      const clip = names.map(n => THREE.AnimationClip.findByName(gltf.animations, n)).find(Boolean);
      if (!clip) continue;
      for (const layer of ['upper', 'lower']) {
        const part = new THREE.AnimationClip(`${clip.name}_${layer}`, clip.duration,
          clip.tracks.filter(tr => UPPER_BONES.test(boneOf(tr)) === (layer === 'upper')));
        const a = mixer.clipAction(part);
        if (ONE_SHOT[state]) {
          a.setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
          a.timeScale = ONE_SHOT[state];
        }
        actions[layer][state] = a;
      }
    }
    if (!actions.upper.idle) { console.warn('주인공 모델에 대기 애니메이션이 없어 기본 모델을 씁니다'); return; }
    R.hero.visible = false;
    R.heroModel = {
      holder, mixer, actions, mats,
      layers: { upper: { state: null }, lower: { state: null } },
      attack: 'slice', lockUntil: 0, t: 0, yaw: 0, lastAttackT: 0,
    };
    playLayer('upper', 'idle');
    playLayer('lower', 'idle');
  }

  // 한 층(상체/하체)의 동작을 바꾼다. restart면 같은 동작이라도 처음부터 다시 재생
  function playLayer(layer, state, restart = false) {
    const H = R.heroModel;
    const L = H.layers[layer], acts = H.actions[layer];
    const next = acts[state] || acts.idle;
    const cur = L.state && (acts[L.state] || acts.idle);
    L.state = state;
    if (next === cur) {
      if (restart) next.reset().play();
      return;
    }
    next.reset().play();
    if (cur) next.crossFadeFrom(cur, 0.12, false);
  }

  function animateHeroModel(G, dt) {
    const H = R.heroModel;
    const p = G ? G.p : { x: 0, y: 0, fx: 0, fy: 1, moving: false, attackT: 0, invuln: 0 };
    const running = !G || G.state === 'play';
    H.t += dt;
    const over = G && G.state === 'over';
    const moving = p.moving && running;
    // 무기를 쏘거나 근처에 적이 있으면 새 공격이 시작된다. 휘두르는 도중에는 끝날 때까지 기다린다
    let newAttack = false;
    const fired = p.attackT > H.lastAttackT + 0.01;
    let enemyNear = false;
    if (G && !fired) {
      for (const e of G.enemies) {
        if (!e.dead && Math.abs(e.x - p.x) < SWING_RANGE && Math.abs(e.y - p.y) < SWING_RANGE) { enemyNear = true; break; }
      }
    }
    if (!over && running && (fired || enemyNear) && H.t >= H.lockUntil) {
      // 초승달 베기가 막 발동했으면 회전베기, 그 밖에는 내려베기
      H.attack = fired && p.attackKind === 'spin' ? 'spin' : 'slice';
      const a = H.actions.upper[H.attack];
      if (a) {
        H.lockUntil = H.t + a.getClip().duration / a.timeScale * 0.85;
        newAttack = true;
      }
    }
    H.lastAttackT = p.attackT;
    const attacking = H.t < H.lockUntil;
    let upper, lower;
    if (over) upper = lower = p.hp <= 0 ? 'death' : 'cheer';
    else {
      // 상체: 공격 중이면 칼질, 아니면 하체에 맞춰 달리기·대기
      upper = attacking ? H.attack : moving ? 'run' : 'idle';
      // 하체: 움직이면 달리기, 멈춰서 공격하면 공격 자세의 다리, 아니면 대기
      lower = moving ? 'run' : attacking ? H.attack : 'idle';
    }
    playLayer('upper', upper, newAttack);
    playLayer('lower', lower, newAttack && !moving);
    H.mixer.update(G && G.state !== 'play' && G.state !== 'over' ? 0 : dt);

    H.holder.position.set(p.x, 0, p.y);
    // 바라보는 방향을 부드럽게 돌린다
    const target = Math.atan2(p.fx, p.fy);
    let d = target - H.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    H.yaw += d * Math.min(1, dt * 14);
    H.holder.rotation.y = H.yaw;
    const hurt = p.invuln > 0 && Math.floor((G ? G.time : 0) * 20) % 2 === 0;
    for (const m of H.mats) {
      if (hurt) m.emissive.set('#ff2020');
      else m.emissive.copy(m.userData.baseEmissive);
    }
    put(R.shadow, p.x, 0.5, p.y, 0, 26, 1, 20);
  }

  function animateHero(G, t, dt) {
    if (R.heroModel) { animateHeroModel(G, dt); return; }
    const h = R.hero, u = h.userData;
    const p = G ? G.p : { x: 0, y: 0, fx: 0, fy: 1, moving: false, attackT: 0, invuln: 0 };
    const scale = 80;
    h.position.set(p.x, 0, p.y);
    h.scale.setScalar(scale);
    h.rotation.y = Math.atan2(p.fx, p.fy);
    const walk = p.moving ? Math.sin(t * 12) : 0;
    u.legs[0].rotation.x = walk * 0.7;
    u.legs[1].rotation.x = -walk * 0.7;
    u.arms[0].rotation.x = -walk * 0.5;
    // 공격하면 검을 든 팔을 크게 휘두른다
    u.arms[1].rotation.x = p.attackT > 0 ? -2.4 + (0.25 - Math.min(0.25, p.attackT)) * 10 : walk * 0.5 - 0.3;
    u.capePivot.rotation.x = 0.15 + (p.moving ? 0.35 + Math.abs(walk) * 0.15 : Math.sin(t * 2) * 0.05);
    h.position.y = p.moving ? Math.abs(walk) * 3 : Math.sin(t * 3) * 1;
    const hurt = p.invuln > 0 && Math.floor(t * 20) % 2 === 0;
    for (const m of u.mats) {
      if (!m.userData.baseEmissive) m.userData.baseEmissive = m.emissive.clone();
      if (hurt) m.emissive.set('#ff2020'); else m.emissive.copy(m.userData.baseEmissive);
    }
    put(R.shadow, p.x, 0.5, p.y, 0, 26, 1, 20);
  }

  function drawEnemies(G, t) {
    const px = G.p.x, py = G.p.y;
    for (const k in R.enemies) R.enemies[k].count = 0;
    for (const e of G.enemies) {
      if (e.dead || e.spawnT > 0) continue; // 차원문에서 나오는 중인 보스는 아직 그리지 않는다
      const face = Math.atan2(px - e.x, py - e.y);
      if (e.elite) {
        // 정예와 보스는 날개를 퍼덕이는 드래곤
        const pool = R.dragons[e.img] || R.dragons.enemy_elite;
        const d = pool.get(e);
        const s = e.r * 2.6;
        d.position.set(e.x, 0, e.y);
        d.scale.setScalar(s);
        d.rotation.y = e.st === 'dash' ? Math.atan2(e.dx || 0, e.dy || 1) : face;
        const flap = Math.sin(t * (e.enraged ? 10 : 6) + e.phase);
        d.userData.wings[0].rotation.z = 0.35 + flap * 0.55;
        d.userData.wings[1].rotation.z = -0.35 - flap * 0.55;
        d.userData.head.rotation.x = Math.sin(t * 3) * 0.1;
        d.position.y = 6 + flap * 3;
        const glowCol = e.flash > 0 ? (e.st === 'windup' ? '#ff2a10' : '#ffffff') : e.enraged ? '#ff2020' : null;
        for (const m of d.userData.mats) {
          if (!m.userData.baseEmissive) m.userData.baseEmissive = m.emissive.clone();
          if (glowCol) m.emissive.set(glowCol).multiplyScalar(e.flash > 0 ? 0.8 : 0.35);
          else m.emissive.copy(m.userData.baseEmissive);
        }
        put(R.shadow, e.x, 0.5, e.y, 0, e.r * 1.4, 1, e.r * 1.1);
        continue;
      }
      const def = ENEMY_MODELS[e.img];
      const mesh = R.enemies[e.img];
      if (!def || !mesh) continue;
      const s = e.r * 3.1;
      let sx = s, sy = s, y = 0;
      const ph = t * 10 + e.phase;
      if (def.fly) y = s * def.fly + Math.sin(ph) * 4;
      if (def.hop) y = Math.abs(Math.sin(ph)) * 3 * def.hop;
      if (def.squash) { const q = Math.sin(t * 7 + e.phase) * 0.12; sy = s * (1 + q); sx = s * (1 - q * 0.5); }
      let col = WHITE;
      if (e.flash > 0) col = e.ai === 'dash' && !(e.dashT > 0) ? WINDUP : FLASH;
      else if (e.slowT > 0) col = SLOW;
      const tilt = e.dashT > 0 ? -0.4 : 0;
      put(mesh, e.x, y, e.y, face, sx, sy, sx, col, tilt);
      put(R.shadow, e.x, 0.5, e.y, 0, e.r * 0.9, 1, e.r * 0.7);
    }
    for (const k in R.enemies) finish(R.enemies[k]);
  }

  function drawItems(G, t) {
    R.gem.count = 0;
    for (const g of G.gems) {
      if (g.chest) {
        const c = R.chests.get(g);
        c.position.set(g.x, 4 + Math.sin(t * 4) * 3, g.y);
        c.scale.setScalar(34);
        c.rotation.y = Math.sin(t * 1.5) * 0.4;
        putGlow(g.x, 18, g.y, 110 + Math.sin(t * 5) * 15, GOLD);
        continue;
      }
      const loot = g.loot;
      const col = loot === 'scales' ? SCALE : loot === 'stones' ? STONE : g.v >= 8 ? GEM_COLORS[8] : g.v >= 3 ? GEM_COLORS[3] : GEM_COLORS[1];
      const size = loot ? 11 : 7;
      const y = 14 + Math.sin(t * 5 + g.x * 0.05) * 3;
      put(R.gem, g.x, y, g.y, t * 2 + g.x, size * 0.8, size * 1.3, size * 0.8, col);
      putGlow(g.x, y, g.y, size * (loot ? 7 : 5), col);
    }
    finish(R.gem);
  }

  // useSprites: pixelfx가 불화살·쇠뇌·수리검을 그리면 여기서는 단검과 탄막만 그린다
  function drawProjectiles(G, t, useSprites) {
    for (const k in R.proj) R.proj[k].count = 0;
    for (const pr of G.projs) {
      const m = R.proj[pr.kind];
      if (!m || (useSprites && pr.kind !== 'dagger')) continue;
      if (pr.kind === 'bow') {
        put(m, pr.x, 26, pr.y, 0, 8, 8, 8);
        putGlow(pr.x, 26, pr.y, 46, FIRE);
      } else {
        const s = pr.kind === 'dagger' ? 30 : 42;
        put(m, pr.x, 26, pr.y, -pr.angle, s, s, s);
      }
    }
    for (const k in R.proj) finish(R.proj[k]);

    // 회전 수리검
    R.star.count = 0;
    if (G.weapons.hammer && !useSprites) {
      const s = wstats('hammer');
      for (let i = 0; i < s.count; i++) {
        const a = G.wt.hammerAngle + i * Math.PI * 2 / s.count;
        put(R.star, G.p.x + Math.cos(a) * s.radius, 28, G.p.y + Math.sin(a) * s.radius, t * 14, 34, 34, 34);
      }
    }
    finish(R.star);

    // 적의 화살과 보스 탄막
    R.bullet.count = 0;
    for (const b of G.eprojs) {
      tmpColor.set(b.color || '#ff3c3c');
      const r = b.r || 5;
      put(R.bullet, b.x, 22, b.y, 0, r * 0.75, r * 0.75, r * 0.75, WHITE);
      putGlow(b.x, 22, b.y, r * 5, tmpColor);
    }
    finish(R.bullet);
  }

  function drawZones(G, t, useSprites) {
    for (const z of G.zones) {
      if (useSprites && z.kind === 'vortex') continue; // 소용돌이는 pixelfx로
      const k = z.life / z.max; // 1 → 0
      if (z.kind === 'bolt') {
        const g = R.bolts.get(z);
        g.position.set(z.x, 0, z.y);
        g.userData.beam.scale.set(k + 0.3, 420, k + 0.3);
        g.userData.beam.material.opacity = k;
        g.userData.ring.scale.setScalar(50 + (1 - k) * 40);
        g.userData.ring.material.opacity = k;
        putGlow(z.x, 30, z.y, 160 * k, tmpColor.set('#9fd8ff'));
      } else if (z.kind === 'nova') {
        const g = R.novas.get(z);
        g.position.x = z.x; g.position.z = z.y;
        g.scale.setScalar(z.r * (1.15 - k * 0.75));
        g.userData.ring.material.opacity = k;
        g.userData.disk.material.opacity = k * 0.35;
      } else if (z.kind === 'vortex') {
        const g = R.vortexes.get(z);
        g.position.x = z.x; g.position.z = z.y;
        g.scale.setScalar(z.r * 2.6);
        g.rotation.y = t * 5;
        g.userData.m.material.opacity = Math.min(1, z.life / 0.4, (z.max - z.life) / 0.2);
      } else if (z.kind === 'slash') {
        const g = R.slashes.get(z);
        g.position.x = G.p.x; g.position.z = G.p.y;
        g.rotation.y = -z.a;
        g.scale.setScalar(z.r * (1.05 - k * 0.15));
        g.userData.m.material.opacity = Math.min(0.6, k);
      }
    }
    for (const f of G.fx) {
      const s = R.bursts.get(f);
      s.position.set(f.x, 24, f.y);
      s.scale.setScalar(f.size * (1.4 - f.life) * 1.6);
      s.material.opacity = Math.max(0, Math.min(1, f.life / 0.3));
    }
  }

  // ---------- 공개 함수 ----------
  function init(canvas) {
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      return false;
    }
    build();
    loadHeroModel();
    return true;
  }

  function resize(w, h, dpr) {
    if (!renderer) return;
    W = w; H = h;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.left = -w / 2; camera.right = w / 2;
    camera.top = h / 2; camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
  }

  let lastRender = performance.now();
  // sprites: 이번 프레임에 그릴 pixelfx 이펙트 목록 (없으면 예전 도형 효과로 그린다)
  function render(G, shakeX = 0, shakeY = 0, sprites = null) {
    frame++;
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastRender) / 1000);
    lastRender = now;
    const t = G ? G.time : now / 1000;
    setCamera((G ? G.p.x : 0) + shakeX, (G ? G.p.y : 0) + shakeY);
    R.shadow.count = 0;
    R.glow.count = 0;
    updateTheme(G, t, dt);
    drawProps(t);
    drawMotes(t);
    animateHero(G, t, dt);
    if (G) {
      drawEnemies(G, t);
      drawItems(G, t);
      drawProjectiles(G, t, !!sprites);
      drawZones(G, t, !!sprites);
    } else {
      for (const k in R.enemies) R.enemies[k].count = 0;
      for (const k in R.proj) R.proj[k].count = 0;
      R.gem.count = R.star.count = R.bullet.count = 0;
    }
    for (const k in R.dragons) R.dragons[k].sweep();
    for (const pool of [R.chests, R.bursts, R.bolts, R.novas, R.vortexes, R.slashes]) pool.sweep();
    finish(R.shadow);
    finish(R.glow);
    drawSprites(sprites || []);
    renderer.render(scene, camera);
  }

  // 월드 좌표 (x, y, 높이) → 화면 좌표. 피해 숫자·체력 바를 3D 위치에 맞춰 그릴 때 쓴다
  const _proj = new THREE.Vector3();
  function project(x, y, h = 0) {
    _proj.set(x, h, y).project(camera);
    return { x: (_proj.x + 1) / 2 * W, y: (1 - _proj.y) / 2 * H };
  }

  return { ok: true, init, resize, render, project, initSprites };
})();
