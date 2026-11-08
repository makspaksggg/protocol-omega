// First-person controller for the local prisoner: movement, stamina, crouch, jump, flashlight, collisions.
import * as THREE from 'three';
import { WALL_H } from './level.js';

const RADIUS = 0.35;
const EYE = 1.62, EYE_CROUCH = 1.05;
const WALK = 3.2, SPRINT = 5.6, CROUCH = 1.6;
const GRAVITY = 22, JUMP_V = 6.2;

export class LocalPlayer {
  constructor(camera, level, input) {
    this.camera = camera;
    this.level = level;
    this.input = input;
    this.pos = level.spawnPoints[0].clone();
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; // face out of the elevator
    this.pitch = 0;
    this.onGround = true;
    this.crouching = false;
    this.eye = EYE;
    this.stamina = 1;
    this.exhausted = false;
    this.speed = 0;
    this.bob = 0;
    this.sensitivity = 1;

    // Flashlight: a shadow-casting spot light attached to the camera.
    this.flashlight = new THREE.SpotLight(0xfff3d6, 24, 22, 0.5, 0.45, 1.4);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.camera.near = 0.2;
    this.flashlight.shadow.bias = -0.002;
    this.flashlight.position.set(0.25, -0.2, 0);
    this.flashlight.target.position.set(0, -0.3, -5);
    camera.add(this.flashlight, this.flashlight.target);
    this.flashOn = true;
  }

  setSpawn(index) {
    const sp = this.level.spawnPoints;
    this.pos.copy(sp[index % sp.length]);
  }

  toggleFlashlight() {
    this.flashOn = !this.flashOn;
    this.flashlight.visible = this.flashOn;
  }

  onMouse(dx, dy) {
    const k = 0.0022 * this.sensitivity;
    this.yaw -= dx * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k, -1.45, 1.45);
  }

  update(dt) {
    const keys = this.input.keys;
    const enabled = this.input.locked && !this.input.typing;
    let fx = 0, fz = 0;
    if (enabled) {
      if (keys.KeyW) fz -= 1;
      if (keys.KeyS) fz += 1;
      if (keys.KeyA) fx -= 1;
      if (keys.KeyD) fx += 1;
    }
    const moving = fx !== 0 || fz !== 0;

    // Crouch (can't stand up under low obstacles — ceilings are flat for now)
    this.crouching = enabled && (keys.KeyC || keys.ControlLeft);

    // Stamina / sprint
    const wantSprint = enabled && keys.ShiftLeft && moving && !this.crouching && fz <= 0;
    const sprinting = wantSprint && !this.exhausted;
    this.stamina += (sprinting ? -0.22 : 0.15) * dt;
    if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; }
    if (this.exhausted && this.stamina > 0.35) this.exhausted = false;
    this.stamina = Math.min(1, this.stamina);

    const target = this.crouching ? CROUCH : sprinting ? SPRINT : WALK;
    const len = Math.hypot(fx, fz) || 1;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = (fx * cos + fz * sin) / len * target;
    const wz = (-fx * sin + fz * cos) / len * target;
    const accel = this.onGround ? 14 : 3;
    this.vel.x += ((moving ? wx : 0) - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += ((moving ? wz : 0) - this.vel.z) * Math.min(1, accel * dt);

    if (enabled && keys.Space && this.onGround && !this.crouching) {
      this.vel.y = JUMP_V;
      this.onGround = false;
    }
    this.vel.y -= GRAVITY * dt;

    // Integrate with axis-separated collision
    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('z', this.vel.z * dt);
    this.pos.y += this.vel.y * dt;
    const floor = this.floorHeight();
    if (this.pos.y <= floor) { this.pos.y = floor; this.vel.y = 0; this.onGround = true; }
    else this.onGround = this.pos.y - floor < 0.02;
    if (this.pos.y + this.eye + 0.1 > WALL_H) { this.pos.y = WALL_H - this.eye - 0.1; this.vel.y = Math.min(0, this.vel.y); }

    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // Camera: eye height, head bob
    this.eye += ((this.crouching ? EYE_CROUCH : EYE) - this.eye) * Math.min(1, dt * 12);
    if (this.onGround && this.speed > 0.3) this.bob += dt * this.speed * 2.1;
    const bobY = Math.sin(this.bob * 2) * 0.04 * Math.min(1, this.speed / 4);
    const bobX = Math.cos(this.bob) * 0.03 * Math.min(1, this.speed / 4);
    this.camera.position.set(this.pos.x + bobX * cos, this.pos.y + this.eye + bobY, this.pos.z - bobX * sin);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    // Flashlight sways slightly behind view direction
    this.flashlight.target.position.x += (bobX * 4 - this.flashlight.target.position.x) * Math.min(1, dt * 6);
  }

  floorHeight() {
    // Standing on top of crates
    let h = 0;
    for (const c of this.level.colliders) {
      if (this.pos.x + RADIUS * 0.6 > c.minX && this.pos.x - RADIUS * 0.6 < c.maxX &&
          this.pos.z + RADIUS * 0.6 > c.minZ && this.pos.z - RADIUS * 0.6 < c.maxZ &&
          this.pos.y >= c.top - 0.25) h = Math.max(h, c.top);
    }
    return h;
  }

  moveAxis(axis, d) {
    if (!d) return;
    const p = this.pos;
    p[axis] += d;
    // Walls (grid): test the 4 corners of the player's bounding square
    for (const ox of [-RADIUS, RADIUS]) for (const oz of [-RADIUS, RADIUS]) {
      if (this.level.isWall(p.x + ox, p.z + oz)) {
        const CELL = 3;
        if (axis === 'x') p.x = d > 0 ? Math.floor((p.x + RADIUS) / CELL) * CELL - RADIUS - 0.001
                                      : Math.floor((p.x - RADIUS) / CELL + 1) * CELL + RADIUS + 0.001;
        else p.z = d > 0 ? Math.floor((p.z + RADIUS) / CELL) * CELL - RADIUS - 0.001
                         : Math.floor((p.z - RADIUS) / CELL + 1) * CELL + RADIUS + 0.001;
        return;
      }
    }
    // Props
    for (const c of this.level.colliders) {
      if (p.y >= c.top - 0.25) continue; // above it
      if (p.x + RADIUS > c.minX && p.x - RADIUS < c.maxX && p.z + RADIUS > c.minZ && p.z - RADIUS < c.maxZ) {
        if (axis === 'x') p.x = d > 0 ? c.minX - RADIUS - 0.001 : c.maxX + RADIUS + 0.001;
        else p.z = d > 0 ? c.minZ - RADIUS - 0.001 : c.maxZ + RADIUS + 0.001;
      }
    }
  }

  /** Compact state sent to the server. */
  netState(talking) {
    const m = (this.speed > 0.3 ? 1 : 0) | (this.speed > 4.5 ? 2 : 0) | (this.crouching ? 4 : 0) | (!this.onGround ? 8 : 0);
    return {
      p: [this.pos.x, this.pos.y, this.pos.z],
      y: +this.yaw.toFixed(3), x: +this.pitch.toFixed(3),
      m, f: this.flashOn ? 1 : 0, v: talking ? 1 : 0,
    };
  }
}
