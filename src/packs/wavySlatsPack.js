// src/packs/wavySlatsPack.js
// Pleated umbrella shade. Fixed 80 mm hole, 3 mm bottom slab.
// World units mm. Origin at 0,0,0. Base sits on y = 0.

import * as THREE from "three";
import { textures, textureOptions } from "../textures";
import { buildWatertightCylinder } from "../designer/GeometryBuilder.js"; 

const MAX_SIZE = 240;
const MIN_THICK = 0.8;
const MAX_THICK = 1.1; 
const BOTTOM_THICK = 3;
const FIXED_HOLE_DIAMETER = 80;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

const PREVIEW_CAPS = { maxRadial: 720, maxRes: 900, stepMM: 0.6 };
// EXTREME Quality Export Settings (Cinema/Production Grade)
// This removes the "triangulated" look completely.
const EXPORT_CAPS  = { maxRadial: 2048, maxRes: 2000, stepMM: 0.2 };

/* ---------- Detail heuristics ---------- */

function recommendedRadialSegments(p, caps) {
  const pleats = clamp(Math.floor(p.pleatCount ?? 24), 6, 96);
  // We force high detail to support the smooth curves
  const want = Math.max(360, pleats * 32); 
  return clamp(Math.round(want), 180, caps.maxRadial);
}

function recommendedResolution(p, caps) {
  const base = Math.ceil((p.height ?? 220) / caps.stepMM);
  const twist = Math.abs(p.twistTurns ?? 0);
  const twistMult = 1 + twist * 0.5;
  return clamp(Math.round(base * twistMult), 200, caps.maxRes);
}

/* ---------- Base circular profile ---------- */

function rOuterAt(t, p) {
  const r = p.baseRadius + (p.topRadius - p.baseRadius) * t;
  const maxR = MAX_SIZE / 2;
  const head = p.texture_headroom ?? 0;
  return Math.min(r, Math.max(0.5, maxR - head));
}

/* ---------- Wave mapping ---------- */

// NEW: Sine Wave (Liquid Smooth) instead of Triangle Wave (Sharp Crease)
function sine01(u) {
  // cos goes 1..-1..1. We map to 0..1..0
  return 0.5 - 0.5 * Math.cos(u * Math.PI * 2);
}

function pleatOffsetAt(theta, t, p) {
  const k = clamp(p.pleatSharpness ?? 3, 1, 8);
  const pleats = clamp(Math.floor(p.pleatCount ?? 24), 6, 96);
  
  const twistAngle = t * (p.twistTurns ?? 0) * Math.PI * 2;
  const phase = (clamp(p.pleatPhaseDeg ?? 0, 0, 360) * Math.PI) / 180;
  
  const baseAmp = clamp(p.pleatDepthMM ?? 3, 0, 8);
  const topScale = clamp(p.pleatDepthTopScale ?? 0.4, 0, 1);
  const amp = baseAmp * (1 - t + t * topScale); 
  
  // Calculate wave position
  const angle = theta + phase + twistAngle;
  // Use sine wave for organic smoothness
  const wave = sine01(angle * pleats / (2 * Math.PI));
  
  // Sharpness controls how "pinched" the wave is, but it remains smooth
  const shaped = Math.pow(wave, 0.5 + (k * 0.3)); 
  
  return amp * shaped;
}

function pleatScaleFromOffset(r, d) {
  const s = 1 - d / Math.max(r, 1e-6);
  return clamp(s, 0.2, 1);
}

function estimateMinScale(p) {
  // Conservative estimate for wall thickness compensation
  return 0.8; 
}

/* ---------- Overhang guard ---------- */
const MAX_OVERHANG_SLOPE = 1.0; 

function clampTopFor45(p) {
  if (p.topRadius <= p.baseRadius) return;
  const maxAllowedTop = p.baseRadius + p.height * MAX_OVERHANG_SLOPE;
  if (p.topRadius > maxAllowedTop) p.topRadius = maxAllowedTop;
}

