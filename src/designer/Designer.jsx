// src/designer/Designer.jsx
import React from "react";
import * as THREE from "three";
import { packs } from "../packs";
import { palette } from "../colors/palette.js";
import { hiddenPartConfig } from "../hiddenPart/config.js";
import AutoForm from "./controls/AutoForm.jsx";
import Viewport from "./three/Viewport.jsx";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

/* full screen upload modal */
function UploadModal({ open, stage, percent, message, onCancel, canCancel }) {
  if (!open) return null;
  return (
    <div className="upload-modal">
      <div className="upload-card">
        <div className="upload-title">Saving your lamp</div>
        <div className="upload-steps">
          <Step label="Verify payment" active={stage >= 1} done={stage > 1} />
          <Step label="Prepare STL" active={stage >= 2} done={stage > 2} />
          <Step label="Upload to Drive" active={stage >= 3} done={stage > 3} />
          <Step label="Done" active={stage >= 4} done={stage > 4} />
        </div>
        <div className="upload-bar">
          <div className="upload-bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="upload-message">{message}</div>
        <div className="upload-title">Please keep this tab open until we finish uploading, it may take a couple of minutes if complex</div>
        <div className="upload-actions">
          <button onClick={onCancel} disabled={!canCancel}>Close</button>
        </div>
      </div>
    </div>
  );
}
function Step({ label, active, done }) {
  return (
    <div className={`step ${done ? "done" : active ? "active" : ""}`}>
      <div className="dot" />
      <div className="label">{label}</div>
    </div>
  );
}

/* hidden STL loader cache */
const hiddenCache = { promise: null, geom: null };

async function loadHiddenGeometry() {
  if (!hiddenPartConfig.include) return null;
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

/* bbox helpers */
function getBBox(geom) {
  const g = geom.clone();
  g.computeBoundingBox();
  return g.boundingBox;
}

/* center matrix for two modes */
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

/* build a single precise transform for the hidden part */
function transformHiddenGeometry(src) {
  if (!src) return null;
  const g = src.clone();

  const mats = [];

  // up axis to Y up
  const up = String(hiddenPartConfig.upAxis || "Y").toUpperCase();
  if (up === "Z") {
    mats.push(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(-90)));
  } else if (up === "X") {
    mats.push(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(90)));
  }

  // unit scale
  const us = Number(hiddenPartConfig.unitScale ?? 1) || 1;
  if (us !== 1) mats.push(new THREE.Matrix4().makeScale(us, us, us));

  // pre center
  const cmode = hiddenPartConfig.centerMode || "none";
  if (cmode === "bboxCenter" || cmode === "footToY0") {
    mats.push(centerMatrix(g, cmode));
  }

  // local offset
  const lo = hiddenPartConfig.localOffset || [0, 0, 0];
  if (lo[0] || lo[1] || lo[2]) {
    mats.push(new THREE.Matrix4().makeTranslation(lo[0] || 0, lo[1] || 0, lo[2] || 0));
  }

  // user rotation and scale
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
  if (s[0] !== 1 || s[1] !== 1 || s[2] !== 1) {
    mats.push(new THREE.Matrix4().makeScale(s[0] || 1, s[1] || 1, s[2] || 1));
  }

  // world position
  const p = hiddenPartConfig.position || [0, 0, 0];
  if (p[0] || p[1] || p[2]) {
    mats.push(new THREE.Matrix4().makeTranslation(p[0] || 0, p[1] || 0, p[2] || 0));
  }

  // compose, apply
  const mat = mats.reduce((acc, m) => acc.multiply(m), new THREE.Matrix4());
  g.applyMatrix4(mat);

  // final hard locks for precision
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
    if (hiddenPartConfig.lockBaseYTo0) {
      if (Math.abs(bb.min.y) > 1e-6) {
        finalMats.push(new THREE.Matrix4().makeTranslation(0, -bb.min.y, 0));
      }
    }
    if (finalMats.length) {
      const fm = finalMats.reduce((acc, m) => acc.multiply(m), new THREE.Matrix4());
      g.applyMatrix4(fm);
    }
  }

  return g;
}

