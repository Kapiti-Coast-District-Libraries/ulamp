// src/hiddenPart/config.js

// 1. EXISTING CONFIG (The Insert/Thread - Gets Exported)
export const hiddenPartConfig = {
  include: true,
  url: "/hidden/base_insert.stl",
  upAxis: "Z",        // "Y", "Z", or "X"
  unitScale: 1,       // 1 for mm
  centerMode: "footToY0",
  lockCenterXZTo0: true,
  lockBaseYTo0: true,
  localOffset: [0, 0, 0],
  rotationDeg: [0, 0, 0],
  scale: [1, 1, 1],
  position: [0, 0, 0]
};

// 2. NEW CONFIG (The Lamp Stand - Visual Only)
export const visualBaseConfig = {
  include: true,
  url: "/hidden/lamp_base.stl", 
  upAxis: "Z",        // Adjust if your stand comes in sideways
  unitScale: 1,
  
  // Alignment settings
  lockCenterXZTo0: true, // Center it under the lamp
  
  // You might want to lower this if the lamp sits ON TOP of it
  // or raise it if the lamp sits AROUND it.
  localOffset: [0, -20, 0], 
  
  rotationDeg: [0, 0, 0],
  scale: [1, 1, 1],
  position: [0, 0, 0]
};
