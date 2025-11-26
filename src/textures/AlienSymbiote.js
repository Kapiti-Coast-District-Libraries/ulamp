// src/textures/alienSymbiote.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// --- FAST SIMPLEX-LIKE NOISE ---
// Self-contained noise function to ensure the "organic" look
const PERM = new Uint8Array(512);
const GRAD3 = [
  1,1,0, -1,1,0, 1,-1,0, -1,-1,0,
  1,0,1, -1,0,1, 1,0,-1, -1,0,-1,
  0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1
];

let seed = 666; // Spooky seed
function random() {
  seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
  return seed / 4294967296.0;
}

for(let i=0; i<512; i++) PERM[i] = i & 255;
for(let i=0; i<255; i++) {
  const r = i + ~~(random() * (256 - i));
  [PERM[i], PERM[r]] = [PERM[r], PERM[i]];
  PERM[i + 256] = PERM[i];
}

function dot(g, x, y, z) { return g[0]*x + g[1]*y + g[2]*z; }

function noise3D(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = x*x*x*(x*(x*6-15)+10);
  const v = y*y*y*(y*(y*6-15)+10);
  const w = z*z*z*(z*(z*6-15)+10);
  
  const A = PERM[X]+Y, AA = PERM[A]+Z, AB = PERM[A+1]+Z;
  const B = PERM[X+1]+Y, BA = PERM[B]+Z, BB = PERM[B+1]+Z;

  const gAA = (PERM[AA] % 12) * 3; const gBA = (PERM[BA] % 12) * 3;
  const gAB = (PERM[AB] % 12) * 3; const gBB = (PERM[BB] % 12) * 3;
  const gAA1= (PERM[AA+1] % 12)*3; const gBA1= (PERM[BA+1] % 12)*3;
  const gAB1= (PERM[AB+1] % 12)*3; const gBB1= (PERM[BB+1] % 12)*3;

  return 0.5 + 0.5 * (
    (1-w) * ((1-v) * ((1-u) * dot([GRAD3[gAA],GRAD3[gAA+1],GRAD3[gAA+2]], x, y, z) + 
                       u * dot([GRAD3[gBA],GRAD3[gBA+1],GRAD3[gBA+2]], x-1, y, z)) +
             v * ((1-u) * dot([GRAD3[gAB],GRAD3[gAB+1],GRAD3[gAB+2]], x, y-1, z) +
                   u * dot([GRAD3[gBB],GRAD3[gBB+1],GRAD3[gBB+2]], x-1, y-1, z))) +
    w * ((1-v) * ((1-u) * dot([GRAD3[gAA1],GRAD3[gAA1+1],GRAD3[gAA1+2]], x, y, z-1) + 
                   u * dot([GRAD3[gBA1],GRAD3[gBA1+1],GRAD3[gBA1+2]], x-1, y, z-1)) +
         v * ((1-u) * dot([GRAD3[gAB1],GRAD3[gAB1+1],GRAD3[gAB1+2]], x, y-1, z-1) +
               u * dot([GRAD3[gBB1],GRAD3[gBB1+1],GRAD3[gBB1+2]], x-1, y-1, z-1)))
  );
}

