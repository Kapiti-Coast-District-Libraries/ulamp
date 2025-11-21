// src/designer/controls/AutoForm.jsx
import React, { useState } from "react";

export default function AutoForm({ schema, params, setParams }) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const effective = typeof schema === "function" ? schema(params) : schema;

  const set = (key, value) => setParams({ ...params, [key]: value });

  // --- NEW: Randomize only the current sliders ---
  const handleRandomize = () => {
    const next = { ...params };
    
    effective.forEach((f) => {
      // Skip locking fields or the texture selector itself
      // (We want to randomize the texture's LOOK, not switch to a different texture)
      if (f.key === "texture") return; 

      if (f.type === "range" || f.type === "number") {
        const min = Number.isFinite(f.min) ? f.min : 0;
        const max = Number.isFinite(f.max) ? f.max : 1;
        const step = Number.isFinite(f.step) ? f.step : 1;
        
        const steps = Math.max(0, Math.floor((max - min) / step));
        const k = Math.floor(Math.random() * (steps + 1));
        let val = min + k * step;
        
        // clean up float precision issues
        if (step < 1) val = Number(val.toFixed(6));
        
        next[f.key] = val;
      } 
      else if (f.type === "checkbox") {
        // 50/50 chance
        next[f.key] = Math.random() < 0.5;
      }
      else if (f.type === "select") {
        // Pick a random option from the list
        if (Array.isArray(f.options) && f.options.length > 0) {
          const opt = f.options[Math.floor(Math.random() * f.options.length)];
          if (opt?.value !== undefined) next[f.key] = opt.value;
        }
      }
    });

    setParams(next);
  };

  // Filter fields based on advanced toggle
  const visibleFields = effective.filter(f => {
    if (!f.advanced) return true;
    return showAdvanced;
  });

  return (
    <div className="card">
      {visibleFields.map((f) => {
        if (f.type === "select") {
          const value = params[f.key] ?? f.options?.[0]?.value ?? "";
          return (
            <div className="field" key={f.key}>
              <label>{f.label}</label>
              <select
                value={value}
                onChange={(e) => set(f.key, e.target.value)}
              >
                {(f.options || []).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          );
        }
        if (f.type === "checkbox") {
          const value = !!params[f.key];
          return (
            <div className="field" key={f.key}>
              <label>{f.label}</label>
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => set(f.key, e.target.checked)}
              />
            </div>
          );
        }
        
        const value = typeof params[f.key] === "number" ? params[f.key] : (f.min ?? 0);
        return (
          <div className="field" key={f.key}>
            <label>{f.label}</label>
            <input
              type={f.type === "number" ? "number" : "range"}
              min={f.min}
              max={f.max}
              step={f.step ?? 1}
              value={value}
              onChange={(e) => {
                const v = f.type === "number" ? Number(e.target.value) : Number(e.target.value);
                set(f.key, v);
              }}
            />
            {f.type !== "number" && <div className="value">{value}</div>}
          </div>
        );
      })}

      {/* Actions Footer */}
      <div className="form-actions" style={{ marginTop: "1.5rem", display: "flex", gap: "10px", justifyContent: "center" }}>
        <button 
          onClick={handleRandomize}
          title="Randomize these settings"
          style={{ flex: 1 }}
        >
          🎲 Remix Params
        </button>
        
        <button 
          className="secondary" 
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{ flex: 1, fontSize: "0.85rem" }}
        >
          {showAdvanced ? "Hide Advanced" : "Show Advanced"}
        </button>
      </div>
    </div>
  );
}
