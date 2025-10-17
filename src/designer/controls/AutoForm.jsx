// src/designer/controls/AutoForm.jsx
import React from "react";

export default function AutoForm({ schema, params, setParams }) {
  const effective = typeof schema === "function" ? schema(params) : schema;

  const set = (key, value) => setParams({ ...params, [key]: value });

  return (
    <div className="card">
      {effective.map((f) => {
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
        // range or number
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
    </div>
  );
}
