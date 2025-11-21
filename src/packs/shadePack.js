// src/packs/shadePack.js
import * as THREE from "three";
import { textures, textureOptions, textureOrder } from "../textures";

const MAX_SIZE = 240;   // mm for height and diameter
const MIN_THICK = 0.8;  // mm
const BOTTOM_THICK = 3; // mm
const FIXED_HOLE_DIAMETER = 80; // Strict requirement

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

const PREVIEW_CAPS = { maxRadial: 540, maxRes: 700, stepMM: 0.6, perBandBase: 18 };
const EXPORT_CAPS  = { maxRadial: 1200, maxRes: 1400, stepMM: 0.4, perBandBase: 22 };

function firstTextureId() { return textureOrder[0] ?? "none"; }

function withTextureDefaults(params) {
  const texKey = params?.texture ?? firstTextureId();
  const desc = textures[texKey];
  return desc?.defaults ? { ...desc.defaults, ...params, texture: texKey } : { ...params, texture: texKey };
}

/* base outer radius along height, with reserved headroom */
function rOuterAt(t, p) {
  // 1. Linear interpolation (Cone)
  let r = p.baseRadius + (p.topRadius - p.baseRadius) * t;
  
  // 2. Apply Curvature (Belly/Hourglass)
  // Sigma scales with height to keep proportions natural
  const sigma = 0.18 * p.height; 
  const y = t * p.height;
  const yc = p.bellyHeight * p.height;
  
  const bump = Math.exp(-((y - yc) ** 2) / (2 * sigma ** 2));
  const curvature = p.belly * bump;
  
  r += curvature;

  // 3. Clamp to safety limits
  const maxR = MAX_SIZE / 2;
  // Ensure we don't pinch thinner than the hole + wall + margin
  const minSafeR = (FIXED_HOLE_DIAMETER / 2) + p.wall + 2;
  
  // Only enforce minSafeR near the bottom (where the hole is)
  // Higher up, it can get thinner (like a bottle neck), but not too thin to print.
  const absoluteMin = 15; 
  
  // Smooth blend for safety constraint? 
  // For now, simple max is enough to prevent inverted geometry.
  const limitBottom = t < 0.1 ? minSafeR : absoluteMin;

  r = Math.max(limitBottom, r);
  r = Math.min(r, Math.max(0.5, maxR - (p.texture_headroom ?? 0)));
  return r;
}

function rInnerAt(t, p) { return Math.max(rOuterAt(t, p) - p.wall, 0.5); }

function recommendedRadialSegments(p, caps) {
  const bands =
    p.texture === "diagonalWeave" ? (p.t_weave_bands ?? 28) :
    p.texture === "verticalRibs"  ? (p.t_ribs_count ?? 24)  :
    p.texture === "spiralBands"   ? (p.t_spiral_bands ?? 8) :
    24;
  const sharp =
    p.texture === "diagonalWeave" ? (p.t_weave_sharpness ?? 3) :
    p.texture === "verticalRibs"  ? (p.t_ribs_sharpness ?? 4) :
    p.texture === "spiralBands"   ? (p.t_spiral_sharpness ?? 3) :
    3;

  const perBand = Math.max(12, caps.perBandBase + 2 * (sharp - 3));
  const want = Math.max(96, bands * perBand);
  return clamp(Math.round(want), 48, caps.maxRadial);
}

function recommendedResolution(p, caps) {
  const base = Math.ceil((p.height ?? 220) / caps.stepMM);
  return clamp(base, 140, caps.maxRes);
}

function constrainParams(pIn = {}, caps = PREVIEW_CAPS) {
  const p0 = withTextureDefaults(pIn);
  const out = { ...p0 };

  // core shape
  out.height = clamp(p0.height ?? 220, 80, MAX_SIZE);
  out.wall   = clamp(p0.wall ?? 1.0, MIN_THICK, 1.5);

  // Base must be at least large enough to hold the hardware hole
  const baseMin = (FIXED_HOLE_DIAMETER / 2) + out.wall + 4;
  out.baseRadius = clamp(p0.baseRadius ?? 110, baseMin, MAX_SIZE / 2);

  // top can be slimmer
  const topMin = out.wall + 2;
  out.topRadius  = clamp(p0.topRadius  ?? 90,  topMin, MAX_SIZE / 2);

  // Belly / Curvature: Negative = Hourglass, Positive = Barrel
  out.belly       = clamp(p0.belly ?? 20, -30, 40);
  out.bellyHeight = clamp(p0.bellyHeight ?? 0.5, 0.1, 0.9);

  // texture headroom
  const texDesc = textures[out.texture] || null;
  const headroom = texDesc?.headroom ? texDesc.headroom(out) : 0;
  out.texture_headroom = Math.max(0, Math.min(3.0, headroom));

  // auto detail
  const recRad = recommendedRadialSegments(out, caps);
  const recRes = recommendedResolution(out, caps);
  out.radialSegments = recRad;
  out.resolution = recRes;

  // Enforce fixed hole size internally
  out._holeRadius = FIXED_HOLE_DIAMETER * 0.5;
  out.bottom_thickness = BOTTOM_THICK;
  
  // Removed autoSpin
  out.autoSpin = false;

  return out;
}

