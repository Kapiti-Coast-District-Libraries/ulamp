// src/textures/twist.js
import * as THREE from "three";

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smooth01(u) {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
}

// Pre-allocate for performance
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _rotMat = new THREE.Matrix4();

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  const totalDegrees = p.t_twist_angle ?? 45;
  const fadeMM = clamp(p.t_twist_fade_bottom_mm ?? 5, 0, 40);

  const totalRad = totalDegrees * (Math.PI / 180);
  
  const bottomY = (p.bottom_thickness ?? 3) + 0.1;
  // Get the top of the model (ignoring any top lip/rim)
  const topY = (p.height ?? 300) - (p.top_rim_height ?? 0);
  const twistHeight = Math.max(1e-6, topY - bottomY);

  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nor, i);

    if (_v.y <= bottomY) continue;

    // Calculate twist progress (0.0 to 1.0)
    let u = clamp((_v.y - bottomY) / twistHeight, 0, 1);
    
    // Apply bottom fade
    if (fadeMM > 0) {
      const u_fade = (_v.y - bottomY) / Math.max(1e-6, fadeMM);
      u *= smooth01(u_fade);
    }

    // Calculate the rotation for this vertex's height
    const twistAngle = u * totalRad;
    if (twistAngle === 0) continue;

    // Create a Y-rotation matrix
    _rotMat.makeRotationY(twistAngle);

    // Apply the rotation to both the position and the normal
    _v.applyMatrix4(_rotMat);
    _n.applyMatrix4(_rotMat);

    pos.setXYZ(i, _v.x, _v.y, _v.z);
    nor.setXYZ(i, _n.x, _n.y, _n.z);
  }

  pos.needsUpdate = true;
  nor.needsUpdate = true;
  // We do *not* computeVertexNormals, since we rotated them manually
  return geometry;
}

export default {
  id: "twist",
  label: "Sculptural Twist",
  defaults: {
    t_twist_angle: 45,
    t_twist_fade_bottom_mm: 10,
  },
  schema: [
    { key: "t_twist_angle",          label: "Twist angle, °",      type: "range", min: -360, max: 360, step: 1 },
    { key: "t_twist_fade_bottom_mm", label: "Fade bottom, mm",   type: "range", min: 0,  max: 40,  step: 1 },
  ],
  // This deformer has no radial headroom, it only rotates
  headroom: (p) => 0, 
  apply,
};
