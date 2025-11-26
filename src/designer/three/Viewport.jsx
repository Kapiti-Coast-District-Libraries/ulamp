// src/designer/three/Viewport.jsx
import React, { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { OrbitControls, STLLoader, STLExporter } from "three-stdlib";
import { hiddenPartConfig, visualBaseConfig } from "../../hiddenPart/config.js";

const Viewport = forwardRef(({ builder, params, color = "#dddddd", autoSpin = false }, ref) => {
  const mountRef = useRef(null);
  
  // Refs for the different parts
  const meshRef = useRef(null);      // 1. Main Lamp
  const insertRef = useRef(null);    // 2. Thread (Matches Lamp Color)
  const standRef = useRef(null);     // 3. Stand (Black)
  
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const animRef = useRef(0);
  const controlsRef = useRef(null);

  const autoSpinRef = useRef(autoSpin);
  useEffect(() => { autoSpinRef.current = autoSpin; }, [autoSpin]);

  // Download logic: Exports Lamp + Thread (Insert), ignores Stand
  useImperativeHandle(ref, () => ({
    download: () => {
      const exporter = new STLExporter();
      const exportGroup = new THREE.Group();

      // 1. Add Lampshade
      if (meshRef.current) {
        exportGroup.add(meshRef.current.clone());
      }

      // 2. Add Base Insert (Thread)
      if (insertRef.current) {
        exportGroup.add(insertRef.current.clone());
      }

      if (exportGroup.children.length === 0) {
        alert("Nothing to export!");
        return;
      }

      const str = exporter.parse(exportGroup, { binary: true });
      const blob = new Blob([str], { type: 'application/octet-stream' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'lampshade_check.stl';
      link.click();
    }
  }));

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#12161f");

    const w = mount.clientWidth || 800;
    const h = mount.clientHeight || 600;

    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 2000);
    camera.position.set(0, 140, 360);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    mount.appendChild(renderer.domElement);

    // --- Lights ---
    const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.65);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(2, 4, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.45);
    rim.position.set(-3, 3, -2);
    scene.add(rim);

    // --- Ground ---
    const grid = new THREE.GridHelper(600, 20, 0x2a2f3a, 0x1b202a);
    grid.position.y = 0;
    scene.add(grid);

    const axes = new THREE.AxesHelper(50);
    scene.add(axes);

    // --- 1. Main Parametric Mesh ---
    const geom = builder(params);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.75,
      metalness: 0.05
    });
    const mesh = new THREE.Mesh(geom, mat);
    scene.add(mesh);
    meshRef.current = mesh;

    // --- Helper to load STLs ---
    const loadPart = (config, material, refStore) => {
      if (!config || !config.include || !config.url) return;
      
      console.log(`[Viewport] Loading: ${config.url}`); 

      const loader = new STLLoader();
      loader.load(
        config.url,
        (geometry) => {
          // 1. Unit Scale
          const us = config.unitScale || 1;
          if (us !== 1) geometry.scale(us, us, us);

          // 2. Up Axis
          if (config.upAxis === "Z") geometry.rotateX(-Math.PI / 2);

          // 3. Centering
          geometry.computeBoundingBox();
          const bbox = geometry.boundingBox;
          const center = new THREE.Vector3();
          bbox.getCenter(center);

          const tx = config.lockCenterXZTo0 ? -center.x : 0;
          const ty = config.lockBaseYTo0 ? -bbox.min.y : 0;
          const tz = config.lockCenterXZTo0 ? -center.z : 0;
          geometry.translate(tx, ty, tz);

          // 4. Transforms
          if (config.rotationDeg) {
            const [rx, ry, rz] = config.rotationDeg;
            geometry.rotateX(rx * Math.PI / 180);
            geometry.rotateY(ry * Math.PI / 180);
            geometry.rotateZ(rz * Math.PI / 180);
          }
          if (config.scale) {
            const [sx, sy, sz] = config.scale;
            geometry.scale(sx, sy, sz);
          }
          if (config.localOffset) {
            const [lx, ly, lz] = config.localOffset;
            geometry.translate(lx, ly, lz);
          }

          const partMesh = new THREE.Mesh(geometry, material);
          if (config.position) partMesh.position.set(...config.position);
          
          scene.add(partMesh);
          if (refStore) refStore.current = partMesh;
        },
        undefined, 
        (error) => {
          console.error(`[Viewport] ERROR loading ${config.url}:`, error);
        }
      );
    };

    // --- 2. Load Base Insert (Thread) ---
    // Matches the lamp color/material
    const insertMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color), // Start with current color
      roughness: 0.75,
      metalness: 0.05
    });
    loadPart(hiddenPartConfig, insertMat, insertRef);

    // --- 3. Load Visual Stand (Black) ---
    const standMat = new THREE.MeshStandardMaterial({
      color: 0x111111, // BLACK
      roughness: 0.5,
      metalness: 0.2
    });
    loadPart(visualBaseConfig, standMat, standRef);


    // --- Controls ---
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
      // Spin Shade + Insert
      if (autoSpinRef.current) {
        if (meshRef.current) meshRef.current.rotation.y += 0.003;
        if (insertRef.current) insertRef.current.rotation.y += 0.003;
      }
      controls.update();
      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update Geometry
  useEffect(() => {
    if (!meshRef.current) return;
    const geom = builder(params);
    const old = meshRef.current.geometry;
    meshRef.current.geometry = geom;
    if (old) old.dispose();
  }, [builder, params]);

  // Update Color (Sync Lamp AND Insert)
  useEffect(() => {
    const c = new THREE.Color(color);

    // 1. Update Lamp
    if (meshRef.current && meshRef.current.material) {
      meshRef.current.material.color.set(c);
      meshRef.current.material.needsUpdate = true;
    }

    // 2. Update Insert (Thread)
    if (insertRef.current && insertRef.current.material) {
      insertRef.current.material.color.set(c);
      insertRef.current.material.needsUpdate = true;
    }
  }, [color]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
});

export default Viewport;
