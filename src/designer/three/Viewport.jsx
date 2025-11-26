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
    scene.background = new THREE.Color("#12161f");

    const w = mount.clientWidth || 800;
    const h = mount.clientHeight || 600;

    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 2000);
    camera.position.set(0, 140, 360);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.65);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(2, 4, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.45);
    rim.position.set(-3, 3, -2);
    scene.add(rim);

    const grid = new THREE.GridHelper(600, 20, 0x2a2f3a, 0x1b202a);
    grid.position.y = 0;
    scene.add(grid);

    const axes = new THREE.AxesHelper(50);
    scene.add(axes);

    // --- 1. Main Lamp Mesh ---
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

    // --- 2. Hidden Part (Base Insert) ---
    if (hiddenPartConfig && hiddenPartConfig.include && hiddenPartConfig.url) {
      const loader = new STLLoader();
      loader.load(hiddenPartConfig.url, (geometry) => {
        // Apply Config Logic (Same as export)
        
        // 1. Unit Scale
        const us = hiddenPartConfig.unitScale || 1;
        if (us !== 1) geometry.scale(us, us, us);

        // 2. Up Axis correction
        if (hiddenPartConfig.upAxis === "Z") {
          geometry.rotateX(-Math.PI / 2);
        }

        // 3. Centering Logic
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox;
        const size = new THREE.Vector3(); 
        bbox.getSize(size);
        const center = new THREE.Vector3(); 
        bbox.getCenter(center);

        // Move to origin based on flags
        const tx = hiddenPartConfig.lockCenterXZTo0 ? -center.x : 0;
        const ty = hiddenPartConfig.lockBaseYTo0 ? -bbox.min.y : 0;
        const tz = hiddenPartConfig.lockCenterXZTo0 ? -center.z : 0;
        geometry.translate(tx, ty, tz);

        // 4. Rotation
        if (hiddenPartConfig.rotationDeg) {
          const [rx, ry, rz] = hiddenPartConfig.rotationDeg;
          geometry.rotateX(rx * Math.PI / 180);
          geometry.rotateY(ry * Math.PI / 180);
          geometry.rotateZ(rz * Math.PI / 180);
        }

        // 5. Scale
        if (hiddenPartConfig.scale) {
          const [sx, sy, sz] = hiddenPartConfig.scale;
          geometry.scale(sx, sy, sz);
        }

        // 6. Local Offset
        if (hiddenPartConfig.localOffset) {
          const [lx, ly, lz] = hiddenPartConfig.localOffset;
          geometry.translate(lx, ly, lz);
        }

        // Create Mesh
        // Make it look like dark hard plastic/metal to contrast with the lamp
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

  useEffect(() => {
    if (!meshRef.current) return;
    const geom = builder(params);
    const old = meshRef.current.geometry;
    meshRef.current.geometry = geom;
    if (old) old.dispose();
  }, [builder, params]);

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
