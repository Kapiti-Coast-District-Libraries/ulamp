// src/designer/GeometryBuilder.js
import * as THREE from 'three';

/**
 * Builds an embossed cylindrical lamp shade designed to mount onto the uLamp threaded base.
 */
export function buildEmbossedLampGeometry({
  radius = 40,            // Base cylinder outer radius (mm)
  height = 130,           // Lamp tube height (mm)
  wallThickness = 2.5,    // Shell thickness (mm)
  embossDepth = 2.0,      // Depth of embossing (+ for outward, - for engrave)
  radialSegments = 200,   // Radial detail for smooth curves
  heightSegments = 200,   // Vertical detail for image resolution
  heightmapData = null,   // Heightmap object from imageProcessor
  invert = false,         // Invert light/dark areas
  repeatX = 1,            // Number of times image wraps around the tube
}) {
  // 1. Create Outer Cylinder (Embossed Wall)
  const outerGeo = new THREE.CylinderGeometry(
    radius,
    radius,
    height,
    radialSegments,
    heightSegments,
    true
  );

  const outerPos = outerGeo.attributes.position;
  const uvs = outerGeo.attributes.uv;

  // Apply image heightmap displacement to outer vertices
  if (heightmapData) {
    const { data, width, height: imgHeight } = heightmapData;
    const pixels = data.data;

    for (let i = 0; i < outerPos.count; i++) {
      let u = uvs.getX(i) * repeatX;
      u = u - Math.floor(u); // Keep U coordinate bounded between 0 and 1
      const v = uvs.getY(i);

      const x = outerPos.getX(i);
      const z = outerPos.getZ(i);

      const angle = Math.atan2(z, x);
      const currentRadius = Math.sqrt(x * x + z * z);

      // Map UVs to image pixel indices
      const px = Math.floor(u * (width - 1));
      const py = Math.floor((1 - v) * (imgHeight - 1));
      const pixelIdx = (py * width + px) * 4;

      // Calculate pixel brightness (0.0 to 1.0)
      const r = pixels[pixelIdx];
      const g = pixels[pixelIdx + 1];
      const b = pixels[pixelIdx + 2];
      let brightness = (r + g + b) / (3 * 255);

      if (invert) brightness = 1.0 - brightness;

      // Displace radius outward/inward
      const displacedRadius = currentRadius + (brightness * embossDepth);
      outerPos.setX(i, Math.cos(angle) * displacedRadius);
      outerPos.setZ(i, Math.sin(angle) * displacedRadius);
    }

    outerGeo.computeVertexNormals();
  }

  // 2. Create Inner Cylinder (Smooth Interior Wall)
  const innerRadius = Math.max(5, radius - wallThickness);
  const innerGeo = new THREE.CylinderGeometry(
    innerRadius,
    innerRadius,
    height,
    radialSegments,
    heightSegments,
    true
  );

  // Invert inner normals so lighting faces inward
  innerGeo.index.array.reverse();

  // 3. Create Top Rim Cap
  const topCapGeo = new THREE.RingGeometry(innerRadius, radius, radialSegments);
  topCapGeo.rotateX(-Math.PI / 2);
  topCapGeo.translate(0, height / 2, 0);

  // 4. Create Bottom Thread Mount Connection
  const bottomCapGeo = new THREE.RingGeometry(innerRadius, radius, radialSegments);
  bottomCapGeo.rotateX(Math.PI / 2);
  bottomCapGeo.translate(0, -height / 2, 0);

  // 5. Merge all meshes into a single printable solid manifold
  const mergedGeometry = THREE.BufferGeometryUtils 
    ? THREE.BufferGeometryUtils.mergeGeometries([outerGeo, innerGeo, topCapGeo, bottomCapGeo])
    : outerGeo; // Fallback if utility not imported

  // Center and raise above base plate
  mergedGeometry.translate(0, height / 2 + 10, 0);

  return mergedGeometry;
}
