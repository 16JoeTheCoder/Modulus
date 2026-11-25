import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createFactoryBuild } from '../../content';
import { compileVehicleBuild } from '../../core/math/vehicleCompiler';
import { DEFAULT_BALANCE_CONFIG, type IChassisSchema } from '../../core/types';
import { buildAssembledCar } from '../../plugins/car-assembler/buildCarGeometry';

export function CarPreview({ chassis }: { chassis: IChassisSchema }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<THREE.WebGLRenderer | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!canvas.current) return;
    let preview: THREE.WebGLRenderer;
    try {
      preview = new THREE.WebGLRenderer({ canvas: canvas.current, alpha: true, antialias: true });
    } catch {
      setUnavailable(true);
      return;
    }
    preview.setSize(672, 420, false);
    preview.setClearColor(0x0b0f17, 0);
    preview.toneMapping = THREE.ACESFilmicToneMapping;
    preview.toneMappingExposure = 1.32;
    renderer.current = preview;
    return () => {
      renderer.current = null;
      preview.dispose();
      if (!preview.domElement.isConnected) preview.forceContextLoss();
    };
  }, []);

  useEffect(() => {
    const preview = renderer.current;
    if (!preview) return;
    const scene = new THREE.Scene();
    const key = new THREE.DirectionalLight('#fff5e5', 3.2);
    key.position.set(3, 6, 4);
    const rim = new THREE.DirectionalLight('#bfdbfe', 1.5);
    rim.position.set(-5, 3, -4);
    scene.add(key, rim, new THREE.HemisphereLight('#edf5ff', '#798395', 1.9));
    const car = buildAssembledCar(compileVehicleBuild(createFactoryBuild(chassis, 'preview'), DEFAULT_BALANCE_CONFIG));
    scene.add(car.root);

    const bounds = new THREE.Box3().setFromObject(car.root);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(31, 672 / 420, 0.05, 40);
    const distance = Math.max(size.z * 1.38, size.y * 2.5, 4.1);
    camera.position.set(0.86, 0.34, 0.72).normalize().multiplyScalar(distance).add(center);
    camera.lookAt(center);
    preview.render(scene, camera);
    car.dispose();
  }, [chassis]);

  return (
    <div className="relative flex aspect-[8/5] items-center justify-center overflow-hidden rounded-xl bg-[#151d2a]">
      <canvas ref={canvas} role="img" aria-label={`${chassis.name} 3D preview`} className="h-full w-full" />
      {unavailable && <p className="absolute inset-x-0 text-center text-sm text-slate-300">3D preview unavailable on this device</p>}
    </div>
  );
}
