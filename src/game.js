// Scoring, playback clock, per-frame state for stage + HUD.

export const DIFFICULTIES = {
  apprentice: { label: 'Apprentice', window: 1.6, dynTol: 0.42, cueWin: 1.1, comboStep: 10 },
  kapellmeister: { label: 'Kapellmeister', window: 1.0, dynTol: 0.28, cueWin: 0.75, comboStep: 8 },
  virtuoso: { label: 'Virtuoso', window: 0.68, dynTol: 0.18, cueWin: 0.55, comboStep: 6 },
};
const JUDGE = [
  { win: 0.09, pts: 100, label: 'PERFECT', color: '#ffd76a' },
  { win: 0.17, pts: 60, label: 'GOOD', color: '#8fd18f' },
];
const BEAT_WINDOW = 0.2;
const CUE_PTS = 250;
const DYN_BONUS = 30;

const RANKS = [
  [0.95, 'Immortal Maestro', 5],
  [0.85, 'Maestro', 4],
  [0.7, 'Kapellmeister', 3],
  [0.5, 'Assistant Conductor', 2],
  [0, 'Section Rehearsal', 1],
];

export class Game {
  constructor({ baton, hud, onFinish }) {
    this.baton = baton;
    this.hud = hud;
    this.onFinish = onFinish;
    this.playing = false;
    this.inputOffset = 0; // seconds; positive shifts gestures earlier
    this.startAt = 0;     // seconds into the piece to begin (song time stays absolute)
    this.difficulty = DIFFICULTIES.kapellmeister;
    baton.onIctus = e => this.handleIctus(e);
  }

  setDifficulty(key) {
    this.difficulty = DIFFICULTIES[key] || DIFFICULTIES.kapellmeister;
  }

  setPiece(audioBuffer, analysis, choreo) {
    this.buffer = audioBuffer;
    this.analysis = analysis;
    this.choreo = choreo;
  }

  async start(audioCtx) {
    this.ctx = audioCtx;
    this.baton.onIctus = e => this.handleIctus(e); // reclaim input, whatever ran before
    await this.ctx.resume();
    // events before the start mark are 'skipped': never scored, never counted
    const off = Math.max(0, Math.min(this.startAt || 0, this.buffer.duration - 1));
    this.startOff = off;
    for (const b of this.choreo.beats) { b.state = b.t < off - 0.05 ? 'skipped' : 'pending'; b.judge = null; }
    for (const c of this.choreo.cues) c.state = c.t < off ? 'skipped' : 'pending';
    for (const p of this.choreo.phrases) {
      p.state = p.t1 <= off ? 'skipped' : 'pending'; p.early = null; p.late = null; p.sum = 0; p.n = 0;
    }
    this.phraseHits = 0;
    this.score = 0; this.combo = 0; this.maxCombo = 0;
    this.counts = { PERFECT: 0, GOOD: 0, MISS: 0 };
    this.dynHits = 0; this.cueHits = 0;
    this.lastBeatT = -9; this.lastIctusT = -9;
    this.prevLow = 0; this.timp = 0;
    this.done = false;

    this.src = this.ctx.createBufferSource();
    this.src.buffer = this.buffer;
    this.src.connect(this.ctx.destination);
    const startAt = this.ctx.currentTime + 3;
    this.src.start(startAt, off);
    this.ctxStart = startAt - off; // songTime() = position in the piece, so beats stay valid
    this.perfStart = performance.now() / 1000 + (startAt - this.ctx.currentTime);
    this.src.onended = () => { if (!this.done) this.finish(); };
    this.playing = true;
  }

  stop() {
    if (this.src) { this.src.onended = null; try { this.src.stop(); } catch {} }
    this.playing = false;
  }

  songTime() {
    return this.playing ? this.ctx.currentTime - this.ctxStart : 0;
  }

  get mult() { return 1 + Math.min(3, Math.floor(this.combo / this.difficulty.comboStep)); }

