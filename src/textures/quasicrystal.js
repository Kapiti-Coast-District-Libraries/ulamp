// src/textures/quasicrystal.js
import * as THREE from "three";

const MAX_DIAMETER_MM = 240;
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

function apply(geometry, p) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) return geometry;

  // Parameters
  const orders = clamp(Math.floor(p.t_quasi_orders ?? 7), 3, 16);   // symmetry spokes
  const tile   = clamp(p.t_quasi_tile ?? 18, 4, 80);                // mm per wave
  const depth  = clamp(p.t_quasi_depth ?? 2.5, 0, 3.0);             // outward emboss
  const sharp  = clamp(Math.floor(p.t_quasi_sharpness ?? 3), 1, 8);  // crest hardness
  const twistDegPer100 = clamp(p.t_quasi_twist_deg100 ?? 20, -180, 180); // rotation per 100 mm height
  const warpMM   = clamp(p.t_quasi_warp_mm ?? 1.5, 0, 6);           // coordinate warp in mm
  const warpScale= clamp(p.t_quasi_warp_scale ?? 24, 4, 120);       // mm wavelength of warp

  const fadeTop = clamp(p.t_quasi_fadeTop ?? 0.08, 0, 0.5);
  const fadeBottom = clamp(p.t_quasi_fadeBottom ?? 0.05, 0, 0.5);

  const k = (2 * Math.PI) / tile;
  const kWarp = (2 * Math.PI) / warpScale;
  const twistRadPerMM = (Math.PI / 180) * (twistDegPer100 / 100);

  const maxR = MAX_DIAMETER_MM / 2;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const radial = new THREE.Vector3();

  const slab = p.bottom_thickness ?? 3;
  const bottomY = slab + 0.1;
  const usableH = Math.max(1e-3, p.height - slab);

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);

    if (v.y <= bottomY) continue; // leave the solid base clean

    // radial unit, current radius r
    radial.set(v.x, 0, v.z);
    const r = radial.length();
    if (r < 1e-6) continue;
    radial.multiplyScalar(1 / r);

    // outward facing only
    if (n.dot(radial) <= 0.0) continue;

    // cylindrical coordinates
    let theta = Math.atan2(v.z, v.x); if (theta < 0) theta += Math.PI * 2;
    const s = r * theta;     // arc length in mm around the local circumference
    const y = v.y;           // vertical in mm

    // mild coordinate warp for extra weirdness
    const ws = warpMM * Math.sin((s + y) * kWarp);
    const wy = warpMM * Math.sin((s - y) * kWarp);
    const sW = s + ws;
    const yW = y + wy;

    // quasicrystal interference, sum of cosines at rotated directions
    const twist = yW * twistRadPerMM; // progressive rotation up the height
    let sum = 0;
    for (let j = 0; j < orders; j++) {
      const ang = (j * 2 * Math.PI) / orders + twist;
      const u = Math.cos(ang) * sW + Math.sin(ang) * yW;
      sum += Math.cos(k * u);
    }
    // normalize to 0..1, then sharpen
    const val = 0.5 * (sum / orders + 1);
    const crest = Math.pow(Math.max(0, val), sharp);

    // top and bottom fades, so rims and seating stay cleaner
    const yNorm = clamp((y - slab) / usableH, 0, 1);
    const tFade = fadeTop > 0 ? (yNorm < 1 - fadeTop ? 1 : (1 - yNorm) / fadeTop) : 1;
    const bFade = fadeBottom > 0 ? (yNorm > fadeBottom ? 1 : yNorm / fadeBottom) : 1;
    const fade = Math.max(0, Math.min(1, tFade * bFade));

    // fit inside the 240 mm envelope
    const slack = Math.max(0, maxR - r);
    const push = Math.min(depth, slack) * crest * fade;

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
  id: "quasicrystal",
  label: "Quasicrystal",
  defaults: {
    t_quasi_orders: 7,
    t_quasi_tile: 18,
    t_quasi_depth: 2.5,
    t_quasi_sharpness: 3,
    t_quasi_twist_deg100: 20,
    t_quasi_warp_mm: 1.5,
    t_quasi_warp_scale: 24,
    t_quasi_fadeTop: 0.08,
    t_quasi_fadeBottom: 0.05,
  },
  schema: [
    { key: "t_quasi_orders",      label: "Symmetry spokes",      type: "range", min: 3,  max: 16,  step: 1 },
    { key: "t_quasi_tile",        label: "Tile size, mm",        type: "range", min: 4,  max: 80,  step: 0.5 },
    { key: "t_quasi_depth",       label: "Depth, mm",            type: "range", min: 0,  max: 3.0, step: 0.05 },
    { key: "t_quasi_sharpness",   label: "Sharpness",            type: "range", min: 1,  max: 8,   step: 1 },
    { key: "t_quasi_twist_deg100",label: "Twist deg per 100 mm", type: "range", min: -180, max: 180, step: 1 },
    { key: "t_quasi_warp_mm",     label: "Warp amount, mm",      type: "range", min: 0,  max: 6,   step: 0.1 },
    { key: "t_quasi_warp_scale",  label: "Warp scale, mm",       type: "range", min: 4,  max: 120, step: 0.5 },
    { key: "t_quasi_fadeTop",     label: "Fade near top",        type: "range", min: 0,  max: 0.5, step: 0.01 },
    { key: "t_quasi_fadeBottom",  label: "Fade near bottom",     type: "range", min: 0,  max: 0.5, step: 0.01 },
  ],
  headroom: (p) => clamp(p.t_quasi_depth ?? 2.5, 0, 3.0), // reserve radial mm so peaks never get swallowed
  apply,
};
