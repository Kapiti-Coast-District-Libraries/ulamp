// src/designer/Designer.jsx
import React, { useState, useEffect, useRef, useDeferredValue } from "react";
import { palette } from "../colors/palette.js";
import { buildEmbossedCylinderLamp } from "./GeometryBuilder.js";
import { processImageToHeightmap } from "./utils/imageProcessor.js";
import Viewport from "./three/Viewport.jsx";

// Upload Modal / Step Components
function UploadModal({ open, stage, percent, message, onCancel, canCancel }) {
  if (!open) return null;
  return (
    <div className="upload-modal">
      <div className="upload-card">
        <div className="upload-title">Saving your lamp</div>
        <div className="upload-steps">
          <Step label="Verify payment" active={stage >= 1} done={stage > 1} />
          <Step label="Save order" active={stage >= 2} done={stage > 2} />
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

function IntroModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="intro-modal" role="dialog" aria-modal="true" aria-label="Welcome">
      <div className="intro-card">
        <h2 className="intro-title">Design your custom embossed lamp</h2>
        <p className="intro-sub">Upload any image to trace and emboss it onto a 3D cylinder!</p>

        <div className="intro-steps">
          <div className="intro-step">
            <div className="dot" />
            <div className="text">1. Import an image (photos, line art, logos, or patterns)</div>
          </div>
          <div className="intro-step">
            <div className="dot" />
            <div className="text">2. Adjust emboss depth, wrap count, height, and tube size</div>
          </div>
          <div className="intro-step">
            <div className="dot" />
            <div className="text">3. Preview your lamp in 3D with the threaded mounting base</div>
          </div>
          <div className="intro-step">
            <div className="dot" />
            <div className="text">4. Export the 3D STL file ready for 3D printing</div>
          </div>
        </div>

        <div className="intro-actions">
          <button className="secondary" onClick={onClose}>Close</button>
          <button onClick={onClose}>Start designing</button>
        </div>
      </div>
    </div>
  );
}

function PreparingModal({ open, message = "Preparing your file..." }) {
  if (!open) return null;
  return (
    <div className="prep-modal" role="status" aria-live="polite">
      <div className="prep-card">
        <div className="prep-spinner" aria-hidden="true" />
        <div>
          <div className="prep-title">We are preparing your file</div>
          <div className="prep-sub">{message}</div>
        </div>
      </div>
    </div>
  );
}

