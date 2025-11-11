// src/textures/waveInterference.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// Smoothstep 0..1
function smooth01(u) {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
}

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  // Wave 1 params
  const bands1 = clamp(Math.floor(p.t_wave1_bands ?? 8), 2, 64);
  const pitch1 = clamp(p.t_wave1_pitch ?? 30, 5, 60);
  const kY1 = (2 * Math.PI) / pitch1;

  // Wave 2 params
  const bands2 = clamp(Math.floor(p.t_wave2_bands ?? 12), 2, 64);
  const pitch2 = clamp(p.t_wave2_pitch ?? 45, 5, 60);
  const kY2 = (2 * Math.PI) / pitch2;

  // Shared params
  const sharp = clamp(Math.floor(p.t_wave_sharpness ?? 3), 1, 8);
  const depth = clamp(p.t_wave_depth ?? 1.5, 0, 3.0);
  const fadeMM = clamp(p.t_wave_fade_bottom_mm ?? 5, 5, 40);

  const maxR = MAX_DIAMETER_MM / 2;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const bottomY = (p.bottom_thickness ?? 3) + 0.1; // keep the solid slab clean

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

    // angle around, 0 to 2π
    let theta = Math.atan2(v.z, v.x);
    if (theta < 0) theta += Math.PI * 2;

    // 1. Calculate both waves
    // These are in the range [-1, 1]
    const s1 = Math.cos(theta * bands1 + v.y * kY1);
    const s2 = Math.cos(theta * bands2 + v.y * kY2); // Can use -theta for opposite spiral

    // 2. Combine them
    // (s1 + s2) gives a combined wave in the range [-2, 2]
    // We normalize it back to [-1, 1] by dividing by 2
    const combinedWave = (s1 + s2) / 2.0;

    // 3. Get the profile (only the positive part)
    const ridge = Math.max(0, combinedWave); // Range [0, 1]
    let profile = Math.pow(ridge, sharp);

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
Next   }
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export default {
  id: "waveInterference",
  label: "Wave Interference",
  defaults: {
    t_wave1_bands: 8,
    t_wave1_pitch: 30,
    t_wave2_bands: 12,
    t_wave2_pitch: 45,
    t_wave_depth: 1.5,
    t_wave_sharpness: 3,
    t_wave_fade_bottom_mm: 5,
  },
  schema: [
    { key: "t_wave_depth",         label: "Depth, mm",         type: "range", min: 0,  max: 3.0, step: 0.05 },
    { key: "t_wave_sharpness",     label: "Sharpness",         type: "range", min: 1,  max: 8,  step: 0.5 },
    { key: "t_wave1_bands",         label: "Wave 1: Strands",    type: "range", min: 2,  max: 64, step: 1 },
    { key: "t_wave1_pitch",         label: "Wave 1: Pitch, mm",  type: "range", min: 5,  max: 60, step: 0.5 },
    { key: "t_wave2_bands",         label: "Wave 2: Strands",    type: "range", min: 2,  max: 64, step: 1 },
    { key: "t_wave2_pitch",         label: "Wave 2: Pitch, mm",  type: "range", min: 5,  max: 60, step: 0.5 },
    { key: "t_wave_fade_bottom_mm",label: "Fade bottom, mm",   type: "range", min: 5,  max: 40, step: 1 },
  ],
  headroom: (p) => clamp(p.t_wave_depth ?? 1.5, 0, 3.0),
  apply,
};
