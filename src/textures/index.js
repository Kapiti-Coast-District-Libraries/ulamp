// src/textures/index.js
// Auto discover all texture modules in this folder.
// Each module must export default { id, label, defaults, schema, headroom, apply }.
const modules = import.meta.glob("./*.js", { eager: true });

export const textures = {};
for (const [path, mod] of Object.entries(modules)) {
  if (path.endsWith("index.js")) continue;
  const desc = mod?.default;
  if (!desc || !desc.id) continue;
  textures[desc.id] = desc;
}

export const textureOrder = Object.keys(textures); // stable order
export const textureOptions = textureOrder.map((id) => ({ label: textures[id].label, value: id }));
