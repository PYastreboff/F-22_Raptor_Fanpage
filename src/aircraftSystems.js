import * as THREE from 'three';
import { PropertyBinding } from 'three';
import { createAfterburnerAssembly } from './jet.js';
import {
  applyPlumeTune,
  clonePlumeTune,
  computeAnchorSeparationDir,
  defaultPlumeTune,
  loadSavedAbTune,
} from './abTune.js';

const CAMERA_FORWARD = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _dirLocal = new THREE.Vector3();
const _exit = new THREE.Vector3();
const _worldExit = new THREE.Vector3();
const _worldCenter = new THREE.Vector3();
const _perp = new THREE.Vector3();

function modelUpFromAxes(axes) {
  const lat = new THREE.Vector3();
  lat[axes.lateral] = 1;
  return lat.cross(axes.forward).normalize();
}

const EXHAUST_MATERIAL = /^Material\.(009|010|011|012|005)$/;
const NOZZLE_MESH = /^Object_(9|10|11)$/;

function materialLabel(material) {
  if (!material) return '';
  if (Array.isArray(material)) {
    return material.map((m) => m?.name || '').join(' ');
  }
  return material.name || '';
}

function axialOffset(point, center, forward) {
  return forward.dot(point.clone().sub(center));
}

function alongSpanFromBox(bodyBox, bodyCenter, forward) {
  const corners = [
    new THREE.Vector3(bodyBox.min.x, bodyBox.min.y, bodyBox.min.z),
    new THREE.Vector3(bodyBox.min.x, bodyBox.min.y, bodyBox.max.z),
    new THREE.Vector3(bodyBox.min.x, bodyBox.max.y, bodyBox.min.z),
    new THREE.Vector3(bodyBox.min.x, bodyBox.max.y, bodyBox.max.z),
    new THREE.Vector3(bodyBox.max.x, bodyBox.min.y, bodyBox.min.z),
    new THREE.Vector3(bodyBox.max.x, bodyBox.min.y, bodyBox.max.z),
    new THREE.Vector3(bodyBox.max.x, bodyBox.max.y, bodyBox.min.z),
    new THREE.Vector3(bodyBox.max.x, bodyBox.max.y, bodyBox.max.z),
  ];
  let min = Infinity;
  let max = -Infinity;
  for (const c of corners) {
    const a = axialOffset(c, bodyCenter, forward);
    min = Math.min(min, a);
    max = Math.max(max, a);
  }
  return { min, max, span: max - min };
}

function pickLateralAxis(forward) {
  const ax = Math.abs(forward.x);
  const ay = Math.abs(forward.y);
  const az = Math.abs(forward.z);
  if (ay > ax && ay > az) return 'z';
  if (az > ax && az > ay) return 'x';
  return 'z';
}

function averageMeshCenterByMaterial(model, test) {
  const sum = new THREE.Vector3();
  let count = 0;
  model.traverse((child) => {
    if (!child.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) {
      if (m && test(m.name || '')) {
        sum.add(new THREE.Box3().setFromObject(child).getCenter(new THREE.Vector3()));
        count++;
        break;
      }
    }
  });
  if (!count) return null;
  return sum.divideScalar(count);
}

function isInnerNozzleMesh(mesh) {
  if (NOZZLE_MESH.test(mesh.name || '')) return true;
  return /Material\.010|Material\.011/.test(materialLabel(mesh.material));
}

function isExhaustRingMesh(mesh) {
  return /Material\.009/i.test(materialLabel(mesh.material));
}

/** Prefer the inner exhaust ring mesh co-located with a nozzle shroud. */
function resolveExitMesh(nozzleMesh) {
  const parent = nozzleMesh.parent;
  if (!parent) return nozzleMesh;

  let ring = null;
  parent.traverse((child) => {
    if (child.isMesh && isExhaustRingMesh(child)) ring = child;
  });
  return ring || nozzleMesh;
}

function boxCorners(box) {
  const { min, max } = box;
  return [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ];
}

