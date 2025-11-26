// src/packs/coralPack.js
import * as THREE from "three";
import { mergeBufferGeometries } from "three-stdlib";
import { textures, textureOptions } from "../textures";

const MAX_SIZE = 240;
const BOTTOM_THICK = 3;
const FIXED_HOLE_DIAMETER = 80;

// --- Helper Math ---
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function randFloat(min, max) { return min + Math.random() * (max - min); }

// --- 1. The Walker Algorithm (Branch Generator) ---
function generateCoralPaths(p) {
  const paths = [];
  const H = p.height;
  const growthStep = 3.0; // mm per step vertical
  
  // How many steps to reach the top?
  const totalSteps = Math.ceil(H / growthStep);

  // Initial seeds on the ring
  // Start slightly inside the 80mm hole (r=40) so they fuse to the wall
  const seedCount = Math.round(p.c_branches ?? 12);
  let activeTips = [];

  for (let i = 0; i < seedCount; i++) {
    const angle = (i / seedCount) * Math.PI * 2;
    const r = 42; // Start on the solid rim
    activeTips.push({
      pts: [new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r)],
      angle: angle, // Current bearing
      r: r,         // Current distance from center
      alive: true
    });
  }

  // Simulation Loop
  for (let step = 0; step < totalSteps; step++) {
    const y = (step + 1) * growthStep;
    const t = y / H; // 0..1 progress

    // iterate backwards so we can add new tips while looping
    for (let i = activeTips.length - 1; i >= 0; i--) {
      const tip = activeTips[i];
      if (!tip.alive) continue;

      const lastPt = tip.pts[tip.pts.length - 1];

      // 1. Calculate new position
      // Target shape: We want to expand from 40mm bottom to 'topRadius'
      const targetR = 40 + (p.topRadius - 40) * t;
      
      // Wiggle Logic
      const wiggleAmp = (p.c_wiggle ?? 5.0) * (0.2 + 0.8 * t);
      // Bias towards the target radius
      const rError = targetR - tip.r;
      const rPush = rError * 0.1; 

      // New Polar coords
      let newR = tip.r + rPush + randFloat(-1, 1);
      let newAng = tip.angle + randFloat(-0.2, 0.2);

      // Convert to Cartesian
      let nx = Math.cos(newAng) * newR;
      let nz = Math.sin(newAng) * newR;

      // 2. Overhang Guard (CRITICAL for printing)
      // Max horizontal move per 3mm vertical is 3mm (45 degrees)
      const dx = nx - lastPt.x;
      const dz = nz - lastPt.z;
      const dist = Math.hypot(dx, dz);
      const maxDist = growthStep * 0.9; // 0.9 safety factor

      if (dist > maxDist) {
        const scale = maxDist / dist;
        nx = lastPt.x + dx * scale;
        nz = lastPt.z + dz * scale;
        // recalculate polar for next step state
        newR = Math.hypot(nx, nz);
        newAng = Math.atan2(nz, nx);
      }

      // Update Tip
      const newPt = new THREE.Vector3(nx, y, nz);
      tip.pts.push(newPt);
      tip.r = newR;
      tip.angle = newAng;

      // 3. Branching Logic
      // Chance to split, increases with height, decreases if too many tips
      const densityLimit = (p.c_density ?? 20); // max tips roughly
      if (activeTips.length < densityLimit && Math.random() < 0.05) {
        // Spawn a new branch from here
        activeTips.push({
          pts: [newPt.clone()], // Start exactly where parent is
          angle: newAng + 0.1,  // Slight diverge
          r: newR,
          alive: true
        });
      }

      // 4. Pruning Logic (Collision / Too close)
      // Simple check: if radius gets too small (inside hole) or too big
      if (newR < 38) tip.alive = false; // Don't grow into the hardware hole
      if (newR > MAX_SIZE / 2) tip.alive = false;
    }
  }

  // Convert tips to simple arrays of points
  return activeTips.map(t => t.pts);
}

