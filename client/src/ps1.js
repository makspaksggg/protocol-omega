// PS1-style rendering: low internal resolution, vertex snapping, colour quantization + dithering,
// and procedurally generated pixel textures (no external assets needed).
import * as THREE from 'three';

export const INTERNAL_HEIGHT = 240;

// ---------- Vertex snapping (the classic PS1 "wobble") ----------
const snapUniform = { value: new THREE.Vector2(320, 240) };

/** Patch any built-in material so its vertices snap to a low-res grid. */
export function ps1(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = snapUniform;
    shader.vertexShader = 'uniform vec2 uSnap;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
       vec4 snapped = gl_Position;
       snapped.xyz /= snapped.w;
       snapped.xy = floor(snapped.xy * uSnap * 0.5) / (uSnap * 0.5);
       snapped.xyz *= snapped.w;
       gl_Position = snapped;`,
    );
  };
  material.customProgramCacheKey = () => 'ps1';
  return material;
}

// ---------- Post processing ----------
export class PS1Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.target = new THREE.WebGLRenderTarget(320, 240, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
    });
    this.post = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uRes: { value: new THREE.Vector2(320, 240) },
        uTime: { value: 0 },
        uDamage: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime; uniform float uDamage;
        varying vec2 vUv;
        float bayer(vec2 p){
          int x = int(mod(p.x, 4.0)); int y = int(mod(p.y, 4.0));
          int i = x + y * 4;
          float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
          for (int k = 0; k < 16; k++) if (k == i) return m[k] / 16.0 - 0.5;
          return 0.0;
        }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
        void main(){
          vec2 px = floor(vUv * uRes);
          vec3 c = texture2D(tDiffuse, (px + 0.5) / uRes).rgb;
          c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); // linear -> sRGB
          c += (hash(px) - 0.5) * 0.035;                    // film grain
          float levels = 24.0;                               // ~15-bit colour
          c = floor(c * levels + bayer(px) + 0.5) / levels;  // ordered dithering
          vec2 d = vUv - 0.5;
          c *= 1.0 - dot(d, d) * 0.9;                        // vignette
          c = mix(c, vec3(c.r * 1.4, c.g * 0.3, c.b * 0.3), uDamage);
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
  }

  resize(camera) {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const ih = INTERNAL_HEIGHT, iw = Math.round(ih * (w / h));
    this.target.setSize(iw, ih);
    this.post.uniforms.uRes.value.set(iw, ih);
    snapUniform.value.set(iw, ih);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  render(scene, camera, time) {
    this.post.uniforms.uTime.value = time % 100;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }
}

// ---------- Procedural pixel textures ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function makeTexture(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function noise(g, size, base, amount, seed) {
  const r = rng(seed);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = (r() - 0.5) * amount;
    g.fillStyle = `rgb(${base[0] + v | 0},${base[1] + v | 0},${base[2] + v | 0})`;
    g.fillRect(x, y, 1, 1);
  }
}

export const textures = {
  // Concrete wall panel with a stained lower half and seams.
  wall: () => makeTexture(32, (g, s) => {
    noise(g, s, [92, 96, 88], 18, 1);
    g.fillStyle = 'rgba(40,46,30,0.35)'; g.fillRect(0, 20, s, 12);
    g.fillStyle = '#3e423a'; g.fillRect(0, 0, s, 1); g.fillRect(0, 0, 1, s); g.fillRect(0, 19, s, 1);
    const r = rng(7);
    for (let i = 0; i < 10; i++) { g.fillStyle = 'rgba(30,30,20,0.5)'; g.fillRect(r() * s | 0, 20 + r() * 12 | 0, 1, 2 + r() * 4 | 0); }
  }),
  floor: () => makeTexture(32, (g, s) => {
    noise(g, s, [58, 60, 56], 14, 2);
    g.fillStyle = '#2a2c28';
    g.fillRect(0, 0, s, 1); g.fillRect(0, 0, 1, s); g.fillRect(0, 16, s, 1); g.fillRect(16, 0, 1, s);
  }),
  ceiling: () => makeTexture(32, (g, s) => {
    noise(g, s, [44, 46, 44], 10, 3);
    g.fillStyle = '#1c1d1c'; g.fillRect(0, 0, s, 2); g.fillRect(0, 0, 2, s);
    g.fillStyle = '#5a5c58'; for (let i = 4; i < s; i += 6) g.fillRect(i, 8, 2, 2);
  }),
  hazard: () => makeTexture(16, (g, s) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      g.fillStyle = ((x + y) % 8) < 4 ? '#d8a51c' : '#151515';
      g.fillRect(x, y, 1, 1);
    }
  }),
  metal: () => makeTexture(32, (g, s) => {
    noise(g, s, [70, 76, 80], 12, 4);
    g.fillStyle = '#9aa4aa'; for (const [x, y] of [[2, 2], [29, 2], [2, 29], [29, 29]]) g.fillRect(x, y, 2, 2);
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(0, 15, s, 2);
  }),
  crate: () => makeTexture(32, (g, s) => {
    noise(g, s, [90, 86, 50], 16, 5);
    g.fillStyle = '#3c3a20'; g.fillRect(0, 0, s, 2); g.fillRect(0, s - 2, s, 2); g.fillRect(0, 0, 2, s); g.fillRect(s - 2, 0, 2, s);
    g.fillStyle = '#d8a51c'; g.fillRect(9, 12, 14, 8);
    g.fillStyle = '#151515'; g.font = 'bold 7px monospace'; g.fillText('Ω-51', 10, 18);
  }),
};

/** Text texture for signs on walls ("SECTOR 0", arrows, warnings). */
export function signTexture(text, { fg = '#d8a51c', bg = '#141414', w = 128, h = 32 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.fillRect(0, 0, w, 2); g.fillRect(0, h - 2, w, 2);
  g.font = `bold ${Math.floor(h * 0.5)}px monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
