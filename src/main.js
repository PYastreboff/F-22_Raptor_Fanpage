import * as THREE from 'three';
import './styles.css';
import { applyScheme, setAfterburnerIntensity } from './jet.js';
import { loadPhotoEnvironment } from './environment.js';
import { loadJetModel, applyGltfLivery } from './loadJet.js';
import { createComposer } from './postProcessing.js';
import {
  resolveHotspotFromMesh,
  findProximityHotspot,
} from './hotspots.js';
import {
  initLoadingUI,
  isPhoneDevice,
  setLoadProgress,
  hideLoading,
  failLoading,
  showDesktopOnlyScreen,
} from './loading.js';
import {
  collectExhaustEmits,
  startThrustVectorDemo,
  updateThrustVectorDemo,
} from './abTune.js';
import { resolveJetAxes } from './aircraftSystems.js';

const canvas = document.getElementById('scene');
const hoverZone = document.getElementById('hover-zone');
const hoverDetail = document.getElementById('hover-detail');
const hoverCard = document.querySelector('.hover-card');
const coordsEl = document.getElementById('coords');
const modeBadge = document.getElementById('mode-badge');
const throttleInput = document.getElementById('throttle');
const throttleVal = document.getElementById('throttle-val');
const tooltip = document.getElementById('hotspot-tooltip');
const radarCanvas = document.getElementById('radar-canvas');
const gearToggle = document.getElementById('gear-toggle');
const weaponsToggle = document.getElementById('weapons-toggle');
const fireButton = document.getElementById('fire-button');
const reloadMissilesButton = document.getElementById('reload-missiles');
const cameraZoomInput = document.getElementById('camera-zoom');
const cameraZoomVal = document.getElementById('camera-zoom-val');
const statSpeedContextEl = document.getElementById('stat-speed-context');

const mouse = { x: 0, y: 0, nx: 0, ny: 0, inside: false };
const targetRot = { x: 0.08, y: 0.35, z: 0 };
const currentRot = { x: 0.08, y: 0.35, z: 0 };
let throttle = 0.35;
let burstUntil = 0;
let cameraMode = 0;
let activeHotspot = null;
let zoom = 1.55;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 2.8;
const _particleScatter = new THREE.Vector3();

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const BASE_EXPOSURE = 1.05;
renderer.toneMappingExposure = BASE_EXPOSURE;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  38,
  window.innerWidth / window.innerHeight,
  0.1,
  300
);
const CAMERA_PRESETS = [
  { pos: new THREE.Vector3(1.8, 0.45, 6.2), look: new THREE.Vector3(0, 0.05, 0), label: 'CAM 1', followJet: true },
  { pos: new THREE.Vector3(5.5, 1.1, 3.2), look: new THREE.Vector3(0, 0.05, 0), label: 'CAM 2', followJet: true },
  { pos: new THREE.Vector3(-5, 0.9, 4.8), look: new THREE.Vector3(0, 0.05, 0), label: 'CAM 3', followJet: true },
  { pos: new THREE.Vector3(0, 0.55, -7.5), look: new THREE.Vector3(0, 0.05, -0.35), label: 'TAIL CAM', followJet: true },
  { pos: new THREE.Vector3(0, 10, 0.5), look: new THREE.Vector3(0, 0, 0), label: 'TOP VIEW', followJet: false },
  { pos: new THREE.Vector3(0, -8.5, 0.5), look: new THREE.Vector3(0, 0, 0), label: 'BOTTOM VIEW', followJet: false },
];
const _camDesired = new THREE.Vector3();
camera.position.copy(CAMERA_PRESETS[0].pos);

let envMap = null;
let gltfMaterials = null;
let post = null;
let sunLight = null;
let cloudSea = null;
let weatherController = null;

const jetGroup = new THREE.Group();
scene.add(jetGroup);

let raptor = null;
let afterburner = null;
let jetIsGltf = false;
let exhaustOrigin = { points: [], dir: new THREE.Vector3(0, 0, -1) };
let aircraftAnimRig = null;
let gearController = null;
let weaponsController = null;
let missileInventory = [];
const missileProjectiles = [];
let fireCooldownUntil = 0;
const MISSILE_FLIGHT_SCALE = 1.65;
const MISSILE_TRAIL_LENGTH = 2.1;
const _tmpV = new THREE.Vector3();
const _missileBox = new THREE.Box3();
const _missileSpawn = new THREE.Vector3();
const _missileCenter = new THREE.Vector3();
let activeSystem = 'stealth';
const CONTEXTUAL_SPEED = {
  stealth: 'Mach 0.95 (LO profile)',
  supercruise: 'Mach 1.72 · SUPERCRUISE',
  thrust: 'Nozzle vectoring · AB',
};
const SYSTEM_THROTTLE_PCT = {
  stealth: 12,
  supercruise: 75,
  thrust: 88,
};
let supercruiseUntil = 0;
let systemBadgeUntil = 0;
/** @type {{ from: number, to: number, start: number, duration: number } | null} */
let throttleAnim = null;
/** Slider % to restore after Space burst ends. */
let burstRestorePct = null;

const telemetry = { alt: 42000, hdg: 270, g: 1.0 };
let hudRefreshTimer = 0;

