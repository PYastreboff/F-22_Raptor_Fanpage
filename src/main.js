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
import { initLoadingUI, setLoadProgress, hideLoading, failLoading } from './loading.js';

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
const cameraZoomInput = document.getElementById('camera-zoom');
const cameraZoomVal = document.getElementById('camera-zoom-val');

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
const _exhaustWorld = new THREE.Vector3();

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
renderer.toneMappingExposure = 1.05;
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
let gearController = null;
let weaponsController = null;

const telemetry = { alt: 42000, hdg: 270, g: 1.0 };
let hudRefreshTimer = 0;

function showLoadError(message) {
  failLoading(message);
  console.error('[F-22]', message);
}

initLoadingUI();
setLoadProgress(0.02, 'Initializing renderer…');

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
    gearController = jet.gear || raptor.userData.gear;
    weaponsController = jet.weapons || raptor.userData.weapons;
    jetGroup.add(raptor);

    if (gearToggle && gearController) {
      gearToggle.checked = gearController.isDown;
    }
    if (weaponsToggle && weaponsController) {
      weaponsToggle.checked = weaponsController.isDeployed;
      weaponsToggle.disabled = false;
    } else if (weaponsToggle) {
      weaponsToggle.disabled = true;
    }

    if (jetIsGltf) {
      gltfMaterials = raptor.userData.materials;
    }

    const ports = jet.enginePorts || [];
    exhaustOrigin = {
      points: ports.map((p) => p.clone()),
      dir: jet.exhaustDir?.clone() || new THREE.Vector3(0, 0, -1),
    };

    setLoadProgress(1, 'Systems online');
    hideLoading();
  } catch (err) {
    showLoadError(err?.message || 'Failed to initialize 3D scene.');
  }
}

init();

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

function getWorldExhaustPoints() {
  if (!raptor) return [];
  const anchors = raptor.userData.exhaustAnchors;
  if (anchors?.length) {
    return anchors.map((anchor) => {
      anchor.getWorldPosition(_exhaustWorld);
      return _exhaustWorld.clone();
    });
  }
  if (!exhaustOrigin.points.length) return [];
  return exhaustOrigin.points.map((local) => {
    const w = local.clone();
    raptor.localToWorld(w);
    return w;
  });
}

function updateParticles(dt) {
  const positions = particles.geometry.attributes.position.array;
  const intensity =
    Math.max(throttle, burstUntil > performance.now() ? 1 : 0) * 0.85;
  particles.material.opacity = intensity * 0.55;

  const ports = getWorldExhaustPoints();
  const dir = exhaustOrigin.dir.clone();
  if (raptor) dir.transformDirection(raptor.matrixWorld).normalize();

  for (let i = 0; i < positions.length / 3; i++) {
    const v = particles.userData.velocities[i];
    if (ports.length && Math.random() < intensity * 0.35) {
      const port = ports[Math.floor(Math.random() * ports.length)];
      positions[i * 3] = port.x + (Math.random() - 0.5) * 0.08;
      positions[i * 3 + 1] = port.y + (Math.random() - 0.5) * 0.06;
      positions[i * 3 + 2] = port.z + (Math.random() - 0.5) * 0.08;
      v.copy(dir).multiplyScalar(3 + Math.random() * 4);
      v.y += (Math.random() - 0.5) * 0.3;
    }
    positions[i * 3] += v.x * dt;
    positions[i * 3 + 1] += v.y * dt;
    positions[i * 3 + 2] += v.z * dt;
    if (ports.length && v.length() > 12) {
      const port = ports[i % ports.length];
      positions[i * 3] = port.x;
      positions[i * 3 + 1] = port.y;
      positions[i * 3 + 2] = port.z;
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
        : 'Photoreal F-22 model with HDR sky lighting — hover to maneuver.';
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
    'Photoreal F-22 model with HDR sky lighting — hover to maneuver.';
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    burstUntil = performance.now() + 1200;
    modeBadge.textContent = 'AFTERBURNER';
    setTimeout(() => {
      modeBadge.textContent = 'INTERACTIVE';
    }, 1200);
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
  });
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
  setTimeout(() => {
    modeBadge.textContent = 'INTERACTIVE';
  }, 900);
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
    const sys = pill.dataset.system;
    if (sys === 'supercruise') {
      throttleInput.value = 75;
      throttle = 0.75;
      throttleVal.textContent = '75%';
    } else if (sys === 'thrust') {
      targetRot.z = 0.35;
      setTimeout(() => {
        targetRot.z = 0;
      }, 600);
    }
  });
});

throttleInput.addEventListener('input', () => {
  throttle = throttleInput.value / 100;
  throttleVal.textContent = `${throttleInput.value}%`;
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

  radarAngle += 0.04;
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
  gearController?.update(dt);
  weaponsController?.update(dt);

  const ab = throttle + (burstUntil > performance.now() ? 0.7 : 0);
  if (afterburner) setAfterburnerIntensity(afterburner, Math.min(1, ab));
  if (post?.bloom) post.bloom.strength = 0.18 + ab * 0.2;

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
