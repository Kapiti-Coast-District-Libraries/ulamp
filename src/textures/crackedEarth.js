// src/textures/crumpled.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smooth01(u) {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * A simple 3D hash function to generate pseudo-random "value noise".
 * Returns a value between 0.0 and 1.0.
 */
function hash3D(x, y, z) {
  let n = x * 12.9898 + y * 78.233 + z * 54.321;
  n = Math.sin(n) * 43758.5453123;
  return n - Math.floor(n); // Return fractional part (0.0 to 1.0)
}

// Pre-allocate vectors
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _radial = new THREE.Vector3();

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  const h_scale = clamp(p.t_crumpled_h_scale ?? 50, 5, 150); // Horizontal "size" of dents
  const v_scale = clamp(p.t_crumpled_v_scale ?? 15, 2, 50);  // Vertical "size" of dents
  const depth = clamp(p.t_crumpled_depth ?? 1.5, 0, 3.0); // Max in/out displacement
  const fadeMM = clamp(p.t_crumpled_fade_bottom_mm ?? 5, 5, 40);
  
  const v_freq = 1.0 / v_scale; 

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

    // Use (cos, sin) of the angle for continuous noise
    const cosTheta = _v.x / r;
    const sinTheta = _v.z / r;
    
    // Get a noise value (0.0 to 1.0)
    const noise_val = hash3D(
      cosTheta * h_scale, 
      sinTheta * h_scale, 
      _v.y * v_freq
    );

    // --- NEW CRUMPLE LOGIC ---
    // Remap noise from [0, 1] to [-1, 1]
    const displacement = (noise_val * 2.0) - 1.0;

    // Calculate fade
    let profile = 1.0;
    if (fadeMM > 0) {
      const u = (_v.y - bottomY) / Math.max(1e-6, fadeMM);
      profile = smooth01(u);
    }

    // Final push amount, can be positive (out) or negative (in)
    let push = displacement * depth * profile;

    if (push > 0) {
      // If pushing *out*, respect the max diameter
      const slack = Math.max(0, maxR - r);
      push = Math.min(push, slack);
    }
    // If push is negative, we just let it push inward.

    if (Math.abs(push) > 1e-4) {
      _v.addScaledVector(_radial, push);
      pos.setXYZ(i, _v.x, _v.y, _v.z);
    }
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export default {
  id: "crumpled",
  label: "Crumpled",
  defaults: {
    t_crumpled_h_scale: 50,
    t_crumpled_v_scale: 15,
    t_crumpled_depth: 1.5,
    t_crumpled_fade_bottom_mm: 5,
  },
  schema: [
    { key: "t_crumpled_h_scale",     label: "Horizontal scale",    type: "range", min: 5,  max: 150, step: 1 },
    { key: "t_crumpled_v_scale",     label: "Vertical scale, mm",  type: "range", min: 2,  max: 50,  step: 0.5 },
    { key: "t_crumpled_depth",       label: "Depth, mm",           type: "range", min: 0,  max: 3.0, step: 0.05 },
    { key: "t_crumpled_fade_bottom_mm",label: "Fade bottom, mm",   type: "range", min: 5,  max: 40,  step: 1 },
  ],
  // Headroom only needs to account for the *outward* push
  headroom: (p) => clamp(p.t_crumpled_depth ?? 1.5, 0, 3.0),
  apply,
};