/** Nose toward camera (+Z); exhaust at tail (-Z). */
export function resolveJetAxes(model) {
  model.updateMatrixWorld(true);

  const bodyBox = new THREE.Box3().setFromObject(model);
  const bodyCenter = bodyBox.getCenter(new THREE.Vector3());

  const nose = averageMeshCenterByMaterial(model, (name) =>
    /gray_nose|^nose/i.test(name)
  );
  const tail = averageMeshCenterByMaterial(model, (name) => /^tail$/i.test(name));

  let forward = new THREE.Vector3(0, 0, 1);

  if (nose) {
    forward.subVectors(nose, bodyCenter).normalize();
  } else if (tail) {
    forward.subVectors(bodyCenter, tail).normalize();
  }

  if (tail) {
    const tailAlongNose = axialOffset(tail, bodyCenter, forward);
    if (tailAlongNose > 0) forward.negate();
  }

  if (forward.dot(CAMERA_FORWARD) < 0) forward.negate();

  const exhaustDir = forward.clone().negate();
  const lateral = pickLateralAxis(forward);
  const along = alongSpanFromBox(bodyBox, bodyCenter, forward);

  return {
    forward,
    exhaustDir,
    bodyCenter,
    bodyBox,
    lateral,
    alongMin: along.min,
    alongMax: along.max,
    alongSpan: along.span,
  };
}

/** Rear opening of nozzle mesh in world space — flush with the exhaust ring. */
function getNozzleExitWorldPoint(mesh, worldExhaustDir, modelUp) {
  mesh.updateWorldMatrix(true, false);

  const exhaust = worldExhaustDir.clone().normalize();
  const worldBox = new THREE.Box3().setFromObject(mesh);
  const size = worldBox.getSize(new THREE.Vector3());
  const corners = boxCorners(worldBox);

  let maxProj = -Infinity;
  for (const corner of corners) {
    maxProj = Math.max(maxProj, exhaust.dot(corner));
  }

  const eps = Math.max(size.length() * 1.5e-3, 1e-4);
  const rear = [];
  for (const corner of corners) {
    if (maxProj - exhaust.dot(corner) <= eps) rear.push(corner);
  }
  if (!rear.length) rear.push(...corners);

  _worldExit.copy(rear[0]);
  let minUp = modelUp ? modelUp.dot(_worldExit) : Infinity;
  for (const point of rear) {
    if (modelUp) {
      const up = modelUp.dot(point);
      if (up < minUp) {
        minUp = up;
        _worldExit.copy(point);
      }
    } else {
      _worldExit.add(point);
    }
  }
  if (!modelUp) _worldExit.divideScalar(rear.length);

  worldBox.getCenter(_worldCenter);
  _perp.copy(_worldCenter).sub(_worldExit);
  _perp.addScaledVector(exhaust, -exhaust.dot(_perp));
  _worldExit.addScaledVector(_perp, 0.12);

  _worldExit.addScaledVector(exhaust, size.length() * 0.006);

  return _worldExit;
}

function getNozzleExitLocal(anchorMesh, exitMesh, worldExhaustDir, modelUp) {
  _exit.copy(getNozzleExitWorldPoint(exitMesh, worldExhaustDir, modelUp));
  return anchorMesh.worldToLocal(_exit);
}

export function getNozzleExitWorld(mesh, worldExhaustDir, modelUp = null) {
  mesh.updateWorldMatrix(true, false);
  return getNozzleExitWorldPoint(resolveExitMesh(mesh), worldExhaustDir, modelUp);
}

/** Find inner nozzle meshes (one per engine bank). */
export function findThrusterNozzles(model, axes) {
  const { bodyCenter, forward, exhaustDir, lateral } = axes;
  const tailGate = axes.alongMin + axes.alongSpan * 0.4;

  const candidates = [];

  model.traverse((child) => {
    if (!child.isMesh || !isInnerNozzleMesh(child)) return;

    child.updateWorldMatrix(true, false);
    const worldCenter = new THREE.Box3().setFromObject(child).getCenter(new THREE.Vector3());
    const along = axialOffset(worldCenter, bodyCenter, forward);
    if (along > tailGate) return;

    candidates.push({
      mesh: child,
      along,
      lateral: worldCenter[lateral],
    });
  });

  const pickBest = (list) =>
    [...list].sort((a, b) => a.along - b.along)[0];

  let nozzles = [];
  if (candidates.length) {
    const sorted = [...candidates].sort((a, b) => a.lateral - b.lateral);
    const mid =
      sorted.length > 1
        ? (sorted[0].lateral + sorted[sorted.length - 1].lateral) * 0.5
        : bodyCenter[lateral];

    const left = pickBest(candidates.filter((c) => c.lateral <= mid));
    const right = pickBest(candidates.filter((c) => c.lateral > mid));

    if (left) nozzles.push(left.mesh);
    if (right && right.mesh !== left?.mesh) nozzles.push(right.mesh);
  }

  const modelUp = modelUpFromAxes(axes);
  let ports = nozzles.map((mesh) =>
    getNozzleExitWorldPoint(resolveExitMesh(mesh), exhaustDir, modelUp)
  );

  if (ports.length < 2) {
    ports = buildSymmetricExhaustPorts(axes, ports[0] || null);
    nozzles = [];
  }

  return { nozzles, ports, exhaustDir };
}

