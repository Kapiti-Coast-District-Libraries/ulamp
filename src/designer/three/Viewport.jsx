// src/designer/three/Viewport.jsx
import React, { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { OrbitControls, STLLoader, STLExporter } from "three-stdlib";
// Import ALL configs
import { hiddenPartConfig, visualBaseConfig, lightBulbConfig } from "../../hiddenPart/config.js";

const Viewport = forwardRef(({ builder, params, color = "#dddddd", autoSpin = false }, ref) => {
  const mountRef = useRef(null);
  
  const meshRef = useRef(null);      // 1. Lamp
  const insertRef = useRef(null);    // 2. Insert
  const standRef = useRef(null);     // 3. Stand
  const bulbRef = useRef(null);      // 4. Bulb
  
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const animRef = useRef(0);
  const controlsRef = useRef(null);

  const autoSpinRef = useRef(autoSpin);
  useEffect(() => { autoSpinRef.current = autoSpin; }, [autoSpin]);

  // Download logic
  useImperativeHandle(ref, () => ({
    download: () => {
      const exporter = new STLExporter();
      const exportGroup = new THREE.Group();

      if (meshRef.current) exportGroup.add(meshRef.current.clone());
      if (insertRef.current) exportGroup.add(insertRef.current.clone());

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
    // Background color
    scene.background = new THREE.Color("#12161f");

    const w = mount.clientWidth || 800;
    const h = mount.clientHeight || 600;

    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 2000);
    camera.position.set(0, 140, 560);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    
    // Enable Shadows
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    mount.appendChild(renderer.domElement);

    // --- Lights ---
    const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.6); 
    scene.add(hemi);
    
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(50, 50, 150);
    key.castShadow = true; 
    key.shadow.mapSize.width = 1024;
    key.shadow.mapSize.height = 1024;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0xffffff, 0.5); 
    rim.position.set(-50, 50, -50);
    scene.add(rim);

    // --- Ground ---
    // TRANSPARENT FLOOR (ShadowMaterial)
    // Invisible plane that still catches shadows
    const floorGeo = new THREE.PlaneGeometry(2000, 2000);
    const floorMat = new THREE.ShadowMaterial({ 
      opacity: 0 // Opacity of the SHADOW, not the floor
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(600, 20, 0x3a404d, 0x2a2f3a);
    grid.position.y = 0.1;
    scene.add(grid);

    // --- 1. Main Parametric Mesh ---
    const geom = builder(params);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.75,
      metalness: 0.05,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshRef.current = mesh;

    // --- Helper to load STLs ---
    const loadPart = (config, material, refStore, onLoaded) => {
      if (!config || !config.include || !config.url) return;
      
      const loader = new STLLoader();
      loader.load(
        config.url,
        (geometry) => {
          const us = config.unitScale || 1;
          if (us !== 1) geometry.scale(us, us, us);
          if (config.upAxis === "Z") geometry.rotateX(-Math.PI / 2);

          geometry.computeBoundingBox();
          const bbox = geometry.boundingBox;
          const center = new THREE.Vector3();
          bbox.getCenter(center);

          const tx = config.lockCenterXZTo0 ? -center.x : 0;
          const ty = config.lockBaseYTo0 ? -bbox.min.y : 0;
          const tz = config.lockCenterXZTo0 ? -center.z : 0;
          geometry.translate(tx, ty, tz);

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
          
          partMesh.castShadow = true;
          partMesh.receiveShadow = true;

          scene.add(partMesh);
          if (refStore) refStore.current = partMesh;
          if (onLoaded) onLoaded(partMesh);
        },
        undefined, 
        (error) => { console.error(`[Viewport] ERROR loading ${config.url}:`, error); }
      );
    };

    // --- 2. Base Insert ---
    const insertMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color), 
      roughness: 0.75,
      metalness: 0.05
    });
    loadPart(hiddenPartConfig, insertMat, insertRef);

    // --- 3. Visual Stand ---
    const standMat = new THREE.MeshStandardMaterial({
      color: 0x111111, // Black Stand
      roughness: 0.4,
      metalness: 0.3
    });
    loadPart(visualBaseConfig, standMat, standRef);

    // --- 4. Light Bulb ---
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(lightBulbConfig.lightColor || "#ffaa00"),
      emissiveIntensity: 0.0, 
      roughness: 0.1
    });

    loadPart(lightBulbConfig, bulbMat, bulbRef, (partMesh) => {
      const pointLight = new THREE.PointLight(
        lightBulbConfig.lightColor || "#ffaa00",
        50, 
        400 
      );
      pointLight.castShadow = true; 
      pointLight.shadow.bias = -0.0005;
      partMesh.add(pointLight);
    });

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

  // Update Color
  useEffect(() => {
    const c = new THREE.Color(color);
    if (meshRef.current && meshRef.current.material) {
      meshRef.current.material.color.set(c);
      meshRef.current.material.needsUpdate = true;
    }
    if (insertRef.current && insertRef.current.material) {
      insertRef.current.material.color.set(c);
      insertRef.current.material.needsUpdate = true;
    }
  }, [color]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
});

export default Viewport;
