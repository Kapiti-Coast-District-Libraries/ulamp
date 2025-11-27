// src/textures/pinchStacks.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smooth01(u) { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); }
function fract(x) { return x - Math.floor(x); }
function hash1(t) { return fract(Math.sin(t * 91.345) * 43758.5453); }

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  if (!pos) return geometry;

  const count   = clamp(Math.floor(p.m_ps_count ?? 3), 1, 12);
  const spread  = clamp(p.m_ps_spread_mm ?? 40, 10, 160);
  const width   = clamp(p.m_ps_width_mm ?? 18, 6, 80);
  const depth   = clamp(p.m_ps_depth ?? 0.35, 0, 0.95);
  const skew    = clamp(p.m_ps_theta_skew ?? 2.0, 0, 12);
  const easeMM  = clamp(p.m_ps_ease_bottom_mm ?? 10, 0, 80);

  // 1. Analyze Geometry: Build an Envelope of the outer radius
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const height = Math.max(1e-6, maxY - minY);
  const bottomY = (p.bottom_thickness ?? 3) + 0.1;

  // Use more bins for smoother vertical resolution
  const BIN_COUNT = 400; 
  const bins = new Float32Array(BIN_COUNT).fill(0);
  const binStep = height / (BIN_COUNT - 1);
  
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) continue;
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    const b = Math.min(BIN_COUNT - 1, Math.floor((y - minY) / binStep));
    if (r > bins[b]) bins[b] = r;
  }

  // Helper to get interpolated outer radius
  const getOuterR = (y) => {
    if (y <= minY) return bins[0];
    if (y >= maxY) return bins[BIN_COUNT - 1];
    const t = (y - minY) / binStep;
    const b0 = Math.floor(t);
    const b1 = Math.min(BIN_COUNT - 1, b0 + 1);
    const f = t - b0;
    return bins[b0] * (1 - f) + bins[b1] * f;
  };

  // 2. Build Pinch Centers
  const centers = [];
  const startY = minY + height * 0.2;
  for (let k = 0; k < count; k++) {
    const y0 = startY + k * spread + hash1(k + 1.23) * 0.25 * spread;
    centers.push(y0);
  }

  // 3. Apply Displacement
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y <= bottomY) continue;
    
    const r = Math.hypot(x, z);
    if (r < 1e-6) continue;

    let theta = Math.atan2(z, x);
    if (theta < 0) theta += Math.PI * 2;

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
    const kPull = depth * ease * pinch;

    // Use Interpolated Reference Radius
    const refR = getOuterR(y);
    const displacementMM = refR * kPull;

    // Apply strict displacement (preserves thickness)
    // Safety clamp prevents inversion but allows full displacement otherwise
    const safeDisp = Math.min(displacementMM, Math.max(0, r - 0.5));
    const scale = 1.0 - (safeDisp / r);

    x *= scale; 
    z *= scale;

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
    { key: "m_ps_width_mm",   label: "Pinch Softness",   type: "range", min: 6, max: 80, step: 1, group: "Texture", advanced: true },
    { key: "m_ps_theta_skew", label: "Twist / Skew",     type: "range", min: 0, max: 12, step: 0.1, group: "Texture", advanced: true },
    { key: "m_ps_ease_bottom_mm", label: "Base Safe Zone", type: "range", min: 0, max: 80, step: 1, group: "Texture", advanced: true },
  ],
  headroom: () => 0,
  apply,
};
