// src/packs/sockBallsPack.js
// Tube sock over tennis balls vibe, print safe, 240 mm envelope, fixed 80 mm hole.
// World units are mm. Origin at (0,0,0). Base sits at y = 0.

import * as THREE from "three";
import { textures, textureOptions } from "../textures";

const MAX_SIZE = 240;
const MIN_THICK = 0.8;
const MAX_THICK = 1.2;
const BOTTOM_THICK = 3;
const FIXED_HOLE_DIAMETER = 80; // mm, fixed as requested

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

const PREVIEW_CAPS = { maxRadial: 540, maxRes: 700, stepMM: 0.6 };
const EXPORT_CAPS  = { maxRadial: 1200, maxRes: 1400, stepMM: 0.4 };

/* ---------------- seeded RNG ---------------- */
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  const next = () => (s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 0xffffffff;
  return { next };
}

/* ---------------- detail heuristics ---------------- */
function recommendedRadialSegments(p, caps) {
  const per = 20 + Math.round((p.b_count ?? 3) * 2);
  const want = Math.max(120, (p.b_count ?? 3) * per);
  return clamp(Math.round(want), 64, caps.maxRadial);
}
function recommendedResolution(p, caps) {
  const base = Math.ceil((p.height ?? 220) / caps.stepMM);
  return clamp(base, 160, caps.maxRes);
}

/* ---------------- baseline radius, headroom ---------------- */
function rOuterAt(t, p) {
  const r = p.baseRadius + (p.topRadius - p.baseRadius) * t;
  const maxR = MAX_SIZE / 2;
  const head = (p.texture_headroom ?? 0) + (p.b_headroom ?? 0);
  return Math.min(r, Math.max(0.5, maxR - head));
}
function rInnerAt(t, p) { return Math.max(rOuterAt(t, p) - p.wall, 0.5); }

/* ---------------- lathe profile with fixed 80 mm hole ---------------- */
function makeProfileWithHole(p) {
  const pts = [];
  const H = p.height;
  const N = p.resolution;
  const rHole = FIXED_HOLE_DIAMETER * 0.5;

  pts.push(new THREE.Vector2(rHole, 0));
  pts.push(new THREE.Vector2(rOuterAt(0, p), 0));

  for (let i = 1; i <= N; i++) {
    const t = i / N;
    pts.push(new THREE.Vector2(rOuterAt(t, p), t * H));
  }

  const rTopIn = Math.max(rInnerAt(1, p), 0.5);
  pts.push(new THREE.Vector2(rTopIn, H));

  for (let i = N - 1; i >= 0; i--) {
    const t = i / N, y = t * H;
    if (y < BOTTOM_THICK) break;
    pts.push(new THREE.Vector2(rInnerAt(t, p), y));
  }

  const rInSlab = Math.max(rInnerAt(BOTTOM_THICK / H, p), 0.5);
  pts.push(new THREE.Vector2(Math.min(rInSlab, rHole), BOTTOM_THICK));
  pts.push(new THREE.Vector2(rHole, BOTTOM_THICK));
  pts.push(new THREE.Vector2(rHole, 0));

  return pts;
}

/* ---------------- spherical balls ---------------- */
function computeBalls(p) {
  const H = p.height;
  const rng = makeRng(Math.floor(p.b_seed ?? 1234));
  const count = clamp(Math.floor(p.b_count ?? 3), 1, 70);

  const yMin = BOTTOM_THICK + p.b_supportRadius + 4;
  const yMax = H - Math.max(8, p.b_supportRadius * 0.6);

  const balls = [];
  for (let i = 0; i < count; i++) {
    const y = yMin + (yMax - yMin) * rng.next();
    const phi = rng.next() * Math.PI * 2;

    const dj = clamp(p.b_jitter ?? 0.2, 0, 1);
    const depth = p.b_depth * (1 - 0.5 * dj + rng.next() * dj);
    const support = p.b_supportRadius * (1 - 0.4 * dj + rng.next() * dj);

    // R = (s^2 + h^2) / (2h)
    const R = (support * support + depth * depth) / (2 * Math.max(0.001, depth));

    balls.push({ y, phi, depth, support, R });
  }
  return balls;
}

