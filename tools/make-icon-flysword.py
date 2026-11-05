"""'회전 비검' 아이콘(img/icon_flysword.png)을 orbit-sword 이펙트 그림으로 만든다.

사용법: python tools/make-icon-flysword.py <orbit-sword.png 시트>
  시트는 pixelfx에서 `node tools/render.mjs projectiles/orbit-sword --sheet`로 만든 것.
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

S = 128
BIG = 4  # 원과 호를 매끄럽게 그리려고 4배 크게 그린 뒤 줄인다


def sword_from_sheet(path):
    sheet = Image.open(path).convert('RGBA')
    frame = sheet.crop((0, 0, 104, 36))      # 첫 프레임
    return frame.crop((42, 7, 95, 30))      # 빛 꼬리를 빼고 검만 (자루 끝 ~ 칼끝)


def main(src):
    sword = sword_from_sheet(src)

    # 배경: 가운데가 밝은 짙은 보라
    bg = Image.new('RGBA', (S * BIG, S * BIG))
    d = ImageDraw.Draw(bg)
    for r in range(S * BIG // 2 * 15 // 10, 0, -4):
        k = r / (S * BIG * 0.75)
        c = (int(96 - 80 * k), int(38 - 30 * k), int(170 - 140 * k), 255)
        d.ellipse((S * BIG / 2 - r, S * BIG / 2 - r, S * BIG / 2 + r, S * BIG / 2 + r), fill=c)

    # 회전 궤적: 둘레를 감도는 빛의 호 세 개
    glow = Image.new('RGBA', bg.size)
    g = ImageDraw.Draw(glow)
    R = 46 * BIG
    c0 = S * BIG / 2
    for i, start in enumerate((200, 320, 80)):
        for w, col in ((34, (170, 90, 255, 140)), (14, (225, 175, 255, 230)), (5, (255, 255, 255, 255))):
            g.arc((c0 - R, c0 - R, c0 + R, c0 + R), start, start + 85, fill=col, width=w)
    glow = glow.filter(ImageFilter.GaussianBlur(BIG * 1.2))
    bg.alpha_composite(glow)
    img = bg.resize((S, S), Image.LANCZOS)

    # 궤적 위의 작은 비검 두 자루 (도는 방향을 향한다)
    for ang in (35, 155):
        a = math.radians(ang)
        small = sword.resize((int(sword.width * 1.3), int(sword.height * 1.3)), Image.NEAREST).rotate(-(ang + 90), Image.NEAREST, expand=True)
        x = int(S / 2 + math.cos(a) * 46 - small.width / 2)
        y = int(S / 2 + math.sin(a) * 46 - small.height / 2)
        faded = small.copy()
        faded.putalpha(faded.getchannel('A').point(lambda v: int(v * 0.75)))
        img.alpha_composite(faded, (x, y))

    # 가운데 큰 비검: 칼끝이 오른쪽 위를 향하게
    big = sword.resize((int(sword.width * 2.45), int(sword.height * 2.45)), Image.NEAREST).rotate(42, Image.NEAREST, expand=True)
    halo = big.getchannel('A').filter(ImageFilter.GaussianBlur(7))
    halo_img = Image.new('RGBA', big.size, (170, 100, 255, 0))
    halo_img.putalpha(halo.point(lambda v: min(255, int(v * 1.4))))
    pos = ((S - big.width) // 2, (S - big.height) // 2)
    img.alpha_composite(halo_img, pos)
    img.alpha_composite(big, pos)

    # 반짝임
    d = ImageDraw.Draw(img)
    for (x, y, n) in ((94, 26, 5), (30, 92, 4), (100, 98, 3)):
        d.line((x - n, y, x + n, y), fill=(255, 240, 255, 230))
        d.line((x, y - n, x, y + n), fill=(255, 240, 255, 230))

    out = os.path.join(os.path.dirname(__file__), '..', 'img', 'icon_flysword.png')
    img.save(out)
    print('saved', os.path.normpath(out))


if __name__ == '__main__':
    main(sys.argv[1])
