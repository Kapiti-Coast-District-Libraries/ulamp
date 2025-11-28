// src/textures/pinchStacks.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smooth01(u) { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); }
function fract(x) { return x - Math.floor(x); }
function hash1(t) { return fract(Math.sin(t * 91.345) * 43758.5453); }

// Helper to calculate the Gaussian envelope value at height y
function getEnvelope(y, centers, width) {
  let val = 0;
  // Sum of Gaussians (overlapping bands)
  for (let k = 0; k < centers.length; k++) {
    const dy = y - centers[k];
    val += Math.exp(-0.5 * (dy * dy) / (width * width));
  }
  // Clamp to 1.0 max per point (soft cap) logic matches apply loop
  return Math.min(1, val);
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

  // 2. SAFETY PRE-PASS: CHECK SLOPE
  // We simulate the displacement derivative.
  // Displacement D(y) = maxR * depth * envelope(y).
  // Slope S(y) = dD/dy.
  // We want S(y) <= 1.0 (45 degrees).
  // Therefore: maxR * depth * max(envelope'(y)) <= 1.0
  // So: depth <= 1.0 / (maxR * maxGradient)

  const steps = Math.ceil(height); // 1 sample per mm
  let maxGradient = 0;
  const eps = 1.0; // 1mm step for finite difference
  
  for (let y = minY; y <= maxY; y += 2) { // check every 2mm
    const v1 = getEnvelope(y, centers, width);
    const v2 = getEnvelope(y + eps, centers, width);
    const slope = Math.abs(v2 - v1) / eps;
    if (slope > maxGradient) maxGradient = slope;
  }

  // Calculate maximum allowed depth to keep slope <= 1.0 (approx)
  // We add a safety buffer (0.9 instead of 1.0)
  if (maxGradient > 0.001) {
    const maxAllowedDepth = 0.9 / (maxR * maxGradient);
    if (depth > maxAllowedDepth) {
      // console.warn(`Auto-reducing depth from ${depth} to ${maxAllowedDepth.toFixed(3)} for safety`);
      depth = maxAllowedDepth;
    }
  }

  // 3. APPLY DEFORMATION
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y <= bottomY) continue;
    
    const r = Math.hypot(x, z); 
    if (r < 1e-6) continue;

    let theta = Math.atan2(z, x);
    if (theta < 0) theta += Math.PI * 2;

    // Calculate Envelope
    let pinch = 0;
    for (let k = 0; k < centers.length; k++) {
      const c = centers[k];
      const dy = y - c;
      const g = Math.exp(-0.5 * (dy * dy) / (width * width));
      
      const rot = theta * skew + k * 1.7;
      const ang = 0.5 + 0.5 * Math.cos(rot);
      pinch += g * ang;
    }
    pinch = Math.min(1, pinch);

    const ease = y < bottomY + easeMM ? smooth01((y - bottomY) / Math.max(1e-6, easeMM)) : 1.0;
    
    // CHANGE: Use Subtractive Displacement instead of Multiplicative Scaling
    // This preserves wall thickness.
    // We use maxR as the reference magnitude so the depth slider feels consistent.
    const displacement = maxR * depth * ease * pinch;

    // Don't push past the center (safety clamp)
    const safeDisp = Math.min(displacement, r - 2); 

    const ratio = safeDisp / r;
    const nx = x / r; // normalized direction
    const nz = z / r;

    // Move point INWARDS by fixed distance
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
    // --- MAIN TEXTURE CONTROLS ---
    { key: "m_ps_count",      label: "Stack Count",      type: "range", min: 1, max: 12, step: 1, group: "Texture" },
    { key: "m_ps_depth",      label: "Pinch Strength",   type: "range", min: 0, max: 0.95, step: 0.01, group: "Texture" },
    { key: "m_ps_spread_mm",  label: "Spacing (mm)",     type: "range", min: 10, max: 160, step: 1, group: "Texture" },

    // --- ADVANCED TEXTURE CONTROLS ---
    { key: "m_ps_width_mm",       label: "Pinch Softness",   type: "range", min: 6, max: 80, step: 1, group: "Texture", advanced: true },
    { key: "m_ps_theta_skew",     label: "Twist / Skew",     type: "range", min: 0, max: 12, step: 0.1, group: "Texture", advanced: true },
    { key: "m_ps_ease_bottom_mm", label: "Base Safe Zone",   type: "range", min: 0, max: 80, step: 1, group: "Texture", advanced: true },
  ],
  headroom: () => 0,
  apply,
};
