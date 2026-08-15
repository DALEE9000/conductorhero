// Three.js stage: procedural orchestra players by section, cue spotlights, bloom.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SECTIONS } from './choreography.js';

const CONDUCTOR = new THREE.Vector3(0, 0, 9); // arcs center on the podium

const G = {}, M = {};
const geo = (k, make) => (G[k] ??= make());
const mat = (k, params) => (M[k] ??= new THREE.MeshStandardMaterial(params));

const SKIN = [0xd9a06b, 0x8a5a3b, 0xf0c8a0, 0x6b4226, 0xc98e5a];
const HAIR = [0x1a1a1a, 0x3a2a1a, 0x555555, 0x151520, 0x4a3320];
const rnd = i => { const h = Math.sin(i * 127.1) * 43758.5453; return h - Math.floor(h); };

function makeBody(i) {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(
    geo('torso', () => new THREE.CapsuleGeometry(0.19, 0.42, 4, 8)),
    mat('suit', { color: 0x17171f, roughness: 0.85 }));
  torso.position.y = 0.95;
  const head = new THREE.Mesh(
    geo('head', () => new THREE.SphereGeometry(0.135, 12, 10)),
    mat('skin' + (i % SKIN.length), { color: SKIN[i % SKIN.length], roughness: 0.7 }));
  head.position.y = 1.36;
  const hair = new THREE.Mesh(
    geo('hair', () => new THREE.SphereGeometry(0.142, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)),
    mat('hair' + (i % HAIR.length), { color: HAIR[i % HAIR.length], roughness: 0.9 }));
  hair.position.y = 1.375;
  const lap = new THREE.Mesh(
    geo('lap', () => new THREE.BoxGeometry(0.42, 0.12, 0.38)),
    M.suit);
  lap.position.set(0, 0.62, 0.12);
  g.add(torso, head, hair, lap);

  const arms = {};
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.24, 1.18, 0.02);
    const limb = new THREE.Mesh(
      geo('limb', () => new THREE.CapsuleGeometry(0.05, 0.42, 3, 6)),
      M.suit);
    limb.position.y = -0.24;
    limb.castShadow = true;
    arm.add(limb);
    arm.rotation.z = side * 0.25;
    g.add(arm);
    arms[side === 1 ? 'r' : 'l'] = arm;
  }
  for (const m of [torso, head, hair, lap]) m.castShadow = true;
  return { g, arms };
}

const woodMat = () => mat('wood', { color: 0x7a4a22, roughness: 0.5, metalness: 0.1 });
const brassMat = () => mat('brassy', { color: 0xc8a84b, roughness: 0.25, metalness: 0.9 });

