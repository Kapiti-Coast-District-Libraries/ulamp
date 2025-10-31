// src/textures/softRings.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  const pitch = clamp(p.t_ring_pitch ?? 12, 2, 60);           // mm from crest to crest
  const sharp = Math.max(1, Math.floor(p.t_ring_sharpness ?? 3));
  const depth = clamp(p.t_ring_depth ?? 2.0, 0, 3.0);         // target amplitude
  const fadeTop = clamp(p.t_ring_fadeTop ?? 0.10, 0, 0.5);    // fraction of height to fade near rim
  const fadeBottom = clamp(p.t_ring_fadeBottom ?? 0.05, 0, 0.5); // fraction near the bottom to fade
  const bothSides = p.t_ring_bothSides ?? true;               // move both inner and outer walls by same push
  const kY = (2 * Math.PI) / pitch;

  const maxR = MAX_DIAMETER_MM / 2;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const radial = new THREE.Vector3();

  const slab = p.bottom_thickness ?? 3;
  const bottomY = slab + 0.1;
  const usableH = Math.max(1e-3, (p.height ?? 100) - slab);

  // how much a normal must align with radial to be treated as sidewall
  const sideAlign = 0.25; // 0..1, higher is stricter

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);

    // skip bottom slab and underside
    if (v.y <= bottomY) continue;

    // unit radial in XZ
    radial.set(v.x, 0, v.z);
    const r = radial.length();
    if (r < 1e-6) continue;
    radial.multiplyScalar(1 / r);

    // sidewall only, avoid top rim and bottom faces
    const wallness = Math.abs(n.dot(radial));
    if (wallness < sideAlign) continue;

    // normalized height above the slab, 0 at start of wall, 1 at rim
    const yNorm = clamp((v.y - slab) / usableH, 0, 1);

    // ring profile across height, 0..1
    // cosine gives soft wave, sharpen with pow, fade near top and bottom
    const base = 0.5 * (1 + Math.cos(yNorm * usableH * kY)); // 0..1
    const crest = Math.pow(base, sharp);

    const tFade = fadeTop > 0 ? (yNorm < 1 - fadeTop ? 1 : (1 - yNorm) / fadeTop) : 1;
    const bFade = fadeBottom > 0 ? (yNorm > fadeBottom ? 1 : yNorm / fadeBottom) : 1;
    const fade = clamp(tFade * bFade, 0, 1);

    const profile = crest * fade;

    // respect max outer diameter
    const slack = Math.max(0, maxR - r);
    const push = Math.min(depth, slack) * profile;

    if (push <= 0) continue;

    if (bothSides) {
      // constant thickness, move every side vertex outward by push
      v.addScaledVector(radial, push);
    } else {
      // legacy, outward only on outward facing vertices
      if (n.dot(radial) > 0) v.addScaledVector(radial, push);
    }

    pos.setXYZ(i, v.x, v.y, v.z);
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export default {
  id: "softRings",
  label: "Soft rings",
  defaults: {
    t_ring_pitch: 12,        // mm
    t_ring_depth: 2.0,       // mm
    t_ring_sharpness: 3,     // 1..8
    t_ring_fadeTop: 0.10,    // 0..0.5 of height
    t_ring_fadeBottom: 0.05, // 0..0.5 of height
    t_ring_bothSides: true   // affect inside and outside, constant thickness
  },
  schema: [
    { key: "t_ring_pitch",      label: "Ring pitch, mm",       type: "range", min: 6,  max: 60, step: 0.5 },
    { key: "t_ring_depth",      label: "Ring depth, mm",       type: "range", min: 0,  max: 1.6, step: 0.05 },
    { key: "t_ring_sharpness",  label: "Ring sharpness",       type: "range", min: 1,  max: 2.5,   step: .5 },
    { key: "t_ring_fadeTop",    label: "Fade near top",        type: "range", min: 0,  max: 0.5, step: 0.01 },
    { key: "t_ring_fadeBottom", label: "Fade near bottom",     type: "range", min: 0,  max: 0.5, step: 0.01 },
    { key: "t_ring_bothSides",  label: "Affect inside and outside", type: "checkbox" }
  ],
  headroom: (p) => clamp(p.t_ring_depth ?? 2.0, 0, 3.0),
  apply,
};

