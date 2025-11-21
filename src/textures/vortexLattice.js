// src/textures/voronoiCells.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// --- FAST 3D WORLEY NOISE ---
const PERM = new Uint8Array(512);
const GRAD = new Float32Array(512 * 3);
let seed = 1234;
function random() {
  seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
  return seed / 4294967296.0;
}
for (let i = 0; i < 256; i++) {
  PERM[i] = i;
  GRAD[i*3]   = random(); 
  GRAD[i*3+1] = random();
  GRAD[i*3+2] = random();
}
for (let i = 0; i < 255; i++) {
  const r = i + ~~(random() * (256 - i));
  [PERM[i], PERM[r]] = [PERM[r], PERM[i]];
}
for (let i = 256; i < 512; i++) {
  PERM[i] = PERM[i & 255];
  GRAD[i*3]   = GRAD[(i&255)*3];
  GRAD[i*3+1] = GRAD[(i&255)*3+1];
  GRAD[i*3+2] = GRAD[(i&255)*3+2];
}

function getFeaturePoint(ix, iy, iz, out) {
  const index = PERM[(ix & 255) + PERM[(iy & 255) + PERM[iz & 255]]];
  out.x = ix + GRAD[index * 3];
  out.y = iy + GRAD[index * 3 + 1];
  out.z = iz + GRAD[index * 3 + 2];
}

const _feature = new THREE.Vector3();
const _diff = new THREE.Vector3();

function worley3D(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let d1 = 100.0;
  let d2 = 100.0;

  for (let xx = -1; xx <= 1; xx++) {
    for (let yy = -1; yy <= 1; yy++) {
      for (let zz = -1; zz <= 1; zz++) {
        getFeaturePoint(ix + xx, iy + yy, iz + zz, _feature);
        _diff.set(x, y, z).sub(_feature);
        const d2sq = _diff.lengthSq();
        if (d2sq < d1) {
          d2 = d1;
          d1 = d2sq;
        } else if (d2sq < d2) {
          d2 = d2sq;
        }
      }
    }
  }
  return { d1: Math.sqrt(d1), d2: Math.sqrt(d2) };
}

// --- SLOPE GUARD ---
// Scans the mesh from bottom to top. If a vertex sticks out
// further than 'dy' (45 degrees) from the vertex below it, clamp it.
function applySlopeGuard(pos, radialSegments, bottomY) {
  const stride = radialSegments + 1; // Lathe geometry wraps UVs, so +1 vertex per ring
  const count = pos.count;
  const vCurr = new THREE.Vector3();
  const vBelow = new THREE.Vector3();

  // Start from the second ring (index 'stride')
  for (let i = stride; i < count; i++) {
    // Get current vertex
    vCurr.fromBufferAttribute(pos, i);
    if (vCurr.y <= bottomY) continue; // Don't touch the base slab

    // Get vertex directly below in the grid
    const idxBelow = i - stride;
    vBelow.fromBufferAttribute(pos, idxBelow);

    // Calculate max allowed radius for this height
    // Max Slope = 1.0 (45 degrees) -> r_max = r_below + (y_curr - y_below)
    const dy = vCurr.y - vBelow.y;
    if (dy <= 0.0001) continue; // Same height or glitch

    const rBelow = Math.hypot(vBelow.x, vBelow.z);
    const rCurr  = Math.hypot(vCurr.x, vCurr.z);
    
    const maxR = rBelow + dy * 1.0; // 1.0 is the slope limit (45 deg)

    if (rCurr > maxR) {
      // We need to pull it in
      const scale = maxR / rCurr;
      vCurr.x *= scale;
      vCurr.z *= scale;
      pos.setXYZ(i, vCurr.x, vCurr.y, vCurr.z);
    }
  }
}

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  // Params
  const scale = clamp(p.t_voro_scale ?? 40, 10, 150);
  const depth = clamp(p.t_voro_depth ?? 2.0, 0, 5.0);
  const style = clamp(p.t_voro_style ?? 1.0, 0, 1); 
  const wall  = clamp(p.t_voro_wall ?? 0.2, 0.01, 0.8); 
  const twist = p.t_voro_twist ?? 0;
  const stretch = p.t_voro_stretch ?? 1.0;
  const useGuard = p.t_voro_slope_guard ?? true;

  const freq = 1.0 / scale;
  const bottomY = (p.bottom_thickness ?? 3) + 0.1;
  const maxRadius = MAX_DIAMETER_MM / 2;
  const height = p.height ?? 220;

  const v = new THREE.Vector3();
  const radial = new THREE.Vector3();

  // 1. Apply Noise Displacement
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.y <= bottomY) continue;

    radial.set(v.x, 0, v.z);
    const r = radial.length();
    if (r < 1e-6) continue;
    radial.multiplyScalar(1 / r);

    // Twist
    let theta = Math.atan2(v.z, v.x);
    if (Math.abs(twist) > 0.001) {
      const t = v.y / height;
      theta += t * twist * Math.PI * 2;
    }
    
    const nx = theta * r * freq;
    const ny = v.y * freq * stretch;
    const nz = r * freq;
    
    const w = worley3D(nx, ny, nz);
    
    const bubbleShape = 1.0 - w.d1; 
    const cellShape   = w.d2 - w.d1;
    let rawSignal = (1 - style) * bubbleShape + style * cellShape;
    let profile = smoothstep(0, wall, rawSignal);
    
    const slack = Math.max(0, maxRadius - r);
    const push = Math.min(depth, slack) * profile;

    if (Math.abs(push) > 0.001) {
      v.addScaledVector(radial, push);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }

  // 2. Apply Slope Guard (Post-Process)
  // We need radialSegments to know the grid stride.
  // The Pack usually passes 'radialSegments' in 'p'.
  if (useGuard && p.radialSegments) {
    applySlopeGuard(pos, p.radialSegments, bottomY);
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export default {
  id: "voronoiCells",
  label: "Voronoi Cells",
  defaults: {
    t_voro_scale: 35,
    t_voro_depth: 2.5,
    t_voro_style: 1.0, 
    t_voro_wall: 0.25,
    t_voro_twist: 0,
    t_voro_stretch: 1.0,
    t_voro_slope_guard: true, // On by default
  },
  schema: [
    // --- BASIC ---
    { key: "t_voro_scale",    label: "Cell Size",       type: "range", min: 10,  max: 120, step: 1, group: "Texture" },
    { key: "t_voro_depth",    label: "Texture Depth",   type: "range", min: 0,   max: 5.0, step: 0.1, group: "Texture" },
    { key: "t_voro_style",    label: "Style (Bubble/Web)", type: "range", min: 0, max: 1, step: 0.01, group: "Texture" },
    { key: "t_voro_twist",    label: "Twist Flow",      type: "range", min: -2,  max: 2,   step: 0.05, group: "Texture" },
    
    // --- ADVANCED ---
    { key: "t_voro_wall",     label: "Wall Width",      type: "range", min: 0.05,max: 0.8, step: 0.01, group: "Texture", advanced: true },
    { key: "t_voro_stretch",  label: "Vertical Stretch",type: "range", min: 0.2, max: 3.0, step: 0.1,  group: "Texture", advanced: true },
    { key: "t_voro_slope_guard", label: "Print Safe (Slope Guard)", type: "checkbox", group: "Texture", advanced: true },
  ],
  headroom: (p) => clamp(p.t_voro_depth ?? 2.5, 0, 5.0),
  apply,
};
