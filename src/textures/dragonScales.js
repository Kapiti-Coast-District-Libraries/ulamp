// src/textures/crystalFacets.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// A simple pseudo-random function that takes 2D coordinates
// and returns a stable 0..1 value
function hash2d(x, y) {
  let s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  // Params
  const countH = Math.max(4, Math.round(p.t_crys_count ?? 16));
  const aspect = clamp(p.t_crys_aspect ?? 1.0, 0.2, 4.0);
  const depth  = clamp(p.t_crys_depth ?? 4.0, 0, 8.0);
  const sharp  = clamp(p.t_crys_sharpness ?? 0.9, 0.1, 1.0); // 1.0 = perfectly flat planes
  const crumple= clamp(p.t_crys_crumple ?? 0.0, 0, 1.0); // Random height variation
  const twist  = p.t_crys_twist ?? 0;

  const bottomY = (p.bottom_thickness ?? 3) + 0.1;
  const maxRadius = MAX_DIAMETER_MM / 2;
  const height = p.height ?? 220;

  // Derived
  const countV = countH / aspect;

  const v = new THREE.Vector3();
  const radial = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);

    if (v.y <= bottomY) continue;

    radial.set(v.x, 0, v.z);
    const r = radial.length();
    if (r < 1e-6) continue;
    radial.multiplyScalar(1 / r);

    // 1. Map to cylindrical UV
    let u = Math.atan2(v.z, v.x) / (2 * Math.PI); 
    if (u < 0) u += 1;

    // Twist
    if (Math.abs(twist) > 0.001) {
      u += (v.y / height) * twist;
    }

    let vCoord = (v.y / height) * countV;
    let uCoord = u * countH;

    // 2. Stagger the grid (diamond pattern)
    // Offset every other row by 0.5
    const row = Math.floor(vCoord);
    if (row % 2 !== 0) {
      uCoord += 0.5;
    }

    // 3. Local coordinates inside the diamond cell (0..1)
    let cellU = uCoord - Math.floor(uCoord);
    let cellV = vCoord - Math.floor(vCoord);

    // 4. Distance to center of cell (0.5, 0.5)
    // We use 'Manhattan Distance' rotated 45 degrees to form a diamond gradient
    // d = |x - 0.5| + |y - 0.5|
    const dist = Math.abs(cellU - 0.5) + Math.abs(cellV - 0.5);
    
    // dist is 0 at center, 0.5 at edges.
    // We want 1.0 at center, 0.0 at edges.
    let signal = Math.max(0, 1.0 - (dist * 2.0));

    // 5. Apply Sharpness (Profile)
    // Linear (power 1) = Sharp Pyramid
    // Power < 1 = Rounded
    // Power > 1 = Spiky
    // We map 0.1..1.0 slider to exponents
    const k = 1.0 + (1.0 - sharp) * 4.0; // 1.0 to 5.0
    signal = Math.pow(signal, 1/k); 

    // 6. Crumple (Randomize facet heights)
    // We hash the integer grid coordinates to get a random value per facet
    if (crumple > 0) {
      const col = Math.floor(uCoord);
      // Unique ID for this diamond
      const rnd = hash2d(col, row);
      // Modulate depth: some facets pop out less
      // e.g. multiplied by 0.5 .. 1.0
      signal *= (1.0 - crumple * 0.7 * rnd);
    }

    // 7. Apply
    const slack = Math.max(0, maxRadius - r);
    const push = Math.min(depth, slack) * signal;

    if (push > 0) {
      v.addScaledVector(radial, push);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export default {
  id: "crystalFacets",
  label: "Crystal Facets",
  defaults: {
    t_crys_count: 16,
    t_crys_aspect: 1.5,
    t_crys_depth: 4.0,
    t_crys_sharpness: 0.9,
    t_crys_crumple: 0.0,
    t_crys_twist: 0,
  },
  schema: [
    // --- MAIN ---
    { key: "t_crys_count",    label: "Grid Size",      type: "range", min: 4,   max: 60,  step: 1, group: "Texture" },
    { key: "t_crys_depth",    label: "Facet Depth",    type: "range", min: 0,   max: 10.0,step: 0.1, group: "Texture" },
    { key: "t_crys_aspect",   label: "Facet Shape",    type: "range", min: 0.5, max: 3.0, step: 0.1, group: "Texture" },
    
    // --- STYLE ---
    { key: "t_crys_sharpness",label: "Sharpness",      type: "range", min: 0.1, max: 1.0, step: 0.1, group: "Texture" },
    { key: "t_crys_crumple",  label: "Crumple (Chaos)",type: "range", min: 0,   max: 1.0, step: 0.05, group: "Texture" },
    { key: "t_crys_twist",    label: "Twist",          type: "range", min: -1,  max: 1,   step: 0.05, group: "Texture" },
  ],
  headroom: (p) => clamp(p.t_crys_depth ?? 4.0, 0, 10.0),
  apply,
};