// --- 2. Geometry Builder ---
function buildCoral(params) {
  const p = constrainParams(params);
  const geometries = [];

  // A. The Base Ring (Solid Anchor)
  // Simple tube or lathe at the bottom to hold hardware
  const baseProfile = [
    new THREE.Vector2(40, 0),
    new THREE.Vector2(45, 0),
    new THREE.Vector2(45, BOTTOM_THICK),
    new THREE.Vector2(40, BOTTOM_THICK),
    new THREE.Vector2(40, 0),
  ];
  const baseGeom = new THREE.LatheGeometry(baseProfile, 32);
  geometries.push(baseGeom);

  // B. Generate Branch Paths
  const paths = generateCoralPaths(p);

  // C. Meshing the Paths
  // TubeGeometry params
  const thick = p.c_thickness ?? 2.5; // Radius of tube
  const segments = 20; // Length segments (low is fine, it's organic)
  const radial = 6;    // Cross-section segments (Low poly is faster/sturdy)

  paths.forEach((pts) => {
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts);
    
    // Taper function: Thick at bottom, thinner at tips
    // tube radius at t (0..1)
    const taper = (t) => {
        const base = thick;
        // Grow thinner towards 1
        return Math.max(0.8, base * (1 - 0.5 * t));
    };

    // Need a custom generator for variable radius in simple ThreeJS?
    // Standard TubeGeometry doesn't support radius function easily in older versions,
    // but we can scale the geometry after creation or use a simple constant for now.
    // Let's use constant for stability, or scale vertices manually.
    
    const tube = new THREE.TubeGeometry(curve, pts.length * 2, 1, radial, false);
    
    // Manual Tapering Loop
    const pos = tube.attributes.position;
    for(let i=0; i < pos.count; i++) {
        // TubeGeometry stores vertices ring by ring.
        // We can roughly estimate 't' by y-height
        const y = pos.getY(i);
        const t = clamp(y / p.height, 0, 1);
        const radiusScale = taper(t);
        
        // Find center of this ring? Hard to do cheaply. 
        // Simpler: Just rely on constant thickness or accept the uniform tube.
        // Let's stick to uniform 'thick' for robustness unless we use a custom mesh generator.
        // Actually, uniform branches print better.
    }
    
    // Scale the whole tube radius
    // TubeGeometry defaults to radius 1. We want 'thick'.
    // Actually the 3rd arg is radius.
    const sizedTube = new THREE.TubeGeometry(curve, Math.floor(pts.length * 1.5), thick, 8, false);
    geometries.push(sizedTube);
  });

  // D. Merge
  if (geometries.length === 0) return new THREE.BufferGeometry();
  const merged = mergeBufferGeometries(geometries, false); // useGroups=false for cleaner export
  merged.computeVertexNormals();

  return merged;
}

// --- 3. Schema & Defaults ---
function constrainParams(pIn) {
  const out = { ...pIn };
  out.height      = clamp(pIn.height ?? 200, 80, MAX_SIZE);
  out.topRadius   = clamp(pIn.topRadius ?? 90, 40, 120);
  
  // Coral specifics
  out.c_branches  = clamp(Math.floor(pIn.c_branches ?? 12), 3, 30);
  out.c_density   = clamp(Math.floor(pIn.c_density ?? 30), 10, 100); // Max total tips
  out.c_thickness = clamp(pIn.c_thickness ?? 2.5, 1.0, 6.0); // Tube radius (so 2x for diameter)
  out.c_wiggle    = clamp(pIn.c_wiggle ?? 5.0, 0, 15);
  
  return out;
}

function schemaFor(params) {
  return [
    { key: "height",      label: "Height",         type: "range", min: 80, max: 240, step: 1, group: "Shape" },
    { key: "topRadius",   label: "Spread Top",     type: "range", min: 40, max: 120, step: 1, group: "Shape" },
    
    { key: "c_branches",  label: "Base Stems",     type: "range", min: 3, max: 30, step: 1, group: "Coral" },
    { key: "c_thickness", label: "Branch Thick",   type: "range", min: 1, max: 5, step: 0.2, group: "Coral" },
    { key: "c_wiggle",    label: "Chaos",          type: "range", min: 0, max: 15, step: 0.5, group: "Coral" },
    { key: "c_density",   label: "Max Density",    type: "range", min: 10, max: 80, step: 1, group: "Coral", advanced: true },
    
    // Texture doesn't apply well to tubes (UVs are messy), so we might hide it or keep it simple
    { key: "texture", label: "Style", type: "select", options: textureOptions, group: "Texture" }
  ];
}

export const models = {
  coral: {
    label: "Branching Coral",
    schema: schemaFor,
    defaults: () => ({
      height: 200,
      topRadius: 90,
      c_branches: 12,
      c_thickness: 2.0,
      c_wiggle: 5.0,
      texture: "none"
    }),
    build: buildCoral
  }
};

function exportSTL(params) {
  import("three-stdlib").then(({ STLExporter }) => {
    const geom = buildCoral(params);
    const exporter = new STLExporter();
    const data = exporter.parse(geom, { binary: true });
    const blob = new Blob([data], { type: "application/sla" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lampshade_coral.stl";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

export default { label: "Lampshade, Coral", models, export: exportSTL };
