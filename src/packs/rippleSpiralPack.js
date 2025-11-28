// src/packs/rippleSpiralPack.js
import * as THREE from "three";
import { textures, textureOptions } from "../textures";

const MAX_SIZE = 240;
const MIN_THICK = 0.8;
// Increased Max Thickness so you can make sturdy prints
const MAX_THICK = 4.0; 
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

/* base profile - Outer Skin Only */
function rOuterAt(t, p) {
  const r = p.baseRadius + (p.topRadius - p.baseRadius) * t;
  const maxR = MAX_SIZE * 0.5;
  const head = p.texture_headroom ?? 0;
  return Math.min(r, Math.max(0.5, maxR - head));
}

// Replaced "ProfileWithHole" with "SurfaceProfile" (L-Shape: Floor + Wall)
function makeSurfaceProfile(p) {
  const pts = [];
  const H = p.height;
  const N = p.resolution;
  const rHole = FIXED_HOLE_DIAMETER * 0.5;

  // 1. Floor (Hole -> Edge)
  pts.push(new THREE.Vector2(rHole, 0));
  // Add a midpoint to the floor for better triangulation
  pts.push(new THREE.Vector2(rHole + (rOuterAt(0,p) - rHole)*0.5, 0)); 
  pts.push(new THREE.Vector2(rOuterAt(0, p), 0));

  // 2. Wall (Edge -> Top)
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push(new THREE.Vector2(rOuterAt(t, p), t * H));
  }
  
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
  return clamp(s, 0.1, 1); // Allow deeper cuts now that we don't fear wall thinning
}

function clampTopFor45(p) {
  if (p.topRadius <= p.baseRadius) return;
  const maxAllowed = p.baseRadius + p.height * 1.0;
  if (p.topRadius > maxAllowed) p.topRadius = maxAllowed;
}

function constrainParams(pIn = {}, caps = PREVIEW_CAPS) {
  const out = { ...pIn };
  out.height = clamp(pIn.height ?? 220, 100, MAX_SIZE);
  // Relaxed max thickness
  out.wall   = clamp(pIn.wall ?? 1.2, MIN_THICK, MAX_THICK);

  const baseMin = Math.max(45, out.wall + 2, FIXED_HOLE_DIAMETER * 0.5 + 5);
  out.baseRadius = clamp(pIn.baseRadius ?? 116, baseMin, MAX_SIZE / 2);
  out.topRadius  = clamp(pIn.topRadius  ?? 92,  out.wall + 2, MAX_SIZE / 2);

  out.gyroidFreq        = clamp(pIn.gyroidFreq ?? 0.9, 0.2, 3);
  out.gyroidPhaseDeg    = clamp(pIn.gyroidPhaseDeg ?? 0, 0, 360);
  out.gyroidThreshold = clamp(pIn.gyroidThreshold ?? 0.15, 0, 0.9);
  out.gyroidSharp       = clamp(pIn.gyroidSharp ?? 3, 1, 12);
  out.inwardDepthMM     = clamp(pIn.inwardDepthMM ?? 3.0, 0, 10);
  out.depthTopScale     = clamp(pIn.depthTopScale ?? 0.4, 0, 1);

  out.texture = pIn.texture ?? (textureOptions[0]?.value ?? "none");
  const tex = textures[out.texture];
  out.texture_headroom = tex?.headroom ? tex.headroom(out) : 0;

  clampTopFor45(out);

  // REMOVED: estimateMinScale and _wallForLathe. 
  // We no longer need to pre-inflate the wall.
  
  out.radialSegments = recommendedRadialSegments(out, caps);
  out.resolution       = recommendedResolution(out, caps);

  out.bottom_thickness = BOTTOM_THICK;
  out._holeRadius = FIXED_HOLE_DIAMETER * 0.5;
  out.autoSpin = false; 
  return out;
}

