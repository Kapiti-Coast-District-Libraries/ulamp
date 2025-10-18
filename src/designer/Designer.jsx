// src/designer/Designer.jsx
import React from "react";
import * as THREE from "three";
import { packs } from "../packs";
import { palette } from "../colors/palette.js";
import { hiddenPartConfig } from "../hiddenPart/config.js"; // kept in case you switch back
import AutoForm from "./controls/AutoForm.jsx";
import Viewport from "./three/Viewport.jsx";

// simple success modal reused for logging flow
function UploadModal({ open, stage, percent, message, onCancel, canCancel }) {
  if (!open) return null;
  return (
    <div className="upload-modal">
      <div className="upload-card">
        <div className="upload-title">Saving your lamp</div>
        <div className="upload-steps">
          <Step label="Verify payment" active={stage >= 1} done={stage > 1} />
          <Step label="Record order" active={stage >= 2} done={stage > 2} />
          <Step label="Done" active={stage >= 3} done={stage > 3} />
        </div>
        <div className="upload-bar">
          <div className="upload-bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="upload-message">{message}</div>
        <div className="upload-hint">Please keep this tab open while we finish</div>
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

  // guard for success handler
  const ranSuccessRef = React.useRef(false);

  // prevent pack change effect from wiping randomized params once
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

  // randomize pack, params, and color
  const randomizeAll = React.useCallback(() => {
    const allPackKeys = Object.keys(packs);
    const newPackKey = allPackKeys[Math.floor(Math.random() * allPackKeys.length)];
    const newPack = packs[newPackKey];
    const newModelKey = Object.keys(newPack.models)[0];
    const newModel = newPack.models[newModelKey];

    let next = typeof newModel.defaults === "function" ? newModel.defaults() : { ...newModel.defaults };

    const stepPick = (min, max, step = 1) => {
      const steps = Math.max(0, Math.floor((max - min) / step));
      const k = Math.floor(Math.random() * (steps + 1));
      const v = min + k * step;
      return Number.isFinite(v) ? Number(v.toFixed(6)) : min;
    };

    let schema = typeof newModel.schema === "function" ? newModel.schema(next) : newModel.schema;
    const texField = schema?.find(f => f?.type === "select" && f.key === "texture");
    if (texField && Array.isArray(texField.options) && texField.options.length) {
      const rnd = texField.options[Math.floor(Math.random() * texField.options.length)];
      if (rnd?.value !== undefined) next.texture = rnd.value;
    }

    schema = typeof newModel.schema === "function" ? newModel.schema(next) : newModel.schema;
    for (const f of schema || []) {
      if (!f || !f.key) continue;
      const key = String(f.key);
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

    const swatch = palette[Math.floor(Math.random() * palette.length)];
    const newColorHex = swatch?.value || "#dddddd";
    const newColorName = swatch?.name || "Color";

    skipNextDefaultsRef.current = true;
    setPackKey(newPackKey);
    setParams(next);
    setColorHex(newColorHex);
    setColorName(newColorName);
  }, []);

  // prevent tab close during log
  React.useEffect(() => {
    const onBeforeUnload = (e) => {
      if (modalOpen && modalStage > 0 && modalStage < 3) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [modalOpen, modalStage]);

  // success flow, log variables to sheet, no STL, no Drive
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
        setModalPercent(15);
        setUploadMsg("Verifying payment...");

        const r = await fetch(`/api/session/${sessionId}`);
        if (!r.ok) {
          setUploadMsg(`Could not verify payment, ${r.status}`);
          setModalCanClose(true);
          return;
        }
        const js = await r.json();
        if (!js?.paid) {
          setUploadMsg("Payment not completed. Refresh this page later.");
          setModalCanClose(true);
          return;
        }

        setModalStage(2);
        setModalPercent(75);
        setUploadMsg("Recording your order to the spreadsheet...");

        const lr = await fetch(`/api/log/${sessionId}`, { method: "POST" });
        if (!lr.ok) {
          const t = await lr.text().catch(() => "");
          setUploadMsg(`Could not record the order, ${lr.status}, ${t}`);
          setModalCanClose(true);
          return;
        }

        setModalStage(3);
        setModalPercent(100);
        setUploadMsg("Order recorded. You can close this window now.");
        setTimeout(() => setModalCanClose(true), 600);
      } catch (e) {
        console.error(e);
        setUploadMsg("Something went wrong while recording your order.");
        setModalCanClose(true);
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete("success");
        url.searchParams.delete("session_id");
        window.history.replaceState({}, "", url.toString());
      }
    };
    run();
  }, []);

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
          <button onClick={onCheckout} title="Pay and save to spreadsheet">Checkout</button>
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

