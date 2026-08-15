// Baton input: webcam hand tracking (MediaPipe HandLandmarker) or mouse.
// Emits ictus events (bottom of a down-stroke = the beat) with stroke amplitude.

const TASKS = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
// blob-scan resolution: 160x120 made a pen tip ~3px wide and downscale-blurred
// its color below the chroma gate; 320x240 keeps a taped tip a solid patch
const SW = 320, SH = 240;

export class Baton {
  constructor() {
    this.mode = 'mouse';
    this.x = 0.5; this.y = 0.5;
    this.amp = 0;
    this.trail = [];
    this.tracking = false;
    this.onIctus = null;
    this.armThresh = 0.5; // down-stroke speed (screen-heights/s) that arms an ictus
    this.cueRaised = false; // left hand held up-left = section cue gesture
    this.detFps = 0;
    this.camFps = 0;    // camera frames arriving (diagnostic: 0 = no feed at all)
    this.lum = -1;      // mean frame luminance 0-255 (diagnostic: dark room)
    this.landmarks = []; // last hand landmarks (calibration overlay)
    this.lastErr = '';  // last tracker exception (calibration overlay)
    this.lastPeak = 0;
    this._detT = [];
    this._camT = [];
    this._errN = 0;
    this._hist = [];
    this._vy = 0;
    this._peakVy = 0;
    this._cueSince = 0;
    this._cueLast = 0;
    this._batonFrame = 0;
    this._bx = null; this._by = null; // smoothed blob position
    this._cx = SW / 2; this._cy = SH / 2; // last blob centroid, canvas px
    this._lastIctus = -1;
    this._lostAt = -9;
    this._lm = null;
    this._lastVideoTime = -1;
  }

