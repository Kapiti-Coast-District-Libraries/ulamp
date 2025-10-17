// src/hiddenPart/config.js
// Onshape usually exports Z up, millimeters, origin not always centered.
// These options make placement deterministic.

export const hiddenPartConfig = {
  include: true,

  // Place your file at public/hidden/base_insert.stl
  url: "/hidden/base_insert.stl",

  // Up axis coming from Onshape
  // "Z" means we will rotate to Y up for Three
  upAxis: "Z", // "Y", "Z", or "X"

  // Units of the STL, 1 means mm. For meters to mm, use 1000. For inches, use 25.4.
  unitScale: 1,

  // Centering before your tweaks
  // "bboxCenter" moves geometric center to origin
  // "footToY0" centers XZ and moves the lowest Y to 0
  centerMode: "footToY0",

  // After all transforms below, we do a hard lock:
  // lock XZ center to 0, and lock base to Y 0. This guarantees precise alignment.
  lockCenterXZTo0: true,
  lockBaseYTo0: true,

  // Fine local tweak before final locks
  localOffset: [0, 0, 0],   // [x, y, z] mm

  // Your additional rotation and scale after unitScale
  rotationDeg: [0, 0, 0],   // [x, y, z] degrees
  scale: [1, 1, 1],         // per axis scale

  // Final world position, usually keep 0,0,0 since we lock to origin
  position: [0, 0, 0]
};
