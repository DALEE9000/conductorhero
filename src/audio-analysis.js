// Offline audio analysis: beats, tempo, dynamics, band energies, section cues.

export class FFT {
  constructor(n) {
    this.n = n;
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
      this.rev[i] = r;
    }
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos(-2 * Math.PI * i / n);
      this.sin[i] = Math.sin(-2 * Math.PI * i / n);
    }
  }
  forward(re, im) {
    const { n, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const k = j * step, a = i + j, b = a + half;
          const tre = re[b] * cos[k] - im[b] * sin[k];
          const tim = re[b] * sin[k] + im[b] * cos[k];
          re[b] = re[a] - tre; im[b] = im[a] - tim;
          re[a] += tre; im[a] += tim;
        }
      }
    }
  }
}

function downmix(buffer) {
  const n = buffer.length, chs = buffer.numberOfChannels;
  const out = new Float32Array(n);
  for (let c = 0; c < chs; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i] / chs;
  }
  return out;
}

function normalizeToPercentile(v, p) {
  const s = Float32Array.from(v).sort();
  const ref = s[Math.min(s.length - 1, Math.floor(s.length * p))];
  const inv = ref > 1e-9 ? 1 / ref : 0;
  for (let i = 0; i < v.length; i++) v[i] = Math.min(1.5, v[i] * inv);
}

// subtract local mean so quiet passages still show onsets
function adaptiveNormalize(v, w) {
  const n = v.length, out = new Float32Array(n);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + v[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
    out[i] = Math.max(0, v[i] - (pre[b] - pre[a]) / (b - a));
  }
  normalizeToPercentile(out, 0.98);
  return out;
}

function zeroPhaseSmooth(v, w) {
  const a = 1 / Math.max(1, w);
  const out = Float32Array.from(v);
  let m = out[0];
  for (let i = 0; i < out.length; i++) { m += a * (out[i] - m); out[i] = m; }
  m = out[out.length - 1];
  for (let i = out.length - 1; i >= 0; i--) { m += a * (out[i] - m); out[i] = m; }
  return out;
}

function estimateTempo(env, hopSec) {
  const minLag = Math.max(2, Math.round(60 / 200 / hopSec));
  const maxLag = Math.min(env.length - 1, Math.round(60 / 55 / hopSec));
  let best = -1, bestLag = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < env.length - lag; i++) s += env[i] * env[i + lag];
    const bpm = 60 / (lag * hopSec);
    s *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 115) / 0.9, 2));
    if (s > best) { best = s; bestLag = lag; }
  }
  return { bpm: 60 / (bestLag * hopSec), periodFrames: bestLag };
}

// Ellis-style dynamic-programming beat tracker
function trackBeats(env, period) {
  const n = env.length, tight = 100;
  const score = new Float32Array(n);
  const from = new Int32Array(n).fill(-1);
  const lo = Math.max(1, Math.floor(period / 2)), hi = Math.ceil(period * 2);
  for (let i = 0; i < n; i++) {
    let best = 0, bi = -1;
    const j1 = i - lo;
    for (let j = Math.max(0, i - hi); j <= j1; j++) {
      const l = Math.log((i - j) / period);
      const s = score[j] - tight * l * l;
      if (s > best) { best = s; bi = j; }
    }
    score[i] = env[i] + best;
    from[i] = bi;
  }
  let end = n - 1;
  for (let i = Math.max(0, n - hi); i < n; i++) if (score[i] > score[end]) end = i;
  const beats = [];
  for (let i = end; i >= 0; i = from[i]) {
    beats.push(i);
    if (from[i] < 0) break;
  }
  beats.reverse();
  return beats;
}

const BAND_SECTION = ['celli', 'winds', 'brass', 'violins']; // low → high frequency

function snapToBeat(events, beats) {
  for (const c of events) {
    let best = null, bd = 1.2; // nearest beat, not next — detection always lags the entry
    for (const t of beats) {
      const d = Math.abs(t - c.t);
      if (d < bd) { bd = d; best = t; }
      if (t > c.t + 1.2) break;
    }
    if (best !== null) c.t = best;
  }
  return events.filter(c => c.t > 2);
}

// structural boundaries: ≥3 bands rising out of quiet together = tutti entry
function findTutti(bands, hopSec) {
  const n = bands[0].length;
  const step = Math.round(0.25 / hopSec);
  const look = Math.round(2.2 / hopSec), guard = Math.round(0.75 / hopSec); // guard must clear smoothing smear
  const out = [];
  let last = -99;
  for (let i = look; i < n; i += step) {
    let rising = 0;
    for (const e of bands) {
      if (e[i] < 0.5) continue;
      let prevMax = 0;
      for (let j = i - look; j < i - guard; j++) if (e[j] > prevMax) prevMax = e[j];
      if (prevMax < 0.25) rising++;
    }
    const t = i * hopSec;
    if (rising >= 3 && t - last > 12) { out.push({ t, section: 'tutti' }); last = t; }
  }
  return out;
}