function formatInitError(err) {
  if (typeof err === 'string') return err;
  if (err instanceof Error && err.message) return err.message;
  return 'Failed to initialize 3D scene.';
}

function showLoadError(err) {
  const message = formatInitError(err);
  failLoading(message);
  console.error('[F-22]', message, err);
}

const mobileBlocked = isPhoneDevice();
let appReady = false;

initLoadingUI();

async function init() {
  try {
    setLoadProgress(0.08, 'Loading HDR sky…');
    const env = await loadPhotoEnvironment(renderer, scene, (p) => {
      setLoadProgress(0.08 + p * 0.28);
    });
    envMap = env.envMap;
    sunLight = env.sun;
    cloudSea = env.cloudSea;
    weatherController = env.weather;

    setLoadProgress(0.38, 'Setting up post-processing…');
    post = createComposer(renderer, scene, camera);

    setLoadProgress(0.42, 'Loading F-22 Raptor model…');
    const jet = await loadJetModel(envMap, (p) => {
      setLoadProgress(0.42 + p * 0.52);
    });
    raptor = jet.model;
    afterburner = jet.afterburner;
    jetIsGltf = jet.isGltf;
    aircraftAnimRig = jet.animRig || raptor.userData.animRig || null;
    gearController = aircraftAnimRig?.gear || jet.gear || raptor.userData.gear;
    weaponsController =
      aircraftAnimRig?.weapons || jet.weapons || raptor.userData.weapons;
    jetGroup.add(raptor);

    if (gearToggle && gearController) {
      gearController.setGearDown(false);
      gearToggle.checked = false;
    }
    if (weaponsToggle && weaponsController) {
      weaponsController.setDeployed(false);
      weaponsToggle.checked = false;
      weaponsToggle.disabled = false;
    } else if (weaponsToggle) {
      weaponsToggle.disabled = true;
    }
    if (fireButton) fireButton.disabled = true;

    if (jetIsGltf) {
      gltfMaterials = raptor.userData.materials;
      document.body.dataset.jetModel = 'gltf';
      console.info('[F-22] Photoreal GLTF loaded.');
    } else {
      document.body.dataset.jetModel = 'placeholder';
      const detail =
        jet.loadError ||
        'Run npm run dev:web or npm run dev — do not open index.html directly in the browser.';
      console.error('[F-22] Placeholder jet only.', detail);
      if (modeBadge) {
        modeBadge.textContent = 'PLACEHOLDER MODEL';
        modeBadge.classList.add('mode-badge--warn');
        modeBadge.title = detail;
      }
    }

    if (raptor && jetIsGltf) {
      missileInventory = collectMissileInventory(raptor);
      syncFireButton();
    }

    const ports = jet.enginePorts || [];
    exhaustOrigin = {
      points: ports.map((p) => p.clone()),
      dir: jet.exhaustDir?.clone() || new THREE.Vector3(0, 0, -1),
    };

    setLoadProgress(1, 'Systems online');
    hideLoading();
    appReady = true;
  } catch (err) {
    showLoadError(err?.message || 'Failed to initialize 3D scene.');
  }
}

if (mobileBlocked) {
  showDesktopOnlyScreen();
} else {
  setLoadProgress(0.02, 'Initializing renderer…');
  init();
}

const particles = createExhaustParticles();
scene.add(particles);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function createExhaustParticles() {
  const count = 100;
  const positions = new Float32Array(count * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffaa44,
    size: 0.1,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.userData.velocities = [];
  for (let i = 0; i < count; i++) {
    points.userData.velocities.push(new THREE.Vector3());
  }
  return points;
}

function getExhaustEmits() {
  if (!raptor) return [];
  const tuned = collectExhaustEmits(raptor);
  if (tuned.length) return tuned;
  if (!exhaustOrigin.points.length) return [];
  const dir = exhaustOrigin.dir.clone();
  if (raptor) dir.transformDirection(raptor.matrixWorld).normalize();
  return exhaustOrigin.points.map((local) => {
    const w = local.clone();
    raptor.localToWorld(w);
    return { position: w, direction: dir.clone() };
  });
}

function isAfterburnerBursting() {
  return performance.now() < burstUntil;
}

function getAfterburnerLevel() {
  const visuals = getSystemVisuals();
  const burstBoost = isAfterburnerBursting() ? 0.48 : 0;
  return Math.min(0.88, throttle * visuals.abMult + burstBoost);
}

function triggerAfterburnerBurst() {
  burstRestorePct = Math.round(throttle * 100);
  burstUntil = performance.now() + 1500;
  throttleAnim = null;
  throttle = 1;
  syncThrottleUI();
  flashModeBadge('AFTERBURNER', 1500);
}

function updateParticles(dt) {
  const positions = particles.geometry.attributes.position.array;
  const intensity = getAfterburnerLevel() * 0.75;
  particles.material.opacity = intensity * 0.42;

  const emits = getExhaustEmits();

  for (let i = 0; i < positions.length / 3; i++) {
    const v = particles.userData.velocities[i];
    if (emits.length && Math.random() < intensity * 0.35) {
      const emit = emits[Math.floor(Math.random() * emits.length)];
      const port = emit.position;
      const dir = emit.direction;
      positions[i * 3] = port.x + (Math.random() - 0.5) * 0.08;
      positions[i * 3 + 1] = port.y + (Math.random() - 0.5) * 0.06;
      positions[i * 3 + 2] = port.z + (Math.random() - 0.5) * 0.08;
      v.copy(dir).multiplyScalar(3 + Math.random() * 4);
      _particleScatter.set(
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.3
      );
      v.add(_particleScatter);
    }
    positions[i * 3] += v.x * dt;
    positions[i * 3 + 1] += v.y * dt;
    positions[i * 3 + 2] += v.z * dt;
    if (emits.length && v.length() > 12) {
      const emit = emits[i % emits.length];
      positions[i * 3] = emit.position.x;
      positions[i * 3 + 1] = emit.position.y;
      positions[i * 3 + 2] = emit.position.z;
      v.set(0, 0, 0);
    }
  }
  particles.geometry.attributes.position.needsUpdate = true;
}

function onPointerMove(e) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
  mouse.nx = (mouse.x / rect.width) * 2 - 1;
  mouse.ny = -(mouse.y / rect.height) * 2 + 1;
  mouse.inside =
    mouse.x >= 0 && mouse.y >= 0 && mouse.x <= rect.width && mouse.y <= rect.height;

  pointer.set(mouse.nx, mouse.ny);
  raycaster.setFromCamera(pointer, camera);

  if (!raptor) return;
  const meshes = [];
  raptor.traverse((child) => {
    if (child.isMesh && !child.userData.isEdge) meshes.push(child);
  });
  const hits = raycaster.intersectObjects(meshes, false);
  updateHotspot(hits[0]?.object, e.clientX, e.clientY);
}