function buildSymmetricExhaustPorts(axes, seedPort) {
  const { bodyCenter, exhaustDir, bodyBox, lateral } = axes;
  const halfSpan = Math.max(
    (bodyBox.max[lateral] - bodyBox.min[lateral]) * 0.12,
    0.32
  );

  const rear = bodyCenter.clone().add(
    exhaustDir.clone().multiplyScalar(axes.alongSpan * 0.44)
  );

  const left = rear.clone();
  const right = rear.clone();

  if (seedPort) {
    const lat = seedPort[lateral];
    left.copy(seedPort);
    right.copy(seedPort);
    left[lateral] = lat - halfSpan;
    right[lateral] = lat + halfSpan;
  } else {
    left[lateral] -= halfSpan;
    right[lateral] += halfSpan;
  }

  return [left, right];
}

function worldPointToModelLocal(model, worldPoint) {
  return model.worldToLocal(worldPoint.clone());
}

function exhaustDirInModelLocal(model, worldExhaustDir) {
  _dirLocal.copy(worldExhaustDir).transformDirection(model.matrixWorld.clone().invert());
  return _dirLocal.normalize();
}

export function attachAfterburnerToThrusters(model, axes) {
  const { nozzles, ports, exhaustDir } = findThrusterNozzles(model, axes);
  const dir = exhaustDir.clone().normalize();
  const modelUp = modelUpFromAxes(axes);
  model.updateMatrixWorld(true);

  const group = new THREE.Group();
  group.name = 'afterburner-rig';
  const flames = [];
  const nozzleMeshes = [];
  const plumeEntries = [];
  const savedTune = loadSavedAbTune();
  model.userData.abSeparation = savedTune.separation;

  const attachPoints =
    nozzles.length > 0
      ? nozzles.map((mesh) => {
          const exitMesh = resolveExitMesh(mesh);
          return {
            mesh,
            exitMesh,
            world: getNozzleExitWorldPoint(exitMesh, dir, modelUp),
          };
        })
      : ports.map((world) => ({ mesh: null, exitMesh: null, world }));

  for (const { mesh, exitMesh, world } of attachPoints) {
    const anchor = new THREE.Object3D();
    anchor.name = 'exhaust-anchor';

    const orientMesh = exitMesh || mesh;
    const dirLocal = orientMesh
      ? dir.clone().transformDirection(orientMesh.matrixWorld.clone().invert()).normalize()
      : exhaustDirInModelLocal(model, dir);

    if (mesh) {
      anchor.position.copy(
        getNozzleExitLocal(mesh, exitMesh || mesh, dir, modelUp)
      );
      mesh.add(anchor);
    } else {
      anchor.position.copy(worldPointToModelLocal(model, world));
      model.add(anchor);
    }

    anchor.quaternion.setFromUnitVectors(Y_AXIS, dirLocal);

    const plume = createAfterburnerAssembly();
    const sizeSource = exitMesh || mesh;
    const nozzleSize = sizeSource
      ? new THREE.Box3().setFromObject(sizeSource).getSize(new THREE.Vector3()).length
      : Math.max(axes.alongSpan * 0.04, 0.35);
    const baseY = -nozzleSize * 0.14;
    const defaults = defaultPlumeTune(baseY);
    plume.userData.abTuneDefaults = defaults;
    const side = plumeEntries.length === 0 ? 'port' : 'starboard';
    const tuned = clonePlumeTune(savedTune[side] || defaults);
    plume.userData.abTune = tuned;
    plume.userData.abSide = side;
    plume.userData.abSeparationDir = computeAnchorSeparationDir(
      anchor,
      model,
      axes.lateral
    );
    applyPlumeTune(plume, tuned, {
      side,
      separation: model.userData.abSeparation,
    });
    anchor.add(plume);
    flames.push(...plume.userData.flames);

    plumeEntries.push({ side, plume });
    nozzleMeshes.push(anchor);
  }

  group.userData.flames = flames;
  model.userData.nozzleMeshes = nozzleMeshes;
  model.userData.exhaustAnchors = nozzleMeshes;
  model.add(group);
  model.userData.afterburner = group;
  model.userData.exhaustDir = dir;
  model.userData.enginePorts = ports.map((p) => p.clone());

  return group;
}

