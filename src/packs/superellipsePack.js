// src/packs/superellipsePack.js
// "Soft Geometric" - Superellipse based shapes with Twist and Bulge.

import * as THREE from "three";
import { textures, textureOptions } from "../textures";

const MAX_SIZE = 240;
const MIN_THICK = 0.8;
const MAX_THICK = 1.2;
const BOTTOM_THICK = 3;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
const PREVIEW_CAPS = { radial: 540, vertical: 700 };
const EXPORT_CAPS  = { radial: 1200, vertical: 1400 };

/* --- Math --- */

// Superellipse polar radius function
// |cos(t)/A|^n + |sin(t)/B|^n = 1^(-1/n)
function R_superellipse(theta, A, B, n) {
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  const denom = Math.pow(c / (A || 1e-6), n) + Math.pow(s / (B || 1e-6), n);
  return denom > 0 ? Math.pow(1 / denom, 1 / n) : 0;
}

function outerRadiusAt(t, p) {
  const A = p.baseA + (p.topA - p.baseA) * t;
  const B = p.baseB + (p.topB - p.baseB) * t;
  
  // Add belly bulge
  const H = p.height;
  const y = t * H;
  const yc = p.bellyHeight * H;
  const sigma = 0.15 * H; // Fixed spread for the bulge
  const belly = p.belly * Math.exp(-((y - yc) ** 2) / (2 * sigma ** 2));
  
  // Return max radius of the bounding box for this height (approximation for safety checks)
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

// Iterate samples to find minimal scaling factor required to fit wall thickness
function estimateMinScale(p) {
  const H = p.height;
  const samplesT = 12;
  const samplesA = 64;
  let minS = 1;

  for (let i = 0; i <= samplesT; i++) {
    const t = i / samplesT;
    const bulge = p._bellyAt(t);
    const A = p.baseA + (p.topA - p.baseA) * t + bulge;
    const B = p.baseB + (p.topB - p.baseB) * t + bulge;
    
    const twist = (p.twistDeg || 0) * Math.PI / 180 * t;
    
    // approximate max radius at this height to normalize scale
    const rMax = Math.max(1e-6, Math.max(A, B)); 

    for (let j = 0; j < samplesA; j++) {
      const theta = (j / samplesA) * Math.PI * 2;
      
      // Calculate radius with twist
      // The shape rotates, so we sample the function at (theta - twist)
      const R = R_superellipse(theta - twist, A, B, p.n);
      
      const s = R / rMax;
      if (s < minS) minS = s;
    }
  }
  return Math.max(0.2, Math.min(1, minS));
}

function autoDetail(p, caps) {
  // Higher detail for sharper corners (higher n)
  const cornerMult = p.n > 4 ? 1.5 : 1;
  const radial = clamp(Math.round(Math.max(96, 24 * (18 + 2) * cornerMult)), 64, caps.radial);
  const vertical = clamp(Math.ceil(p.height / 0.6), 140, caps.vertical);
  return { radial, vertical };
}

/* --- Build --- */

function constrainParams(pIn = {}, caps = PREVIEW_CAPS) {
  const out = { ...pIn };
  out.height = clamp(pIn.height ?? 220, 80, MAX_SIZE);
  out.wall   = clamp(pIn.wall ?? 1.2, MIN_THICK, MAX_THICK);

  // Base dims
  const baseMin = Math.max(30, out.wall + 2);
  out.baseA = clamp(pIn.baseA ?? 70, baseMin, MAX_SIZE / 2);
  out.baseB = clamp(pIn.baseB ?? 90, baseMin, MAX_SIZE / 2);

  // Top dims
  const topMin = out.wall + 2;
  out.topA  = clamp(pIn.topA  ?? 60, topMin, MAX_SIZE / 2);
  out.topB  = clamp(pIn.topB  ?? 95, topMin, MAX_SIZE / 2);

  // Shape
  out.n = clamp(pIn.n ?? 4, 2, 12); // 2=Circle, 4=Squircle, 12=Rect
  out.twistDeg = clamp(pIn.twistDeg ?? 0, -180, 180);

  // Bulge
  out.belly       = clamp(pIn.belly ?? 16, 0, 40);
  out.bellyHeight = clamp(pIn.bellyHeight ?? 0.5, 0.2, 0.8);
  
  // Helper for bulge calc
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

  // Hole (Fixed 80mm standard)
  const rInnerSlab = Math.max(outerRadiusAt(BOTTOM_THICK / out.height, out) - out._wallForLathe, 0.5);
  const wantedDia = 80;
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

function buildSuperellipseShade(params, caps = PREVIEW_CAPS) {
  const p = constrainParams(params, caps);

  const H = p.height, N = p.resolution, rHole = Math.max(1, p._holeRadius || 0);
  
  // 1. Create base Lathe profile (circular approximation for subdivision)
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

  // 2. Morph vertices into Superellipse shape + Twist
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();
  
  const twistRad = (p.twistDeg || 0) * Math.PI / 180;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    
    // Skip the hole ring
    if (v.y <= BOTTOM_THICK + 1e-6 && r <= rHole + 0.25) continue;

    const t = THREE.MathUtils.clamp(H > 0 ? v.y / H : 0, 0, 1);
    
    const bulge = p._bellyAt(t);
    const A = p.baseA + (p.topA - p.baseA) * t + bulge;
    const B = p.baseB + (p.topB - p.baseB) * t + bulge;
    const rMax = Math.max(A, B);

    if (r < 1e-6) continue;

    let theta = Math.atan2(v.z, v.x);
    if (theta < 0) theta += Math.PI * 2;
    
    // Apply Twist: Effectively rotate the coordinate system at height t
    // We evaluate the superellipse function at a shifted angle
    const twistAngle = twistRad * t;
    const effectiveTheta = theta - twistAngle;

    const Rse = Math.max(0.5, R_superellipse(effectiveTheta, A, B, p.n));
    
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

/* --- Schema --- */

function schemaFor(params) {
  const base = [
    // --- SHAPE GROUP ---
    { key: "height",        label: "Height",            type: "range", min: 80,  max: MAX_SIZE, step: 1, group: "Shape" },
    
    { key: "baseA",         label: "Base Width",        type: "range", min: 50, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    { key: "baseB",         label: "Base Depth",        type: "range", min: 50, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    
    { key: "topA",          label: "Top Width",         type: "range", min: 10, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    { key: "topB",          label: "Top Depth",         type: "range", min: 10, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    
    { key: "n",             label: "Corner Sharpness",  type: "range", min: 2,  max: 8, step: 0.1, group: "Shape" },

    // Advanced Shape
    { key: "twistDeg",      label: "Twist (Degrees)",   type: "range", min: -180, max: 180, step: 1, group: "Shape", advanced: true },
    { key: "belly",         label: "Bulge Size",        type: "range", min: 0,  max: 40, step: 0.5, group: "Shape", advanced: true },
    { key: "bellyHeight",   label: "Bulge Position",    type: "range", min: 0.2,max: 0.8, step: 0.01, group: "Shape", advanced: true },
    { key: "wall",          label: "Wall Thickness",    type: "range", min: MIN_THICK, max: MAX_THICK, step: 0.1, group: "Shape", advanced: true },
    { key: "autoSpin",      label: "Auto Spin",         type: "checkbox", group: "Shape", advanced: true },
  ];

  const texId = params?.texture ?? (textureOptions[0]?.value ?? "none");
  const texDesc = textures[texId];
  const rawTex = texDesc?.schema ?? [];
  
  // Map texture fields to Texture group
  const texFields = rawTex.map(f => ({ ...f, group: "Texture" }));
  const texSelector = { key: "texture", label: "Style", type: "select", options: textureOptions, group: "Texture" };

  return [
    ...base,
    texSelector,
    ...texFields
  ];
}

export const models = {
  super: {
    label: "Soft Geometric",
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
        n: 4, // Soft Square
        twistDeg: 0,
        belly: 16,
        bellyHeight: 0.5,
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
    a.download = "lampshade_geometric.stl";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

const label = "Lampshade, Soft Geometric";
export default { label, models, export: exportSTL };
