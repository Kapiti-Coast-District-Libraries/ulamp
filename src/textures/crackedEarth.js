// src/textures/broadFolds.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smooth01(u) {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
}

// ##################################################################
// #               START: 3D SIMPLEX NOISE LIBRARY
// #  This is needed to create smooth, continuous random values
// ##################################################################
// Ported from: https://github.com/jwagner/simplex-noise.js
// This code is in the public domain.
const F3 = 1.0 / 3.0;
const G3 = 1.0 / 6.0;
const G3_2 = G3 * 2.0;
const G3_3 = G3 * 3.0;

class SimplexNoise {
  constructor(r = Math.random) {
    this.grad3 = [
      new THREE.Vector3(1, 1, 0), new THREE.Vector3(-1, 1, 0), new THREE.Vector3(1, -1, 0), new THREE.Vector3(-1, -1, 0),
      new THREE.Vector3(1, 0, 1), new THREE.Vector3(-1, 0, 1), new THREE.Vector3(1, 0, -1), new THREE.Vector3(-1, 0, -1),
      new THREE.Vector3(0, 1, 1), new THREE.Vector3(0, -1, 1), new THREE.Vector3(0, 1, -1), new THREE.Vector3(0, -1, -1)
    ];
    this.p = new Uint8Array(256);
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 256; i++) {
      this.p[i] = i;
    }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [this.p[i], this.p[j]] = [this.p[j], this.p[i]];
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = this.p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  noise3D(xin, yin, zin) {
    let n0, n1, n2, n3;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const X0 = i - t;
    const Y0 = j - t;
    const Z0 = k - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;
    const z0 = zin - Z0;

    let i1, j1, k1;
    let i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + G3_2;
    const y2 = y0 - j2 + G3_2;
    const z2 = z0 - k2 + G3_2;
    const x3 = x0 - 1.0 + G3_3;
    const y3 = y0 - 1.0 + G3_3;
    const z3 = z0 - 1.0 + G3_3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 < 0) n0 = 0.0;
    else {
      t0 *= t0;
      n0 = t0 * t0 * this.dot(this.grad3[this.permMod12[ii + this.perm[jj + this.perm[kk]]]], x0, y0, z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 < 0) n1 = 0.0;
    else {
      t1 *= t1;
      n1 = t1 * t1 * this.dot(this.grad3[this.permMod12[ii + i1 + this.perm[jj + j1 + this.perm[kk + k1]]]], x1, y1, z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 < 0) n2 = 0.0;
    else {
      t2 *= t2;
      n2 = t2 * t2 * this.dot(this.grad3[this.permMod12[ii + i2 + this.perm[jj + j2 + this.perm[kk + k2]]]], x2, y2, z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 < 0) n3 = 0.0;
    else {
      t3 *= t3;
      n3 = t3 * t3 * this.dot(this.grad3[this.permMod12[ii + 1 + this.perm[jj + 1 + this.perm[kk + 1]]]], x3, y3, z3);
    }
    return 32.0 * (n0 + n1 + n2 + n3); // Value is between -1 and 1
  }

  dot(g, x, y, z) {
    return g.x * x + g.y * y + g.z * z;
  }
}
// ##################################################################
// #                 END: 3D SIMPLEX NOISE LIBRARY
// ##################################################################

// --- Create one persistent noise generator ---
const _noiseGen = new SimplexNoise(Math.random);

// Pre-allocate vectors
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _radial = new THREE.Vector3();

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  // NEW: Size parameters define the "scale" of the folds
  const h_size = clamp(p.t_fold_h_size ?? 80, 20, 200); // Horizontal feature size in mm
  const v_size = clamp(p.t_fold_v_size ?? 60, 20, 200); // Vertical feature size in mm
  const depth = clamp(p.t_fold_depth ?? 4.0, 0, 10.0); // Max in/out displacement
  const sharp = clamp(p.t_fold_sharpness ?? 1.5, 1.0, 5.0); // 1=smooth, 3=sharp crease
  const fadeMM = clamp(p.t_fold_fade_bottom_mm ?? 5, 5, 40);
  
  // Convert size (mm) to frequency
  const h_freq = 1.0 / h_size;
  const v_freq = 1.0 / v_size;

  const maxR = MAX_DIAMETER_MM / 2;
  const bottomY = (p.bottom_thickness ?? 3) + 0.1;

  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nor, i);

    if (_v.y <= bottomY) continue;

    _radial.set(_v.x, 0, _v.z);
    const r = _radial.length();
    if (r < 1e-6) continue;
    _radial.multiplyScalar(1 / r);

    if (_n.dot(_radial) <= 0.0) continue;

    // --- NEW FOLD LOGIC ---
    
    // 1. Get noise input coordinates from the vertex's 3D position
    // We use low frequencies to get large, smooth features
    const noise_x = _v.x * h_freq;
    const noise_y = _v.y * v_freq;
    const noise_z = _v.z * h_freq;
    
    // 2. Get a smooth, continuous noise value (-1.0 to 1.0)
    const noise_val = _noiseGen.noise3D(noise_x, noise_y, noise_z);

    // 3. Apply sharpness to turn smooth hills into sharper creases
    // pow(1) = smooth, pow(3) = sharp
    let displacement = Math.sign(noise_val) * Math.pow(Math.abs(noise_val), sharp);

    // 4. Calculate fade
    let profile = 1.0;
    if (fadeMM > 0) {
      const u = (_v.y - bottomY) / Math.max(1e-6, fadeMM);
      profile = smooth01(u);
    }

    // 5. Final push amount, can be positive (out) or negative (in)
    let push = displacement * depth * profile;

    if (push > 0) {
      // If pushing *out*, respect the max diameter
      const slack = Math.max(0, maxR - r);
      push = Math.min(push, slack);
    }
    // Negative push (inward) is always allowed

    if (Math.abs(push) > 1e-4) {
      _v.addScaledVector(_radial, push);
      pos.setXYZ(i, _v.x, _v.y, _v.z);
    }
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals(); // Re-calc normals from the new shape
  return geometry;
}

export default {
  id: "broadFolds",
  label: "Broad Folds",
  defaults: {
    t_fold_h_size: 80,
    t_fold_v_size: 60,
    t_fold_depth: 4.0,
    t_fold_sharpness: 1.5,
    t_fold_fade_bottom_mm: 5,
  },
  schema: [
    { key: "t_fold_h_size",        label: "Horiz. fold size, mm", type: "range", min: 20, max: 200, step: 1 },
    { key: "t_fold_v_size",        label: "Vert. fold size, mm",  type: "range", min: 20, max: 200, step: 1 },
    { key: "t_fold_depth",         label: "Depth (in/out), mm",   type: "range", min: 0,  max: 10.0, step: 0.1 },
    { key: "t_fold_sharpness",     label: "Crease sharpness",     type: "range", min: 1.0, max: 5.0, step: 0.1 },
    { key: "t_fold_fade_bottom_mm",label: "Fade bottom, mm",      type: "range", min: 5,  max: 40,  step: 1 },
  ],
  // Headroom only needs to account for the *outward* push
  headroom: (p) => clamp(p.t_fold_depth ?? 4.0, 0, 10.0),
  apply,
};
