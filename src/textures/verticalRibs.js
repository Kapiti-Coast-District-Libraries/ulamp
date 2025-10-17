// src/textures/verticalRibs.js
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

  const ribs   = Math.max(2, Math.floor(p.t_ribs_count ?? 24));
  const sharp  = Math.max(1, Math.floor(p.t_ribs_sharpness ?? 4));
  const depth  = clamp(p.t_ribs_depth ?? 3.0, 0, 3.0);
  const fadeMM = clamp(p.t_ribs_fade_bottom_mm ?? 5, 5, 40); // 0 means no fade

  const bottomY = (p.bottom_thickness ?? 3) + 0.1;
  const maxRadius = MAX_DIAMETER_MM / 2;

  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const radial = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);

    if (v.y <= bottomY) continue;

    radial.set(v.x, 0, v.z);
    const r = radial.length();
    if (r < 1e-6) continue;
    radial.multiplyScalar(1 / r);

    // only push where the local normal faces outward
    if (n.dot(radial) <= 0.0) continue;

    let theta = Math.atan2(v.z, v.x);
    if (theta < 0) theta += Math.PI * 2;

    const ridge = Math.max(0, Math.cos(theta * ribs));
    const profile = Math.pow(ridge, sharp);

    // base push
    const slack = Math.max(0, maxRadius - r);
    let push = Math.min(depth, slack) * profile;

    // bottom fade from 0 at slab to 1 at slab + fadeMM
    if (fadeMM > 0) {
      const u = (v.y - bottomY) / Math.max(1e-6, fadeMM);
      const f = smooth01(u);
      push *= f;
    }

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
  id: "verticalRibs",
  label: "Vertical ribs",
  defaults: {
    t_ribs_count: 44,
    t_ribs_depth: 3.0,
    t_ribs_sharpness: 4,
    t_ribs_fade_bottom_mm: 5, // 0 means no bottom fade
  },
  schema: [
    { key: "t_ribs_count",         label: "Rib count",        type: "range", min: 2,  max: 120, step: 1 },
    { key: "t_ribs_depth",         label: "Rib depth, mm",    type: "range", min: 0,  max: 3.0, step: 0.05 },
    { key: "t_ribs_sharpness",     label: "Rib sharpness",    type: "range", min: 1,  max: 8,  step: 1 },
    { key: "t_ribs_fade_bottom_mm",label: "Fade bottom, mm",  type: "range", min: 5,  max: 40, step: 1 },
  ],
  headroom: (p) => clamp(p.t_ribs_depth ?? 3.0, 0, 3.0),
  apply,
};