  async start(mode, video) {
    this.mode = mode;
    this._lost(); // stale history from a previous run must not feed the far-hand guard
    this._farSince = 0;
    // camera strokes read slower than mouse flicks; calibration overrides this,
    // clamped so a stale/over-eager calibration can never make input unreachable
    // 'ch-sens2-': v1 values were measured against smoothed (halved) velocities
    // and would be hair-triggers now — versioned key retires them
    const maxSens = mode === 'mouse' ? 0.6 : 0.45;
    this.armThresh = Math.min(maxSens,
      Number(localStorage.getItem('ch-sens2-' + mode) ?? (mode === 'mouse' ? 0.5 : 0.35)));
    this._quietT = performance.now() / 1000;
    if (mode === 'mouse') {
      if (!this._mouseBound) {
        this._mouseBound = true;
        addEventListener('pointermove', e => {
          if (this.mode !== 'mouse') return;
          this._push(performance.now() / 1000, e.clientX / innerWidth, e.clientY / innerHeight);
        });
      }
      this.tracking = true;
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    this.stopCamera(); // never orphan a previously attached stream
    video.srcObject = stream;
    this._video = video;
    if (!this._cv) { // blob scan (baton) + luminance diagnostic (both modes)
      this._cv = document.createElement('canvas');
      this._cv.width = SW; this._cv.height = SH;
      this._cctx = this._cv.getContext('2d', { willReadFrequently: true });
    }
    try {
      if (mode === 'baton') { // color-blob tracking of a pen/baton tip
        const stored = localStorage.getItem('ch-baton-color');
        this._tipColor = stored ? JSON.parse(stored) : null;
        await video.play();
        // hand tracker still wanted (low cadence) for left-hand cues; non-blocking
        if (!this._lm) this._createLandmarker().then(lm => { this._lm = lm; }).catch(() => {});
        return;
      }
      await video.play();
      if (!this._lm) this._lm = await this._createLandmarker();
    } catch (err) {
      this.stopCamera(); // don't leave the webcam running if init fails
      throw err;
    }
  }

  async _createLandmarker(delegate = 'GPU') {
    const { FilesetResolver, HandLandmarker } = await import(`${TASKS}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${TASKS}/wasm`);
    this._delegate = delegate;
    try {
      return await this._buildLandmarker(HandLandmarker, files, delegate);
    } catch (err) {
      if (delegate === 'CPU') throw err;
      console.warn('[vision] GPU hand tracker failed, using CPU:', err.message || err);
      this._delegate = 'CPU';
      return this._buildLandmarker(HandLandmarker, files, 'CPU');
    }
  }

  // tracker threw on every frame (GPU delegate can die at runtime, not just at
  // creation) — rebuild once on CPU instead of silently returning nothing forever
  _detect(v) {
    try {
      const res = this._lm.detectForVideo(v, performance.now());
      this._errN = 0;
      return res;
    } catch (err) {
      const msg = String(err.message || err);
      if (msg !== this.lastErr) console.warn('[vision] hand tracker error:', msg);
      this.lastErr = msg;
      if (++this._errN === 20 && this._delegate === 'GPU' && !this._rebuilding) {
        this._rebuilding = true;
        this._createLandmarker('CPU').then(lm => { this._lm = lm; this.lastErr = ''; })
          .catch(() => {}).finally(() => { this._rebuilding = false; });
      }
      return null;
    }
  }

  _buildLandmarker(HandLandmarker, files, delegate) {
    return HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 2, // baton hand + a raised cue hand
      // defaults (0.5) drop the hand during fast strokes — exactly when it matters
      minHandDetectionConfidence: 0.3,
      minHandPresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
  }

  // new camera frame? counts feed fps and samples luminance twice a second
  _newFrame(now) {
    const v = this._video;
    if (!v || v.readyState < 2 || v.currentTime === this._lastVideoTime) return false;
    this._lastVideoTime = v.currentTime;
    this._camT.push(now);
    while (this._camT.length && now - this._camT[0] > 2) this._camT.shift();
    this.camFps = this._camT.length / 2;
    this._nf = (this._nf | 0) + 1;
    if (this.mode === 'baton' || this._nf % 15 === 0) {
      this._cctx.drawImage(v, 0, 0, SW, SH);
      this._frame = this._cctx.getImageData(0, 0, SW, SH).data;
      let sum = 0;
      for (let i = 0; i < this._frame.length; i += 64) sum += this._frame[i] + this._frame[i + 1] + this._frame[i + 2];
      this.lum = sum / (this._frame.length / 64) / 3;
    }
    return true;
  }

  update() { // call once per rAF; camera modes poll their tracker
    if (this.mode === 'baton') return this._updateBaton();
    if (this.mode !== 'camera' || !this._lm || !this._video) return;
    const now = performance.now() / 1000;
    if (!this._newFrame(now)) return;
    const res = this._detect(this._video);
    if (!res) return;
    this._detT.push(now);
    while (this._detT.length && now - this._detT[0] > 2) this._detT.shift();
    this.detFps = this._detT.length / 2;
    const all = res.landmarks || [];
    this.landmarks = all;
    if (all.length) {
      // lone far-away hand while we have a baton lock = the raised cue hand
      // showing while the fast-moving baton hand dropped out — adopting it would
      // transfer the lock permanently (distance heuristic then self-reinforces)
      if (all.length === 1 && this._hist.length >= 2) {
        const d = Math.hypot(1 - all[0][8].x - this.x, all[0][8].y - this.y);
        // scale the gate by the detection gap: at low fps the baton hand itself
        // legitimately travels far between detections — don't freeze it mid-stroke
        const gapDt = now - this._hist[this._hist.length - 1].t;
        if (d > Math.min(0.55, 0.25 + 2.5 * Math.max(0, gapDt - 1 / 30))) {
          this._farSince ||= now;
          if (now - this._farSince > 0.7) { this._lost(); this._farSince = 0; return; }
          this._updateCueRaised(now, all[0][0].y < this.y - 0.12 && all[0][0].y < 0.6);
          return; // keep the baton where it was; don't teleport onto this hand
        }
      }
      this._farSince = 0;
      // baton hand = the one nearest the previous baton position; fresh start → lower hand
      let bi = 0;
      if (all.length > 1) {
        if (this._hist.length >= 2) {
          let bd = 1e9;
          all.forEach((lm, i) => {
            const d = Math.hypot(1 - lm[8].x - this.x, lm[8].y - this.y);
            if (d < bd) { bd = d; bi = i; }
          });
        } else {
          bi = all[0][0].y >= all[1][0].y ? 0 : 1;
        }
      }
      const lms = all[bi];
      this.tracking = true;
      // fingertip for pointing/trail, wrist for velocity — the wrist survives
      // motion blur during fast strokes, the fingertip often doesn't
      const tip = lms[8], wrist = lms[0];
      this._push(now, 1 - tip.x, tip.y, wrist.y);
      let raised = false;
      const batonWristY = lms[0].y;
      all.forEach((lm, i) => {
        if (i === bi) return;
        // raised = clearly above the conducting hand, wherever the camera is framed
        if (lm[0].y < batonWristY - 0.12 && lm[0].y < 0.6) raised = true;
      });
      this._updateCueRaised(now, raised);
    } else {
      this._lost();
      this._updateCueRaised(now, false); // no hands at all → cue decays through the grace window
    }
  }

  _updateCueRaised(now, seen) {
    if (seen) { this._cueSince ||= now; this._cueLast = now; }
    else if (now - this._cueLast > 0.35) this._cueSince = 0;
    this.cueRaised = !!this._cueSince && now - this._cueSince > 0.15;
  }

  // on tracking loss, wipe motion state — velocity computed across a dropout
  // gap reads as a huge stroke and fires beats the player never conducted.
  // _armed/_peakVy survive: motion blur loses the blob exactly mid-stroke, and
  // an armed stroke should still fire at the bottom if the tip reappears fast.
  // _push expires them if the dropout exceeds 0.25s.
  _lost() {
    this.tracking = false;
    if (this._hist.length) this._lostAt = this._hist[this._hist.length - 1].t;
    this._hist.length = 0;
    this._vy = 0;
    this._bx = null; this._by = null;
    // cueRaised is NOT cleared here: in baton mode losing the blob says nothing
    // about the raised left hand; _updateCueRaised has its own grace timeout
  }

  _scanBlob(d, gate) {
    const { cr, cg, lum } = this._tipColor;
    let sx = 0, sy = 0, n = 0;
    for (let p = 0, i = 0; p < SW * SH; p++, i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], sum = r + g + b + 1;
      const dr = r / sum - cr, dg = g / sum - cg;
      if (dr * dr + dg * dg < 0.0064) {
        const l = sum / 3;
        if (l > lum * 0.35 && l < lum * 2.6) {
          const x = p % SW, y = (p / SW) | 0;
          if (Math.abs(x - this._cx) > gate || Math.abs(y - this._cy) > gate) continue;
          sx += x; sy += y; n++;
        }
      }
    }
    return { sx, sy, n };
  }

