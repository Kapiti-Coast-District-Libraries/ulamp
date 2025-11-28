// src/textures/pinchStacks.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smooth01(u) { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); }
function fract(x) { return x - Math.floor(x); }
function hash1(t) { return fract(Math.sin(t * 91.345) * 43758.5453); }

// --- UNIFIED MATH HELPERS ---
// We extract the math so the Safety Scanner sees the EXACT same curve as the Mesh Generator

function getPinchFactor(y, centers, width, skew, theta, useMaxAngle = false) {
  let val = 0;
  for (let k = 0; k < centers.length; k++) {
    const dy = y - centers[k];
    const g = Math.exp(-0.5 * (dy * dy) / (width * width));
    
    // For Safety Scan, we assume the WORST CASE angle (ang=1.0)
    // For Mesh Gen, we use the actual angle
    let ang = 1.0;
    if (!useMaxAngle) {
      const rot = theta * skew + k * 1.7;
      ang = 0.5 + 0.5 * Math.cos(rot);
    }
    
    val += g * ang;
  }
  return Math.min(1, val);
}

function getEaseFactor(y, bottomY, easeMM) {
  if (y >= bottomY + easeMM) return 1.0;
  if (y <= bottomY) return 0.0;
  return smooth01((y - bottomY) / Math.max(1e-6, easeMM));
}

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  if (!pos) return geometry;

  const count   = clamp(Math.floor(p.m_ps_count ?? 3), 1, 12);
  const spread  = clamp(p.m_ps_spread_mm ?? 40, 10, 160);
  const width   = clamp(p.m_ps_width_mm ?? 18, 6, 80);
  let depth     = clamp(p.m_ps_depth ?? 0.35, 0, 0.95);
  const skew    = clamp(p.m_ps_theta_skew ?? 2.0, 0, 12);
  const easeMM  = clamp(p.m_ps_ease_bottom_mm ?? 10, 0, 80);

  // 1. Analyze Geometry Bounds
  let minY = Infinity, maxY = -Infinity;
  let maxR = 0;
  
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    
    const r = Math.hypot(x, z);
    if (r > maxR) maxR = r;
  }
  
  const height = Math.max(1e-6, maxY - minY);
  const bottomY = (p.bottom_thickness ?? 3) + 0.1;

  // Build band centers
  const centers = [];
  const startY = minY + height * 0.2;
  for (let k = 0; k < count; k++) {
    const y0 = startY + k * spread + hash1(k + 1.23) * 0.25 * spread;
    centers.push(y0);
  }

  // 2. HIGH-RES SAFETY SCAN
  // We scan the curve every 0.5mm to find the steepest slope.
  // We want the slope (derivative) to be < 0.8 (approx 40 degrees) to be safe.
  
  let maxGradient = 0;
  const stepSize = 0.5; // High resolution scan
  const eps = 0.1;      // Tiny epsilon for derivative accuracy
  
  // Helper to get total normalized displacement (0..1) at height y
  const getDispRatio = (yVal) => {
    const e = getEaseFactor(yVal, bottomY, easeMM);
    const pVal = getPinchFactor(yVal, centers, width, skew, 0, true); // useMaxAngle=true
    return e * pVal;
  };

  for (let y = minY; y <= maxY; y += stepSize) {
    const v1 = getDispRatio(y);
    const v2 = getDispRatio(y + eps);
    // Slope = change in displacement / change in height
    // Real Displacement = maxR * depth * ratio
    // Real Gradient = maxR * depth * (v2-v1)/eps
    
    // We only care about negative gradients (Outward slopes / Overhangs)
    // Positive gradients are Inward slopes (Chamfers), which are safe.
    // However, Pinch Stacks create both. The "return" from a pinch is an overhang.
    
    const slopeRatio = (v1 - v2) / eps; // Inverted to catch "return" (v2 < v1) as positive spike
    if (slopeRatio > maxGradient) maxGradient = slopeRatio;
  }

  // 3. AUTO-LIMIT DEPTH
  // Target Slope = 0.8 (approx 40 deg). Safe limit is 1.0 (45 deg).
  // Real Slope = maxR * depth * maxGradient
  // We want: maxR * depth * maxGradient <= 0.8
  // So: depth <= 0.8 / (maxR * maxGradient)
  
  if (maxGradient > 0.001) {
    const safeSlopeLimit = 0.8; 
    const maxAllowedDepth = safeSlopeLimit / (maxR * maxGradient);
    
    if (depth > maxAllowedDepth) {
      depth = maxAllowedDepth;
    }
  }

  // 4. APPLY DEFORMATION (SUBTRACTIVE)
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y <= bottomY) continue;
    
    const r = Math.hypot(x, z); 
    if (r < 1e-6) continue;

    let theta = Math.atan2(z, x);
    if (theta < 0) theta += Math.PI * 2;

    // Calculate Exact Factors
    const pinch = getPinchFactor(y, centers, width, skew, theta, false);
    const ease = getEaseFactor(y, bottomY, easeMM);
    
    // Subtractive Displacement
    const displacement = maxR * depth * ease * pinch;
    
    // Clamp to avoid inverted geometry (negative radius)
    const safeDisp = Math.min(displacement, r - 2); 

    const nx = x / r;
    const nz = z / r;

    x -= nx * safeDisp;
    z -= nz * safeDisp;

    pos.setXYZ(i, x, y, z);
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export default {
  id: "pinchStacks",
  label: "Pinch Stacks",
  defaults: {
    m_ps_count: 3,
    m_ps_spread_mm: 40,
    m_ps_width_mm: 18,
    m_ps_depth: 0.35,
    m_ps_theta_skew: 2.0,
    m_ps_ease_bottom_mm: 10,
  },
  schema: [
    { key: "m_ps_count",      label: "Stack Count",      type: "range", min: 1, max: 12, step: 1, group: "Texture" },
    { key: "m_ps_depth",      label: "Pinch Strength",   type: "range", min: 0, max: 0.95, step: 0.01, group: "Texture" },
    { key: "m_ps_spread_mm",  label: "Spacing (mm)",     type: "range", min: 10, max: 160, step: 1, group: "Texture" },
    { key: "m_ps_width_mm",       label: "Pinch Softness",   type: "range", min: 6, max: 80, step: 1, group: "Texture", advanced: true },
    { key: "m_ps_theta_skew",     label: "Twist / Skew",     type: "range", min: 0, max: 12, step: 0.1, group: "Texture", advanced: true },
    { key: "m_ps_ease_bottom_mm", label: "Base Safe Zone",   type: "range", min: 0, max: 80, step: 1, group: "Texture", advanced: true },
  ],
  headroom: () => 0,
  apply,
};
