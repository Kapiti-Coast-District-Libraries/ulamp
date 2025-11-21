// src/textures/voronoiCells.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// --- FAST 3D WORLEY NOISE ---
// A simplified implementation to run on the CPU. 
// It finds the distance to the closest feature points in a 3D grid.

const PERM = new Uint8Array(512);
const GRAD = new Float32Array(512 * 3);
// Seed the permutation table once
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

// Hash function to get a deterministic random point in a grid cell
function getFeaturePoint(ix, iy, iz, out) {
  const index = PERM[(ix & 255) + PERM[(iy & 255) + PERM[iz & 255]]];
  // Use the precomputed randoms to offset the point in the 0..1 box
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

  let d1 = 100.0; // Closest distance
  let d2 = 100.0; // Second closest distance

  // Check 3x3x3 neighbor grids
  for (let xx = -1; xx <= 1; xx++) {
    for (let yy = -1; yy <= 1; yy++) {
      for (let zz = -1; zz <= 1; zz++) {
        getFeaturePoint(ix + xx, iy + yy, iz + zz, _feature);
        
        _diff.set(x, y, z).sub(_feature);
        const d2sq = _diff.lengthSq(); // Squared distance is faster to compare
        
        if (d2sq < d1) {
          d2 = d1;
          d1 = d2sq;
        } else if (d2sq < d2) {
          d2 = d2sq;
        }
      }
    }
  }
  
  // Return both squared distances
  return { d1: Math.sqrt(d1), d2: Math.sqrt(d2) };
}


function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  // Params
  const scale = clamp(p.t_voro_scale ?? 40, 10, 150);
  const depth = clamp(p.t_voro_depth ?? 2.0, 0, 5.0);
  const style = clamp(p.t_voro_style ?? 1.0, 0, 1); // 0 = Bubbles, 1 = Webbing
  const wall  = clamp(p.t_voro_wall ?? 0.2, 0.01, 0.8); 
  const twist = p.t_voro_twist ?? 0;
  const stretch = p.t_voro_stretch ?? 1.0;

  const freq = 1.0 / scale;
  const bottomY = (p.bottom_thickness ?? 3) + 0.1;
  const maxRadius = MAX_DIAMETER_MM / 2;
  const height = p.height ?? 220;

  const v = new THREE.Vector3();
  const radial = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    
    // Skip bottom slab
    if (v.y <= bottomY) continue;

    radial.set(v.x, 0, v.z);
    const r = radial.length();
    if (r < 1e-6) continue;
    radial.multiplyScalar(1 / r);

    // Twist calculation
    let theta = Math.atan2(v.z, v.x);
    if (Math.abs(twist) > 0.001) {
      const t = v.y / height;
      theta += t * twist * Math.PI * 2;
    }
    
    // Convert polar coord back to "Twisted Space" for noise lookup
    // We use the perimeter distance (theta * r) for X to minimize distortion
    const nx = theta * r * freq;
    const ny = v.y * freq * stretch;
    const nz = r * freq; // Depth layer
    
    // Calculate Worley Noise
    const w = worley3D(nx, ny, nz);
    
    // Mix between "Bubbles" (d1) and "Cells" (d2 - d1)
    // d1 = distance to center (creates bumps)
    // d2 - d1 = distance to edge (creates ridges)
    const bubbleShape = 1.0 - w.d1; 
    const cellShape   = w.d2 - w.d1;
    
    let rawSignal = (1 - style) * bubbleShape + style * cellShape;
    
    // Apply wall thickness / sharpness
    // We normalize the signal so the "peak" is controlled
    let profile = smoothstep(0, wall, rawSignal);
    
    // Apply depth
    const slack = Math.max(0, maxRadius - r);
    const push = Math.min(depth, slack) * profile;

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
  id: "voronoiCells",
  label: "Voronoi Cells",
  defaults: {
    t_voro_scale: 35,
    t_voro_depth: 2.5,
    t_voro_style: 1.0, // Default to 'Web' look
    t_voro_wall: 0.25,
    t_voro_twist: 0,
    t_voro_stretch: 1.0,
  },
  schema: [
    // --- BASIC CONTROLS ---
    { key: "t_voro_scale",    label: "Cell Size",       type: "range", min: 10,  max: 120, step: 1, group: "Texture" },
    { key: "t_voro_depth",    label: "Texture Depth",   type: "range", min: 0,   max: 5.0, step: 0.1, group: "Texture" },
    { key: "t_voro_style",    label: "Style (Bubble/Web)", type: "range", min: 0, max: 1, step: 0.01, group: "Texture" },
    { key: "t_voro_twist",    label: "Twist Flow",      type: "range", min: -2,  max: 2,   step: 0.05, group: "Texture" },
    
    // --- ADVANCED CONTROLS ---
    { key: "t_voro_wall",     label: "Wall Width",      type: "range", min: 0.05,max: 0.8, step: 0.01, group: "Texture", advanced: true },
    { key: "t_voro_stretch",  label: "Vertical Stretch",type: "range", min: 0.2, max: 3.0, step: 0.1,  group: "Texture", advanced: true },
  ],
  headroom: (p) => clamp(p.t_voro_depth ?? 2.5, 0, 5.0),
  apply,
};