  _updateBaton() {
    const v = this._video;
    const now = performance.now() / 1000;
    if (!this._newFrame(now)) return;
    this._detT.push(now);
    while (this._detT.length && now - this._detT[0] > 2) this._detT.shift();
    this.detFps = this._detT.length / 2;
    // left-hand cue check every 3rd frame — hand model is heavy, cues aren't urgent
    this._batonFrame = (this._batonFrame + 1) % 3;
    if (this._batonFrame === 0 && this._lm) {
      const res = this._detect(v);
      if (res) {
        this.landmarks = res.landmarks || [];
        if (this._bx === null) {
          // blob lost: can't tell the gripping hand from a raised one — no cues
          this._updateCueRaised(now, false);
        } else {
          let raised = false;
          for (const lm of res.landmarks || []) {
            const wx = 1 - lm[0].x, wy = lm[0].y;
            // the hand gripping the pen is a hand too — don't let it cue
            if (Math.hypot(wx - this._bx, wy - this._by) < 0.22) continue;
            // raised = clearly above the pen tip's height
            if (wy < this._by - 0.1 && wy < 0.6) raised = true;
          }
          this._updateCueRaised(now, raised);
        }
      }
    }
    if (!this._tipColor) { this._lost(); return; }
    const d = this._frame;
    // search near the last position first — a matching patch elsewhere in the
    // room must not yank the centroid; widen only if the tip truly moved away
    const GATE = SW * 0.3; // covers any real stroke speed between frames
    let r = this._scanBlob(d, this.tracking ? GATE : 1e9);
    let widened = false;
    if (r.n < 5) { r = this._scanBlob(d, 1e9); widened = true; }
    if (r.n >= 5) {
      // a wide-rescan match far from the last position is a look-alike patch
      // (skin, wall), not the tip continuing its stroke — the 48px gate already
      // covers any real stroke speed. Adopting it WITH motion history turns the
      // teleport into a huge fake down-stroke velocity → phantom beats.
      if (widened && this.tracking &&
          (Math.abs(r.sx / r.n - this._cx) > GATE || Math.abs(r.sy / r.n - this._cy) > GATE)) {
        this._lost();
        this._armed = false; this._peakVy = 0; // a teleport is not a blur dropout
      }
      this._cx = r.sx / r.n;
      this._cy = r.sy / r.n;
      const nx = 1 - this._cx / SW, ny = this._cy / SH;
      if (this._bx === null) { this._bx = nx; this._by = ny; }
      else { this._bx += 0.55 * (nx - this._bx); this._by += 0.55 * (ny - this._by); }
      this.tracking = true;
      // smoothed position for display/zones, RAW y for velocity — smoothing the
      // velocity source halves stroke speed and silently breaks calibrated thresholds
      this._push(now, this._bx, this._by, ny);
    } else {
      this._lost();
    }
  }

