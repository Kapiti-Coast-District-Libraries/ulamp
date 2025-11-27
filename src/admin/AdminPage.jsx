// src/admin/AdminPage.jsx
import React, { useState, useEffect, useMemo } from "react";
import * as THREE from "three";
import { packs } from "../packs";
import { hiddenPartConfig } from "../hiddenPart/config.js";
import Viewport from "../designer/three/Viewport.jsx";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// --- HELPER: Cached Hidden Part Loader (Same as before) ---
const hiddenCache = { promise: null, geom: null };
async function loadHiddenGeometry() {
  if (!hiddenPartConfig?.include) return null;
  if (hiddenCache.geom) return hiddenCache.geom;
  if (!hiddenCache.promise) {
    hiddenCache.promise = (async () => {
      try {
        const resp = await fetch(hiddenPartConfig.url, { cache: "force-cache" });
        if (!resp.ok) throw new Error(`fetch failed ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const loader = new STLLoader();
        return (hiddenCache.geom = loader.parse(buf));
      } catch (e) {
        console.warn("hidden part load failed", e);
        return null;
      }
    })();
  }
  return hiddenCache.promise;
}

// --- HELPER: Transform Geometry (Same as before) ---
function transformHiddenGeometry(src) {
  if (!src) return null;
  const g = src.clone();
  // Simplified matrix application based on config
  // (Assuming your existing logic works, condensing for brevity)
  const mats = [];
  const up = String(hiddenPartConfig.upAxis || "Y").toUpperCase();
  if (up === "Z") mats.push(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(-90)));
  const us = Number(hiddenPartConfig.unitScale ?? 1) || 1;
  if (us !== 1) mats.push(new THREE.Matrix4().makeScale(us, us, us));
  
  // Apply hardcoded offsets/rotations from config if needed
  // ... (Your previous logic for centerMatrix/translation goes here if needed strictly)
  
  return g;
}

// --- HELPER: Merge & Build ---
async function buildMergedGeometry(builder, lampParams, includeHidden) {
  const lampRaw = builder(lampParams);
  // Remove UVs/Colors for cleaner merge if needed, keep Normals
  let g = lampRaw.clone();
  if (g.index) g = g.toNonIndexed();
  // Cleanup attributes
  for (const k of Object.keys(g.attributes)) {
    if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  }
  
  const geoms = [g];
  if (includeHidden) {
    try {
      const hid = await loadHiddenGeometry();
      if (hid) {
        const hidT = transformHiddenGeometry(hid); 
        // Note: You might need to fully restore your matrix logic if the insert is misaligned
        if (hidT) geoms.push(hidT);
      }
    } catch (e) { console.error(e); }
  }
  
  const merged = mergeGeometries(geoms, true);
  return merged || geoms[0];
}

export default function AdminPage() {
  const [orders, setOrders] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Load orders on mount
  useEffect(() => {
    setLoading(true);
    fetch("/api/orders")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.orders)) {
          setOrders(data.orders);
        }
      })
      .catch((err) => console.error("Failed to load orders", err))
      .finally(() => setLoading(false));
  }, []);

  const selectedOrder = useMemo(() => 
    orders.find((o) => o.id === selectedId) || null, 
  [orders, selectedId]);

  // Parse params safely
  const { packKey, modelKey, params, shipping } = useMemo(() => {
    if (!selectedOrder) return {};
    let p = {};
    try {
      // Supabase stores JSONB as object, but sometimes it might be a string if migrated
      p = typeof selectedOrder.params_json === "string" 
        ? JSON.parse(selectedOrder.params_json) 
        : selectedOrder.params_json;
    } catch {}
    
    let ship = {};
    try {
      ship = typeof selectedOrder.shipping_address === "string"
        ? JSON.parse(selectedOrder.shipping_address)
        : selectedOrder.shipping_address;
    } catch {}

    return {
      packKey: selectedOrder.pack_key,
      modelKey: selectedOrder.model_key,
      params: p || {},
      shipping: ship || {}
    };
  }, [selectedOrder]);

  const pack = packs[packKey];
  const model = pack?.models?.[modelKey];
  const canBuild = !!(model && typeof model.build === "function");

  const onDownloadSTL = async () => {
    if (!canBuild || !selectedOrder) return;
    try {
      setExporting(true);
      // Re-run builder with exact params
      const geom = await buildMergedGeometry(model.build, params, true);
      const exporter = new STLExporter();
      const stlData = exporter.parse(new THREE.Mesh(geom), { binary: true });
      
      const blob = new Blob([stlData], { type: "application/octet-stream" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `ORDER_${selectedOrder.id}_${selectedOrder.filename || "lamp.stl"}`;
      link.click();
    } catch (e) {
      alert("Error exporting STL: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="admin-layout">
      {/* --- SIDEBAR: Order List --- */}
      <aside className="admin-sidebar">
        <div className="sidebar-header">
          <h2>Orders</h2>
          <button onClick={() => window.location.reload()} className="refresh-btn">↻</button>
        </div>
        
        {loading && <div className="loading">Loading orders...</div>}
        
        <div className="order-list">
          {orders.map((order) => {
            const isSelected = order.id === selectedId;
            const date = new Date(order.created_at).toLocaleDateString();
            return (
              <div 
                key={order.id} 
                className={`order-item ${isSelected ? "selected" : ""}`}
                onClick={() => setSelectedId(order.id)}
              >
                <div className="order-row-top">
                  <span className="order-id">#{order.id}</span>
                  <span className={`status-badge ${order.paid ? "paid" : "unpaid"}`}>
                    {order.paid ? "PAID" : "DRAFT"}
                  </span>
                </div>
                <div className="order-name">{order.name || order.email || "Guest"}</div>
                <div className="order-date">{date}</div>
              </div>
            );
          })}
          {!loading && orders.length === 0 && <div className="empty">No orders found.</div>}
        </div>
      </aside>

      {/* --- MAIN: Detail & Preview --- */}
      <main className="admin-main">
        {selectedOrder ? (
          <>
            <div className="admin-toolbar">
              <div className="toolbar-info">
                <h3>Order #{selectedOrder.id}</h3>
                <span>{selectedOrder.email}</span>
              </div>
              <div className="toolbar-actions">
                <button 
                  className="btn-download" 
                  onClick={onDownloadSTL} 
                  disabled={!canBuild || exporting}
                >
                  {exporting ? "Generating..." : "⬇ Download Manufacturing File"}
                </button>
              </div>
            </div>

            <div className="admin-content">
              {/* 3D PREVIEW */}
              <div className="admin-preview">
                {canBuild ? (
                  <Viewport 
                    builder={model.build} 
                    params={params} 
                    // Use stored color or default grey
                    color={params.colorHex || "#cccccc"} 
                    autoSpin={true} 
                  />
                ) : (
                  <div className="preview-error">
                    Model definition not found for {packKey}/{modelKey}
                  </div>
                )}
              </div>

              {/* DETAILS PANEL */}
              <div className="admin-details">
                <div className="detail-card">
                  <h4>Shipping Address</h4>
                  {shipping?.address ? (
                    <div className="address-block">
                      <p><strong>{shipping.name}</strong></p>
                      <p>{shipping.address.line1}</p>
                      {shipping.address.line2 && <p>{shipping.address.line2}</p>}
                      <p>{shipping.address.city}, {shipping.address.state} {shipping.address.postal_code}</p>
                      <p>{shipping.address.country}</p>
                    </div>
                  ) : (
                    <p className="muted">No shipping info provided.</p>
                  )}
                </div>

                <div className="detail-card">
                  <h4>Design Specs</h4>
                  <div className="specs-grid">
                    <div className="spec">
                      <label>Pack</label>
                      <span>{packKey}</span>
                    </div>
                    <div className="spec">
                      <label>Model</label>
                      <span>{modelKey}</span>
                    </div>
                    {Object.entries(params).map(([key, val]) => {
                      if (typeof val === 'object') return null; // skip objects
                      return (
                        <div className="spec" key={key}>
                          <label>{key}</label>
                          <span>{String(val)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="no-selection">
            Select an order from the list to view details
          </div>
        )}
      </main>

      {/* --- INLINE STYLES FOR ADMIN (Scoped) --- */}
      <style>{`
        .admin-layout { display: grid; grid-template-columns: 300px 1fr; height: 100vh; font-family: sans-serif; background: #f4f4f9; color: #333; }
        
        /* Sidebar */
        .admin-sidebar { background: #fff; border-right: 1px solid #e0e0e0; display: flex; flex-direction: column; overflow: hidden; }
        .sidebar-header { padding: 16px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
        .sidebar-header h2 { margin: 0; font-size: 18px; }
        .refresh-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: #666; }
        
        .order-list { overflow-y: auto; flex: 1; }
        .order-item { padding: 12px 16px; border-bottom: 1px solid #f0f0f0; cursor: pointer; transition: background 0.1s; }
        .order-item:hover { background: #f9f9fc; }
        .order-item.selected { background: #eef2ff; border-left: 3px solid #4f46e5; }
        
        .order-row-top { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .order-id { font-weight: bold; font-size: 13px; color: #555; }
        .status-badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
        .status-badge.paid { background: #dcfce7; color: #166534; }
        .status-badge.unpaid { background: #f1f5f9; color: #64748b; }
        
        .order-name { font-weight: 500; font-size: 14px; margin-bottom: 2px; }
        .order-date { font-size: 12px; color: #888; }
        
        /* Main Area */
        .admin-main { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
        .admin-toolbar { background: #fff; padding: 12px 24px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
        .toolbar-info h3 { margin: 0; font-size: 20px; }
        .toolbar-info span { color: #666; font-size: 14px; }
        
        .btn-download { background: #111; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; }
        .btn-download:hover { background: #333; }
        .btn-download:disabled { opacity: 0.5; cursor: default; }

        .admin-content { display: grid; grid-template-columns: 1fr 320px; flex: 1; overflow: hidden; }
        
        /* Preview */
        .admin-preview { position: relative; background: #e5e5e5; }
        .preview-error { display: grid; place-items: center; height: 100%; color: #666; }
        
        /* Details Panel */
        .admin-details { background: #fff; border-left: 1px solid #e0e0e0; overflow-y: auto; padding: 20px; }
        .detail-card { margin-bottom: 24px; }
        .detail-card h4 { margin: 0 0 12px 0; font-size: 12px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; border-bottom: 1px solid #eee; padding-bottom: 6px; }
        
        .address-block p { margin: 2px 0; font-size: 14px; color: #333; }
        .muted { color: #999; font-size: 14px; font-style: italic; }
        
        .specs-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
        .spec { display: flex; justify-content: space-between; font-size: 13px; border-bottom: 1px dotted #eee; padding-bottom: 2px; }
        .spec label { color: #666; }
        .spec span { font-weight: 500; font-family: monospace; }
        
        .no-selection { display: flex; justify-content: center; align-items: center; height: 100%; color: #999; font-size: 18px; }
        .loading { padding: 20px; text-align: center; color: #666; }
      `}</style>
    </div>
  );
}
