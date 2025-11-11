// src/textures/faceted.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smooth01(u) {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * A simple 2D hash function.
 * Returns a consistent pseudo-random value (0.0 to 1.0)
 * for a given (x, y) integer pair.
 */
function hash2D(x, y) {
  // Using arbitrary large-ish prime-like numbers for mixing
  let n = x * 12.9898 + y * 78.233;
  n = Math.sin(n) * 43758.5453123;
  return n - Math.floor(n); // Return fractional part (0.0 to 1.0)
}

// Pre-allocate vectors for performance
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _radial = new THREE.Vector3();
const _facetNormal = new THREE.Vector3();

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  const h_facets = clamp(Math.floor(p.t_faceted_bands ?? 20), 3, 100); // Horizontal facet count
  const v_pitch = clamp(p.t_faceted_pitch ?? 15, 5, 50);  // Vertical facet height (mm)
  const depth = clamp(p.t_faceted_depth ?? 0.8, 0, 2.0); // Max displacement
  const variation = clamp(p.t_faceted_variation ?? 1.0, 0, 1.0); // 0 = uniform, 1 = random
  const fadeMM = clamp(p.t_faceted_fade_bottom_mm ?? 5, 5, 40);

  const maxR = MAX_DIAMETER_MM / 2;
  const bottomY = (p.bottom_thickness ?? 3) + 0.1;

  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nor, i);

    if (_v.y <= bottomY) continue;

    _radial.set(_v.x, 0, _v.z);
    const r = _radial.length();
    if (r < 1e-6) continue;
    _radial.multiplyScalar(1 / r);

    // Only affect outward-facing vertices
    if (_n.dot(_radial) <= 0.0) continue;

    let theta = Math.atan2(_v.z, _v.x);
    if (theta < 0) theta += Math.PI * 2;

    // --- NEW FACET LOGIC ---
    
    // 1. Quantize the vertex position into facet IDs
    const theta_id = Math.floor(theta / (2 * Math.PI) * h_facets);
    const v_id = Math.floor(_v.y / v_pitch);

    // 2. Get a consistent random value (0.0 to 1.0) for this facet cell
    const hash_val = hash2D(theta_id, v_id);

    // 3. Calculate the push amount based on variation
    // variation = 0 -> profile = 1.0 (all facets pushed out)
    // variation = 1 -> profile = 0.0 to 1.0 (random push)
    const min_push = 1.0 - variation;
    let profile = min_push + (hash_val * variation);

    // 4. Calculate the *center* normal for this facet's vertical band
    // This is the key: all vertices in this band use the *same* direction
    const theta_center = ((theta_id + 0.5) / h_facets) * (2 * Math.PI);
    _facetNormal.set(Math.cos(theta_center), 0, Math.sin(theta_center));

    // 5. Apply fade
    if (fadeMM > 0) {
      const u = (_v.y - bottomY) / Math.max(1e-6, fadeMM);
      profile *= smooth01(u);
    }

    // 6. Calculate final push, respecting max diameter
    const slack = Math.max(0, maxR - r);
    const push = Math.min(depth, slack) * profile;

    if (push > 0) {
      // 7. Push the vertex along the shared facet normal
      _v.addScaledVector(_facetNormal, push);
      pos.setXYZ(i, _v.x, _v.y, _v.z);
    }
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals(); // This recalculates normals from the new flat faces
  return geometry;
}

export default {
  id: "faceted",
  label: "Faceted (Low-Poly)",
  defaults: {
    t_faceted_bands: 20,
    t_faceted_pitch: 15,
    t_faceted_depth: 0.8,
    t_faceted_variation: 1.0,
    t_faceted_fade_bottom_mm: 5,
  },
  schema: [
    { key: "t_faceted_bands",      label: "Horizontal facets",   type: "range", min: 3,  max: 100, step: 1 },
    { key: "t_faceted_pitch",      label: "Vertical size, mm",   type: "range", min: 5,  max: 50,  step: 1 },
    { key: "t_faceted_depth",      label: "Depth, mm",           type: "range", min: 0,  max: 2.0, step: 0.05 },
    { key: "t_faceted_variation",  label: "Variation",           type: "range", min: 0,  max: 1.0, step: 0.01,
      // help: "0 = all facets pushed out uniformly, 1 = random push from 0 to 'Depth'" 
    },
    { key: "t_faceted_fade_bottom_mm",label: "Fade bottom, mm",  type: "range", min: 5,  max: 40,  step: 1 },
  ],
  headroom: (p) => clamp(p.t_faceted_depth ?? 0.8, 0, 2.0),
  apply,
};
