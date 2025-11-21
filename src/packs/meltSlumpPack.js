// src/packs/meltSlumpPack.js
// Melted, slumped vibe, print safe, 240 mm envelope, fixed 80 mm hole.
// World units are mm. Origin at 0,0,0. Base sits at y = 0.

import * as THREE from "three";
import { textures, textureOptions } from "../textures";

const MAX_SIZE = 240;
const MIN_THICK = 0.8;
const MAX_THICK = 1.1;
const BOTTOM_THICK = 3;
const FIXED_HOLE_DIAMETER = 80;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

const PREVIEW_CAPS = { maxRadial: 540, maxRes: 700, stepMM: 0.6 };
const EXPORT_CAPS  = { maxRadial: 1200, maxRes: 1400, stepMM: 0.4 };

/* ---------------- detail heuristics ---------------- */
function recommendedRadialSegments(p, caps) {
  const want = 200 + Math.round((p.m_drips ?? 3) * 8);
  return clamp(want, 120, caps.maxRadial);
}
function recommendedResolution(p, caps) {
  const base = Math.ceil((p.height ?? 220) / caps.stepMM);
  return clamp(base, 160, caps.maxRes);
}

/* ---------------- baseline radius, headroom ---------------- */
function rOuterAt(t, p) {
  const belly   = clamp(p.m_belly ?? 0.55, 0, 1);
  const waist   = clamp(p.m_waist ?? 0.25, 0, 0.9);
  const bulgeMM = clamp(p.m_bulge_mm ?? 18, 0, 40);

  const blend = 0.5 - 0.5 * Math.cos(Math.PI * t);
  const base = p.baseRadius + (p.topRadius - p.baseRadius) * blend;

  const bellyWin = Math.exp(-Math.pow((t - belly) / 0.28, 2));
  const bulge = bulgeMM * bellyWin * (1 - waist);

  const r = base + bulge;

  const maxR = MAX_SIZE / 2;
  const head = p.texture_headroom ?? 0;
  return Math.min(r, Math.max(0.5, maxR - head));
}
function rInnerAt(t, p) { return Math.max(rOuterAt(t, p) - p.wall, 0.5); }

/* ---------------- lathe profile with fixed 80 mm hole ---------------- */
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

/* ---------------- overhang guard on the base profile ---------------- */
const MAX_OVERHANG_SLOPE = 1.0; // 45 degrees

function worstOutwardSlopeBase(p) {
  const H = p.height;
  if (H <= 0) return 0;
  const steps = 120;
  const epsT = 1.0 / (steps * 2);

  let worst = 0;
  for (let i = 1; i < steps; i++) {
    const t0 = i / steps;
    const t1 = Math.min(1, t0 + epsT);
    const y0 = t0 * H;
    if (y0 <= BOTTOM_THICK + 1e-6) continue;
    const dRdy = (rOuterAt(t1, p) - rOuterAt(t0, p)) / Math.max(1e-9, (t1 - t0) * H);
    if (dRdy > worst) worst = dRdy;
  }
  return worst;
}

function clampTopFor45(p) {
  if (p.topRadius <= p.baseRadius) return;
  const maxAllowedTop = p.baseRadius + p.height * MAX_OVERHANG_SLOPE;
  if (p.topRadius > maxAllowedTop) p.topRadius = maxAllowedTop;
}

/* ---------------- constraints and build ---------------- */
function constrainParamsRaw(pIn = {}, caps = PREVIEW_CAPS) {
  const out = { ...pIn };

  // sizes
  out.height = clamp(pIn.height ?? 220, 80, MAX_SIZE);
  out.wall   = clamp(pIn.wall ?? 1.0, MIN_THICK, MAX_THICK);

  const baseMin = Math.max(45, out.wall + 2);
  out.baseRadius = clamp(pIn.baseRadius ?? 65, baseMin, MAX_SIZE / 2);
  out.topRadius  = clamp(pIn.topRadius  ?? 70, out.wall + 2, MAX_SIZE / 2);

  // base profile tuning
  out.m_bulge_mm = clamp(pIn.m_bulge_mm ?? 18, 0, 40);
  out.m_belly    = clamp(pIn.m_belly ?? 0.55, 0, 1);
  out.m_waist    = clamp(pIn.m_waist ?? 0.25, 0, 0.9);

  // melt controls
  out.m_slouch_mm     = clamp(pIn.m_slouch_mm ?? 14, 0, 40);
  out.m_slouch_angle  = pIn.m_slouch_angle ?? 0.0;
  out.m_tilt_deg      = clamp(pIn.m_tilt_deg ?? 6, -20, 20);
  out.m_top_droop_mm  = clamp(pIn.m_top_droop_mm ?? 10, 0, 40);
  out.m_drips         = clamp(Math.floor(pIn.m_drips ?? 3), 1, 8);
  out.m_drip_sharp    = clamp(pIn.m_drip_sharp ?? 1.4, 0.5, 4);
  out.m_warp_twist    = clamp(pIn.m_warp_twist ?? 0.15, -1, 1);
  
  // New Feature: Puddle
  out.m_puddle_frac   = clamp(pIn.m_puddle_frac ?? 0.0, 0, 1.0);

  // texture integration
  out.texture = pIn.texture ?? (textureOptions[0]?.value ?? "none");
  const texEntry = textures?.[out.texture];
  out.texture_headroom = texEntry && typeof texEntry.headroom === "function" ? texEntry.headroom(out) : 0;

  // detail
  out.radialSegments = recommendedRadialSegments(out, caps);
  out.resolution     = recommendedResolution(out, caps);

  out.bottom_thickness = BOTTOM_THICK;
  out._holeRadius = FIXED_HOLE_DIAMETER * 0.5;
  out.autoSpin = pIn.autoSpin ?? true;

  return out;
}

