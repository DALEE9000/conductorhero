import { analyzeAudio } from './audio-analysis.js';
import { renderDemoSong } from './demo-song.js';
import { buildChoreography } from './choreography.js';
import { Baton } from './vision.js';
import { Stage } from './orchestra.js';
import { HUD } from './hud.js';
import { Game } from './game.js';

const $ = id => document.getElementById(id);
const overlays = ['menu', 'analyzing', 'ready', 'results', 'calib'];
const show = id => overlays.forEach(o => $(o).classList.toggle('hidden', o !== id));

const stage = new Stage($('stage'));
const hud = new HUD($('hud'));
const baton = new Baton();
const game = new Game({ baton, hud, onFinish: showResults });

let audioCtx = null;
let pieceName = '';

function toast(msg, ms = 4200) {
  const el = $('toast');
  el.textContent = msg;
  el.style.opacity = 1;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = 0; }, ms);
}

function inputMode() {
  return document.querySelector('input[name=inputmode]:checked').value;
}
function difficulty() {
  return document.querySelector('input[name=difficulty]:checked').value;
}

// input offset persists per mode
const offsetEl = $('offset'), offsetVal = $('offset-val');
function loadOffset() {
  const key = 'ch-offset-' + inputMode();
  const def = inputMode() === 'mouse' ? 0 : 60;
  const v = Number(localStorage.getItem(key) ?? def);
  offsetEl.value = v;
  offsetVal.textContent = v;
}
offsetEl.addEventListener('input', () => {
  offsetVal.textContent = offsetEl.value;
  localStorage.setItem('ch-offset-' + inputMode(), offsetEl.value);
});
document.querySelectorAll('input[name=inputmode]').forEach(r => r.addEventListener('change', loadOffset));
loadOffset();

const campanEl = $('campan');
campanEl.checked = localStorage.getItem('ch-campan') !== '0';
stage.autoPan = campanEl.checked;
campanEl.addEventListener('change', () => {
  stage.autoPan = campanEl.checked;
  localStorage.setItem('ch-campan', campanEl.checked ? '1' : '0');
});

function ensureCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

async function prepare(bufferPromise, name) {
  show('analyzing');
  $('ana-status').textContent = 'Decoding audio';
  $('ana-fill').style.width = '2%';
  try {
    const buffer = await bufferPromise;
    $('ana-status').textContent = 'Detecting beats, dynamics & cues';
    const analysis = await analyzeAudio(buffer, f => {
      $('ana-fill').style.width = Math.round(f * 100) + '%';
    });
    const choreo = buildChoreography(analysis);
    if (choreo.beats.length < 8) { // playable beats, after rest-span exclusion
      toast('Could not find a steady beat in that audio — try another piece.');
      show('menu');
      return;
    }
    game.setPiece(buffer, analysis, choreo);
    pieceName = name;
    $('piece-info').textContent =
      `${name} — ${Math.round(analysis.bpm)} BPM, ${choreo.beats.length} beats, ` +
      `${choreo.cues.length} section cues, ${Math.floor(buffer.duration / 60)}:${String(Math.round(buffer.duration % 60)).padStart(2, '0')}`;
    show('ready');
  } catch (err) {
    console.error(err);
    toast('Could not read that audio file: ' + (err.message || err));
    show('menu');
  }
}

$('btn-demo').addEventListener('click', () => {
  ensureCtx();
  prepare(renderDemoSong(), 'Demo Symphony in A minor');
});

$('file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const ctx = ensureCtx();
  prepare(file.arrayBuffer().then(ab => ctx.decodeAudioData(ab)), file.name.replace(/\.[^.]+$/, ''));
  e.target.value = '';
});

// ---- optional YouTube score video: muted embed kept in sync with the MP3 ----
let ytPlayer = null, ytReady = false, ytLastSync = 0;
const ytId = url => {
  const m = String(url || '').match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/);
  return m ? m[1] : null;
};
$('yturl').value = localStorage.getItem('ch-yturl') || '';
$('yturl').addEventListener('change', () =>
  localStorage.setItem('ch-yturl', $('yturl').value.trim())); // emptied field must stay empty next session

