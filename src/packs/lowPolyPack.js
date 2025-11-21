// src/packs/lowPolyPack.js
// Low poly random polygon tube. Fixed 80 mm hole. Print safe.
// World units mm. Origin at 0,0,0. Base sits on y = 0.

import * as THREE from "three";
import { textures, textureOptions } from "../textures";

const MAX_SIZE = 240;
const MIN_THICK = 0.8;
const MAX_THICK = 1.2;
const BOTTOM_THICK = 3;
const FIXED_HOLE_DIAMETER = 80;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
const PREVIEW_CAPS = { maxRadial: 540, maxRes: 700, stepMM: 0.6 };
const EXPORT_CAPS  = { maxRadial: 1200, maxRes: 1400, stepMM: 0.4 };

// Detail heuristics
function recommendedRadialSegments(p, caps) {
  const sides = clamp(Math.floor(p.lp_sides ?? 5), 3, 7);
  const twist = Math.abs(p.lp_twistTurns ?? 0);
  const per = 24 + Math.round(twist * 12);
  const want = Math.max(120, sides * per);
  return clamp(Math.round(want), 64, caps.maxRadial);
}
function recommendedResolution(p, caps) {
  // If stacking is active, we need sharp transitions, so keep resolution high
  const base = Math.ceil((p.height ?? 220) / caps.stepMM);
  return clamp(base, 160, caps.maxRes);
}

// Base outer radius along height, with headroom reserved for textures
function rOuterAt(t, p) {
  const r = p.baseRadius + (p.topRadius - p.baseRadius) * t;
  const maxR = MAX_SIZE / 2;
  const head = p.texture_headroom ?? 0;
  return Math.min(r, Math.max(0.5, maxR - head));
}

// Will be filled after min scale estimate
function rInnerAt(t, p) {
  return Math.max(rOuterAt(t, p) - p._wallForLathe, 0.5);
}

// Make circular lathe profile with fixed 80 mm bottom hole
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

/* ---------- Polygon mapping ---------- */

// Build or refresh polygon descriptor for current params
function buildPolyDesc(p) {
  const S = clamp(Math.floor(p.lp_sides ?? 5), 3, 7);
  const jitter = clamp(p.lp_jitter ?? 0.2, 0, 0.5);
  const seed = Math.floor(p.lp_seed ?? 4242);

  // simple seeded rng
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };

  // radius factors per vertex, normalize so max equals 1
  const factors = [];
  let maxF = 0;
  for (let i = 0; i < S; i++) {
    const f = 1 + (rand() * 2 - 1) * jitter; // [1 - j, 1 + j]
    factors.push(f);
    if (f > maxF) maxF = f;
  }
  const invMax = maxF > 0 ? 1 / maxF : 1;
  for (let i = 0; i < S; i++) factors[i] *= invMax;

  const seg = (2 * Math.PI) / S;
  const basePhase = (clamp(p.lp_rotateDeg ?? 0, 0, 360) * Math.PI) / 180;

  return { S, seg, factors, basePhase };
}

// Return polygon scale factor s in 0..1 at angle theta and height t
function polyScaleAt(theta, t, p) {
  const desc = p._poly;
  
  // --- NEW FEATURE: Stack Steps ---
  // If steps > 0, we quantize 't' for the twist calculation.
  // This creates a "stacked boxes" look instead of a smooth spiral.
  let tTwist = t;
  const steps = Math.floor(p.lp_stack_steps ?? 0);
  if (steps > 0) {
    // Snap t to the nearest segment
    tTwist = Math.floor(t * steps) / steps;
  }

  const twist = p.lp_twistTurns ?? 0;
  const phi = desc.basePhase + 2 * Math.PI * twist * tTwist;

  // bring into 0..2π, then sector
  let a = theta - phi;
  a = a % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;

  const j = Math.floor(a / desc.seg);
  const f = (a - j * desc.seg) / desc.seg;

  const f0 = desc.factors[j];
  const f1 = desc.factors[(j + 1) % desc.S];
  return (1 - f) * f0 + f * f1; // 0..1, max equals 1
}

