// 2D overlay: beat highway, baton trail, dynamics meter, cue banners, score.

import { PATTERNS } from './choreography.js';

const GOLD = '#e8b04b';

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fx = [];
    this.w = 0; this.h = 0;
    this.calibInfo = null;
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  judgment(text, color, yOff = 0) {
    this.fx.push({ text, color, t0: performance.now() / 1000, x: this.w * 0.28, y: this.h * 0.8 + yOff });
  }
  banner(text, color) {
    this.fx.push({ text, color, t0: performance.now() / 1000, x: this.w / 2, y: this.h * 0.3, big: true });
  }

  draw(s) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    if (!s) return;
    const now = performance.now() / 1000;

    if (s.playing) {
      this.drawHighway(s);
      this.drawDynMeter(s);
      this.drawCues(s);
      this.drawScore(s);
      this.drawPattern(s);
      // progress
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fillRect(0, 0, w, 3);
      ctx.fillStyle = GOLD;
      ctx.fillRect(0, 0, w * Math.max(0, Math.min(1, s.t / s.duration)), 3);
    }
    this.drawBaton(s);
    if (this.calibInfo) this.drawCalib(this.calibInfo);

    // floating judgments
    this.fx = this.fx.filter(f => now - f.t0 < 0.9);
    for (const f of this.fx) {
      const u = (now - f.t0) / 0.9;
      ctx.globalAlpha = 1 - u * u;
      ctx.fillStyle = f.color;
      ctx.font = f.big ? '700 34px Georgia, serif' : '700 22px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y - u * 46);
      ctx.globalAlpha = 1;
    }

    if (s.countdown) {
      ctx.fillStyle = GOLD;
      ctx.font = '700 84px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.countdown, w / 2, h * 0.42);
    }
    if (s.cueHandUp) { // live confirmation the raised left hand is seen
      ctx.fillStyle = 'rgba(60,140,80,.85)';
      ctx.beginPath();
      ctx.roundRect(w - 126, 88, 100, 30, 15); // under the score, clear of banners
      ctx.fill();
      ctx.fillStyle = '#dfd';
      ctx.font = '600 14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('✋ SEEN', w - 76, 108);
    }
    if (s.trackingLost) {
      const label = s.batonMode === 'baton' ? 'BATON TIP NOT SEEN' : 'HAND NOT DETECTED';
      ctx.fillStyle = 'rgba(160,30,40,.85)';
      const tw = 200;
      ctx.beginPath();
      ctx.roundRect(w / 2 - tw / 2, h * 0.12, tw, 34, 17);
      ctx.fill();
      ctx.fillStyle = '#fdd';
      ctx.font = '600 15px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(label, w / 2, h * 0.12 + 22);
    }
  }

  // live diagnostics while calibrating: what the tracker sees, how fast, how hard you flick
  drawCalib(c) {
    const { ctx, w, h } = this;
    // camera modes: box sits over the top strip of the big preview (never
    // collides with the panel above or the video below); mouse: lower third
    const r = c.cam && c.cam.getBoundingClientRect();
    const bw = 300, bx = w / 2 - bw / 2, by = r && r.width > 10 ? r.top + 34 : h * 0.68;
    ctx.fillStyle = 'rgba(10,8,16,.75)';
    ctx.beginPath();
    ctx.roundRect(bx - 16, by - 34, bw + 32, 96, 12);
    ctx.fill();
    ctx.font = '600 14px system-ui';
    ctx.textAlign = 'center';
    if (c.mode === 'mouse') {
      ctx.fillStyle = '#8fd18f';
      ctx.fillText('MOUSE READY', w / 2, by - 12);
    } else {
      const name = c.mode === 'baton' ? 'BATON TIP' : 'HAND';
      // say WHY nothing is seen: no frames / dark / tracker crashed / just no hand
      let line, hint = '';
      if (c.tracking) line = `${name} ✓  ${Math.round(c.detFps)} fps`;
      else if (c.camFps < 2) { line = 'NO CAMERA FRAMES'; hint = 'another app may hold the webcam — close it, retry'; }
      else if (c.lastErr) { line = 'TRACKER ERROR'; hint = c.lastErr.slice(0, 60); }
      else if (c.lum >= 0 && c.lum < 40) { line = `${name} NOT SEEN — TOO DARK`; hint = 'face a light source'; }
      else { line = `${name} NOT SEEN · camera ${Math.round(c.camFps)} fps`; hint = c.mode === 'baton'
        ? 'tip must be a bright color — recalibrate closer to the camera' : 'hand inside the preview, palm to camera'; }
      ctx.fillStyle = c.tracking ? '#8fd18f' : '#e07070';
      ctx.fillText(line, w / 2, by - 12);
      if (!hint && c.detFps > 0 && c.detFps < 15) hint = 'tracking is slow — more light, close other apps';
      if (hint) {
        ctx.fillStyle = '#e0b070';
        ctx.font = '600 12px system-ui';
        ctx.fillText(hint, w / 2, by + 52);
      }
      this.drawCamOverlay(c);
    }
    // stroke-speed gauge: fill passes the gold line = a flick will register
    const scale = 2; // screen-heights/s full range
    ctx.fillStyle = 'rgba(255,255,255,.15)';
    ctx.fillRect(bx, by, bw, 14);
    ctx.fillStyle = '#e8b04b';
    ctx.fillRect(bx, by, bw * Math.min(1, Math.max(0, c.vy) / scale), 14);
    const tx = bx + bw * Math.min(1, c.thresh / scale);
    ctx.fillStyle = '#fff';
    ctx.fillRect(tx - 1.5, by - 4, 3, 22);
    if (c.lastPeak > 0) {
      ctx.fillStyle = 'rgba(143,209,143,.9)';
      const px = bx + bw * Math.min(1, c.lastPeak / scale);
      ctx.fillRect(px - 1, by - 2, 2, 18);
    }
    ctx.fillStyle = '#cfc8dd';
    ctx.font = '600 11px system-ui';
    ctx.fillText('down-stroke speed — pass the white line', w / 2, by + 32);
  }

  // landmarks / blob marker / tip-sampling circle drawn over the (mirrored) preview
  drawCamOverlay(c) {
    const r = c.cam && c.cam.getBoundingClientRect();
    if (!r || r.width < 10) return;
    const { ctx } = this;
    const X = nx => r.left + (1 - nx) * r.width, Y = ny => r.top + ny * r.height; // preview is scaleX(-1)
    if (c.tipTarget) { // sample box in vision.sampleTip: 15% x 16.7% of the frame, centered
      ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.ellipse(r.left + r.width / 2, r.top + r.height / 2, r.width * 0.075, r.height * 0.083, 0, 0, Math.PI * 2);
      ctx.stroke(); ctx.setLineDash([]);
    }
    for (const lm of c.landmarks || []) {
      ctx.fillStyle = 'rgba(120,255,140,.9)';
      for (let i = 0; i < lm.length; i++) {
        ctx.beginPath(); ctx.arc(X(lm[i].x), Y(lm[i].y), i === 8 ? 6 : 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (c.tracking) { // where the game thinks the baton is (mirrored coords already)
      ctx.strokeStyle = GOLD; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(r.left + c.x * r.width, r.top + c.y * r.height, 10, 0, Math.PI * 2); ctx.stroke();
    }
  }

  drawHighway(s) {
    const { ctx, w, h } = this;
    const y = h * 0.87, hh = 46;
    const ictusX = w * 0.28;
    const pxSec = (w * 0.62) / 3.5;
    ctx.fillStyle = 'rgba(10,8,16,.55)';
    ctx.beginPath();
    ctx.roundRect(w * 0.04, y - hh, w * 0.92, hh * 2, 14);
    ctx.fill();

    // phrase spans: brackets above the lane, silence shading inside it
    for (const p of s.phrases || []) {
      if (p.t1 < s.t - 0.5 || p.t0 > s.t + 3.6 || p.state === 'skipped') continue;
      const x0 = Math.max(w * 0.05, ictusX + (p.t0 - s.t) * pxSec);
      const x1 = Math.min(w * 0.95, ictusX + (p.t1 - s.t) * pxSec);
      if (x1 - x0 < 12) continue;
      const active = s.t >= p.t0 && s.t <= p.t1;
      if (p.type === 'rest') {
        ctx.fillStyle = `rgba(90,120,190,${active ? 0.28 : 0.15})`;
        ctx.fillRect(x0, y - hh + 4, x1 - x0, hh * 2 - 8);
        ctx.fillStyle = active ? '#b9c8ee' : 'rgba(185,200,238,.6)';
        ctx.font = '600 12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('𝄐 silence — hold still', (x0 + x1) / 2, y - hh + 18);
      } else {
        const up = p.type === 'cresc';
        ctx.strokeStyle = active ? GOLD : 'rgba(232,176,75,.45)';
        ctx.lineWidth = active ? 2.5 : 1.5;
        ctx.beginPath(); // hairpin wedge, like the score marking
        ctx.moveTo(up ? x0 : x1, y - hh - 8);
        ctx.lineTo(up ? x1 : x0, y - hh - 15);
        ctx.moveTo(up ? x0 : x1, y - hh - 8);
        ctx.lineTo(up ? x1 : x0, y - hh - 1);
        ctx.stroke();
        ctx.fillStyle = active ? GOLD : 'rgba(232,176,75,.6)';
        ctx.font = '600 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(up ? 'cresc. — grow your strokes' : 'dim. — smaller strokes', (x0 + x1) / 2, y - hh - 20);
      }
    }

    let prevLegatoX = null;
    for (const b of s.beats) {
      const dt = b.t - s.t;
      if (dt < -0.6 || dt > 3.6 || b.state === 'skipped') continue; // skipped = before the start mark
      const x = ictusX + dt * pxSec;
      if (x < w * 0.05 || x > w * 0.95) { prevLegatoX = null; continue; }
      if (b.legato && b.state === 'pending') {
        if (prevLegatoX !== null && x - prevLegatoX < pxSec * 1.4) {
          ctx.strokeStyle = 'rgba(160,200,255,.4)'; // slur — smooth, connected strokes
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(prevLegatoX, y + 20);
          ctx.quadraticCurveTo((prevLegatoX + x) / 2, y + 30, x, y + 20);
          ctx.stroke();
        }
        prevLegatoX = x;
      } else prevLegatoX = null;
      const r = (b.down ? 11 : 6) + 7 * b.dyn;
      const hue = 210 - 175 * b.dyn;
      if (b.state === 'hit') {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#8fd18f';
      } else if (b.state === 'miss') {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#c25b5b';
      } else {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = `hsl(${hue} 75% ${55 + 15 * b.dyn}%)`;
      }
      ctx.beginPath();
      if (b.hit && b.state === 'pending') { // sforzando: 4-point star, whip this one
        const R = r + 6;
        for (let k = 0; k < 8; k++) {
          const rr = k % 2 ? R * 0.42 : R;
          const an = k * Math.PI / 4 - Math.PI / 2;
          ctx[k ? 'lineTo' : 'moveTo'](x + Math.cos(an) * rr, y + Math.sin(an) * rr);
        }
        ctx.closePath();
        ctx.fillStyle = '#ffcf5c';
      } else if (b.down) {
        ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.8, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.8, y);
        ctx.closePath();
      } else {
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
      if (b.down && b.state === 'pending') {
        ctx.fillStyle = 'rgba(255,255,255,.75)';
        ctx.font = '600 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(String(b.bar), x, y + 4);
      }
    }
    // ictus ring
    const pulse = 1 + 0.12 * Math.max(0, 1 - (s.t - (s.lastBeatT ?? -9)) * 5);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ictusX, y, 20 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(232,176,75,.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ictusX, y, 30 * pulse, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawDynMeter(s) {
    const { ctx, w, h } = this;
    const x = w - 46, y0 = h * 0.28, len = h * 0.4;
    ctx.fillStyle = 'rgba(10,8,16,.55)';
    ctx.beginPath();
    ctx.roundRect(x - 20, y0 - 26, 52, len + 62, 12);
    ctx.fill();
    const grad = ctx.createLinearGradient(0, y0 + len, 0, y0);
    grad.addColorStop(0, '#4a5a8a');
    grad.addColorStop(0.55, '#c9a44a');
    grad.addColorStop(1, '#c25b3b');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y0, 12, len);
    // target band
    const target = s.dynTarget ?? 0.5;
    const bandLo = Math.max(0, target - 0.16), bandHi = Math.min(1, target + 0.16);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fillRect(x - 5, y0 + len * (1 - bandHi), 22, len * (bandHi - bandLo));
    // current amplitude needle
    const cy = y0 + len * (1 - Math.min(1, s.amp ?? 0));
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.moveTo(x - 10, cy); ctx.lineTo(x - 2, cy - 5); ctx.lineTo(x - 2, cy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#cfc8dd';
    ctx.font = '600 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('ff', x + 6, y0 - 8);
    ctx.fillText('pp', x + 6, y0 + len + 16);
    ctx.fillText('DYN', x + 6, y0 + len + 32);
  }

  drawCues(s) {
    const { ctx, w, h } = this;
    for (const c of s.cues) {
      const dt = c.t - s.t;
      if (dt > 3 || dt < -0.8 || c.state === 'skipped') continue;
      const chev = ['◀', '▲', '▶'][c.zone] + (s.batonMode !== 'mouse' ? ' / ✋' : '');
      const urgency = Math.max(0, Math.min(1, 1 - dt / 3));
      const y = h * 0.12;
      ctx.globalAlpha = c.state === 'pending' ? 0.55 + 0.45 * urgency : 0.4;
      ctx.fillStyle = 'rgba(10,8,16,.8)';
      const label = `CUE: ${c.label}  ${chev}`;
      ctx.font = `700 ${18 + 6 * urgency}px system-ui`;
      const tw = ctx.measureText(label).width + 36;
      ctx.beginPath();
      ctx.roundRect(w / 2 - tw / 2, y - 24, tw, 40, 20);
      ctx.fill();
      ctx.fillStyle = c.state === 'hit' ? '#8fd18f' : c.state === 'miss' ? '#777' : c.color;
      ctx.textAlign = 'center';
      ctx.fillText(label, w / 2, y + 5);
      ctx.globalAlpha = 1;
      // edge glow toward the section's zone while the window is open
      if (Math.abs(dt) < 0.75 && c.state === 'pending') {
        const gx = [w * 0.06, w / 2, w * 0.94][c.zone];
        const grad = ctx.createRadialGradient(gx, h / 2, 20, gx, h / 2, w * 0.3);
        grad.addColorStop(0, c.color + '55');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
    }
  }

  // conducting-pattern guide: where the baton should travel this bar
  drawPattern(s) {
    const { ctx } = this;
    const pat = PATTERNS[s.meter];
    if (!pat) return;
    const px = 24, py = 66, size = 96;
    ctx.fillStyle = 'rgba(10,8,16,.55)';
    ctx.beginPath();
    ctx.roundRect(px - 10, py - 10, size + 20, size + 38, 12);
    ctx.fill();
    // the pattern breathes with the target dynamics: forte = big strokes
    const sc = 0.6 + 0.55 * (s.dynTarget ?? 0.5);
    const P = i => [
      px + (0.5 + (pat[i][0] - 0.5) * sc) * size,
      py + (0.5 + (pat[i][1] - 0.5) * sc) * size,
    ];
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(...P(0));
    for (let i = 1; i <= pat.length; i++) ctx.lineTo(...P(i % pat.length));
    ctx.stroke();
    const next = s.nextBib ?? ((s.curBib ?? -1) + 1) % s.meter;
    const now = performance.now() / 1000;
    for (let i = 0; i < pat.length; i++) {
      const [x, y] = P(i);
      const cur = i === s.curBib;
      ctx.fillStyle = cur ? GOLD : 'rgba(255,255,255,.4)';
      ctx.beginPath();
      ctx.arc(x, y, cur ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();
      if (i === next) {
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 9 + 2.5 * Math.sin(now * 6), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = cur ? '#0b0a10' : '#0b0a10';
      ctx.font = '700 9px system-ui';
      ctx.textAlign = 'center';
      if (cur) ctx.fillText(String(i + 1), x, y + 3);
    }
    // GOLD dot = where the baton should be (music-synced, smoothed so beat
    // jumps glide); WHITE ring = where your baton actually is
    if (s.curBib >= 0 && s.nextBib != null) {
      const [x0, y0] = P(s.curBib), [x1, y1] = P(s.nextBib);
      const u = s.beatFrac * s.beatFrac * (3 - 2 * s.beatFrac);
      const tx = x0 + (x1 - x0) * u, ty = y0 + (y1 - y0) * u;
      if (this._gx == null) { this._gx = tx; this._gy = ty; }
      this._gx += 0.3 * (tx - this._gx);
      this._gy += 0.3 * (ty - this._gy);
      ctx.fillStyle = GOLD;
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(this._gx, this._gy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (s.batonX != null) { // same breathing transform as the nodes, or they can never align
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px + (0.5 + (s.batonX - 0.5) * sc) * size, py + (0.5 + (s.batonY - 0.5) * sc) * size, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#cfc8dd';
    ctx.font = '600 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`${s.meter}/4 — ● guide  ○ you`, px + size / 2, py + size + 18);
  }

  drawScore(s) {
    const { ctx, w } = this;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = '700 34px system-ui';
    ctx.fillText(String(s.score).padStart(6, '0'), w - 26, 52);
    if (s.combo > 1) {
      ctx.fillStyle = GOLD;
      ctx.font = '600 17px system-ui';
      ctx.fillText(`×${s.mult}  COMBO ${s.combo}`, w - 26, 76);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9a92ae';
    ctx.font = '600 14px system-ui';
    ctx.fillText(`${Math.round(s.bpm)} BPM`, 24, 30);
    if (s.acc != null) {
      ctx.fillText(`${Math.round(s.acc * 100)}%`, 24, 50);
    }
  }

  drawBaton(s) {
    const { ctx, w, h } = this;
    const trail = s.trail || [];
    if (trail.length > 1) {
      const now = performance.now() / 1000;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < trail.length; i++) {
        const p0 = trail[i - 1], p1 = trail[i];
        const age = now - p1.t;
        const a = Math.max(0, 1 - age / 0.45);
        ctx.strokeStyle = `rgba(255,224,150,${0.75 * a * a})`;
        ctx.lineWidth = 1 + 6 * a;
        ctx.beginPath();
        ctx.moveTo(p0.x * w, p0.y * h);
        ctx.lineTo(p1.x * w, p1.y * h);
        ctx.stroke();
      }
    }
    if (s.batonX != null) {
      const x = s.batonX * w, y = s.batonY * h;
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#fff6dd';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      const now = performance.now() / 1000;
      const dt = now - (s.lastIctusT ?? -9);
      if (dt < 0.3) {
        ctx.strokeStyle = `rgba(232,176,75,${1 - dt / 0.3})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, 8 + dt * 90, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}