function findCues(bands, hopSec, beats) {
  const cues = [], last = {};
  // zero-phase smoothing smears an entry ~0.4 s backward; guard must clear it
  const lookback = Math.round(1.8 / hopSec), guard = Math.round(0.5 / hopSec);
  for (let b = 0; b < bands.length; b++) {
    const e = bands[b], sec = BAND_SECTION[b];
    for (let i = lookback; i < e.length; i++) {
      if (e[i] < 0.55) continue;
      const t = i * hopSec;
      if (t - (last[sec] ?? -99) < 8) continue;
      let prevMax = 0;
      for (let j = i - lookback; j < i - guard; j++) if (e[j] > prevMax) prevMax = e[j];
      if (prevMax < 0.18) { cues.push({ t, section: sec }); last[sec] = t; }
    }
  }
  cues.sort((a, b) => a.t - b.t);
  const out = [];
  for (const c of cues) if (!out.length || c.t - out[out.length - 1].t > 2.5) out.push(c);
  return snapToBeat(out, beats);
}

// expressive contour: crescendo/diminuendo arcs, silences, sforzando peaks
function findPhrases(dyn, env, hopSec, duration) {
  const spans = [];
  const w = Math.round(4 / hopSec), step = Math.round(1 / hopSec);
  let cur = null;
  for (let i = 0; i + w < dyn.length; i += step) {
    const d = dyn[i + w] - dyn[i];
    const type = d > 0.22 ? 'cresc' : d < -0.22 ? 'dim' : null;
    if (type) {
      const t0 = i * hopSec, t1 = (i + w) * hopSec;
      if (cur && cur.type === type && t0 <= cur.t1) cur.t1 = t1;
      else { if (cur) spans.push(cur); cur = { type, t0, t1 }; }
    }
  }
  if (cur) spans.push(cur);
  // a swell reads as cresc then dim with the 4s window straddling the peak —
  // clip overlaps so contradictory hairpins never run simultaneously
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].t0 < spans[i - 1].t1) spans[i].t0 = spans[i - 1].t1;
  }
  for (let i = spans.length - 1; i >= 0; i--) {
    if (spans[i].t1 - spans[i].t0 < 1.5) spans.splice(i, 1);
  }
  let r0 = null;
  for (let i = 0; i <= dyn.length; i++) {
    if (i < dyn.length && dyn[i] < 0.12) { r0 ??= i; continue; }
    if (r0 !== null) {
      const t0 = r0 * hopSec, t1 = i * hopSec;
      if (t1 - t0 >= 1.2 && t0 > 2 && t1 < duration - 1.5) spans.push({ type: 'rest', t0, t1 });
      r0 = null;
    }
  }
  const hits = [];
  let lastHit = -9;
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] > 1.15 && env[i] >= env[i - 1] && env[i] >= env[i + 1]) {
      const t = i * hopSec;
      if (t - lastHit > 3) { hits.push(t); lastHit = t; }
    }
  }
  // a hairpin rising out of (or sinking into) silence must not overlap the rest
  const restsOnly = spans.filter(s => s.type === 'rest');
  for (const sp of spans) {
    if (sp.type === 'rest') continue;
    for (const r of restsOnly) {
      if (sp.t0 < r.t1 && sp.t1 > r.t0) {
        if (sp.t0 >= r.t0) sp.t0 = r.t1;
        else sp.t1 = Math.min(sp.t1, r.t0);
      }
    }
  }
  return { spans: spans.filter(s => s.t0 > 1 && s.t1 - s.t0 > 1.2).sort((a, b) => a.t0 - b.t0), hits };
}