function updateHotspot(hitMesh, x, y) {
  const catalog = raptor?.userData?.hotspotCatalog;
  if (!catalog) return;

  let found = resolveHotspotFromMesh(hitMesh, catalog);

  if (!found && mouse.inside && raptor.userData.proximityZones) {
    found = findProximityHotspot(
      raptor.userData.proximityZones,
      catalog,
      mouse.nx,
      mouse.ny,
      camera,
      jetGroup
    );
  }

  if ((found?.id ?? null) !== (activeHotspot?.id ?? null)) {
    activeHotspot = found;
    if (found) {
      hoverZone.textContent = found.label;
      hoverDetail.textContent = found.detail;
      hoverCard.classList.add('hot');
      tooltip.textContent = found.label;
      tooltip.classList.remove('hidden');
    } else {
      hoverZone.textContent = mouse.inside
        ? 'Tracking cursor — maneuvering'
        : 'Move cursor over the aircraft';
      hoverDetail.textContent = mouse.inside
        ? 'Bank and pitch follow your mouse. Use the afterburner slider for engine glow.'
        : 'Photoreal F-22 Raptor model with HDR sky lighting — hover to maneuver.';
      hoverCard.classList.remove('hot');
      tooltip.classList.add('hidden');
    }
  }

  if (found) {
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }
}

canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoom = THREE.MathUtils.clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);
    syncCameraZoomUI();
    modeBadge.textContent = `ZOOM ${Math.round(zoom * 100)}%`;
    clearTimeout(canvas._zoomBadgeTimer);
    canvas._zoomBadgeTimer = setTimeout(() => {
      modeBadge.textContent = 'INTERACTIVE';
    }, 700);
  },
  { passive: false }
);

canvas.addEventListener('pointerleave', () => {
  mouse.inside = false;
  activeHotspot = null;
  hoverCard.classList.remove('hot');
  tooltip.classList.add('hidden');
  hoverZone.textContent = 'Move cursor over the aircraft';
  hoverDetail.textContent =
    'Photoreal F-22 Raptor model with HDR sky lighting — hover to maneuver.';
});

window.addEventListener('keydown', (e) => {
  if ((e.code === 'Space' || e.key === ' ') && !e.repeat) {
    e.preventDefault();
    triggerAfterburnerBurst();
  }
  if (e.key >= '1' && e.key <= '6') {
    setCameraPreset(parseInt(e.key, 10) - 1);
  }
  if (e.key === 'g' || e.key === 'G') {
    toggleGear();
  }
  if (e.key === 'w' || e.key === 'W') {
    toggleWeapons();
  }
  if (isTypingInForm(e.target)) return;
  if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    fireOneMissile();
  }
  if (e.key === 'r' || e.key === 'R') {
    e.preventDefault();
    reloadMissiles();
  }
});

if (gearToggle) {
  gearToggle.addEventListener('change', () => {
    if (!gearController) return;
    gearController.setGearDown(gearToggle.checked);
  });
}

if (weaponsToggle) {
  weaponsToggle.addEventListener('change', () => {
    if (!weaponsController) return;
    weaponsController.setDeployed(weaponsToggle.checked);
    syncFireButton();
  });
}

function syncContextualSpeed() {
  if (!statSpeedContextEl) return;
  if (
    activeSystem === 'supercruise' &&
    performance.now() < supercruiseUntil
  ) {
    statSpeedContextEl.textContent = CONTEXTUAL_SPEED.supercruise;
    return;
  }
  statSpeedContextEl.textContent =
    CONTEXTUAL_SPEED[activeSystem] ?? '—';
}

