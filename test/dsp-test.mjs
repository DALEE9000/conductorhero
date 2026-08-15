// Node self-check for the analysis pipeline: synthetic 120 BPM click+chord track
// must yield ~120 BPM, beats within 40 ms of the grid, sane dynamics, and a cue.
import { analyzeAudio } from '../src/audio-analysis.js';
import { buildChoreography } from '../src/choreography.js';

const sr = 44100, dur = 40, spb = 0.5; // 120 bpm
const data = new Float32Array(sr * dur);
for (let b = 0; b * spb < dur - 1; b++) {
  const t0 = Math.round(b * spb * sr);
  const accent = b % 4 === 0 ? 1.6 : 1; // downbeat accent → meter detection
  const loud = (b * spb > 20 ? 1 : 0.3) * accent;
  for (let i = 0; i < 2000; i++) { // click: decaying noise burst
    data[t0 + i] += (Math.sin(i * 0.9) + Math.sin(i * 0.37)) * 0.4 * loud * Math.exp(-i / 400);
  }
  if (b * spb > 20) { // "brass" enters: sustained 600 Hz — should fire a cue
    for (let i = 0; i < sr * spb * 0.9; i++) data[t0 + i] += 0.25 * Math.sin(2 * Math.PI * 600 * (i / sr));
  }
}
const buffer = {
  length: data.length, sampleRate: sr, duration: dur, numberOfChannels: 1,
  getChannelData: () => data,
};

const a = await analyzeAudio(buffer);
const c = buildChoreography(a);

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok:', msg); };

assert(Math.abs(a.bpm - 120) < 3 || Math.abs(a.bpm - 60) < 2 || Math.abs(a.bpm - 240) < 5,
  `tempo ~120 (or octave), got ${a.bpm.toFixed(1)}`);
const period = 60 / (Math.abs(a.bpm - 60) < 2 ? 60 : Math.abs(a.bpm - 240) < 5 ? 240 : 120);
let maxErr = 0;
for (const t of a.beats.slice(2, -2)) {
  const err = Math.abs(t / period - Math.round(t / period)) * period;
  if (err > maxErr) maxErr = err;
}
assert(maxErr < 0.045, `beats on grid, max error ${(maxErr * 1000).toFixed(0)} ms`);
assert(a.beats.length > 30, `enough beats (${a.beats.length})`);
const dynEarly = c.dynAt(10), dynLate = c.dynAt(30);
assert(dynLate > dynEarly + 0.15, `dynamics rise across crescendo (${dynEarly.toFixed(2)} → ${dynLate.toFixed(2)})`);
assert(a.cues.some(q => Math.abs(q.t - 20) < 4), `cue near the 20 s entry (got ${a.cues.map(q => q.t.toFixed(1) + ':' + q.section).join(', ') || 'none'})`);
assert(a.cues.some(q => q.section === 'tutti' && Math.abs(q.t - 20) < 4), 'multi-band entry detected as tutti');
// downbeats must land on the accent grid (every 4*spb = 2.0 s), wherever the
// tracker started counting
const dbErrs = a.beats
  .map((t, i) => ({ t, i }))
  .filter(({ i }) => ((i - a.phase) % a.meter + a.meter) % a.meter === 0)
  .slice(2, -2)
  .map(({ t }) => Math.abs(t / (4 * spb) - Math.round(t / (4 * spb))) * 4 * spb);
assert((a.meter === 4 || a.meter === 2) && dbErrs.length > 4 && Math.max(...dbErrs) < 0.06,
  `downbeats on accent grid (meter=${a.meter}, max err ${(Math.max(...dbErrs) * 1000).toFixed(0)} ms)`);
assert(a.phrases.some(p => p.type === 'cresc' && p.t0 > 14 && p.t0 < 24),
  `crescendo phrase found near the 20 s swell (got ${a.phrases.map(p => `${p.type}@${p.t0.toFixed(0)}-${p.t1.toFixed(0)}`).join(', ') || 'none'})`);
console.log(`bpm=${a.bpm.toFixed(1)} beats=${a.beats.length} cues=${a.cues.length}`);

// sub-window audio must return a clean empty analysis, not NaNs
const tiny = new Float32Array(500);
const tinyA = await analyzeAudio({ length: 500, sampleRate: sr, duration: 500 / sr, numberOfChannels: 1, getChannelData: () => tiny });
assert(tinyA.beats.length === 0 && Number.isFinite(tinyA.levelAt(tinyA.dyn, 0)), 'short audio yields empty analysis');
