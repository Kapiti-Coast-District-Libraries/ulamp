// src/packs/superellipsePack.js
// ...imports unchanged...
import * as THREE from "three";
import { textures, textureOptions } from "../textures";

const MAX_SIZE = 240;
const MIN_THICK = 0.8;
const MAX_THICK = 1.2;
const BOTTOM_THICK = 3;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
const PREVIEW_CAPS = { radial: 540, vertical: 700 };
const EXPORT_CAPS  = { radial: 1200, vertical: 1400 };

// R_superellipse, outerRadiusAt, applyHeadroomAndBounds, estimateMinScale, autoDetail
// (keep the same as your current file)

function R_superellipse(theta, A, B, n) {
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  const denom = Math.pow(c / (A || 1e-6), n) + Math.pow(s / (B || 1e-6), n);
  return denom > 0 ? Math.pow(1 / denom, 1 / n) : 0;
}
function outerRadiusAt(t, p) {
  const A = p.baseA + (p.topA - p.baseA) * t;
  const B = p.baseB + (p.topB - p.baseB) * t;
  const H = p.height;
  const y = t * H;
  const yc = p.bellyHeight * H;
  const sigma = 0.15 * H;
  const belly = p.belly * Math.exp(-((y - yc) ** 2) / (2 * sigma ** 2));
  return Math.max(A + belly, B + belly);
}
function applyHeadroomAndBounds(p) {
  const head = Math.max(0, p.texture_headroom ?? 0);
  const maxAxis = MAX_SIZE / 2 - head;
  const minA = p.wall + 2;
  p.baseA = clamp(p.baseA, minA, maxAxis);
  p.baseB = clamp(p.baseB, minA, maxAxis);
  p.topA  = clamp(p.topA,  minA, maxAxis);
  p.topB  = clamp(p.topB,  minA, maxAxis);
}
function estimateMinScale(p) {
  const H = p.height, samplesT = 12, samplesA = 64;
  let minS = 1;
  for (let i = 0; i <= samplesT; i++) {
    const t = i / samplesT;
    const A = p.baseA + (p.topA - p.baseA) * t + p._bellyAt(t);
    const B = p.baseB + (p.topB - p.baseB) * t + p._bellyAt(t);
    const rMax = Math.max(1e-6, Math.max(A, B));
    for (let j = 0; j < samplesA; j++) {
      const theta = (j / samplesA) * Math.PI * 2;
      const R = R_superellipse(theta, A, B, p.n);
      const s = R / rMax;
      if (s < minS) minS = s;
    }
  }
  return Math.max(0.2, Math.min(1, minS));
}
function autoDetail(p, caps) {
  const radial = clamp(Math.round(Math.max(96, 24 * (18 + 2))), 48, caps.radial);
  const vertical = clamp(Math.ceil(p.height / 0.6), 140, caps.vertical);
  return { radial, vertical };
}

function constrainParams(pIn = {}, caps = PREVIEW_CAPS) {
  const out = { ...pIn };
  out.height = clamp(pIn.height ?? 220, 80, MAX_SIZE);
  out.wall   = clamp(pIn.wall ?? 1.2, MIN_THICK, MAX_THICK);

  // base axes cannot go below 90 mm radius, and must clear wall
  const baseMin = Math.max(45, out.wall + 2);
  out.baseA = clamp(pIn.baseA ?? 105, baseMin, MAX_SIZE / 2);
  out.baseB = clamp(pIn.baseB ?? 95,  baseMin, MAX_SIZE / 2);

  // top axes can be slimmer, just clear wall
  const topMin = out.wall + 2;
  out.topA  = clamp(pIn.topA  ?? 105, topMin, MAX_SIZE / 2);
  out.topB  = clamp(pIn.topB  ?? 95,  topMin, MAX_SIZE / 2);

  out.n = clamp(pIn.n ?? 4, 2, 8);

  out.belly       = clamp(pIn.belly ?? 16, 0, 40);
  out.bellyHeight = clamp(pIn.bellyHeight ?? 0.5, 0.2, 0.8);
  out._bellyAt = (t) => {
    const H = out.height, y = t * H, yc = out.bellyHeight * H, sigma = 0.15 * H;
    return out.belly * Math.exp(-((y - yc) ** 2) / (2 * sigma ** 2));
  };

  out.texture = pIn.texture ?? (textureOptions[0]?.value ?? "none");
  const tex = textures[out.texture];
  out.texture_headroom = tex?.headroom ? tex.headroom(out) : 0;

  applyHeadroomAndBounds(out);

  const minS = estimateMinScale(out);
  out._minScale = minS;
  out._wallForLathe = clamp(out.wall / Math.max(1e-6, minS), MIN_THICK, 3.0);

  // bottom hole diameter, safe clamp against inner radius at slab height
  const rInnerSlab = Math.max(outerRadiusAt(BOTTOM_THICK / out.height, out) - out._wallForLathe, 0.5);
  const wantedDia = clamp(pIn.holeDiameter ?? 80, 20, 200);
  const maxDia = Math.max(10, 2 * (rInnerSlab - 0.5));
  out.holeDiameter = clamp(wantedDia, 20, maxDia);
  out._holeRadius = out.holeDiameter * 0.5;

  const det = autoDetail(out, caps);
  out.radialSegments = det.radial;
  out.resolution = det.vertical;

  out.autoSpin = pIn.autoSpin ?? true;
  out.bottom_thickness = BOTTOM_THICK;
  return out;
}

