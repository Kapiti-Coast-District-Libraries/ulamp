// src/designer/GeometryBuilder.js
import * as THREE from "three";
import { mergeBufferGeometries } from "three-stdlib";

/**
 * Creates a watertight cylindrical grid optimized for displacement.
 * - Welds the seam (0° and 360° share the same Vertex Index).
 * - Distributes vertical rings evenly to avoid "stretched" triangles.
 */
export function buildWatertightCylinder({
  height = 200,
  radialSegments = 120,
  resolution = 200, // Vertical segments
  radiusFunction = (t) => 50, // Default cylinder
  bottomThickness = 3,
  holeRadius = 40
}) {
  // 1. Buffers
  // We need (resolution + 1) rings
  // We need (radialSegments) columns. 
  // NOTE: For a watertight mesh, the last column wraps to the FIRST index.
  
  const numRings = resolution + 1;
  const numCols = radialSegments; 
  const vertexCount = numRings * numCols;
  
  const positions = new Float32Array(vertexCount * 3);
  const indices = [];

  // 2. Generate Vertices
  for (let yStep = 0; yStep < numRings; yStep++) {
    const t = yStep / resolution; // 0.0 to 1.0
    const y = t * height;
    
    // Get base radius from the Shape Function
    const r = radiusFunction(t);

    for (let col = 0; col < numCols; col++) {
      const theta = (col / numCols) * Math.PI * 2;
      
      const px = r * Math.cos(theta);
      const pz = r * Math.sin(theta);
      
      const i = (yStep * numCols) + col;
      
      positions[i * 3 + 0] = px;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = pz;
    }
  }

  // 3. Generate Indices (Topology)
  // This creates the "Watertight" bond. 
  // We connect column (N-1) back to column (0).
  for (let yStep = 0; yStep < resolution; yStep++) {
    for (let col = 0; col < numCols; col++) {
      const nextCol = (col + 1) % numCols; // WRAP AROUND (Weld)
      
      const currentRing = yStep * numCols;
      const nextRing = (yStep + 1) * numCols;

      const a = currentRing + col;
      const b = nextRing + col;
      const c = nextRing + nextCol;
      const d = currentRing + nextCol;

      // Two triangles: ABC and ACD
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  // 4. Build Geometry
  const shellGeo = new THREE.BufferGeometry();
  shellGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  shellGeo.setIndex(indices);

  // 5. Build Bottom Cap (Solid Slab with Hole)
  // We create a separate geometry for the base and merge it safely.
  const baseGeo = createSolidBase(holeRadius, radiusFunction(0), bottomThickness, radialSegments);

  // 6. Merge Safely
  // FIX: Use mergeBufferGeometries to avoid stack overflow on large arrays
  const merged = mergeBufferGeometries([shellGeo, baseGeo], false);

  // Clean up intermediate geometries to free memory
  shellGeo.dispose();
  baseGeo.dispose();

  // 7. Final Polish
  merged.computeVertexNormals();
  return merged;
}

/**
 * Creates a standalone geometry for the solid base slab.
 */
function createSolidBase(rInner, rOuter, thick, segments) {
  const verts = [];
  const idx = [];
  
  // We need 4 rings: 
  // 0: Inner Floor (y=0)
  // 1: Outer Floor (y=0)
  // 2: Outer Ceiling (y=thick)
  // 3: Inner Ceiling (y=thick)
  
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    
    // Ring 0: Inner Bottom
    verts.push(rInner * c, 0, rInner * s);
    // Ring 1: Outer Bottom
    verts.push(rOuter * c, 0, rOuter * s);
    // Ring 2: Outer Top
    verts.push(rOuter * c, thick, rOuter * s);
    // Ring 3: Inner Top
    verts.push(rInner * c, thick, rInner * s);
  }
  
  // Faces
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    const base = i * 4;
    const nextBase = next * 4;
    
    // Floor (0 -> 1)
    idx.push(base + 0, nextBase + 1, base + 1);
    idx.push(base + 0, nextBase + 0, nextBase + 1);
    
    // Outer Wall (1 -> 2)
    idx.push(base + 1, nextBase + 2, base + 2);
    idx.push(base + 1, nextBase + 1, nextBase + 2);
    
    // Ceiling (2 -> 3)
    idx.push(base + 2, nextBase + 3, base + 3);
    idx.push(base + 2, nextBase + 2, nextBase + 3);
    
    // Inner Wall (3 -> 0)
    idx.push(base + 3, nextBase + 0, base + 0);
    idx.push(base + 3, nextBase + 3, nextBase + 0);
  }
  
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  return geo;
}
