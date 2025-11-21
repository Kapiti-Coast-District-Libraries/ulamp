// src/designer/controls/AutoForm.jsx
import React, { useState, useMemo } from "react";

function FormSection({ title, fields, params, setParams }) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Filter visible fields based on advanced toggle
  const visibleFields = fields.filter((f) => !f.advanced || showAdvanced);
  const hasAdvanced = fields.some((f) => f.advanced);

  const set = (key, value) => setParams((prev) => ({ ...prev, [key]: value }));

  const handleRandomize = () => {
    // We need to construct the *next* params based on the current ones
    // but only updating the keys belonging to THIS section.
    setParams((prev) => {
      const next = { ...prev };
      
      fields.forEach((f) => {
        // 1. Never randomize the texture selector itself (user should pick that)
        if (f.key === "texture") return;

        // 2. Determine value
        if (f.type === "range" || f.type === "number") {
          const min = Number.isFinite(f.min) ? f.min : 0;
          const max = Number.isFinite(f.max) ? f.max : 1;
          const step = Number.isFinite(f.step) ? f.step : 1;
          const steps = Math.max(0, Math.floor((max - min) / step));
          const k = Math.floor(Math.random() * (steps + 1));
          let val = min + k * step;
          if (step < 1) val = Number(val.toFixed(6));
          next[f.key] = val;
        } else if (f.type === "checkbox") {
          next[f.key] = Math.random() < 0.5;
        } else if (f.type === "select") {
          if (Array.isArray(f.options) && f.options.length) {
            const opt = f.options[Math.floor(Math.random() * f.options.length)];
            if (opt?.value !== undefined) next[f.key] = opt.value;
          }
        }
      });
      return next;
    });
  };

  return (
    <div className="form-section">
      {title && <div className="section-title">{title}</div>}
      
      {visibleFields.map((f) => {
        if (f.type === "select") {
          const value = params[f.key] ?? f.options?.[0]?.value ?? "";
          return (
            <div className="field" key={f.key}>
              <label>{f.label}</label>
              <select value={value} onChange={(e) => set(f.key, e.target.value)}>
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
        // Range / Number
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
                const v = Number(e.target.value);
                set(f.key, v);
              }}
            />
            {f.type !== "number" && <div className="value">{value}</div>}
          </div>
        );
      })}

      <div className="section-actions">
        <button className="btn-random" onClick={handleRandomize} title={`Randomize ${title || "settings"}`}>
          🎲 Remix {title}
        </button>
        {hasAdvanced && (
          <button className="btn-advanced" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? "Hide Advanced" : "Advanced"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function AutoForm({ schema, params, setParams }) {
  const effective = typeof schema === "function" ? schema(params) : schema;

  // Group fields by their 'group' property. Default to "General" if missing.
  const grouped = useMemo(() => {
    const groups = {};
    const order = [];
    effective.forEach((f) => {
      const gName = f.group || "General";
      if (!groups[gName]) {
        groups[gName] = [];
        order.push(gName);
      }
      groups[gName].push(f);
    });
    return order.map((name) => ({ name, fields: groups[name] }));
  }, [effective]);

  return (
    <div className="auto-form">
      {grouped.map((g) => (
        <FormSection
          key={g.name}
          title={g.name}
          fields={g.fields}
          params={params}
          setParams={setParams}
        />
      ))}
    </div>
  );
}