// buildSuperellipseShade, schemaFor, defaultsFactory, exportSTL remain the same,
// except for slider mins on baseA and baseB in schemaFor:

function buildSuperellipseShade(params, caps = PREVIEW_CAPS) {
  // ...use your current implementation from the previous file...
  // (no changes needed here)
  const p = constrainParams(params, caps);

  const H = p.height, N = p.resolution, rHole = Math.max(1, p._holeRadius || 0);
  const pts = [];
  pts.push(new THREE.Vector2(rHole, 0));
  pts.push(new THREE.Vector2(outerRadiusAt(0, p), 0));
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    pts.push(new THREE.Vector2(outerRadiusAt(t, p), t * H));
  }
  const rTopInner = Math.max(outerRadiusAt(1, p) - p._wallForLathe, 0.5);
  pts.push(new THREE.Vector2(rTopInner, H));
  for (let i = N - 1; i >= 0; i--) {
    const t = i / N;
    const y = t * H;
    if (y < BOTTOM_THICK) break;
    const rIn = Math.max(outerRadiusAt(t, p) - p._wallForLathe, 0.5);
    pts.push(new THREE.Vector2(rIn, y));
  }
  const rInSlab = Math.max(outerRadiusAt(BOTTOM_THICK / H, p) - p._wallForLathe, 0.5);
  pts.push(new THREE.Vector2(Math.min(rInSlab, rHole), BOTTOM_THICK));
  pts.push(new THREE.Vector2(rHole, BOTTOM_THICK));
  pts.push(new THREE.Vector2(rHole, 0));

  const geom = new THREE.LatheGeometry(pts, p.radialSegments);
  geom.computeVertexNormals();

  // map to superellipse, keep the circular hole round inside the slab height
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    if (v.y <= BOTTOM_THICK + 1e-6 && r <= rHole + 0.25) continue;

    const t = THREE.MathUtils.clamp(H > 0 ? v.y / H : 0, 0, 1);
    const A = p.baseA + (p.topA - p.baseA) * t + p._bellyAt(t);
    const B = p.baseB + (p.topB - p.baseB) * t + p._bellyAt(t);
    const rMax = Math.max(A, B);
    if (r < 1e-6) continue;

    let theta = Math.atan2(v.z, v.x);
    if (theta < 0) theta += Math.PI * 2;

    const Rse = Math.max(0.5, R_superellipse(theta, A, B, p.n));
    const scale = Rse / rMax;
    v.x *= scale;
    v.z *= scale;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();

  const entry = textures[p.texture];
  return entry?.apply ? entry.apply(geom, p) : geom;
}

function schemaFor(params) {
  const base = [
    { key: "height",        label: "Height",            type: "range", min: 80,  max: MAX_SIZE, step: 1 },
    { key: "wall",          label: "Wall thickness",    type: "range", min: MIN_THICK, max: MAX_THICK, step: 0.1 },

    { key: "baseA",         label: "Base axis X radius",type: "range", min: 50, max: MAX_SIZE / 2, step: 0.5 },
    { key: "baseB",         label: "Base axis Z radius",type: "range", min: 50, max: MAX_SIZE / 2, step: 0.5 },
    { key: "topA",          label: "Top axis X radius", type: "range", min: 10, max: MAX_SIZE / 2, step: 0.5 },
    { key: "topB",          label: "Top axis Z radius", type: "range", min: 10, max: MAX_SIZE / 2, step: 0.5 },

    { key: "n",             label: "Squareness",        type: "range", min: 2,  max: 8, step: 0.1 },

    { key: "belly",         label: "Belly amount",      type: "range", min: 0,  max: 40, step: 0.5 },
    { key: "bellyHeight",   label: "Belly height",      type: "range", min: 0.2,max: 0.8, step: 0.01 },


    { key: "texture",       label: "Texture",           type: "select", options: textureOptions },
  ];

  const texId = params?.texture ?? (textureOptions[0]?.value ?? "none");
  const texDesc = textures[texId];
  const tex = texDesc?.schema ?? [];

  return [
    ...base,
    ...tex,
    { key: "autoSpin", label: "Auto spin", type: "checkbox" },
  ];
}

// defaultsFactory and exportSTL stay the same as your last version
export const models = {
  super: {
    label: "Superellipse Shade",
    schema: (params) => schemaFor(params),
    defaults: () => {
      const firstTex = textureOptions[0]?.value ?? "none";
      const d = {
        height: 220,
        wall: 0.8,
        baseA: 70,
        baseB: 90,
        topA:  60,
        topB:  95,
        n: 4,
        belly: 16,
        bellyHeight: 0.5,
        holeDiameter: 80,
        texture: firstTex,
        autoSpin: true,
      };
      const tex = textures[firstTex];
      return tex?.defaults ? { ...d, ...tex.defaults } : d;
    },
    build: (p) => buildSuperellipseShade(p, PREVIEW_CAPS),
  },
};

function exportSTL(params) {
  import("three-stdlib").then(({ STLExporter }) => {
    const geom = buildSuperellipseShade(params, EXPORT_CAPS);
    const exporter = new STLExporter();
    const data = exporter.parse(geom, { binary: true });
    const blob = new Blob([data], { type: "application/sla" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lampshade_superellipse.stl";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

const label = "Lampshade, Superellipse";
export default { label, models, export: exportSTL };
