// src/textures/spiralBands.js
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

  const bands = clamp(Math.floor(p.t_spiral_bands ?? 8), 2, 64);
  const pitch = clamp(p.t_spiral_pitch ?? 30, 5, 60);                 // mm per full revolution
  const sharp = clamp(Math.floor(p.t_spiral_sharpness ?? 3), 1, 8);
  const depth = clamp(p.t_spiral_depth ?? 2.5, 0, 3.0);
  const dual  = !!p.t_spiral_dual;
  const fadeMM = clamp(p.t_spiral_fade_bottom_mm ?? 5, 5, 40);        // 0 means no fade
  const kY = (2 * Math.PI) / pitch;

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

    // right handed spiral
    const s1 = Math.cos(theta * bands + v.y * kY);
    let ridge = Math.max(0, s1);

    // optional opposite handed spiral, combine for a rope like texture
    if (dual) {
      const s2 = Math.cos(-theta * bands + v.y * kY);
      ridge = Math.max(ridge, Math.max(0, s2));
    }

    let profile = Math.pow(ridge, sharp);

    // bottom fade, from 0 at slab to 1 at slab plus fadeMM
    if (fadeMM > 0) {
      const u = (v.y - bottomY) / Math.max(1e-6, fadeMM);
      profile *= smooth01(u);
    }

    // never exceed the 240 mm diameter
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
  id: "spiralBands",
  label: "Spiral bands",
  defaults: {
    t_spiral_bands: 8,
    t_spiral_pitch: 30,       // mm per revolution
    t_spiral_depth: 2.5,      // mm outward
    t_spiral_sharpness: 3,
    t_spiral_dual: true,
    t_spiral_fade_bottom_mm: 5, // 0 means no bottom fade
  },
  schema: [
    { key: "t_spiral_bands",         label: "Spiral strands",    type: "range", min: 2,  max: 64, step: 1 },
    { key: "t_spiral_pitch",         label: "Spiral pitch, mm",  type: "range", min: 5,  max: 60, step: 0.5 },
    { key: "t_spiral_depth",         label: "Depth, mm",         type: "range", min: 0,  max: 1.5, step: 0.05 },
    { key: "t_spiral_sharpness",     label: "Sharpness",         type: "range", min: 1,  max: 3,  step: 0.5 },
    { key: "t_spiral_dual",          label: "Dual direction",    type: "checkbox" },
    { key: "t_spiral_fade_bottom_mm",label: "Fade bottom, mm",   type: "range", min: 5,  max: 40, step: 1 },
  ],
  headroom: (p) => clamp(p.t_spiral_depth ?? 2.5, 0, 3.0),
  apply,
};