// --- SOLIDIFY HELPER (Same as in ShadePack) ---
function solidify(geometry, wallThickness, floorThickness) {
  const posAttribute = geometry.attributes.position;
  const normAttribute = geometry.attributes.normal;
  const uvAttribute = geometry.attributes.uv;
  const indexAttribute = geometry.index;
  if (!posAttribute || !normAttribute || !indexAttribute) return geometry;

  const vertexCount = posAttribute.count;
  const faceCount = indexAttribute.count / 3;

  const newPos = new Float32Array(vertexCount * 3 * 2);
  const newNorm = new Float32Array(vertexCount * 3 * 2);
  const newUV = new Float32Array(vertexCount * 2 * 2);
  
  for (let i = 0; i < vertexCount; i++) {
    const x = posAttribute.getX(i);
    const y = posAttribute.getY(i);
    const z = posAttribute.getZ(i);
    const nx = normAttribute.getX(i);
    const ny = normAttribute.getY(i);
    const nz = normAttribute.getZ(i);
    const u = uvAttribute.getX(i);
    const v = uvAttribute.getY(i);

    // Outer
    newPos[i*3]=x; newPos[i*3+1]=y; newPos[i*3+2]=z;
    newNorm[i*3]=nx; newNorm[i*3+1]=ny; newNorm[i*3+2]=nz;
    newUV[i*2]=u; newUV[i*2+1]=v;

    // Inner
    const isFloor = Math.abs(ny) > 0.7; 
    const t = isFloor ? floorThickness : wallThickness;
    newPos[(i+vertexCount)*3] = x - nx * t;
    newPos[(i+vertexCount)*3+1] = y - ny * t;
    newPos[(i+vertexCount)*3+2] = z - nz * t;
    newNorm[(i+vertexCount)*3] = -nx;
    newNorm[(i+vertexCount)*3+1] = -ny;
    newNorm[(i+vertexCount)*3+2] = -nz;
    newUV[(i+vertexCount)*2] = u;
    newUV[(i+vertexCount)*2+1] = v;
  }

  const indices = [];
  for (let i = 0; i < faceCount; i++) {
    const a = indexAttribute.getX(i * 3);
    const b = indexAttribute.getY(i * 3);
    const c = indexAttribute.getZ(i * 3);
    indices.push(a, b, c); // Outer
    indices.push(a + vertexCount, c + vertexCount, b + vertexCount); // Inner
  }

  // Stitch Rims
  const edgeCounts = new Map();
  const addEdge = (u, v) => {
    const key = u < v ? `${u}_${v}` : `${v}_${u}`;
    edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
  };
  for (let i = 0; i < faceCount; i++) {
    const a = indexAttribute.getX(i*3), b = indexAttribute.getY(i*3), c = indexAttribute.getZ(i*3);
    addEdge(a, b); addEdge(b, c); addEdge(c, a);
  }
  for (let i = 0; i < faceCount; i++) {
    const a = indexAttribute.getX(i*3), b = indexAttribute.getY(i*3), c = indexAttribute.getZ(i*3);
    const stitch = (p1, p2) => {
       const key = p1 < p2 ? `${p1}_${p2}` : `${p2}_${p1}`;
       if (edgeCounts.get(key) === 1) {
         indices.push(p2, p1, p1 + vertexCount);
         indices.push(p2, p1 + vertexCount, p2 + vertexCount);
         edgeCounts.set(key, 2);
       }
    };
    stitch(a, b); stitch(b, c); stitch(c, a);
  }

  const solidGeom = new THREE.BufferGeometry();
  solidGeom.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
  solidGeom.setAttribute('normal', new THREE.BufferAttribute(newNorm, 3));
  solidGeom.setAttribute('uv', new THREE.BufferAttribute(newUV, 2));
  solidGeom.setIndex(indices);
  solidGeom.computeVertexNormals();
  return solidGeom;
}

function buildGyroidGlow(params, caps = PREVIEW_CAPS) {
  const p = constrainParams(params, caps);
  
  // 1. Generate Surface (L-Profile)
  const profile = makeSurfaceProfile(p);
  const geom = new THREE.LatheGeometry(profile, p.radialSegments);
  geom.computeVertexNormals();

  const H = p.height;
  const N = p.resolution;
  const A = p.radialSegments;
  const dy = H / N;

  const rBase = new Array(N + 1);
  // We only care about the wall part for Gyroid, which is indices 0 to N? 
  // Actually, SurfaceProfile has "Floor" points first.
  // We need to identify which vertices are "Wall" vs "Floor" for the Gyroid effect.
  // The Gyroid logic relies on 't' (height fraction).
  
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();

  // Helper to precompute offsets just like before
  // But now we calculate them on the fly per vertex is easier
  
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    
    // SKIP FLOOR: Only apply Gyroid to the wall (y > 0)
    // or blend it in? The original code skipped bottom thick.
    if (v.y < 0.1) continue; 

    const r = Math.hypot(v.x, v.z);
    
    // Calculate mapping coords
    const t = THREE.MathUtils.clamp(v.y / H, 0, 1);
    let theta = Math.atan2(v.z, v.x);
    if (theta < 0) theta += Math.PI * 2;

    // Calculate Deform
    const inwardOffset = inwardOffsetRaw(theta, t, p, r);
    
    // Apply Deform (Move Surface Inward)
    // We limit it so it doesn't cross center
    const safeR = Math.max(0.5, r - inwardOffset);
    const scale = safeR / r;
    
    v.x *= scale;
    v.z *= scale;
    
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();

  // 2. Apply Pinch/Texture (Deforms the Surface further)
  const entry = textures[p.texture];
  if (entry?.apply) entry.apply(geom, p);

  // 3. Solidify (Thicken the Deformed Surface)
  return solidify(geom, p.wall, p.bottom_thickness);
}

function schemaFor(params) {
  const base = [
    { key: "height",          label: "Height",          type: "range", min: 100, max: MAX_SIZE, step: 1, group: "Shape" },
    { key: "baseRadius",      label: "Bottom Size",     type: "range", min: 45, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    { key: "topRadius",       label: "Top Size",        type: "range", min: 10, max: MAX_SIZE / 2, step: 0.5, group: "Shape" },
    { key: "wall",            label: "Wall Thickness",  type: "range", min: MIN_THICK, max: MAX_THICK, step: 0.1, group: "Shape", advanced: true },
    { key: "gyroidFreq",      label: "Pattern Density", type: "range", min: 0.2, max: 3, step: 0.01, group: "Pattern" },
    { key: "gyroidThreshold", label: "Window Openness", type: "range", min: 0, max: 0.9, step: 0.01, group: "Pattern" },
    { key: "inwardDepthMM",   label: "Indent Depth",    type: "range", min: 0, max: 15, step: 0.1, group: "Pattern" }, // Increased max depth
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