export function findExhaustPorts(model) {
  const axes = resolveJetAxes(model);
  const { ports, exhaustDir } = findThrusterNozzles(model, axes);
  return { ports, exhaustDir, forward: axes.forward, axes };
}

function trackNodeName(track) {
  return PropertyBinding.parseTrackName(track.name).nodeName;
}

/** GLTF track / node names omit the Blender dot (e.g. Cube048_91, not Cube.048_91). */
const WEAPONS_EMPTY =
  /^Empty\.?(004|005|007|008|009|010|011|012)(?:_|$)/;
/** Landing gear struts, wheels, and bays (finish by end of clip). */
const GEAR_MECH_NODE =
  /^Cylinder\.?(013|018)(?:_|$)|^Empty\.?003(?:_|$)/;
/** Missile racks only (not door panels). */
const WEAPONS_MISSILE_NODE = /^Cube\.?(068|069)(?:_|$)/;

/** Not driven by gear / weapons / rudders (055 unused). */
const ANIM_EXCLUDE_CUBE = new Set(['055']);
/** Back rudders — driven by cursor roll in createRudderAnimController. */
const RUDDER_CUBE = new Set(['043', '044']);
const CLIP_RUDDER_DEFLECT_SEC = 22.5;

/** Door panel groups (debug assignment). */
const GEAR_DOOR_CUBE = new Set([
  '016',
  '048',
  '049',
  '050',
  '051',
  '052',
  '056',
  '059',
  '060',
]);
const WEAPONS_DOOR_CUBE = new Set(['048', '049', '058', '061', '062', '064']);
/** Open with gear (G) and weapons bay (W) — reconciled after both door controllers tick. */
const DUAL_BAY_DOOR_CUBE = new Set(['048', '049']);
/** Gear panels that reach open pose later in the 25s GLTF clip (~9.2s). */
const GEAR_DOOR_LATE_CUBE = new Set(['016', '051', '056', '059', '060']);
const CLIP_GEAR_DOOR_EARLY_SEC = 1.5;
const CLIP_GEAR_DOOR_LATE_SEC = 9.2;
const CLIP_WEAPONS_DOOR_SEC = 9.2;

function cubeIdFromNode(nodeName) {
  const match = nodeName.match(/^Cube\.?(\d{3})(?:_|$)/);
  return match ? match[1] : null;
}

export function classifyAnimatedNode(model, nodeName) {
  const cubeId = cubeIdFromNode(nodeName);
  if (cubeId) {
    if (ANIM_EXCLUDE_CUBE.has(cubeId) || RUDDER_CUBE.has(cubeId)) return null;
    if (GEAR_DOOR_CUBE.has(cubeId)) return 'gearDoors';
    if (WEAPONS_DOOR_CUBE.has(cubeId)) return 'weaponsDoors';
    if (WEAPONS_MISSILE_NODE.test(nodeName)) return 'weaponsMissiles';
  }

  if (GEAR_MECH_NODE.test(nodeName)) return 'gearMech';
  if (WEAPONS_EMPTY.test(nodeName)) return 'weaponsMissiles';

  const node = model.getObjectByName(nodeName);
  if (node) {
    if (cubeId && ANIM_EXCLUDE_CUBE.has(cubeId)) return null;
    let tyre = false;
    let rocket = false;
    node.traverse((child) => {
      if (!child.isMesh) return;
      const label = materialLabel(child.material);
      if (/tyre/i.test(label)) tyre = true;
      if (/rocket/i.test(label)) rocket = true;
    });
    if (tyre) return 'gearMech';
    if (rocket) return 'weaponsMissiles';
  }

  return null;
}

const ANIM_FPS = 30;
/** First keyed time in the Sketchfab clip — bays closed / gear up. */
const CLIP_STOWED_SEC = 0.0416666679084301;

