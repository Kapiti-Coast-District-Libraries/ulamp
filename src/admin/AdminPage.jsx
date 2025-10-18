// src/admin/AdminPage.jsx
import React from "react";
import * as THREE from "three";
import { packs } from "../packs";
import { hiddenPartConfig } from "../hiddenPart/config.js";
import Viewport from "../designer/three/Viewport.jsx"; // reuse your viewer
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* hidden STL loader cache, same pattern as Designer */
const hiddenCache = { promise: null, geom: null };
async function loadHiddenGeometry() {
  if (!hiddenPartConfig?.include) return null;
  if (hiddenCache.geom) return hiddenCache.geom;
  if (!hiddenCache.promise) {
    hiddenCache.promise = (async () => {
      try {
        const resp = await fetch(hiddenPartConfig.url, { cache: "force-cache" });
        if (!resp.ok) throw new Error(`fetch ${hiddenPartConfig.url} failed, ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const loader = new STLLoader();
        const geom = loader.parse(buf);
        hiddenCache.geom = geom;
        return geom;
      } catch (e) {
        console.warn("hidden part load failed", e);
        return null;
      }
    })();
  }
  return hiddenCache.promise;
}

function getBBox(geom) {
  const g = geom.clone();
  g.computeBoundingBox();
  return g.boundingBox;
}
function centerMatrix(geom, mode) {
  const bb = getBBox(geom);
  if (!bb) return new THREE.Matrix4();
  const center = new THREE.Vector3();
  bb.getCenter(center);
  const m = new THREE.Matrix4();
  if (mode === "bboxCenter") {
    m.makeTranslation(-center.x, -center.y, -center.z);
  } else if (mode === "footToY0") {
    const midX = (bb.min.x + bb.max.x) * 0.5;
    const midZ = (bb.min.z + bb.max.z) * 0.5;
    m.makeTranslation(-midX, -bb.min.y, -midZ);
  }
  return m;
}
function transformHiddenGeometry(src) {
  if (!src) return null;
  const g = src.clone();
  const mats = [];
  const up = String(hiddenPartConfig.upAxis || "Y").toUpperCase();
  if (up === "Z") mats.push(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(-90)));
  else if (up === "X") mats.push(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(90)));
  const us = Number(hiddenPartConfig.unitScale ?? 1) || 1;
  if (us !== 1) mats.push(new THREE.Matrix4().makeScale(us, us, us));
  const cmode = hiddenPartConfig.centerMode || "none";
  if (cmode === "bboxCenter" || cmode === "footToY0") mats.push(centerMatrix(g, cmode));
  const lo = hiddenPartConfig.localOffset || [0, 0, 0];
  if (lo[0] || lo[1] || lo[2]) mats.push(new THREE.Matrix4().makeTranslation(lo[0] || 0, lo[1] || 0, lo[2] || 0));
  const rd = hiddenPartConfig.rotationDeg || [0, 0, 0];
  if (rd[0] || rd[1] || rd[2]) {
    const e = new THREE.Euler(
      THREE.MathUtils.degToRad(rd[0] || 0),
      THREE.MathUtils.degToRad(rd[1] || 0),
      THREE.MathUtils.degToRad(rd[2] || 0),
      "XYZ"
    );
    mats.push(new THREE.Matrix4().makeRotationFromEuler(e));
  }
  const s = hiddenPartConfig.scale || [1, 1, 1];
  if (s[0] !== 1 || s[1] !== 1 || s[2] !== 1) mats.push(new THREE.Matrix4().makeScale(s[0] || 1, s[1] || 1, s[2] || 1));
  const p = hiddenPartConfig.position || [0, 0, 0];
  if (p[0] || p[1] || p[2]) mats.push(new THREE.Matrix4().makeTranslation(p[0] || 0, p[1] || 0, p[2] || 0));
  const mat = mats.reduce((acc, m) => acc.multiply(m), new THREE.Matrix4());
  g.applyMatrix4(mat);
  const bb = getBBox(g);
  if (bb) {
    const finalMats = [];
    if (hiddenPartConfig.lockCenterXZTo0) {
      const midX = (bb.min.x + bb.max.x) * 0.5;
      const midZ = (bb.min.z + bb.max.z) * 0.5;
      if (Math.abs(midX) > 1e-6 || Math.abs(midZ) > 1e-6) {
        finalMats.push(new THREE.Matrix4().makeTranslation(-midX, 0, -midZ));
      }
    }
    if (hiddenPartConfig.lockBaseYTo0 && Math.abs(bb.min.y) > 1e-6) {
      finalMats.push(new THREE.Matrix4().makeTranslation(0, -bb.min.y, 0));
    }
    if (finalMats.length) {
      const fm = finalMats.reduce((acc, m) => acc.multiply(m), new THREE.Matrix4());
      g.applyMatrix4(fm);
    }
  }
  return g;
}
function normalizeForMerge(geom) {
  let g = geom.clone();
  if (g.index) g = g.toNonIndexed();
  for (const key of Object.keys(g.attributes)) {
    if (key !== "position" && key !== "normal") g.deleteAttribute(key);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  return g.clone();
}
async function buildMergedGeometry(builder, lampParams, includeHidden) {
  const lampRaw = builder(lampParams);
  const geoms = [normalizeForMerge(lampRaw)];
  if (includeHidden) {
    try {
      const hid = await loadHiddenGeometry();
      if (hid) {
        const hidT = transformHiddenGeometry(hid);
        if (hidT) geoms.push(normalizeForMerge(hidT));
      }
    } catch {
      // ignore
    }
  }
  const merged = mergeGeometries(geoms, true);
  if (!merged) return geoms[0];
  if (!merged.attributes.normal) merged.computeVertexNormals();
  return merged;
}

export default function AdminPage() {
  const packKeys = Object.keys(packs);
  const [packKey, setPackKey] = React.useState(packKeys[0] || "");
  const [modelKey, setModelKey] = React.useState(
    packKey ? Object.keys(packs[packKey].models)[0] : ""
  );
  const [paramsText, setParamsText] = React.useState("{}");
  const [color, setColor] = React.useState("#dddddd");
  const [autoIncludeHidden, setAutoIncludeHidden] = React.useState(!!hiddenPartConfig?.include);
  const [status, setStatus] = React.useState("");

  const pack = packs[packKey];
  const model = pack?.models?.[modelKey];

  React.useEffect(() => {
    if (packKey && packs[packKey]) {
      const first = Object.keys(packs[packKey].models)[0];
      setModelKey(first);
    }
  }, [packKey]);

  // support pasting a full spreadsheet JSON blob
  const onPasteRow = () => {
    try {
      const raw = prompt("Paste the JSON blob from the sheet row, or just Params JSON");
      if (!raw) return;
      let packK = packKey;
      let modelK = modelKey;
      let pText = paramsText;

      // try object with fields
      try {
        const obj = JSON.parse(raw);
        if (obj.paramsJson) pText = obj.paramsJson;
        if (obj.packKey) packK = obj.packKey;
        if (obj.modelKey) modelK = obj.modelKey;
        if (obj.colorName && obj.colorHex) {
          // optional, if you ever log colorHex too
          setColor(obj.colorHex);
        }
      } catch {
        // else treat it as direct params JSON
        pText = raw;
      }
      setPackKey(packK);
      setModelKey(modelK);
      setParamsText(pText);
      setStatus("Row loaded");
    } catch (e) {
      setStatus("Could not parse pasted content");
    }
  };

  const safeParams = React.useMemo(() => {
    try {
      const js = JSON.parse(paramsText || "{}");
      return js;
    } catch {
      return {};
    }
  }, [paramsText]);

  const canBuild = !!model && typeof model.build === "function";

  const onDownload = async () => {
    if (!canBuild) {
      setStatus("Missing model builder");
      return;
    }
    try {
      setStatus("Building...");
      const merged = await buildMergedGeometry(model.build, safeParams, autoIncludeHidden);
      const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial());
      const exporter = new STLExporter();
      const buf = exporter.parse(mesh, { binary: true });
      const blob = new Blob([buf], { type: "application/sla" });
      const fname = `manual_${packKey}_${modelKey}.stl`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus("Downloaded");
    } catch (e) {
      console.error(e);
      setStatus("Failed to export STL");
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", height: "100vh" }}>
      <aside style={{ padding: 16, borderRight: "1px solid #ddd", overflow: "auto" }}>
        <h2>Admin STL Export</h2>

        <div className="field">
          <button onClick={onPasteRow}>Paste from sheet</button>
        </div>

        <div className="field">
          <label>Pack key</label>
          <select value={packKey} onChange={(e) => setPackKey(e.target.value)}>
            {packKeys.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <div className="field">
          <label>Model key</label>
          <select value={modelKey} onChange={(e) => setModelKey(e.target.value)}>
            {pack && Object.keys(pack.models).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <div className="field">
          <label>Params JSON</label>
          <textarea
            rows={12}
            value={paramsText}
            onChange={(e) => setParamsText(e.target.value)}
            placeholder='{"height":220,"baseRadius":110,...}'
            style={{ width: "100%", fontFamily: "monospace" }}
          />
        </div>

        <div className="field">
          <label>Preview color</label>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </div>

        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={autoIncludeHidden}
              onChange={(e) => setAutoIncludeHidden(e.target.checked)}
            />
            Include hidden insert
          </label>
        </div>

        <div className="actions" style={{ display: "flex", gap: 8 }}>
          <button onClick={onDownload} disabled={!canBuild}>Download STL</button>
        </div>

        <div style={{ marginTop: 8, color: "#666" }}>{status}</div>
      </aside>

      <section style={{ position: "relative" }}>
        {canBuild ? (
          <Viewport
            builder={(p) => packs[packKey].models[modelKey].build(p)}
            params={safeParams}
            color={color}
            autoSpin={true}
          />
        ) : (
          <div style={{ padding: 24 }}>Select a valid pack and model</div>
        )}
      </section>
    </div>
  );
}
