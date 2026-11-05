"""pixelfx 스프라이트 시트를 게임용 데이터(fx/fxdata.js)로 묶는다.

사용법: python tools/pack-fx.py <pixelfx 시트 폴더>
  시트 폴더는 pixelfx에서 `node tools/render.mjs <id> --sheet --out <폴더>`로 만든 것.

- 이펙트마다 쓸 프레임 구간만 고른다
- 모든 프레임에 공통인 투명 여백을 잘라 크기를 줄인다
- PNG를 base64로 JS 파일에 담는다. file://로 연 페이지에서도 WebGL 텍스처로 쓸 수 있게 하려는 것
  (브라우저는 file:// 그림 파일을 WebGL에 쓰지 못하게 막지만 data: 주소 그림은 허용한다)
"""
import base64
import io
import json
import math
import os
import sys

from PIL import Image

# 게임 안 이름: (pixelfx id, 시작 프레임, 끝 프레임(포함 안 함, None이면 끝까지))
EFFECTS = {
    'shuriken':  ('projectiles/energy-disc', 0, None),
    'fireball':  ('fire/fireball', 0, None),
    'arrow':     ('projectiles/arrow', 0, None),
    'lightning': ('lightning/lightning-strike', 10, 31),  # 번개가 내리꽂히는 구간만
    'frost':     ('ice/frost-nova', 0, None),
    'vortex':    ('shadow/void-orb', 0, None),
    'slash':     ('melee/spin-slash', 0, None),
    'hit':       ('impacts/hit-spark', 0, None),
    'bossSpawn': ('spawn/spawn-portal', 0, None),
    'levelUp':   ('ui/level-up', 0, None),
    'lvPillar':  ('holy/holy-pillar', 0, 50),             # 레벨업: 하늘에서 내리는 빛줄기 (사라지는 꼬리는 뺌)
    'lvBurst':   ('arcane/mana-burst', 0, None),          # 레벨업: 금빛 섬광과 고리 (금색 팔레트로 내보냄)
    'lvSparkle': ('pickups/collect-burst', 0, None),      # 레벨업: 십자 섬광과 반짝임
    'hurt':      ('impacts/blunt-hit', 0, None),
    'death':     ('spawn/poof', 0, None),
    'bigDeath':  ('explosions/plasma-explosion', 0, None),
}


def main(src):
    out = {}
    total = 0
    for key, (fx_id, start, end) in EFFECTS.items():
        name = fx_id.split('/')[-1]
        base = os.path.join(src, fx_id, name)
        meta = json.load(open(base + '.json', encoding='utf-8'))
        sheet = Image.open(base + '.png').convert('RGBA')
        frames = meta['frames'][start:end]
        crops = [sheet.crop((f['frame']['x'], f['frame']['y'], f['frame']['x'] + f['frame']['w'], f['frame']['y'] + f['frame']['h'])) for f in frames]

        # 모든 프레임을 겹쳤을 때 그려진 부분만 남긴다
        box = None
        for c in crops:
            b = c.getchannel('A').getbbox()
            if b:
                box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
        fw, fh = crops[0].size
        box = box or (0, 0, fw, fh)
        box = (max(0, box[0] - 1), max(0, box[1] - 1), min(fw, box[2] + 1), min(fh, box[3] + 1))
        w, h = box[2] - box[0], box[3] - box[1]

        n = len(crops)
        cols = max(1, math.ceil(math.sqrt(n * h / w)))
        rows = math.ceil(n / cols)
        atlas = Image.new('RGBA', (cols * w, rows * h))
        for i, c in enumerate(crops):
            atlas.paste(c.crop(box), ((i % cols) * w, (i // cols) * h))
        buf = io.BytesIO()
        # 픽셀 아트라 색이 적어서 256색 팔레트(투명도 포함)로 줄여도 거의 같아 보인다
        atlas.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(buf, 'PNG', optimize=True)
        data = buf.getvalue()
        total += len(data)

        px = meta['meta']['pixelfx']
        out[key] = {
            'id': fx_id,
            'w': w, 'h': h, 'n': n, 'cols': cols,
            'fps': px['fps'], 'loop': px['loop'],
            # 기준점(발밑·중심)을 잘라 낸 프레임 기준으로 옮긴다
            'px': px['pivot'][0] - box[0], 'py': px['pivot'][1] - box[1],
            'img': 'data:image/png;base64,' + base64.b64encode(data).decode('ascii'),
        }
        print(f'{key:10s} {fx_id:30s} {n:3d}f  {w}x{h}  {len(data) / 1024:6.0f} KB')

    dst = os.path.join(os.path.dirname(__file__), '..', 'fx', 'fxdata.js')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, 'w', encoding='utf-8') as f:
        f.write('// pixelfx 이펙트 (github.com/patch-gg/pixelfx, MIT) — tools/pack-fx.py로 생성\n')
        f.write('window.FX_DATA = ' + json.dumps(out, separators=(',', ':')) + ';\n')
    print(f'PNG 합계 {total / 1024:.0f} KB -> {os.path.normpath(dst)} {os.path.getsize(dst) / 1024:.0f} KB')


if __name__ == '__main__':
    main(sys.argv[1])