export default function Designer() {
  // Default parameters for the embossed cylinder tube
  const [params, setParams] = useState({
    height: 180,
    radius: 50,
    wallThickness: 2.0,
    embossDepth: 2.5,
    repeatX: 1,
    invert: false,
    radialSegments: 200,
    resolution: 200,
    heightmapData: null
  });

  const [previewUrl, setPreviewUrl] = useState(null);
  const [loadingImage, setLoadingImage] = useState(false);

  // Performance optimization for Three.js rendering
  const deferredParams = useDeferredValue(params);

  // Color selection state
  const [colorHex, setColorHex] = useState(palette[0]?.value || "#dddddd");
  const [colorName, setColorName] = useState(palette[0]?.name || "Color");

  // Modals & messages
  const [uploadMsg, setUploadMsg] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStage, setModalStage] = useState(0);
  const [modalPercent, setModalPercent] = useState(0);
  const [modalCanClose, setModalCanClose] = useState(false);

  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [preparingOpen, setPreparingOpen] = useState(false);
  const [preparingMsg, setPreparingMsg] = useState("Preparing your file...");

  const ranSuccessRef = useRef(false);
  const viewportRef = useRef();

  // Warm server on load
  useEffect(() => {
    fetch("/api/health").catch(() => {});
  }, []);

  // Show intro modal on fresh visits
  useEffect(() => {
    const usp = new URLSearchParams(window.location.search);
    const hasSuccess = !!usp.get("success");
    const hasSession = !!usp.get("session_id");
    setWelcomeOpen(!hasSuccess || !hasSession);
  }, []);

  // Payment success handler
  useEffect(() => {
    const usp = new URLSearchParams(window.location.search);
    const success = usp.get("success");
    const sessionId = usp.get("session_id");
    if (!success || !sessionId || ranSuccessRef.current) return;
    ranSuccessRef.current = true;

    setWelcomeOpen(false);
    setModalOpen(true);
    setModalCanClose(false);
    setModalStage(1);
    setModalPercent(15);
    setUploadMsg("Verifying payment...");

    const run = async () => {
      try {
        const r = await fetch(`/api/session/${sessionId}`);
        if (!r.ok) {
          setUploadMsg(`Could not verify payment, ${r.status}`);
          setModalCanClose(true);
          return;
        }
        const js = await r.json();
        if (!js?.paid) {
          setUploadMsg("Payment not completed.");
          setModalCanClose(true);
          return;
        }

        setModalStage(2);
        setModalPercent(75);
        setUploadMsg("Saving your order...");

        const lr = await fetch(`/api/log/${sessionId}`, { method: "POST" });
        if (!lr.ok) {
          const t = await lr.text().catch(() => "");
          setUploadMsg(`Could not save the order: ${t}`);
          setModalCanClose(true);
          return;
        }

        setModalStage(3);
        setModalPercent(100);
        setUploadMsg("Order saved successfully!");
        setTimeout(() => setModalCanClose(true), 600);
      } catch (e) {
        console.error(e);
        setUploadMsg("Something went wrong while saving your order.");
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

  // Handle image upload
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      setLoadingImage(true);
      const heightmap = await processImageToHeightmap(file, 256);
      setPreviewUrl(heightmap.previewUrl);
      setParams((prev) => ({ ...prev, heightmapData: heightmap }));
    } catch (err) {
      console.error("Error loading image:", err);
      alert("Failed to process image file. Please try a valid PNG or JPG.");
    } finally {
      setLoadingImage(false);
    }
  };

  const handleRemoveImage = () => {
    setPreviewUrl(null);
    setParams((prev) => ({ ...prev, heightmapData: null }));
  };

  const updateParam = (key, value) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const onColorChange = (e) => {
    const val = e.target.value;
    const item = palette.find((p) => p.value === val);
    setColorHex(val);
    setColorName(item?.name || "Color");
  };

  const onExport = () => {
    if (viewportRef.current) {
      viewportRef.current.download();
    }
  };

  const onCheckout = async () => {
    try {
      setPreparingMsg("Preparing your file...");
      setPreparingOpen(true);

      const enriched = { ...params, colorHex, colorName };
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packKey: "embossedCylinder",
          modelKey: "cylinder",
          params: enriched,
          filename: "embossed_lamp.stl"
        })
      });

      if (!r.ok) {
        const t = await r.text().catch(() => "");
        setPreparingOpen(false);
        alert(`Checkout failed: ${t}`);
        return;
      }
      const js = await r.json();
      if (js?.url) {
        setPreparingMsg("Redirecting to checkout...");
        window.location.href = js.url;
      } else {
        setPreparingOpen(false);
        alert("Checkout failed, no checkout URL returned.");
      }
    } catch (e) {
      console.error(e);
      setPreparingOpen(false);
      alert(`Checkout error: ${e?.message || e}`);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Embossed Cylinder Lamp Designer</div>
        <div className="actions">
          <button onClick={onExport} title="Download STL for 3D printing">
            Export STL
          </button>
          <button onClick={onCheckout} title="Pay and order 3D print">
            Checkout
          </button>
        </div>
      </header>

      <main className="layout">
        <aside className="panel">
          {/* IMAGE UPLOAD SECTION */}
          <div className="form-section">
            <div className="section-title">Import Image</div>

            <div className="field">
              <label>Upload Picture / Pattern</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                disabled={loadingImage}
              />
              {loadingImage && <div className="value">Processing image...</div>}
            </div>

            {previewUrl && (
              <div className="field" style={{ marginTop: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <img
                    src={previewUrl}
                    alt="Emboss preview"
                    style={{
                      width: "60px",
                      height: "60px",
                      objectFit: "cover",
                      borderRadius: "6px",
                      border: "1px solid #444"
                    }}
                  />
                  <button
                    className="secondary"
                    onClick={handleRemoveImage}
                    style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* EMBOSSING CONTROLS */}
          <div className="form-section">
            <div className="section-title">Embossing Controls</div>

            <div className="field">
              <label>Emboss Depth (mm)</label>
              <input
                type="range"
                min="-5"
                max="5"
                step="0.1"
                value={params.embossDepth}
                onChange={(e) => updateParam("embossDepth", parseFloat(e.target.value))}
              />
              <div className="value">{params.embossDepth} mm</div>
            </div>

            <div className="field">
              <label>Image Wrap Repeat (X)</label>
              <input
                type="range"
                min="1"
                max="6"
                step="1"
                value={params.repeatX}
                onChange={(e) => updateParam("repeatX", parseInt(e.target.value, 10))}
              />
              <div className="value">{params.repeatX}x</div>
            </div>

            <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: "10px" }}>
              <input
                type="checkbox"
                id="invertCheck"
                checked={params.invert}
                onChange={(e) => updateParam("invert", e.target.checked)}
              />
              <label htmlFor="invertCheck" style={{ margin: 0, cursor: "pointer" }}>
                Invert Image Brightness
              </label>
            </div>
          </div>

          {/* TUBE DIMENSIONS */}
          <div className="form-section">
            <div className="section-title">Lamp Tube Dimensions</div>

            <div className="field">
              <label>Tube Height (mm)</label>
              <input
                type="range"
                min="100"
                max="240"
                step="5"
                value={params.height}
                onChange={(e) => updateParam("height", parseFloat(e.target.value))}
              />
              <div className="value">{params.height} mm</div>
            </div>

            <div className="field">
              <label>Tube Outer Radius (mm)</label>
              <input
                type="range"
                min="45"
                max="90"
                step="1"
                value={params.radius}
                onChange={(e) => updateParam("radius", parseFloat(e.target.value))}
              />
              <div className="value">{params.radius} mm</div>
            </div>

            <div className="field">
              <label>Wall Thickness (mm)</label>
              <input
                type="range"
                min="1.2"
                max="3.5"
                step="0.1"
                value={params.wallThickness}
                onChange={(e) => updateParam("wallThickness", parseFloat(e.target.value))}
              />
              <div className="value">{params.wallThickness} mm</div>
            </div>
          </div>

          {/* COLOR SELECTION */}
          <div className="form-section">
            <div className="section-title">Material & Color</div>
            <div className="field">
              <label>Lamp Color</label>
              <select value={colorHex} onChange={onColorChange}>
                {palette.map(({ name, value }) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {uploadMsg && <div className="notice">{uploadMsg}</div>}
        </aside>

        <section className="viewport">
          <Viewport
            ref={viewportRef}
            builder={buildEmbossedCylinderLamp}
            params={deferredParams}
            color={colorHex}
            autoSpin={false}
          />
        </section>
      </main>

      <footer className="footer">
        3D Custom Embossed Lamp Designer • Built with React & Three.js
      </footer>

      <UploadModal
        open={modalOpen}
        stage={modalStage}
        percent={modalPercent}
        message={uploadMsg}
        canCancel={modalCanClose}
        onCancel={() => setModalOpen(false)}
      />

      <IntroModal open={welcomeOpen} onClose={() => setWelcomeOpen(false)} />
      <PreparingModal open={preparingOpen} message={preparingMsg} />
    </div>
  );
}
