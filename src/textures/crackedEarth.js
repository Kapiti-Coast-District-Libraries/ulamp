// src/textures/hammered.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smooth01(u) {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * A simple 3D hash function to generate pseudo-random "value noise".
 * It takes three numbers and returns a consistent random-looking
 * value between 0.0 and 1.0.
 */
function hash3D(x, y, z) {
  // Using arbitrary large-ish prime-like numbers for mixing
  let n = x * 12.9898 + y * 78.233 + z * 54.321;
  n = Math.sin(n) * 43758.5453123;
  return n - Math.floor(n); // Return fractional part (0.0 to 1.0)
}

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  // NEW: Parameters for hammered look
  const bands = clamp(p.t_hammered_bands ?? 50, 5, 150); // Horizontal "count" of dents
  const pitch = clamp(p.t_hammered_pitch ?? 15, 2, 50);  // Vertical "size" of dents
  const sharp = clamp(Math.floor(p.t_hammered_sharpness ?? 1), 1, 5);
  const depth = clamp(p.t_hammered_depth ?? 0.8, 0, 2.0);
  const fadeMM = clamp(p.t_hammered_fade_bottom_mm ?? 5, 5, 40);
  
  const v_scale = 1.0 / pitch; // Vertical frequency

  const maxR = MAX_DIAMETER_MM / 2;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const bottomY = (p.bottom_thickness ?? 3) + 0.1;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);

    if (v.y <= bottomY) continue;

    radial.set(v.x, 0, v.z);
    const r = radial.length();
    if (r < 1e-6) continue;
    radial.multiplyScalar(1 / r);

    if (n.dot(radial) <= 0.0) continue;

    // NEW: Use 3D noise input to avoid seams
    // We use (cos, sin) of the angle to create a continuous
    // input field around the cylinder's circumference.
    const cosTheta = v.x / r;
    const sinTheta = v.z / r;
    
    // Get a noise value (0.0 to 1.0) based on position
    const noise_val = hash3D(
      cosTheta * bands, 
      sinTheta * bands, 
      v.y * v_scale
    );

    // Profile is the noise value, optionally sharpened
    // sharpness = 1 gives soft, round dents
    // sharpness > 1 gives sharper, smaller dents
    let profile = Math.pow(noise_val, sharp);

    if (fadeMM > 0) {
      const u = (v.y - bottomY) / Math.max(1e-6, fadeMM);
      profile *= smooth01(u);
    }

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
  id: "hammered",
  label: "Hammered",
  defaults: {
    t_hammered_bands: 50,
    t_hammered_pitch: 15,
    t_hammered_depth: 0.8,
    t_hammered_sharpness: 1, // Default to 1 for soft dents
    t_hammered_fade_bottom_mm: 5,
  },
  schema: [
    { key: "t_hammered_bands",       label: "Horizontal density",  type: "range", min: 5,  max: 150, step: 1 },
    { key: "t_hammered_pitch",       label: "Vertical size, mm",   type: "range", min: 2,  max: 50,  step: 0.5 },
    { key: "t_hammered_depth",       label: "Depth, mm",           type: "range", min: 0,  max: 2.0, step: 0.05 },
    { key: "t_hammered_sharpness",   label: "Sharpness",           type: "range", min: 1,  max: 5,   step: 0.5 },
    { key: "t_hammered_fade_bottom_mm",label: "Fade bottom, mm",   type: "range", min: 5,  max: 40,  step: 1 },
  ],
  headroom: (p) => clamp(p.t_hammered_depth ?? 0.8, 0, 2.0),
  apply,
};