function capHeightAtDistance(d, h, s, R) {
  if (d >= s) return 0;
  const z = Math.sqrt(Math.max(0, R * R - d * d)) - (R - h);
  return Math.max(0, z);
}

// maximum spherical cap from all balls, with soft fades near rim and slab
function bulgeFieldMM(theta, y, p) {
  const balls = p._balls;
  if (!balls || balls.length === 0) return 0;

  const rBase = rOuterAt(y / p.height, p);
  let m = 0;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    let dth = Math.abs(theta - b.phi);
    if (dth > Math.PI) dth = 2 * Math.PI - dth;
    const dx = dth * rBase;
    const dy = y - b.y;
    const d = Math.hypot(dx, dy);

    const z = capHeightAtDistance(d, b.depth, b.support, b.R);
    if (z > m) m = z;
  }

  const usableH = Math.max(1e-3, p.height - BOTTOM_THICK);
  const yNorm = clamp((y - BOTTOM_THICK) / usableH, 0, 1);
  const fadeTop = 0.06, fadeBottom = 0.06;
  const tFade = yNorm < 1 - fadeTop ? 1 : (1 - yNorm) / fadeTop;
  const bFade = yNorm > fadeBottom ? 1 : yNorm / fadeBottom;

  return m * Math.max(0, Math.min(1, tFade * bFade));
}

/* ---------------- overhang guard, always on ---------------- */

const MAX_OVERHANG_SLOPE = 1.0; // mm radial growth per 1 mm Z, equals 45 degrees

function worstOutwardSlopeSock(p) {
  const H = p.height;
  if (H <= 0) return 0;

  const dRdy_linear = (p.topRadius - p.baseRadius) / H;
  const stepsT = 48;
  const stepsA = Math.max(128, Math.round((p.b_count ?? 3) * 12));
  const epsY = H / (stepsT * 2);

  let worst = 0;

  for (let i = 0; i <= stepsT; i++) {
    const y0 = (i / stepsT) * H;
    if (y0 <= BOTTOM_THICK + 1e-6) continue;
    const t = y0 / H;

    for (let j = 0; j < stepsA; j++) {
      const theta = (j / stepsA) * Math.PI * 2;

      const delta0 = bulgeFieldMM(theta, y0, p);
      const y1 = Math.min(H, y0 + epsY);
      const delta1 = bulgeFieldMM(theta, y1, p);

      const dDdy = (delta1 - delta0) / Math.max(1e-9, y1 - y0);

      // outward growth risk
      const dRdy = dRdy_linear + dDdy;
      if (dRdy > worst) worst = dRdy;
    }
  }
  return worst;
}

// cap straight profile so it cannot violate 45 degrees by itself
function clampTopFor45(p) {
  if (p.topRadius <= p.baseRadius) return;
  const maxAllowedTop = p.baseRadius + p.height * MAX_OVERHANG_SLOPE;
  if (p.topRadius > maxAllowedTop) p.topRadius = maxAllowedTop;
}