function flashModeBadge(text, ms = 2200) {
  if (!modeBadge) return;
  modeBadge.textContent = text;
  systemBadgeUntil = performance.now() + ms;
}

function syncThrottleUI() {
  const pct = Math.round(throttle * 100);
  if (throttleInput) throttleInput.value = String(pct);
  if (throttleVal) throttleVal.textContent = `${pct}%`;
}

function setThrottlePercent(percent, animateMs = 0) {
  const target = THREE.MathUtils.clamp(percent / 100, 0, 1);
  if (!animateMs) {
    throttleAnim = null;
    throttle = target;
    syncThrottleUI();
    return;
  }
  throttleAnim = {
    from: throttle,
    to: target,
    start: performance.now(),
    duration: animateMs,
  };
}

function updateThrottleAnimation() {
  if (!throttleAnim) return;
  const t = (performance.now() - throttleAnim.start) / throttleAnim.duration;
  if (t >= 1) {
    throttle = throttleAnim.to;
    throttleAnim = null;
  } else {
    const ease = t * t * (3 - 2 * t);
    throttle = throttleAnim.from + (throttleAnim.to - throttleAnim.from) * ease;
  }
  syncThrottleUI();
}

function syncThrottleWithThrustVectorDemo() {
  const demo = raptor?.userData?.thrustVectorDemo;
  if (!demo) return false;
  const t = demo.elapsed / demo.duration;
  throttle = 0.7 + Math.sin(t * Math.PI * 2) * 0.2;
  syncThrottleUI();
  return true;
}

function applySystemMode(sys) {
  activeSystem = sys;
  const pct = SYSTEM_THROTTLE_PCT[sys] ?? Math.round(throttle * 100);

  if (sys === 'stealth') {
    setThrottlePercent(pct, 900);
    syncContextualSpeed();
    flashModeBadge('STEALTH');
    return;
  }

  if (sys === 'supercruise') {
    setThrottlePercent(pct, 700);
    supercruiseUntil = performance.now() + 8000;
    burstUntil = performance.now() + 1500;
    syncContextualSpeed();
    flashModeBadge('SUPERCRUISE');
    return;
  }

  if (sys === 'thrust') {
    if (raptor) startThrustVectorDemo(raptor);
    setThrottlePercent(pct, 800);
    syncContextualSpeed();
    setCameraPreset(3);
    burstUntil = performance.now() + 1200;
    flashModeBadge('THRUST VECTOR', 5600);
  }
}

function getSystemVisuals() {
  if (activeSystem === 'stealth') {
    return { abMult: 0.32, exposure: 0.86, bloom: 0.09, radarSpeed: 0.55 };
  }
  if (activeSystem === 'supercruise') {
    const boost = performance.now() < supercruiseUntil ? 1.08 : 1;
    return { abMult: 1.02 * boost, exposure: 1.02, bloom: 0.2, radarSpeed: 1.35 };
  }
  if (activeSystem === 'thrust') {
    return { abMult: 0.95, exposure: BASE_EXPOSURE, bloom: 0.18, radarSpeed: 1 };
  }
  return { abMult: 0.92, exposure: BASE_EXPOSURE, bloom: 0.18, radarSpeed: 1 };
}

function toggleGear() {
  if (!gearController) return;
  gearController.toggle();
  if (gearToggle) gearToggle.checked = gearController.isDown;
  modeBadge.textContent = gearController.isDown ? 'GEAR DOWN' : 'GEAR UP';
  setTimeout(() => {
    modeBadge.textContent = 'INTERACTIVE';
  }, 900);
}

function setCameraPreset(index) {
  cameraMode = THREE.MathUtils.clamp(index, 0, CAMERA_PRESETS.length - 1);
  const preset = CAMERA_PRESETS[cameraMode];
  modeBadge.textContent = preset.label;
  setTimeout(() => {
    modeBadge.textContent = 'INTERACTIVE';
  }, 800);
}

function toggleWeapons() {
  if (!weaponsController) return;
  weaponsController.toggle();
  if (weaponsToggle) weaponsToggle.checked = weaponsController.isDeployed;
  modeBadge.textContent = weaponsController.isDeployed ? 'WEAPONS OUT' : 'WEAPONS STOWED';
  syncFireButton();
  setTimeout(() => {
    modeBadge.textContent = 'INTERACTIVE';
  }, 900);
}