function enforceOverhang(pIn, caps) {
  const p = constrainParamsRaw(pIn, caps);
  clampTopFor45(p);

  let tries = 0;
  while (tries < 20) {
    const worst = worstOutwardSlopeBase(p);
    if (worst <= MAX_OVERHANG_SLOPE + 1e-4) break;

    if (p.m_bulge_mm > 4) { p.m_bulge_mm = Math.max(4, p.m_bulge_mm * 0.9); tries++; continue; }

    if (p.topRadius > p.baseRadius) {
      const dRdy = (p.topRadius - p.baseRadius) / p.height;
      const scale = clamp((dRdy - 0.15) / Math.max(1e-9, dRdy), 0.7, 0.98);
      p.topRadius = p.baseRadius + p.height * dRdy * scale;
      tries++; continue;
    }

    p.baseRadius *= 0.996;
    p.topRadius  *= 0.996;
    tries++;
  }
  return p;
}

function constrainParams(pIn = {}, caps = PREVIEW_CAPS) {
  return enforceOverhang(pIn, caps);
}

/* ---------------- melt field helpers ---------------- */
function tri(u) { return 1 - Math.abs(((u + 1) % 2) - 1); } // triangle 0..1..0
function smooth01(u) { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); }

/* ---------------- apply melt, preserves wall, keeps envelope ---------------- */
function applyMelt(geom, p) {
  const pos = geom.attributes.position;
  if (!pos) return geom;

  const H = p.height;
  const bottomY = (p.bottom_thickness ?? 3) + 0.1;
  const maxR = MAX_SIZE / 2;

  const slouchAmp = p.m_slouch_mm;
  const slouchDir = p.m_slouch_angle ?? 0.0;
  const slx = Math.cos(slouchDir), slz = Math.sin(slouchDir);

  const tiltRad = (p.m_tilt_deg ?? 0) * Math.PI / 180;
  const tdx = Math.cos(slouchDir + Math.PI * 0.5);
  const tdz = Math.sin(slouchDir + Math.PI * 0.5);

  const dripCount = clamp(Math.floor(p.m_drips ?? 3), 1, 8);
  const dripSharp = p.m_drip_sharp ?? 1.4;
  const droopMM   = p.m_top_droop_mm ?? 10;
  const twistTurns = p.m_warp_twist ?? 0.15;
  const puddleFrac = p.m_puddle_frac ?? 0.0;

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y <= bottomY) continue;

    const t = clamp(y / H, 0, 1);
    const r = Math.hypot(x, z);
    if (r < 1e-6) { pos.setXYZ(i, x, y, z); continue; }
    let theta = Math.atan2(z, x);

    // sideways slouch
    const easeB = smooth01((y - bottomY) / Math.max(1e-6, 0.6 * H));
    const slouch = slouchAmp * (0.2 + 0.8 * t) * easeB;
    x += slouch * slx;
    z += slouch * slz;

    // top tilt shear
    const dirDot = (x * tdx + z * tdz) / Math.max(1e-6, r);
    const tiltDrop = Math.tan(tiltRad) * H * (t * t);
    y -= dirDot * tiltDrop;

    // rim droop with drips
    const topWin = smooth01(Math.max(0, t - 0.5) / 0.5);
    const spin = theta + twistTurns * 2 * Math.PI * t;
    const dripField = Math.pow(Math.max(0, Math.cos(dripCount * spin)), dripSharp);
    y -= droopMM * dripField * topWin;

    // bottom puddle radius increase near slab
    const nearBottom = 1 - smooth01(Math.max(0, (y - bottomY) / Math.max(1e-6, 10)));
    const puddle = puddleFrac * r * nearBottom;
    if (puddle > 0) {
      const nr = r + puddle;
      const k = nr / r;
      x *= k; z *= k;
    }

    // keep inside the 240 mm envelope
    const rr = Math.hypot(x, z);
    if (rr > maxR) { const s = maxR / rr; x *= s; z *= s; }

    // do not sink below the table
    if (y < 0) y = 0;

    pos.setXYZ(i, x, y, z);
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}

