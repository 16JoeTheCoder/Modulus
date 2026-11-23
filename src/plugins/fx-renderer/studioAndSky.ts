import * as THREE from 'three';
import type { ITrackSplineSchema, VisualMode } from '../../core/types';

export interface IDualEnvironmentRig {
  labGroup: THREE.Group;
  trackGroup: THREE.Group;
  sunLight: THREE.DirectionalLight;
  setMode(mode: VisualMode, scene: THREE.Scene, track: ITrackSplineSchema): void;
  updateTrackTheme(track: ITrackSplineSchema, scene: THREE.Scene, activeMode: VisualMode): void;
  updateTrackFollow(carPos: THREE.Vector3, camPos: THREE.Vector3): void;
  dispose(scene: THREE.Scene): void;
}

const LAB_BG_COLOR = new THREE.Color('#0A0C10');

function createSkyDome(
  zenithHex: string,
  horizonHex: string,
  sunHex: string,
  disposables: Array<{ dispose: () => void }>
): { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform> } {
  const uniforms: Record<string, THREE.IUniform> = {
    uZenith: { value: new THREE.Color(zenithHex) },
    uHorizon: { value: new THREE.Color(horizonHex) },
    uSunColor: { value: new THREE.Color(sunHex) },
    uSunDir: { value: new THREE.Vector3(0.55, 0.52, 0.65).normalize() },
  };

  const geo = new THREE.SphereGeometry(1150, 24, 16);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      varying vec3 vWorldDir;
      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = clamp(dir.y, 0.0, 1.0);
        float grad = pow(h, 0.58);
        vec3 sky = mix(uHorizon, uZenith, grad);
        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        sky += uSunColor * pow(sunDot, 18.0) * 0.35;
        sky += uSunColor * smoothstep(0.996, 0.9992, sunDot) * 1.1;
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });

  disposables.push(geo, mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'track_sky_dome';
  return { mesh, uniforms };
}

/**
 * Builds the Dual-Aesthetic Lighting & Environment Rig:
 * - LAB MODE: Matte obsidian floor, circular turntable + telemetry grid, overhead softbox LED panels, cyan & amber rim lights
 * - TRACK MODE: Warm sunlit Art-of-Rally directional sun + car-following shadow frustum, hemisphere bounce, procedural gradient sky dome
 */
