// src/textures/vortexLattice.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
const MAX_OVERHANG_SLOPE = 1.0;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smooth01(u) { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); }

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  const bands     = Math.max(1, Math.floor(p.t_vortex_bands ?? 18));
  const swirl     = clamp(p.t_vortex_swirl ?? 0.35, -2.0, 2.0); // turns across full height
  const pitchMM   = clamp(p.t_vortex_pitch ?? 16, 4, 120);      // vertical wavelength
  const depthMM   = clamp(p.t_vortex_depth ?? 2.8, 0, 3.5);
  const sharp     = Math.max(1, Math.floor(p.t_vortex_sharpness ?? 3));
  const fadeBotMM = clamp(p.t_vortex_fade_bottom_mm ?? 5, 5, 60);

  const H = p.height ?? 220;
  const kY = (2 * Math.PI) / pitchMM;
  const kT = bands;
  const twistPhase = (theta, y) => theta + 2 * Math.PI * swirl * (y / Math.max(1e-6, H));

  const N = pos.count;
  const maxR = MAX_DIAMETER_MM / 2;
  const bottomY = (p.bottom_thickness ?? 3) + 0.1;

  const v = new THREE.Vector3(), n = new THREE.Vector3(), radial = new THREE.Vector3();

  const thetaArr = new Float32Array(N);
  const yArr     = new Float32Array(N);
  const rArr     = new Float32Array(N);
  const rawPush  = new Float32Array(N);
  const canPush  = new Uint8Array(N);

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

    if (n.dot(radial) <= 0) { canPush[i] = 0; continue; }

    let theta = Math.atan2(v.z, v.x);
    if (theta < 0) theta += Math.PI * 2;
    thetaArr[i] = theta;

    const th = twistPhase(theta, v.y);
    // lattice from product of two angled waves
    const a = Math.cos(kT * th + kY * v.y);
    const b = Math.cos(kT * th - kY * v.y);
    const ridge = 0.5 * (Math.abs(a) + Math.abs(b));
    let prof = Math.pow(Math.max(0, ridge), sharp);

    if (fadeBotMM > 0) {
      const u = (v.y - bottomY) / Math.max(1e-6, fadeBotMM);
      prof *= smooth01(u);
    }

    const slack = Math.max(0, maxR - r);
    rawPush[i] = Math.min(depthMM, slack) * prof;
    canPush[i] = rawPush[i] > 0 ? 1 : 0;
  }

  // Slope budget per angular ray
  const BINS = 720, TWO_PI = Math.PI * 2;
  const bins = Array.from({ length: BINS }, () => []);
  for (let i = 0; i < N; i++) {
    if (!canPush[i]) continue;
    const bin = Math.min(BINS - 1, Math.floor((thetaArr[i] / TWO_PI) * BINS));
    bins[bin].push(i);
  }

  const finalPush = new Float32Array(N);
  for (let b = 0; b < BINS; b++) {
    const idx = bins[b];
    if (idx.length === 0) continue;
    idx.sort((i, j) => yArr[i] - yArr[j]);
    let prev = idx[0];
    finalPush[prev] = Math.min(rawPush[prev], maxR - rArr[prev]);
    for (let k = 1; k < idx.length; k++) {
      const i = idx[k];
      const dy = yArr[i] - yArr[prev];
      const dr = rArr[i] - rArr[prev];
      const baseSlope = Math.max(0, dr / Math.max(1e-6, dy));
      const budget = Math.max(0, MAX_OVERHANG_SLOPE - baseSlope);
      const maxInc = budget * dy;
      const target = Math.min(rawPush[i], maxR - rArr[i]);
      finalPush[i] = Math.min(target, finalPush[prev] + maxInc);
      prev = i;
    }
  }

  for (let i = 0; i < N; i++) {
    const push = finalPush[i];
    if (!push) continue;
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
  id: "vortexLattice",
  label: "Vortex lattice",
  defaults: {
    t_vortex_bands: 18,
    t_vortex_swirl: 0.35,
    t_vortex_pitch: 16,
    t_vortex_depth: 2.8,
    t_vortex_sharpness: 3,
    t_vortex_fade_bottom_mm: 5,
  },
  schema: [
    { key: "t_vortex_bands", label: "Bands around", type: "range", min: 1, max: 64, step: 1 },
    { key: "t_vortex_swirl", label: "Swirl turns", type: "range", min: -2, max: 2, step: 0.01 },
    { key: "t_vortex_pitch", label: "Pitch, mm", type: "range", min: 4, max: 120, step: 0.5 },
    { key: "t_vortex_depth", label: "Depth, mm", type: "range", min: 0, max: 3.5, step: 0.05 },
    { key: "t_vortex_sharpness", label: "Sharpness", type: "range", min: 1, max: 8, step: 1 },
    { key: "t_vortex_fade_bottom_mm", label: "Fade bottom, mm", type: "range", min: 5, max: 60, step: 1 },
  ],
  headroom: (p) => clamp(p.t_vortex_depth ?? 2.8, 0, 3.5),
  apply,
};
