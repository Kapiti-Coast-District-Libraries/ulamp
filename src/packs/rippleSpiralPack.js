// src/packs/rippleSpiralPack.js
import * as THREE from "three";
import { textures, textureOptions } from "../textures";

const MAX_SIZE = 240;
const MIN_THICK = 0.8;
const MAX_THICK = 1;
const BOTTOM_THICK = 3;
const FIXED_HOLE_DIAMETER = 80;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

const PREVIEW_CAPS = { maxRadial: 960, maxRes: 1000, stepMM: 0.6 };
const EXPORT_CAPS  = { maxRadial: 1400, maxRes: 1600, stepMM: 0.35 };

/* detail */
function recommendedRadialSegments(p, caps) {
  const k = clamp(p.gyroidFreq ?? 0.9, 0.2, 3);
  const want = Math.max(240, Math.round(900 * k));
  return clamp(want, 96, caps.maxRadial);
}
function recommendedResolution(p, caps) {
  const base = Math.ceil((p.height ?? 220) / caps.stepMM);
  return clamp(base, 180, caps.maxRes);
}

/* base profile */
function rOuterAt(t, p) {
  const r = p.baseRadius + (p.topRadius - p.baseRadius) * t;
  const maxR = MAX_SIZE * 0.5;
  const head = p.texture_headroom ?? 0;
  return Math.min(r, Math.max(0.5, maxR - head));
}
function rInnerAt(t, p) { return Math.max(rOuterAt(t, p) - p._wallForLathe, 0.5); }

function makeProfileWithHole(p) {
  const H = p.height;
  const N = p.resolution;
  const rHole = FIXED_HOLE_DIAMETER * 0.5;
  const pts = [];
  pts.push(new THREE.Vector2(rHole, 0));
  pts.push(new THREE.Vector2(rOuterAt(0, p), 0));
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    pts.push(new THREE.Vector2(rOuterAt(t, p), t * H));
  }
  const rTopIn = Math.max(rInnerAt(1, p), 0.5);
  pts.push(new THREE.Vector2(rTopIn, H));
  for (let i = N - 1; i >= 0; i--) {
    const t = i / N, y = t * H;
    if (y < BOTTOM_THICK) break;
    pts.push(new THREE.Vector2(rInnerAt(t, p), y));
  }
  const rInSlab = Math.max(rInnerAt(BOTTOM_THICK / H, p), 0.5);
  pts.push(new THREE.Vector2(Math.min(rInSlab, rHole), BOTTOM_THICK));
  pts.push(new THREE.Vector2(rHole, BOTTOM_THICK));
  pts.push(new THREE.Vector2(rHole, 0));
  return pts;
}

/* gyroid field mapped inward offset */
function gField(x, y, z, a) {
  return Math.sin(a * x) * Math.cos(a * y) + Math.sin(a * y) * Math.cos(a * z) + Math.sin(a * z) * Math.cos(a * x);
}

function inwardOffsetRaw(theta, t, p, r) {
  const a = clamp(p.gyroidFreq ?? 0.9, 0.2, 3);
  const spin = (p.gyroidPhaseDeg ?? 0) * Math.PI / 180;
  const H = p.height;
  const x = Math.cos(theta + spin) * r / 30;
  const z = Math.sin(theta + spin) * r / 30;
  const y = t * (H / 30);
  const f = gField(x, y, z, a);
  const th = clamp(p.gyroidThreshold ?? 0.15, 0.0, 0.9);
  const w = Math.abs(f) - th;
  const k = clamp(p.gyroidSharp ?? 3, 1, 12);
  const u = 1 - clamp(w / (0.5 - th), 0, 1);
  const shaped = Math.pow(u, k);
  const baseAmp = clamp(p.inwardDepthMM ?? 3.0, 0, 10);
  const topScale = clamp(p.depthTopScale ?? 0.4, 0, 1);
  const amp = baseAmp * (1 - t + t * topScale);
  return amp * shaped;
}

function scaleFromOffset(r, d) {
  const s = 1 - d / Math.max(r, 1e-6);
  return clamp(s, 0.2, 1);
}

