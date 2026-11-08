// Test level ("Sector 0 — training block") built from an ASCII grid.
// Later stages replace the fixed map with procedural generation; the API stays the same.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ps1, textures, signTexture } from './ps1.js';

export const CELL = 3;        // metres per grid cell
export const WALL_H = 3.2;    // ceiling height

// # wall   . floor   S spawn (elevator)   C crate   L ceiling lamp   R red emergency light
// H hazard floor stripes   P pillar
const MAP = [
  '##########################',
  '#HHHH#......#.....L......#',
  '#HSSH#..L...#............#',
  '#HSSH#......#...C....C...#',
  '#HHHH.......#............#',
  '###.###..C..####.###...###',
  '#.....#......#.....#.....#',
  '#..R..#..L...#..L..#..L..#',
  '#.....#......#.....#.....#',
  '#.................P......#',
  '###.######.###.....#.....#',
  '#...#....#.#.#..P..###.###',
  '#.L.#.R..#...#.........C.#',
  '#...#....###.#.....#.....#',
  '#.............L....#..R..#',
  '#...#....#...#.....#.....#',
  '##########################',
];

export class Level {
  constructor(scene) {
    this.scene = scene;
    this.grid = MAP.map((row) => row.split(''));
    this.h = this.grid.length;
    this.w = this.grid[0].length;
    this.group = new THREE.Group();
    this.flicker = [];
    this.alarms = [];
    this.spawnPoints = [];
    this.colliders = []; // extra AABBs {minX,maxX,minZ,maxZ,top}
    this.build();
    scene.add(this.group);
  }

  cellAt(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (cz < 0 || cz >= this.h || cx < 0 || cx >= this.w) return '#';
    return this.grid[cz][cx];
  }
  isWall(x, z) { return this.cellAt(x, z) === '#'; }

  /** Number of wall cells between two points (used for voice occlusion). */
  wallsBetween(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    const steps = Math.ceil(dist / 0.5);
    let count = 0, inWall = false;
    for (let i = 1; i < steps; i++) {
      const w = this.isWall(a.x + (dx * i) / steps, a.z + (dz * i) / steps);
      if (w && !inWall) count++;
      inWall = w;
    }
    return count;
  }

  build() {
    const mats = {
      wall: ps1(new THREE.MeshLambertMaterial({ map: textures.wall() })),
      floor: ps1(new THREE.MeshLambertMaterial({ map: textures.floor() })),
      ceiling: ps1(new THREE.MeshLambertMaterial({ map: textures.ceiling() })),
      hazard: ps1(new THREE.MeshLambertMaterial({ map: textures.hazard() })),
      crate: ps1(new THREE.MeshLambertMaterial({ map: textures.crate() })),
      metal: ps1(new THREE.MeshLambertMaterial({ map: textures.metal() })),
    };
    const geo = { wall: [], floor: [], ceiling: [], hazard: [] };
    const plane = (w, h) => new THREE.PlaneGeometry(w, h);

    for (let z = 0; z < this.h; z++) for (let x = 0; x < this.w; x++) {
      const c = this.grid[z][x];
      if (c === '#') continue;
      const cx = x * CELL + CELL / 2, cz = z * CELL + CELL / 2;

      const f = plane(CELL, CELL); f.rotateX(-Math.PI / 2); f.translate(cx, 0, cz);
      (c === 'H' || c === 'S' ? geo.hazard : geo.floor).push(f);
      const ce = plane(CELL, CELL); ce.rotateX(Math.PI / 2); ce.translate(cx, WALL_H, cz);
      geo.ceiling.push(ce);

      // Wall faces only where floor meets wall.
      const sides = [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]];
      for (const [dx, dz, rot] of sides) {
        const n = this.grid[z + dz]?.[x + dx] ?? '#';
        if (n !== '#') continue;
        const wg = plane(CELL, WALL_H);
        wg.rotateY(rot);
        wg.translate(cx + dx * CELL / 2, WALL_H / 2, cz + dz * CELL / 2);
        // UV repeat so textures stay crisp (1 texture per 1.5 m)
        const uv = wg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2);
        geo.wall.push(wg);
      }

