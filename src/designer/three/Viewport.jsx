// src/designer/three/Viewport.jsx
import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls, STLLoader } from "three-stdlib";
// Import the config to place the base exactly as it is in the export
import { hiddenPartConfig } from "../../hiddenPart/config.js";

export default function Viewport({ builder, params, color = "#dddddd", autoSpin = false }) {
  const mountRef = useRef(null);
  const meshRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const animRef = useRef(0);

  const autoSpinRef = useRef(autoSpin);
  
  useEffect(() => {
    autoSpinRef.current = autoSpin;
  }, [autoSpin]);

  // init once
  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    // Use the dark blue-grey background
    scene.background = new THREE.Color("#12161f");

    const w = mount.clientWidth || 800;
    const h = mount.clientHeight || 600;

    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 2000);
    camera.position.set(0, 140, 360);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    mount.appendChild(renderer.domElement);

    // --- Lighting ---
    const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.65);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(2, 4, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.45);
    rim.position.set(-3, 3, -2);
    scene.add(rim);

    // --- Ground & Helpers ---
    const grid = new THREE.GridHelper(600, 20, 0x2a2f3a, 0x1b202a);
    grid.position.y = 0;
    scene.add(grid);

    const axes = new THREE.AxesHelper(50);
    scene.add(axes);

    // --- 1. Main Lamp Mesh (The user's design) ---
    const geom = builder(params);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.75,
      metalness: 0.05
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    scene.add(mesh);

    // --- 2. Hidden Part (The Base Insert) ---
    // We check if it is enabled in the config
    if (hiddenPartConfig && hiddenPartConfig.include && hiddenPartConfig.url) {
      const loader = new STLLoader();
      loader.load(hiddenPartConfig.url, (geometry) => {
        
        // --- Apply Config Logic (Mirrors the export logic) ---
        
        // A. Unit Scale (e.g. converting inches to mm)
        const us = hiddenPartConfig.unitScale || 1;
        if (us !== 1) geometry.scale(us, us, us);

        // B. Up Axis correction (Z-up from CAD to Y-up for Three.js)
        if (hiddenPartConfig.upAxis === "Z") {
          geometry.rotateX(-Math.PI / 2);
        }

        // C. Centering Logic
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox;
        const center = new THREE.Vector3(); 
        bbox.getCenter(center);

        // Calculate shifts to lock the base to the origin/floor
        const tx = hiddenPartConfig.lockCenterXZTo0 ? -center.x : 0;
        const ty = hiddenPartConfig.lockBaseYTo0 ? -bbox.min.y : 0;
        const tz = hiddenPartConfig.lockCenterXZTo0 ? -center.z : 0;
        geometry.translate(tx, ty, tz);

        // D. Manual Rotation
        if (hiddenPartConfig.rotationDeg) {
          const [rx, ry, rz] = hiddenPartConfig.rotationDeg;
          geometry.rotateX(rx * Math.PI / 180);
          geometry.rotateY(ry * Math.PI / 180);
          geometry.rotateZ(rz * Math.PI / 180);
        }

        // E. Manual Scale
        if (hiddenPartConfig.scale) {
          const [sx, sy, sz] = hiddenPartConfig.scale;
          geometry.scale(sx, sy, sz);
        }

        // F. Manual Offset
        if (hiddenPartConfig.localOffset) {
          const [lx, ly, lz] = hiddenPartConfig.localOffset;
          geometry.translate(lx, ly, lz);
        }

        // --- Create Base Mesh ---
        // We use a dark, slightly metallic material to contrast with the lamp
        const baseMat = new THREE.MeshStandardMaterial({
          color: 0x333333,
          roughness: 0.5,
          metalness: 0.3
        });
        const baseMesh = new THREE.Mesh(geometry, baseMat);
        
        // Final position (usually 0,0,0)
        if (hiddenPartConfig.position) {
          baseMesh.position.set(...hiddenPartConfig.position);
        }

        scene.add(baseMesh);
      });
    }

    // --- Controls & Loop ---
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 120;
    controls.maxDistance = 900;
    controls.target.set(0, 110, 0);

    const onResize = () => {
      const w2 = mount.clientWidth || 800;
      const h2 = mount.clientHeight || 600;
      renderer.setSize(w2, h2);
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    const tick = () => {
      if (autoSpinRef.current && mesh) {
        mesh.rotation.y += 0.003;
      }
      controls.update();
      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(tick);
    };
    tick();

    meshRef.current = mesh;
    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      scene.traverse(o => {
        if (o.isMesh) {
          o.geometry.dispose();
          if (o.material && o.material.dispose) o.material.dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  // Rebuild main geometry when params change
  useEffect(() => {
    if (!meshRef.current) return;
    const geom = builder(params);
    const old = meshRef.current.geometry;
    meshRef.current.geometry = geom;
    if (old) old.dispose();
  }, [builder, params]);

  // Update main color
  useEffect(() => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material;
    if (mat && mat.color) {
      mat.color.set(color);
      mat.needsUpdate = true;
    }
  }, [color]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
}