  handleIctus(e) {
    this.lastIctusT = e.t;
    if (!this.playing) return;
    const d = this.difficulty;
    const beatWin = BEAT_WINDOW * d.window;
    const t = (e.t - this.perfStart) + this.startOff - this.inputOffset;
    if (t < this.startOff - 0.5) return;
    let best = null, bestDt = beatWin + 1e-3;
    for (const b of this.choreo.beats) {
      if (b.state !== 'pending') continue;
      const dt = Math.abs(b.t - t);
      if (dt < bestDt) { bestDt = dt; best = b; }
      if (b.t - t > beatWin) break;
    }
    if (!best) return;
    const tier = JUDGE.find(j => bestDt <= j.win * d.window);
    if (!tier) return; // inside search window but outside judge windows: treat as stray
    best.state = 'hit';
    best.judge = tier.label;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.counts[tier.label]++;
    let pts = tier.pts * this.mult;
    if (Math.abs(e.amp - best.dyn) < d.dynTol) {
      pts += DYN_BONUS;
      this.dynHits++;
    }
    if (best.hit && e.amp > 0.55) {
      pts += 150;
      this.hud.judgment('SFORZANDO!', '#ff9d5c', -34); // stacked above the tier label
    }
    this.score += pts;
    this.lastBeatT = best.t;
    this.hud.judgment(tier.label, tier.color);
  }

  update() {
    if (!this.playing) return null;
    const t = this.songTime();

    const beatWin = BEAT_WINDOW * this.difficulty.window;
    for (const b of this.choreo.beats) {
      if (b.state === 'pending' && b.t < t - this.inputOffset - beatWin) {
        b.state = 'miss';
        this.counts.MISS++;
        if (this.combo > 0) this.hud.judgment('MISS', '#c25b5b');
        this.combo = 0;
      }
    }
    const cueWin = this.difficulty.cueWin;
    for (const c of this.choreo.cues) {
      if (c.state !== 'pending') continue;
      if (Math.abs(c.t - t) <= cueWin) {
        const zone = Math.min(2, Math.floor(this.baton.x * 3));
        if (zone === c.zone || this.baton.cueRaised) {
          c.state = 'hit';
          this.cueHits++;
          this.score += CUE_PTS;
          this.hud.banner(`${c.label} IN!`, c.color);
        }
      } else if (c.t + cueWin < t) {
        c.state = 'miss';
        this.hud.banner('CUE MISSED', '#888');
      }
    }

    // phrase spans: shape (crescendo/diminuendo) and silence tracking
    for (const p of this.choreo.phrases) {
      if (p.state === 'pending' && t >= p.t0) { p.state = 'active'; p.early = []; p.late = []; }
      if (p.state !== 'active') continue;
      const amp = this.baton.amp;
      p.sum += amp; p.n++;
      const frac = (t - p.t0) / (p.t1 - p.t0);
      if (frac < 0.33) p.early.push(amp);
      else if (frac > 0.67) p.late.push(amp);
      if (t < p.t1) continue;
      p.state = 'done';
      const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
      if (p.type === 'rest') {
        if (p.sum / Math.max(1, p.n) < 0.22) {
          p.hit = true; this.score += 200; this.phraseHits++;
          this.hud.banner('PERFECT SILENCE', '#9fb8e8');
        } else this.hud.banner('SHH — HOLD STILL', '#888');
      } else {
        const delta = mean(p.late) - mean(p.early);
        if (p.type === 'cresc' ? delta > 0.12 : delta < -0.12) {
          p.hit = true; this.score += 300; this.phraseHits++;
          this.hud.banner(p.type === 'cresc' ? 'CRESCENDO!' : 'DIMINUENDO!', '#e8b04b');
        } else {
          this.hud.banner(p.type === 'cresc' ? 'GROW THE SOUND…' : 'BRING IT DOWN…', '#888');
        }
      }
    }

    // stage-driving signals
    const a = this.analysis;
    const bands = [0, 1, 2, 3].map(b => t >= 0 ? a.levelAt(a.bands[b], t) : 0);
    const lowDelta = Math.max(0, bands[0] - this.prevLow);
    this.prevLow = bands[0];
    this.timp = Math.max(this.timp - 0.05, lowDelta > 0.12 ? 1 : this.timp * 0.88);
    let lastPassed = -9;
    for (const b of this.choreo.beats) { if (b.t <= t) lastPassed = b.t; else break; }
    const pulse = Math.max(0, 1 - (t - lastPassed) * 5);
    const activeCue = this.choreo.cues.find(c => t > c.t - 0.2 && t < c.t + 1.6);

    if (t > this.choreo.duration + 0.5 && !this.done) this.finish();

    return {
      t, pulse, bands, timp: Math.max(0, Math.min(1, this.timp)),
      cue: activeCue ? activeCue.section : null,
      // camera must not chase the section while its zone is still being scored,
      // and must glide home to the podium before a window opens
      cuePending: !!(activeCue && activeCue.state === 'pending'),
      cueSoon: this.choreo.cues.some(c => c.state === 'pending' && c.t - t < 3 && c.t - t > -1.2),
    };
  }

