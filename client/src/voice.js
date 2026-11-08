// Proximity voice chat: WebRTC mesh (max 6 players = 15 links) + Web Audio 3D positioning.
// Voices fade with distance, are muffled by walls, and later monsters will "hear" the local mic level.

const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  // TURN servers get added here at deploy time for players behind strict NAT.
];

const MAX_HEAR = 32;       // metres: beyond this a voice is silent
const WALL_CUTOFF = 900;   // Hz low-pass per wall between speakers

export class VoiceChat {
  constructor(net) {
    this.net = net;
    this.ctx = null;
    this.localStream = null;
    this.peers = new Map(); // id -> { pc, audio, source, filter, gain, panner, pendingIce, analyser }
    this.muted = false;
    this.mode = 'open';     // 'open' | 'ptt'
    this.pttHeld = false;
    this.volume = 1;
    this.level = 0;         // local mic loudness 0..1 (used for HUD and, later, monster hearing)
    this.micAnalyser = null;
    this.buf = new Float32Array(512);

    net.on('signal', (m) => this.onSignal(m.from, m.data));
  }

  /** Must be called from a user gesture (button click) so the AudioContext may start. */
  async init() {
    if (this.ctx) return this.hasMic;
    this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      const src = this.ctx.createMediaStreamSource(this.localStream);
      this.micAnalyser = this.ctx.createAnalyser();
      this.micAnalyser.fftSize = 512;
      src.connect(this.micAnalyser);
    } catch (e) {
      console.warn('Microphone unavailable:', e);
      this.localStream = null;
    }
    return !!this.localStream;
  }

  get hasMic() { return !!this.localStream; }
  get transmitting() { return this.hasMic && !this.muted && (this.mode === 'open' || this.pttHeld); }
  get talking() { return this.transmitting && this.level > 0.06; }

  setMuted(m) { this.muted = m; this.applyTrackState(); }
  setMode(mode) { this.mode = mode; this.applyTrackState(); }
  setPtt(held) { this.pttHeld = held; this.applyTrackState(); }
  applyTrackState() {
    if (!this.localStream) return;
    for (const tr of this.localStream.getAudioTracks()) tr.enabled = this.transmitting;
  }

  // ---- Connection management ----
  /** Called by the newcomer for every player already in the room (newcomer makes the offers: no glare). */
  async callPeer(id) {
    const peer = this.createPeer(id);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    this.net.send({ t: 'signal', to: id, data: { sdp: peer.pc.localDescription } });
  }

  createPeer(id) {
    this.closePeer(id);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = { pc, pendingIce: [], audio: null, chain: null };
    this.peers.set(id, peer);

    if (this.localStream) for (const tr of this.localStream.getAudioTracks()) pc.addTrack(tr, this.localStream);
    else pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.onicecandidate = (e) => { if (e.candidate) this.net.send({ t: 'signal', to: id, data: { ice: e.candidate } }); };
    pc.ontrack = (e) => this.attachRemote(id, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce?.();
    };
    return peer;
  }

  async onSignal(from, data) {
    try {
      if (data.sdp) {
        let peer = this.peers.get(from);
        if (data.sdp.type === 'offer') {
          peer = this.createPeer(from);
          await peer.pc.setRemoteDescription(data.sdp);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          this.net.send({ t: 'signal', to: from, data: { sdp: peer.pc.localDescription } });
        } else if (peer) {
          await peer.pc.setRemoteDescription(data.sdp);
        }
        if (peer) { for (const c of peer.pendingIce) await peer.pc.addIceCandidate(c).catch(() => {}); peer.pendingIce = []; }
      } else if (data.ice) {
        const peer = this.peers.get(from);
        if (!peer) return;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.ice).catch(() => {});
        else peer.pendingIce.push(data.ice);
      }
    } catch (e) {
      console.warn('signal error', e);
    }
  }

  attachRemote(id, stream) {
    const peer = this.peers.get(id);
    if (!peer || peer.chain) return;
    // Chrome only feeds remote WebRTC audio into Web Audio if the stream is also attached to a media element.
    const audio = new Audio();
    audio.muted = true;
    audio.srcObject = stream;
    audio.play().catch(() => {});
    peer.audio = audio;

    const ctx = this.ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 20000;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.5, maxDistance: 60, rolloffFactor: 1.3,
    });
    source.connect(analyser);
    source.connect(filter).connect(gain).connect(panner).connect(ctx.destination);
    peer.chain = { source, analyser, filter, gain, panner };
  }

  closePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.close();
    if (peer.audio) peer.audio.srcObject = null;
    if (peer.chain) { peer.chain.source.disconnect(); peer.chain.panner.disconnect(); }
    this.peers.delete(id);
  }

  closeAll() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.ctx?.close();
    this.ctx = null;
  }

  rms(analyser) {
    analyser.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    return Math.min(1, Math.sqrt(s / this.buf.length) * 6);
  }

  /** Remote speaker loudness 0..1 (for the "talking" HUD indicator). */
  remoteLevel(id) {
    const c = this.peers.get(id)?.chain;
    return c ? this.rms(c.analyser) : 0;
  }

  /**
   * Per-frame spatial update.
   * @param {THREE.Camera} camera listener
   * @param {(id:number)=>{pos:THREE.Vector3, alive:boolean}|null} getSpeaker
   * @param {(a,b)=>number} wallsBetween
   * @param {boolean} localDead  dead players hear the living, but the living don't hear the dead
   */
  update(camera, getSpeaker, wallsBetween, localDead) {
    if (!this.ctx) return;
    this.level = this.micAnalyser && this.transmitting ? this.rms(this.micAnalyser) : 0;

    const L = this.ctx.listener, t = this.ctx.currentTime;
    const p = camera.position;
    const fwd = camera.getWorldDirection(this._fwd || (this._fwd = p.clone()));
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.03); L.positionY.setTargetAtTime(p.y, t, 0.03); L.positionZ.setTargetAtTime(p.z, t, 0.03);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.03); L.forwardY.setTargetAtTime(fwd.y, t, 0.03); L.forwardZ.setTargetAtTime(fwd.z, t, 0.03);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }

    for (const [id, peer] of this.peers) {
      const c = peer.chain;
      if (!c) continue;
      const sp = getSpeaker(id);
      let g = 0, cutoff = 20000;
      if (sp && (sp.alive || localDead)) {
        const d = sp.pos.distanceTo(p);
        const walls = wallsBetween(p, sp.pos);
        g = d > MAX_HEAR ? 0 : this.volume * (1 - Math.max(0, d - MAX_HEAR * 0.7) / (MAX_HEAR * 0.3));
        g *= Math.pow(0.55, walls);
        cutoff = walls > 0 ? Math.max(250, WALL_CUTOFF / walls) : 20000;
        c.panner.positionX.setTargetAtTime(sp.pos.x, t, 0.05);
        c.panner.positionY.setTargetAtTime(sp.pos.y, t, 0.05);
        c.panner.positionZ.setTargetAtTime(sp.pos.z, t, 0.05);
      }
      c.gain.gain.setTargetAtTime(Math.max(0, g), t, 0.08);
      c.filter.frequency.setTargetAtTime(cutoff, t, 0.1);
    }
  }
}