function isTypingInForm(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function isRocketMaterial(mesh) {
  const mat = mesh.material;
  const names = Array.isArray(mat) ? mat.map((m) => m?.name || '') : [mat?.name || ''];
  return names.some((n) => /rocket/i.test(n));
}

function subtreeIsRocketOnly(root) {
  let anyMesh = false;
  let ok = true;
  root.traverse((c) => {
    if (!ok || !c.isMesh) return;
    anyMesh = true;
    if (!isRocketMaterial(c)) ok = false;
  });
  return anyMesh && ok;
}

/**
 * One slot per physical missile: merge Main/Blue/Black mesh siblings (same parent),
 * stop before a parent holds multiple missile assemblies.
 */
function rocketAssemblyRoot(mesh, model) {
  let root = mesh;
  while (root.parent && root.parent !== model) {
    const parent = root.parent;
    if (!subtreeIsRocketOnly(parent)) break;

    const meshParts = parent.children.filter((c) => c.isMesh && isRocketMaterial(c));
    if (meshParts.length > 1) {
      root = parent;
      break;
    }

    const assemblies = parent.children.filter((c) => subtreeIsRocketOnly(c));
    if (assemblies.length > 1) break;

    root = parent;
  }
  return root;
}

function getSlotMeshes(slot) {
  if (slot.meshes?.length) return slot.meshes;
  const meshes = [];
  slot.root?.traverse((c) => {
    if (c.isMesh && isRocketMaterial(c)) meshes.push(c);
  });
  return meshes;
}

function clusterMeshesIntoSlots(meshes, model) {
  if (!meshes.length) return [];
  const axes = resolveJetAxes(model);
  const lat = axes.lateral;
  const span = axes.bodyBox.max[lat] - axes.bodyBox.min[lat];
  const threshold = Math.max(span * 0.07, 0.02);

  const entries = meshes.map((mesh) => {
    mesh.updateMatrixWorld(true, false);
    _missileBox.setFromObject(mesh);
    return { mesh, c: _missileBox.getCenter(new THREE.Vector3()) };
  });
  entries.sort((a, b) => a.c[lat] - b.c[lat]);

  const clusters = [];
  let group = [entries[0]];
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].c[lat] - entries[i - 1].c[lat] > threshold) {
      clusters.push(group);
      group = [];
    }
    group.push(entries[i]);
  }
  clusters.push(group);

  return clusters.map((cluster) => ({
    meshes: cluster.map((e) => e.mesh),
    root: cluster[0].mesh.parent,
    fired: false,
  }));
}

function collectMissileInventory(model) {
  const meshes = [];
  model.updateMatrixWorld(true);
  model.traverse((child) => {
    if (!child.isMesh || !isRocketMaterial(child)) return;
    meshes.push(child);
  });

  const byRoot = new Map();
  for (const mesh of meshes) {
    const root = rocketAssemblyRoot(mesh, model);
    if (root === model) continue;
    if (!byRoot.has(root)) byRoot.set(root, []);
    const list = byRoot.get(root);
    if (!list.includes(mesh)) list.push(mesh);
  }

  let slots = [...byRoot.entries()].map(([root, meshList]) => ({
    root,
    meshes: meshList,
    fired: false,
  }));

  // Every rocket under one rig → split into port / starboard by world position only.
  if (slots.length === 1 && slots[0].meshes.length > 3) {
    slots = clusterMeshesIntoSlots(slots[0].meshes, model);
  }

  return slots;
}

/** Outboard + forward corner from actual mesh geometry (not group pivot). */
function computeMissileSpawnWorld(slot, model) {
  const meshes = getSlotMeshes(slot);
  const axes = resolveJetAxes(model);
  const lat = axes.lateral;
  const forward = axes.forward;

  _missileBox.makeEmpty();
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true, false);
    _missileBox.expandByObject(mesh);
  }

  const center = _missileBox.getCenter(_missileSpawn);
  const sign = Math.sign(center[lat] - axes.bodyCenter[lat]) || 1;
  const bodyHalf = (axes.bodyBox.max[lat] - axes.bodyBox.min[lat]) * 0.5;

  let best = center.clone();
  let bestScore = -Infinity;
  const { min, max } = _missileBox;
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        _tmpV.set(x, y, z);
        const lateralOut = sign * (_tmpV[lat] - axes.bodyCenter[lat]);
        const score =
          lateralOut * 2.2 + (forward.dot(_tmpV) - forward.dot(axes.bodyCenter));
        if (score > bestScore) {
          bestScore = score;
          best.copy(_tmpV);
        }
      }
    }
  }

  const outDist = Math.abs(best[lat] - axes.bodyCenter[lat]);
  const minOut = bodyHalf * 0.3;
  if (outDist < minOut) {
    best[lat] = axes.bodyCenter[lat] + sign * minOut;
  }

  return best;
}

function nudgeCloneToWorldPoint(clone, worldPoint) {
  clone.updateMatrixWorld(true, false);
  _missileBox.setFromObject(clone);
  _missileBox.getCenter(_missileCenter);
  clone.position.add(_tmpV.copy(worldPoint).sub(_missileCenter));
}