/* normalize geometry for robust merge, keep only position and normal, non indexed */
function normalizeForMerge(geom) {
  let g = geom.clone();
  if (g.index) g = g.toNonIndexed();
  for (const key of Object.keys(g.attributes)) {
    if (key !== "position" && key !== "normal") g.deleteAttribute(key);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  return g.clone();
}

/* build lamp plus hidden insert merged as one BufferGeometry */
async function buildMergedGeometry(builder, lampParams) {
  const lampRaw = builder(lampParams);
  const geoms = [normalizeForMerge(lampRaw)];
  try {
    const hid = await loadHiddenGeometry();
    if (hid) {
      const hidT = transformHiddenGeometry(hid);
      if (hidT) geoms.push(normalizeForMerge(hidT));
    }
  } catch {
    // ignore hidden load errors
  }
  const merged = mergeGeometries(geoms, true);
  if (!merged) {
    console.warn("mergeGeometries returned null, exporting lamp only");
    return geoms[0];
  }
  if (!merged.attributes.normal) merged.computeVertexNormals();
  return merged;
}

export default function Designer() {
  const packKeys = Object.keys(packs);
  const firstPack = packKeys[0] || "";

  const [packKey, setPackKey] = React.useState(firstPack);
  const safePackKey = packKeys.includes(packKey) ? packKey : firstPack;
  const pack = packs[safePackKey];

  const modelKey = Object.keys(pack.models)[0];
  const model = pack.models[modelKey];

  const computeDefaults = React.useCallback(() => {
    return typeof model.defaults === "function" ? model.defaults() : model.defaults;
  }, [model]);

  const [params, setParams] = React.useState(computeDefaults);
  const [uploadMsg, setUploadMsg] = React.useState("");

  // color
  const [colorHex, setColorHex] = React.useState(palette[0]?.value || "#dddddd");
  const [colorName, setColorName] = React.useState(palette[0]?.name || "Color");

  // modal
  const [modalOpen, setModalOpen] = React.useState(false);
  const [modalStage, setModalStage] = React.useState(0);
  const [modalPercent, setModalPercent] = React.useState(0);
  const [modalCanClose, setModalCanClose] = React.useState(false);

  // one time guard
  const ranSuccessRef = React.useRef(false);

  // prevent the pack change effect from wiping randomized params
  const skipNextDefaultsRef = React.useRef(false);

  React.useEffect(() => {
    if (skipNextDefaultsRef.current) {
      skipNextDefaultsRef.current = false;
      return;
    }
    const m = packs[safePackKey].models[Object.keys(packs[safePackKey].models)[0]];
    setParams(typeof m.defaults === "function" ? m.defaults() : m.defaults);
  }, [safePackKey]);

  const onReset = () => {
    setParams(computeDefaults());
  };

  const randomizeAll = React.useCallback(() => {
    // pick a random pack
    const allPackKeys = Object.keys(packs);
    const newPackKey = allPackKeys[Math.floor(Math.random() * allPackKeys.length)];
    const newPack = packs[newPackKey];
    const newModelKey = Object.keys(newPack.models)[0];
    const newModel = newPack.models[newModelKey];

    // start from that model defaults
    let next = typeof newModel.defaults === "function" ? newModel.defaults() : { ...newModel.defaults };

    // helper to pick a stepped number
    const stepPick = (min, max, step = 1) => {
      const steps = Math.max(0, Math.floor((max - min) / step));
      const k = Math.floor(Math.random() * (steps + 1));
      const v = min + k * step;
      return Number.isFinite(v) ? Number(v.toFixed(6)) : min;
    };

    // maybe choose a random texture first, so schema can depend on it
    let schema = typeof newModel.schema === "function" ? newModel.schema(next) : newModel.schema;
    const texField = schema?.find(f => f?.type === "select" && f.key === "texture");
    if (texField && Array.isArray(texField.options) && texField.options.length) {
      const rnd = texField.options[Math.floor(Math.random() * texField.options.length)];
      if (rnd?.value !== undefined) next.texture = rnd.value;
    }

    // now randomize all range, checkbox, select fields
    schema = typeof newModel.schema === "function" ? newModel.schema(next) : newModel.schema;
    for (const f of schema || []) {
      if (!f || !f.key) continue;
      const key = String(f.key);
      // keep hole settings and auto spin as is, change if you prefer
      if (key.toLowerCase().includes("hole")) continue;

      if (f.type === "range") {
        const min = Number.isFinite(f.min) ? f.min : 0;
        const max = Number.isFinite(f.max) ? f.max : 1;
        const step = Number.isFinite(f.step) ? f.step : 1;
        next[key] = stepPick(min, max, step);
      } else if (f.type === "checkbox") {
        next[key] = Math.random() < 0.5;
      } else if (f.type === "select" && Array.isArray(f.options) && f.options.length) {
        const opt = f.options[Math.floor(Math.random() * f.options.length)];
        if (opt?.value !== undefined) next[key] = opt.value;
      }
    }

    // pick a random color
    const swatch = palette[Math.floor(Math.random() * palette.length)];
    const newColorHex = swatch?.value || "#dddddd";
    const newColorName = swatch?.name || "Color";

    // apply states, skip default reset one time
    skipNextDefaultsRef.current = true;
    setPackKey(newPackKey);
    setParams(next);
    setColorHex(newColorHex);
    setColorName(newColorName);
  }, []);

  // export STL blob, merged with hidden part
  const exportSTLBlob = React.useCallback(async (p) => {
    const { STLExporter } = await import("three-stdlib");
    const geom = await buildMergedGeometry(model.build, p);
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
    const exporter = new STLExporter();
    const arrayBuffer = exporter.parse(mesh, { binary: true });
    return new Blob([arrayBuffer], { type: "application/sla" });
  }, [model]);

  // XHR upload with progress
  const uploadWithProgress = React.useCallback((sessionId, fileName, blob, onProgress) => {
    return new Promise((resolve, reject) => {
      try {
        const form = new FormData();
        form.append("session_id", sessionId);
        form.append("filename", fileName);
        form.append("file", blob, fileName);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && typeof onProgress === "function") {
            const pct = Math.max(0, Math.min(100, Math.round((e.loaded / e.total) * 100)));
            onProgress(pct);
          }
        };
        xhr.onreadystatechange = () => {
          if (xhr.readyState === 4) {
            try {
              const js = JSON.parse(xhr.responseText || "{}");
              if (xhr.status >= 200 && xhr.status < 300 && js?.ok) resolve(js);
              else reject(new Error(`Upload failed, ${xhr.status}, ${(js && (js.error || js.message)) || "no body"}`));
            } catch {
              reject(new Error(`Upload failed, ${xhr.status}, invalid JSON`));
            }
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(form);
      } catch (e) {
        reject(e);
      }
    });
  }, []);

  // prevent tab close during upload
  React.useEffect(() => {
    const onBeforeUnload = (e) => {
      if (modalOpen && modalStage > 0 && modalStage < 4) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [modalOpen, modalStage]);

  // success flow, fetch design from our server instead of Stripe metadata
  React.useEffect(() => {
    const usp = new URLSearchParams(window.location.search);
    const success = usp.get("success");
    const sessionId = usp.get("session_id");
    if (!success || !sessionId) return;
    if (ranSuccessRef.current) return;
    ranSuccessRef.current = true;

    const run = async () => {
      try {
        setModalOpen(true);
        setModalCanClose(false);
        setModalStage(1);
        setModalPercent(5);
        setUploadMsg("Verifying payment...");

        const r = await fetch(`/api/session/${sessionId}`);
        if (!r.ok) {
          setUploadMsg(`Could not verify payment, ${r.status}`);
          setModalCanClose(true);
          return;
        }
        const js = await r.json();
        if (!js?.paid) {
          setUploadMsg("Payment not completed yet. Refresh this page later.");
          setModalCanClose(true);
          return;
        }

        // fetch our stored design
        setModalStage(2);
        setUploadMsg("Preparing STL...");
        const or = await fetch(`/api/orders/${sessionId}`);
        if (!or.ok) {
          setUploadMsg("Could not load saved design. Please contact support.");
          setModalCanClose(true);
          return;
        }
        const orderJs = await or.json();
        const row = orderJs?.order || {};
        const storedParams = row?.params_json ? JSON.parse(row.params_json) : params;
        const mergedParams = { ...storedParams, colorHex, colorName };

        const metaPack = row.pack_key || safePackKey;
        const metaModel = row.model_key || modelKey;
        const packRef = packs[metaPack] || pack;
        const modelRef = packRef.models[metaModel] || model;

        // build merged geometry with hidden insert
        const geom = await buildMergedGeometry(modelRef.build, mergedParams);

        const { STLExporter } = await import("three-stdlib");
        const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
        const exporter = new STLExporter();
        const buf = exporter.parse(mesh, { binary: true });
        const blob = new Blob([buf], { type: "application/sla" });

        setModalStage(3);
        setUploadMsg("Uploading to Google Drive...");
        await uploadWithProgress(sessionId, row.filename || "lampshade.stl", blob, (pct) => setModalPercent(Math.max(10, pct)));

        setModalStage(4);
        setModalPercent(100);
        setUploadMsg("Uploaded to Drive. You are all set.");
        setTimeout(() => setModalCanClose(true), 800);
      } catch (e) {
        console.error(e);
        setUploadMsg("Something went wrong during upload.");
        setModalCanClose(true);
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete("success");
        url.searchParams.delete("session_id");
        window.history.replaceState({}, "", url.toString());
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorHex, colorName, params, pack, model, modelKey, safePackKey]);

  const onCheckout = async () => {
    try {
      const designName = "lampshade.stl";
      const enriched = { ...params, colorHex, colorName };
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packKey: safePackKey,
          modelKey,
          params: enriched,
          filename: designName
        })
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        alert(`Checkout failed, status ${r.status}, ${t}`);
        return;
      }
      const js = await r.json();
      if (js?.url) window.location.href = js.url;
      else alert("Checkout failed, no URL returned");
    } catch (e) {
      console.error(e);
      alert(`Checkout error, ${e?.message || e}`);
    }
  };

  const onColorChange = (e) => {
    const val = e.target.value;
    const item = palette.find(p => p.value === val);
    setColorHex(val);
    setColorName(item?.name || "Color");
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Parametric Designer</div>
        <div className="actions">
          <button onClick={onCheckout} title="Pay and save to Drive">Checkout</button>
          <button onClick={randomizeAll} title="Randomize everything">Random</button>
          <button onClick={onReset}>Reset</button>
        </div>
      </header>

      <main className="layout">
        <aside className="panel">
          <div className="field">
            <label>Pack</label>
            <select value={safePackKey} onChange={(e) => setPackKey(e.target.value)}>
              {packKeys.map((k) => (
                <option key={k} value={k}>{packs[k].label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Lamp color</label>
            <select value={colorHex} onChange={onColorChange}>
              {palette.map(({ name, value }) => (
                <option key={value} value={value}>{name}</option>
              ))}
            </select>
          </div>

          <AutoForm schema={model.schema} params={params} setParams={setParams} />

          {uploadMsg && <div className="notice">{uploadMsg}</div>}
        </aside>

        <section className="viewport">
          <Viewport builder={model.build} params={params} color={colorHex} autoSpin={params.autoSpin} />
        </section>
      </main>

      <footer className="footer">Built with React and Three.js</footer>

      <UploadModal
        open={modalOpen}
        stage={modalStage}
        percent={modalPercent}
        message={uploadMsg}
        canCancel={modalCanClose}
        onCancel={() => setModalOpen(false)}
      />
    </div>
  );
}
