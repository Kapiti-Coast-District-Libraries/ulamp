// src/utils/patchExporter.js
import * as THREE from "three";
import { STLExporter } from "three-stdlib";

// --- CONFIGURATION ---
const MIN_THICKNESS_MM = 0.9; // The absolute minimum physical wall thickness
const DEBUG_LOGS = true;

/**
 * Automatically finds Inner/Outer wall pairs by analyzing the 2D Lathe profile.
 * It groups points by their Height (Y).
 */
function findWallPairs(geometry) {
  // LatheGeometry stores the original 2D profile in parameters.points
  const pts = geometry.parameters?.points; 
  if (!pts || pts.length < 2) return [];

  // Key: Y-height (rounded), Value: [ProfileIndex, ProfileIndex...]
  const yMap = new Map();
  const pairs = [];

  for (let i = 0; i < pts.length; i++) {
    // Round Y to avoid floating point mismatch
    const y = Math.round(pts[i].y * 1000) / 1000;
    
    if (!yMap.has(y)) {
      yMap.set(y, [i]);
    } else {
      const candidates = yMap.get(y);
      // We found another point at the exact same height!
      // This usually means one is on the Outer Wall and one is on the Inner Wall.
      for (const otherIdx of candidates) {
        const r1 = pts[i].x;
        const r2 = pts[otherIdx].x;
        
        // Ensure they aren't the exact same point (hole closure)
        if (Math.abs(r1 - r2) > 0.1) {
          // The point with the larger Radius is Outer
          const idxOuter = r1 > r2 ? i : otherIdx;
          const idxInner = r1 > r2 ? otherIdx : i;
          pairs.push([idxOuter, idxInner]);
        }
      }
      candidates.push(i);
    }
  }
  return pairs;
}

/**
 * The Safety Logic:
 * Checks every vertex pair. If the perpendicular wall thickness is too low,
 * it pushes the Inner Vertex inward to satisfy the minimum.
 */
function enforceThickness(mesh) {
  if (!mesh.geometry || mesh.geometry.type !== 'LatheGeometry') return;

  const geom = mesh.geometry;
  const positions = geom.attributes.position;
  const normals = geom.attributes.normal;
  const count = positions.count;
  const segments = geom.parameters.segments; // Radial segments
  
  // 1. Identify pairs based on the 2D profile (Auto-detection)
  const pairs = findWallPairs(geom);
  if (pairs.length === 0) return;

  if (DEBUG_LOGS) console.log(`[SafetyGuard] Analyzing ${pairs.length} profile rings for angles...`);

  const ptsPerSlice = count / (segments + 1);
  let fixedCount = 0;

  // 2. Iterate over every single slice of the lamp
  for (let s = 0; s <= segments; s++) {
    const sliceOffset = Math.floor(s * ptsPerSlice);

    for (const [pOut, pIn] of pairs) {
      const idxOut = sliceOffset + pOut;
      const idxIn  = sliceOffset + pIn;

      if (idxOut >= count || idxIn >= count) continue;

      // Get Positions
      const ox = positions.getX(idxOut);
      const oy = positions.getY(idxOut);
      const oz = positions.getZ(idxOut);

      const ix = positions.getX(idxIn);
      // iy usually equals oy, so we ignore Y diffs
      const iz = positions.getZ(idxIn);

      // Get Surface Normal at Outer Wall
      // (nx, ny, nz) tells us the angle of the wall
      const nx = normals.getX(idxOut);
      const nz = normals.getZ(idxOut);

      // 3. Calculate "Horizontal Normal Strength"
      // If wall is vertical, horizNormalLen is 1.0. 
      // If wall is 45deg sloped, horizNormalLen is ~0.707.
      const horizNormalLen = Math.hypot(nx, nz);

      // 4. Calculate Required Horizontal Gap
      // "To get 0.9mm perpendicular thickness, how far apart must they be horizontally?"
      // Formula: Required = MinThick / cos(angle)
      const safeGap = MIN_THICKNESS_MM / Math.max(0.1, horizNormalLen);

      // 5. Measure Current Horizontal Gap
      const dx = ox - ix;
      const dz = oz - iz;
      const currentGap = Math.sqrt(dx*dx + dz*dz);

      // 6. Fix if too thin
      if (currentGap < safeGap && currentGap > 0.001) {
        
        // We need to push the Inner Vertex further inward.
        // Direction: From Outer towards Inner (center)
        const vX = ix - ox;
        const vZ = iz - oz;
        const len = Math.sqrt(vX*vX + vZ*vZ);
        
        // Normalize direction
        const dirX = vX / len;
        const dirZ = vZ / len;

        // New Position = OuterPos + (Direction * SafeGap)
        const newIX = ox + dirX * safeGap;
        const newIZ = oz + dirZ * safeGap;

        positions.setX(idxIn, newIX);
        positions.setZ(idxIn, newIZ);
        fixedCount++;
      }
    }
  }

  if (fixedCount > 0) {
    if (DEBUG_LOGS) console.log(`[SafetyGuard] Repaired ${fixedCount} vertices. Minimum wall ensured.`);
    positions.needsUpdate = true;
    geom.computeVertexNormals(); // Recompute normals after modification
  }
}

// --- THE PATCH ---
// Overwrite STLExporter.parse to run our check first
const originalParse = STLExporter.prototype.parse;

STLExporter.prototype.parse = function (scene, options) {
  console.log("[SafetyGuard] Intercepting Export for Thickness Check...");
  
  const traverseAndFix = (obj) => {
    if (obj.isMesh) enforceThickness(obj);
    if (obj.children) obj.children.forEach(traverseAndFix);
  };
  traverseAndFix(scene);

  return originalParse.call(this, scene, options);
};