function brightenMissileMaterials(root, { flight = false } = {}) {
  const emissiveIntensity = flight ? 1.15 : 0.5;
  root.traverse((child) => {
    if (!child.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    const upgraded = mats.map((m) => {
      if (!m) return m;
      const mat = m.clone();
      const label = mat.name || '';
      if (/blue/i.test(label)) {
        mat.emissive?.setHex(0x44aaff);
      } else if (/black/i.test(label)) {
        mat.emissive?.setHex(0x888899);
      } else {
        mat.emissive?.setHex(0xffcc66);
      }
      if (mat.emissive) mat.emissiveIntensity = emissiveIntensity;
      mat.metalness = Math.min(mat.metalness ?? 0.5, flight ? 0.35 : 0.5);
      mat.roughness = Math.max((mat.roughness ?? 0.5) * 0.8, 0.18);
      mat.color.multiplyScalar(flight ? 1.45 : 1.2);
      if (typeof mat.envMapIntensity === 'number') {
        mat.envMapIntensity *= flight ? 1.5 : 1.25;
      }
      mat.needsUpdate = true;
      return mat;
    });
    child.material = upgraded.length === 1 ? upgraded[0] : upgraded;
  });
}

function disposeMissileObject(obj) {
  obj.traverse((child) => {
    if (!child.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) mat?.dispose?.();
  });
}

function createLaunchClone(slot) {
  const launch = new THREE.Group();
  for (const mesh of getSlotMeshes(slot)) {
    launch.attach(mesh.clone());
  }
  brightenMissileMaterials(launch, { flight: true });
  launch.scale.setScalar(MISSILE_FLIGHT_SCALE);
  return launch;
}

function getMissileProjectileHead(obj, dir) {
  _missileBox.setFromObject(obj);
  const { min, max } = _missileBox;
  let bestFwd = -Infinity;
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        _tmpV.set(x, y, z);
        const f = dir.dot(_tmpV);
        if (f > bestFwd) {
          bestFwd = f;
          _missileCenter.copy(_tmpV);
        }
      }
    }
  }
  return _missileCenter;
}

function syncFireButton() {
  if (!fireButton) return;
  const bayOpen = !!weaponsController?.isDeployed;
  const hasAmmo = missileInventory.some((m) => !m.fired);
  fireButton.disabled = !(bayOpen && hasAmmo);
  fireButton.title = !bayOpen ? 'Open weapons bay first' : hasAmmo ? 'Fire' : 'Out of missiles';
  if (reloadMissilesButton) {
    reloadMissilesButton.disabled = missileInventory.length === 0;
    reloadMissilesButton.title =
      missileInventory.length === 0 ? 'No missiles found on this model' : 'Reload missiles';
  }
}

function reloadMissiles() {
  // Restore all in-bay missiles and clear launched ones.
  for (const m of missileInventory) {
    m.fired = false;
    if (m.root) m.root.visible = true;
    for (const mesh of getSlotMeshes(m)) {
      mesh.visible = true;
    }
  }
  // Remove active projectiles immediately.
  for (let i = missileProjectiles.length - 1; i >= 0; i--) {
    removeMissileProjectile(i);
  }
  syncFireButton();
  flashModeBadge('RELOADED', 900);
}

let _missileGlowTexture = null;

function getMissileGlowTexture() {
  if (_missileGlowTexture) return _missileGlowTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255, 248, 220, 1)');
  g.addColorStop(0.2, 'rgba(255, 210, 120, 0.9)');
  g.addColorStop(0.45, 'rgba(255, 140, 50, 0.45)');
  g.addColorStop(0.7, 'rgba(255, 90, 30, 0.12)');
  g.addColorStop(1, 'rgba(255, 60, 10, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _missileGlowTexture = new THREE.CanvasTexture(canvas);
  _missileGlowTexture.colorSpace = THREE.SRGBColorSpace;
  return _missileGlowTexture;
}

/** Soft circular motor glow (radial alpha — no hard square edges). */
function createMissileMotorGlow() {
  const tex = getMissileGlowTexture();
  const makeSprite = (scale, opacity) => {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(scale, scale, scale);
    sprite.userData.glowBaseOpacity = opacity;
    sprite.frustumCulled = false;
    return sprite;
  };

  const group = new THREE.Group();
  group.add(makeSprite(0.48, 0.55));
  group.add(makeSprite(0.3, 0.95));
  return group;
}

function disposeMissileGlow(glow) {
  if (!glow) return;
  glow.traverse((child) => {
    child.material?.dispose?.();
  });
}