function makeProfileWithHole(p) {
  const pts = [];
  const H = p.height;
  const N = p.resolution;
  const rHole = p._holeRadius; 

  // start at inner hole edge on the bottom
  pts.push(new THREE.Vector2(rHole, 0));
  // go to the outer bottom edge
  pts.push(new THREE.Vector2(rOuterAt(0, p), 0));

  // outer wall up
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    pts.push(new THREE.Vector2(rOuterAt(t, p), t * H));
  }

  // inner rim at top, keep open
  const rTopIn = Math.max(rInnerAt(1, p), 0.5);
  pts.push(new THREE.Vector2(rTopIn, H));

  // inner wall down to slab
  for (let i = N - 1; i >= 0; i--) {
    const t = i / N;
    const y = t * H;
    if (y < BOTTOM_THICK) break;
    pts.push(new THREE.Vector2(rInnerAt(t, p), y));
  }

  // across the slab to the hole radius, then close down to the bottom inner edge
  const rInSlab = Math.max(rInnerAt(BOTTOM_THICK / H, p), 0.5);
  pts.push(new THREE.Vector2(Math.min(rInSlab, rHole), BOTTOM_THICK));
  pts.push(new THREE.Vector2(rHole, BOTTOM_THICK));
  pts.push(new THREE.Vector2(rHole, 0));

  return pts;
}

function buildSolidShade(params) {
  const p = constrainParams(params, PREVIEW_CAPS);
  const profile = makeProfileWithHole(p);
  const geom = new THREE.LatheGeometry(profile, p.radialSegments);
  geom.computeVertexNormals();

  const texDesc = textures[p.texture];
  return texDesc?.apply ? texDesc.apply(geom, p) : geom;
}

// Dynamic Schema with Groups
function schemaFor(params) {
  const texKey = params?.texture ?? firstTextureId();
  const texDesc = textures[texKey];
  
  const base = [
    // --- SHAPE GROUP ---
    { key: "height",     label: "Height",         type: "range", min: 80,  max: MAX_SIZE, step: 1, group: "Shape" },
    { key: "baseRadius", label: "Base Size",      type: "range", min: 45,  max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    { key: "topRadius",  label: "Top Size",       type: "range", min: 10,  max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    
    // Enhanced Curvature Control
    { key: "belly",      label: "Curvature",      type: "range", min: -30, max: 40, step: 0.5, group: "Shape" }, // +/- for hourglass/barrel
    { key: "bellyHeight",label: "Curve Position", type: "range", min: 0.1, max: 0.9, step: 0.01, group: "Shape" },

    // --- ADVANCED GROUP ---
    { key: "wall",       label: "Wall Thickness", type: "range", min: MIN_THICK, max: 1.2, step: 0.1, group: "Shape", advanced: true },
  ];

  // --- TEXTURE GROUP ---
  const texSelector = { key: "texture", label: "Style", type: "select", options: textureOptions, group: "Texture" };
  
  // Remap texture fields to the Texture group
  const rawTex = texDesc?.schema ?? [];
  const texFields = rawTex.map(f => ({ ...f, group: "Texture" }));

  return [
    ...base,
    texSelector,
    ...texFields
  ];
}

function defaultsFactory() {
  const first = firstTextureId();
  const d = {
    height: 220,
    baseRadius: 75,
    topRadius: 90,
    wall: 0.8,
    belly: 20,       // Nice barrel shape by default
    bellyHeight: 0.5,
    // holeDiameter removed from defaults, handled internally

    texture: first,
    autoSpin: false,
  };
  const tex = textures[first];
  return tex?.defaults ? { ...d, ...tex.defaults } : d;
}

export const models = {
  solid: {
    label: "Solid Wall Shade",
    schema: (params) => schemaFor(params),
    defaults: () => defaultsFactory(),
    build: (p) => buildSolidShade(p),
  },
};

function exportSTL(params) {
  import("three-stdlib").then(({ STLExporter }) => {
    const p = constrainParams(params, EXPORT_CAPS);
    const profile = makeProfileWithHole(p);
    const geom = new THREE.LatheGeometry(profile, p.radialSegments);
    geom.computeVertexNormals();

    const texDesc = textures[p.texture];
    const textured = texDesc?.apply ? texDesc.apply(geom, p) : geom;

    const exporter = new STLExporter();
    const data = exporter.parse(textured, { binary: true });
    const blob = new Blob([data], { type: "application/sla" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lampshade_solid_wall.stl";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

const label = "Lampshade, Solid";
export default { label, models, export: exportSTL };
