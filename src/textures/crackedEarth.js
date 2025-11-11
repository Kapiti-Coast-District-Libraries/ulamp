// src/textures/crackedEarth.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// Smoothstep 0..1
function smooth01(u) {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
}

// --- Noise Functions ---
// These are helper functions for the Worley noise
const HASH_V1 = new THREE.Vector3(127.1, 311.7, 74.7);
const HASH_V2 = new THREE.Vector3(269.5, 183.3, 246.1);
const HASH_V3 = new THREE.Vector3(113.5, 271.9, 124.6);
const HASH_K = 43758.5453;

// 3D hash function (vec3 to vec3)
// Returns a procedural pseudo-random vec3 in the range [0, 1]
function hash33(p) {
  let p3 = new THREE.Vector3(p.dot(HASH_V1), p.dot(HASH_V2), p.dot(HASH_V3));
  p3.set(
    Math.abs(Math.sin(p3.x) * HASH_K),
    Math.abs(Math.sin(p3.y) * HASH_K),
    Math.abs(Math.sin(p3.z) * HASH_K)
  );
  p3.set(p3.x - Math.floor(p3.x), p3.y - Math.floor(p3.y), p3.z - Math.floor(p3.z));
  return p3;
}

// Pre-allocate vectors for performance (avoid creating new ones in the loop)
const WORLEY_P_FLOOR = new THREE.Vector3();
const WORLEY_OFFSET = new THREE.Vector3();
const WORLEY_CELL_ID = new THREE.Vector3();
const WORLEY_POINT_IN_CELL = new THREE.Vector3();

// 3D Worley noise function.
// Returns F1 (distance to the nearest feature point)
function worley3D(p) {
  WORLEY_P_FLOOR.set(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  let F1 = 1000.0;

  // Check 3x3x3 grid of cells around the current point
  for (let k = -1; k <= 1; k++) {
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        WORLEY_OFFSET.set(i, j, k);
        WORLEY_CELL_ID.copy(WORLEY_P_FLOOR).add(WORLEY_OFFSET);
        
        // Get the random feature point inside this cell
        WORLEY_POINT_IN_CELL.copy(WORLEY_CELL_ID).add(hash33(WORLEY_CELL_ID));
        
        const d = p.distanceTo(WORLEY_POINT_IN_CELL);
        
        if (d < F1) {
          F1 = d;
        }
      }
    }
  }
  return F1;
}
// --- End Noise Functions ---


function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  const scale = clamp(p.t_crack_scale ?? 25, 5, 50);
  const depth = clamp(p.t_crack_depth ?? 1.0, 0, 2.0);
  const sharp = clamp(p.t_crack_sharpness ?? 2, 1, 8);
  const fadeMM = clamp(p.t_crack_fade_bottom_mm ?? 5, 5, 40);

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
    // A smaller scale value makes the "plates" bigger
    wp.copy(v).multiplyScalar(1.0 / scale);

    // 2. Get noise value (distance to nearest cell center)
    // F1 is 0 at the center, ~0.5 at the cell edge
    const F1 = worley3D(wp);

    // 3. Create the plate profile
    // Map F1 from [0, 0.5] to [0, 1]
    let plate = clamp(F1 * 2.0, 0, 1);
    // Invert it and smooth it to create a raised plate
    let profile = 1.0 - smooth01(plate);
    // Sharpen the edges of the plate
    profile = Math.pow(profile, sharp);

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
  id: "crackedEarth",
  label: "Cracked Earth",
  defaults: {
    t_crack_scale: 25,
    t_crack_depth: 1.0,
    t_crack_sharpness: 2,
    t_crack_fade_bottom_mm: 5,
  },
  schema: [
    { key: "t_crack_scale",          label: "Plate Size, mm",     type: "range", min: 10, max: 50, step: 1 },
    { key: "t_crack_depth",          label: "Plate Depth, mm",    type: "range", min: 0,  max: 2.0, step: 0.05 },
    { key: "t_crack_sharpness",      label: "Plate Sharpness",    type: "range", min: 1,  max: 8,  step: 0.5 },
    { key: "t_crack_fade_bottom_mm", label: "Fade bottom, mm",   type: "range", min: 5,  max: 40, step: 1 },
  ],
  headroom: (p) => clamp(p.t_crack_depth ?? 1.0, 0, 2.0),
  apply,
};
