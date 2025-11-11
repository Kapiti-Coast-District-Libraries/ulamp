// src/textures/hammeredMetal.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// Smoothstep 0..1
function smooth01(u) {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
}

// --- Simplex Noise 3D ---
// This is a self-contained 3D Simplex Noise implementation.
const SimplexNoise = (function() {
  const F3 = 1.0 / 3.0;
  const G3 = 1.0 / 6.0;
  const p = new Uint8Array([151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180]);
  const perm = new Uint8Array(512);
  const grad3 = new Float32Array([1,1,0, -1,1,0, 1,-1,0, -1,-1,0, 1,0,1, -1,0,1, 1,0,-1, -1,0,-1, 0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1]);

  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
  }

  function dot(g, x, y, z) {
    return g[0] * x + g[1] * y + g[2] * z;
  }

  return {
    noise3D: function(x, y, z) {
      let s = (x + y + z) * F3;
      let i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
      let t = (i + j + k) * G3;
      let x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
      let i1, j1, k1, i2, j2, k2;
      
      if (x0 >= y0) {
        if (y0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; }
        else if (x0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; }
        else { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; }
      } else {
        if (y0 < z0) { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; }
        else if (x0 < z0) { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; }
        else { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; }
      }
      
      let x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
      let x2 = x0 - i2 + 2.0 * G3, y2 = y0 - j2 + 2.0 * G3, z2 = z0 - k2 + 2.0 * G3;
      let x3 = x0 - 1.0 + 3.0 * G3, y3 = y0 - 1.0 + 3.0 * G3, z3 = z0 - 1.0 + 3.0 * G3;
      
      let ii = i & 255, jj = j & 255, kk = k & 255;
      let gi0 = perm[ii + perm[jj + perm[kk]]] % 12 * 3;
      let gi1 = perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] % 12 * 3;
      let gi2 = perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] % 12 * 3;
      let gi3 = perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] % 12 * 3;
      
      let n0, n1, n2, n3;
      let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
      if (t0 < 0) n0 = 0.0;
      else { t0 *= t0; n0 = t0 * t0 * dot(grad3, x0, y0, z0); }
      
      let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
      if (t1 < 0) n1 = 0.0;
      else { t1 *= t1; n1 = t1 * t1 * dot(grad3.slice(gi1), x1, y1, z1); }
      
      let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
      if (t2 < 0) n2 = 0.0;
      else { t2 *= t2; n2 = t2 * t2 * dot(grad3.slice(gi2), x2, y2, z2); }
      
      let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
      if (t3 < 0) n3 = 0.0;
      else { t3 *= t3; n3 = t3 * t3 * dot(grad3.slice(gi3), x3, y3, z3); }
      
      return 32.0 * (n0 + n1 + n2 + n3); // Scale to approx [-1, 1]
    }
  };
})();
// --- End Simplex Noise 3D ---


function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  // Parameters
  const scale = clamp(p.t_hammer_scale ?? 30, 5, 100);
  const depth = clamp(p.t_hammer_depth ?? 0.8, 0, 2.0);
  const octaves = clamp(Math.floor(p.t_hammer_octaves ?? 3), 1, 6);
  const fadeMM = clamp(p.t_hammer_fade_bottom_mm ?? 5, 5, 40);

  const maxR = MAX_DIAMETER_MM / 2;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const wp = new THREE.Vector3(); // "working point" for noise
  const bottomY = (p.bottom_thickness ?? 3) + 0.1;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);

    if (v.y <= bottomY) continue;

    radial.set(v.x, 0, v.z);
    const r = radial.length();
    if (r < 1e-6) continue;
    radial.multiplyScalar(1 / r);

    // only outward facing vertices
    if (n.dot(radial) <= 0.0) continue;

    // 1. Scale the vertex position to "noise space"
    wp.copy(v).multiplyScalar(1.0 / scale);

    // 2. Calculate FBM (Fractional Brownian Motion) noise
    // This adds multiple layers of noise (octaves) for detail
    let noiseValue = 0;
    let amplitude = 1.0;
    let frequency = 1.0;
    for (let o = 0; o < octaves; o++) {
      noiseValue += amplitude * SimplexNoise.noise3D(
        wp.x * frequency, 
        wp.y * frequency, 
        wp.z * frequency
      );
      amplitude *= 0.5; // Persistence
      frequency *= 2.0; // Lacunarity
    }

    // 3. Create the profile
    // The noise is in [-1, 1], so we map it to [0, 1]
    let profile = (noiseValue + 1.0) / 2.0;

    // 4. Apply bottom fade
    if (fadeMM > 0) {
      const u = (v.y - bottomY) / Math.max(1e-6, fadeMM);
      profile *= smooth01(u);
    }

    // 5. Calculate and apply the push
    const slack = Math.max(0, maxR - r);
    const push = Math.min(depth, slack) * profile;

    if (push > 0) {
      v.addScaledVector(radial, push);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export default {
  id: "hammeredMetal",
  label: "Hammered Metal",
  defaults: {
    t_hammer_scale: 30,
  t_hammer_depth: 0.8,
    t_hammer_octaves: 3,
    t_hammer_fade_bottom_mm: 5,
  },
  schema: [
    { key: "t_hammer_scale",         label: "Dent Size, mm",      type: "range", min: 5,  max: 100, step: 1 },
    { key: "t_hammer_depth",         label: "Dent Depth, mm",    type: "range", min: 0,  max: 2.0, step: 0.05 },
    { key: "t_hammer_octaves",       label: "Roughness (Octaves)", type: "range", min: 1,  max: 6,  step: 1 },
    { key: "t_hammer_fade_bottom_mm",label: "Fade bottom, mm",    type: "range", min: 5,  max: 40, step: 1 },
  ],
  headroom: (p) => clamp(p.t_hammer_depth ?? 0.8, 0, 2.0),
  apply,
};