function makePlayer(kind, i) {
  const { g, arms } = makeBody(i);
  const parts = { arms };

  if (kind === 'violin') {
    const body = new THREE.Mesh(geo('vbody', () => new THREE.BoxGeometry(0.3, 0.07, 0.17)), woodMat());
    body.position.set(-0.16, 1.28, 0.16);
    body.rotation.set(0, 0.5, -0.15);
    const neck = new THREE.Mesh(geo('vneck', () => new THREE.BoxGeometry(0.22, 0.03, 0.04)), woodMat());
    neck.position.set(-0.34, 1.3, 0.24);
    neck.rotation.y = 0.5;
    arms.l.rotation.set(-0.5, 0, -1.0);
    arms.r.rotation.set(-0.6, 0, 0.5);
    const bow = new THREE.Mesh(geo('bow', () => new THREE.CylinderGeometry(0.008, 0.008, 0.6, 5)), woodMat());
    bow.position.set(0, -0.5, 0.06);
    bow.rotation.z = Math.PI / 2 - 0.4;
    arms.r.add(bow);
    g.add(body, neck);
    parts.bowArm = arms.r;
    parts.bowBaseZ = 0.5;
  } else if (kind === 'cello' || kind === 'bass') {
    const s = kind === 'bass' ? 1.3 : 1;
    const body = new THREE.Mesh(geo('cbody' + kind, () => new THREE.CapsuleGeometry(0.22 * s, 0.5 * s, 4, 10)), woodMat());
    body.scale.set(1, 1, 0.45);
    body.position.set(0.05, 0.75 * s, 0.38);
    body.rotation.x = -0.12;
    const neck = new THREE.Mesh(geo('cneck' + kind, () => new THREE.CylinderGeometry(0.02, 0.02, 0.7 * s, 6)), woodMat());
    neck.position.set(0.05, 1.35 * s, 0.3);
    neck.rotation.x = -0.12;
    arms.r.rotation.set(-0.3, 0, 0.9);
    const bow = new THREE.Mesh(geo('cbow', () => new THREE.CylinderGeometry(0.01, 0.01, 0.7, 5)), woodMat());
    bow.position.set(0, -0.5, 0.1);
    bow.rotation.z = Math.PI / 2 - 0.15;
    arms.r.add(bow);
    g.add(body, neck);
    parts.bowArm = arms.r;
    parts.bowBaseZ = 0.9;
  } else if (kind === 'flute') {
    const fl = new THREE.Mesh(geo('flute', () => new THREE.CylinderGeometry(0.02, 0.02, 0.55, 8)),
      mat('silver', { color: 0xc0c4cc, roughness: 0.3, metalness: 0.9 }));
    fl.position.set(0.2, 1.3, 0.14);
    fl.rotation.z = Math.PI / 2 + 0.12;
    arms.l.rotation.set(-0.9, 0, -0.7);
    arms.r.rotation.set(-0.9, 0, 0.7);
    g.add(fl);
    parts.instr = fl;
  } else if (kind === 'clarinet') {
    const cl = new THREE.Mesh(geo('clarinet', () => new THREE.CylinderGeometry(0.025, 0.035, 0.6, 8)),
      mat('ebony', { color: 0x201a16, roughness: 0.4 }));
    cl.position.set(0, 1.12, 0.24);
    cl.rotation.x = 0.5;
    arms.l.rotation.set(-0.8, 0, -0.4);
    arms.r.rotation.set(-0.8, 0, 0.4);
    g.add(cl);
    parts.instr = cl;
  } else if (kind === 'trumpet' || kind === 'trombone') {
    const len = kind === 'trombone' ? 0.85 : 0.5;
    const tube = new THREE.Mesh(geo('tube' + kind, () => new THREE.CylinderGeometry(0.025, 0.025, len, 8)), brassMat());
    tube.position.set(0, 1.28, 0.3 + len / 2);
    tube.rotation.x = Math.PI / 2 - 0.1;
    const bell = new THREE.Mesh(geo('bell', () => new THREE.ConeGeometry(0.09, 0.22, 12, 1, true)), brassMat());
    bell.position.set(0, 1.26 + 0.02, 0.3 + len);
    bell.rotation.x = -Math.PI / 2 + 0.1;
    arms.l.rotation.set(-1.1, 0, -0.3);
    arms.r.rotation.set(-1.1, 0, 0.3);
    const grp = new THREE.Group();
    grp.add(tube, bell);
    g.add(grp);
    parts.instr = grp;
  } else if (kind === 'horn') {
    const ring = new THREE.Mesh(geo('hornring', () => new THREE.TorusGeometry(0.16, 0.03, 8, 16)), brassMat());
    ring.position.set(0.16, 1.1, 0.2);
    const bell = new THREE.Mesh(geo('hornbell', () => new THREE.ConeGeometry(0.11, 0.2, 12, 1, true)), brassMat());
    bell.position.set(0.3, 1.02, 0.2);
    bell.rotation.z = -Math.PI / 2;
    arms.l.rotation.set(-0.9, 0, -0.5);
    arms.r.rotation.set(-0.6, 0, 0.8);
    g.add(ring, bell);
    parts.instr = ring;
  } else if (kind === 'timpani') {
    for (const side of [-1, 1]) {
      const kettle = new THREE.Mesh(
        geo('kettle', () => new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)),
        mat('copper', { color: 0xb0682a, roughness: 0.35, metalness: 0.8 }));
      kettle.position.set(side * 0.62, 0.85, 0.75);
      const skin = new THREE.Mesh(geo('tskin', () => new THREE.CircleGeometry(0.49, 20)),
        mat('drumskin', { color: 0xe8dcc8, roughness: 0.8 }));
      skin.position.set(side * 0.62, 0.86, 0.75);
      skin.rotation.x = -Math.PI / 2;
      g.add(kettle, skin);
      const mallet = new THREE.Mesh(geo('mallet', () => new THREE.CylinderGeometry(0.012, 0.012, 0.4, 5)), woodMat());
      mallet.position.set(0, -0.48, 0.05);
      const headM = new THREE.Mesh(geo('malletHead', () => new THREE.SphereGeometry(0.045, 8, 6)),
        mat('felt', { color: 0xdddddd, roughness: 0.9 }));
      headM.position.set(0, -0.68, 0.05);
      const armG = side === 1 ? arms.r : arms.l;
      armG.add(mallet, headM);
      armG.rotation.set(-0.8, 0, side * 0.35);
    }
    parts.standing = true;
  }
  return { g, parts, kind, i, phase: rnd(i) * 6.28, rate: 0.85 + 0.3 * rnd(i + 40) };
}

