// src/textures/softRings.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  const pitch = clamp(p.t_ring_pitch ?? 12, 2, 60);     // mm from crest to crest
  const sharp = Math.max(1, Math.floor(p.t_ring_sharpness ?? 3));
  const depth = clamp(p.t_ring_depth ?? 2.0, 0, 3.0);   // outward only, up to 3 mm
  const fadeTop = clamp(p.t_ring_fadeTop ?? 0.10, 0, 0.5);     // fraction of height to fade near rim
  const fadeBottom = clamp(p.t_ring_fadeBottom ?? 0.05, 0, 0.5); // fraction near the bottom to fade
  const kY = (2 * Math.PI) / pitch;

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

    // do not emboss the bottom slab
    if (v.y <= bottomY) continue;

    // unit radial in XZ
    radial.set(v.x, 0, v.z);
    const r = radial.length();
    if (r < 1e-6) continue;
    radial.multiplyScalar(1 / r);

    // outward facing vertices only
    if (n.dot(radial) <= 0.0) continue;

    // normalized height above the slab, 0 at start of wall, 1 at rim
    const yNorm = clamp((v.y - slab) / usableH, 0, 1);

    // ring profile across height, 0..1
    // base sinus from 0..1, sharpen with pow, then apply top and bottom fades
    const base = 0.5 * (1 + Math.cos(yNorm * usableH * kY)); // 0..1 soft wave
    const crest = Math.pow(base, sharp);

    // linear fades, avoid ridges right on the rim or seating area
    const tFade = fadeTop > 0 ? (yNorm < 1 - fadeTop ? 1 : (1 - yNorm) / fadeTop) : 1;
    const bFade = fadeBottom > 0 ? (yNorm > fadeBottom ? 1 : yNorm / fadeBottom) : 1;
    const fade = Math.max(0, Math.min(1, tFade * bFade));

    const profile = crest * fade;

    // do not exceed 240 mm diameter
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
  id: "softRings",
  label: "Soft rings",
  defaults: {
    t_ring_pitch: 12,       // mm
    t_ring_depth: 2.0,      // mm
    t_ring_sharpness: 3,    // 1..8
    t_ring_fadeTop: 0.10,   // 0..0.5 of height
    t_ring_fadeBottom: 0.05 // 0..0.5 of height
  },
  schema: [
    { key: "t_ring_pitch",     label: "Ring pitch, mm",  type: "range", min: 2,  max: 60, step: 0.5 },
    { key: "t_ring_depth",     label: "Ring depth, mm",  type: "range", min: 0,  max: 3.0, step: 0.05 },
    { key: "t_ring_sharpness", label: "Ring sharpness",  type: "range", min: 1,  max: 4,   step: 1 },
    { key: "t_ring_fadeTop",   label: "Fade near top",   type: "range", min: 0,  max: 0.5, step: 0.01 },
    { key: "t_ring_fadeBottom",label: "Fade near bottom",type: "range", min: 0,  max: 0.5, step: 0.01 },
  ],
  headroom: (p) => clamp(p.t_ring_depth ?? 2.0, 0, 3.0),
  apply,
};
