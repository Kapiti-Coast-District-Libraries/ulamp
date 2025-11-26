// src/packs/rosePack.js
import * as THREE from "three";
import { mergeBufferGeometries } from "three-stdlib";
import { textures, textureOptions } from "../textures";

const MAX_SIZE = 240;
const BOTTOM_THICK = 3;
const FIXED_HOLE_DIAMETER = 80;

// Helper to clamp values
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// --- 1. Petal Geometry Builder ---
// Creates a single petal (a partial lathe)
function createPetal(p, layerIndex, totalLayers, angleOffset) {
  const H = p.height;
  
  // Progress (0 = inner, 1 = outer)
  const tLayer = layerIndex / Math.max(1, totalLayers - 1);

  // Petal Shape Logic
  // Inner petals are tighter and more upright. Outer petals droop and widen.
  const baseR = 40 + (tLayer * (p.r_bloom ?? 60)); // Grows outward
  const tilt  = 0.2 + (tLayer * 0.5); // Outer ones lean back more

  // Profile Generation (Simple curve)
  const pts = [];
  const segments = 16;
  
  // Bottom attachment point (must be solid)
  pts.push(new THREE.Vector2(40, 0)); 
  pts.push(new THREE.Vector2(baseR, 0));

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = t * H;
    
    // Curve equation: wider in middle, tapers at top
    // We add 'tilt' to radius as we go up
    let r = baseR + (y * tilt);
    
    // Curvature (belly)
    const curve = Math.sin(t * Math.PI) * (10 + 20 * tLayer);
    r += curve;

    // Taper top slightly
    if (t > 0.8) r -= (t - 0.8) * 30;

    pts.push(new THREE.Vector2(Math.max(40.5, r), y));
  }

  // Create the partial lathe (The Petal)
  // phiLength: Inner = wrapped (180deg), Outer = open (90deg)
  const widthDeg = 180 - (tLayer * 100); 
  const phiLen = (widthDeg * Math.PI) / 180;
  const phiStart = -phiLen / 2; // Center the petal

  const geom = new THREE.LatheGeometry(pts, 12, phiStart, phiLen);
  
  // Rotate petal to its place in the flower
  geom.rotateY(angleOffset);

  return geom;
}

// --- 2. Main Build Function ---
function buildRose(params) {
  const p = constrainParams(params);
  const geometries = [];

  // A. The Core Stem (Essential for hardware mount)
  // Solid inner cylinder at 40mm radius (80mm diam)
  const coreProfile = [
    new THREE.Vector2(40, 0),
    new THREE.Vector2(40, p.height),
    new THREE.Vector2(40 - p.wall, p.height),
    new THREE.Vector2(40 - p.wall, BOTTOM_THICK),
    new THREE.Vector2(40, BOTTOM_THICK)
  ];
  // Note: Inside of this is empty, but we need a wall for the petals to attach to
  const core = new THREE.LatheGeometry(coreProfile, 32);
  geometries.push(core);

  // B. Generate Petals
  const count = Math.floor(p.r_count ?? 18);
  const phi = 137.5 * (Math.PI / 180); // Golden Angle

  for (let i = 0; i < count; i++) {
    // Rotation for this petal
    const angle = i * phi;
    
    // Generate petal geometry
    const petalGeom = createPetal(p, i, count, angle);
    
    // Apply Texture individually (optional, but looks good)
    // or merge first. Merging first is safer for memory.
    
    geometries.push(petalGeom);
  }

  // C. Merge Everything
  // Check if we have valid geometries
  if (geometries.length === 0) return new THREE.BufferGeometry();
  
  const merged = mergeBufferGeometries(geometries, true); // useGroups = true
  
  // Clean up clean geometry
  merged.computeVertexNormals();

  // D. Apply Texture to the whole flower
  const texDesc = textures[p.texture];
  return texDesc?.apply ? texDesc.apply(merged, p) : merged;
}

// --- 3. Parameters & Schema ---
function constrainParams(pIn) {
  const out = { ...pIn };
  out.height  = clamp(pIn.height ?? 180, 80, MAX_SIZE);
  out.wall    = clamp(pIn.wall ?? 1.2, 0.8, 2.0); // Thick walls for petals
  out.r_count = clamp(pIn.r_count ?? 24, 5, 60);
  out.r_bloom = clamp(pIn.r_bloom ?? 50, 0, 100); // How wide it opens
  
  // Texture standard
  out.texture = pIn.texture ?? "none";
  return out;
}

function schemaFor(params) {
  return [
    { key: "height",  label: "Height",       type: "range", min: 80, max: 240, step: 1, group: "Shape" },
    { key: "r_count", label: "Petal Count",  type: "range", min: 5, max: 60, step: 1, group: "Rose" },
    { key: "r_bloom", label: "Bloom Width",  type: "range", min: 0, max: 100, step: 1, group: "Rose" },
    { key: "wall",    label: "Petal Thick",  type: "range", min: 0.8, max: 2.0, step: 0.1, group: "Shape", advanced: true },
    
    // Texture Group
    { key: "texture", label: "Style", type: "select", options: textureOptions, group: "Texture" }
  ];
}

// --- 4. Export ---
export const models = {
  rose: {
    label: "Organic Rose",
    schema: schemaFor,
    defaults: () => ({
      height: 180,
      r_count: 24,
      r_bloom: 50,
      wall: 1.2,
      texture: "none"
    }),
    build: buildRose
  }
};

function exportSTL(params) {
  import("three-stdlib").then(({ STLExporter }) => {
    const geom = buildRose(params);
    const exporter = new STLExporter();
    const data = exporter.parse(geom, { binary: true });
    const blob = new Blob([data], { type: "application/sla" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lampshade_rose.stl";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

export default { label: "Lampshade, Rose", models, export: exportSTL };