async function setupYT(id) {
  if (!window.YT || !window.YT.Player) {
    await new Promise((resolve, reject) => {
      window.onYouTubeIframeAPIReady = resolve;
      const sc = document.createElement('script');
      sc.src = 'https://www.youtube.com/iframe_api';
      sc.onerror = () => reject(new Error('yt api blocked'));
      document.head.appendChild(sc);
      setTimeout(() => reject(new Error('yt api timeout')), 8000);
    });
  }
  if (ytPlayer) {
    ytPlayer.cueVideoById(id);
    return;
  }
  ytReady = false;
  ytPlayer = new YT.Player('ytplayer', {
    videoId: id,
    playerVars: { controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, playsinline: 1 },
    events: { onReady: e => { e.target.mute(); ytReady = true; } },
  });
}

function ytSync() { // called every frame; throttled inside
  if (!ytPlayer || !ytReady) return;
  const nowMs = performance.now();
  if (nowMs - ytLastSync < 2000) return;
  ytLastSync = nowMs;
  try {
    if (!game.playing) { if (ytPlayer.getPlayerState() === 1) ytPlayer.pauseVideo(); return; }
    const t = game.songTime();
    if (t < 0) {
      ytPlayer.pauseVideo(); // seekTo from a cued state would START playback
      ytPlayer.seekTo(0, true);
      ytPlayer.pauseVideo();
    } else if (ytPlayer.getPlayerState() !== 1) {
      ytPlayer.seekTo(t, true);
      ytPlayer.playVideo();
      ytPlayer.mute();
    } else if (Math.abs(ytPlayer.getCurrentTime() - t) > 0.4) {
      ytPlayer.seekTo(t, true);
    }
  } catch { /* embed can die (network, blocker) — never take the game down */ }
}

// starts the requested input, falls back to mouse, and always applies the
// offset stored for the mode that actually ended up active
async function armBaton(mode) {
  try {
    await baton.start(mode, $('cam'));
  } catch (err) {
    console.error(err);
    toast('Camera unavailable (' + (err.name || err.message) + ') — falling back to mouse.');
    await baton.start('mouse', $('cam'));
  }
  const active = baton.mode;
  const def = active === 'mouse' ? 0 : 60;
  game.inputOffset = Number(localStorage.getItem('ch-offset-' + active) ?? def) / 1000;
  $('cam').style.display = active === 'mouse' ? 'none' : 'block';
  if (active !== 'mouse' && !localStorage.getItem('ch-sens2-' + active)) {
    toast('Tip: run Calibrate first so the game learns your stroke strength and timing.', 6000);
  }
}

$('btn-start').addEventListener('click', async () => {
  if (inputMode() === 'baton' && !localStorage.getItem('ch-baton-color')) {
    toast('First, teach me what your baton tip looks like — quick calibration.');
    runCalibration('ready');
    return;
  }
  $('btn-start').disabled = true;
  game.setDifficulty(difficulty());
  await armBaton(inputMode());
  const url = $('yturl').value.trim();
  const vid = ytId(url);
  if (url && !vid) toast('Could not read that YouTube URL — playing without video.');
  if (vid) {
    try {
      await setupYT(vid);
      $('ytwrap').style.display = 'block';
    } catch (err) {
      console.error(err);
      toast('YouTube embed unavailable — playing without video.');
      $('ytwrap').style.display = 'none';
    }
  } else {
    $('ytwrap').style.display = 'none';
  }
  $('btn-start').disabled = false;
  overlays.forEach(o => $(o).classList.add('hidden'));
  await game.start(ensureCtx());
});

// ---- calibration: phase 1 learns stroke strength, phase 2 measures latency ----
let calibToken = 0;
let calibCleanup = null;
let calibReturnTo = 'menu';
let calibTipTarget = false; // HUD draws the tip-sampling circle over the preview
const sleep = ms => new Promise(r => setTimeout(r, ms));