/** Deploy pose time on the source GLTF timeline for a door panel. */
function doorDeployTime(nodeName, kind, fullDuration) {
  const s = fullDuration / 25;
  const cubeId = cubeIdFromNode(nodeName);
  if (kind === 'gearDoors') {
    if (cubeId && GEAR_DOOR_LATE_CUBE.has(cubeId)) return CLIP_GEAR_DOOR_LATE_SEC * s;
    return CLIP_GEAR_DOOR_EARLY_SEC * s;
  }
  if (kind === 'weaponsDoors') return CLIP_WEAPONS_DOOR_SEC * s;
  return sourceDeployTime(kind, fullDuration);
}

/** Deploy pose time on the source 25s GLTF timeline. */
function sourceDeployTime(kind, fullDuration) {
  const s = fullDuration / 25;
  switch (kind) {
    case 'gearDoors':
      return CLIP_GEAR_DOOR_EARLY_SEC * s;
    case 'gearMech':
      return fullDuration;
    case 'weaponsDoors':
      return CLIP_WEAPONS_DOOR_SEC * s;
    case 'weaponsMissiles':
      return 10.791666984558105 * s;
    default:
      return fullDuration;
  }
}

function sampleDeployedPoses(scratch, fullClip, nodeNames, kind, fullDuration) {
  const byTime = new Map();
  for (const name of nodeNames) {
    const t = doorDeployTime(name, kind, fullDuration);
    if (!byTime.has(t)) byTime.set(t, []);
    byTime.get(t).push(name);
  }
  const deployed = {};
  for (const [timeSec, names] of byTime) {
    Object.assign(deployed, sampleClipPoses(scratch, fullClip, timeSec, names));
  }
  return deployed;
}

/** Filter tracks by group, trim to [stowed → deploy] and rebase so t=0 is closed. */
function extractTrimmedSubclip(fullClip, model, kind, fullDuration) {
  const tracks = fullClip.tracks.filter((track) => {
    const group = classifyAnimatedNode(model, trackNodeName(track));
    return group === kind;
  });
  if (!tracks.length) return null;

  const deployEnd =
    kind === 'gearDoors'
      ? doorDeployTime('Cube051_70', kind, fullDuration)
      : sourceDeployTime(kind, fullDuration);
  const raw = new THREE.AnimationClip(`${fullClip.name}_${kind}_raw`, fullDuration, tracks);
  const startFrame = CLIP_STOWED_SEC * ANIM_FPS;
  const endFrame = deployEnd * ANIM_FPS + 1;

  return THREE.AnimationUtils.subclip(raw, kind, startFrame, endFrame, ANIM_FPS);
}

function collectNodesForKind(fullClip, model, kind) {
  const names = new Set();
  for (const track of fullClip.tracks) {
    const nodeName = trackNodeName(track);
    const cubeId = cubeIdFromNode(nodeName);
    if (
      kind === 'weaponsDoors' &&
      cubeId &&
      WEAPONS_DOOR_CUBE.has(cubeId)
    ) {
      names.add(nodeName);
      continue;
    }
    if (classifyAnimatedNode(model, nodeName) === kind) names.add(nodeName);
  }
  return [...names];
}

function sampleClipPoses(root, clip, timeSec, nodeNames) {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  action.setEffectiveTimeScale(0);
  action.time = timeSec;
  mixer.update(0);

  const poses = {};
  for (const name of nodeNames) {
    const node = root.getObjectByName(name);
    if (!node) continue;
    poses[name] = {
      quat: node.quaternion.clone(),
      pos: node.position.clone(),
      scale: node.scale.clone(),
    };
  }
  return poses;
}

function disposeScratchMeshes(root) {
  root.traverse((child) => {
    if (child.isMesh && child.geometry) child.geometry.dispose();
  });
}

/** Clone for pose sampling — strip userData to avoid circular refs (animRig, gltf.scene). */
function cloneModelForSampling(model) {
  const scratch = model.clone(true);
  scratch.traverse((child) => {
    child.userData = {};
  });
  return scratch;
}

function applyPoseBlend(model, nodeNames, stowed, deployed, alpha) {
  for (const name of nodeNames) {
    const node = model.getObjectByName(name);
    const a = stowed[name];
    const b = deployed[name];
    if (!node || !a || !b) continue;
    node.quaternion.slerpQuaternions(a.quat, b.quat, alpha);
    node.position.lerpVectors(a.pos, b.pos, alpha);
    node.scale.lerpVectors(a.scale, b.scale, alpha);
    node.updateMatrix();
  }
  model.updateMatrixWorld(true);
}