export async function analyzeAudio(buffer, onProgress = () => {}) {
  let x = downmix(buffer), sr = buffer.sampleRate;
  while (sr > 30000) { // beats live below 8 kHz; halving speeds the FFT pass 2x
    const h = new Float32Array(Math.floor(x.length / 2));
    for (let i = 0; i < h.length; i++) h[i] = (x[2 * i] + x[2 * i + 1]) * 0.5;
    x = h; sr /= 2;
  }
  const win = 1024, hop = 256, hopSec = hop / sr;
  if (x.length < win + hop) { // shorter than one frame: nothing to analyze
    onProgress(1);
    return {
      duration: buffer.duration, hopSec, bpm: 0, beats: [], phase: 0, meter: 4,
      dyn: new Float32Array(1), bands: [0, 1, 2, 3].map(() => new Float32Array(1)),
      cues: [], phrases: [], hits: [], artic: new Float32Array(1), levelAt: () => 0,
    };
  }
  const nFrames = Math.max(1, Math.floor((x.length - win) / hop));
  const fft = new FFT(win);
  const hann = new Float32Array(win);
  for (let i = 0; i < win; i++) hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (win - 1)));
  const re = new Float32Array(win), im = new Float32Array(win);
  let prevMag = new Float32Array(win / 2), mag = new Float32Array(win / 2);
  const flux = new Float32Array(nFrames), rms = new Float32Array(nFrames);
  const bandDefs = [[30, 150], [150, 500], [500, 2000], [2000, 8000]];
  const binHz = sr / win;
  const bandBins = bandDefs.map(([a, b]) =>
    [Math.max(1, Math.round(a / binHz)), Math.min(win / 2 - 1, Math.round(b / binHz))]);
  const bands = bandDefs.map(() => new Float32Array(nFrames));

  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    let e = 0;
    for (let i = 0; i < win; i++) {
      const v = x[off + i];
      re[i] = v * hann[i]; im[i] = 0; e += v * v;
    }
    rms[f] = Math.sqrt(e / win);
    fft.forward(re, im);
    let fl = 0;
    for (let k = 1; k < win / 2; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      mag[k] = m;
      const d = m - prevMag[k];
      if (d > 0) fl += d;
    }
    flux[f] = fl;
    for (let b = 0; b < bands.length; b++) {
      let s = 0;
      const [k0, k1] = bandBins[b];
      for (let k = k0; k <= k1; k++) s += mag[k] * mag[k];
      bands[b][f] = s;
    }
    const t = prevMag; prevMag = mag; mag = t;
    if ((f & 511) === 511) {
      onProgress(0.05 + 0.75 * f / nFrames);
      await new Promise(r => setTimeout(r));
    }
  }

  const env = adaptiveNormalize(flux, Math.round(0.5 / hopSec));
  const { bpm, periodFrames } = estimateTempo(env, hopSec);
  const beatFrames = trackBeats(env, periodFrames);
  const offset = win / sr / 2;
  const beats = beatFrames.map(f => f * hopSec + offset);
  onProgress(0.9);

  // meter: which grouping (2, 3, 4) maximizes accent contrast on its downbeats
  let meter = 4, phase = 0, bestC = -Infinity;
  for (const M of [2, 3, 4]) {
    for (let p = 0; p < M; p++) {
      let sOn = 0, nOn = 0, sOff = 0, nOff = 0;
      for (let i = 0; i < beatFrames.length; i++) {
        const v = env[beatFrames[i]];
        if ((i - p) % M === 0) { sOn += v; nOn++; } else { sOff += v; nOff++; }
      }
      const c = (nOn ? sOn / nOn : 0) - (nOff ? sOff / nOff : 0) + (M === 4 ? 0.02 : 0);
      if (c > bestC) { bestC = c; meter = M; phase = p; }
    }
  }

  const dyn = zeroPhaseSmooth(rms, Math.round(0.35 / hopSec));
  normalizeToPercentile(dyn, 0.97);
  const bandsN = bands.map(b => {
    const s = zeroPhaseSmooth(b, Math.round(0.2 / hopSec));
    normalizeToPercentile(s, 0.95);
    return s;
  });
  const { spans: phrases, hits } = findPhrases(dyn, env, hopSec, buffer.duration);
  // articulation: how onset-y the moment is; low = legato, high = marcato
  const artic = zeroPhaseSmooth(env, Math.round(0.6 / hopSec));
  const sectionCues = findCues(bandsN, hopSec, beats);
  // threshold-crossing + stride sample the entry ~0.4 s after it happens
  const tutti = snapToBeat(findTutti(bandsN, hopSec).map(c => ({ ...c, t: c.t - 0.4 })), beats);
  // a tutti boundary outranks per-section cues near it
  const cues = [...tutti, ...sectionCues.filter(c => !tutti.some(q => Math.abs(q.t - c.t) < 2.5))]
    .sort((a, b) => a.t - b.t);
  onProgress(1);

  const levelAt = (arr, t) => {
    const f = (t - offset) / hopSec, i = Math.floor(f);
    if (i < 0) return arr[0];
    if (i >= arr.length - 1) return arr[arr.length - 1];
    const u = f - i;
    return arr[i] * (1 - u) + arr[i + 1] * u;
  };
  return {
    duration: buffer.duration, hopSec, bpm, beats, phase, meter, dyn,
    bands: bandsN, cues, phrases, hits, artic, levelAt,
  };
}
