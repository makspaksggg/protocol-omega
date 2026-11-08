// WebSocket connection to the game server with a tiny event emitter.
export class Net {
  constructor() {
    this.handlers = new Map();
    this.ws = null;
  }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }
  emit(type, msg) { for (const fn of this.handlers.get(type) || []) fn(msg); }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('timeout')), 8000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('connection')); };
      ws.onclose = () => this.emit('close', {});
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        this.emit(msg.t, msg);
      };
    });
  }
  send(msg) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  close() { this.ws?.close(); }
}