export function buildDualEnvironmentRig(
  scene: THREE.Scene,
  initialTrack: ITrackSplineSchema
): IDualEnvironmentRig {
  const disposables: Array<{ dispose: () => void }> = [];
  const trackRes = <T extends { dispose: () => void }>(res: T): T => {
    disposables.push(res);
    return res;
  };

  // =========================================================================
  // 1. DARK ENGINEERING LAB STUDIO RIG
  // =========================================================================
  const labGroup = new THREE.Group();
  labGroup.name = 'fx_lab_environment';

  // Matte obsidian studio floor
  const floorGeo = trackRes(new THREE.CircleGeometry(42, 48));
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = trackRes(
    new THREE.MeshStandardMaterial({
      color: '#0D1118',
      roughness: 0.76,
      metalness: 0.24,
    })
  );
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.y = -0.002;
  floorMesh.receiveShadow = true;
  labGroup.add(floorMesh);

  // Subtle cyan engineering telemetry grid
  const gridHelper = new THREE.GridHelper(32, 32, 0x00f0ff, 0x162233);
  gridHelper.position.y = 0.001;
  const gridMats = Array.isArray(gridHelper.material) ? gridHelper.material : [gridHelper.material];
  for (const gm of gridMats) {
    gm.transparent = true;
    gm.opacity = 0.24;
    disposables.push(gm);
  }
  disposables.push(gridHelper.geometry);
  labGroup.add(gridHelper);

  // Sleek circular turntable pedestal disc
  const plinthGeo = trackRes(new THREE.CylinderGeometry(3.05, 3.22, 0.04, 48));
  const plinthMat = trackRes(
    new THREE.MeshStandardMaterial({
      color: '#121824',
      roughness: 0.42,
      metalness: 0.55,
    })
  );
  const plinth = new THREE.Mesh(plinthGeo, plinthMat);
  plinth.position.y = -0.022;
  plinth.receiveShadow = true;
  labGroup.add(plinth);

  // Crisp glowing cyan turntable outer ring + inner measurement ring
  const ringOuterGeo = trackRes(new THREE.RingGeometry(3.04, 3.09, 64));
  ringOuterGeo.rotateX(-Math.PI / 2);
  const cyanRingMat = trackRes(
    new THREE.MeshBasicMaterial({
      color: '#00F0FF',
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    })
  );
  const ringOuter = new THREE.Mesh(ringOuterGeo, cyanRingMat);
  ringOuter.position.y = 0.004;
  labGroup.add(ringOuter);

  const ringInnerGeo = trackRes(new THREE.RingGeometry(2.38, 2.405, 64));
  ringInnerGeo.rotateX(-Math.PI / 2);
  const amberRingMat = trackRes(
    new THREE.MeshBasicMaterial({
      color: '#F59E0B',
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    })
  );
  const ringInner = new THREE.Mesh(ringInnerGeo, amberRingMat);
  ringInner.position.y = 0.004;
  labGroup.add(ringInner);

  // Overhead Softbox LED light strip fixtures (visual ceiling bay strips)
  const softboxMat = trackRes(
    new THREE.MeshBasicMaterial({
      color: '#E2F5FF',
      side: THREE.DoubleSide,
    })
  );
  const softboxGeo = trackRes(new THREE.PlaneGeometry(5.6, 0.55));
  softboxGeo.rotateX(Math.PI / 2);
  for (const xOff of [-1.8, 0, 1.8]) {
    const panel = new THREE.Mesh(softboxGeo, softboxMat);
    panel.position.set(xOff, 4.6, 0);
    labGroup.add(panel);
  }

  // Lab Lighting Rig: overhead key + cyan rim + amber rim + cool studio bounce
  const labKey = new THREE.DirectionalLight('#F0F9FF', 2.2);
  labKey.position.set(2.5, 7.5, 3.2);
  labKey.castShadow = true;
  labKey.shadow.mapSize.set(1024, 1024);
  labKey.shadow.camera.near = 1;
  labKey.shadow.camera.far = 18;
  labKey.shadow.camera.left = -4.5;
  labKey.shadow.camera.right = 4.5;
  labKey.shadow.camera.top = 4.5;
  labKey.shadow.camera.bottom = -4.5;
  labKey.shadow.bias = -0.0008;
  labGroup.add(labKey);

  const labHemi = new THREE.HemisphereLight('#C8E6FF', '#0D121D', 0.95);
  labGroup.add(labHemi);

  // #00F0FF Cyan Rim Light (rear-left sculpting)
  const cyanRim = new THREE.PointLight('#00F0FF', 18, 16, 1.6);
  cyanRim.position.set(4.4, 2.3, -3.6);
  labGroup.add(cyanRim);

  // #F59E0B Amber Rim Light (front-right warm engineering accent)
  const amberRim = new THREE.PointLight('#F59E0B', 15, 16, 1.6);
  amberRim.position.set(-4.6, 2.0, 3.8);
  labGroup.add(amberRim);

  // Overhead softbox fill spot
  const overheadFill = new THREE.PointLight('#E0F2FE', 14, 14, 1.5);
  overheadFill.position.set(0, 4.4, 0.4);
  labGroup.add(overheadFill);

  scene.add(labGroup);

  // =========================================================================
  // 2. SUNLIT ART-OF-RALLY TRACK LIGHTING & SKY DOME RIG
  // =========================================================================
  const trackGroup = new THREE.Group();
  trackGroup.name = 'fx_track_environment';

  const sunLight = new THREE.DirectionalLight(initialTrack.sunColorHex, 2.45);
  sunLight.position.set(55, 68, 45);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 220;
  sunLight.shadow.camera.left = -42;
  sunLight.shadow.camera.right = 42;
  sunLight.shadow.camera.top = 42;
  sunLight.shadow.camera.bottom = -42;
  sunLight.shadow.bias = -0.0006;
  trackGroup.add(sunLight);
  trackGroup.add(sunLight.target);

  const hemiLight = new THREE.HemisphereLight(
    initialTrack.skyZenithHex,
    initialTrack.groundColorHex,
    0.92
  );
  trackGroup.add(hemiLight);

  // Warm rim fill from opposite sky angle for crisp faceted readability
  const bounceLight = new THREE.DirectionalLight(initialTrack.skyHorizonHex, 0.55);
  bounceLight.position.set(-45, 24, -40);
  trackGroup.add(bounceLight);

  const skyDome = createSkyDome(
    initialTrack.skyZenithHex,
    initialTrack.skyHorizonHex,
    initialTrack.sunColorHex,
    disposables
  );
  trackGroup.add(skyDome.mesh);

  scene.add(trackGroup);

  const sunOffset = new THREE.Vector3(52, 66, 42);

  const applyTrackColors = (
    track: ITrackSplineSchema,
    targetScene: THREE.Scene,
    activeMode: VisualMode
  ) => {
    sunLight.color.set(track.sunColorHex);
    hemiLight.color.set(track.skyZenithHex);
    hemiLight.groundColor.set(track.groundColorHex);
    bounceLight.color.set(track.skyHorizonHex);
    (skyDome.uniforms.uZenith.value as THREE.Color).set(track.skyZenithHex);
    (skyDome.uniforms.uHorizon.value as THREE.Color).set(track.skyHorizonHex);
    (skyDome.uniforms.uSunColor.value as THREE.Color).set(track.sunColorHex);

    if (activeMode === 'track') {
      targetScene.background = new THREE.Color(track.skyHorizonHex);
      targetScene.fog = new THREE.Fog(track.skyHorizonHex, 155, 860);
    }
  };

  return {
    labGroup,
    trackGroup,
    sunLight,
    setMode(mode, targetScene, track) {
      const isLab = mode === 'lab';
      labGroup.visible = isLab;
      trackGroup.visible = !isLab;

      if (isLab) {
        targetScene.background = LAB_BG_COLOR.clone();
        targetScene.fog = new THREE.FogExp2('#0A0C10', 0.028);
      } else {
        applyTrackColors(track, targetScene, 'track');
      }
    },
    updateTrackTheme(track, targetScene, activeMode) {
      applyTrackColors(track, targetScene, activeMode);
    },
    updateTrackFollow(carPos, camPos) {
      // Snap shadow-camera smoothly to car position so shadows stay crisp across whole circuit
      sunLight.target.position.copy(carPos);
      sunLight.position.copy(carPos).add(sunOffset);
      sunLight.target.updateMatrixWorld();

      // Keep sky dome centered on camera
      skyDome.mesh.position.copy(camPos);
    },
    dispose(targetScene) {
      targetScene.remove(labGroup);
      targetScene.remove(trackGroup);
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}