// --- RIDGED NOISE (The "Vein" look) ---
// Instead of smooth hills, we flip the negative values up to create sharp valleys,
// then invert it to make sharp ridges.
function ridgedNoise(x, y, z, scale, gain) {
  let n = noise3D(x * scale, y * scale, z * scale); 
  // Map 0..1 to -1..1
  n = (n - 0.5) * 2.0;
  // Absolute value creates the sharp "V" shape
  n = 1.0 - Math.abs(n);
  // Sharpen the peak
  n = n * n;
  return n * gain;
}

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  // Params
  const scale = clamp(p.t_bio_scale ?? 25, 5, 100);
  const depth = clamp(p.t_bio_depth ?? 3.0, 0, 8.0);
  const creep = p.t_bio_creep ?? 0;   // Vertical flow
  const slime = clamp(p.t_bio_slime ?? 1.5, 0.5, 3.0); // Thickness/Gooeyness
  const complex = clamp(p.t_bio_complex ?? 1, 1, 3); // Octaves

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

    // Coordinates
    let nx = v.x * freq;
    let ny = v.y * freq;
    let nz = v.z * freq;

    // 1. Creep (Flow)
    // Moves the texture up/down to simulate growth direction
    ny -= creep * (v.y / height) * 5.0;

    // 2. Domain Warping (The "Liquid" feel)
    // We offset the coordinate with another noise layer first.
    // This makes the veins wiggle and meander naturally.
    const warp = 0.5;
    const wx = noise3D(nx * 0.5, ny * 0.5, nz * 0.5) * warp;
    const wy = noise3D(nx * 0.5 + 10, ny * 0.5 + 10, nz * 0.5 + 10) * warp;
    const wz = noise3D(nx * 0.5 + 20, ny * 0.5 + 20, nz * 0.5 + 20) * warp;
    
    nx += wx; ny += wy; nz += wz;

    // 3. Multi-fractal Ridged Noise
    let signal = 0;
    let amp = 1.0;
    let f = 1.0;
    
    // Main vein layer
    signal += ridgedNoise(nx, ny, nz, f, amp);
    
    // Detailed capillaries layer
    if (complex >= 2) {
      f *= 2.0; amp *= 0.5;
      signal += ridgedNoise(nx, ny, nz, f, amp);
    }
    if (complex >= 3) {
      f *= 2.0; amp *= 0.25;
      signal += ridgedNoise(nx, ny, nz, f, amp);
    }

    // 4. "Slime" function (Thresholding)
    // This cuts off the bottom of the signal to create distinct, raised tubes
    // rather than a bumpy hill.
    // Map signal (roughly 0..1.5) to a sharp cutoff
    
    // Normalize roughly
    let shape = signal / 1.5; 
    
    // Apply contrast/threshold (Slime factor)
    shape = Math.pow(shape, slime); 
    
    // Smooth clip to ensure it doesn't jag
    shape = smoothstep(0.1, 0.9, shape);

    // 5. Apply
    const slack = Math.max(0, maxRadius - r);
    const push = Math.min(depth, slack) * shape;

    // Bottom Fade
    const fadeMM = 8;
    if (fadeMM > 0) {
       const u = clamp((v.y - bottomY) / fadeMM, 0, 1);
       // ease in
       const fade = u * u * (3 - 2 * u);
       v.addScaledVector(radial, push * fade);
    } else {
       v.addScaledVector(radial, push);
    }

    pos.setXYZ(i, v.x, v.y, v.z);
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export default {
  id: "alienSymbiote",
  label: "Alien Symbiote",
  defaults: {
    t_bio_scale: 30,
    t_bio_depth: 3.5,
    t_bio_creep: 0.2,
    t_bio_slime: 1.8,
    t_bio_complex: 2,
  },
  schema: [
    { key: "t_bio_scale",   label: "Vein Size",      type: "range", min: 10,  max: 80, step: 1, group: "Texture" },
    { key: "t_bio_depth",   label: "Vein Height",    type: "range", min: 0,   max: 8.0, step: 0.1, group: "Texture" },
    { key: "t_bio_slime",   label: "Thickness",      type: "range", min: 0.5, max: 4.0, step: 0.1, group: "Texture" }, // Controls how "fat" the veins are
    { key: "t_bio_creep",   label: "Flow Direction", type: "range", min: -1.0,max: 1.0, step: 0.1, group: "Texture" },
    
    { key: "t_bio_complex", label: "Detail Level",   type: "range", min: 1,   max: 3,   step: 1, group: "Texture", advanced: true },
  ],
  headroom: (p) => clamp(p.t_bio_depth ?? 3.5, 0, 8.0),
  apply,
};
