// src/utils/patchExporter.js
import * as THREE from "three";
import { STLExporter } from "three-stdlib";

// --- CONFIGURATION ---
const MIN_THICKNESS_MM = 0.9;
const DEBUG_LOGS = true;

/**
 * PAIRING LOGIC:
 * Matches Outer vertices to Inner vertices based on the original Lathe profile.
 * Even if the 3D shape is twisted, these indices remain physically linked.
 */
function findWallPairs(geometry) {
  const pts = geometry.parameters?.points;
  if (!pts || pts.length < 2) return [];

  // Group profile points by their exact Y height (rounded to avoid float errors)
  const yMap = new Map();
  for (let i = 0; i < pts.length; i++) {
    const y = Math.round(pts[i].y * 10000) / 10000;
    if (!yMap.has(y)) yMap.set(y, []);
    yMap.get(y).push(i);
  }

  const pairs = [];
  for (const [y, indices] of yMap.entries()) {
    if (indices.length >= 2) {
      // We expect 2 points at this height: Inner and Outer.
      // The one with the larger Radius (x) is Outer.
      const iA = indices[0];
      const iB = indices[1];
      const rA = pts[iA].x;
      const rB = pts[iB].x;

      // Ignore if they are the exact same point (hole closure)
      if (Math.abs(rA - rB) < 0.01) continue;

      const idxOuter = rA > rB ? iA : iB;
      const idxInner = rA > rB ? iB : iA;
      pairs.push([idxOuter, idxInner]);
    }
  }
  return pairs;
}

/**
 * THICKNESS ENFORCEMENT (3D NORMAL PROJECTION):
 * 1. Calculates the Surface Normal at the Outer vertex.
 * 2. Projects a "Safe Inner Position" 0.9mm inward along that normal.
 * 3. If the actual Inner vertex is closer than that, it snaps it to the Safe Position.
 */
function enforceThickness(mesh) {
  if (!mesh.geometry || mesh.geometry.type !== 'LatheGeometry') return;

  const geom = mesh.geometry;
  const posAttr = geom.attributes.position;
  const normAttr = geom.attributes.normal;
  const count = posAttr.count;
  const segments = geom.parameters.segments; 
  
  const pairs = findWallPairs(geom);
  if (pairs.length === 0) return;

  if (DEBUG_LOGS) console.log(`[SafetyGuard] Checking 3D thickness on ${pairs.length} profile rings...`);

  // LatheGeometry layout: (segments + 1) vertical slices
  const ptsPerSlice = count / (segments + 1);
  let fixedCount = 0;

  // Temporary vectors
  const outerPos = new THREE.Vector3();
  const innerPos = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const targetPos = new THREE.Vector3();

  for (let s = 0; s <= segments; s++) {
    const sliceOffset = Math.floor(s * ptsPerSlice);

    for (const [pOut, pIn] of pairs) {
      const idxOut = sliceOffset + pOut;
      const idxIn  = sliceOffset + pIn;

      if (idxOut >= count || idxIn >= count) continue;

      // 1. Get Outer Position & Normal
      outerPos.fromBufferAttribute(posAttr, idxOut);
      normal.fromBufferAttribute(normAttr, idxOut); // Unit vector facing OUT

      // 2. Get Inner Position
      innerPos.fromBufferAttribute(posAttr, idxIn);

      // 3. Calculate "Safe" Inner Position
      // Move 0.9mm INWARD (opposite to normal)
      targetPos.copy(outerPos).addScaledVector(normal, -MIN_THICKNESS_MM);

      // 4. Measure Actual Distance
      const currentDist = outerPos.distanceTo(innerPos);

      // 5. Measure "Projected" Distance (How far 'behind' the outer wall is it?)
      // We project the vector (Inner - Outer) onto the Normal.
      // A valid wall has a projection <= -0.9. 
      const vecToInner = new THREE.Vector3().subVectors(innerPos, outerPos);
      const depth = vecToInner.dot(normal); // Should be negative

      // Check: Is the thickness insufficient?
      // We check if the vertex is physically too close (-depth < 0.9)
      if (-depth < MIN_THICKNESS_MM) {
        
        // FIX: Force the inner vertex to the target position
        // This sets the wall thickness to exactly 0.9mm at this spot.
        posAttr.setXYZ(idxIn, targetPos.x, targetPos.y, targetPos.z);
        fixedCount++;
      }
    }
  }

  if (fixedCount > 0) {
    if (DEBUG_LOGS) console.log(`[SafetyGuard] 🛡️ Repaired ${fixedCount} thin spots using Normal Projection.`);
    posAttr.needsUpdate = true;
    geom.computeVertexNormals(); // Recalculate normals so the STL looks correct
  } else {
    if (DEBUG_LOGS) console.log(`[SafetyGuard] ✅ Model passed thickness check.`);
  }
}

// --- MONKEY PATCH ---
// This hooks into the export process globally.
const originalParse = STLExporter.prototype.parse;

STLExporter.prototype.parse = function (scene, options) {
  if (DEBUG_LOGS) console.log("[SafetyGuard] Intercepting Export...");

  // Recursively fix all meshes in the scene
  scene.traverse((obj) => {
    if (obj.isMesh) enforceThickness(obj);
  });

  // Run the original exporter
  return originalParse.call(this, scene, options);
};
