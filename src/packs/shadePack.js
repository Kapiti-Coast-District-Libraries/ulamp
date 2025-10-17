// src/packs/shadePack.js
import * as THREE from "three";
import { textures, textureOptions, textureOrder } from "../textures";

const MAX_SIZE = 240;   // mm for height and diameter
const MIN_THICK = 0.8;  // mm
const BOTTOM_THICK = 3; // mm

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
const PREVIEW_CAPS = { maxRadial: 540, maxRes: 700, stepMM: 0.6, perBandBase: 18 };
const EXPORT_CAPS  = { maxRadial: 1200, maxRes: 1400, stepMM: 0.4, perBandBase: 22 };

function firstTextureId() { return textureOrder[0] ?? "none"; }
function withTextureDefaults(params) {
  const texKey = params?.texture ?? firstTextureId();
  const desc = textures[texKey];
  return desc?.defaults ? { ...desc.defaults, ...params, texture: texKey } : { ...params, texture: texKey };
}

/* base outer radius along height, with reserved headroom */
function rOuterAt(t, p) {
  let r = p.baseRadius + (p.topRadius - p.baseRadius) * t;
  const sigma = 0.15 * p.height;
  const y = t * p.height;
  const yc = p.bellyHeight * p.height;
  const belly = p.belly * Math.exp(-((y - yc) ** 2) / (2 * sigma ** 2));
  r += belly;
  const maxR = MAX_SIZE / 2;
  r = Math.min(r, Math.max(0.5, maxR - (p.texture_headroom ?? 0)));
  return r;
}
function rInnerAt(t, p) { return Math.max(rOuterAt(t, p) - p.wall, 0.5); }

function recommendedRadialSegments(p, caps) {
  const bands =
    p.texture === "diagonalWeave" ? (p.t_weave_bands ?? 28) :
    p.texture === "verticalRibs"  ? (p.t_ribs_count ?? 24)  :
    p.texture === "spiralBands"   ? (p.t_spiral_bands ?? 8) :
    24;
  const sharp =
    p.texture === "diagonalWeave" ? (p.t_weave_sharpness ?? 3) :
    p.texture === "verticalRibs"  ? (p.t_ribs_sharpness ?? 4) :
    p.texture === "spiralBands"   ? (p.t_spiral_sharpness ?? 3) :
    3;

  const perBand = Math.max(12, caps.perBandBase + 2 * (sharp - 3));
  const want = Math.max(96, bands * perBand);
  return clamp(Math.round(want), 48, caps.maxRadial);
}
function recommendedResolution(p, caps) {
  const base = Math.ceil((p.height ?? 220) / caps.stepMM);
  return clamp(base, 140, caps.maxRes);
}

function constrainParams(pIn = {}, caps = PREVIEW_CAPS) {
  const p0 = withTextureDefaults(pIn);
  const out = { ...p0 };

  // core shape
  out.height = clamp(p0.height ?? 220, 80, MAX_SIZE);
  out.wall   = clamp(p0.wall ?? 1.0, MIN_THICK, 1.5);

  // base cannot go below 90 mm radius, and must clear wall
  const baseMin = Math.max(45, out.wall + 2);
  out.baseRadius = clamp(p0.baseRadius ?? 110, baseMin, MAX_SIZE / 2);

  // top can be slimmer, just clear wall
  const topMin = out.wall + 2;
  out.topRadius  = clamp(p0.topRadius  ?? 90,  topMin, MAX_SIZE / 2);

  out.belly       = clamp(p0.belly ?? 20, 0, 40);
  out.bellyHeight = clamp(p0.bellyHeight ?? 0.5, 0.2, 0.8);

  // texture headroom
  const texDesc = textures[out.texture] || null;
  const headroom = texDesc?.headroom ? texDesc.headroom(out) : 0;
  out.texture_headroom = Math.max(0, Math.min(3.0, headroom));

  // auto detail
  const recRad = recommendedRadialSegments(out, caps);
  const recRes = recommendedResolution(out, caps);
  out.radialSegments = recRad;
  out.resolution = recRes;

  // bottom hole, clamp to inner radius at slab height
  const H = out.height;
  const rInnerSlab = Math.max(rOuterAt(BOTTOM_THICK / H, out) - out.wall, 0.5);
  const wantedDia = clamp(p0.holeDiameter ?? 80, 20, 200);
  const maxDia = Math.max(10, 2 * (rInnerSlab - 0.5));
  out.holeDiameter = clamp(wantedDia, 20, maxDia);
  out._holeRadius = out.holeDiameter * 0.5;

  out.autoSpin = p0.autoSpin ?? true;
  out.bottom_thickness = BOTTOM_THICK;
  return out;
}

