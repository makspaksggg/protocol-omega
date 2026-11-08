// Procedural low-poly human in a hazmat suit + procedural animation.
// Human proportions (~1.85 m), faceted flat-shaded geometry, a face visible behind the visor
// whose mouth moves when the player talks. No external assets needed.
import * as THREE from 'three';
import { ps1 } from './ps1.js';

export const SUIT_COLORS = ['#e8b923', '#e86a23', '#d9d9d0', '#5fae3c', '#3c8fd9', '#c94141', '#9b59d0', '#2fb8a8'];
export const ACCESSORIES = ['none', 'cap', 'antenna', 'goggles', 'cone', 'crown'];
const SKIN_TONES = [0xf1c8a5, 0xe0ac84, 0xc68c64, 0x9c6844, 0x6e4a32, 0xf5d5bd];
const HAIR_COLORS = [0x1a1410, 0x3b2716, 0x6b4a2b, 0xa07040, 0x2a2a2a, 0x8a3b1e];

function numberTexture(number, color) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 64, 32);
  g.fillStyle = '#111'; g.fillRect(4, 4, 56, 24);
  g.fillStyle = '#f2f2e8';
  g.font = 'bold 15px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(number), 32, 17);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function nameSprite(name, number) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  g.font = 'bold 13px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 4, 128, 24);
  g.fillStyle = '#e8e8d8'; g.fillText(`${name} #${number}`, 64, 16);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, transparent: true, fog: true }));
  s.scale.set(1.6, 0.4, 1);
  return s;
}

// ---------- Low-poly geometry helpers ----------
const mesh = (geo, mat) => new THREE.Mesh(geo, mat);
/** Revolved profile [[radius, y], ...] with few segments => faceted body parts. */
const lathe = (profile, seg = 8) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
/** Tapered limb segment hanging down from its pivot. */
function limbGeo(rTop, rBottom, len, seg = 7) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, len, seg, 2);
  // Slight bulge in the middle: baggy suit fabric
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (Math.abs(y) < len * 0.3) { p.setX(i, p.getX(i) * 1.08); p.setZ(i, p.getZ(i) * 1.08); }
  }
  g.translate(0, -len / 2, 0);
  g.computeVertexNormals();
  return g;
}
const ball = (r, w = 7, h = 5) => new THREE.SphereGeometry(r, w, h);

