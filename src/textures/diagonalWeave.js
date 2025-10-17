// src/textures/diagonalWeave.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
const MAX_OVERHANG_SLOPE = 1.0; // mm radial growth per 1 mm Z, equals 45 degrees

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// Smoothstep helper, 0 to 1
function smooth01(u) {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
}

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  const bands = Math.max(2, Math.floor(p.t_weave_bands ?? 28));
  const pitch = clamp(p.t_weave_pitch ?? 14, 2, 60);   // mm per vertical cycle
  const sharp = Math.max(1, Math.floor(p.t_weave_sharpness ?? 3));
  const depth = clamp(p.t_weave_depth ?? 2.5, 0, 3.0);
  const kY = (2 * Math.PI) / pitch;

  const fadeMM = clamp(p.t_weave_fade_bottom_mm ?? 5, 5, 40); // 0 disables fade

  const maxR = MAX_DIAMETER_MM / 2;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const bottomY = (p.bottom_thickness ?? 3) + 0.1;

  // Precompute per vertex data
  const N = pos.count;
  const thetaArr = new Float32Array(N);
  const yArr = new Float32Array(N);
  const rArr = new Float32Array(N);
  const rawPushArr = new Float32Array(N);
  const canPush = new Uint8Array(N);

  for (let i = 0; i < N; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);

    yArr[i] = v.y;

    if (v.y <= bottomY) { canPush[i] = 0; continue; }

    radial.set(v.x, 0, v.z);
    const r = radial.length();
    rArr[i] = r;
    if (r < 1e-6) { canPush[i] = 0; continue; }
    radial.multiplyScalar(1 / r);

    // only push where the local normal points outward
    if (n.dot(radial) <= 0.0) { canPush[i] = 0; continue; }

    let theta = Math.atan2(v.z, v.x);
    if (theta < 0) theta += Math.PI * 2;
    thetaArr[i] = theta;

    const f1 = Math.cos(theta * bands + v.y * kY);
    const f2 = Math.cos(-theta * bands + v.y * kY);
    const ridge = 0.5 * (Math.abs(f1) + Math.abs(f2));
    const profile = Math.pow(Math.max(0, ridge), sharp);

    const slack = Math.max(0, maxR - r);
    let push = Math.min(depth, slack) * profile;

    // bottom fade, smooth from 0 at slab to 1 at bottomY + fadeMM
    if (fadeMM > 0) {
      const u = (v.y - bottomY) / Math.max(1e-6, fadeMM);
      const f = smooth01(u);
      push *= f;
    }

    rawPushArr[i] = push;
    canPush[i] = push > 0 ? 1 : 0;
  }

  // Bin by angle and enforce 45 degree slope budget along each ray
  const BINS = 720; // 0.5 degree bins
  const binLists = Array.from({ length: BINS }, () => []);
  const TWO_PI = Math.PI * 2;

  for (let i = 0; i < N; i++) {
    if (!canPush[i]) continue;
    const bin = Math.min(BINS - 1, Math.max(0, Math.floor((thetaArr[i] / TWO_PI) * BINS)));
    binLists[bin].push(i);
  }

  const finalPush = new Float32Array(N);

  for (let b = 0; b < BINS; b++) {
    const idxs = binLists[b];
    if (idxs.length === 0) continue;

    idxs.sort((i, j) => yArr[i] - yArr[j]);

    let prevI = idxs[0];
    finalPush[prevI] = Math.min(rawPushArr[prevI], maxR - rArr[prevI]);

    for (let k = 1; k < idxs.length; k++) {
      const i = idxs[k];
      const dy = yArr[i] - yArr[prevI];
      if (dy <= 1e-6) {
        finalPush[i] = Math.min(rawPushArr[i], maxR - rArr[i]);
        continue;
      }

      const dr_base = rArr[i] - rArr[prevI];
      const baseSlope = Math.max(0, dr_base / dy);

      const budget = Math.max(0, MAX_OVERHANG_SLOPE - baseSlope);
      const maxInc = budget * dy;

      const target = Math.min(rawPushArr[i], maxR - rArr[i]);
      const allowed = Math.min(target, finalPush[prevI] + maxInc);

      finalPush[i] = allowed;
      prevI = i;
    }
  }

  // Apply
  for (let i = 0; i < N; i++) {
    const push = finalPush[i];
    if (!push || !canPush[i]) continue;

    v.fromBufferAttribute(pos, i);
    radial.set(v.x, 0, v.z);
    const r = radial.length();
    if (r < 1e-6) continue;
    radial.multiplyScalar(1 / r);

    const slack = Math.max(0, maxR - r);
    const pClamped = Math.min(push, slack);
    if (pClamped <= 0) continue;

    v.addScaledVector(radial, pClamped);
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export default {
  id: "diagonalWeave",
  label: "Diagonal weave",
  defaults: {
    t_weave_bands: 28,
    t_weave_pitch: 14,
    t_weave_depth: 2.5,
    t_weave_sharpness: 3,
    t_weave_fade_bottom_mm: 2, // 0 means no bottom fade
  },
  schema: [
    { key: "t_weave_bands",     label: "Weave bands",       type: "range", min: 2,  max: 64, step: 1 },
    { key: "t_weave_pitch",     label: "Weave pitch, mm",   type: "range", min: 2,  max: 60, step: 0.5 },
    { key: "t_weave_depth",     label: "Weave depth, mm",   type: "range", min: 0,  max: 3.0, step: 0.05 },
    { key: "t_weave_sharpness", label: "Weave sharpness",   type: "range", min: 1,  max: 8,  step: 1 },
    { key: "t_weave_fade_bottom_mm", label: "Fade bottom, mm", type: "range", min: 0, max: 40, step: 1 },
  ],
  headroom: (p) => clamp(p.t_weave_depth ?? 2.5, 0, 3.0),
  apply,
};
