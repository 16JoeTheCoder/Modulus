import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { IVehicleStateSnapshot } from '../../contracts/simulation';
import type { ICompiledVehicle, ITrackSplineSchema } from '../../core/types';
import { getCockpitAnchors } from '../../ui/engineBridge';
import { getCachedTrackPreview } from '../../ui/lab/TrackPreviewSvg';
import { formatSpeedFromKph, type PlayerSettings } from '../../ui/settingsStore';
import { STEERING_WHEELS, type SteeringWheelStyle } from '../../ui/steeringWheels';

const WHEEL_STYLES = Object.keys(STEERING_WHEELS) as SteeringWheelStyle[];

export function buildCockpit(
  compiled: ICompiledVehicle,
  track: <T extends { dispose(): void }>(resource: T) => T,
) {
  const { cockpitEyeLocal: eye } = getCockpitAnchors(compiled);
  const { bodyStyle, trackWidthM } = compiled;
  const utility = bodyStyle === 'pickup' || bodyStyle === 'minivan';
  const prototype = bodyStyle === 'prototype';
  const openTop = bodyStyle === 'roadster';
  const group = new THREE.Group();
  group.name = 'vehicle_cockpit_interior';
  group.position.set(eye.x, eye.y, eye.z);

  const trim = track(new THREE.MeshStandardMaterial({ color: '#27313c', roughness: 0.92 }));
  const grip = track(new THREE.MeshStandardMaterial({ color: '#323943', roughness: 0.9 }));
  const spokeMat = track(new THREE.MeshStandardMaterial({ color: '#616976', roughness: 0.63 }));
  const hoodMat = track(new THREE.MeshStandardMaterial({
    color: new THREE.Color(compiled.build.paintHex).lerp(new THREE.Color('#202a34'), 0.56),
    roughness: 0.62,
  }));

  const shelf = new THREE.Mesh(track(new RoundedBoxGeometry(trackWidthM * 1.62, 0.56, 0.29, 2, 0.055)), trim);
  shelf.position.set(-eye.x * 0.45, utility ? -0.515 : -0.505, 1.24);
  group.add(shelf);

  const hood = new THREE.Mesh(track(new THREE.BoxGeometry(trackWidthM * 0.75, 0.025, utility ? 0.95 : 0.85)), hoodMat);
  hood.position.set(-eye.x, utility ? -0.47 : -0.41, utility ? 1.52 : 1.63);
  hood.rotation.x = prototype ? 0.19 : 0.13;
  group.add(hood);

  // Keep the pillars at the periphery of the eye point and leave the apex clear.
  if (!openTop) {
    const pillarRadius = utility ? 0.015 : 0.011;
    for (const side of [-1, 1]) {
      const base = new THREE.Vector3(side * (0.65 + trackWidthM * 0.15), -0.29, 0.77);
      const top = new THREE.Vector3(side * (0.57 + trackWidthM * 0.15), utility ? 0.37 : 0.29, 0.49);
      const direction = top.clone().sub(base);
      const pillar = new THREE.Mesh(track(new THREE.CylinderGeometry(pillarRadius, pillarRadius, direction.length(), 6)), trim);
      pillar.position.copy(base).lerp(top, 0.5);
      pillar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      group.add(pillar);
    }
  }

  const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
  if (canvas) {
    canvas.width = 512;
    canvas.height = 160;
  }
  const context = canvas?.getContext('2d');
  const texture = canvas && context ? track(new THREE.CanvasTexture(canvas)) : null;
  if (texture) texture.colorSpace = THREE.SRGBColorSpace;
  const clusterWidth = utility ? 0.37 : 0.35;
  const surround = new THREE.Mesh(track(new RoundedBoxGeometry(clusterWidth + 0.026, 0.164, 0.105, 2, 0.012)), trim);
  surround.position.set(0, -0.159, 1.07);
  group.add(surround);
  const cluster = new THREE.Mesh(track(new THREE.PlaneGeometry(clusterWidth, 0.109)),
    track(new THREE.MeshBasicMaterial({ map: texture, color: texture ? '#ffffff' : '#141b23', toneMapped: false })));
  cluster.position.set(0, -0.145, 1.015);
  cluster.rotation.y = Math.PI;
  group.add(cluster);

  const addScreen = (x: number, width: number) => {
    const screen = typeof document === 'undefined' ? null : document.createElement('canvas');
    if (!screen) return null;
    screen.width = 480;
    screen.height = 244;
    const display = screen.getContext('2d');
    if (!display) return null;
    const image = track(new THREE.CanvasTexture(screen));
    image.colorSpace = THREE.SRGBColorSpace;
    const housing = new THREE.Mesh(track(new RoundedBoxGeometry(width + 0.02, 0.232, 0.10, 2, 0.012)), trim);
    housing.position.set(x, -0.27, 1.099);
    group.add(housing);
    const lcd = new THREE.Mesh(track(new THREE.PlaneGeometry(width, 0.212)),
      track(new THREE.MeshBasicMaterial({ map: image, toneMapped: false })));
    lcd.position.set(x, -0.27, 1.044);
    lcd.rotation.y = Math.PI;
    group.add(lcd);
    return { display, image };
  };
  const conditions = addScreen(0.47, 0.43);
  const navigation = addScreen(-0.45, 0.40);

  const steeringPivot = new THREE.Group();
  steeringPivot.name = 'cockpit_steering_wheel_pivot';
  steeringPivot.position.set(0, -0.357, utility ? 0.92 : 0.88);
  group.add(steeringPivot);
  const wheelX = utility ? 0.235 : 0.218;
  const wheelY = utility ? 0.195 : 0.184;
  const variants = new Map<SteeringWheelStyle, THREE.Group>();
  for (const id of WHEEL_STYLES) {
    const style = STEERING_WHEELS[id];
    const variant = new THREE.Group();
    variant.visible = id === 'road';
    steeringPivot.add(variant);
    variants.set(id, variant);
    const rimPath = new THREE.CatmullRomCurve3(style.outline.map(([x, y]) => new THREE.Vector3(x * wheelX, y * wheelY, 0)), style.closed);
    const rim = new THREE.Mesh(track(new THREE.TubeGeometry(rimPath, 48, id === 'formula' ? 0.018 : 0.014, 8, style.closed)), grip);
    variant.add(rim);

    const hubDepth = id === 'rally' ? 0.052 : 0.018;
    const hub = new THREE.Mesh(track(new THREE.CylinderGeometry(0.041, 0.046, 0.025, 10)), trim);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = hubDepth * 0.7;
    variant.add(hub);

    const center = new THREE.Vector3(0, 0, hubDepth);
    for (const [x, y] of style.spokes) {
      const end = new THREE.Vector3(x * wheelX, y * wheelY, 0);
      const direction = end.clone().sub(center);
      const spoke = new THREE.Mesh(track(new THREE.BoxGeometry(0.022, direction.length(), 0.012)), spokeMat);
      spoke.position.copy(center).lerp(end, 0.5);
      spoke.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      variant.add(spoke);
    }
  }

  let displayedStyle: SteeringWheelStyle = 'road';
  let lastReading = '';
  let lastAuxUpdateMs = -Infinity;
  let route: ITrackSplineSchema | undefined;
  let outline: ReturnType<typeof getCachedTrackPreview>['outline'] = [];
  let mapPath: Path2D | undefined;
  return {
    group,
    update(snapshot: IVehicleStateSnapshot, settings: PlayerSettings, activeTrack: ITrackSplineSchema) {
      if (displayedStyle !== settings.steeringWheel) {
        variants.get(displayedStyle)!.visible = false;
        displayedStyle = settings.steeringWheel;
        variants.get(displayedStyle)!.visible = true;
      }
      const maxRotation = displayedStyle === 'formula' || displayedStyle === 'yoke' ? 1.45 : 2.7;
      steeringPivot.rotation.z = -Math.max(-1, Math.min(1, snapshot.commandedSteer * 0.82 + snapshot.frontWheelAngleRad * 0.52)) * maxRotation;
      if (route !== activeTrack || Math.abs(snapshot.simTimeMs - lastAuxUpdateMs) >= 83) {
        lastAuxUpdateMs = snapshot.simTimeMs;
        if (conditions) {
          const { display, image } = conditions;
          display.fillStyle = '#101820';
          display.fillRect(0, 0, 480, 244);
          display.font = '600 22px sans-serif';
          display.fillStyle = '#acc1cd';
          display.fillText('TIRE / BRAKE TEMPERATURE · °C', 16, 32);
          for (const [index, label] of ['FL', 'FR', 'RL', 'RR'].entries()) {
            const wheel = snapshot.wheels[index];
            const x = 16 + (index % 2) * 234;
            const y = 79 + Math.floor(index / 2) * 48;
            display.fillStyle = '#78dceb';
            display.font = '700 24px monospace';
            display.fillText(label, x, y);
            display.fillStyle = wheel.brakeTempC >= 650 ? '#fc837a' : '#e9f5fa';
            display.fillText(`${Math.round(wheel.tireTempC)} / ${Math.round(wheel.brakeTempC)}`, x + 44, y);
          }
          display.fillStyle = '#2e3b4b';
          display.fillRect(16, 148, 448, 2);
          display.font = '600 22px sans-serif';
          display.fillStyle = '#acc1cd';
          display.fillText('FUEL', 16, 184);
          display.fillText('ENGINE', 250, 184);
          display.font = '700 30px monospace';
          display.fillStyle = '#eef7fb';
          display.fillText(`${snapshot.fuelLiters.toFixed(1)} L`, 16, 224);
          display.fillStyle = snapshot.engineTempC >= snapshot.engineMaxSafeTempC - 6 ? '#fc837a' : '#eef7fb';
          display.fillText(`${Math.round(snapshot.engineTempC)} °C`, 250, 224);
          image.needsUpdate = true;
        }
        if (navigation) {
          if (route !== activeTrack) {
            outline = getCachedTrackPreview(activeTrack).outline;
            mapPath = new Path2D();
            for (const [index, point] of outline.entries()) {
              const x = 144 + point.x * 192;
              const y = 40 + point.y * 192;
              if (index === 0) mapPath.moveTo(x, y);
              else mapPath.lineTo(x, y);
            }
            if (activeTrack.closed) mapPath.closePath();
          }
          const { display, image } = navigation;
          display.fillStyle = '#101820';
          display.fillRect(0, 0, 480, 244);
          display.fillStyle = '#acc1cd';
          display.font = '600 22px sans-serif';
          display.fillText(activeTrack.name.toUpperCase(), 16, 29, 448);
          if (mapPath) {
            display.strokeStyle = '#8c9cab';
            display.lineWidth = 6;
            display.lineJoin = 'round';
            display.stroke(mapPath);
          }
          const point = outline.find((sample) => sample.t >= snapshot.splineProgress) ?? outline.at(-1);
          if (point) {
            display.fillStyle = '#47efff';
            display.beginPath();
            display.arc(144 + point.x * 192, 40 + point.y * 192, 8, 0, Math.PI * 2);
            display.fill();
          }
          image.needsUpdate = true;
        }
        route = activeTrack;
      }
      if (!context || !texture) return;

      const speed = Math.round(formatSpeedFromKph(snapshot.speedMs * 3.6, settings.speedUnit));
      const unit = settings.speedUnit === 'mph' ? 'MPH' : 'KM/H';
      const gear = snapshot.gear < 0 ? 'R' : snapshot.gear === 0 ? 'N' : String(snapshot.gear);
      const rpm = Math.round(snapshot.engineRpm / 100);
      const shift = Math.round(Math.min(1, snapshot.engineRpm / Math.max(1000, snapshot.redlineRpm)) * 12);
      const reading = `${speed}/${unit}/${gear}/${rpm}/${shift}`;
      if (reading === lastReading) return;
      lastReading = reading;

      context.fillStyle = '#101820';
      context.fillRect(0, 0, 512, 160);
      for (let i = 0; i < 12; i++) {
        context.fillStyle = i >= shift ? '#2e3b4b' : i < 8 ? '#73ddea' : i < 10 ? '#ffd06f' : '#fc837a';
        context.fillRect(16 + i * 40, 12, 36, 11);
      }
      context.textBaseline = 'middle';
      context.fillStyle = '#eef7fb';
      context.font = '700 84px monospace';
      context.fillText(String(speed), 18, 85, 185);
      context.font = '600 25px sans-serif';
      context.fillStyle = '#acc1cd';
      context.fillText(unit, 24, 135);
      context.fillText('RPM', 208, 135);
      context.fillText('GEAR', 402, 135);
      context.font = '600 44px monospace';
      context.fillStyle = '#eef7fb';
      context.fillText((rpm / 10).toFixed(1) + 'k', 208, 92, 161);
      context.font = '700 75px monospace';
      context.fillStyle = '#8beaf3';
      context.fillText(gear, 411, 83);
      texture.needsUpdate = true;
    },
  };
}