/* ---------- Constraints and build ---------- */

function constrainParams(pIn = {}, caps = PREVIEW_CAPS) {
  const out = { ...pIn };

  out.height = clamp(pIn.height ?? 220, 100, MAX_SIZE);
  out.wall   = clamp(pIn.wall ?? 1.2, MIN_THICK, MAX_THICK);

  const baseMin = Math.max(45, out.wall + 2, FIXED_HOLE_DIAMETER * 0.5 + 5);
  out.baseRadius = clamp(pIn.baseRadius ?? 112, baseMin, MAX_SIZE / 2);
  out.topRadius  = clamp(pIn.topRadius  ?? 80,  out.wall + 2, MAX_SIZE / 2);

  out.pleatCount        = clamp(Math.floor(pIn.pleatCount ?? 24), 6, 96);
  out.pleatDepthMM      = clamp(pIn.pleatDepthMM ?? 3.0, 0, 8);
  out.pleatDepthTopScale= clamp(pIn.pleatDepthTopScale ?? 0.4, 0, 1);
  out.pleatSharpness    = clamp(pIn.pleatSharpness ?? 3, 1, 8);
  out.pleatPhaseDeg     = clamp(pIn.pleatPhaseDeg ?? 0, 0, 360);
  out.twistTurns        = clamp(pIn.twistTurns ?? 0, -1, 1);

  out.texture = pIn.texture ?? (textureOptions[0]?.value ?? "none");
  const tex = textures[out.texture];
  out.texture_headroom = tex?.headroom ? tex.headroom(out) : 0;

  clampTopFor45(out);

  const minS = estimateMinScale(out);
  out._minScale = minS;
  out._wallForLathe = clamp(out.wall / Math.max(1e-6, minS), MIN_THICK, 3.0);

  out.radialSegments = recommendedRadialSegments(out, caps);
  out.resolution     = recommendedResolution(out, caps);

  out.autoSpin = pIn.autoSpin ?? true;
  out.bottom_thickness = BOTTOM_THICK;
  out._holeRadius = FIXED_HOLE_DIAMETER * 0.5;

  return out;
}

function buildPleatedUmbrella(params, caps = PREVIEW_CAPS) {
  const p = constrainParams(params, caps);

  // 1. Base Shape
  const shapeFn = (t) => rOuterAt(t, p);

  // 2. Watertight Grid
  const geom = buildWatertightCylinder({
    height: p.height,
    radialSegments: p.radialSegments,
    resolution: p.resolution,
    radiusFunction: shapeFn,
    bottomThickness: p.bottom_thickness,
    holeRadius: p._holeRadius
  });

  // 3. Apply Smooth Waves
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();

  // Defines the "Fade In" zone so pleats grow gently from the base
  const fadeStart = p.bottom_thickness + 1.0; // Start 1mm above base
  const fadeEnd = p.bottom_thickness + 20.0;  // Fully pleated by 20mm up

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);

    // Skip the solid bottom slab
    if (v.y <= p.bottom_thickness + 0.01) continue;

    // Normalize height
    const t = THREE.MathUtils.clamp(v.y / p.height, 0, 1);
    
    // Compute Angle
    let theta = Math.atan2(v.z, v.x);
    if (theta < 0) theta += Math.PI * 2;

    // Compute Wave
    const rOut = Math.hypot(v.x, v.z);
    const d = pleatOffsetAt(theta, t, p);
    const s = pleatScaleFromOffset(rOut, d);

    // Compute Fade Mask (This removes the bottom "Cliff" seam)
    // 0.0 at bottom, 1.0 at fadeEnd
    const mask = smoothstep(fadeStart, fadeEnd, v.y);
    
    // Blend: Original Radius -> Pleated Radius
    // If mask is 0, we keep original (scale 1). If mask is 1, we use s.
    const finalScale = 1.0 + (s - 1.0) * mask;

    v.x *= finalScale;
    v.z *= finalScale;

    pos.setXYZ(i, v.x, v.y, v.z);
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();

  const entry = textures[p.texture];
  return entry?.apply ? entry.apply(geom, p) : geom;
}

