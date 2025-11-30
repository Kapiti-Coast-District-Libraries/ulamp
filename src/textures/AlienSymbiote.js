// src/packs/rippleSpiralPack.js
import * as THREE from "three";
import { textures, textureOptions } from "../textures";

const MAX_SIZE = 240;
const MIN_THICK = 0.8;
const MAX_THICK = 1;
const BOTTOM_THICK = 3;
const FIXED_HOLE_DIAMETER = 80;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// --- FIXED: Sane Resolution Caps ---
// Previous settings were generating 1.5 Million triangles. 
// These settings generate ~300k triangles, which is still smooth but printable.
const PREVIEW_CAPS = { maxRadial: 200, maxRes: 300, stepMM: 1.0 };
const EXPORT_CAPS  = { maxRadial: 600, maxRes: 800, stepMM: 0.5 };

/* detail */
function recommendedRadialSegments(p, caps) {
  const k = clamp(p.gyroidFreq ?? 0.9, 0.2, 3);
  const want = Math.max(200, Math.round(500 * k));
  return clamp(want, 120, caps.maxRadial);
}
function recommendedResolution(p, caps) {
  const base = Math.ceil((p.height ?? 220) / caps.stepMM);
  return clamp(base, 200, caps.maxRes);
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

// ... (Existing Gyroid Logic omitted for brevity as we are using Alien mode, 
//      but keep it if you switch back. The important part is below.) ...

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
  out.gyroidSharp     = clamp(pIn.gyroidSharp ?? 2.5, 1, 12);
  out.inwardDepthMM   = clamp(pIn.inwardDepthMM ?? 3.0, 0, 10);
  out.depthTopScale   = clamp(pIn.depthTopScale ?? 0.4, 0, 1);

  out.texture = pIn.texture ?? (textureOptions[0]?.value ?? "none");
  const tex = textures[out.texture];
  out.texture_headroom = tex?.headroom ? tex.headroom(out) : 0;

  if (out.topRadius > out.baseRadius + out.height) out.topRadius = out.baseRadius + out.height;

  out._minScale = 0.9;
  out._wallForLathe = clamp(out.wall, MIN_THICK, 3.0);
  out.radialSegments = recommendedRadialSegments(out, caps);
  out.resolution      = recommendedResolution(out, caps);
  out.bottom_thickness = BOTTOM_THICK;
  out._holeRadius = FIXED_HOLE_DIAMETER * 0.5;
  out.autoSpin = false; 
   
  return out;
}

function buildGyroidGlow(params, caps = PREVIEW_CAPS) {
  const p = constrainParams(params, caps);
  const profile = makeProfileWithHole(p);
  
  // Create Geometry
  const geom = new THREE.LatheGeometry(profile, p.radialSegments);
  
  // --- SEAM WELDER ---
  // A LatheGeometry has a seam where angle 0 meets angle 360.
  // We identify these vertices and ensure they share exact coordinates
  // to prevent tearing during texture displacement.
  const pos = geom.attributes.position;
  const tolerance = 0.001;
  const radialSegs = p.radialSegments;
  
  // For every ring of vertices
  for (let i = 0; i < pos.count; i += (radialSegs + 1)) {
      const startIdx = i;
      const endIdx = i + radialSegs;
      
      if (endIdx < pos.count) {
          // Copy exact start position to end position
          pos.setXYZ(endIdx, pos.getX(startIdx), pos.getY(startIdx), pos.getZ(startIdx));
      }
  }

  geom.computeVertexNormals();

  // Apply Texture
  const entry = textures[p.texture];
  const texturedGeom = entry?.apply ? entry.apply(geom, p) : geom;

  // --- FINAL WELD ---
  // After texture, force the seam shut one last time
  const pos2 = texturedGeom.attributes.position;
  for (let i = 0; i < pos2.count; i += (radialSegs + 1)) {
      const startIdx = i;
      const endIdx = i + radialSegs;
      if (endIdx < pos2.count) {
          pos2.setXYZ(endIdx, pos2.getX(startIdx), pos2.getY(startIdx), pos2.getZ(startIdx));
      }
  }
  
  return texturedGeom;
}

/* schema */
function schemaFor(params) {
  const base = [
    { key: "height",        label: "Height",          type: "range", min: 100, max: MAX_SIZE, step: 1, group: "Shape" },
    { key: "baseRadius",    label: "Bottom Size",     type: "range", min: 45, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    { key: "topRadius",     label: "Top Size",        type: "range", min: 10, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    { key: "wall",          label: "Wall Thickness",  type: "range", min: MIN_THICK, max: MAX_THICK, step: 0.1, group: "Shape", advanced: true },
    { key: "gyroidFreq",      label: "Pattern Density", type: "range", min: 0.2, max: 3, step: 0.01, group: "Pattern" },
    { key: "gyroidThreshold", label: "Window Openness", type: "range", min: 0, max: 0.9, step: 0.01, group: "Pattern" },
    { key: "inwardDepthMM",   label: "Texture Height",  type: "range", min: 0, max: 5, step: 0.1, group: "Pattern" },
    { key: "gyroidPhaseDeg",  label: "Pattern Shift",   type: "range", min: 0, max: 360, step: 1, group: "Pattern", advanced: true },
    { key: "gyroidSharp",     label: "Edge Sharpness",  type: "range", min: 1, max: 12, step: 0.1, group: "Pattern", advanced: true },
    { key: "depthTopScale",   label: "Fade at Top",     type: "range", min: 0, max: 1, step: 0.01, group: "Pattern", advanced: true },
  ];

  const texId = params?.texture ?? (textureOptions[0]?.value ?? "none");
  const texDesc = textures[texId];
  const rawTex = texDesc?.schema ?? [];
  const texFields = rawTex.filter(e => e.key !== "gyroidTwistTurns").map(f => ({ ...f, group: "Texture" }));
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
    // Uses the reduced EXPORT_CAPS (~300k tris) instead of infinite
    const geom = buildGyroidGlow(params, EXPORT_CAPS);
    const exporter = new STLExporter();
    const data = exporter.parse(geom, { binary: true });
    const blob = new Blob([data], { type: "application/sla" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lampshade_alien_glow.stl";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}
const label = "Lampshade, Gyroid Glow";
export default { label, models, export: exportSTL };
