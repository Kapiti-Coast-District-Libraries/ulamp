// src/packs/wavySlatsPack.js
// Pleated umbrella shade. Fixed 80 mm hole, 3 mm bottom slab.
// World units mm. Origin at 0,0,0. Base sits on y = 0.

import * as THREE from "three";
import { textures, textureOptions } from "../textures";

const MAX_SIZE = 240;
const MIN_THICK = 0.8;
const MAX_THICK = 1.1; 
const BOTTOM_THICK = 3;
const FIXED_HOLE_DIAMETER = 80;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

const PREVIEW_CAPS = { maxRadial: 720, maxRes: 900, stepMM: 0.6 };
const EXPORT_CAPS  = { maxRadial: 1400, maxRes: 1600, stepMM: 0.35 };

/* ---------- Detail heuristics ---------- */

function recommendedRadialSegments(p, caps) {
  const pleats = clamp(Math.floor(p.pleatCount ?? 24), 6, 96);
  const sharp = clamp(p.pleatSharpness ?? 3, 1, 8);
  // Twist adds complexity, so we ensure enough segments
  const twist = Math.abs(p.twistTurns ?? 0);
  const twistFactor = 1 + twist * 0.5; 
  
  const want = Math.max(180, pleats * (8 + sharp * 2) * twistFactor);
  return clamp(Math.round(want), 96, caps.maxRadial);
}

function recommendedResolution(p, caps) {
  const base = Math.ceil((p.height ?? 220) / caps.stepMM);
  // Twist requires higher vertical resolution to look smooth
  const twist = Math.abs(p.twistTurns ?? 0);
  const twistMult = 1 + twist * 0.5;
  return clamp(Math.round(base * twistMult), 180, caps.maxRes);
}

/* ---------- Base circular profile with fixed 80 mm hole ---------- */

function rOuterAt(t, p) {
  const r = p.baseRadius + (p.topRadius - p.baseRadius) * t;
  const maxR = MAX_SIZE / 2;
  const head = p.texture_headroom ?? 0;
  return Math.min(r, Math.max(0.5, maxR - head));
}

function rInnerAt(t, p) {
  return Math.max(rOuterAt(t, p) - p._wallForLathe, 0.5);
}

function makeProfileWithHole(p) {
  const pts = [];
  const H = p.height;
  const N = p.resolution;
  const rHole = FIXED_HOLE_DIAMETER * 0.5;

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

/* ---------- Pleat mapping ---------- */

// triangle wave in [0,1], peaks at 1 on pleat centers
function tri01(u) {
  const f = u - Math.floor(u);
  return 1 - Math.abs(2 * f - 1);
}

// radial inward offset in mm at angle and height
function pleatOffsetAt(theta, t, p) {
  const k = clamp(p.pleatSharpness ?? 3, 1, 8);
  const pleats = clamp(Math.floor(p.pleatCount ?? 24), 6, 96);
  
  // --- NEW FEATURE: Spiral Twist ---
  const twistAngle = t * (p.twistTurns ?? 0) * Math.PI * 2;
  
  const phase = (clamp(p.pleatPhaseDeg ?? 0, 0, 360) * Math.PI) / 180;
  
  const baseAmp = clamp(p.pleatDepthMM ?? 3, 0, 8);
  const topScale = clamp(p.pleatDepthTopScale ?? 0.4, 0, 1);
  const amp = baseAmp * (1 - t + t * topScale); // fades toward top
  
  // Add twistAngle to theta
  const tri = tri01((theta + phase + twistAngle) * pleats / (2 * Math.PI));
  const shaped = Math.pow(tri, k);
  
  return amp * shaped;
}

// scale factor s in 0..1 applied to x,z given outer radius r and inward offset d
function pleatScaleFromOffset(r, d) {
  const s = 1 - d / Math.max(r, 1e-6);
  return clamp(s, 0.2, 1);
}

// estimate minimal scale across angle and height
function estimateMinScale(p) {
  let minS = 1;
  const stepsT = 20;
  const stepsA = Math.max(72, (p.pleatCount ?? 24) * 6);
  for (let i = 0; i <= stepsT; i++) {
    const t = i / stepsT;
    const r = rOuterAt(t, p);
    for (let j = 0; j < stepsA; j++) {
      const a = (j / stepsA) * Math.PI * 2;
      const d = pleatOffsetAt(a, t, p);
      const s = pleatScaleFromOffset(r, d);
      if (s < minS) minS = s;
    }
  }
  return Math.max(0.2, Math.min(1, minS));
}

/* ---------- Overhang guard ---------- */

const MAX_OVERHANG_SLOPE = 1.0; // mm radial growth per 1 mm Z, equals 45 degrees

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

  // pleat controls
  out.pleatCount        = clamp(Math.floor(pIn.pleatCount ?? 24), 6, 96);
  out.pleatDepthMM      = clamp(pIn.pleatDepthMM ?? 3.0, 0, 8);
  out.pleatDepthTopScale= clamp(pIn.pleatDepthTopScale ?? 0.4, 0, 1);
  out.pleatSharpness    = clamp(pIn.pleatSharpness ?? 3, 1, 8);
  out.pleatPhaseDeg     = clamp(pIn.pleatPhaseDeg ?? 0, 0, 360);
  
  // Twist
  out.twistTurns        = clamp(pIn.twistTurns ?? 0, -1, 1);

  // texture selection and headroom
  out.texture = pIn.texture ?? (textureOptions[0]?.value ?? "none");
  const tex = textures[out.texture];
  out.texture_headroom = tex?.headroom ? tex.headroom(out) : 0;

  // guard 45 degree for the base cone alone, pleats are inward offsets
  clampTopFor45(out);

  // determine worst case shrink, inflate wall for lathe so mapped wall >= requested
  const minS = estimateMinScale(out);
  out._minScale = minS;
  out._wallForLathe = clamp(out.wall / Math.max(1e-6, minS), MIN_THICK, 3.0);

  // auto detail
  out.radialSegments = recommendedRadialSegments(out, caps);
  out.resolution     = recommendedResolution(out, caps);

  out.autoSpin = pIn.autoSpin ?? true;
  out.bottom_thickness = BOTTOM_THICK;
  out._holeRadius = FIXED_HOLE_DIAMETER * 0.5;

  return out;
}

