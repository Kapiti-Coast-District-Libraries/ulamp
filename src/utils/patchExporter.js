// src/utils/patchExporter.js
import * as THREE from "three";

// --- CONFIGURATION ---
const MIN_THICKNESS_MM = 0.9;
const DEBUG_LOGS = true;

/**
 * Helper: Find matching Inner/Outer vertices in a LatheGeometry.
 */
function findWallPairs(geometry) {
  // LatheGeometry stores its generation profile in parameters.points
  const pts = geometry.parameters?.points;
  if (!pts || pts.length < 2) return [];

  // Group by Height (Y)
  const yMap = new Map();
  for (let i = 0; i < pts.length; i++) {
    const y = Math.round(pts[i].y * 10000) / 10000;
    if (!yMap.has(y)) yMap.set(y, []);
    yMap.get(y).push(i);
  }

  const pairs = [];
  for (const [y, indices] of yMap.entries()) {
    if (indices.length >= 2) {
      const iA = indices[0];
      const iB = indices[1];
      // The point with larger X is the Outer wall
      const rA = pts[iA].x;
      const rB = pts[iB].x;
      
      // Ignore points that are too close (like the hole closure at the bottom)
      if (Math.abs(rA - rB) < 0.01) continue;

      const idxOuter = rA > rB ? iA : iB;
      const idxInner = rA > rB ? iB : iA;
      pairs.push([idxOuter, idxInner]);
    }
  }
  return pairs;
}

/**
 * THE SAFETY LOGIC
 * pushes inner vertices away from outer vertices if they are too close.
 */
function fixThickness(geom) {
  const posAttr = geom.attributes.position;
  const normAttr = geom.attributes.normal;
  const count = posAttr.count;
  const segments = geom.parameters.segments;
  
  const pairs = findWallPairs(geom);
  if (pairs.length === 0) return false;

  const ptsPerSlice = count / (segments + 1);
  let fixedCount = 0;

  const outerPos = new THREE.Vector3();
  const innerPos = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const vecToInner = new THREE.Vector3();
  const targetPos = new THREE.Vector3();

  for (let s = 0; s <= segments; s++) {
    const sliceOffset = Math.floor(s * ptsPerSlice);

    for (const [pOut, pIn] of pairs) {
      const idxOut = sliceOffset + pOut;
      const idxIn  = sliceOffset + pIn;

      if (idxOut >= count || idxIn >= count) continue;

      // Read positions & normal
      outerPos.fromBufferAttribute(posAttr, idxOut);
      innerPos.fromBufferAttribute(posAttr, idxIn);
      normal.fromBufferAttribute(normAttr, idxOut);

      // Project the Inner-Outer vector onto the Normal
      // This tells us the "Perpendicular Depth" of the wall
      vecToInner.subVectors(innerPos, outerPos);
      const depth = vecToInner.dot(normal); // Should be negative (behind face)

      // If depth is too shallow (e.g. -0.5mm instead of -0.9mm), FIX IT.
      // We check -depth < MIN because depth is negative.
      if (-depth < MIN_THICKNESS_MM) {
        
        // Calculate safe position: Start at Outer, go backwards along Normal
        targetPos.copy(outerPos).addScaledVector(normal, -MIN_THICKNESS_MM);

        // Update the Inner vertex
        posAttr.setXYZ(idxIn, targetPos.x, targetPos.y, targetPos.z);
        fixedCount++;
      }
    }
  }

  if (fixedCount > 0) {
    if (DEBUG_LOGS) console.log(`[SafetyGuard] 🛡️ Repaired ${fixedCount} vertices in LatheGeometry.`);
    posAttr.needsUpdate = true;
    return true; // We modified geometry
  }
  return false;
}

// --- THE INTERCEPTOR ---
// We hook into 'computeVertexNormals' because every pack calls this
// right before finishing (to ensure lighting is correct).

const originalCompute = THREE.BufferGeometry.prototype.computeVertexNormals;
let isFixing = false; // Flag to prevent infinite recursion

THREE.BufferGeometry.prototype.computeVertexNormals = function () {
  // 1. Run the normal computation first (so we have accurate angles)
  originalCompute.call(this);

  // 2. Only run safety logic on LatheGeometry (our lampshades)
  //    and prevent recursive loops.
  if (this.type === 'LatheGeometry' && !isFixing) {
    isFixing = true;
    try {
      const changed = fixThickness(this);
      
      // 3. If we moved vertices, we must re-calculate normals 
      //    so the lighting/STL looks correct.
      if (changed) {
        originalCompute.call(this);
      }
    } catch (e) {
      console.warn("[SafetyGuard] Error during thickness check:", e);
    } finally {
      isFixing = false;
    }
  }
};

console.log("[SafetyGuard] Geometry Interceptor Loaded. Thin walls will be auto-repaired.");