function estimateMinScale(p) {
  let minS = 1;
  const stepsT = 18;
  const stepsA = 360;
  for (let i = 0; i <= stepsT; i++) {
    const t = i / stepsT;
    const r = rOuterAt(t, p);
    for (let j = 0; j < stepsA; j++) {
      const th = j / stepsA * Math.PI * 2;
      const d = inwardOffsetRaw(th, t, p, r);
      const s = scaleFromOffset(r, d);
      if (s < minS) minS = s;
    }
  }
  return Math.max(0.2, Math.min(1, minS));
}

function clampTopFor45(p) {
  if (p.topRadius <= p.baseRadius) return;
  const maxAllowed = p.baseRadius + p.height * 1.0;
  if (p.topRadius > maxAllowed) p.topRadius = maxAllowed;
}

function constrainParams(pIn = {}, caps = PREVIEW_CAPS) {
  const out = { ...pIn };
  out.height = clamp(pIn.height ?? 220, 100, MAX_SIZE);
  out.wall   = clamp(pIn.wall ?? 1.2, MIN_THICK, MAX_THICK);

  const baseMin = Math.max(45, out.wall + 2, FIXED_HOLE_DIAMETER * 0.5 + 5);
  out.baseRadius = clamp(pIn.baseRadius ?? 116, baseMin, MAX_SIZE / 2);
  out.topRadius  = clamp(pIn.topRadius  ?? 92,  out.wall + 2, MAX_SIZE / 2);

  out.gyroidFreq      = clamp(pIn.gyroidFreq ?? 0.9, 0.2, 3);
  out.gyroidPhaseDeg  = clamp(pIn.gyroidPhaseDeg ?? 0, 0, 360);
  out.gyroidThreshold = clamp(pIn.gyroidThreshold ?? 0.15, 0, 0.9);
  out.gyroidSharp     = clamp(pIn.gyroidSharp ?? 3, 1, 12);
  out.inwardDepthMM   = clamp(pIn.inwardDepthMM ?? 3.0, 0, 10);
  out.depthTopScale   = clamp(pIn.depthTopScale ?? 0.4, 0, 1);

  out.texture = pIn.texture ?? (textureOptions[0]?.value ?? "none");
  const tex = textures[out.texture];
  out.texture_headroom = tex?.headroom ? tex.headroom(out) : 0;

  clampTopFor45(out);

  const minS = estimateMinScale(out);
  out._minScale = minS;
  // REVERTED: Just use standard inflation for gyroid, no extra pinch inflation
  out._wallForLathe = clamp(out.wall / Math.max(1e-6, minS), MIN_THICK, 3.0);

  out.radialSegments = recommendedRadialSegments(out, caps);
  out.resolution     = recommendedResolution(out, caps);

  out.bottom_thickness = BOTTOM_THICK;
  out._holeRadius = FIXED_HOLE_DIAMETER * 0.5;
  out.autoSpin = false; 
  return out;
}

function buildGyroidGlow(params, caps = PREVIEW_CAPS) {
  const p = constrainParams(params, caps);
  const profile = makeProfileWithHole(p);
  const geom = new THREE.LatheGeometry(profile, p.radialSegments);
  geom.computeVertexNormals();

  const H = p.height;
  const N = p.resolution;
  const A = p.radialSegments;
  const dy = H / N;

  const rBase = new Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    rBase[i] = rOuterAt(t, p);
  }

  const dRaw = Array.from({ length: N + 1 }, () => new Float32Array(A));
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = rBase[i];
    for (let a = 0; a < A; a++) {
      const theta = (a / A) * Math.PI * 2;
      dRaw[i][a] = inwardOffsetRaw(theta, t, p, r);
    }
  }

  const dClamped = Array.from({ length: N + 1 }, () => new Float32Array(A));
  for (let a = 0; a < A; a++) {
    const rEff0 = Math.max(0.5, rBase[0] - dRaw[0][a]);
    dClamped[0][a] = clamp(dRaw[0][a], 0, rBase[0] - 0.2);
    let lastEff = rEff0;

    for (let i = 1; i <= N; i++) {
      const rOut = rBase[i];
      const desired = Math.max(0.5, rOut - dRaw[i][a]);
      const maxAllowed = lastEff + dy;
      const eff = Math.min(desired, maxAllowed);
      const d = clamp(rOut - eff, 0, rOut - 0.2);
      dClamped[i][a] = d;
      lastEff = Math.max(0.5, rOut - d);
    }
  }

  const pos = geom.attributes.position;
  const v = new THREE.Vector3();

  function indexForVertex(x, y, z) {
    const t = THREE.MathUtils.clamp(H > 0 ? y / H : 0, 0, 1);
    const iT = Math.round(t * N);
    let theta = Math.atan2(z, x);
    if (theta < 0) theta += Math.PI * 2;
    const iA = Math.round(theta / (Math.PI * 2) * A) % A;
    return { iT, iA };
  }

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.y <= BOTTOM_THICK + 1e-6) {
      const r0 = Math.hypot(v.x, v.z);
      if (r0 <= p._holeRadius + 0.25) continue;
    }
    const { iT, iA } = indexForVertex(v.x, v.y, v.z);
    const r = Math.hypot(v.x, v.z);
    const d = dClamped[iT][iA];
    const s = scaleFromOffset(r, d);
    v.x *= s; v.z *= s;
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();

  const entry = textures[p.texture];
  return entry?.apply ? entry.apply(geom, p) : geom;
}

