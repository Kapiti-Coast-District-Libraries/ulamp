// src/textures/voronoiDeform.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smooth01(u) {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * A simple 1D hash function to generate pseudo-random values
 * from a single seed number. Returns 0.0 to 1.0.
 */
function hash1D(n) {
  n = Math.sin(n * 12.9898) * 43758.5453123;
  return n - Math.floor(n);
}

// Pre-allocate vectors for performance
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _radial = new THREE.Vector3();

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  const count = clamp(Math.floor(p.t_voronoi_count ?? 150), 10, 500);
  const depth = clamp(p.t_voronoi_depth ?? 1.5, 0, 5.0);
  const variation = clamp(p.t_voronoi_variation ?? 1.0, 0, 1.0);
  const fadeMM = clamp(p.t_voronoi_fade_bottom_mm ?? 5, 5, 40);

  const maxR = MAX_DIAMETER_MM / 2;
  const bottomY = (p.bottom_thickness ?? 3) + 0.1;
  
  // HACK: Assume a max model height.
  // A better way would be to get this from geometry.boundingBox
  const yRange = (p.height ?? 300) - bottomY; 

  // --- 1. Generate Seed Points ---
  const seeds = [];
  for (let i = 0; i < count; i++) {
    // Random position
    const theta = hash1D(i * 5 + 0) * 2 * Math.PI;
    const y = bottomY + hash1D(i * 5 + 1) * yRange;

    // Random push *magnitude* (scaled by variation)
    const min_push = 1.0 - variation;
    const push_mag = min_push + (hash1D(i * 5 + 2) * variation);

    // Random 3D push *direction*
    const push_vec = new THREE.Vector3(
      hash1D(i * 5 + 3) - 0.5,
      hash1D(i * 5 + 4) - 0.5,
      hash1D(i * 5 + 5) - 0.5
    ).normalize();
    
    seeds.push({ theta, y, push_mag, push_vec });
  }

  // --- 2. Find closest seed for each vertex ---
  // We need to store which seed each vertex belongs to,
  // so we create a new array to store the seed index.
  const vertexSeeds = new Uint32Array(pos.count);
  const avgR = (p.top_diameter_mm / 2 + p.bottom_diameter_mm / 2) / 2;

  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);

    if (_v.y <= bottomY) continue;

    _radial.set(_v.x, 0, _v.z);
    const r = _radial.length() || avgR; // Use average R if at center

    let theta = Math.atan2(_v.z, _v.x);
    if (theta < 0) theta += Math.PI * 2;

    let minDistSq = Infinity;
    let closestSeedIndex = 0;

    // Find the closest seed
    for (let j = 0; j < seeds.length; j++) {
      const seed = seeds[j];
      const d_y = _v.y - seed.y;
      
      // Check distance in theta, theta+2PI, and theta-2PI
      const d_theta = theta - seed.theta;
      const d_h = r * d_theta;
      const d_h_wrap1 = r * (d_theta + 2 * Math.PI);
      const d_h_wrap2 = r * (d_theta - 2 * Math.PI);
      
      const dist_h_sq = Math.min(d_h*d_h, d_h_wrap1*d_h_wrap1, d_h_wrap2*d_h_wrap2);
      const distSq = dist_h_sq + d_y * d_y;

      if (distSq < minDistSq) {
        minDistSq = distSq;
        closestSeedIndex = j;
      }
    }
    vertexSeeds[i] = closestSeedIndex;
  }

  // --- 3. Apply displacement ---
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nor, i); // Keep original normal for fade logic

    if (_v.y <= bottomY) continue;
    
    // Get the seed this vertex belongs to
    const seed = seeds[vertexSeeds[i]];
    if (!seed) continue;
    
    // Calculate fade
    let profile = 1.0;
    if (fadeMM > 0) {
      const u = (_v.y - bottomY) / Math.max(1e-6, fadeMM);
      profile = smooth01(u);
    }
    
    // Calculate final push magnitude
    // Note: We ignore 'slack' because we WANT to deform the shape
    const push = seed.push_mag * depth * profile;

    if (push > 0) {
      _v.addScaledVector(seed.push_vec, push);
      pos.setXYZ(i, _v.x, _v.y, _v.z);
    }
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals(); // Re-calculate normals from the new facets
  return geometry;
}

export default {
  id: "voronoiDeform",
  label: "Voronoi Deform",
  defaults: {
    t_voronoi_count: 150,
    t_voronoi_depth: 1.5,
    t_voronoi_variation: 1.0,
    t_voronoi_fade_bottom_mm: 5,
  },
  schema: [
    { key: "t_voronoi_count",      label: "Facet count",         type: "range", min: 10, max: 500, step: 1 },
    { key: "t_voronoi_depth",      label: "Deformation, mm",     type: "range", min: 0,  max: 5.0, step: 0.05 },
    { key: "t_voronoi_variation",  label: "Variation",           type: "range", min: 0,  max: 1.0, step: 0.01,
      // help: "0 = all facets deform by 'Depth', 1 = random deformation from 0 to 'Depth'"
    },
    { key: "t_voronoi_fade_bottom_mm",label: "Fade bottom, mm",  type: "range", min: 5,  max: 40,  step: 1 },
  ],
  // Headroom is now the full depth, as push is not just radial
  headroom: (p) => clamp(p.t_voronoi_depth ?? 1.5, 0, 5.0),
  apply,
};