function buildPleatedUmbrella(params, caps = PREVIEW_CAPS) {
  const p = constrainParams(params, caps);

  const profile = makeProfileWithHole(p);
  const geom = new THREE.LatheGeometry(profile, p.radialSegments);
  geom.computeVertexNormals();

  const pos = geom.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);

    // keep the bottom slab hole perfectly round
    if (v.y <= BOTTOM_THICK + 1e-6) {
      const r = Math.hypot(v.x, v.z);
      if (r <= p._holeRadius + 0.25) continue;
    }

    const H = p.height;
    const t = THREE.MathUtils.clamp(H > 0 ? v.y / H : 0, 0, 1);

    let theta = Math.atan2(v.z, v.x);
    if (theta < 0) theta += Math.PI * 2;

    const rOut = Math.hypot(v.x, v.z);
    const d = pleatOffsetAt(theta, t, p);
    const s = pleatScaleFromOffset(rOut, d);

    v.x *= s;
    v.z *= s;

    pos.setXYZ(i, v.x, v.y, v.z);
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();

  // apply outward texture last, optional
  const entry = textures[p.texture];
  return entry?.apply ? entry.apply(geom, p) : geom;
}

/* ---------- Dynamic schema ---------- */

function schemaFor(params) {
  const base = [
    // --- SHAPE GROUP ---
    { key: "height",        label: "Height",           type: "range", min: 100, max: MAX_SIZE, step: 1, group: "Shape" },
    { key: "baseRadius",    label: "Bottom Size",      type: "range", min: 45, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    { key: "topRadius",     label: "Top Size",         type: "range", min: 10, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    { key: "pleatCount",    label: "Pleat Count",      type: "range", min: 6,  max: 96, step: 1, group: "Shape" },
    { key: "twistTurns",    label: "Spiral Twist",     type: "range", min: -1, max: 1, step: 0.01, group: "Shape" }, // New!
    { key: "pleatDepthMM",  label: "Pleat Depth",      type: "range", min: 0,  max: 4,  step: 0.1, group: "Shape" },

    // --- ADVANCED SHAPE ---
    { key: "pleatDepthTopScale",label: "Top Depth Scale",  type: "range", min: 0,  max: 1,  step: 0.01, group: "Shape", advanced: true },
    { key: "pleatSharpness",    label: "Pleat Sharpness",  type: "range", min: 1,  max: 8,  step: 0.1, group: "Shape", advanced: true },
    { key: "wall",              label: "Wall Thickness",   type: "range", min: MIN_THICK, max: MAX_THICK, step: 0.1, group: "Shape", advanced: true },
    { key: "pleatPhaseDeg",     label: "Start Angle",      type: "range", min: 0,  max: 360, step: 1, group: "Shape", advanced: true },
    { key: "autoSpin",          label: "Auto Spin",        type: "checkbox", group: "Shape", advanced: true },
  ];

  const texId = params?.texture ?? (textureOptions[0]?.value ?? "none");
  const texDesc = textures[texId];
  const rawTex = texDesc?.schema ?? [];

  // Map texture fields to "Texture" group
  const texFields = rawTex.map(f => ({ ...f, group: "Texture" }));
  
  // Texture Selector
  const texSelector = { key: "texture", label: "Style", type: "select", options: textureOptions, group: "Texture" };

  return [
    ...base,
    texSelector,
    ...texFields,
  ];
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
    twistTurns: 0, // New default

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
  import("three-stdlib").then(({ STLExporter }) => {
    const geom = buildPleatedUmbrella(params, EXPORT_CAPS);
    const exporter = new STLExporter();
    const data = exporter.parse(geom, { binary: true });
    const blob = new Blob([data], { type: "application/sla" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lampshade_pleated_umbrella.stl";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

const label = "Lampshade, Pleated Umbrella";
export default { label, models, export: exportSTL };