function schemaFor(params) {
  const base = [
    { key: "height",        label: "Height",          type: "range", min: 100, max: MAX_SIZE, step: 1, group: "Shape" },
    { key: "baseRadius",    label: "Bottom Size",     type: "range", min: 45, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    { key: "topRadius",     label: "Top Size",        type: "range", min: 10, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    { key: "wall",          label: "Wall Thickness",  type: "range", min: MIN_THICK, max: MAX_THICK, step: 0.1, group: "Shape", advanced: true },
    { key: "gyroidFreq",      label: "Pattern Density", type: "range", min: 0.2, max: 3, step: 0.01, group: "Pattern" },
    { key: "gyroidThreshold", label: "Window Openness", type: "range", min: 0, max: 0.9, step: 0.01, group: "Pattern" },
    { key: "inwardDepthMM",   label: "Indent Depth",    type: "range", min: 0, max: 2, step: 0.1, group: "Pattern" },
    { key: "gyroidPhaseDeg",  label: "Pattern Shift",   type: "range", min: 0, max: 360, step: 1, group: "Pattern", advanced: true },
    { key: "gyroidSharp",     label: "Edge Sharpness",  type: "range", min: 1, max: 12, step: 0.1, group: "Pattern", advanced: true },
    { key: "depthTopScale",   label: "Fade at Top",     type: "range", min: 0, max: 1, step: 0.01, group: "Pattern", advanced: true },
  ];
  const texId = params?.texture ?? (textureOptions[0]?.value ?? "none");
  const texDesc = textures[texId];
  const rawTex = texDesc?.schema ?? [];
  const texFields = rawTex
    .filter(e => e.key !== "gyroidTwistTurns")
    .map(f => ({ ...f, group: "Texture" }));
  const texSelector = { key: "texture", label: "Style", type: "select", options: textureOptions, group: "Texture" };
  return [ ...base, texSelector, ...texFields ];
}

function defaultsFactory() {
  const firstTex = textureOptions[0]?.value ?? "none";
  const d = {
    height: 220, wall: 1.2,
    baseRadius: 116, topRadius: 92,
    gyroidFreq: 0.9, gyroidPhaseDeg: 0,
    gyroidThreshold: 0.15, gyroidSharp: 3,
    inwardDepthMM: 3.0, depthTopScale: 0.4,
    texture: firstTex, 
  };
  const tex = textures[firstTex];
  return tex?.defaults ? { ...d, ...tex.defaults } : d;
}

export const models = {
  gyroidGlow: {
    label: "Gyroid Glow",
    schema: (p) => schemaFor(p),
    defaults: () => defaultsFactory(),
    build: (p) => buildGyroidGlow(p, PREVIEW_CAPS),
  },
};

function exportSTL(params) {
  import("three-stdlib").then(({ STLExporter }) => {
    const geom = buildGyroidGlow(params, EXPORT_CAPS);
    const exporter = new STLExporter();
    const data = exporter.parse(geom, { binary: true });
    const blob = new Blob([data], { type: "application/sla" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lampshade_gyroid_glow.stl";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}
const label = "Lampshade, Gyroid Glow";
export default { label, models, export: exportSTL };
