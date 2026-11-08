// PROTOCOL OMEGA — client entry point: menu, game loop, remote players, HUD.
import * as THREE from 'three';
import { t, getLang, setLang, applyI18n } from './i18n.js';
import { Net } from './net.js';
import { VoiceChat } from './voice.js';
import { PS1Renderer } from './ps1.js';
import { Level } from './level.js';
import { LocalPlayer } from './player.js';
import { HazmatModel, SUIT_COLORS, ACCESSORIES } from './hazmat.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('po_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('po_' + k, JSON.stringify(v)); } catch {} },
};

// ---------------- Menu ----------------
const profile = {
  name: store.get('name', ''),
  color: store.get('color', SUIT_COLORS[0]),
  accessory: store.get('accessory', 'none'),
};

function buildMenu() {
  applyI18n();
  $('btn-lang').textContent = t('lang_switch');
  $('in-name').value = profile.name;
  $('in-name').placeholder = getLang() === 'ru' ? 'Заключённый' : 'Prisoner';

  const sw = $('swatches');
  sw.innerHTML = '';
  for (const c of SUIT_COLORS) {
    const d = document.createElement('div');
    d.className = 'swatch' + (c === profile.color ? ' active' : '');
    d.style.background = c;
    d.onclick = () => { profile.color = c; store.set('color', c); buildMenu(); };
    sw.appendChild(d);
  }
  const sel = $('in-accessory');
  sel.innerHTML = '';
  for (const a of ACCESSORIES) {
    const o = document.createElement('option');
    o.value = a; o.textContent = t('acc_' + a);
    if (a === profile.accessory) o.selected = true;
    sel.appendChild(o);
  }
}
$('btn-lang').onclick = () => { setLang(getLang() === 'ru' ? 'en' : 'ru'); buildMenu(); };
$('in-name').oninput = (e) => { profile.name = e.target.value; store.set('name', profile.name); };
$('in-accessory').onchange = (e) => { profile.accessory = e.target.value; store.set('accessory', profile.accessory); };
$('in-code').oninput = (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
$('in-code').onkeydown = (e) => { if (e.key === 'Enter') $('btn-join').click(); };
$('btn-create').onclick = () => enter({ t: 'create' });
$('btn-join').onclick = () => {
  const code = $('in-code').value.trim();
  if (code.length !== 4) { $('menu-error').textContent = t('err_code'); return; }
  enter({ t: 'join', code });
};
buildMenu();

// ---------------- Session ----------------
const net = new Net();
const voice = new VoiceChat(net);
window.__voice = voice; // debug / automated tests
let game = null;
let busy = false;

net.on('error', (m) => {
  $('menu-error').textContent = t('err_' + m.code);
  busy = false;
  net.close();
});
net.on('joined', (m) => { if (!game) game = new Game(m); });
net.on('close', () => { if (game) location.reload(); else busy = false; });

async function enter(req) {
  if (busy) return;
  busy = true;
  $('menu-error').textContent = '';
  try {
    await voice.init();         // asks for the microphone (user gesture)
    await net.connect();
  } catch {
    $('menu-error').textContent = t('err_connection');
    busy = false;
    return;
  }
  net.send({ ...req, profile: { ...profile, name: profile.name || $('in-name').placeholder } });
}

// ---------------- Input ----------------
const input = { keys: {}, locked: false, typing: false };

// ---------------- Game ----------------
class Game {
  constructor(joinMsg) {
    this.me = joinMsg.you;
    this.code = joinMsg.code;
    this.hostId = joinMsg.host;
    this.infos = new Map(joinMsg.players.map((p) => [p.id, p]));
    this.remotes = new Map();
    this.alive = true;

    $('menu').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('hud-room').innerHTML = `${t('room_code')} <b>${this.code}</b>`;
    $('pause-code').textContent = this.code;

    // Renderer / scene
    this.canvas = $('game');
    this.ps1 = new PS1Renderer(this.canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 60);
    this.scene.add(this.camera);
    this.level = new Level(this.scene);
    this.player = new LocalPlayer(this.camera, this.level, input);
    const order = [...this.infos.keys()].sort((a, b) => a - b).indexOf(this.me);
    this.player.setSpawn(order);
    this.player.sensitivity = store.get('sens', 1);
    voice.volume = store.get('voiceVol', 1);
    voice.setMode(store.get('voiceMode', 'open'));

    this.resize = () => this.ps1.resize(this.camera);
    window.addEventListener('resize', this.resize);
    this.resize();

    for (const info of this.infos.values()) if (info.id !== this.me) this.addRemote(info);

    // Newcomer calls everyone already in the room.
    for (const id of this.infos.keys()) if (id !== this.me) voice.callPeer(id);

    net.on('player_joined', (m) => {
      this.infos.set(m.player.id, m.player);
      this.addRemote(m.player);
      this.toast(t('joined', { name: m.player.name }));
    });
    net.on('player_left', (m) => {
      const info = this.infos.get(m.id);
      if (info) this.toast(t('left', { name: info.name }));
      this.infos.delete(m.id);
      this.removeRemote(m.id);
      voice.closePeer(m.id);
      this.hostId = m.host;
    });
    net.on('snap', (m) => this.onSnap(m));
    net.on('chat', (m) => this.chatLine(m.from, m.text));

    this.setupInput();
    this.setupPause();
    this.toast(t('welcome'), 3500);
    $('click-to-play').classList.remove('hidden');

    this.clock = new THREE.Clock();
    this.sendTimer = 0;
    this.hudTimer = 0;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    window.__game = this; // debug / automated tests
  }

  // ---- Remote players ----
  addRemote(info) {
    if (this.remotes.has(info.id)) return;
    const model = new HazmatModel(info);
    this.scene.add(model.root);
    const light = new THREE.SpotLight(0xfff3d6, 16, 18, 0.5, 0.5, 1.4);
    light.position.set(0.2, 0.25, 0.25);
    light.target.position.set(0, -0.6, 5);
    model.head.add(light, light.target);
    this.remotes.set(info.id, {
      info, model, light, buffer: [],
      pos: new THREE.Vector3(), yaw: 0, pitch: 0, m: 0, talking: false, seen: false,
    });
  }
  removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.scene.remove(r.model.root);
    r.model.dispose();
    this.remotes.delete(id);
  }

  onSnap(m) {
    const now = performance.now();
    for (const [idStr, s] of Object.entries(m.states)) {
      const id = Number(idStr);
      if (id === this.me) continue;
      const r = this.remotes.get(id);
      if (!r) continue;
      r.buffer.push({ time: now, s });
      if (r.buffer.length > 30) r.buffer.shift();
    }
  }

  interpolate(r) {
    const renderTime = performance.now() - 110; // 110 ms interpolation delay
    const b = r.buffer;
    if (!b.length) return false;
    let a = b[0], c = b[b.length - 1];
    for (let i = 0; i < b.length - 1; i++) {
      if (b[i].time <= renderTime && b[i + 1].time >= renderTime) { a = b[i]; c = b[i + 1]; break; }
    }
    const span = c.time - a.time;
    const k = span > 0 ? THREE.MathUtils.clamp((renderTime - a.time) / span, 0, 1) : 1;
    const pa = a.s.p, pc = c.s.p;
    r.pos.set(pa[0] + (pc[0] - pa[0]) * k, pa[1] + (pc[1] - pa[1]) * k, pa[2] + (pc[2] - pa[2]) * k);
    let dy = c.s.y - a.s.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    r.yaw = a.s.y + dy * k;
    r.pitch = a.s.x + (c.s.x - a.s.x) * k;
    r.m = c.s.m; r.flash = c.s.f; r.netTalking = c.s.v;
    // Derive speed for the walk animation from the two snapshots
    r.speed = span > 0 ? Math.hypot(pc[0] - pa[0], pc[2] - pa[2]) / (span / 1000) : 0;
    return true;
  }

  // ---- Input ----
  setupInput() {
    this.onKeyDown = (e) => {
      if (input.typing) {
        if (e.code === 'Enter') this.sendChat();
        if (e.code === 'Escape') this.closeChat();
        return;
      }
      input.keys[e.code] = true;
      if (!input.locked) return;
      if (e.code === 'KeyF') this.player.toggleFlashlight();
      if (e.code === 'KeyM') voice.setMuted(!voice.muted);
      if (e.code === 'KeyV') voice.setPtt(true);
      if (e.code === 'KeyT') { e.preventDefault(); this.openChat(); }
      if (e.code === 'Space') e.preventDefault();
    };
    this.onKeyUp = (e) => {
      input.keys[e.code] = false;
      if (e.code === 'KeyV') voice.setPtt(false);
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => { input.keys = {}; voice.setPtt(false); });

    this.canvas.addEventListener('click', () => this.lock());
    $('click-to-play').addEventListener('click', () => this.lock());
    document.addEventListener('pointerlockchange', () => {
      input.locked = document.pointerLockElement === this.canvas;
      $('click-to-play').classList.add('hidden');
      if (input.locked) $('pause').classList.add('hidden');
      else if (!input.typing) this.showPause();
    });
    document.addEventListener('mousemove', (e) => {
      if (input.locked) this.player.onMouse(e.movementX, e.movementY);
    });
  }
  lock() {
    voice.ctx?.resume();
    this.canvas.requestPointerLock?.();
  }

  setupPause() {
    const sens = $('set-sens'), vol = $('set-voice'), mode = $('set-voicemode');
    sens.value = this.player.sensitivity;
    vol.value = voice.volume;
    mode.value = voice.mode;
    sens.oninput = () => { this.player.sensitivity = +sens.value; store.set('sens', +sens.value); };
    vol.oninput = () => { voice.volume = +vol.value; store.set('voiceVol', +vol.value); };
    mode.onchange = () => { voice.setMode(mode.value); store.set('voiceMode', mode.value); };
    $('btn-resume').onclick = () => this.lock();
    $('btn-leave').onclick = () => { net.send({ t: 'leave' }); voice.closeAll(); location.reload(); };
  }
  showPause() { $('pause').classList.remove('hidden'); }

  // ---- Chat ----
  openChat() {
    input.typing = true;
    input.keys = {};
    const el = $('chat-input');
    el.classList.remove('hidden');
    el.value = '';
    document.exitPointerLock?.();
    setTimeout(() => el.focus(), 0);
  }
  closeChat() {
    input.typing = false;
    $('chat-input').classList.add('hidden');
    $('chat-input').blur();
    this.lock();
  }
  sendChat() {
    const text = $('chat-input').value.trim();
    if (text) net.send({ t: 'chat', text });
    this.closeChat();
  }
  chatLine(from, text) {
    const info = this.infos.get(from);
    const div = document.createElement('div');
    const name = document.createElement('b');
    name.style.color = info?.color || '#ccc';
    name.textContent = `${info?.name || '?'}: `;
    div.append(name, document.createTextNode(text));
    $('chat-log').appendChild(div);
    setTimeout(() => div.classList.add('fade'), 8000);
    setTimeout(() => div.remove(), 9500);
  }

  toast(text, ms = 2200) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ---- HUD ----
  updateHud() {
    const list = $('hud-players');
    const ids = [...this.infos.keys()].sort((a, b) => a - b);
    list.innerHTML = '';
    for (const id of ids) {
      const info = this.infos.get(id);
      const talking = id === this.me ? voice.talking : this.remotes.get(id)?.talking;
      const row = document.createElement('div');
      row.className = 'pl' + (talking ? ' talking' : '');
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = info.color;
      const mic = document.createElement('span'); mic.className = 'mic';
      const name = document.createElement('span'); name.className = 'name';
      name.textContent = `${info.name} #${info.number}${id === this.hostId ? ' ★' : ''}${id === this.me ? ' ←' : ''}`;
      row.append(dot, mic, name);
      list.appendChild(row);
    }
    const mi = $('mic-indicator');
    if (!voice.hasMic) { mi.textContent = t('mic_none'); mi.className = 'muted'; }
    else if (voice.muted) { mi.textContent = t('mic_muted'); mi.className = 'muted'; }
    else if (voice.mode === 'ptt' && !voice.pttHeld) { mi.textContent = t('mic_ptt'); mi.className = ''; }
    else { mi.textContent = t('mic_live'); mi.className = 'on'; }
  }

  // ---- Main loop ----
  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const time = this.clock.elapsedTime;

    this.player.update(dt);
    this.level.update(time);

    for (const [id, r] of this.remotes) {
      const has = this.interpolate(r);
      r.model.root.visible = has;
      if (!has) continue;
      r.model.root.position.copy(r.pos);
      r.model.root.rotation.y = r.yaw + Math.PI;
      r.talking = voice.remoteLevel(id) > 0.06 || (!voice.peers.get(id)?.chain && r.netTalking);
      r.model.animate(dt, {
        speed: r.speed, crouch: !!(r.m & 4), airborne: !!(r.m & 8), pitch: r.pitch, talking: r.talking,
      });
      r.light.visible = !!r.flash;
      if (r.model.tag) r.model.tag.visible = r.pos.distanceTo(this.camera.position) < 9;
    }

    voice.update(
      this.camera,
      (id) => {
        const r = this.remotes.get(id);
        if (!r) return null;
        return { pos: r.speakPos ? r.speakPos.set(r.pos.x, r.pos.y + 1.6, r.pos.z) : (r.speakPos = r.pos.clone()), alive: r.info.alive !== false };
      },
      (a, b) => this.level.wallsBetween(a, b),
      !this.alive,
    );

    this.sendTimer += dt;
    if (this.sendTimer >= 0.05) {
      this.sendTimer = 0;
      net.send({ t: 'state', s: this.player.netState(voice.talking) });
    }
    this.hudTimer += dt;
    if (this.hudTimer > 0.15) { this.hudTimer = 0; this.updateHud(); }
    $('stamina-fill').style.width = `${this.player.stamina * 100}%`;
    $('stamina-fill').style.background = this.player.exhausted ? '#e2483d' : '';

    this.ps1.render(this.scene, this.camera, time);
  }
}