      if (c === 'S') this.spawnPoints.push(new THREE.Vector3(cx, 0, cz));
      if (c === 'C') this.addCrate(cx, cz, mats.crate);
      if (c === 'P') this.addPillar(cx, cz, mats.metal);
      if (c === 'L') this.addLamp(cx, cz, 0xfff1d0, false);
      if (c === 'R') this.addLamp(cx, cz, 0xff2010, true);
    }
    for (const [k, list] of Object.entries(geo)) {
      if (!list.length) continue;
      if (k === 'floor' || k === 'ceiling' || k === 'hazard') for (const g of list) {
        const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2);
      }
      const mesh = new THREE.Mesh(mergeGeometries(list), mats[k]);
      mesh.receiveShadow = true;
      mesh.castShadow = k === 'wall';
      this.group.add(mesh);
    }

    // Elevator: back wall sign + doors frame
    this.addSign('SECTOR 0', 1 * CELL + CELL, 2.5, 0.02, 0, 0x000000);
    this.addSign('ELEVATOR Ω', 0.02, 2.5, 2 * CELL + CELL / 2, Math.PI / 2);
    this.addSign('EXIT →', 11 * CELL - 0.02, 2.4, 9 * CELL + CELL / 2, -Math.PI / 2, '#3cff6a');
    this.addSign('⚠ BIOHAZARD', 4 * CELL + CELL / 2, 2.4, 11 * CELL + 0.02, 0, '#ff3a2a');

    this.scene.add(new THREE.AmbientLight(0x1a2018, 0.6));
    this.scene.add(new THREE.HemisphereLight(0x22281c, 0x050505, 0.4));
    this.scene.fog = new THREE.Fog(0x020302, 2, 26);
    this.scene.background = new THREE.Color(0x020302);
  }

  addCrate(x, z, mat) {
    const s = 1.4;
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
    m.position.set(x, s / 2, z);
    m.rotation.y = (x * 7 + z * 3) % 1;
    m.castShadow = m.receiveShadow = true;
    this.group.add(m);
    const r = s * 0.62;
    this.colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, top: s });
  }

  addPillar(x, z, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, WALL_H, 0.9), mat);
    m.position.set(x, WALL_H / 2, z);
    m.castShadow = m.receiveShadow = true;
    this.group.add(m);
    this.colliders.push({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45, top: WALL_H });
  }

  addLamp(x, z, color, alarm) {
    const fixture = new THREE.Mesh(
      new THREE.BoxGeometry(alarm ? 0.3 : 1.2, 0.08, alarm ? 0.3 : 0.25),
      new THREE.MeshBasicMaterial({ color }),
    );
    fixture.position.set(x, WALL_H - 0.05, z);
    this.group.add(fixture);
    const light = new THREE.PointLight(color, alarm ? 6 : 9, alarm ? 9 : 11, 1.6);
    light.position.set(x, WALL_H - 0.4, z);
    this.group.add(light);
    const entry = { light, fixture, base: light.intensity, phase: Math.random() * 100 };
    (alarm ? this.alarms : this.flicker).push(entry);
  }

  addSign(text, x, y, z, rotY, fg) {
    const tex = signTexture(text, { fg: fg || '#d8a51c' });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    this.group.add(m);
  }

  update(time) {
    for (const f of this.flicker) {
      // Mostly steady with occasional dying-tube flicker.
      const n = Math.sin(time * 13 + f.phase) * Math.sin(time * 7.3 + f.phase * 2);
      const off = n > 0.93 || (Math.sin(time * 0.7 + f.phase) > 0.97 && Math.random() < 0.5);
      f.light.intensity = off ? 0.2 : f.base * (0.92 + Math.random() * 0.08);
      f.fixture.material.color.setScalar(off ? 0.2 : 1);
    }
    for (const a of this.alarms) {
      const k = (Math.sin(time * 4 + a.phase) + 1) / 2;
      a.light.intensity = a.base * k * k;
    }
  }
}
