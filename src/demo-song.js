// Synthesizes a ~77s demo "symphony" with an OfflineAudioContext so the game
// is playable with zero files. Structure: strings pp → winds mf → brass ff →
// subito piano → tutti finale. Runs through the same analysis as any upload.

const SPB = 0.6; // 100 bpm
const BAR = 4 * SPB;

const CHORDS = { // Am, F, C, G
  Am: [110.0, 164.81, 220.0, 261.63, 329.63],
  F: [87.31, 174.61, 220.0, 261.63, 349.23],
  C: [130.81, 196.0, 261.63, 329.63, 392.0],
  G: [98.0, 196.0, 246.94, 293.66, 392.0],
};
const PROG = ['Am', 'F', 'C', 'G'];

function impulse(ctx, dur, decay) {
  const sr = ctx.sampleRate, len = Math.floor(sr * dur);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function tone(ctx, dest, { t, dur, freq, type = 'sawtooth', gain = 0.1, attack = 0.02, release = 0.15, cutoff = 2500, detune = 0 }) {
  const osc = ctx.createOscillator();
  osc.type = type; osc.frequency.value = freq; osc.detune.value = detune;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass'; filt.frequency.value = cutoff; filt.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setValueAtTime(gain, Math.max(t + attack, t + dur - release));
  g.gain.linearRampToValueAtTime(0, t + dur);
  osc.connect(filt); filt.connect(g); g.connect(dest);
  osc.start(t); osc.stop(t + dur + 0.05);
}

function stringsChord(ctx, dest, t, dur, chord, level) {
  for (const f of chord.slice(1, 4)) {
    for (const det of [-7, 0, 7]) {
      tone(ctx, dest, { t, dur, freq: f, gain: level * 0.35, attack: Math.min(0.5, dur * 0.3), release: 0.4, cutoff: 600 + 2600 * level, detune: det });
    }
  }
}

function celli(ctx, dest, t, dur, root, level) {
  tone(ctx, dest, { t, dur, freq: root, type: 'sawtooth', gain: level * 0.9, attack: 0.08, release: 0.25, cutoff: 500 });
  tone(ctx, dest, { t, dur, freq: root / 2, type: 'triangle', gain: level * 0.8, attack: 0.06, release: 0.25, cutoff: 300 });
}

function brassStab(ctx, dest, t, chord, level) {
  for (const f of [chord[1], chord[2], chord[3]]) {
    tone(ctx, dest, { t, dur: SPB * 0.7, freq: f, type: 'square', gain: level * 0.35, attack: 0.03, release: 0.2, cutoff: 1200 + 2400 * level });
  }
}

function windsMelody(ctx, dest, t, chord, level, step) {
  const notes = [chord[3], chord[4], chord[2] * 2, chord[3]];
  const f = notes[step % 4] * 1.0;
  tone(ctx, dest, { t, dur: SPB * 0.9, freq: f, type: 'triangle', gain: level * 0.7, attack: 0.05, release: 0.15, cutoff: 4000 });
}

function timpani(ctx, dest, t, level) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(90, t);
  osc.frequency.exponentialRampToValueAtTime(55, t + 0.35);
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(g); g.connect(dest);
  osc.start(t); osc.stop(t + 0.55);
  const noise = ctx.createBufferSource();
  noise.buffer = impulse(ctx, 0.12, 3);
  const nf = ctx.createBiquadFilter();
  nf.type = 'lowpass'; nf.frequency.value = 250;
  const ng = ctx.createGain(); ng.gain.value = level * 0.5;
  noise.connect(nf); nf.connect(ng); ng.connect(dest);
  noise.start(t);
}

export async function renderDemoSong() {
  const sr = 44100, bars = 32, dur = bars * BAR + 1.5;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const master = ctx.createGain();
  master.gain.value = 0.75;
  const conv = ctx.createConvolver();
  conv.buffer = impulse(ctx, 2.0, 2.5);
  const wet = ctx.createGain();
  wet.gain.value = 0.3;
  master.connect(ctx.destination);
  master.connect(conv); conv.connect(wet); wet.connect(ctx.destination);

  for (let bar = 0; bar < bars; bar++) {
    const t0 = 0.2 + bar * BAR;
    const chord = CHORDS[PROG[bar % 4]];
    // dynamics arc per section of the piece
    let lvl;
    if (bar < 4) lvl = 0.14;                       // intro pp strings
    else if (bar < 12) lvl = 0.3;                  // winds enter mf
    else if (bar < 20) lvl = 0.35 + 0.55 * (bar - 12) / 8; // brass crescendo → ff
    else if (bar < 24) lvl = 0.12;                 // subito piano
    else lvl = 0.75 + 0.25 * (bar - 24) / 8;       // finale ff

    stringsChord(ctx, master, t0, BAR * 0.98, chord, Math.max(0.12, lvl));
    celli(ctx, master, t0, BAR * 0.95, chord[0], lvl);
    if (bar >= 4 && bar < 20) for (let b = 0; b < 4; b++) windsMelody(ctx, master, t0 + b * SPB, chord, lvl, bar * 4 + b);
    if (bar >= 12 && bar < 20) { brassStab(ctx, master, t0, chord, lvl); brassStab(ctx, master, t0 + 2 * SPB, chord, lvl); }
    if (bar >= 24) { for (let b = 0; b < 4; b++) brassStab(ctx, master, t0 + b * SPB, chord, lvl * 0.8); for (let b = 0; b < 4; b++) windsMelody(ctx, master, t0 + b * SPB, chord, lvl, bar * 4 + b); }
    if ((bar >= 12 && bar < 20) || bar >= 24) timpani(ctx, master, t0, Math.min(1, lvl + 0.15));
    if (bar >= 28) { timpani(ctx, master, t0 + 2 * SPB, lvl); }
    // light pulse keeps the beat tracker honest in quiet bars
    for (let b = 0; b < 4; b++) tone(ctx, master, { t: t0 + b * SPB, dur: 0.08, freq: 1200, type: 'triangle', gain: 0.02 + lvl * 0.05, attack: 0.005, release: 0.05, cutoff: 3000 });
  }
  // final chord
  const tEnd = 0.2 + bars * BAR - BAR;
  timpani(ctx, master, tEnd, 1);

  return ctx.startRendering();
}