export class HazmatModel {
  /** @param {{color:string, number:number, name:string, accessory:string}} p */
  constructor(p, { withNameTag = true } = {}) {
    this.root = new THREE.Group();
    const lam = (color, extra = {}) => ps1(new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra }));
    const suitColor = new THREE.Color(p.color);
    const suit = lam(suitColor);
    const suitDark = lam(suitColor.clone().multiplyScalar(0.72));
    const tape = lam(0x1d1d1b);          // duct tape at wrists / ankles / zipper
    const rubber = lam(0x2b2b28);        // gloves and boots
    const tankMat = lam(0xb9bdb5);
    const seed = p.number || 0;
    const skin = lam(SKIN_TONES[seed % SKIN_TONES.length]);
    const hair = lam(HAIR_COLORS[(seed >> 3) % HAIR_COLORS.length]);

    // Hips pivot: everything hangs from it.
    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    this.root.add(this.hips);

    // --- Torso: pelvis + chest revolved, squashed front-to-back ---
    const pelvis = mesh(lathe([[0.0, -0.1], [0.15, -0.1], [0.19, -0.02], [0.185, 0.08]]), suit);
    pelvis.scale.z = 0.72; this.hips.add(pelvis);
    const torso = mesh(lathe([
      [0.185, 0.06], [0.2, 0.18], [0.225, 0.34], [0.235, 0.46], [0.215, 0.56], [0.13, 0.63], [0.0, 0.65],
    ]), suit);
    torso.scale.z = 0.68; this.hips.add(torso);
    this.torso = torso;
    const belt = mesh(new THREE.CylinderGeometry(0.192, 0.192, 0.05, 8), tape);
    belt.scale.z = 0.72; belt.position.y = 0.06; this.hips.add(belt);
    const zipper = mesh(new THREE.BoxGeometry(0.025, 0.5, 0.01), tape);
    zipper.position.set(0, 0.36, 0.158); zipper.rotation.x = -0.06; this.hips.add(zipper);

    // Hood collar flaring from neck to shoulders
    const collar = mesh(lathe([[0.22, 0.0], [0.17, 0.06], [0.12, 0.12], [0.11, 0.16]], 8), suitDark);
    collar.scale.z = 0.8; collar.position.y = 0.55; this.hips.add(collar);

    // Breathing tank on the back with straps
    const tank = mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.48, 7), tankMat);
    tank.position.set(0, 0.36, -0.22); this.hips.add(tank);
    const valve = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 6), rubber);
    valve.position.set(0, 0.63, -0.22); this.hips.add(valve);
    for (const x of [-0.1, 0.1]) {
      // Harness straps: down the back and over the shoulders only
      const back = mesh(new THREE.BoxGeometry(0.035, 0.42, 0.02), tape);
      back.position.set(x, 0.34, -0.152); back.rotation.x = 0.08; this.hips.add(back);
      const over = mesh(new THREE.BoxGeometry(0.036, 0.02, 0.2), tape);
      over.position.set(x * 1.15, 0.585, -0.03); this.hips.add(over);
    }
    const plate = mesh(new THREE.PlaneGeometry(0.26, 0.13), new THREE.MeshBasicMaterial({ map: numberTexture(p.number, p.color) }));
    plate.position.set(0, 0.2, -0.312); plate.rotation.y = Math.PI; this.hips.add(plate);
    const chest = mesh(new THREE.PlaneGeometry(0.15, 0.075), new THREE.MeshBasicMaterial({ map: numberTexture(p.number, p.color) }));
    chest.position.set(0.1, 0.44, 0.162); chest.rotation.x = -0.12; this.hips.add(chest);

    // --- Head: neck, hood, visor, face inside, respirator ---
    this.head = new THREE.Group();
    this.head.position.y = 0.66;
    this.hips.add(this.head);
    const neck = mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.12, 7), suitDark);
    neck.position.y = 0.04; this.head.add(neck);

    // Face (visible through the visor)
    const face = new THREE.Group();
    face.position.set(0, 0.2, 0.02);
    this.head.add(face);
    const skull = mesh(ball(0.105, 8, 6), skin); skull.scale.set(0.92, 1.12, 1); face.add(skull);
    const hairCap = mesh(new THREE.SphereGeometry(0.11, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.42), hair);
    hairCap.position.y = 0.025; hairCap.scale.set(0.95, 1.1, 1.02); face.add(hairCap);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0c0c0c });
    const browMat = new THREE.MeshBasicMaterial({ color: 0x1a1410 });
    for (const x of [-0.036, 0.036]) {
      const eye = mesh(new THREE.BoxGeometry(0.022, 0.024, 0.01), eyeMat);
      eye.position.set(x, 0.018, 0.098); face.add(eye);
      const brow = mesh(new THREE.BoxGeometry(0.032, 0.008, 0.01), browMat);
      brow.position.set(x, 0.045, 0.097); brow.rotation.z = x > 0 ? -0.15 : 0.15; face.add(brow);
    }
    const nose = mesh(new THREE.ConeGeometry(0.014, 0.035, 4), skin);
    nose.rotation.x = Math.PI / 2; nose.position.set(0, -0.008, 0.106); face.add(nose);
    this.mouth = mesh(new THREE.BoxGeometry(0.04, 0.012, 0.01), new THREE.MeshBasicMaterial({ color: 0x3a1010 }));
    this.mouth.position.set(0, -0.05, 0.093); face.add(this.mouth);

    // Hood: faceted dome around the head, open at the front for the visor
    const hood = mesh(new THREE.SphereGeometry(0.165, 8, 6, Math.PI * 0.8, Math.PI * 1.4), suit);
    hood.scale.set(1, 1.18, 1.05); hood.position.y = 0.2; this.head.add(hood);
    hood.material.side = THREE.DoubleSide;
    const hoodTop = mesh(new THREE.SphereGeometry(0.168, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.3), suit);
    hoodTop.scale.set(1, 1.18, 1.05); hoodTop.position.y = 0.2; this.head.add(hoodTop);
    // Visor: curved tinted glass
    this.visorMat = new THREE.MeshPhongMaterial({
      color: 0x335544, specular: 0xbbffdd, shininess: 90, transparent: true, opacity: 0.38, flatShading: true,
    });
    const visor = mesh(new THREE.SphereGeometry(0.162, 8, 4, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.27, Math.PI * 0.36), this.visorMat);
    visor.scale.set(1, 1.18, 1.05); visor.position.y = 0.2; visor.renderOrder = 2; this.head.add(visor);
    // Respirator: mouthpiece + twin filters
    const mask = mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.06, 6), rubber);
    mask.rotation.x = Math.PI / 2; mask.position.set(0, 0.1, 0.15); this.head.add(mask);
    for (const x of [-1, 1]) {
      const f = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 7), tape);
      f.rotation.set(Math.PI / 2, 0, x * 0.7); f.position.set(x * 0.06, 0.09, 0.16); this.head.add(f);
    }
    // Talk lamp on the hood (green while speaking)
    this.talkLamp = mesh(new THREE.BoxGeometry(0.04, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0x223322 }));
    this.talkLamp.position.set(0.13, 0.33, 0.07);
    this.head.add(this.talkLamp);
    this.addAccessory(p.accessory);

    // --- Limbs ---
    const arm = (side) => {
      const upper = new THREE.Group(); upper.position.set(side * 0.25, 0.53, 0); this.hips.add(upper);
      upper.add(mesh(ball(0.085), suit));                                  // shoulder
      upper.add(mesh(limbGeo(0.078, 0.064, 0.3), suit));
      const lower = new THREE.Group(); lower.position.y = -0.3; upper.add(lower);
      lower.add(mesh(ball(0.064, 6, 4), suit));                            // elbow
      lower.add(mesh(limbGeo(0.064, 0.05, 0.26), suit));
      const cuff = mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.04, 7), tape);
      cuff.position.y = -0.25; lower.add(cuff);
      const hand = new THREE.Group(); hand.position.y = -0.29; lower.add(hand);
      const palm = mesh(ball(0.05, 6, 4), rubber); palm.scale.set(0.9, 1.25, 0.55); palm.position.y = -0.03; hand.add(palm);
      const thumb = mesh(limbGeo(0.016, 0.013, 0.05, 5), rubber);
      thumb.position.set(side * -0.035, -0.01, 0.02); thumb.rotation.set(0.3, 0, side * -0.7); hand.add(thumb);
      return { upper, lower, hand };
    };
    const leg = (side) => {
      const upper = new THREE.Group(); upper.position.set(side * 0.1, 0, 0); this.hips.add(upper);
      upper.add(mesh(limbGeo(0.105, 0.08, 0.44), suit));
      const lower = new THREE.Group(); lower.position.y = -0.44; upper.add(lower);
      lower.add(mesh(ball(0.08, 6, 4), suit));                             // knee
      lower.add(mesh(limbGeo(0.08, 0.066, 0.32), suit));
      const shaft = mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.12, 7), rubber);
      shaft.position.y = -0.34; lower.add(shaft);
      const foot = mesh(new THREE.BoxGeometry(0.12, 0.08, 0.25), rubber);
      foot.position.set(0, -0.4 + 0.02, 0.05); lower.add(foot);
      const toe = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 6, 1, false, 0, Math.PI), rubber);
      toe.rotation.set(0, Math.PI / 2, Math.PI / 2); toe.position.set(0, -0.38, 0.175); lower.add(toe);
      return { upper, lower };
    };
    this.armL = arm(1); this.armR = arm(-1);
    this.legL = leg(1); this.legR = leg(-1);

    this.root.traverse((o) => { if (o.isMesh && o.material !== this.visorMat) o.castShadow = true; });

    if (withNameTag) {
      this.tag = nameSprite(p.name, p.number);
      this.tag.position.y = 2.2;
      this.root.add(this.tag);
    }
    this.phase = 0;
    this.speed = 0;
    this.talkT = 0;
  }

  addAccessory(kind) {
    const h = this.head;
    const mat = (c) => ps1(new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
    const top = 0.4;
    if (kind === 'cap') {
      const cap = mesh(new THREE.SphereGeometry(0.175, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.4), mat(0x2b4a7a));
      cap.position.y = 0.23; cap.scale.set(1, 1.1, 1.05); h.add(cap);
      const brim = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 8, 1, false, -Math.PI / 2, Math.PI), mat(0x2b4a7a));
      brim.position.set(0, 0.34, 0.12); brim.rotation.x = 0.15; h.add(brim);
    } else if (kind === 'antenna') {
      const rod = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), mat(0x222222));
      rod.position.set(-0.1, top + 0.1, -0.03); rod.rotation.z = 0.2; h.add(rod);
      const b = mesh(ball(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
      b.position.set(-0.13, top + 0.25, -0.03); h.add(b);
    } else if (kind === 'goggles') {
      const strap = mesh(new THREE.TorusGeometry(0.175, 0.015, 3, 10), mat(0x111111));
      strap.rotation.x = Math.PI / 2; strap.position.y = 0.33; strap.scale.set(1, 1.08, 1); h.add(strap);
      for (const x of [-0.06, 0.06]) {
        const g = mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.04, 7), mat(0x996633));
        g.rotation.x = Math.PI / 2 - 0.5; g.position.set(x, 0.36, 0.14); h.add(g);
      }
    } else if (kind === 'cone') {
      const cone = mesh(new THREE.ConeGeometry(0.15, 0.36, 8), mat(0xff6a10));
      cone.position.y = top + 0.12; h.add(cone);
      const stripe = mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.05, 8), mat(0xf0f0f0));
      stripe.position.y = top + 0.1; h.add(stripe);
    } else if (kind === 'crown') {
      const gold = mat(0xf2c230);
      const ring = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.07, 8, 1, true), gold);
      ring.material.side = THREE.DoubleSide;
      ring.position.y = top; h.add(ring);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const sp = mesh(new THREE.ConeGeometry(0.028, 0.08, 4), gold);
        sp.position.set(Math.sin(a) * 0.115, top + 0.07, Math.cos(a) * 0.115); h.add(sp);
      }
    }
  }

  /**
   * @param {number} dt
   * @param {{speed:number, crouch:boolean, airborne:boolean, pitch:number, talking:boolean}} s
   */
  animate(dt, s) {
    this.speed += (s.speed - this.speed) * Math.min(1, dt * 10);
    const sp = this.speed;
    const moving = sp > 0.2;
    this.phase += dt * (moving ? 2.2 + sp * 1.25 : 0);
    const run = THREE.MathUtils.clamp((sp - 3.5) / 2, 0, 1);
    const amp = Math.min(1, sp / 4) * 0.7 + (moving ? 0.12 : 0);
    const sw = Math.sin(this.phase);
    const idle = Math.sin(performance.now() / 800) * 0.025;

    // Legs: swing + knee bend on the back-swing
    this.legL.upper.rotation.x = sw * amp;
    this.legR.upper.rotation.x = -sw * amp;
    this.legL.lower.rotation.x = Math.max(0, -Math.cos(this.phase)) * amp * (1.2 + run);
    this.legR.lower.rotation.x = Math.max(0, Math.cos(this.phase)) * amp * (1.2 + run);
    // Arms: counter-swing, elbows bend more when running
    this.armL.upper.rotation.x = -sw * amp * 0.75;
    this.armR.upper.rotation.x = sw * amp * 0.75;
    this.armL.lower.rotation.x = -0.2 - amp * 0.3 - run * 0.9;
    this.armR.lower.rotation.x = -0.2 - amp * 0.3 - run * 0.9;
    this.armL.upper.rotation.z = 0.1 + idle;
    this.armR.upper.rotation.z = -0.1 - idle;

    const crouch = s.crouch ? 1 : 0;
    this.hips.position.y = 0.95 - crouch * 0.3 + Math.abs(Math.cos(this.phase)) * 0.045 * amp + idle * 0.25;
    this.hips.rotation.x = crouch * 0.3 + run * 0.18 + sp * 0.01;
    this.torso.rotation.y = sw * amp * 0.08;
    if (crouch) {
      this.legL.upper.rotation.x -= 0.95; this.legR.upper.rotation.x -= 0.95;
      this.legL.lower.rotation.x += 1.45; this.legR.lower.rotation.x += 1.45;
      this.armL.upper.rotation.x -= 0.3; this.armR.upper.rotation.x -= 0.3;
    }
    if (s.airborne) {
      this.legL.upper.rotation.x = -0.7; this.legR.upper.rotation.x = 0.25;
      this.legL.lower.rotation.x = 1.0; this.legR.lower.rotation.x = 0.35;
      this.armL.upper.rotation.z = 0.7; this.armR.upper.rotation.z = -0.7;
    }
    this.head.rotation.x = THREE.MathUtils.clamp(-s.pitch, -0.8, 0.8) * 0.8 - this.hips.rotation.x * 0.7;

    // Talking: lamp + mouth flaps behind the visor
    this.talkLamp.material.color.setHex(s.talking ? 0x44ff66 : 0x223322);
    this.talkT += dt * 18;
    const open = s.talking ? 0.6 + Math.abs(Math.sin(this.talkT) * Math.sin(this.talkT * 0.37)) * 2.2 : 0.6;
    this.mouth.scale.y += (open - this.mouth.scale.y) * Math.min(1, dt * 20);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
  }
}