// Estimate minimal scale across height and angle, used to inflate wall for lathe
function estimateMinScale(p) {
  const desc = p._poly;
  let minS = 1;
  const stepsT = 24; // increased slightly for stack accuracy
  const stepsA = desc.S * 3;

  for (let i = 0; i <= stepsT; i++) {
    const t = i / stepsT;
    for (let j = 0; j < stepsA; j++) {
      const theta = (j / stepsA) * 2 * Math.PI;
      const s = polyScaleAt(theta, t, p);
      if (s < minS) minS = s;
    }
  }
  return Math.max(0.2, Math.min(1, minS));
}

/* ---------- Overhang guard, always on ---------- */

const MAX_OVERHANG_SLOPE = 1.0; // mm radial growth per 1 mm Z, equals 45 degrees

function worstOutwardSlope(p) {
  const H = p.height;
  if (H <= 0) return 0;

  const dRdy_linear = (p.topRadius - p.baseRadius) / H;
  const stepsT = 64;
  const stepsA = p._poly.S * 16;
  const epsT  = 1 / (stepsT * 2);

  let worst = 0;

  for (let i = 0; i <= stepsT; i++) {
    const t = i / stepsT;
    const y = t * H;
    if (y <= BOTTOM_THICK + 1e-6) continue;

    const rOut = rOuterAt(t, p);

    for (let j = 0; j < stepsA; j++) {
      const theta = (j / stepsA) * Math.PI * 2;

      const s0 = polyScaleAt(theta, t, p);

      const t1 = Math.min(1, t + epsT);
      const s1 = polyScaleAt(theta, t1, p);
      const dsdt = (s1 - s0) / Math.max(1e-9, t1 - t);
      const dsdy = dsdt / H;

      const dRdy = s0 * dRdy_linear + rOut * dsdy;

      if (dRdy > worst) worst = dRdy;
    }
  }
  return worst;
}

// Clamp profile so a straight cone cannot violate 45 degrees
function clampTopFor45(p) {
  if (p.topRadius <= p.baseRadius) return;
  const maxAllowedTop = p.baseRadius + p.height * MAX_OVERHANG_SLOPE;
  if (p.topRadius > maxAllowedTop) p.topRadius = maxAllowedTop;
}

function enforceOverhang(pIn, caps) {
  // Start from normal constraints, then adjust safely
  let p = constrainParams(pIn, caps);

  clampTopFor45(p);

  let tries = 0;
  while (tries < 20) {
    p._poly = buildPolyDesc(p);
    const minS = estimateMinScale(p);
    p._minScale = minS;
    p._wallForLathe = clamp(p.wall / Math.max(1e-6, minS), MIN_THICK, 3.0);

    const worst = worstOutwardSlope(p);
    if (worst <= MAX_OVERHANG_SLOPE + 1e-4) break;

    // First, reduce twist
    if (p.lp_twistTurns > 0.0001) {
      p.lp_twistTurns *= 0.8;
      tries++;
      continue;
    }

    // Second, reduce outward flare if any
    if (p.topRadius > p.baseRadius) {
      const dRdy = (p.topRadius - p.baseRadius) / p.height;
      const scale = clamp(0.7 + 0.28 * Math.random(), 0.7, 0.98);
      p.topRadius = p.baseRadius + p.height * dRdy * scale;
      tries++;
      continue;
    }

    // Last resort, small uniform inward nudge
    p.baseRadius *= 0.995;
    p.topRadius  *= 0.995;
    tries++;
  }
  return p;
}

/* ---------- Param constraints and build ---------- */