// big, unmissable calibration UI: step counter, giant animated icon, progress dots
function setCalib(step, total, icon, iconClass, status, dotsOn, dotsTotal) {
  $('calib-step').textContent = `STEP ${step} OF ${total}`;
  const ic = $('calib-icon');
  ic.textContent = icon;
  ic.className = iconClass || '';
  $('calib-status').textContent = status;
  const dots = $('calib-dots');
  if (dotsTotal != null) {
    if (dots.children.length !== dotsTotal) dots.innerHTML = '<span></span>'.repeat(dotsTotal);
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i < dotsOn));
  } else {
    dots.innerHTML = '';
  }
}

async function runCalibration(returnTo) {
  const token = ++calibToken;
  calibReturnTo = returnTo;
  const mode = inputMode();
  show('calib');
  setCalib(1, mode === 'baton' ? 4 : mode === 'camera' ? 3 : 2,
    mode === 'mouse' ? '🖱️' : '📷', 'pulse', `Starting ${mode}…`);
  try {
    await baton.start(mode, $('cam'));
  } catch (err) {
    console.error(err);
    toast('Input unavailable: ' + (err.name || err.message));
    show(returnTo);
    return;
  }
  // stale-token exits must not kill a stream the game is now using
  const bailIfStale = () => {
    if (token === calibToken) return false;
    if (!game.playing) { baton.stopCamera(); $('cam').style.display = 'none'; }
    return true;
  };
  if (bailIfStale()) return;
  if (baton.mode !== 'mouse') $('cam').style.display = 'block';
  const ctx = ensureCtx();
  await ctx.resume();
  if (bailIfStale()) return; // before any baton state is overwritten

  const prevHandler = baton.onIctus;
  const prevThresh = baton.armThresh;
  let bus = null;
  calibCleanup = () => {
    baton.onIctus = prevHandler;
    baton.armThresh = prevThresh;
    if (bus) bus.disconnect();
    $('cam').classList.remove('big');
    $('hud').classList.remove('top');
    calibTipTarget = false;
    if (!game.playing) { baton.stopCamera(); $('cam').style.display = 'none'; }
  };
  const done = msg => {
    calibCleanup();
    calibCleanup = null;
    if (msg) toast(msg);
    show(returnTo);
  };

  const total = baton.mode === 'baton' ? 4 : baton.mode === 'camera' ? 3 : 2;
  let stepN = 1;
  if (baton.mode !== 'mouse') { // big preview + landmark overlay: see what the tracker sees
    $('cam').classList.add('big');
    $('hud').classList.add('top');
  }

  // phase 0 (baton mode): learn the tip's color from the frame center
  calibTipTarget = false;
  if (baton.mode === 'baton') {
    calibTipTarget = true;
    for (let s = 4; s > 0; s--) {
      setCalib(stepN, total, '🖊️', 'pulse live', `Hold your baton tip inside the gold circle — ${s}`);
      await sleep(800);
      if (token !== calibToken) return;
    }
    stepN++;
    const res = baton.sampleTip();
    calibTipTarget = false;
    if (res !== true) {
      done(res === 'gray'
        ? 'Tip color too plain to track — wrap bright tape (red/green/blue) around it and retry.'
        : 'Could not read the camera frame — retry.');
      return;
    }
    toast('Baton tip learned.');
  }

  // phase 1: sensitivity — catch even weak flicks, learn this player's peaks
  baton.armThresh = 0.12;
  const peaks = [];
  baton.onIctus = e => {
    // amp gate: tracking jitter can exceed the lowered velocity threshold, but
    // it never spans real spatial distance — only actual strokes fill the dots
    if (e.peak < 0.1 || e.amp < 0.15) return;
    peaks.push(e.peak);
    setCalib(stepN, total, '⬇️', 'bounce live', `Beat ${peaks.length} of 4 — keep going!`, peaks.length, 4);
  };
  setCalib(stepN, total, '⬇️', 'bounce live', 'Conduct 4 beats, normal strokes — down… up… down… up', 0, 4);
  const deadline = performance.now() + 15000;
  while (peaks.length < 4 && performance.now() < deadline && token === calibToken) await sleep(120);
  if (token !== calibToken) return; // cancel handler already cleaned up
  if (peaks.length < 3) { done(`Only saw ${peaks.length} flicks — check lighting, keep your hand in the preview, try again.`); return; }
  peaks.sort((a, b) => a - b);
  // 30% of a typical stroke's peak; hard cap keeps camera thresholds reachable
  const maxSens = baton.mode === 'mouse' ? 0.6 : 0.45;
  const sens = Math.max(0.12, Math.min(maxSens, peaks[Math.floor(peaks.length / 2)] * 0.3));
  localStorage.setItem('ch-sens2-' + baton.mode, sens.toFixed(2));
  baton.armThresh = sens;

  // phase 1.5: verify the left-hand cue gesture is seen (camera modes only)
  if (baton.mode !== 'mouse') {
    stepN++;
    // baton mode loads the hand model in the background; without it the cue
    // check would silently see nothing for 15s — say so and move on instead
    if (baton.mode === 'baton' && !baton._lm) {
      setCalib(stepN, total, '✋', 'pulse',
        'Hand model still loading — skipping the left-hand check. Pointing the baton at sections still cues them.');
      await sleep(2600);
      if (token !== calibToken) return;
    } else {
    const dl = performance.now() + 15000;
    let seenSince = 0, confirmed = false;
    while (performance.now() < dl && token === calibToken) {
      if (baton.cueRaised) {
        seenSince ||= performance.now();
        if (performance.now() - seenSince > 700) { confirmed = true; break; }
        setCalib(stepN, total, '✋', 'pulse live', 'I SEE IT — keep holding…');
      } else {
        seenSince = 0;
        setCalib(stepN, total, '✋', 'pulse', 'Raise your LEFT hand HIGH above your conducting hand — hold it there');
      }
      await sleep(100);
    }
    if (token !== calibToken) return;
    setCalib(stepN, total, confirmed ? '✅' : '⚠️', 'live', confirmed
      ? 'Left hand confirmed — raise it like that to cue sections'
      : 'No left hand seen — you can still point the baton at sections');
    await sleep(1600);
    if (token !== calibToken) return;
    }
  }

  // phase 2: timing offset — flick on 8 metronome clicks, take the median gap
  const spb = 0.6, N = 8;
  const t0 = ctx.currentTime + 1.5;
  const perf0 = performance.now() / 1000 + (t0 - ctx.currentTime);
  bus = ctx.createGain();
  bus.connect(ctx.destination);
  for (let i = 0; i < N; i++) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.value = i === 0 ? 1800 : 1200;
    const tt = t0 + i * spb;
    g.gain.setValueAtTime(0.4, tt);
    g.gain.exponentialRampToValueAtTime(0.001, tt + 0.06);
    osc.connect(g); g.connect(bus);
    osc.start(tt); osc.stop(tt + 0.08);
  }
  stepN++;
  const hits = [];
  baton.onIctus = e => {
    if (e.amp < 0.15) return; // same jitter gate as phase 1
    hits.push(e.t);
    setCalib(stepN, total, '🎵', 'live', `Flick on every click — ${hits.length} caught`, hits.length, N);
  };
  setCalib(stepN, total, '🎵', 'live', 'Now flick DOWN on every click you hear', 0, N);
  const endPerf = perf0 + N * spb + 0.9;
  let lastTick = -1;
  while (performance.now() / 1000 < endPerf && token === calibToken) {
    const k = Math.floor((performance.now() / 1000 - perf0) / spb);
    if (k !== lastTick && k >= 0 && k < N) { // icon jumps on each metronome click
      lastTick = k;
      const ic = $('calib-icon');
      ic.classList.remove('tickflash');
      void ic.offsetWidth;
      ic.classList.add('tickflash');
    }
    await sleep(40);
  }
  if (token !== calibToken) return;
  const offs = [];
  const used = new Set(); // one flick answers one click, never two
  for (let i = 0; i < N; i++) {
    const tick = perf0 + i * spb;
    let best = null, bj = -1;
    hits.forEach((h, j) => {
      if (used.has(j)) return;
      const dd = h - tick;
      if (Math.abs(dd) < 0.4 && (best === null || Math.abs(dd) < Math.abs(best))) { best = dd; bj = j; }
    });
    if (best !== null) { offs.push(best); used.add(bj); }
  }
  if (offs.length < 5) { done(`Sensitivity saved, but only ${offs.length}/${N} clicks matched — timing offset unchanged.`); return; }
  offs.sort((a, b) => a - b);
  const ms = Math.max(-200, Math.min(250, Math.round(offs[Math.floor(offs.length / 2)] * 100) * 10));
  localStorage.setItem('ch-offset-' + baton.mode, ms);
  if (inputMode() === baton.mode) { offsetEl.value = ms; offsetVal.textContent = ms; }
  done(`Calibrated ${baton.mode}: stroke sensitivity ${sens.toFixed(2)}, offset ${ms} ms (${offs.length}/${N} clicks).`);
}

