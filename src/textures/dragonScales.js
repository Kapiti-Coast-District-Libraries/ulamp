// src/textures/coralLabyrinth.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// --- 3D SIMPLEX NOISE (Compact) ---
const F3 = 1.0 / 3.0;
const G3 = 1.0 / 6.0;
class SimplexNoise {
  constructor(seed = 1234) {
    this.p = new Uint8Array(256);
    this.perm = new Uint8Array(512);
    this.grad3 = [
      [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
      [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
      [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
    ];
    for (let i = 0; i < 256; i++) this.p[i] = i;
    // Shuffle
    for (let i = 255; i > 0; i--) {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      const r = (seed >>> 16) % (i + 1);
      [this.p[i], this.p[r]] = [this.p[r], this.p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = this.p[i & 255];
  }
  dot(g, x, y, z) { return g[0]*x + g[1]*y + g[2]*z; }
  noise(xin, yin, zin) {
    let n0, n1, n2, n3;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const X0 = i - t, Y0 = j - t, Z0 = k - t;
    const x0 = xin - X0, y0 = yin - Y0, z0 = zin - Z0;
    let i1, j1, k1, i2, j2, k2;
    if(x0>=y0){
      if(y0>=z0){ i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; }
      else if(x0>=z0){ i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; }
      else{ i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; }
    } else {
      if(y0<z0){ i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; }
      else if(x0<z0){ i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; }
      else{ i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2*G3, y2 = y0 - j2 + 2*G3, z2 = z0 - k2 + 2*G3;
    const x3 = x0 - 1 + 3*G3, y3 = y0 - 1 + 3*G3, z3 = z0 - 1 + 3*G3;
    const ii = i&255, jj = j&255, kk = k&255;
    
    const gi0 = this.perm[ii+this.perm[jj+this.perm[kk]]] % 12;
    const gi1 = this.perm[ii+i1+this.perm[jj+j1+this.perm[kk+k1]]] % 12;
    const gi2 = this.perm[ii+i2+this.perm[jj+j2+this.perm[kk+k2]]] % 12;
    const gi3 = this.perm[ii+1+this.perm[jj+1+this.perm[kk+1]]] % 12;
    
    let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
    if(t0<0) n0=0; else { t0*=t0; n0=t0*t0*this.dot(this.grad3[gi0],x0,y0,z0); }
    let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
    if(t1<0) n1=0; else { t1*=t1; n1=t1*t1*this.dot(this.grad3[gi1],x1,y1,z1); }
    let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
    if(t2<0) n2=0; else { t2*=t2; n2=t2*t2*this.dot(this.grad3[gi2],x2,y2,z2); }
    let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
    if(t3<0) n3=0; else { t3*=t3; n3=t3*t3*this.dot(this.grad3[gi3],x3,y3,z3); }
    return 32 * (n0 + n1 + n2 + n3);
  }
}

const _noise = new SimplexNoise(999);

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  // --- Params ---
  const scale = clamp(p.t_coral_scale ?? 40, 10, 150);
  const depth = clamp(p.t_coral_depth ?? 2.5, 0, 6.0);
  const thick = clamp(p.t_coral_thickness ?? 0.4, 0.1, 0.9); // Ridge width
  const flow  = p.t_coral_flow ?? 0; // Twist/Flow
  const layers= Math.floor(clamp(p.t_coral_detail ?? 1, 1, 3));

  const freq = 1.0 / scale;
  const bottomY = (p.bottom_thickness ?? 3) + 0.1;
  const maxRadius = MAX_DIAMETER_MM / 2;
  const height = p.height ?? 220;

  const v = new THREE.Vector3();
  const radial = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.y <= bottomY) continue;

    radial.set(v.x, 0, v.z);
    const r = radial.length();
    if (r < 1e-6) continue;
    radial.multiplyScalar(1 / r);

    // Map to noise space
    // We use (theta * r) for X to minimize distortion at different radii
    let theta = Math.atan2(v.z, v.x);
    if (Math.abs(flow) > 0.001) {
      theta += (v.y / height) * flow * Math.PI; // Twist
    }
    
    const nx = theta * r * freq;
    const ny = v.y * freq;
    const nz = r * freq * 0.5; // Minimal Z change

    // --- Ridged Fractal Noise ---
    // Abs(noise) creates sharp valleys. Inverting it creates sharp ridges.
    let signal = 0;
    let amp = 1.0;
    let f = 1.0;
    let weight = 1.0;
    
    for(let k=0; k<layers; k++){
       let nVal = _noise.noise(nx * f, ny * f, nz * f);
       nVal = 1.0 - Math.abs(nVal); // Ridge
       nVal = nVal * nVal; // Sharpen ridge
       signal += nVal * amp * weight;
       
       // Next octave
       weight = nVal; // Inter-layer dependence (makes it look connected)
       amp *= 0.5;
       f *= 2.0;
    }

    // Shaping the ridge thickness
    // signal is roughly 0..1. We map it to be fat or thin.
    // thick=0.1 -> thin sharp lines. thick=0.9 -> fat bubbly walls.
    let profile = smoothstep(1.0 - thick, 1.0, signal);

    // Apply Depth
    const slack = Math.max(0, maxRadius - r);
    const push = Math.min(depth, slack) * profile;

    if (push > 0.01) {
      v.addScaledVector(radial, push);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export default {
  id: "coralLabyrinth",
  label: "Coral Labyrinth",
  defaults: {
    t_coral_scale: 35,
    t_coral_depth: 3.0,
    t_coral_thickness: 0.5,
    t_coral_flow: 0.2,
    t_coral_detail: 2,
  },
  schema: [
    // --- SHAPE ---
    { key: "t_coral_scale",    label: "Cell Size",       type: "range", min: 10,  max: 100, step: 1, group: "Texture" },
    { key: "t_coral_depth",    label: "Growth Depth",    type: "range", min: 0,   max: 6.0, step: 0.1, group: "Texture" },
    { key: "t_coral_thickness",label: "Ridge Width",     type: "range", min: 0.2, max: 0.8, step: 0.01, group: "Texture" },
    
    // --- ADVANCED ---
    { key: "t_coral_flow",     label: "Organic Flow",    type: "range", min: -1,  max: 1,   step: 0.05, group: "Texture", advanced: true },
    { key: "t_coral_detail",   label: "Complexity",      type: "range", min: 1,   max: 3,   step: 1,    group: "Texture", advanced: true },
  ],
  headroom: (p) => clamp(p.t_coral_depth ?? 3.0, 0, 6.0),
  apply,
};
