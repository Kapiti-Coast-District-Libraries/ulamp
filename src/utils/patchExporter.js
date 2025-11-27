// src/utils/patchExporter.js
import * as THREE from "three";
import { STLExporter } from "three-stdlib";

// --- CONFIGURATION ---
const MIN_THICKNESS_MM = 0.9;
const DEBUG_LOGS = true;

/**
 * PAIRING LOGIC: Finds Inner/Outer vertex pairs by Y-height.
 */
function findWallPairs(geometry) {
  const pts = geometry.parameters?.points;
  if (!pts || pts.length < 2) return [];

  const yMap = new Map();
  // Group profile points by height
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
      const rA = pts[iA].x;
      const rB = pts[iB].x;

      if (Math.abs(rA - rB) < 0.01) continue; // Ignore pinch-off points

      // Larger radius = Outer
      const idxOuter = rA > rB ? iA : iB;
      const idxInner = rA > rB ? iB : iA;
      pairs.push([idxOuter, idxInner]);
    }
  }
  return pairs;
}

/**
 * THICKNESS ENFORCEMENT:
 * Takes a GEOMETRY (not Mesh) and fixes thin walls.
 */
function enforceThickness(geom) {
  if (!geom || geom.type !== 'LatheGeometry') return;

  const posAttr = geom.attributes.position;
  const normAttr = geom.attributes.normal;
  const count = posAttr.count;
  const segments = geom.parameters.segments; 
  
  const pairs = findWallPairs(geom);
  if (pairs.length === 0) return;

  if (DEBUG_LOGS) console.log(`[SafetyGuard] Checking 3D thickness on ${pairs.length} profile rings...`);

  const ptsPerSlice = count / (segments + 1);
  let fixedCount = 0;

  // Temp vectors
  const outerPos = new THREE.Vector3();
  const innerPos = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const targetPos = new THREE.Vector3();
  const vecToInner = new THREE.Vector3();

  for (let s = 0; s <= segments; s++) {
    const sliceOffset = Math.floor(s * ptsPerSlice);

    for (const [pOut, pIn] of pairs) {
      const idxOut = sliceOffset + pOut;
      const idxIn  = sliceOffset + pIn;

      if (idxOut >= count || idxIn >= count) continue;

      // 1. Get Positions & Normal
      outerPos.fromBufferAttribute(posAttr, idxOut);
      innerPos.fromBufferAttribute(posAttr, idxIn);
      normal.fromBufferAttribute(normAttr, idxOut); 

      // 2. Project vector (Inner - Outer) onto Normal
      // This gives the perpendicular "depth" of the inner wall behind the outer wall.
      vecToInner.subVectors(innerPos, outerPos);
      const depth = vecToInner.dot(normal); // Should be negative

      // 3. Check Depth
      // We want depth to be at least -0.9 (e.g. -1.0, -2.0 is safe).
      // If depth is > -0.9 (e.g. -0.5), it's too thin.
      if (-depth < MIN_THICKNESS_MM) {
        
        // 4. FIX: Force inner vertex to exactly MIN_THICKNESS_MM away
        // Target = Outer + (Normal * -0.9)
        targetPos.copy(outerPos).addScaledVector(normal, -MIN_THICKNESS_MM);

        posAttr.setXYZ(idxIn, targetPos.x, targetPos.y, targetPos.z);
        fixedCount++;
      }
    }
  }

  if (fixedCount > 0) {
    if (DEBUG_LOGS) console.log(`[SafetyGuard] 🛡️ Repaired ${fixedCount} thin spots.`);
    posAttr.needsUpdate = true;
    geom.computeVertexNormals();
  }
}

// --- MONKEY PATCH ---
const originalParse = STLExporter.prototype.parse;

STLExporter.prototype.parse = function (input, options) {
  if (DEBUG_LOGS) console.log("[SafetyGuard] Intercepting Export...", input);

  // Handle both Mesh (scene graph) and direct BufferGeometry inputs
  if (input.isBufferGeometry) {
    enforceThickness(input);
  } else if (input.traverse) {
    input.traverse((obj) => {
      if (obj.isMesh) enforceThickness(obj.geometry);
    });
  }

  return originalParse.call(this, input, options);
};

console.log("[SafetyGuard] Patcher Loaded & Ready");