$('btn-calib').addEventListener('click', () => runCalibration('menu'));
$('btn-calib2').addEventListener('click', () => runCalibration('ready'));
$('btn-calib-cancel').addEventListener('click', () => {
  calibToken++;
  if (calibCleanup) { calibCleanup(); calibCleanup = null; }
  show(calibReturnTo);
});

function showResults(r) {
  $('cam').style.display = 'none';
  baton.stopCamera();
  $('ytwrap').style.display = 'none';
  try { if (ytPlayer && ytReady) ytPlayer.pauseVideo(); } catch {}
  const hsKey = `ch-hs-${pieceName}|${Math.round(game.buffer.duration)}|${r.difficulty}`;
  const prevBest = Number(localStorage.getItem(hsKey) || 0);
  const isBest = r.score > prevBest;
  if (isBest) localStorage.setItem(hsKey, r.score);
  $('stars').textContent = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
  $('rank').textContent = r.rank + (isBest && prevBest > 0 ? ' — NEW BEST!' : '');
  $('res-stats').innerHTML = [
    ['Score', String(r.score).padStart(6, '0')],
    ['Best (' + r.difficulty + ')', String(Math.max(r.score, prevBest)).padStart(6, '0')],
    ['Accuracy', Math.round(r.acc * 100) + '%'],
    ['Perfect / Good / Miss', `${r.counts.PERFECT} / ${r.counts.GOOD} / ${r.counts.MISS}`],
    ['Max combo', r.maxCombo],
    ['Section cues', `${r.cueHits} / ${r.cueTotal}`],
    ['Phrases shaped', `${r.phraseHits} / ${r.phraseTotal}`],
    ['Expressive bonuses', r.dynHits],
  ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  show('results');
}

$('btn-encore').addEventListener('click', async () => {
  overlays.forEach(o => $(o).classList.add('hidden'));
  await armBaton(baton.mode);
  if (ytPlayer && ytReady && ytId($('yturl').value.trim())) $('ytwrap').style.display = 'block';
  await game.start(ensureCtx());
});

$('btn-new').addEventListener('click', () => {
  game.stop();
  show('menu');
});

// main loop
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  baton.update();
  hud.calibInfo = calibCleanup ? {
    mode: baton.mode, tracking: baton.tracking, detFps: baton.detFps,
    vy: baton._vy, thresh: baton.armThresh, lastPeak: baton.lastPeak,
    camFps: baton.camFps, lum: baton.lum, lastErr: baton.lastErr,
    landmarks: baton.landmarks, x: baton.x, y: baton.y,
    tipTarget: calibTipTarget, cam: $('cam'),
  } : null;
  const state = game.update();
  stage.update(dt, state || {});
  hud.draw(game.hudView(state));
  ytSync();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function onResize() {
  stage.resize(innerWidth, innerHeight);
  hud.resize(innerWidth, innerHeight, Math.min(devicePixelRatio, 2));
}
addEventListener('resize', onResize);
onResize();
