// 배경음악 엔진과 곡 5개. 소리 파일 없이 Web Audio로 실시간 합성한다.
// BGM.attach(오디오컨텍스트, 출력노드) 뒤에 BGM.play(id) / BGM.stop()
// 이미 재생 중일 때 play(다른 곡)을 부르면 다음 마디가 시작될 때 넘어간다.
const BGM = (() => {
  let ac = null, out, rev, revGain;
  let noiseBuf = null;

  // 게임의 오디오 장치에 연결한다 (dest로 보내므로 게임의 음소거·음량을 그대로 따른다)
  function attach(context, dest) {
    if (ac) return;
    ac = context;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    out = ac.createGain();
    out.gain.value = 0.7;
    out.connect(comp).connect(dest);
    // 공간감: 잡음을 점점 줄여 만든 잔향
    rev = ac.createConvolver();
    const len = ac.sampleRate * 2.2, buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    rev.buffer = buf;
    revGain = ac.createGain();
    revGain.gain.value = 0.3;
    rev.connect(revGain).connect(out);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  // 음 이름(C4, F#5, Bb3) → MIDI 번호
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function nm(s) {
    const m = s.match(/^([A-G])(#|b)?(-?\d)$/);
    if (!m) throw new Error('음 이름 오류: ' + s);
    return NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
  }
  // 멜로디 악보: 16분음표 한 칸마다 토큰 하나. 음 이름 = 새 음, '-' = 앞 음 이어서, '.' = 쉼
  function mel(text) {
    const tok = text.trim().split(/\s+/);
    const ev = new Array(tok.length).fill(null);
    let last = null;
    tok.forEach((t, i) => {
      if (t === '-') { if (last) last.len++; return; }
      if (t === '.') { last = null; return; }
      last = { m: nm(t), len: 1 };
      ev[i] = last;
    });
    ev.steps = tok.length;
    return ev;
  }
  const chord = s => s.split(' ').map(nm);

  // ---------- 악기 ----------
  function noiseSrc(t, dur) {
    const s = ac.createBufferSource();
    s.buffer = noiseBuf;
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
    return s;
  }
  function vca(t, peak, attack, hold, release, dest = out) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(dest);
    return g;
  }
  function kick(t, v = 1) {
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(vca(t, 0.95 * v, 0.003, 0.02, 0.28));
    o.start(t); o.stop(t + 0.4);
  }
  function snare(t, v = 1, tail = 0.16) {
    const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1100;
    const g = vca(t, 0.5 * v, 0.002, 0.01, tail);
    noiseSrc(t, tail + 0.05).connect(f).connect(g);
    const sg = ac.createGain(); sg.gain.value = 0.25; g.connect(sg).connect(rev);
    const o = ac.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    o.connect(vca(t, 0.35 * v, 0.002, 0.01, 0.09));
    o.start(t); o.stop(t + 0.15);
  }
  function hat(t, v = 0.2, open = false) {
    const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    noiseSrc(t, 0.3).connect(f).connect(vca(t, v, 0.001, 0.005, open ? 0.22 : 0.04));
  }
  function crash(t, v = 0.3) {
    const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000;
    const g = vca(t, v, 0.002, 0.02, 1.4);
    noiseSrc(t, 1.5).connect(f).connect(g);
    const sg = ac.createGain(); sg.gain.value = 0.4; g.connect(sg).connect(rev);
  }
  function tom(t, midi, v = 0.8) {
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(mtof(midi), t);
    o.frequency.exponentialRampToValueAtTime(mtof(midi) * 0.55, t + 0.35);
    const g = vca(t, v, 0.003, 0.03, 0.4);
    o.connect(g); o.start(t); o.stop(t + 0.5);
    const sg = ac.createGain(); sg.gain.value = 0.3; g.connect(sg).connect(rev);
  }
  // 범용 신스: 여러 겹(unison)의 파형 → 저역 통과 필터(엔벨로프) → 볼륨 엔벨로프
  function synth(t, midi, dur, o) {
    const voices = o.voices || 1;
    const filt = ac.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = o.res || 1;
    const cut = o.cutoff || 3000;
    filt.frequency.setValueAtTime(cut * (o.envAmt || 1), t);
    filt.frequency.exponentialRampToValueAtTime(cut, t + (o.decay || 0.15));
    const release = o.release || 0.08;
    const g = vca(t, o.vol || 0.2, o.attack || 0.005, Math.max(0, dur - (o.attack || 0.005)), release);
    filt.connect(g);
    if (o.rev) { const sg = ac.createGain(); sg.gain.value = o.rev; g.connect(sg).connect(rev); }
    for (let i = 0; i < voices; i++) {
      const osc = ac.createOscillator();
      osc.type = o.type || 'sawtooth';
      osc.frequency.value = mtof(midi);
      osc.detune.value = voices > 1 ? (i / (voices - 1) - 0.5) * 2 * (o.detune || 10) : 0;
      if (o.vib) {
        // 늦게 걸리는 비브라토로 길게 끄는 음을 노래하듯
        const lfo = ac.createOscillator(), lg = ac.createGain();
        lfo.frequency.value = 5.5;
        lg.gain.setValueAtTime(0, t);
        lg.gain.linearRampToValueAtTime(o.vib, t + Math.min(0.3, dur));
        lfo.connect(lg).connect(osc.detune);
        lfo.start(t); lfo.stop(t + dur + release + 0.05);
      }
      const vg = ac.createGain(); vg.gain.value = 1 / Math.sqrt(voices);
      osc.connect(vg).connect(filt);
      osc.start(t); osc.stop(t + dur + release + 0.05);
    }
  }

  // ---------- 음색 ----------
  const SAW_BASS = { type: 'sawtooth', vol: 0.32, cutoff: 500, envAmt: 4, decay: 0.12, res: 4, release: 0.05 };
  const SUB_BASS = { type: 'triangle', vol: 0.45, cutoff: 900, release: 0.06 };
  const REESE = { type: 'sawtooth', voices: 3, detune: 18, vol: 0.34, cutoff: 380, envAmt: 2, decay: 0.4, res: 2, release: 0.12 };
  const LEAD = { type: 'sawtooth', voices: 2, detune: 8, vol: 0.13, cutoff: 3200, envAmt: 1.5, attack: 0.01, release: 0.12, vib: 18, rev: 0.25 };
  const BRASS = { type: 'sawtooth', voices: 3, detune: 10, vol: 0.13, cutoff: 1400, envAmt: 2.2, decay: 0.25, attack: 0.04, release: 0.2, vib: 14, rev: 0.35 };
  const SQUARE_LEAD = { type: 'square', vol: 0.09, cutoff: 6000, release: 0.04, vib: 10 };
  const PLUCK = { type: 'sawtooth', voices: 2, detune: 6, vol: 0.12, cutoff: 900, envAmt: 6, decay: 0.12, release: 0.25, rev: 0.4 };
  const ARP = { type: 'sawtooth', vol: 0.06, cutoff: 1800, envAmt: 3, decay: 0.08, release: 0.05, rev: 0.25 };
  const CHIP_ARP = { type: 'square', vol: 0.035, cutoff: 5000, release: 0.02 };
  const STRINGS = { type: 'sawtooth', voices: 2, detune: 7, vol: 0.07, cutoff: 2200, envAmt: 1.8, decay: 0.06, release: 0.06, rev: 0.2 };
  const PAD = { type: 'sawtooth', voices: 3, detune: 14, vol: 0.05, cutoff: 1100, attack: 0.35, release: 0.6, rev: 0.6 };
  function pad(t, notes, dur, o = PAD) { for (const n of notes) synth(t, n, dur, o); }

  // ---------- 후보곡 ----------
  const TRACKS = [
    {
      id: 'charge', no: 1, name: '결전의 질주', key: 'D 단조', bpm: 160,
      mood: '빠르고 비장한 전투곡. 질주하는 베이스 위로 영웅적인 멜로디가 치고 나가요.',
      chords: ['D4 F4 A4', 'Bb3 D4 F4', 'C4 E4 G4', 'A3 C#4 E4', 'D4 F4 A4', 'Bb3 D4 F4', 'C4 E4 G4', 'A3 C#4 E4'].map(chord),
      lead: mel(`
        A4 - D5 - F5 - A5 - - - G5 - F5 - E5 -
        F5 - - - D5 - Bb4 - - - C5 - D5 - - -
        E5 - G5 - C6 - - - Bb5 - A5 - G5 - - -
        A5 - - - E5 - C#5 - - - E5 - A5 - - -
        D6 - - - C6 - A5 - - - F5 - A5 - D6 -
        F6 - - - D6 - Bb5 - - - F5 - D5 - - -
        E5 - G5 - C6 - E6 - - - D6 - C6 - G5 -
        A5 - - - - - - - C#6 - - - E6 - - -`),
      play(i, t, d) {
        const bar = Math.floor(i / 16) % 8, s = i % 16, ch = this.chords[bar];
        if (s % 4 === 0) kick(t);
        if (s === 4 || s === 12) snare(t);
        if (s % 2 === 1) hat(t, 0.16);
        if (bar % 4 === 0 && s === 0) crash(t, 0.22);
        if (s % 2 === 0) synth(t, ch[0] - 12 + (s % 4 === 2 ? 12 : 0), d * 1.6, SAW_BASS);
        synth(t, ch[s % 3] + 12, d * 0.8, ARP);
        if (s === 0) pad(t, ch, d * 16);
        const n = this.lead[i % this.lead.steps];
        if (n) synth(t, n.m, n.len * d, LEAD);
      },
    },
    {
      id: 'neon', no: 2, name: '네온 균열', key: 'A 단조', bpm: 128,
      mood: '80년대 신스웨이브. 반짝이는 아르페지오와 울리는 스네어로 밤거리를 질주하는 느낌.',
      chords: ['A3 C4 E4', 'F3 A3 C4', 'C4 E4 G4', 'G3 B3 D4', 'A3 C4 E4', 'F3 A3 C4', 'C4 E4 G4', 'G3 B3 D4'].map(chord),
      lead: mel(`
        E5 - - - - - - - D5 - C5 - D5 - - -
        C5 - - - - - A4 - - - C5 - F5 - - -
        E5 - - - - - G5 - - - E5 - D5 - C5 -
        D5 - - - - - - - B4 - - - G4 - - -
        A5 - - - - - G5 - E5 - - - A5 - B5 -
        C6 - - - - - A5 - - - F5 - A5 - - -
        G5 - - - E5 - - - G5 - C6 - B5 - G5 -
        B5 - - - - - - - - - - - . . . .`),
      play(i, t, d) {
        const bar = Math.floor(i / 16) % 8, s = i % 16, ch = this.chords[bar];
        if (s % 4 === 0) kick(t, 0.9);
        if (s === 4 || s === 12) snare(t, 1, 0.38); // 길게 울리는 80년대 스네어
        hat(t, s % 2 ? 0.14 : 0.06);
        synth(t, ch[0] - 12 + (s % 2 ? 12 : 0), d * 0.8, SAW_BASS);
        const up = [0, 1, 2, 3, 2, 1, 0, 1];
        const k = up[s % 8];
        synth(t, (k === 3 ? ch[0] + 12 : ch[k]) + 12, d * 0.7, ARP);
        if (s === 0) pad(t, ch, d * 16);
        const n = this.lead[i % this.lead.steps];
        if (n) synth(t, n.m, n.len * d, { ...LEAD, cutoff: 2400, vib: 22 });
      },
    },
    {
      id: 'boss', no: 3, name: '보스의 그림자', key: 'C 단조', bpm: 140,
      mood: '웅장한 결전 음악. 쉬지 않는 현악 리듬과 북소리, 금관 같은 선율이 긴장감을 끌어올려요.',
      chords: ['C4 Eb4 G4', 'Ab3 C4 Eb4', 'F3 Ab3 C4', 'G3 B3 D4', 'C4 Eb4 G4', 'Ab3 C4 Eb4', 'F3 Ab3 C4', 'G3 B3 D4'].map(chord),
      lead: mel(`
        C5 - - - - - - - G4 - - - C5 - Eb5 -
        Eb5 - - - - - - - C5 - - - Ab4 - - -
        F5 - - - - - Eb5 - - - D5 - - - C5 -
        B4 - - - - - - - - - - - D5 - - -
        G5 - - - - - - - F5 - Eb5 - D5 - C5 -
        Eb5 - - - - - - - Ab5 - - - G5 - F5 -
        Ab5 - - - - - G5 - - - F5 - - - Eb5 -
        D5 - - - - - - - B4 - - - G4 - - -`),
      play(i, t, d) {
        const bar = Math.floor(i / 16) % 8, s = i % 16, ch = this.chords[bar];
        if (s === 0 || s === 8) kick(t);
        if ('x..x..x.x..x..x.'[s] === 'x') tom(t, ch[0] - 24 + (s % 3 === 0 ? 0 : 7), 0.7);
        if (s === 12) snare(t, 0.9, 0.25);
        if (bar % 4 === 0 && s === 0) crash(t, 0.3);
        const r = ch[0] + 12;
        synth(t, [r, r, ch[2], r, ch[1] + 12, r, ch[2], r][s % 8], d * 0.7, STRINGS);
        if (s === 0) synth(t, ch[0] - 24, d * 15, { ...SAW_BASS, cutoff: 300, vol: 0.28, release: 0.2 });
        if (s === 0) pad(t, ch.map(n => n - 12), d * 16, { ...PAD, vol: 0.06 });
        const n = this.lead[i % this.lead.steps];
        if (n) synth(t, n.m, n.len * d, BRASS);
      },
    },
    {
      id: 'chip', no: 4, name: '8비트 모험', key: 'E 단조', bpm: 150,
      mood: '빠른 레트로 칩튠. 쉴 새 없이 달리는 멜로디로 옛날 게임기 느낌의 신나는 긴장감.',
      chords: ['E4 G4 B4', 'C4 E4 G4', 'D4 F#4 A4', 'B3 D#4 F#4', 'E4 G4 B4', 'C4 E4 G4', 'D4 F#4 A4', 'B3 D#4 F#4'].map(chord),
      lead: mel(`
        E5 - G5 - B5 - E6 - D6 - B5 - G5 - A5 -
        G5 - - - E5 - - - C5 - E5 - G5 - C6 -
        A5 - F#5 - D5 - F#5 - A5 - D6 - C6 - A5 -
        B5 - - - - - D#6 - - - F#6 - - - - -
        E6 - D6 - B5 - G5 - A5 - B5 - G5 - E5 -
        C6 - B5 - G5 - E5 - G5 - - - C6 - E6 -
        D6 - - - A5 - F#5 - D6 - E6 - F#6 - D6 -
        D#6 - - - B5 - - - F#5 - - - B4 - - -`),
      play(i, t, d) {
        const bar = Math.floor(i / 16) % 8, s = i % 16, ch = this.chords[bar];
        if (s === 0 || s === 6 || s === 10) kick(t, 0.8);
        if (s === 4 || s === 12) snare(t, 0.7, 0.1);
        if (s % 2 === 0) hat(t, 0.1);
        if (s % 2 === 0) synth(t, ch[0] - 12 + [0, 12, 7, 12][(s / 2) % 4], d * 1.7, SUB_BASS);
        synth(t, ch[s % 3] + 12, d * 0.5, CHIP_ARP);
        const n = this.lead[i % this.lead.steps];
        if (n) synth(t, n.m, n.len * d * 0.9, SQUARE_LEAD);
      },
    },
    {
      id: 'dnb', no: 5, name: '차원 질주', key: 'F# 단조', bpm: 174,
      mood: '드럼앤베이스. 묵직하게 꿈틀대는 베이스와 아주 빠른 브레이크비트로 숨 가쁜 질주감.',
      chords: ['F#3 A3 C#4', 'D3 F#3 A3', 'A3 C#4 E4', 'E3 G#3 B3', 'F#3 A3 C#4', 'D3 F#3 A3', 'A3 C#4 E4', 'E3 G#3 B3'].map(chord),
      lead: mel(`
        C#6 - - - A5 - - - F#5 - - - - - E5 -
        F#5 - - - - - - - D5 - - - - - - -
        E5 - - - C#6 - - - B5 - A5 - - - E5 -
        G#5 - - - - - - - B5 - - - - - - -
        C#6 - - - A5 - - - F#5 - - - A5 - C#6 -
        D6 - - - - - - - A5 - - - F#5 - - -
        E5 - - - C#6 - - - B5 - A5 - - - E5 -
        G#5 - - - B5 - - - E6 - - - - - - -`),
      play(i, t, d) {
        const bar = Math.floor(i / 16) % 8, s = i % 16, ch = this.chords[bar];
        if (s === 0 || s === 10) kick(t);
        if (s === 4 || s === 12) snare(t, 1, 0.14);
        if (s === 7 || s === 15) snare(t, 0.25, 0.05); // 작은 고스트 노트
        hat(t, s % 2 ? 0.07 : 0.15);
        if (bar % 4 === 0 && s === 0) crash(t, 0.25);
        if (s === 0) synth(t, ch[0] - 24, d * 9.5, REESE);
        if (s === 10) synth(t, ch[0] - 24 + (bar % 2 ? 3 : 0), d * 5.5, REESE);
        if (s === 0) pad(t, ch, d * 16);
        const n = this.lead[i % this.lead.steps];
        if (n) synth(t, n.m, n.len * d, PLUCK);
      },
    },
  ];

  // ---------- 재생 (조금 앞서 예약해 두는 방식이라 화면이 바빠도 박자가 밀리지 않는다) ----------
  let cur = null, pending = null, step = 0, nextT = 0, timer = null;
  function schedule() {
    if (!cur) return;
    while (nextT < ac.currentTime + 0.12) {
      // 곡 바꾸기는 마디 첫 박에서 한다
      if (pending && step % 16 === 0) { cur = pending; pending = null; step = 0; }
      const d = 60 / cur.bpm / 4;
      cur.play(step, nextT, d);
      nextT += d;
      step = (step + 1) % (16 * 8);
    }
  }
  function play(id) {
    if (!ac) return;
    const t = TRACKS.find(x => x.id === id);
    if (!t) return;
    if (cur) { if (cur !== t) pending = t; return; }
    cur = t;
    pending = null;
    step = 0;
    nextT = ac.currentTime + 0.06;
    if (!timer) timer = setInterval(schedule, 25);
  }
  function stop() { cur = null; pending = null; }
  const current = () => (pending || cur || {}).id || null;

  return { TRACKS, attach, play, stop, current };
})();