/**
 * Door panels: sample open/closed poses from the full GLTF clip on a scratch copy,
 * then lerp on the live model (AnimationMixer subclips do not reliably drive doors).
 */
function createPoseAnimController(model, fullClip, kind, fullDuration, animSeconds) {
  const nodeNames = collectNodesForKind(fullClip, model, kind);
  if (!nodeNames.length) return null;

  const scratch = cloneModelForSampling(model);
  const stowed = sampleClipPoses(scratch, fullClip, CLIP_STOWED_SEC, nodeNames);
  const deployed = sampleDeployedPoses(scratch, fullClip, nodeNames, kind, fullDuration);
  disposeScratchMeshes(scratch);

  let alpha = 0;
  let target = 0;
  let isDeployed = false;
  applyPoseBlend(model, nodeNames, stowed, deployed, 0);

  return {
    kind,
    get isDown() {
      return isDeployed;
    },
    get isDeployed() {
      return isDeployed;
    },
    setDeployed(deployed) {
      isDeployed = deployed;
      target = deployed ? 1 : 0;
    },
    setGearDown(down) {
      this.setDeployed(down);
    },
    toggle() {
      this.setDeployed(!isDeployed);
      return isDeployed;
    },
    get blendAlpha() {
      return alpha;
    },
    tick(dt) {
      if (Math.abs(alpha - target) > 0.001) {
        const speed = 1 / animSeconds;
        alpha += Math.sign(target - alpha) * speed * dt;
        alpha = THREE.MathUtils.clamp(alpha, 0, 1);
      } else {
        alpha = target;
      }
      applyPoseBlend(model, nodeNames, stowed, deployed, alpha);
    },
    update(dt) {
      this.tick(dt);
    },
  };
}

function collectDualBayNodeNames(fullClip) {
  const names = new Set();
  for (const track of fullClip.tracks) {
    const nodeName = trackNodeName(track);
    const cubeId = cubeIdFromNode(nodeName);
    if (cubeId && DUAL_BAY_DOOR_CUBE.has(cubeId)) names.add(nodeName);
  }
  return [...names];
}

/** C048 / C049 — gear and weapons both drive these; apply after G and W door ticks. */
function createDualBayDoorBlender(fullClip, model, fullDuration) {
  const nodeNames = collectDualBayNodeNames(fullClip);
  if (!nodeNames.length) return null;

  const scratch = cloneModelForSampling(model);
  const stowed = sampleClipPoses(scratch, fullClip, CLIP_STOWED_SEC, nodeNames);
  const gearOpen = sampleDeployedPoses(
    scratch,
    fullClip,
    nodeNames,
    'gearDoors',
    fullDuration
  );
  const weaponOpen = sampleDeployedPoses(
    scratch,
    fullClip,
    nodeNames,
    'weaponsDoors',
    fullDuration
  );
  disposeScratchMeshes(scratch);

  return {
    apply(gearDown, weaponsOpen, gearAlpha, weaponsAlpha) {
      const gA = gearDown ? gearAlpha : 0;
      const wA = weaponsOpen ? weaponsAlpha : 0;
      const alpha = Math.max(gA, wA);
      if (alpha < 0.001) {
        applyPoseBlend(model, nodeNames, stowed, stowed, 0);
        return;
      }
      const deployed =
        weaponsOpen && wA >= gA ? weaponOpen : gearOpen;
      applyPoseBlend(model, nodeNames, stowed, deployed, alpha);
    },
  };
}

const DEPLOY_ANIM_SECONDS = 2.4;
const GEAR_MECH_DEPLOY_SECONDS = 3.6;
const GEAR_MECH_RETRACT_SECONDS = 1.25;
const MISSILE_DEPLOY_SECONDS = 1.15;
const DOOR_DEPLOY_SECONDS = 1.6;
const RUDDER_FOLLOW_SPEED = 7;

function deployAnimSeconds(kind) {
  if (kind === 'weaponsMissiles') return MISSILE_DEPLOY_SECONDS;
  if (kind === 'gearDoors' || kind === 'weaponsDoors') return DOOR_DEPLOY_SECONDS;
  return DEPLOY_ANIM_SECONDS;
}