function makeProfileWithHole(p) {
  const pts = [];
  const H = p.height;
  const N = p.resolution;
  const rHole = Math.max(1, p._holeRadius || 0);

  // start at inner hole edge on the bottom
  pts.push(new THREE.Vector2(rHole, 0));
  // go to the outer bottom edge
  pts.push(new THREE.Vector2(rOuterAt(0, p), 0));

  // outer wall up
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    pts.push(new THREE.Vector2(rOuterAt(t, p), t * H));
  }

  // inner rim at top, keep open
  const rTopIn = Math.max(rInnerAt(1, p), 0.5);
  pts.push(new THREE.Vector2(rTopIn, H));

  // inner wall down to slab
  for (let i = N - 1; i >= 0; i--) {
    const t = i / N;
    const y = t * H;
    if (y < BOTTOM_THICK) break;
    pts.push(new THREE.Vector2(rInnerAt(t, p), y));
  }

  // across the slab to the hole radius, then close down to the bottom inner edge
  const rInSlab = Math.max(rInnerAt(BOTTOM_THICK / H, p), 0.5);
  pts.push(new THREE.Vector2(Math.min(rInSlab, rHole), BOTTOM_THICK));
  pts.push(new THREE.Vector2(rHole, BOTTOM_THICK));
  pts.push(new THREE.Vector2(rHole, 0));

  return pts;
}

function buildSolidShade(params) {
  const p = constrainParams(params, PREVIEW_CAPS);
  const profile = makeProfileWithHole(p);
  const geom = new THREE.LatheGeometry(profile, p.radialSegments);
  geom.computeVertexNormals();

  const texDesc = textures[p.texture];
  return texDesc?.apply ? texDesc.apply(geom, p) : geom;
}

// dynamic schema, base radius min 90 mm, hole slider included
function schemaFor(params) {
  const texKey = params?.texture ?? firstTextureId();
  const texDesc = textures[texKey];
  const base = [
    { key: "height",     label: "Height",         type: "range", min: 80,  max: MAX_SIZE, step: 1 },
    { key: "baseRadius", label: "Base radius",    type: "range", min: 45,  max: MAX_SIZE / 2, step: 0.5 },
    { key: "topRadius",  label: "Top radius",     type: "range", min: 10,  max: MAX_SIZE / 2, step: 0.5 },
    { key: "wall",       label: "Wall thickness", type: "range", min: MIN_THICK, max: 1.2, step: 0.1 },
    { key: "belly",      label: "Belly amount",   type: "range", min: 0,   max: 40, step: 0.5 },
    { key: "bellyHeight",label: "Belly height",   type: "range", min: 0.2, max: 0.8, step: 0.01 },


    { key: "texture",    label: "Texture",        type: "select", options: textureOptions },
  ];
  const tex = texDesc?.schema ?? [];
  const tail = [{ key: "autoSpin", label: "Auto spin", type: "checkbox" }];
  return [...base, ...tex, ...tail];
}

function defaultsFactory() {
  const first = firstTextureId();
  const d = {
    height: 220,
    baseRadius: 75,
    topRadius: 90,
    wall: 0.8,
    belly: 20,
    bellyHeight: 0.5,
    holeDiameter: 80,

    texture: first,
    autoSpin: true,
  };
  const tex = textures[first];
  return tex?.defaults ? { ...d, ...tex.defaults } : d;
}

export const models = {
  solid: {
    label: "Solid Wall Shade",
    schema: (params) => schemaFor(params),
    defaults: () => defaultsFactory(),
    build: (p) => buildSolidShade(p),
  },
};

function exportSTL(params) {
  import("three-stdlib").then(({ STLExporter }) => {
    const p = constrainParams(params, EXPORT_CAPS);
    const profile = makeProfileWithHole(p);
    const geom = new THREE.LatheGeometry(profile, p.radialSegments);
    geom.computeVertexNormals();

    const texDesc = textures[p.texture];
    const textured = texDesc?.apply ? texDesc.apply(geom, p) : geom;

    const exporter = new STLExporter();
    const data = exporter.parse(textured, { binary: true });
    const blob = new Blob([data], { type: "application/sla" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lampshade_solid_wall_textured.stl";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

const label = "Lampshade, Solid";
export default { label, models, export: exportSTL };
