// src/textures/dragonScales.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// Triangle wave for the scale profile
function tri(x) {
  return 1 - Math.abs(2 * (x - Math.floor(x + 0.5)));
}

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  // --- Params ---
  const countH = Math.max(4, Math.round(p.t_scale_count ?? 24));
  const countV = Math.max(0.1, p.t_scale_aspect ?? 1.0); // Vertical aspect ratio
  const depth  = clamp(p.t_scale_depth ?? 2.5, 0, 5.0);
  const sharp  = clamp(p.t_scale_sharpness ?? 0.5, 0.01, 0.99); // 0.1 = Round, 0.9 = Diamond
  const twist  = p.t_scale_twist ?? 0;
  const overlap= clamp(p.t_scale_overlap ?? 0.2, 0, 0.8); // How much scales stack

  const bottomY = (p.bottom_thickness ?? 3) + 0.1;
  const maxRadius = MAX_DIAMETER_MM / 2;
  const height = p.height ?? 220;

  const v = new THREE.Vector3();
  const radial = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);

    if (v.y <= bottomY) continue;

    radial.set(v.x, 0, v.z);
    const r = radial.length();
    if (r < 1e-6) continue;
    radial.multiplyScalar(1 / r);

    // 1. Calculate UV coordinates
    let u = Math.atan2(v.z, v.x) / (2 * Math.PI); // 0..1 around
    if (u < 0) u += 1;
    
    // Twist logic
    if (Math.abs(twist) > 0.001) {
      u += (v.y / height) * twist;
    }

    let yNorm = v.y / height;
    let vCoord = yNorm * countH * countV;

    // 2. Stagger rows (Brick pattern)
    // If we are in an odd row, shift u by 0.5
    const row = Math.floor(vCoord);
    if (row % 2 !== 0) {
      u += 0.5 / countH;
    }

    // 3. Local Cell Coordinates (0..1 inside each scale)
    let cellU = (u * countH) % 1; 
    let cellV = vCoord % 1;
    
    // Fix wrap-around artifact at u=0
    if (cellU < 0) cellU += 1;

    // 4. SDF (Signed Distance Field) for the Scale Shape
    // We want a shape that is 1.0 at center-bottom, and 0.0 at edges
    // Dist from vertical center (0.5)
    const dx = Math.abs(cellU - 0.5) * 2; // 0..1
    
    // Create the pointed shape
    // If sharp is low, it allows wide curves. If high, it forces straight lines (diamond)
    const shapeWidth = 1.0 - (cellV * (1 - overlap)); // Taper width towards top
    
    // The magic shaping function
    // We combine the vertical gradient with the horizontal distance
    let signal = 0;
    
    // Are we inside the scale boundary?
    // We define boundary by: dx < (1 - cellV) roughly
    // Let's use a power curve for the "Roundness"
    const edge = Math.pow(1.0 - cellV, sharp * 2); // Taper curve
    
    if (dx < edge) {
      // Create a slope that "bulges" out at the bottom
      const bulge = Math.sin(cellV * Math.PI * 0.5 + Math.PI * 0.5); // 1 at bottom, 0 at top
      
      // Horizontal profile (rounded top)
      const hProf = Math.cos(dx * Math.PI * 0.5);
      
      signal = hProf * bulge;
    }

    // 5. Apply Depth
    const slack = Math.max(0, maxRadius - r);
    let push = Math.min(depth, slack) * signal;

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
  id: "dragonScales",
  label: "Dragon Scales",
  defaults: {
    t_scale_count: 30,
    t_scale_depth: 2.5,
    t_scale_aspect: 0.8,
    t_scale_sharpness: 0.5,
    t_scale_twist: 0,
    t_scale_overlap: 0.2,
  },
  schema: [
    // --- SHAPE GROUP ---
    { key: "t_scale_count",    label: "Scale Density",  type: "range", min: 10, max: 80, step: 1, group: "Texture" },
    { key: "t_scale_depth",    label: "Armor Depth",    type: "range", min: 0,  max: 5.0, step: 0.1, group: "Texture" },
    { key: "t_scale_twist",    label: "Flow / Twist",   type: "range", min: -1, max: 1,  step: 0.05, group: "Texture" },

    // --- ADVANCED ---
    { key: "t_scale_sharpness",label: "Pointiness",     type: "range", min: 0.1,max: 1.0, step: 0.05, group: "Texture", advanced: true },
    { key: "t_scale_aspect",   label: "Vertical Stretch",type: "range", min: 0.5,max: 2.0, step: 0.1, group: "Texture", advanced: true },
    { key: "t_scale_overlap",  label: "Overlap",        type: "range", min: 0,  max: 0.6, step: 0.05, group: "Texture", advanced: true },
  ],
  headroom: (p) => clamp(p.t_scale_depth ?? 2.5, 0, 5.0),
  apply,
};
