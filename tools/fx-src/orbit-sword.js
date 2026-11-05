import { PAL, ramp, fit, at, cycle, sparkle, TAU } from "../../core/index.js";

const STEEL = ["#1c1e2a", "#3a3e52", "#6a7088", "#a3aac4", "#d9def2", "#ffffff"];
const GOLD = ["#3a2408", "#86520c", "#c48412", "#f0b424", "#ffe066", "#fff6c4"];
const LEATHER = ["#1e0f08", "#4a2c1c", "#7a4a2c"];

export const meta = {
  name: "Orbit sword",
  desc: "A spectral longsword flying point-first: a rune pulses down its fuller, a glint runs along the edge, ribbons of light stream off the hilt and shed sparks.",
  tags: ["projectile", "sword", "blade", "orbit", "loop"],
  size: [104, 36],
  origin: [64, 18],
  duration: 0.8,
  loop: true,
  fps: 30,
  bg: "dark",
  options: { palette: PAL.arcane, steel: STEEL, gold: GOLD, seed: 1 },
};

export function draw(p, t, o) {
  const C = ramp(o.palette), S = fit(o.steel, 6), G = fit(o.gold, 6), L = fit(LEATHER, 3);
  const top = C[C.length - 1], ph = t / meta.duration;
  const y = Math.round(Math.sin(ph * TAU) * 0.6);

  // 빛 리본: 손잡이 뒤로 세 갈래가 물결치며 흐려진다
  for (let r = 0; r < 3; r++) {
    for (let x = -16; x > -60; x--) {
      const u = (-16 - x) / 44;
      const wave = Math.sin(x * 0.22 + ph * TAU * 2 + r * 2.1) * u * 3.5;
      const a = (1 - u) * (r === 1 ? 0.85 : 0.45);
      p.blend(x, y + (r - 1) * 2 + wave, at(C.slice(2), 1 - u), a);
    }
  }
  p.glowLine(-58, y, -14, y, 6, C[4], 0.22);

  // 리본에서 떨어지는 불꽃
  cycle(t, meta.duration, 12, o.seed, 0.45, (age, life, r) => {
    const k = age / life;
    const x = -14 - k * r.range(26, 46), yy = y + r.range(-3, 3) + k * r.range(-7, 7);
    p.dot(x, yy, k < 0.35 ? top : C[4], 1 - k);
    p.light(x, yy, C[4], 0.25 * (1 - k));
  });

  // 칼날: 위 절반은 밝게, 아래는 어둡게, 끝은 뾰족하게
  p.glowLine(-6, y, 26, y, 9, C[4], 0.12);
  p.poly([[-6, y - 3], [18, y - 3], [28, y], [18, y + 3], [-6, y + 3]], S[1]);
  p.poly([[-6, y - 3], [18, y - 3], [28, y], [-6, y]], S[3]);
  p.line(-6, y - 3, 18, y - 3, S[5]);
  p.line(18, y - 3, 28, y, S[4]);
  p.line(-6, y + 3, 18, y + 3, S[0]);
  p.line(18, y + 3, 28, y, S[0]);
  p.line(-6, y + 1, 17, y + 1, S[2]);

  // 칼날 가운데 홈의 룬이 숨 쉬듯 빛난다
  const pulse = 0.55 + 0.45 * Math.sin(ph * TAU * 2);
  p.line(-3, y, 15, y, at(C.slice(3), pulse));
  for (let x = -1; x <= 13; x += 4) p.px(x, y, top); // 룬 마디
  p.glowLine(-3, y, 15, y, 3, C[5], 0.3 * pulse);

  // 코등이(금, 양끝이 칼날 쪽으로 휜다), 가죽 손잡이, 보석 박힌 자루 끝
  p.rect(-9, y - 6, 3, 13, G[2]);
  p.line(-9, y - 6, -9, y + 6, G[4]);
  p.line(-7, y - 6, -7, y + 6, G[1]);
  p.px(-7, y - 7, G[3]); p.px(-6, y - 8, G[4]);
  p.px(-7, y + 7, G[3]); p.px(-6, y + 8, G[2]);
  p.px(-8, y, top);
  p.light(-8, y, C[4], 0.5);
  p.rect(-17, y - 1, 8, 3, L[1]);
  for (let x = -16; x <= -10; x += 2) p.px(x, y - 1, L[2]);
  p.circle(-19, y + 0.5, 2.5, G[3]);
  p.px(-20, y - 1, G[5]);
  p.px(-19, y + 1, top);

  // 칼날을 따라 달리는 반짝임
  const gx = -6 + ((ph * 1.25) % 1) * 46;
  if (gx < 27) sparkle(p, gx, y - 3, 3, 0xffffff, top, 0.7);
}