/* ---------------- build ---------------- */
function buildMeltSlump(params, caps = PREVIEW_CAPS) {
  const p = constrainParams(params, caps);

  const profile = makeProfileWithHole(p);
  const geom = new THREE.LatheGeometry(profile, p.radialSegments);
  geom.computeVertexNormals();

  applyMelt(geom, p);

  const entry = textures?.[p.texture];
  return entry && typeof entry.apply === "function" ? entry.apply(geom, p) : geom;
}

/* ---------------- schema (Grouped & Cleaned) ---------------- */
function schemaFor(params) {
  const base = [
    // --- SHAPE GROUP ---
    { key: "height",     label: "Height",      type: "range", min: 80,  max: MAX_SIZE, step: 1, group: "Shape" },
    { key: "baseRadius", label: "Bottom Size", type: "range", min: 45, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    { key: "topRadius",  label: "Top Size",    type: "range", min: 10, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    { key: "m_bulge_mm", label: "Belly Size",  type: "range", min: 0, max: 40, step: 0.5, group: "Shape" },
    
    // Advanced Shape
    { key: "m_belly",    label: "Belly Height",type: "range", min: 0, max: 1, step: 0.01, group: "Shape", advanced: true },
    { key: "m_waist",    label: "Waist Pinch", type: "range", min: 0, max: 0.9, step: 0.01, group: "Shape", advanced: true },
    { key: "wall",       label: "Wall Thickness", type: "range", min: MIN_THICK, max: MAX_THICK, step: 0.1, group: "Shape", advanced: true },

    // --- MELT GROUP ---
    { key: "m_slouch_mm",    label: "Slouch Amount", type: "range", min: 0, max: 40, step: 0.5, group: "Melt" },
    { key: "m_top_droop_mm", label: "Drip Length",   type: "range", min: 0, max: 40, step: 0.5, group: "Melt" },
    { key: "m_puddle_frac",  label: "Wax Puddle",    type: "range", min: 0, max: 1.0, step: 0.05, group: "Melt" }, // New Feature!
    { key: "m_tilt_deg",     label: "Top Tilt",      type: "range", min: -20, max: 20, step: 0.1, group: "Melt" },
    { key: "m_warp_twist",   label: "Melt Twist",    type: "range", min: -1, max: 1, step: 0.01, group: "Melt" },

    // Advanced Melt
    { key: "m_drips",        label: "Drip Count",    type: "range", min: 1, max: 8, step: 1, group: "Melt", advanced: true },
    { key: "m_drip_sharp",   label: "Drip Sharpness",type: "range", min: 0.5, max: 4, step: 0.1, group: "Melt", advanced: true },
    { key: "m_slouch_angle", label: "Slouch Direction", type: "range", min: -3.14, max: 3.14, step: 0.01, group: "Melt", advanced: true },
    { key: "autoSpin",       label: "Auto Spin",     type: "checkbox", group: "Melt", advanced: true },
  ];

  const texId = params?.texture ?? (textureOptions[0]?.value ?? "none");
  const texDesc = textures?.[texId];
  const rawTex = texDesc?.schema ?? [];

  // Texture Group
  const texSelector = { key: "texture", label: "Style", type: "select", options: textureOptions, group: "Texture" };
  const texFields = rawTex.map(f => ({ ...f, group: "Texture" }));

  return [
    ...base,
    texSelector,
    ...texFields
  ];
}

/* ---------------- defaults ---------------- */
function defaultsFactory() {
  const firstTex = textureOptions[0]?.value ?? "none";
  const d = {
    height: 220,
    wall: 1.0,

    baseRadius: 65,
    topRadius: 70,

    m_bulge_mm: 18,
    m_belly: 0.55,
    m_waist: 0.25,

    m_slouch_mm: 14,
    m_slouch_angle: 0.0,
    m_tilt_deg: 6,

    m_top_droop_mm: 10,
    m_drips: 3,
    m_drip_sharp: 1.4,
    m_warp_twist: 0.15,
    
    // Enable a little puddle by default to show off the feature
    m_puddle_frac: 0.2,

    texture: firstTex,
    autoSpin: true,
  };
  const tex = textures?.[firstTex];
  return tex?.defaults ? { ...d, ...tex.defaults } : d;
}

/* ---------------- model export ---------------- */
export const models = {
  meltSlump: {
    label: "Melt Slump Shade",
    schema: (params) => schemaFor(params),
    defaults: () => defaultsFactory(),
    build: (p) => buildMeltSlump(p, PREVIEW_CAPS),
  },
};

function exportSTL(params) {
  import("three-stdlib").then(({ STLExporter }) => {
    const geom = buildMeltSlump(params, EXPORT_CAPS);
    const exporter = new STLExporter();
    const data = exporter.parse(geom, { binary: true });
    const blob = new Blob([data], { type: "application/sla" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lampshade_melt_slump.stl";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }).catch((e) => {
    console.error("STL export failed", e);
  });
}

const label = "Lampshade, Melt Slump";
export default { label, models, export: exportSTL };