/* ---------- Dynamic schema ---------- */

function schemaFor(params) {
  const base = [
    { key: "height",        label: "Height",           type: "range", min: 100, max: MAX_SIZE, step: 1, group: "Shape" },
    { key: "baseRadius",    label: "Bottom Size",      type: "range", min: 45, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    { key: "topRadius",     label: "Top Size",         type: "range", min: 10, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    { key: "pleatCount",    label: "Wave Count",       type: "range", min: 6,  max: 96, step: 1, group: "Shape" },
    { key: "twistTurns",    label: "Spiral Twist",     type: "range", min: -1, max: 1, step: 0.01, group: "Shape" },
    { key: "pleatDepthMM",  label: "Wave Depth",       type: "range", min: 0,  max: 4,  step: 0.1, group: "Shape" },

    { key: "pleatDepthTopScale",label: "Top Depth Scale",  type: "range", min: 0,  max: 1,  step: 0.01, group: "Shape", advanced: true },
    { key: "pleatSharpness",    label: "Wave Sharpness",   type: "range", min: 1,  max: 8,  step: 0.1, group: "Shape", advanced: true },
    { key: "wall",              label: "Wall Thickness",   type: "range", min: MIN_THICK, max: MAX_THICK, step: 0.1, group: "Shape", advanced: true },
    { key: "pleatPhaseDeg",     label: "Start Angle",      type: "range", min: 0,  max: 360, step: 1, group: "Shape", advanced: true },
    { key: "autoSpin",          label: "Auto Spin",        type: "checkbox", group: "Shape", advanced: true },
  ];

  const texId = params?.texture ?? (textureOptions[0]?.value ?? "none");
  const texDesc = textures[texId];
  const rawTex = texDesc?.schema ?? [];
  const texFields = rawTex.map(f => ({ ...f, group: "Texture" }));
  const texSelector = { key: "texture", label: "Style", type: "select", options: textureOptions, group: "Texture" };

  return [ ...base, texSelector, ...texFields ];
}

function defaultsFactory() {
  const firstTex = textureOptions[0]?.value ?? "none";
  const d = {
    height: 220,
    wall: 0.8,
    baseRadius: 112,
    topRadius: 80,
    pleatCount: 24,
    pleatDepthMM: 3.0,
    pleatDepthTopScale: 0.4,
    pleatSharpness: 3,
    pleatPhaseDeg: 0,
    twistTurns: 0,
    texture: firstTex,
    autoSpin: true,
  };
  const tex = textures[firstTex];
  return tex?.defaults ? { ...d, ...tex.defaults } : d;
}

/* ---------- Registry and STL export ---------- */

export const models = {
  pleatedUmbrella: {
    label: "Pleated Umbrella",
    schema: (params) => schemaFor(params),
    defaults: () => defaultsFactory(),
    build: (p) => buildPleatedUmbrella(p, PREVIEW_CAPS),
  },
};

function exportSTL(params) {
  import("three-stdlib").then(({ STLExporter, mergeVertices }) => {
    // 1. Build Cinema-Quality Geometry (2048 segments)
    const geom = buildPleatedUmbrella(params, EXPORT_CAPS);
    
    // 2. Weld seams for watertight 3D printing
    const watertightGeom = mergeVertices(geom, 1e-4);
    watertightGeom.computeVertexNormals();

    const exporter = new STLExporter();
    const data = exporter.parse(watertightGeom, { binary: true });
    const blob = new Blob([data], { type: "application/sla" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lampshade_smooth_wave.stl";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

const label = "Lampshade, Pleated Umbrella";
export default { label, models, export: exportSTL };
