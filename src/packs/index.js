// src/packs/index.js
import shadePack from "./shadePack.js";
import superellipsePack from "./superellipsePack.js";
import sockBallsPack from "./sockBallsPack.js";
import lowPolyPack from "./lowPolyPack.js";
import wavySlatsPack from "./wavySlatsPack.js";
import rippleSpiralPack from "./rippleSpiralPack.js";
import meltSlumpPack from "./meltSlumpPack.js";
import rosePack from "./rosePack.js"; // <--- Add this

export const packs = {
  shade: shadePack,
  superellipse: superellipsePack,
  sock: sockBallsPack,
  lowpoly: lowPolyPack,
  wavyslats: wavySlatsPack,
  ripplespiral: rippleSpiralPack,
  meltslump: meltSlumpPack,
  rose: rosePack, // <--- And this
};