function chairAndStand(standing) {
  const g = new THREE.Group();
  if (!standing) {
    const seat = new THREE.Mesh(geo('seat', () => new THREE.BoxGeometry(0.46, 0.05, 0.44)),
      mat('chair', { color: 0x14100c, roughness: 0.9 }));
    seat.position.y = 0.52;
    const back = new THREE.Mesh(geo('back', () => new THREE.BoxGeometry(0.44, 0.5, 0.04)), M.chair);
    back.position.set(0, 0.8, -0.22);
    const post = new THREE.Mesh(geo('post', () => new THREE.CylinderGeometry(0.03, 0.05, 0.5, 6)), M.chair);
    post.position.y = 0.26;
    g.add(seat, back, post);
  }
  const pole = new THREE.Mesh(geo('pole', () => new THREE.CylinderGeometry(0.012, 0.02, 1.1, 6)),
    mat('standMetal', { color: 0x22242a, roughness: 0.5, metalness: 0.7 }));
  pole.position.set(0, 0.55, 0.68);
  const desk = new THREE.Mesh(geo('desk', () => new THREE.BoxGeometry(0.36, 0.26, 0.015)), M.standMetal);
  desk.position.set(0, 1.16, 0.72);
  desk.rotation.x = -0.5;
  const paper = new THREE.Mesh(geo('paper', () => new THREE.PlaneGeometry(0.3, 0.2)),
    mat('paper', { color: 0xfff4dc, emissive: 0xfff0d0, emissiveIntensity: 0.35, roughness: 1 }));
  paper.position.set(0, 1.17, 0.715);
  paper.rotation.x = -0.5;
  g.add(pole, desk, paper);
  return g;
}

const LAYOUT = [
  { section: 'violins', kinds: ['violin'], rows: [[6.2, -1.12, -0.42, 4], [8.2, -1.08, -0.38, 4]], rise: 0 },
  { section: 'winds', kinds: ['flute', 'flute', 'clarinet', 'clarinet'], rows: [[10.6, -0.24, 0.16, 4]], rise: 0.22 },
  { section: 'brass', kinds: ['trumpet', 'trumpet', 'horn', 'trombone'], rows: [[12.6, 0.02, 0.48, 4]], rise: 0.44 },
  { section: 'celli', kinds: ['cello'], rows: [[6.2, 0.44, 0.86, 2], [8.2, 0.42, 0.9, 2]], rise: 0 },
  { section: 'celli', kinds: ['bass'], rows: [[10.8, 0.62, 0.88, 2]], rise: 0 },
  { section: 'timpani', kinds: ['timpani'], rows: [[13.4, 0.72, 0.72, 1]], rise: 0.66 },
];