function enforceOverhangSock(pIn, caps) {
  // start from normal constraints
  let p = constrainParamsRaw(pIn, caps);

  // initial straight profile clamp
  clampTopFor45(p);

  // iterate, relax ball depth first, then footprint, then taper, then small shrink
  let tries = 0;
  while (tries < 30) {
    // recompute balls since b_depth or footprint may change
    p._balls = computeBalls(p);

    const worst = worstOutwardSlopeSock(p);
    if (worst <= MAX_OVERHANG_SLOPE + 1e-4) break;

    // 1. reduce ball depth, strongest effect on d(delta)/dy near crests
    if (p.b_depth > 4) {
      p.b_depth = Math.max(4, p.b_depth * 0.85);
      p.b_headroom = p.b_depth; // keep headroom consistent
      tries++;
      continue;
    }

    // 2. reduce footprint, softens curvature and lowers slope
    if (p.b_supportDiameter > 60) {
      p.b_supportDiameter = Math.max(60, p.b_supportDiameter * 0.9);
      p.b_supportRadius = p.b_supportDiameter * 0.5;
      tries++;
      continue;
    }

    // 3. reduce outward flare of straight profile if any remains
    if (p.topRadius > p.baseRadius) {
      const dRdy = (p.topRadius - p.baseRadius) / p.height;
      const scale = clamp((dRdy - 0.15) / Math.max(1e-9, dRdy), 0.7, 0.98);
      p.topRadius = p.baseRadius + p.height * dRdy * scale;
      tries++;
      continue;
    }

    // 4. last resort, tiny uniform inward nudge of both radii
    p.baseRadius *= 0.995;
    p.topRadius  *= 0.995;
    tries++;
  }

  // final recompute of balls and internals for building
  p._balls = computeBalls(p);
  return p;
}

/* ---------------- constraints and build ---------------- */

// split out a raw constrain so the enforcer can call it without recursion
function constrainParamsRaw(pIn = {}, caps = PREVIEW_CAPS) {
  const out = { ...pIn };

  out.height = clamp(pIn.height ?? 220, 80, MAX_SIZE);
  out.wall   = clamp(pIn.wall ?? 1.2, MIN_THICK, MAX_THICK);

  const baseMin = Math.max(45, out.wall + 2);
  out.baseRadius = clamp(pIn.baseRadius ?? 110, baseMin, MAX_SIZE / 2);
  out.topRadius  = clamp(pIn.topRadius  ?? 90,  out.wall + 2, MAX_SIZE / 2);

  // balls
  out.b_count           = clamp(Math.floor(pIn.b_count ?? 4), 1, 70);
  out.b_depth           = clamp(pIn.b_depth ?? 16, 4, 35);                // widened lower bound to 4 for safety
  out.b_supportDiameter = clamp(pIn.b_supportDiameter ?? 75, 40, 160);
  out.b_supportRadius   = out.b_supportDiameter * 0.5;
  out.b_jitter          = clamp(pIn.b_jitter ?? 0.2, 0, 1);
  out.b_seed            = Math.floor(pIn.b_seed ?? 1234);

  // texture selection and headroom
  out.texture = pIn.texture ?? (textureOptions[0]?.value ?? "none");
  const tex = textures[out.texture];
  out.texture_headroom = tex?.headroom ? tex.headroom(out) : 0;

  // reserve headroom equal to ball depth so full height is preserved
  out.b_headroom = out.b_depth;

  // fixed 80 mm hole
  out._holeRadius = FIXED_HOLE_DIAMETER * 0.5;

  // auto detail
  out.radialSegments = recommendedRadialSegments(out, caps);
  out.resolution     = recommendedResolution(out, caps);

  out.autoSpin = pIn.autoSpin ?? true;
  out.bottom_thickness = BOTTOM_THICK;

  // precompute balls
  out._balls = computeBalls(out);

  return out;
}

// always enforced wrapper
function constrainParams(pIn = {}, caps = PREVIEW_CAPS) {
  return enforceOverhangSock(pIn, caps);
}

/* ---------------- apply bulges, keep wall constant ---------------- */
function applySockBulges(geom, p) {
  const pos = geom.attributes.position;
  if (!pos) return geom;

  const bottomY = (p.bottom_thickness ?? 3) + 0.1;
  const maxR = MAX_SIZE / 2;
  const headTex = p.texture_headroom ?? 0;

  const v = new THREE.Vector3();
  const radial = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.y <= bottomY) continue;

    const t = THREE.MathUtils.clamp(v.y / p.height, 0, 1);
    const rBaseOut = rOuterAt(t, p);

    let theta = Math.atan2(v.z, v.x);
    if (theta < 0) theta += Math.PI * 2;

    const delta = bulgeFieldMM(theta, v.y, p);

    const rOutTarget = Math.min(rBaseOut + delta, maxR - headTex);
    const rInTarget  = Math.max(rOutTarget - p.wall, 0.5);

    radial.set(v.x, 0, v.z);
    const r = radial.length();
    if (r < 1e-6) continue;

    const rMid = rBaseOut - p.wall * 0.5;
    const target = r >= rMid ? rOutTarget : rInTarget;

    const s = target / r;
    v.x *= s;
    v.z *= s;

    pos.setXYZ(i, v.x, v.y, v.z);
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}

