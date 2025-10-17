// src/textures/perlinWater.js
// Fine Perlin style water ripples, outward emboss only.
// Seamless around the circumference, height-aware, print safe.

import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

/* ---------- Seeded Perlin noise, 3D, fBm ---------- */
function makePerlin(seed = 1337) {
  // build permutation from seed
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  // simple LCG shuffle
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = base[i]; base[i] = base[j]; base[j] = tmp;
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);
  function grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }
  function noise3(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);

    const u = fade(x), v = fade(y), w = fade(z);

    const A  = p[X] + Y,  AA = p[A] + Z,  AB = p[A + 1] + Z;
    const B  = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;

    const n =
      lerp(
        lerp(
          lerp(grad(p[AA], x, y, z),     grad(p[BA], x - 1, y, z),     u),
          lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u),
          v
        ),
        lerp(
          lerp(grad(p[AA + 1], x, y, z - 1),     grad(p[BA + 1], x - 1, y, z - 1),     u),
          lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u),
          v
        ),
        w
      );
    // Perlin returns about [-1,1]
    return n;
  }

  function fbm3(x, y, z, octaves, lacunarity, gain, ridged) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      let n = noise3(x * freq, y * freq, z * freq);
      if (ridged) n = 1 - Math.abs(n); else n = (n + 1) * 0.5; // 0..1
      sum += n * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }

  return { fbm3 };
}

/* ---------- Texture apply ---------- */
function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  // Controls
  const depthMM   = clamp(p.t_perlin_depth ?? 2.0, 0, 3.0);   // push outward, mm
  const scaleMM   = clamp(p.t_perlin_scale ?? 10, 4, 20);     // horizontal scale, mm
  const vertScale = clamp(p.t_perlin_vertical ?? 1.0, 0.25, 2); // vertical scale factor
  const octaves   = clamp(Math.floor(p.t_perlin_octaves ?? 4), 1, 6);
  const lacun     = clamp(p.t_perlin_lacunarity ?? 2.0, 1.5, 3.0);
  const gain      = clamp(p.t_perlin_gain ?? 0.55, 0.3, 0.9);
  const contrast  = clamp(p.t_perlin_contrast ?? 1.2, 0.5, 2.0); // 1 means neutral
  const ridged    = !!p.t_perlin_ridged; // true gives crisper crests, water-like
  const fadeTop   = clamp(p.t_perlin_fadeTop ?? 0.05, 0, 0.5);
  const fadeBottom= clamp(p.t_perlin_fadeBottom ?? 0.05, 0, 0.5);
  const seed      = Math.floor(p.t_perlin_seed ?? 1337);

  const { fbm3 } = makePerlin(seed);

  const maxR = MAX_DIAMETER_MM / 2;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const radial = new THREE.Vector3();

  const slab = p.bottom_thickness ?? 3;
  const bottomY = slab + 0.1;
  const usableH = Math.max(1e-3, p.height - slab);

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);

    if (v.y <= bottomY) continue; // keep base slab clean

    // unit radial and radius
    radial.set(v.x, 0, v.z);
    const r = radial.length();
    if (r < 1e-6) continue;
    radial.multiplyScalar(1 / r);

    // only outward facing verts so we do not affect inner wall
    if (n.dot(radial) <= 0.0) continue;

    // cylindrical, seamless around the wrap:
    // use (r*cosθ, r*sinθ, y) in mm, scaled to control feature size
    let theta = Math.atan2(v.z, v.x);
    if (theta < 0) theta += Math.PI * 2;

    const nx = (r * Math.cos(theta)) / scaleMM;
    const nz = (r * Math.sin(theta)) / scaleMM;
    const ny = (v.y - slab) / (scaleMM * vertScale);

    // fBm value 0..1
    let t = fbm3(nx, ny, nz, octaves, lacun, gain, ridged);

    // gentle fade near bottom and top edges
    const yNorm = clamp((v.y - slab) / usableH, 0, 1);
    const tFade = fadeTop > 0 ? (yNorm < 1 - fadeTop ? 1 : (1 - yNorm) / fadeTop) : 1;
    const bFade = fadeBottom > 0 ? (yNorm > fadeBottom ? 1 : yNorm / fadeBottom) : 1;
    t *= Math.max(0, Math.min(1, tFade * bFade));

    // contrast curve, 1 is neutral
    if (contrast !== 1) {
      const c = contrast;
      // remap 0..1 through a midpoint preserving power curve
      const mid = 0.5;
      if (t >= mid) t = mid + Math.pow((t - mid) * 2, c) * 0.5;
      else t = mid - Math.pow((mid - t) * 2, c) * 0.5;
    }

    // push outward, stay inside 240 mm envelope
    const slack = Math.max(0, maxR - r);
    const push = Math.min(depthMM, slack) * t;

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
  id: "perlinWater",
  label: "Perlin water",
  defaults: {
    t_perlin_depth: 2.0,       // mm
    t_perlin_scale: 18,        // mm
    t_perlin_vertical: 1.0,    // factor
    t_perlin_octaves: 4,
    t_perlin_lacunarity: 2.0,
    t_perlin_gain: 0.55,
    t_perlin_contrast: 1.2,
    t_perlin_ridged: true,
    t_perlin_fadeTop: 0.05,
    t_perlin_fadeBottom: 0.05,
    t_perlin_seed: 1337,
  },
  schema: [
    { key: "t_perlin_depth",     label: "Depth, mm",          type: "range", min: 0,   max: 3.0, step: 0.05 },
    { key: "t_perlin_scale",     label: "Scale, mm",          type: "range", min: 4,   max: 60,  step: 0.5 },
    { key: "t_perlin_vertical",  label: "Vertical scale",     type: "range", min: 0.25,max: 4.0, step: 0.05 },
    { key: "t_perlin_octaves",   label: "Octaves",            type: "range", min: 1,   max: 6,   step: 1 },
    { key: "t_perlin_lacunarity",label: "Lacunarity",         type: "range", min: 1.5, max: 3.0, step: 0.1 },
    { key: "t_perlin_gain",      label: "Gain",               type: "range", min: 0.3, max: 0.9, step: 0.05 },
    { key: "t_perlin_contrast",  label: "Contrast",           type: "range", min: 0.5, max: 2.0, step: 0.05 },
    { key: "t_perlin_ridged",    label: "Ridged crests",      type: "checkbox" },
    { key: "t_perlin_fadeTop",   label: "Fade near top",      type: "range", min: 0,   max: 0.5, step: 0.01 },
    { key: "t_perlin_fadeBottom",label: "Fade near bottom",   type: "range", min: 0,   max: 0.5, step: 0.01 },
    { key: "t_perlin_seed",      label: "Seed",               type: "range", min: 0,   max: 9999, step: 1 },
  ],
  headroom: (p) => clamp(p.t_perlin_depth ?? 2.0, 0, 3.0),
  apply,
};
