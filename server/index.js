// PROTOCOL OMEGA — game server
// Serves the client, manages rooms (join by code) and relays player state + WebRTC signaling.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 6;
const TICK_HZ = 20;

const STATIC_ROUTES = [
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/')],
  ['/', path.join(ROOT, 'client/')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/health') { res.end('ok'); return; }
  for (const [prefix, dir] of STATIC_ROUTES) {
    if (!url.startsWith(prefix)) continue;
    let file = path.join(dir, url.slice(prefix.length));
    if (!file.startsWith(dir)) break; // path traversal guard
    if (url.endsWith('/')) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

// ---------- Rooms ----------
/** @type {Map<string, Room>} */
const rooms = new Map();
let nextId = 1;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

class Room {
  constructor(code) {
    this.code = code;
    /** @type {Map<number, Player>} */
    this.players = new Map();
    this.hostId = null;
    this.seed = Math.floor(Math.random() * 2 ** 31);
  }
  broadcast(msg, exceptId = null) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.id !== exceptId) p.send(data);
  }
  usedNumbers() { return new Set([...this.players.values()].map((p) => p.number)); }
  roster() { return [...this.players.values()].map((p) => p.publicInfo()); }
}

class Player {
  constructor(ws) {
    this.ws = ws;
    this.id = nextId++;
    this.room = null;
    this.name = 'Prisoner';
    this.color = '#e8b923';
    this.accessory = 'none';
    this.number = 0;
    this.state = null; // last movement state
    this.alive = true;
  }
  send(data) { if (this.ws.readyState === 1) this.ws.send(typeof data === 'string' ? data : JSON.stringify(data)); }
  publicInfo() {
    return { id: this.id, name: this.name, color: this.color, accessory: this.accessory, number: this.number, alive: this.alive };
  }
}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const isColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const ACCESSORIES = new Set(['none', 'cap', 'antenna', 'goggles', 'cone', 'crown']);

function joinRoom(player, room, profile) {
  player.name = clean(profile.name, 16) || 'Prisoner';
  player.color = isColor(profile.color) ? profile.color : '#e8b923';
  player.accessory = ACCESSORIES.has(profile.accessory) ? profile.accessory : 'none';
  const used = room.usedNumbers();
  do { player.number = 1000 + Math.floor(Math.random() * 9000); } while (used.has(player.number));
  player.room = room;
  room.players.set(player.id, player);
  if (room.hostId === null) room.hostId = player.id;

  player.send({ t: 'joined', you: player.id, code: room.code, host: room.hostId, seed: room.seed, players: room.roster() });
  room.broadcast({ t: 'player_joined', player: player.publicInfo() }, player.id);
}

function leaveRoom(player) {
  const room = player.room;
  if (!room) return;
  room.players.delete(player.id);
  player.room = null;
  if (room.players.size === 0) { rooms.delete(room.code); return; }
  if (room.hostId === player.id) room.hostId = room.players.keys().next().value;
  room.broadcast({ t: 'player_left', id: player.id, host: room.hostId });
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  const player = new Player(ws);
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    const room = player.room;

    switch (msg.t) {
      case 'create': {
        if (room) return;
        const r = new Room(makeCode());
        rooms.set(r.code, r);
        joinRoom(player, r, msg.profile || {});
        break;
      }
      case 'join': {
        if (room) return;
        const code = clean(msg.code, 4).toUpperCase();
        const r = rooms.get(code);
        if (!r) return player.send({ t: 'error', code: 'room_not_found' });
        if (r.players.size >= MAX_PLAYERS) return player.send({ t: 'error', code: 'room_full' });
        joinRoom(player, r, msg.profile || {});
        break;
      }
      case 'state': {
        // Movement state from the client: position, yaw, pitch, animation flags.
        if (!room) return;
        const s = msg.s;
        if (!s || !Array.isArray(s.p) || s.p.length !== 3 || !s.p.every(Number.isFinite)) return;
        player.state = {
          p: s.p.map((v) => Math.round(v * 100) / 100),
          y: Number(s.y) || 0,
          x: Number(s.x) || 0,
          m: s.m | 0, // movement bits: 1 moving, 2 sprint, 4 crouch, 8 airborne
          f: s.f ? 1 : 0, // flashlight
          v: s.v ? 1 : 0, // talking
        };
        break;
      }
      case 'signal': {
        // WebRTC signaling relay (offer / answer / ice) between two players of the same room.
        if (!room) return;
        const target = room.players.get(msg.to);
        if (target) target.send({ t: 'signal', from: player.id, data: msg.data });
        break;
      }
      case 'chat': {
        if (!room) return;
        const text = clean(msg.text, 140);
        if (text) room.broadcast({ t: 'chat', from: player.id, text });
        break;
      }
      case 'leave':
        leaveRoom(player);
        break;
    }
  });
  ws.on('close', () => leaveRoom(player));
  ws.on('error', () => {});
});

// Snapshot broadcast: every tick each room gets the states of all its players.
setInterval(() => {
  for (const room of rooms.values()) {
    const states = {};
    for (const p of room.players.values()) if (p.state) states[p.id] = p.state;
    room.broadcast({ t: 'snap', time: Date.now(), states });
  }
}, 1000 / TICK_HZ);

server.listen(PORT, () => console.log(`PROTOCOL OMEGA server on http://localhost:${PORT}`));
