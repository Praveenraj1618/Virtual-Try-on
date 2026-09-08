"use client";
import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createMannequin } from "@/lib/tryon/model";
import type { Measurements, Design } from "@/lib/tryon/schema";
type Props = {
  measurements: Measurements;
  design: Design;
  view: string;
  turn: boolean;
  drape: number;
  onReady: (capture: () => string) => void;
};
export default function AvatarViewer({
  measurements,
  design,
  view,
  turn,
  drape,
  onReady,
}: Props) {
  const host = useRef<HTMLDivElement>(null),
    runtime = useRef<{
      scene: T.Scene;
      camera: T.PerspectiveCamera;
      renderer: T.WebGLRenderer;
      controls: OrbitControls;
    } | null>(null);
  const [error, setError] = useState(""),
    [ready, setReady] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      setError(
        "Your browser could not start the 3D view. Enable hardware acceleration and reload. Your measurements and designs are still available.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    const scene = new T.Scene(),
      camera = new T.PerspectiveCamera(33, 1, 0.01, 30);
    camera.position.set(2, 1.1, 3.6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.88, 0);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1.7;
    controls.maxDistance = 5;
    controls.minPolarAngle = 0.3;
    controls.maxPolarAngle = Math.PI * 0.62;
    controls.autoRotateSpeed = 0.8;
    const ambient = new T.HemisphereLight("#ffffff", "#a1b09c", 2.6);
    scene.add(ambient);
    const key = new T.DirectionalLight("#fff7ee", 3.5);
    key.position.set(-2, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -2;
    key.shadow.camera.right = 2;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -1;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    const fill = new T.DirectionalLight("#e3efff", 1.8);
    fill.position.set(3, 2, -2);
    scene.add(fill);
    const platform = new T.Mesh(
      new T.CylinderGeometry(0.6, 0.64, 0.055, 80),
      new T.MeshStandardMaterial({ color: "#d6dfd2", roughness: 0.95 }),
    );
    platform.position.y = -0.029;
    platform.receiveShadow = true;
    scene.add(platform);
    const floor = new T.Mesh(
      new T.PlaneGeometry(20, 20),
      new T.ShadowMaterial({ opacity: 0.12 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.057;
    floor.receiveShadow = true;
    scene.add(floor);
    const mount = host.current;
    mount.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D mannequin. Drag to rotate and scroll to zoom, or use the view buttons below.",
    );
    renderer.domElement.setAttribute("role", "img");
    const resize = new ResizeObserver(() => {
      const w = mount.clientWidth,
        h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resize.observe(mount);
    runtime.current = { scene, camera, renderer, controls };
    setReady(true);
    const lost = (event: Event) => {
      event.preventDefault();
      setError(
        "The 3D connection was interrupted. Reload the page to restore the view.",
      );
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    onReady(() => {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/png");
    });
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });
    return () => {
      setReady(false);
      resize.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof T.Mesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.dispose();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, [onReady]);
  useEffect(() => {
    const rt = runtime.current;
    if (!rt || !ready) return;
    setError("");
    const model = createMannequin(measurements, design);
    rt.scene.add(model.group);
    let stopped = false,
      frame = 0,
      animation = 0,
      texture: T.Texture | undefined;
    if (design.texture) {
      new T.TextureLoader().load(
        design.texture,
        (t) => {
          if (stopped) {
            t.dispose();
            return;
          }
          texture = t;
          t.colorSpace = T.SRGBColorSpace;
          t.wrapS = T.RepeatWrapping;
          t.wrapT = T.RepeatWrapping;
          t.repeat.set(2, 2);
          model.material.map = t;
          model.material.color.set("#ffffff");
          model.material.needsUpdate = true;
        },
        undefined,
        () =>
          setError("This print could not be loaded. Try uploading it again."),
      );
    }
    const relax = () => {
      if (stopped || frame++ > 55) return;
      for (const part of model.parts) {
        part.cloth.step(model.collide);
        const attr = part.mesh.geometry.getAttribute("position");
        (attr.array as Float32Array).set(part.cloth.positions);
        attr.needsUpdate = true;
        part.mesh.geometry.computeVertexNormals();
      }
      animation = requestAnimationFrame(relax);
    };
    // A short relaxation pass gives a stable preview rather than endless motion.
    animation = requestAnimationFrame(relax);
    return () => {
      stopped = true;
      cancelAnimationFrame(animation);
      rt.scene.remove(model.group);
      texture?.dispose();
      const materials = new Set<T.Material>();
      model.group.traverse((o) => {
        if (o instanceof T.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
            materials.add(m),
          );
        }
      });
      materials.forEach((m) => m.dispose());
    };
  }, [measurements, design, ready, drape]);
  useEffect(() => {
    const rt = runtime.current;
    if (!rt) return;
    const distance = 3.55,
      h = measurements.height / 100;
    rt.controls.target.set(0, h * 0.49, 0);
    const angle =
      view === "back"
        ? Math.PI
        : view === "side"
          ? Math.PI / 2
          : view === "front"
            ? 0
            : 0.42;
    rt.camera.position.set(
      Math.sin(angle) * distance,
      h * 0.55,
      Math.cos(angle) * distance,
    );
    rt.controls.update();
  }, [view, ready, measurements.height]);
  useEffect(() => {
    if (runtime.current) runtime.current.controls.autoRotate = turn;
  }, [turn, ready]);
  return (
    <div className="canvas-host" ref={host}>
      {!ready && !error && (
        <div className="fallback subtle">Preparing your mannequin…</div>
      )}
      {error && (
        <div role="alert" className="fallback error">
          {error}
          <button
            className="button full"
            onClick={() => window.location.reload()}
          >
            Reload 3D view
          </button>
        </div>
      )}
    </div>
  );
}
