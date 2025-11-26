// src/textures/crystalFacets.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// --- 1. COMPACT VALUE NOISE (For the "Chaos" Warp) ---
// We need smooth noise to warp the grid so it doesn't look repetitive.
const SEED = 12345;
function hash(x, y, z) {
  let h = (Math.sin(x * 12.9898 + y * 78.233 + z * 53.539 + SEED) * 43758.5453);
  return h - Math.floor(h);
}
function noise3D(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const v000 = hash(ix, iy, iz),     v100 = hash(ix + 1, iy, iz);
  const v010 = hash(ix, iy + 1, iz), v110 = hash(ix + 1, iy + 1, iz);
  const v001 = hash(ix, iy, iz + 1), v101 = hash(ix + 1, iy, iz + 1);
  const v011 = hash(ix, iy + 1, iz + 1), v111 = hash(ix + 1, iy + 1, iz + 1);

  const x00 = v000 + (v100 - v000) * ux;
  const x10 = v010 + (v110 - v010) * ux;
  const x01 = v001 + (v101 - v001) * ux;
  const x11 = v011 + (v111 - v011) * ux;

  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;

  return y0 + (y1 - y0) * uz;
}

// --- 2. WORLEY / VORONOI NOISE (For the "Facets") ---
// Finds distance to closest point.
const PERM = new Uint8Array(512);
const GRAD = new Float32Array(512 * 3);
let seed_w = 999;
function randomW() {
  seed_w = (Math.imul(1664525, seed_w) + 1013904223) >>> 0;
  return seed_w / 4294967296.0;
}
for (let i = 0; i < 256; i++) {
  PERM[i] = i;
  GRAD[i * 3] = randomW(); GRAD[i * 3 + 1] = randomW(); GRAD[i * 3 + 2] = randomW();
}
for (let i = 0; i < 255; i++) {
  const r = i + ~~(randomW() * (256 - i));
  [PERM[i], PERM[r]] = [PERM[r], PERM[i]];
}
for (let i = 256; i < 512; i++) {
  PERM[i] = PERM[i & 255];
  GRAD[i * 3] = GRAD[(i & 255) * 3]; GRAD[i * 3 + 1] = GRAD[(i & 255) * 3 + 1]; GRAD[i * 3 + 2] = GRAD[(i & 255) * 3 + 2];
}

function getFeature(ix, iy, iz, out) {
  const idx = PERM[(ix & 255) + PERM[(iy & 255) + PERM[iz & 255]]];
  out.x = ix + GRAD[idx * 3];
  out.y = iy + GRAD[idx * 3 + 1];
  out.z = iz + GRAD[idx * 3 + 2];
}

const _f = new THREE.Vector3();
const _d = new THREE.Vector3();

function voronoiF1(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let minDist = 100.0;

  for (let xx = -1; xx <= 1; xx++) {
    for (let yy = -1; yy <= 1; yy++) {
      for (let zz = -1; zz <= 1; zz++) {
        getFeature(ix + xx, iy + yy, iz + zz, _f);
        _d.set(x, y, z).sub(_f);
        const distSq = _d.lengthSq();
        if (distSq < minDist) minDist = distSq;
      }
    }
  }
  return Math.sqrt(minDist);
}

// --- 3. APPLY FUNCTION ---

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  // Params
  const scale  = clamp(p.t_crys_scale ?? 30, 5, 100);
  const depth  = clamp(p.t_crys_depth ?? 3.0, 0, 8.0);
  const chaos  = clamp(p.t_crys_chaos ?? 0.5, 0, 2.0); // Domain Warp
  const sharp  = clamp(p.t_crys_sharp ?? 1.0, 0.1, 1.4); // Profile curve
  const invert = p.t_crys_invert ? -1 : 1; // Peaks vs Craters
  
  const freq = 1.0 / scale;
  const bottomY = (p.bottom_thickness ?? 3) + 0.1;
  const maxRadius = MAX_DIAMETER_MM / 2;

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

    // 1. Apply "Chaos" (Domain Warping)
    // We offset the lookup coordinate by a smooth noise value.
    // This breaks the grid structure completely.
    if (chaos > 0.01) {
      const warpScale = 0.5; // Lower freq for warp
      const wx = nx * warpScale; 
      const wy = ny * warpScale;
      const wz = nz * warpScale;
      nx += (noise3D(wx + 0.0, wy + 0.0, wz + 0.0) - 0.5) * chaos * 2;
      ny += (noise3D(wx + 5.2, wy + 1.3, wz + 2.8) - 0.5) * chaos * 2;
      nz += (noise3D(wx + 1.9, wy + 8.4, wz + 4.5) - 0.5) * chaos * 2;
    }

    // 2. Get Distance to center of crystal
    const d = voronoiF1(nx, ny, nz); // 0 at center, 0.5+ at edge

    // 3. Shape the facet
    // Voronoi F1 creates cones. 
    // Invert it (1 - d) to make pyramids.
    let shape = clamp(1.0 - d, 0, 1);
    
    // Power function to control "sharpness" (concave/convex faces)
    shape = Math.pow(shape, sharp);

    // 4. Apply Depth
    const slack = Math.max(0, maxRadius - r);
    let push = Math.min(depth, slack) * shape * invert;

    // Bottom fade
    const fadeMM = 5;
    if (fadeMM > 0) {
      const u = clamp((v.y - bottomY) / fadeMM, 0, 1);
      push *= (u * u * (3 - 2 * u));
    }

    if (Math.abs(push) > 0.001) {
      v.addScaledVector(radial, push);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export default {
  id: "crystalFacets",
  label: "Crystal Facets",
  defaults: {
    t_crys_scale: 25,
    t_crys_depth: 4.0,
    t_crys_chaos: 1.0,
    t_crys_sharp: 1.0,
    t_crys_invert: false,
  },
  schema: [
    { key: "t_crys_scale",  label: "Shard Size",      type: "range", min: 10, max: 80, step: 1, group: "Texture" },
    { key: "t_crys_depth",  label: "Facet Depth",     type: "range", min: 0,  max: 8.0, step: 0.1, group: "Texture" },
    { key: "t_crys_chaos",  label: "Randomness",      type: "range", min: 0,  max: 2.0, step: 0.1, group: "Texture" },
    
    { key: "t_crys_sharp",  label: "Edge Sharpness",  type: "range", min: 0.5,max: 1.4, step: 0.1, group: "Texture", advanced: true },
    { key: "t_crys_invert", label: "Invert (Craters)",type: "checkbox", group: "Texture", advanced: true },
  ],
  headroom: (p) => clamp(p.t_crys_depth ?? 4.0, 0, 8.0),
  apply,
};