function createMissileTrail() {
  const root = new THREE.Group();
  root.frustumCulled = false;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
  const core = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({
      color: 0xfff2cc,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  core.frustumCulled = false;

  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
  const halo = new THREE.Line(
    haloGeo,
    new THREE.LineBasicMaterial({
      color: 0xff8833,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  halo.frustumCulled = false;

  root.add(core, halo);
  root.userData.core = core;
  root.userData.halo = halo;
  return root;
}

function removeMissileProjectile(index) {
  const p = missileProjectiles[index];
  scene.remove(p.obj);
  disposeMissileObject(p.obj);
  scene.remove(p.trail);
  p.trail.traverse((c) => {
    c.geometry?.dispose?.();
    c.material?.dispose?.();
  });
  if (p.glow) {
    scene.remove(p.glow);
    disposeMissileGlow(p.glow);
  }
  missileProjectiles.splice(index, 1);
}

function updateMissileProjectiles(dt) {
  for (let i = missileProjectiles.length - 1; i >= 0; i--) {
    const p = missileProjectiles[i];
    p.age += dt;
    p.obj.position.addScaledVector(p.dir, p.speed * dt);
    p.speed *= 1.01;

    const head = getMissileProjectileHead(p.obj, p.dir);
    const tail = _tmpV.copy(head).addScaledVector(p.dir, -MISSILE_TRAIL_LENGTH);
    const fade = Math.max(0, 1 - p.age / p.life);

    const core = p.trail.userData.core;
    const halo = p.trail.userData.halo;
    if (core) {
      const pos = core.geometry.attributes.position;
      pos.setXYZ(0, head.x, head.y, head.z);
      pos.setXYZ(1, tail.x, tail.y, tail.z);
      pos.needsUpdate = true;
      core.material.opacity = fade;
    }
    if (halo) {
      const pos = halo.geometry.attributes.position;
      pos.setXYZ(0, head.x, head.y, head.z);
      pos.setXYZ(1, tail.x, tail.y, tail.z);
      pos.needsUpdate = true;
      halo.material.opacity = 0.85 * fade;
    }

    if (p.glow) {
      p.glow.position.copy(tail);
      p.glow.traverse((child) => {
        if (!child.material || child.userData.glowBaseOpacity === undefined) return;
        child.material.opacity = child.userData.glowBaseOpacity * fade;
      });
      const pulse = 1 + Math.sin(p.age * 28) * 0.06;
      p.glow.scale.set(pulse, pulse, pulse);
    }

    if (p.age >= p.life) {
      removeMissileProjectile(i);
    }
  }
}

function fireOneMissile() {
  if (!raptor || !jetIsGltf) return;
  if (!weaponsController?.isDeployed) {
    flashModeBadge('OPEN BAY', 900);
    return;
  }
  if (performance.now() < fireCooldownUntil) return;

  const slot = missileInventory.find((m) => !m.fired);
  if (!slot) return;

  // Final safety check: never hide the full aircraft.
  if (slot.root === raptor) return;

  slot.fired = true;
  if (slot.root) slot.root.visible = false;
  for (const mesh of getSlotMeshes(slot)) {
    mesh.visible = false;
  }

  const clone = createLaunchClone(slot);
  scene.add(clone);
  nudgeCloneToWorldPoint(clone, computeMissileSpawnWorld(slot, raptor));

  const axes = resolveJetAxes(raptor);
  const dir = axes.forward.clone().normalize();
  dir.x += (Math.random() - 0.5) * 0.02;
  dir.y += (Math.random() - 0.5) * 0.02;
  dir.z += (Math.random() - 0.5) * 0.02;
  dir.normalize();

  const trail = createMissileTrail();
  scene.add(trail);
  const glow = createMissileMotorGlow();
  scene.add(glow);

  missileProjectiles.push({
    obj: clone,
    trail,
    glow,
    dir,
    speed: 12 + Math.random() * 4,
    age: 0,
    life: 2.4,
  });

  fireCooldownUntil = performance.now() + 350;
  flashModeBadge('FIRE', 450);
  syncFireButton();
}

if (fireButton) {
  fireButton.addEventListener('click', () => fireOneMissile());
}
if (reloadMissilesButton) {
  reloadMissilesButton.addEventListener('click', () => reloadMissiles());
}

document.querySelectorAll('.weather').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.weather').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const id = btn.dataset.weather;
    weatherController?.setWeather(id);
    modeBadge.textContent = btn.textContent.toUpperCase();
    setTimeout(() => {
      modeBadge.textContent = 'INTERACTIVE';
    }, 900);
  });
});

document.querySelectorAll('.scheme').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.scheme').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const scheme = btn.dataset.scheme;
    if (raptor && jetIsGltf && gltfMaterials) {
      applyGltfLivery(gltfMaterials, scheme, envMap);
      raptor.userData.livery = scheme;
    } else if (raptor && !jetIsGltf) {
      applyScheme(raptor, scheme, envMap);
    }
  });
});

document.querySelectorAll('.pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    applySystemMode(pill.dataset.system);
  });
});

throttleInput.addEventListener('input', () => {
  throttleAnim = null;
  throttle = throttleInput.value / 100;
  syncThrottleUI();
});

function syncCameraZoomUI() {
  const pct = Math.round(zoom * 100);
  if (cameraZoomInput) cameraZoomInput.value = String(pct);
  if (cameraZoomVal) cameraZoomVal.textContent = `${pct}%`;
}

function setCameraZoomFromSlider() {
  if (!cameraZoomInput) return;
  zoom = THREE.MathUtils.clamp(Number(cameraZoomInput.value) / 100, ZOOM_MIN, ZOOM_MAX);
  syncCameraZoomUI();
}

if (cameraZoomInput) {
  syncCameraZoomUI();
  cameraZoomInput.addEventListener('input', setCameraZoomFromSlider);
}

let radarAngle = 0;
let radarSpinMul = 1;
function drawRadar() {
  const ctx = radarCanvas.getContext('2d');
  const w = radarCanvas.width;
  const h = radarCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = w / 2 - 4;

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (r * i) / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.stroke();

  radarAngle += 0.04 * radarSpinMul;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(radarAngle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r, -0.35, 0.35);
  ctx.closePath();
  const sweep = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  sweep.addColorStop(0, 'rgba(0, 229, 255, 0.35)');
  sweep.addColorStop(1, 'rgba(0, 229, 255, 0)');
  ctx.fillStyle = sweep;
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#00e5ff';
  const blipAngle = performance.now() * 0.0007;
  const bx = cx + Math.cos(blipAngle) * r * 0.55;
  const by = cy + Math.sin(blipAngle) * r * 0.4;
  ctx.beginPath();
  ctx.arc(bx, by, 3, 0, Math.PI * 2);
  ctx.fill();
}