function constrainParams(pIn = {}, caps = PREVIEW_CAPS) {
  const out = { ...pIn };

  out.height = clamp(pIn.height ?? 220, 80, MAX_SIZE);
  out.wall   = clamp(pIn.wall ?? 1.2, MIN_THICK, MAX_THICK);

  // base cannot go below 90 mm radius
  const baseMin = Math.max(90, out.wall + 2);
  out.baseRadius = clamp(pIn.baseRadius ?? 110, baseMin, MAX_SIZE / 2);
  out.topRadius  = clamp(pIn.topRadius  ?? 90,  out.wall + 2, MAX_SIZE / 2);

  // polygon controls
  out.lp_sides      = clamp(Math.floor(pIn.lp_sides ?? 5), 3, 7);
  out.lp_jitter     = clamp(pIn.lp_jitter ?? 0.2, 0, 0.5);
  out.lp_twistTurns = clamp(pIn.lp_twistTurns ?? 0.6, 0, 2);
  out.lp_rotateDeg  = clamp(pIn.lp_rotateDeg ?? 0, 0, 360);
  out.lp_seed       = Math.floor(pIn.lp_seed ?? 4242);
  
  // New stack feature
  out.lp_stack_steps = clamp(Math.floor(pIn.lp_stack_steps ?? 0), 0, 50);

  // texture selection and headroom
  out.texture = pIn.texture ?? (textureOptions[0]?.value ?? "none");
  const tex = textures[out.texture];
  out.texture_headroom = tex?.headroom ? tex.headroom(out) : 0;

  // build polygon descriptor now
  out._poly = buildPolyDesc(out);

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

// Build circular lathe, then map XZ to polygon radius per angle and height.
function buildLowPoly(params, caps = PREVIEW_CAPS) {
  const p = enforceOverhang(params, caps);

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

    // map circle ring to polygon ring by radial scale
    const s = polyScaleAt(theta, t, p); // 0..1
    v.x *= s;
    v.z *= s;

    pos.setXYZ(i, v.x, v.y, v.z);
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();

  // apply outward texture last
  const entry = textures[p.texture];
  return entry?.apply ? entry.apply(geom, p) : geom;
}

// Dynamic schema
function schemaFor(params) {
  const base = [
    // --- PRIMARY CONTROLS (Visible by default) ---
    { key: "height",        label: "Height",           type: "range", min: 80,  max: MAX_SIZE, step: 1 },
    { key: "baseRadius",    label: "Bottom Size",      type: "range", min: 55, max: MAX_SIZE / 2, step: 0.5 },
    { key: "topRadius",     label: "Top Size",         type: "range", min: 10, max: MAX_SIZE / 2, step: 0.5 },
    { key: "lp_sides",      label: "Polygon Sides",    type: "range", min: 3,  max: 7, step: 1 },
    { key: "lp_twistTurns", label: "Twist",            type: "range", min: 0,  max: 2, step: 0.01 },
    { key: "texture",       label: "Texture",          type: "select", options: textureOptions },

    // --- ADVANCED CONTROLS (Hidden until toggled) ---
    { key: "lp_stack_steps",label: "Stack Segments",   type: "range", min: 0,  max: 20, step: 1, advanced: true }, // New Feature!
    { key: "lp_jitter",     label: "Crumple",          type: "range", min: 0,  max: 0.5, step: 0.01, advanced: true },
    { key: "lp_rotateDeg",  label: "Start Angle",      type: "range", min: 0,  max: 360, step: 1, advanced: true },
    { key: "wall",          label: "Wall Thickness",   type: "range", min: MIN_THICK, max: MAX_THICK, step: 0.1, advanced: true },
    { key: "lp_seed",       label: "Random Seed",      type: "range", min: 0,  max: 9999, step: 1, advanced: true },
    { key: "autoSpin",      label: "Auto Spin",        type: "checkbox", advanced: true },
  ];

  const texId = params?.texture ?? (textureOptions[0]?.value ?? "none");
  const texDesc = textures[texId];
  const tex = texDesc?.schema ?? [];

  return [
    ...base,
    ...tex,
  ];
}

function defaultsFactory() {
  const firstTex = textureOptions[0]?.value ?? "none";
  const d = {
    height: 220,
    wall: 0.8,

    baseRadius: 110,
    topRadius: 90,

    lp_sides: 5,
    lp_twistTurns: 0.6,
    lp_stack_steps: 0, // smooth by default
    lp_jitter: 0.2,
    lp_rotateDeg: 0,
    lp_seed: 4242,

    texture: firstTex,
    autoSpin: true,
  };
  const tex = textures[firstTex];
  return tex?.defaults ? { ...d, ...tex.defaults } : d;
}

export const models = {
  lowpoly: {
    label: "Low Poly Tube",
    schema: (params) => schemaFor(params),
    defaults: () => defaultsFactory(),
    build: (p) => buildLowPoly(p, PREVIEW_CAPS),
  },
};

function exportSTL(params) {
  import("three-stdlib").then(({ STLExporter }) => {
    const geom = buildLowPoly(params, EXPORT_CAPS);
    const exporter = new STLExporter();
    const data = exporter.parse(geom, { binary: true });
    const blob = new Blob([data], { type: "application/sla" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lampshade_lowpoly.stl";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

const label = "Lampshade, Low Poly";
export default { label, models, export: exportSTL };
