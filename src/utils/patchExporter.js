// src/utils/patchExporter.js
import * as THREE from "three";
import { STLExporter } from "three-stdlib";

// --- CONFIGURATION ---
const MIN_THICKNESS_MM = 0.9;
const DEBUG_LOGS = true;

/**
 * Analyzes a LatheGeometry profile to find matching Outer/Inner vertex pairs.
 * We assume the profile goes: [Hole -> Base -> Outer Wall UP -> Rim -> Inner Wall DOWN -> Slab]
 */
function findWallPairs(geometry) {
  const pts = geometry.parameters.points; // The 2D profile
  if (!pts || pts.length < 2) return [];

  // 1. Bin points by Y coordinate to find matches
  // Key: Y (rounded to 2 decimal places), Value: Index in profile
  const yMap = new Map();
  const pairs = [];

  for (let i = 0; i < pts.length; i++) {
    const y = Math.round(pts[i].y * 100) / 100;
    
    if (!yMap.has(y)) {
      yMap.set(y, [i]);
    } else {
      const candidates = yMap.get(y);
      // We found a point at the same height!
      // Check if one is outer (larger X) and one is inner (smaller X)
      for (const otherIdx of candidates) {
        const r1 = pts[i].x;
        const r2 = pts[otherIdx].x;
        
        // Use a threshold to avoid pairing a point with itself or close noise
        if (Math.abs(r1 - r2) > 0.1) {
          // Identify Outer vs Inner
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
 * Iterates over the 3D mesh and pushes inner vertices away if too close to outer vertices.
 */
function enforceThickness(mesh) {
  if (!mesh.geometry || mesh.geometry.type !== 'LatheGeometry') return;

  const geom = mesh.geometry;
  const positions = geom.attributes.position;
  const count = positions.count;
  const segments = geom.parameters.segments; // Radial segments
  
  // 1. Identify which profile points define the wall thickness
  const pairs = findWallPairs(geom);
  if (pairs.length === 0) return;

  if (DEBUG_LOGS) console.log(`[SafetyGuard] Analyzing ${pairs.length} profile layers...`);

  // 2. Iterate over every radial slice of the lamp
  // LatheGeometry layout: (segments + 1) slices, each containing (points.length) vertices
  const ptsPerSlice = count / (segments + 1);

  let fixedCount = 0;

  for (let s = 0; s <= segments; s++) {
    const sliceOffset = Math.floor(s * ptsPerSlice);

    for (const [pOut, pIn] of pairs) {
      const idxOut = sliceOffset + pOut;
      const idxIn  = sliceOffset + pIn;

      if (idxOut >= count || idxIn >= count) continue;

      // Get 3D Coordinates
      const ox = positions.getX(idxOut);
      const oy = positions.getY(idxOut);
      const oz = positions.getZ(idxOut);

      const ix = positions.getX(idxIn);
      // iy should equal oy, so we ignore it
      const iz = positions.getZ(idxIn);

      // 3. Measure Horizontal Distance (Wall Thickness)
      const dx = ox - ix;
      const dz = oz - iz;
      const currentThick = Math.sqrt(dx*dx + dz*dz);

      // 4. Fix if too thin
      if (currentThick < MIN_THICKNESS_MM && currentThick > 0.001) {
        // Calculate required shift
        // Vector from Outer -> Inner
        const vX = ix - ox;
        const vZ = iz - oz;
        
        // Normalize
        const len = Math.sqrt(vX*vX + vZ*vZ);
        const nX = vX / len;
        const nZ = vZ / len;

        // New Position: Outer + (Normal * MinThickness)
        // We move INNER vertex, keeping outer vertex (surface detail) untouched.
        const newIX = ox + nX * MIN_THICKNESS_MM;
        const newIZ = oz + nZ * MIN_THICKNESS_MM;

        positions.setX(idxIn, newIX);
        positions.setZ(idxIn, newIZ);
        fixedCount++;
      }
    }
  }

  if (fixedCount > 0) {
    if (DEBUG_LOGS) console.log(`[SafetyGuard] Thickened ${fixedCount} vertices to ${MIN_THICKNESS_MM}mm.`);
    positions.needsUpdate = true;
    geom.computeVertexNormals();
  }
}

// --- THE PATCH ---
// We overwrite the 'parse' method of the STLExporter class.
// This affects ALL new instances of STLExporter created by ANY pack.

const originalParse = STLExporter.prototype.parse;

STLExporter.prototype.parse = function (scene, options) {
  if (DEBUG_LOGS) console.log("[SafetyGuard] Intercepting Export...");

  // Helper to traverse and fix any Mesh found in the export scene
  const traverseAndFix = (obj) => {
    if (obj.isMesh) {
      enforceThickness(obj);
    }
    if (obj.children) {
      obj.children.forEach(traverseAndFix);
    }
  };

  traverseAndFix(scene);

  // Call the original exporter with the fixed geometry
  return originalParse.call(this, scene, options);
};

console.log("[SafetyGuard] Export Patcher Loaded. All exports will be verified.");
