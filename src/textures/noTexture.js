// src/textures/noTexture.js
import * as THREE from "three";

// no-op texture, leaves geometry unchanged
function apply(geometry /*, p */) {
  // Make sure normals exist, but do not modify geometry
  if (geometry && geometry.attributes && geometry.attributes.normal == null) {
    geometry.computeVertexNormals();
  }
  return geometry;
}

export default {
  id: "noTexture",
  label: "No texture",
  defaults: {},
  schema: [],
  headroom: () => 0,
  apply,
};
