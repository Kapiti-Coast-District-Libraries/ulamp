// src/hiddenPart/config.js

// 1. THE INSERT (Thread) - Exported
export const hiddenPartConfig = {
  include: true,
  url: "/hidden/base_insert.stl",
  upAxis: "Z", 
  unitScale: 1,
  lockCenterXZTo0: true,
  lockBaseYTo0: true,
  localOffset: [0, 0, 0],
  rotationDeg: [0, 0, 0],
  scale: [1, 1, 1],
  position: [0, 0, 0]
};

// 2. THE STAND (Visual Base) - Visual Only
export const visualBaseConfig = {
  include: true,
  url: "/hidden/lamp_base.stl", 
  upAxis: "Z", 
  unitScale: 1,
  lockCenterXZTo0: true,
  localOffset: [0, 0, 0], 
  rotationDeg: [0, 0, 0],
  scale: [1, 1, 1],
  position: [0, 0, 0]
};

// 3. THE LIGHT BULB - Visual + Emits Light
export const lightBulbConfig = {
  include: true,
  url: "/hidden/light_bulb.stl",
  upAxis: "Z",
  unitScale: 1,
  
  lockCenterXZTo0: true,

  // Raise the bulb up! (e.g., 50mm up from the floor)
  localOffset: [0, 0, 0], 

  rotationDeg: [0, 0, 0],
  scale: [1, 1, 1],
  position: [0, 0, 0],

  // Light settings
  lightColor: "#ffaa00", // Warm yellow glow
  lightIntensity: 60,    // Brightness of the PointLight
  lightDistance: 300     // How far the light reaches
};