/** Each controller owns a mixer so door / mech / missile clips do not fight on one mixer. */
function createClipController(model, subclip, kind, timing = {}) {
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(subclip);
  action.clampWhenFinished = true;
  action.setLoop(THREE.LoopOnce, 1);
  action.enabled = true;
  action.setEffectiveWeight(1);
  action.play();
  action.paused = false;
  action.setEffectiveTimeScale(0);

  const tStowed = 0;
  const tDeployed = subclip.duration;

  let current = tStowed;
  let target = tStowed;
  let isDeployed = false;

  action.time = tStowed;
  mixer.update(0);

  const travel = Math.abs(tDeployed - tStowed) || 0.001;
  const deploySec = timing.deploySeconds ?? deployAnimSeconds(kind);
  const retractSec = timing.retractSeconds ?? deploySec;
  const scrubSpeedDeploy = travel / deploySec;
  const scrubSpeedRetract = travel / retractSec;

  const applyPose = () => {
    action.time = current;
    action.setEffectiveTimeScale(0);
    mixer.update(0);
  };

  return {
    kind,
    get isDown() {
      return isDeployed;
    },
    get isDeployed() {
      return isDeployed;
    },
    setDeployed(deployed) {
      isDeployed = deployed;
      target = deployed ? tDeployed : tStowed;
    },
    setGearDown(down) {
      this.setDeployed(down);
    },
    toggle() {
      this.setDeployed(!isDeployed);
      return isDeployed;
    },
    tick(dt) {
      if (Math.abs(current - target) < 0.0008) {
        current = target;
      } else {
        const extending = target > current;
        const speed = extending ? scrubSpeedDeploy : scrubSpeedRetract;
        current += Math.sign(target - current) * speed * dt;
        current = THREE.MathUtils.clamp(current, 0, tDeployed);
      }
      applyPose();
    },
    update(dt) {
      this.tick(dt);
    },
  };
}

function createGearAnimController(fullClip, model, fullDuration) {
  const doors = createPoseAnimController(
    model,
    fullClip,
    'gearDoors',
    fullDuration,
    DOOR_DEPLOY_SECONDS
  );
  const mechClip = extractTrimmedSubclip(fullClip, model, 'gearMech', fullDuration);
  const mech = mechClip
    ? createClipController(model, mechClip, 'gearMech', {
        deploySeconds: GEAR_MECH_DEPLOY_SECONDS,
        retractSeconds: GEAR_MECH_RETRACT_SECONDS,
      })
    : null;

  if (!doors && !mech) return null;

  let isDeployed = false;

  return {
    doors,
    mech,
    get isDown() {
      return isDeployed;
    },
    get isDeployed() {
      return isDeployed;
    },
    setGearDown(down) {
      isDeployed = down;
      doors?.setDeployed(down);
      mech?.setDeployed(down);
    },
    setDeployed(down) {
      this.setGearDown(down);
    },
    toggle() {
      this.setGearDown(!isDeployed);
      return isDeployed;
    },
    tick(dt) {
      mech?.tick(dt);
      doors?.tick(dt);
    },
    update(dt) {
      this.tick(dt);
    },
  };
}

function createWeaponsAnimController(fullClip, model, fullDuration) {
  const doors = createPoseAnimController(
    model,
    fullClip,
    'weaponsDoors',
    fullDuration,
    DOOR_DEPLOY_SECONDS
  );
  const missilesClip = extractTrimmedSubclip(
    fullClip,
    model,
    'weaponsMissiles',
    fullDuration
  );
  const missiles = missilesClip
    ? createClipController(model, missilesClip, 'weaponsMissiles')
    : null;

  if (!doors && !missiles) return null;

  let isDeployed = false;

  return {
    doors,
    missiles,
    get isDeployed() {
      return isDeployed;
    },
    setDeployed(deployed) {
      isDeployed = deployed;
      doors?.setDeployed(deployed);
      missiles?.setDeployed(deployed);
    },
    toggle() {
      this.setDeployed(!isDeployed);
      return isDeployed;
    },
    tick(dt) {
      missiles?.tick(dt);
      doors?.tick(dt);
    },
    update(dt) {
      this.tick(dt);
    },
  };
}

function collectRudderNodeNames(fullClip) {
  const names = new Set();
  for (const track of fullClip.tracks) {
    const cubeId = cubeIdFromNode(trackNodeName(track));
    if (cubeId && RUDDER_CUBE.has(cubeId)) names.add(trackNodeName(track));
  }
  return [...names];
}

