// src/designer/GeometryBuilder.js
import * as THREE from 'three';

export function buildEmbossedCylinder({
  radius = 40,
  height = 120,
  wallThickness = 2,
  embossDepth = 2.0,      // Positive = emboss (outward), Negative = engrave (inward)
  radialSegments = 200,   // High resolution for clean 3D printing
  heightSegments = 200,
  heightmapData = null,   // From imageProcessor
  invert = false,
  repeatX = 1             // How many times image wraps around cylinder
}) {
  // 1. Create base cylinder geometry
  const geometry = new THREE.CylinderGeometry(
    radius,
    radius,
    height,
    radialSegments,
    heightSegments,
    true // open-ended cylinder
  );

  const pos = geometry.attributes.position;
  const uvs = geometry.attributes.uv;

  // 2. Displace outer wall vertices using pixel brightness
  if (heightmapData) {
    const { data, width, height: imgHeight } = heightmapData;
    const pixels = data.data;

    for (let i = 0; i < pos.count; i++) {
      let u = uvs.getX(i) * repeatX;
      u = u - Math.floor(u); // Wrap UVs between 0 and 1
      const v = uvs.getY(i);

      const x = pos.getX(i);
      const z = pos.getZ(i);

      const angle = Math.atan2(z, x);
      const currentRadius = Math.sqrt(x * x + z * z);

      // Map UVs to pixel coordinates
      const px = Math.floor(u * (width - 1));
      const py = Math.floor((1 - v) * (imgHeight - 1));
      const pixelIdx = (py * width + px) * 4;

      // Extract RGB & calculate normalized brightness (0.0 to 1.0)
      const r = pixels[pixelIdx];
      const g = pixels[pixelIdx + 1];
      const b = pixels[pixelIdx + 2];
      let brightness = (r + g + b) / (3 * 255);

      if (invert) brightness = 1 - brightness;

      // Apply radial displacement
      const displacedRadius = currentRadius + (brightness * embossDepth);
      pos.setX(i, Math.cos(angle) * displacedRadius);
      pos.setZ(i, Math.sin(angle) * displacedRadius);
    }

    geometry.computeVertexNormals();
  }

  // 3. Position the cylinder above the base thread mount
  geometry.translate(0, height / 2, 0);

  return geometry;
}
