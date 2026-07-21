// src/designer/GeometryBuilder.js
import * as THREE from "three";
import { mergeBufferGeometries } from "three-stdlib";

const FIXED_HOLE_RADIUS = 40; // 80mm diameter mounting hole for base_insert.stl
const BOTTOM_THICKNESS = 3;   // Bottom mounting flange thickness (mm)

/**
 * Builds an embossed cylindrical tube shade that mounts cleanly onto the uLamp threaded base.
 */
export function buildEmbossedCylinderLamp(params = {}) {
  const height = params.height ?? 180;
  const radius = params.radius ?? 50;
  const wallThickness = params.wallThickness ?? 2.0;
  const embossDepth = params.embossDepth ?? 2.5;
  const radialSegments = params.radialSegments ?? 200;
  const resolution = params.resolution ?? 200;
  const heightmapData = params.heightmapData ?? null;
  const invert = !!params.invert;
  const repeatX = params.repeatX ?? 1;

  // 1. Generate Wall Geometry (Outer wall with heightmap displacement + Inner smooth wall)
  const wallGeo = buildDisplacedWallGeometry({
    height,
    radius,
    wallThickness,
    embossDepth,
    radialSegments,
    resolution,
    heightmapData,
    invert,
    repeatX
  });

  // 2. Generate Solid Base Flange (Mounting hole for base_insert.stl)
  const innerRadiusAtBottom = Math.max(FIXED_HOLE_RADIUS + 0.5, radius - wallThickness);
  const baseGeo = createMountingBase(FIXED_HOLE_RADIUS, innerRadiusAtBottom, BOTTOM_THICKNESS, radialSegments);

  // 3. Merge wall and base into a single solid 3D printable mesh
  const merged = mergeBufferGeometries([wallGeo, baseGeo], false);

  wallGeo.dispose();
  baseGeo.dispose();

  merged.computeVertexNormals();
  return merged;
}

function buildDisplacedWallGeometry({
  height,
  radius,
  wallThickness,
  embossDepth,
  radialSegments,
  resolution,
  heightmapData,
  invert,
  repeatX
}) {
  const numRings = resolution + 1;
  const numCols = radialSegments;
  const numVerts = numRings * numCols * 2; // Outer + Inner vertices

  const positions = new Float32Array(numVerts * 3);
  const indices = [];

  const rOuterBase = radius;
  const rInnerBase = Math.max(10, radius - wallThickness);

  // Read image pixel array if heightmap exists
  let pixels = null;
  let imgW = 0;
  let imgH = 0;
  if (heightmapData && heightmapData.data) {
    pixels = heightmapData.data.data;
    imgW = heightmapData.width;
    imgH = heightmapData.height;
  }

  // --- VERTICES ---
  for (let yStep = 0; yStep < numRings; yStep++) {
    const v = yStep / resolution;
    const y = v * height;

    for (let col = 0; col < numCols; col++) {
      const uRaw = (col / numCols) * repeatX;
      const u = uRaw - Math.floor(uRaw); // Wrap 0..1

      const theta = (col / numCols) * Math.PI * 2;
      const c = Math.cos(theta);
      const s = Math.sin(theta);

      // Pixel brightness lookup
      let brightness = 0;
      if (pixels && imgW > 0 && imgH > 0) {
        const px = Math.floor(u * (imgW - 1));
        const py = Math.floor((1 - v) * (imgH - 1));
        const idx = (py * imgW + px) * 4;

        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        brightness = (r + g + b) / (3 * 255.0);

        if (invert) brightness = 1.0 - brightness;
      }

      // Displace Outer Radius
      const rOuter = rOuterBase + brightness * embossDepth;
      const iOuter = yStep * numCols + col;

      positions[iOuter * 3 + 0] = rOuter * c;
      positions[iOuter * 3 + 1] = y;
      positions[iOuter * 3 + 2] = rOuter * s;

      // Inner Smooth Vertex
      const iInner = iOuter + numRings * numCols;
      positions[iInner * 3 + 0] = rInnerBase * c;
      positions[iInner * 3 + 1] = y;
      positions[iInner * 3 + 2] = rInnerBase * s;
    }
  }

  // --- FACES (TRIANGLES) ---
  const ringStride = numCols;
  const layerOffset = numRings * numCols;

  for (let yStep = 0; yStep < resolution; yStep++) {
    for (let col = 0; col < numCols; col++) {
      const nextCol = (col + 1) % numCols;

      const currentRing = yStep * ringStride;
      const nextRing = (yStep + 1) * ringStride;

      const a = currentRing + col;
      const b = nextRing + col;
      const c = nextRing + nextCol;
      const d = currentRing + nextCol;

      // Outer Wall (CCW facing out)
      indices.push(a, b, d);
      indices.push(b, c, d);

      // Inner Wall (CW facing in)
      const ai = a + layerOffset;
      const bi = b + layerOffset;
      const ci = c + layerOffset;
      const di = d + layerOffset;

      indices.push(ai, di, bi);
      indices.push(bi, di, ci);
    }
  }

  // --- TOP & BOTTOM RIMS ---
  const topOuterStart = resolution * ringStride;
  const topInnerStart = topOuterStart + layerOffset;
  const botOuterStart = 0;
  const botInnerStart = layerOffset;

  for (let col = 0; col < numCols; col++) {
    const nextCol = (col + 1) % numCols;

    // Top Rim
    const ao = topOuterStart + col;
    const bo = topOuterStart + nextCol;
    const ai = topInnerStart + col;
    const bi = topInnerStart + nextCol;
    indices.push(ao, bo, ai);
    indices.push(bo, bi, ai);

    // Bottom Rim
    const bao = botOuterStart + col;
    const bbo = botOuterStart + nextCol;
    const bai = botInnerStart + col;
    const bbi = botInnerStart + nextCol;
    indices.push(bao, bai, bbo);
    indices.push(bbo, bai, bbi);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * Creates the mounting plate at the bottom with a center hole for base_insert.stl
 */
function createMountingBase(rInner, rOuter, thick, segments) {
  const verts = [];
  const idx = [];

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
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  return geo;
}
