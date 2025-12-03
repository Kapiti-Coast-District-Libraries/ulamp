// src/designer/GeometryBuilder.js
import * as THREE from "three";
import { mergeBufferGeometries } from "three-stdlib";

/**
 * Creates a watertight solid cylinder with physical wall thickness.
 * Generates Outer Shell, Inner Shell, Rims, and Base Plug.
 */
export function buildWatertightCylinder({
  height = 200,
  radialSegments = 120,
  resolution = 200,
  radiusFunction = (t) => 50,
  bottomThickness = 3,
  holeRadius = 40,
  wallThickness = 0 // If 0, generates a single surface (Vase Mode)
}) {
  const isSolid = wallThickness > 0;
  
  // 1. Generate the Main Cylinder (Wall)
  // If solid, this includes Outer + Inner walls + Top/Bottom Rims
  const wallGeo = buildWallGeometry({
    height, radialSegments, resolution, radiusFunction, wallThickness, isSolid
  });

  // 2. Generate the Base Plug
  // This fills the hole at the bottom.
  // If solid, it fills from Hole -> Inner Wall.
  // If surface, it fills from Hole -> Outer Wall.
  const baseOuterR = radiusFunction(0) - (isSolid ? wallThickness : 0);
  
  // Safety: Ensure plug doesn't invert if wall is huge
  const safeBaseOuterR = Math.max(holeRadius + 0.1, baseOuterR);
  
  const baseGeo = createSolidBase(holeRadius, safeBaseOuterR, bottomThickness, radialSegments);

  // 3. Merge Wall and Base
  const merged = mergeBufferGeometries([wallGeo, baseGeo], false);

  // Clean up
  wallGeo.dispose();
  baseGeo.dispose();

  merged.computeVertexNormals();
  return merged;
}

function buildWallGeometry({ height, radialSegments, resolution, radiusFunction, wallThickness, isSolid }) {
  const numRings = resolution + 1;
  const numCols = radialSegments;
  
  // If solid, we need 2x vertices (Outer + Inner)
  const numVerts = isSolid ? (numRings * numCols * 2) : (numRings * numCols);
  
  const positions = new Float32Array(numVerts * 3);
  const indices = [];

  // --- VERTICES ---
  for (let yStep = 0; yStep < numRings; yStep++) {
    const t = yStep / resolution;
    const y = t * height;
    const rOuter = radiusFunction(t);
    const rInner = rOuter - wallThickness;

    for (let col = 0; col < numCols; col++) {
      const theta = (col / numCols) * Math.PI * 2;
      const c = Math.cos(theta);
      const s = Math.sin(theta);

      // Index for Outer Vertex
      const iOuter = (yStep * numCols) + col;
      
      // Set Outer
      positions[iOuter * 3 + 0] = rOuter * c;
      positions[iOuter * 3 + 1] = y;
      positions[iOuter * 3 + 2] = rOuter * s;

      if (isSolid) {
        // Index for Inner Vertex (offset by total outer verts)
        const iInner = iOuter + (numRings * numCols);
        
        // Set Inner
        positions[iInner * 3 + 0] = rInner * c;
        positions[iInner * 3 + 1] = y;
        positions[iInner * 3 + 2] = rInner * s;
      }
    }
  }

  // --- INDICES ---
  const ringStride = numCols;
  const layerOffset = numRings * numCols; // Jump to Inner Layer

  for (let yStep = 0; yStep < resolution; yStep++) {
    for (let col = 0; col < numCols; col++) {
      const nextCol = (col + 1) % numCols;
      
      const currentRing = yStep * ringStride;
      const nextRing = (yStep + 1) * ringStride;

      // Outer Face Indices
      const a = currentRing + col;
      const b = nextRing + col;
      const c = nextRing + nextCol;
      const d = currentRing + nextCol;

      // Outer Wall (CCW)
      indices.push(a, b, d);
      indices.push(b, c, d);

      if (isSolid) {
        // Inner Face Indices (Shifted by layerOffset)
        const ai = a + layerOffset;
        const bi = b + layerOffset;
        const ci = c + layerOffset;
        const di = d + layerOffset;

        // Inner Wall (CW - Facing Inward)
        indices.push(ai, di, bi);
        indices.push(bi, di, ci);
      }
    }
  }

  // --- RIMS (Closing the Solid) ---
  if (isSolid) {
    // Top Rim (Connect Outer Top to Inner Top)
    const topOuterStart = (resolution) * ringStride;
    const topInnerStart = topOuterStart + layerOffset;
    
    // Bottom Rim (Connect Outer Bottom to Inner Bottom)
    // Note: The Base Plug connects to the Inner Bottom, 
    // but we need to close the annulus of the wall itself at y=0.
    const botOuterStart = 0;
    const botInnerStart = layerOffset;

    for (let col = 0; col < numCols; col++) {
      const nextCol = (col + 1) % numCols;

      // Top Rim
      {
        const ao = topOuterStart + col;
        const bo = topOuterStart + nextCol;
        const ai = topInnerStart + col;
        const bi = topInnerStart + nextCol;
        // Face Up
        indices.push(ao, bo, ai);
        indices.push(bo, bi, ai);
      }

      // Bottom Rim
      {
        const ao = botOuterStart + col;
        const bo = botOuterStart + nextCol;
        const ai = botInnerStart + col;
        const bi = botInnerStart + nextCol;
        // Face Down (Reversed)
        indices.push(ao, ai, bo);
        indices.push(bo, ai, bi);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * Creates a standalone geometry for the solid base plug.
 */
function createSolidBase(rInner, rOuter, thick, segments) {
  const verts = [];
  const idx = [];
  
  // 4 Rings: InnerBottom, OuterBottom, OuterTop, InnerTop
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    
    verts.push(rInner * c, 0, rInner * s);     // 0
    verts.push(rOuter * c, 0, rOuter * s);     // 1
    verts.push(rOuter * c, thick, rOuter * s); // 2
    verts.push(rInner * c, thick, rInner * s); // 3
  }
  
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    const base = i * 4;
    const nextBase = next * 4;
    
    // Bottom
    idx.push(base + 0, nextBase + 1, base + 1);
    idx.push(base + 0, nextBase + 0, nextBase + 1);
    
    // Outer Side
    idx.push(base + 1, nextBase + 2, base + 2);
    idx.push(base + 1, nextBase + 1, nextBase + 2);
    
    // Top
    idx.push(base + 2, nextBase + 3, base + 3);
    idx.push(base + 2, nextBase + 2, nextBase + 3);
    
    // Inner Side
    idx.push(base + 3, nextBase + 0, base + 0);
    idx.push(base + 3, nextBase + 3, nextBase + 0);
  }
  
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  return geo;
}
