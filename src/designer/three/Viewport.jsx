// src/designer/three/Viewport.jsx
import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three-stdlib";

export default function Viewport({ builder, params, color = "#dddddd", autoSpin = false }) {
  const mountRef = useRef(null);
  const meshRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const animRef = useRef(0);

  // init once
  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    // softer background than pure black
    scene.background = new THREE.Color("#12161f");

    const w = mount.clientWidth || 800;
    const h = mount.clientHeight || 600;

    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 2000);
    camera.position.set(0, 140, 360);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    mount.appendChild(renderer.domElement);

    // lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.65);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(2, 4, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.45);
    rim.position.set(-3, 3, -2);
    scene.add(rim);

    // subtle ground
    const grid = new THREE.GridHelper(600, 20, 0x2a2f3a, 0x1b202a);
    grid.position.y = 0;
    scene.add(grid);

    // axes at origin, small
    const axes = new THREE.AxesHelper(50);
    scene.add(axes);

    // initial geometry and material
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

    // controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 120;
    controls.maxDistance = 900;
    controls.target.set(0, 110, 0); // center near the lampshade belly

    // handle resize
    const onResize = () => {
      const w2 = mount.clientWidth || 800;
      const h2 = mount.clientHeight || 600;
      renderer.setSize(w2, h2);
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // render loop
    const tick = () => {
      // optional gentle turn
      if (autoSpin && mesh) {
        mesh.rotation.y += 0.003;
      }
      controls.update(); // required for damping
      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(tick);
    };
    tick();

    // save refs
    meshRef.current = mesh;
    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;

    // cleanup
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
  }, []); // once

  // rebuild geometry when params change
  useEffect(() => {
    if (!meshRef.current) return;
    const geom = builder(params);
    const old = meshRef.current.geometry;
    meshRef.current.geometry = geom;
    if (old) old.dispose();
  }, [builder, params]);

  // update material color when color changes
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