// arc-shaped riser platforms under the rear sections (shape XY → world XZ)
function riser(scene, rIn, rOut, a0, a1, h) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, rOut, Math.PI / 2 - a1, Math.PI / 2 - a0, false);
  shape.absarc(0, 0, rIn, Math.PI / 2 - a0, Math.PI / 2 - a1, true);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  const m = new THREE.Mesh(geo, mat('riser', { color: 0x3a2a1c, roughness: 0.8 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0, CONDUCTOR.z);
  m.receiveShadow = true;
  scene.add(m);
}

export class Stage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0910);
    this.scene.fog = new THREE.Fog(0x0b0910, 18, 42);

    this.camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100);
    this.camera.position.set(0, 3.3, 9.2);
    this.camera.lookAt(0, 1.3, -2);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(26, 48),
      new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wall = new THREE.Mesh(new THREE.PlaneGeometry(70, 24),
      new THREE.MeshStandardMaterial({ color: 0x16121c, roughness: 1 }));
    wall.position.set(0, 10, -9);
    this.scene.add(wall);
    for (const side of [-1, 1]) {
      const curtain = new THREE.Mesh(new THREE.PlaneGeometry(10, 20),
        new THREE.MeshStandardMaterial({ color: 0x3a1016, roughness: 1 }));
      curtain.position.set(side * 15, 8, -2);
      curtain.rotation.y = -side * 0.9;
      this.scene.add(curtain);
    }
    const lightGeo = new THREE.SphereGeometry(0.1, 8, 6);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
    for (let i = 0; i < 14; i++) {
      const a = -1.4 + 2.8 * i / 13;
      const bulb = new THREE.Mesh(lightGeo, lightMat);
      bulb.position.set(Math.sin(a) * 17, 8.5 + Math.cos(a * 2) * 0.6, 9 - Math.cos(a) * 17);
      this.scene.add(bulb);
    }

    const podium = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x35231a, roughness: 0.6 }));
    podium.position.set(0, 0.27, 8.6);
    this.scene.add(podium);

    riser(this.scene, 9.7, 11.5, -0.36, 0.28, 0.22);
    riser(this.scene, 11.7, 13.5, -0.08, 0.6, 0.44);
    riser(this.scene, 12.5, 14.3, 0.5, 0.95, 0.66);

    // organ pipes on the back wall — one merged mesh, one draw call
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.35, metalness: 0.9 });
    const pipeGeos = [];
    for (let i = 0; i < 17; i++) {
      const hPipe = 2.6 + 2.6 * Math.cos((i - 8) / 8 * Math.PI / 2);
      const g = new THREE.CylinderGeometry(0.17, 0.17, hPipe, 10);
      g.translate((i - 8) * 0.55, 5.6 + hPipe / 2, -8.6);
      pipeGeos.push(g);
    }
    this.scene.add(new THREE.Mesh(mergeGeometries(pipeGeos), pipeMat));

    // chandeliers (emissive — bloom picks them up)
    const chMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const chGeo = new THREE.SphereGeometry(0.07, 8, 6);
    for (const cx of [-8, 0, 8]) {
      const ch = new THREE.Group();
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), chMat);
      ch.add(core);
      for (let i = 0; i < 8; i++) {
        const b = new THREE.Mesh(chGeo, chMat);
        b.position.set(Math.cos(i / 8 * Math.PI * 2) * 0.5, -0.18, Math.sin(i / 8 * Math.PI * 2) * 0.5);
        ch.add(b);
      }
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.6, 4),
        new THREE.MeshStandardMaterial({ color: 0x222222 }));
      stem.position.y = 0.9;
      ch.add(stem);
      ch.position.set(cx, 5.4, -0.5); // must stay under ~5.9 to be inside the frustum at this depth
      this.scene.add(ch);
    }

    this.scene.add(new THREE.HemisphereLight(0x2a2438, 0x0f0a06, 0.7));
    const key = new THREE.SpotLight(0xffe8c8, 900, 0, 1.05, 0.5, 1.6);
    key.position.set(0, 13, 6);
    key.target.position.set(0, 1, -1);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key, key.target);
    this.key = key;
    this.keyBase = 900;
    const fillL = new THREE.SpotLight(0x6a7ab8, 350, 0, 1.1, 0.7, 1.6);
    fillL.position.set(-12, 8, 12);
    fillL.target.position.set(-3, 1, -2);
    const fillR = new THREE.SpotLight(0xb87a4a, 300, 0, 1.1, 0.7, 1.6);
    fillR.position.set(12, 8, 12);
    fillR.target.position.set(3, 1, -2);
    this.scene.add(fillL, fillL.target, fillR, fillR.target);

    // players
    this.players = [];
    this.sections = {};
    for (const name of Object.keys(SECTIONS)) {
      this.sections[name] = { players: [], centroid: new THREE.Vector3(), spot: null, ring: null };
    }
    let pi = 0;
    const staticBuckets = new Map(); // material → world-space geometries, merged below
    for (const block of LAYOUT) {
      let ki = 0;
      for (const [r, a0, a1, count] of block.rows) {
        for (let j = 0; j < count; j++) {
          const a = count === 1 ? (a0 + a1) / 2 : a0 + (a1 - a0) * j / (count - 1);
          const kind = block.kinds[Math.min(block.kinds.length - 1, ki)];
          const p = makePlayer(kind, pi++);
          ki++;
          const x = Math.sin(a) * r, z = CONDUCTOR.z - Math.cos(a) * r;
          p.g.position.set(x, block.rise || 0, z);
          p.g.rotation.y = Math.atan2(CONDUCTOR.x - x, CONDUCTOR.z - z);
          const cs = chairAndStand(p.parts.standing || kind === 'bass');
          cs.position.copy(p.g.position);
          cs.rotation.y = p.g.rotation.y;
          cs.updateMatrixWorld(true);
          cs.traverse(o => { // chairs/stands never move: bucket for merging
            if (!o.isMesh) return;
            const g2 = o.geometry.clone().applyMatrix4(o.matrixWorld);
            if (!staticBuckets.has(o.material)) staticBuckets.set(o.material, []);
            staticBuckets.get(o.material).push(g2);
          });
          p.g.traverse(o => { if (o.isMesh) o.castShadow = true; }); // instruments too
          this.scene.add(p.g);
          this.players.push(p);
          const sec = this.sections[block.section];
          sec.players.push(p);
          sec.centroid.add(p.g.position);
          sec.rise = Math.max(sec.rise || 0, block.rise || 0);
        }
      }
    }
    for (const [material, geos] of staticBuckets) {
      this.scene.add(new THREE.Mesh(mergeGeometries(geos), material));
    }

    for (const [name, sec] of Object.entries(this.sections)) {
      if (!sec.players.length) continue;
      sec.centroid.divideScalar(sec.players.length);
      const col = new THREE.Color(SECTIONS[name].color);
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.7, 40),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(sec.centroid.x, (sec.rise || 0) + 0.03, sec.centroid.z); // sit on the riser, not inside it
      this.scene.add(ring);
      sec.ring = ring;
    }
    // one shared cue spotlight — per-section spots multiply every draw's light cost
    this.cueSpot = new THREE.SpotLight(0xffffff, 0, 0, 0.55, 0.5, 1.8);
    this.cueSpot.position.set(0, 8, 0);
    this.scene.add(this.cueSpot, this.cueSpot.target);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.4, 0.6, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.t = 0;
    this._fps = 60;
    this._qTimer = 0;
    this._quality = 2; // 2 full, 1 no bloom + 1x pixels, 0 also no shadows
    this.autoPan = true;
    this._look = new THREE.Vector3(0, 1.3, -2);
    this._lookTarget = new THREE.Vector3(0, 1.3, -2);
    this._camPos = new THREE.Vector3(0, 3.3, 9.2);
    this._v1 = new THREE.Vector3();
    this._shot = { type: 'podium', t0: 0, until: 7, dir: 1, a0: 0 };
    this._shotIdx = 0;
    this.resize(innerWidth, innerHeight);
  }

  resize(w, h) {
    this._w = w; this._h = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  // cinematic shots: orbit / crane / dolly / section close-up / podium, 7-12s each
  _pickShot(t, s) {
    const i = ++this._shotIdx;
    const r2 = rnd(i * 13.7);
    const type = r2 < 0.3 ? 'podium' : r2 < 0.55 ? 'orbit' : r2 < 0.7 ? 'crane' : r2 < 0.85 ? 'dolly' : 'section';
    let sec = null;
    if (type === 'section') {
      const bands = s.bands || [0, 0, 0, 0];
      const names = ['celli', 'winds', 'brass', 'violins'];
      let bi = 3;
      for (let b = 0; b < 4; b++) if (bands[b] > bands[bi]) bi = b;
      sec = this.sections[names[bi]];
      if (!sec || !sec.players.length) sec = this.sections.violins;
    }
    this._shot = {
      type, sec, t0: t,
      until: t + 7 + rnd(i * 7.3) * 5,
      dir: rnd(i * 3.9) > 0.5 ? 1 : -1,
      a0: (rnd(i * 3.1) - 0.5) * 1.6,
    };
  }

  _shotPose(t, e, pulse) {
    const sh = this._shot;
    const u = Math.min(1, (t - sh.t0) / Math.max(0.1, sh.until - sh.t0));
    switch (sh.type) {
      case 'orbit': { // sweep around outside the ensemble (players sit r 6-14)
        const a = sh.a0 + sh.dir * 0.45 * u;
        return [Math.sin(a) * 16, 5.2 + 0.8 * u, CONDUCTOR.z - Math.cos(a) * 16, 0, 1.2, -2];
      }
      case 'crane': // descend from the rig toward the stage
        return [Math.sin(t * 0.05) * 2, 8.4 - 2.6 * u, 7 - 3 * u, 0, 0.8, -3];
      case 'dolly': { // track across the front, safely in front of the first desks
        const x = sh.dir * (-6.5 + 13 * u);
        return [x, 2.4, 7.2, x * 0.25, 1.2, -1];
      }
      case 'section': { // close on the loudest section, drifting slightly
        const c = sh.sec.centroid;
        const dx = -c.x, dz = CONDUCTOR.z - c.z;
        const dl = Math.hypot(dx, dz) || 1;
        return [c.x + (dx / dl) * 5 + Math.sin(u * 1.3) * 0.8, 2.6, c.z + (dz / dl) * 5, c.x, 1.1, c.z];
      }
      default: // podium: the conducting home view, breathing with the music
        return [Math.sin(t * 0.15) * 0.9, 3.28 + Math.sin(t * 0.2) * 0.1 + e * 0.15, 9.2 - pulse * 0.12, 0, 1.3, -2];
    }
  }

  // one-way degrade when frame rate can't hold — sluggish beats pretty
  _governQuality(dt) {
    this._fps += (1 / Math.max(dt, 1e-3) - this._fps) * 0.04;
    this._qTimer += dt;
    if (this.t < 6 || this._qTimer < 2.5) return; // let shaders warm up first
    this._qTimer = 0;
    if (this._quality === 2 && this._fps < 45) {
      this._quality = 1;
      this.bloom.enabled = false;
      this.renderer.setPixelRatio(1);
      this.composer.setPixelRatio(1);
      this.resize(this._w, this._h);
      console.info('[perf] fps', Math.round(this._fps), '— bloom off, 1x pixels');
    } else if (this._quality === 1 && this._fps < 36) {
      this._quality = 0;
      this.key.castShadow = false;
      console.info('[perf] fps', Math.round(this._fps), '— shadows off');
    }
  }

  update(dt, s = {}) {
    this.t += dt;
    this._governQuality(dt);
    const t = this.t;
    const bands = s.bands || [0, 0, 0, 0];
    const energy = { celli: bands[0], winds: bands[1], brass: bands[2], violins: bands[3], timpani: Math.max(bands[0], s.timp || 0) };
    const pulse = s.pulse || 0;

    for (const [name, sec] of Object.entries(this.sections)) {
      const e = energy[name] ?? 0;
      const active = s.cue === name || s.cue === 'tutti';
      for (const p of sec.players) {
        const pr = p.parts;
        p.phase += dt * (1.5 + 9 * e) * p.rate;
        if (pr.bowArm) {
          pr.bowArm.rotation.z = pr.bowBaseZ + Math.sin(p.phase * 4) * (0.1 + 0.3 * e);
        } else if (pr.instr && p.kind !== 'timpani') {
          pr.instr.rotation.x = (pr.instrBaseX ??= pr.instr.rotation.x) - 0.18 * e;
          pr.instr.position.y = (pr.instrBaseY ??= pr.instr.position.y) + Math.sin(t * 2.2 + p.phase) * 0.012 * (0.3 + e);
        }
        if (p.kind === 'timpani') {
          const hit = s.timp || 0;
          pr.arms.r.rotation.x = -0.8 - 0.9 * hit;
          pr.arms.l.rotation.x = -0.8 - 0.9 * Math.max(0, hit - 0.3);
        }
        p.g.rotation.z = Math.sin(t * 0.9 + p.phase) * 0.015 * (0.5 + e);
        p.g.scale.y = 1 + Math.sin(t * 1.3 + p.phase) * 0.006;
      }
      if (sec.ring) {
        sec.ring.material.opacity += ((active ? 0.4 : 0) - sec.ring.material.opacity) * Math.min(1, dt * 5);
        if (active) sec.ring.scale.setScalar(1 + 0.05 * Math.sin(t * 7));
      }
    }
    const cueSec = s.cue && this.sections[s.cue];
    if (cueSec && cueSec.players.length) {
      this.cueSpot.position.set(cueSec.centroid.x, 8, cueSec.centroid.z);
      this.cueSpot.target.position.copy(cueSec.centroid);
      this.cueSpot.angle = 0.55;
      this.cueSpot.color.set(SECTIONS[s.cue].color);
    } else if (s.cue === 'tutti') {
      this.cueSpot.position.set(0, 9, 2);
      this.cueSpot.target.position.set(0, 1, -3);
      this.cueSpot.angle = 1.1;
      this.cueSpot.color.set(SECTIONS.tutti.color);
    }
    this.cueSpot.intensity += ((s.cue ? 700 : 0) - this.cueSpot.intensity) * Math.min(1, dt * 6);

    this.key.intensity = this.keyBase * (1 + 0.13 * pulse);
    if (this.autoPan) {
      const e = (bands[0] + bands[1] + bands[2] + bands[3]) / 4;
      if (s.bands) {
        // any cue near its scoring window forces the podium shot: fixed screen
        // thirds must stay valid while the player points at a section
        if ((s.cuePending || s.cueSoon) && this._shot.type !== 'podium') {
          this._shot = { type: 'podium', t0: t, until: t + 5, dir: 1, a0: 0 };
        } else if (t > this._shot.until) {
          // dense cue passages: hold the podium instead of a one-frame foreign shot
          if (s.cuePending || s.cueSoon) this._shot.until = t + 2;
          else this._pickShot(t, s);
        }
      }
      const [px, py, pz, lx, ly, lz] = this._shotPose(t, e, pulse);
      this._camPos.lerp(this._v1.set(px, py, pz), Math.min(1, dt * 2));
      // after a cue resolves, let the gaze find the section that just entered
      if (cueSec && cueSec.players.length && !s.cuePending && this._shot.type === 'podium') {
        this._lookTarget.set(cueSec.centroid.x * 0.85, 1.3, cueSec.centroid.z * 0.85);
      } else {
        this._lookTarget.set(lx, ly, lz);
      }
    } else {
      this._camPos.set(Math.sin(t * 0.35) * 0.07, 3.3 + Math.sin(t * 0.8) * 0.035, 9.2);
      this._lookTarget.set(0, 1.3, -2);
    }
    this._look.lerp(this._lookTarget, Math.min(1, dt * 1.8));
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._look);
    this.composer.render();
  }
}
