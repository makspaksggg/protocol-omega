// Procedural hazmat-suit prisoner model + procedural animation.
// Built from primitives so it fits the PS1 look and needs no external assets.
import * as THREE from 'three';
import { ps1 } from './ps1.js';

export const SUIT_COLORS = ['#e8b923', '#e86a23', '#d9d9d0', '#5fae3c', '#3c8fd9', '#c94141', '#9b59d0', '#2fb8a8'];
export const ACCESSORIES = ['none', 'cap', 'antenna', 'goggles', 'cone', 'crown'];

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

const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

export class HazmatModel {
  /** @param {{color:string, number:number, name:string, accessory:string}} p */
  constructor(p, { withNameTag = true } = {}) {
    this.root = new THREE.Group();
    const suit = ps1(new THREE.MeshLambertMaterial({ color: p.color }));
    const dark = ps1(new THREE.MeshLambertMaterial({ color: 0x1c1c1a }));
    const rubber = ps1(new THREE.MeshLambertMaterial({ color: 0x2a2a26 }));
    const visor = new THREE.MeshPhongMaterial({ color: 0x0c1a14, specular: 0x88ffcc, shininess: 80, emissive: 0x000000 });
    this.visorMat = visor;
    const tankMat = ps1(new THREE.MeshLambertMaterial({ color: 0xb8bcb4 }));

    // Hips pivot drives bobbing; everything hangs from it.
    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    this.root.add(this.hips);

    const torso = box(0.56, 0.62, 0.34, suit); torso.position.y = 0.36; this.hips.add(torso);
    const belt = box(0.58, 0.08, 0.36, dark); belt.position.y = 0.06; this.hips.add(belt);
    this.torso = torso;

    // Air tank + number plate on the back
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), tankMat);
    tank.position.set(0, 0.4, -0.25); this.hips.add(tank);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17),
      new THREE.MeshBasicMaterial({ map: numberTexture(p.number, p.color) }));
    plate.position.set(0, 0.5, -0.36); plate.rotation.y = Math.PI; this.hips.add(plate);
    const chest = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1),
      new THREE.MeshBasicMaterial({ map: numberTexture(p.number, p.color) }));
    chest.position.set(0.13, 0.52, 0.172); this.hips.add(chest);

    // Head: hood + visor + respirator filter
    this.head = new THREE.Group();
    this.head.position.y = 0.78;
    this.hips.add(this.head);
    const hood = box(0.44, 0.42, 0.42, suit); hood.position.y = 0.16; this.head.add(hood);
    const vis = box(0.36, 0.2, 0.05, visor); vis.position.set(0, 0.2, 0.21); this.head.add(vis);
    const filter = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 8), dark);
    filter.rotation.x = Math.PI / 2; filter.position.set(0, 0.04, 0.24); this.head.add(filter);
    // Small helmet lamp lights up when talking (lets others see who is speaking)
    this.talkLamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: 0x223322 }));
    this.talkLamp.position.set(0.16, 0.33, 0.2);
    this.head.add(this.talkLamp);
    this.addAccessory(p.accessory, suit);

    // Limbs: pivot groups at the joints
    const limb = (parent, x, y, upperLen, lowerLen, w, mat, endMat) => {
      const upper = new THREE.Group(); upper.position.set(x, y, 0); parent.add(upper);
      const um = box(w, upperLen, w, mat); um.position.y = -upperLen / 2; upper.add(um);
      const lower = new THREE.Group(); lower.position.y = -upperLen; upper.add(lower);
      const lm = box(w * 0.92, lowerLen, w * 0.92, mat); lm.position.y = -lowerLen / 2; lower.add(lm);
      const end = box(w * 1.05, 0.12, w * 1.3, endMat); end.position.set(0, -lowerLen, 0.03); lower.add(end);
      return { upper, lower };
    };
    this.armL = limb(this.hips, 0.36, 0.62, 0.32, 0.3, 0.15, suit, rubber);
    this.armR = limb(this.hips, -0.36, 0.62, 0.32, 0.3, 0.15, suit, rubber);
    this.legL = limb(this.hips, 0.14, 0, 0.44, 0.4, 0.19, suit, rubber);
    this.legR = limb(this.hips, -0.14, 0, 0.44, 0.4, 0.19, suit, rubber);

    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    if (withNameTag) {
      this.tag = nameSprite(p.name, p.number);
      this.tag.position.y = 2.15;
      this.root.add(this.tag);
    }
    this.phase = 0;
    this.speed = 0;
  }

  addAccessory(kind, suitMat) {
    const h = this.head;
    const mat = (c) => ps1(new THREE.MeshLambertMaterial({ color: c }));
    if (kind === 'cap') {
      const cap = box(0.47, 0.1, 0.46, mat(0x2b4a7a)); cap.position.y = 0.41; h.add(cap);
      const brim = box(0.4, 0.03, 0.2, mat(0x2b4a7a)); brim.position.set(0, 0.38, 0.3); h.add(brim);
    } else if (kind === 'antenna') {
      const rod = box(0.02, 0.35, 0.02, mat(0x222222)); rod.position.set(-0.15, 0.55, 0); h.add(rod);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
      ball.position.set(-0.15, 0.74, 0); h.add(ball);
    } else if (kind === 'goggles') {
      const strap = box(0.46, 0.05, 0.44, mat(0x111111)); strap.position.y = 0.34; h.add(strap);
      for (const x of [-0.09, 0.09]) {
        const g = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 8), mat(0x996633));
        g.rotation.x = Math.PI / 2; g.position.set(x, 0.36, 0.23); h.add(g);
      }
    } else if (kind === 'cone') {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 8), mat(0xff6a10));
      cone.position.y = 0.58; h.add(cone);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.06, 8), mat(0xf0f0f0));
      stripe.position.y = 0.56; h.add(stripe);
    } else if (kind === 'crown') {
      const gold = mat(0xf2c230);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 8, 1, true), gold);
      ring.position.y = 0.42; h.add(ring);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 4), gold);
        sp.position.set(Math.sin(a) * 0.16, 0.5, Math.cos(a) * 0.16); h.add(sp);
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
    const amp = Math.min(1, sp / 4) * 0.75 + (moving ? 0.15 : 0);
    const sw = Math.sin(this.phase);

    const idle = Math.sin(performance.now() / 700) * 0.03;
    this.legL.upper.rotation.x = sw * amp;
    this.legR.upper.rotation.x = -sw * amp;
    this.legL.lower.rotation.x = Math.max(0, -Math.cos(this.phase)) * amp * 1.3;
    this.legR.lower.rotation.x = Math.max(0, Math.cos(this.phase)) * amp * 1.3;
    this.armL.upper.rotation.x = -sw * amp * 0.8;
    this.armR.upper.rotation.x = sw * amp * 0.8;
    this.armL.lower.rotation.x = -0.25 - amp * 0.4;
    this.armR.lower.rotation.x = -0.25 - amp * 0.4;
    this.armL.upper.rotation.z = 0.08 + idle;
    this.armR.upper.rotation.z = -0.08 - idle;

    const crouch = s.crouch ? 1 : 0;
    this.hips.position.y = 0.95 - crouch * 0.32 + Math.abs(Math.cos(this.phase)) * 0.05 * amp + idle * 0.3;
    this.hips.rotation.x = crouch * 0.35 + sp * 0.025;
    if (crouch) {
      this.legL.upper.rotation.x -= 0.9; this.legR.upper.rotation.x -= 0.9;
      this.legL.lower.rotation.x += 1.4; this.legR.lower.rotation.x += 1.4;
    }
    if (s.airborne) {
      this.legL.upper.rotation.x = -0.6; this.legR.upper.rotation.x = 0.2;
      this.legL.lower.rotation.x = 0.9; this.legR.lower.rotation.x = 0.4;
      this.armL.upper.rotation.z = 0.6; this.armR.upper.rotation.z = -0.6;
    }
    this.head.rotation.x = THREE.MathUtils.clamp(-s.pitch, -0.8, 0.8) * 0.8 - this.hips.rotation.x * 0.6;
    this.talkLamp.material.color.setHex(s.talking ? 0x44ff66 : 0x223322);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
  }
}