/* ---------------- build ---------------- */
function buildSockShade(params, caps = PREVIEW_CAPS) {
  const p = constrainParams(params, caps);
  const profile = makeProfileWithHole(p);
  const geom = new THREE.LatheGeometry(profile, p.radialSegments);
  geom.computeVertexNormals();

  applySockBulges(geom, p);

  const entry = textures[p.texture];
  return entry?.apply ? entry.apply(geom, p) : geom;
}

/* ---------------- schema ---------------- */
function schemaFor(params) {
  const base = [
    { key: "height",        label: "Height",             type: "range", min: 80,  max: MAX_SIZE, step: 1 },
    { key: "wall",          label: "Wall thickness",     type: "range", min: MIN_THICK, max: MAX_THICK, step: 0.1 },

    { key: "baseRadius",    label: "Base radius",        type: "range", min: 45, max: MAX_SIZE / 2, step: 0.5 },
    { key: "topRadius",     label: "Top radius",         type: "range", min: 10, max: MAX_SIZE / 2, step: 0.5 },

    // spherical balls
    { key: "b_count",           label: "Ball count",        type: "range", min: 1, max: 70, step: 1 },
    { key: "b_depth",           label: "Ball depth, mm",    type: "range", min: 4, max: 35, step: 0.5 }, // aligned with constraints
    { key: "b_supportDiameter", label: "Ball diameter, mm", type: "range", min: 40, max: 160, step: 1 },
    { key: "b_jitter",          label: "Depth jitter",      type: "range", min: 0, max: 1, step: 0.05 },
    { key: "b_seed",            label: "Seed",              type: "range", min: 0, max: 9999, step: 1 },

    { key: "texture",        label: "Texture",            type: "select", options: textureOptions },
  ];

  const texId = params?.texture ?? (textureOptions[0]?.value ?? "none");
  const texDesc = textures[texId];
  const tex = texDesc?.schema ?? [];

  return [
    ...base,
    ...tex,
    { key: "autoSpin", label: "Auto spin", type: "checkbox" },
  ];
}

/* ---------------- defaults ---------------- */
function defaultsFactory() {
  const firstTex = textureOptions[0]?.value ?? "none";
  const d = {
    height: 220,
    wall: 0.8,

    baseRadius: 60,
    topRadius: 60,

    b_count: 60,
    b_depth: 16,
    b_supportDiameter: 75,
    b_jitter: 0.2,
    b_seed: 1234,

    texture: firstTex,
    autoSpin: true,
  };
  const tex = textures[firstTex];
  return tex?.defaults ? { ...d, ...tex.defaults } : d;
}

/* ---------------- model export ---------------- */
export const models = {
  sock: {
    label: "Sock Balls Shade",
    schema: (params) => schemaFor(params),
    defaults: () => defaultsFactory(),
    build: (p) => buildSockShade(p, PREVIEW_CAPS),
  },
};

function exportSTL(params) {
  import("three-stdlib").then(({ STLExporter }) => {
    const geom = buildSockShade(params, EXPORT_CAPS);
    const exporter = new STLExporter();
    const data = exporter.parse(geom, { binary: true });
    const blob = new Blob([data], { type: "application/sla" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lampshade_sock_balls.stl";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

const label = "Lampshade, Sock Balls";
export default { label, models, export: exportSTL };