function updateTelemetryHud(dt) {
  const targetAlt = 40000 - currentRot.x * 14000;
  let targetHdg = ((currentRot.y * 57.3) % 360 + 360) % 360;
  const targetG = 1 + Math.abs(currentRot.z) * 1.4;

  telemetry.alt += (targetAlt - telemetry.alt) * Math.min(1, dt * 2.5);

  let hdgDelta = targetHdg - telemetry.hdg;
  if (hdgDelta > 180) hdgDelta -= 360;
  if (hdgDelta < -180) hdgDelta += 360;
  telemetry.hdg += hdgDelta * Math.min(1, dt * 2.5);

  telemetry.g += (targetG - telemetry.g) * Math.min(1, dt * 2.5);

  hudRefreshTimer += dt;
  if (hudRefreshTimer < 0.2) return;
  hudRefreshTimer = 0;

  const alt = Math.round(telemetry.alt);
  const hdg = Math.round(telemetry.hdg) % 360;
  const g = telemetry.g.toFixed(1);
  const hdgStr = String(hdg).padStart(3, '0');

  coordsEl.textContent = `ALT ${alt.toLocaleString('en-US')} ft · HDG ${hdgStr}° · G ${g}`;
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  if (!appReady) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = performance.now() * 0.001;

  if (mouse.inside) {
    targetRot.y = 0.35 + mouse.nx * 1.15;
    targetRot.x = 0.06 + mouse.ny * 0.32;
    targetRot.z = -mouse.nx * 0.22;
  } else {
    targetRot.y = 0.35 + Math.sin(t * 0.3) * 0.15;
    targetRot.x = 0.06 + Math.sin(t * 0.22) * 0.04;
    targetRot.z = Math.sin(t * 0.18) * 0.03;
  }

  const lerp = mouse.inside ? 0.1 : 0.035;
  currentRot.x += (targetRot.x - currentRot.x) * lerp;
  currentRot.y += (targetRot.y - currentRot.y) * lerp;
  currentRot.z += (targetRot.z - currentRot.z) * lerp;

  if (raptor) {
    jetGroup.rotation.set(currentRot.x, currentRot.y, currentRot.z);
    jetGroup.position.y = Math.sin(t * 0.7) * 0.04;
  }
  const rollNorm = mouse.inside
    ? THREE.MathUtils.clamp(-mouse.nx, -1, 1)
    : THREE.MathUtils.clamp(currentRot.z / 0.22, -1, 1);

  const hadTvDemo = !!raptor?.userData?.thrustVectorDemo;
  if (raptor) updateThrustVectorDemo(raptor, dt);
  const hasTvDemo = !!raptor?.userData?.thrustVectorDemo;
  if (hadTvDemo && !hasTvDemo && activeSystem === 'thrust') {
    setThrottlePercent(SYSTEM_THROTTLE_PCT.thrust, 500);
  }

  if (isAfterburnerBursting()) {
    throttle = 1;
    syncThrottleUI();
  } else {
    if (burstRestorePct !== null) {
      setThrottlePercent(burstRestorePct, 450);
      burstRestorePct = null;
    }
    if (!syncThrottleWithThrustVectorDemo()) {
      updateThrottleAnimation();
    }
  }

  if (aircraftAnimRig) {
    aircraftAnimRig.update(dt, rollNorm);
  } else {
    gearController?.update(dt);
    weaponsController?.update(dt);
  }

  const visuals = getSystemVisuals();
  radarSpinMul = visuals.radarSpeed;

  const ab = getAfterburnerLevel();
  if (afterburner) setAfterburnerIntensity(afterburner, ab);

  renderer.toneMappingExposure = visuals.exposure;
  if (post?.bloom) {
    post.bloom.strength = visuals.bloom + ab * 0.16;
  }

  syncContextualSpeed();

  if (systemBadgeUntil > 0 && performance.now() > systemBadgeUntil && modeBadge) {
    if (modeBadge.textContent !== 'INTERACTIVE') modeBadge.textContent = 'INTERACTIVE';
    systemBadgeUntil = 0;
  }

  const preset = CAMERA_PRESETS[cameraMode];
  _camDesired.copy(preset.pos).multiplyScalar(zoom);
  if (preset.followJet) {
    _camDesired.applyMatrix4(new THREE.Matrix4().makeRotationY(currentRot.y * 0.12));
  }
  camera.position.lerp(_camDesired, 0.05);
  camera.lookAt(preset.look);

  weatherController?.update(dt);

  if (cloudSea) {
    const wind = cloudSea.userData.wind ?? 0.004;
    cloudSea.rotation.y += dt * wind;
    cloudSea.position.z = Math.sin(t * 0.1) * 1.5;
  }

  updateMissileProjectiles(dt);
  updateParticles(dt);
  drawRadar();

  updateTelemetryHud(dt);

  if (post) {
    post.composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const pr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (post) {
    post.composer.setPixelRatio(pr);
    post.composer.setSize(window.innerWidth, window.innerHeight);
    post.bloom.resolution.set(window.innerWidth, window.innerHeight);
  }
});

animate();