  // sample the tip's color from the frame center; true | 'gray' | false.
  // Median over the SATURATED pixels only: the tip rarely fills the whole box,
  // and a plain median of tip+skin+wall learned the wall.
  sampleTip() {
    const v = this._video;
    if (!v || v.readyState < 2 || !this._cctx) return false;
    this._cctx.drawImage(v, 0, 0, SW, SH);
    const bw = Math.round(SW * 0.15), bh = Math.round(SH * 0.167); // matches the HUD target circle
    const d = this._cctx.getImageData((SW - bw) / 2, (SH - bh) / 2, bw, bh).data;
    const crs = [], cgs = [], lums = [];
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], sum = r + g + b + 1;
      const cr = r / sum, cg = g / sum, cb = b / sum;
      // saturated = clearly off gray (a gray/skin/wall tip matches everything)
      if (Math.max(cr, cg, cb) - Math.min(cr, cg, cb) < 0.12 || sum < 60) continue;
      crs.push(cr); cgs.push(cg); lums.push(sum / 3);
    }
    if (crs.length < d.length / 4 * 0.08) return 'gray'; // <8% of the box is colored
    const med = a => a.sort((x, y) => x - y)[a.length >> 1];
    const col = { cr: med(crs), cg: med(cgs), lum: med(lums) };
    this._tipColor = col;
    localStorage.setItem('ch-baton-color', JSON.stringify(col));
    return true;
  }

  _push(t, x, y, yv = y) {
    this.x = x; this.y = y;
    const h = this._hist;
    h.push({ t, x, y, yv });
    if (h.length === 1 && this._armed && t - this._lostAt > 0.25) {
      this._armed = false; this._peakVy = 0; // dropout too long — stroke is stale
    }
    while (h.length && t - h[0].t > 1.2) h.shift();
    this.trail.push({ t, x, y });
    while (this.trail.length && t - this.trail[0].t > 0.45) this.trail.shift();
    if (h.length < 2) return;
    const prev = h[h.length - 2];
    const dt = Math.max(1e-3, t - prev.t);
    const prevVy = this._vy;
    this._vy += Math.min(1, dt * 18) * ((yv - prev.yv) / dt - this._vy);
    let ymin = 1, ymax = 0;
    for (const p of h) if (t - p.t < 0.7) { if (p.yv < ymin) ymin = p.yv; if (p.yv > ymax) ymax = p.yv; }
    this.amp = Math.min(1, (ymax - ymin) / 0.45);
    // ictus: arm on a fast down-stroke (screen y grows downward), fire once the
    // velocity decays/reverses through ~0 — rate-independent hysteresis
    if (this._vy > this._peakVy) this._peakVy = this._vy;
    if (this._vy > this.armThresh) this._armed = true;
    if (this._armed && this._vy <= 0.05 && t - this._lastIctus > 0.18) {
      this._armed = false;
      this._lastIctus = t;
      const peak = this._peakVy;
      this._peakVy = 0;
      this.lastPeak = peak;
      this._quietT = t;
      if (this.onIctus) this.onIctus({ t, amp: this.amp, x, y, peak });
    }
    // safety net: 5s of CONTINUOUS movement with no ictus → threshold too high.
    // Timer re-bases whenever not moving, else every rest would count toward it
    // and each resume would cut a perfectly good threshold.
    if (!this.tracking || this.amp <= 0.25) {
      this._quietT = t;
    } else if (t - this._quietT > 5) {
      this.armThresh = Math.max(0.12, this.armThresh * 0.85);
      this._quietT = t;
      console.info('[input] no strokes registering — lowering threshold to', this.armThresh.toFixed(2));
    }
  }

  stopCamera() {
    if (this._video && this._video.srcObject) {
      for (const tr of this._video.srcObject.getTracks()) tr.stop();
      this._video.srcObject = null;
    }
  }
}