function mirrorRudderPoses(stowed, deflected) {
  const left = {};
  for (const name of Object.keys(stowed)) {
    const a = stowed[name];
    const b = deflected[name];
    if (!a || !b) continue;
    const deltaQ = a.quat.clone().invert().multiply(b.quat);
    left[name] = {
      quat: a.quat.clone().multiply(deltaQ.clone().invert()),
      pos: a.pos.clone().sub(b.pos).add(a.pos),
      scale: a.scale.clone(),
    };
  }
  return left;
}

function applyRudderPoseBlend(model, nodeNames, stowed, left, right, roll) {
  const amount = Math.abs(roll);
  for (const name of nodeNames) {
    const node = model.getObjectByName(name);
    const s = stowed[name];
    const target = roll >= 0 ? right[name] : left[name];
    if (!node || !s || !target) continue;
    if (amount < 0.001) {
      node.quaternion.copy(s.quat);
      node.position.copy(s.pos);
      node.scale.copy(s.scale);
    } else {
      node.quaternion.slerpQuaternions(s.quat, target.quat, amount);
      node.position.lerpVectors(s.pos, target.pos, amount);
      node.scale.lerpVectors(s.scale, target.scale, amount);
    }
    node.updateMatrix();
  }
  model.updateMatrixWorld(true);
}

/** Back rudders follow cursor bank (roll), not gear / weapons toggles. */
function createRudderAnimController(fullClip, model, fullDuration) {
  const nodeNames = collectRudderNodeNames(fullClip);
  if (!nodeNames.length) return null;

  const deflectTime = (CLIP_RUDDER_DEFLECT_SEC / 25) * fullDuration;
  const scratch = cloneModelForSampling(model);
  const stowed = sampleClipPoses(scratch, fullClip, CLIP_STOWED_SEC, nodeNames);
  const deflected = sampleClipPoses(scratch, fullClip, deflectTime, nodeNames);
  const left = mirrorRudderPoses(stowed, deflected);
  disposeScratchMeshes(scratch);

  let smoothRoll = 0;

  return {
    tick(dt, rollNorm) {
      const target = THREE.MathUtils.clamp(rollNorm, -1, 1);
      smoothRoll = THREE.MathUtils.damp(smoothRoll, target, RUDDER_FOLLOW_SPEED, dt);
      applyRudderPoseBlend(model, nodeNames, stowed, left, deflected, smoothRoll);
    },
    update(dt, rollNorm) {
      this.tick(dt, rollNorm);
    },
  };
}

export function createAircraftAnimRig(gltf, model) {
  if (!gltf.animations?.length) return null;

  const fullClip = gltf.animations[0];
  const duration = fullClip.duration;
  const gear = createGearAnimController(fullClip, model, duration);
  const weapons = createWeaponsAnimController(fullClip, model, duration);
  const rudders = createRudderAnimController(fullClip, model, duration);
  const dualBay = createDualBayDoorBlender(fullClip, model, duration);

  if (!gear && !weapons && !rudders) return null;

  gear?.setGearDown(false);
  weapons?.setDeployed(false);

  return {
    gear,
    weapons,
    rudders,
    update(dt, rollNorm = 0) {
      gear?.tick(dt);
      weapons?.tick(dt);
      if (dualBay) {
        dualBay.apply(
          gear?.isDown ?? false,
          weapons?.isDeployed ?? false,
          gear?.doors?.blendAlpha ?? 0,
          weapons?.doors?.blendAlpha ?? 0
        );
      }
      rudders?.tick(dt, rollNorm);
    },
  };
}

/** Fallback when the procedural jet is used instead of the GLTF. */
export function createProceduralWeaponsController(model) {
  let door = null;
  model.traverse((child) => {
    if (child.userData?.isWeaponsDoor) door = child;
  });
  if (!door) return null;

  let isDeployed = false;
  let current = 0;
  let target = 0;
  const closedRot = door.rotation.x;

  return {
    get isDeployed() {
      return isDeployed;
    },
    setDeployed(deployed) {
      isDeployed = deployed;
      target = deployed ? 1 : 0;
    },
    toggle() {
      this.setDeployed(!isDeployed);
      return isDeployed;
    },
    update(dt) {
      if (Math.abs(current - target) < 0.01) {
        current = target;
      } else {
        current += Math.sign(target - current) * dt * 1.8;
        current = THREE.MathUtils.clamp(current, 0, 1);
      }
      door.rotation.x = closedRot - current * Math.PI * 0.52;
    },
  };
}