  hudView(state) {
    const b = this.baton;
    const now = performance.now() / 1000;
    if (!this.playing) {
      return {
        playing: false, trail: b.trail, batonX: b.x, batonY: b.y,
        lastIctusT: this.lastIctusT, cueHandUp: b.cueRaised, batonMode: b.mode,
      };
    }
    const t = state ? state.t : this.songTime();
    const total = this.counts.PERFECT + this.counts.GOOD + this.counts.MISS;
    let curBib = -1, nextBib = null, prevT = null, nextT = null;
    for (const bt of this.choreo.beats) {
      if (bt.t <= t) { curBib = bt.beatInBar; prevT = bt.t; }
      else { nextBib = bt.beatInBar; nextT = bt.t; break; }
    }
    const beatFrac = prevT !== null && nextT !== null
      ? Math.max(0, Math.min(1, (t - prevT) / (nextT - prevT))) : 0;
    return {
      meter: this.choreo.meter,
      curBib, nextBib, beatFrac,
      playing: true, t,
      duration: this.choreo.duration,
      beats: this.choreo.beats,
      cues: this.choreo.cues,
      phrases: this.choreo.phrases,
      score: this.score, combo: this.combo, mult: this.mult,
      acc: total ? (this.counts.PERFECT + 0.6 * this.counts.GOOD) / total : null,
      bpm: this.choreo.bpm,
      dynTarget: this.choreo.dynAt(Math.max(0, t)),
      amp: b.amp,
      trail: b.trail, batonX: b.x, batonY: b.y,
      lastBeatT: this.lastBeatT, lastIctusT: this.lastIctusT,
      trackingLost: b.mode !== 'mouse' && !b.tracking,
      batonMode: b.mode,
      cueHandUp: b.cueRaised,
      countdown: t - this.startOff < -0.2 ? String(Math.ceil(this.startOff - t))
        : (t - this.startOff < 0.35 ? 'MAESTRO!' : null),
    };
  }

  finish() {
    this.done = true;
    this.playing = false;
    for (const b of this.choreo.beats) {
      if (b.state === 'pending') { b.state = 'miss'; this.counts.MISS++; }
    }
    const total = this.choreo.beats.filter(b => b.state !== 'skipped').length || 1;
    const acc = (this.counts.PERFECT + 0.6 * this.counts.GOOD) / total;
    const rank = RANKS.find(r => acc >= r[0]);
    this.onFinish({
      score: this.score,
      acc,
      counts: this.counts,
      maxCombo: this.maxCombo,
      cueHits: this.cueHits,
      cueTotal: this.choreo.cues.filter(c => c.state !== 'skipped').length,
      dynHits: this.dynHits,
      phraseHits: this.phraseHits,
      phraseTotal: this.choreo.phrases.filter(p => p.state !== 'skipped').length,
      rank: rank[1],
      stars: rank[2],
      difficulty: this.difficulty.label,
    });
  }
}
