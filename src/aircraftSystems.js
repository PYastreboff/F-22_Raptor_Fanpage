import * as THREE from 'three';
import { PropertyBinding } from 'three';
import { createAfterburnerAssembly } from './jet.js';

const CAMERA_FORWARD = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _dirLocal = new THREE.Vector3();
const _exit = new THREE.Vector3();
const _worldExit = new THREE.Vector3();
const _localExhaust = new THREE.Vector3();
const _localCenter = new THREE.Vector3();

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

/** Rear exhaust-ring center in world space (local bbox → flush with nozzle opening). */
function getNozzleExitWorldPoint(mesh, worldExhaustDir) {
  mesh.updateWorldMatrix(true, false);

  const exhaust = worldExhaustDir.clone().normalize();
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  const box = mesh.geometry.boundingBox;

  mesh.updateWorldMatrix(true, false);
  const inv = mesh.matrixWorld.clone().invert();
  _localExhaust.copy(exhaust).transformDirection(inv).normalize();

  let maxProj = -Infinity;
  for (const corner of boxCorners(box)) {
    maxProj = Math.max(maxProj, _localExhaust.dot(corner));
  }

  const eps = Math.max(mesh.geometry.boundingSphere?.radius || 0.1, 0.05) * 0.02;
  const rear = [];
  for (const corner of boxCorners(box)) {
    if (maxProj - _localExhaust.dot(corner) <= eps) rear.push(corner);
  }
  if (!rear.length) rear.push(...boxCorners(box));

  box.getCenter(_localCenter);
  _exit.copy(_localCenter);
  const centerProj = _localExhaust.dot(_localCenter);
  _exit.addScaledVector(_localExhaust, maxProj - centerProj);

  mesh.localToWorld(_exit);
  _worldExit.copy(_exit);

  const worldScale = new THREE.Vector3();
  mesh.getWorldScale(worldScale);
  const nozzleScale =
    Math.max(worldScale.x, worldScale.y, worldScale.z) *
    (mesh.geometry.boundingSphere?.radius || 0.05);
  _worldExit.addScaledVector(exhaust, nozzleScale * 0.04);

  return _worldExit;
}

function getNozzleExitLocal(anchorMesh, exitMesh, worldExhaustDir) {
  _exit.copy(getNozzleExitWorldPoint(exitMesh, worldExhaustDir));
  return anchorMesh.worldToLocal(_exit);
}

export function getNozzleExitWorld(mesh, worldExhaustDir) {
  mesh.updateWorldMatrix(true, false);
  return getNozzleExitWorldPoint(resolveExitMesh(mesh), worldExhaustDir);
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

  let ports = nozzles.map((mesh) =>
    getNozzleExitWorldPoint(resolveExitMesh(mesh), exhaustDir)
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
  model.updateMatrixWorld(true);

  const group = new THREE.Group();
  group.name = 'afterburner-rig';
  const flames = [];
  const nozzleMeshes = [];

  const attachPoints =
    nozzles.length > 0
      ? nozzles.map((mesh) => {
          const exitMesh = resolveExitMesh(mesh);
          return {
            mesh,
            exitMesh,
            world: getNozzleExitWorldPoint(exitMesh, dir),
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
      anchor.position.copy(getNozzleExitLocal(mesh, exitMesh || mesh, dir));
      mesh.add(anchor);
    } else {
      anchor.position.copy(worldPointToModelLocal(model, world));
      model.add(anchor);
    }

    anchor.quaternion.setFromUnitVectors(Y_AXIS, dirLocal);

    const plume = createAfterburnerAssembly();
    const nozzleSize = exitMesh
      ? new THREE.Box3().setFromObject(exitMesh).getSize(new THREE.Vector3()).length()
      : 0.2;
    plume.position.y = -nozzleSize * 0.06;
    anchor.add(plume);
    flames.push(...plume.userData.flames);

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

const WEAPONS_EMPTY =
  /^Empty\.(004|005|007|008|009|010|011|012)(?:_|$)/;
/** Landing gear struts, wheels, and main-gear door panels. */
const GEAR_NODE =
  /^Cube\.(048|049|050|051|052)(?:_|$)|^Cylinder\.(013|018)(?:_|$)|^Empty\.003(?:_|$)/;
/** Weapons bay doors + missile racks (not landing-gear doors). */
const WEAPONS_NODE =
  /^Cube\.(016|043|044|055|056|058|059|060|061|062|064|068|069)(?:_|$)/;

function classifyAnimatedNode(model, nodeName) {
  if (GEAR_NODE.test(nodeName)) return 'gear';
  if (WEAPONS_NODE.test(nodeName) || WEAPONS_EMPTY.test(nodeName)) return 'weapons';

  const node = model.getObjectByName(nodeName);
  if (node) {
    let tyre = false;
    let rocket = false;
    node.traverse((child) => {
      if (!child.isMesh) return;
      const label = materialLabel(child.material);
      if (/tyre/i.test(label)) tyre = true;
      if (/rocket/i.test(label)) rocket = true;
    });
    if (tyre) return 'gear';
    if (rocket) return 'weapons';
  }

  return null;
}

function extractSubclip(fullClip, model, kind) {
  const tracks = fullClip.tracks.filter((track) => {
    const group = classifyAnimatedNode(model, trackNodeName(track));
    return kind === 'gear' ? group === 'gear' : group === 'weapons';
  });
  if (!tracks.length) return null;
  return new THREE.AnimationClip(`${fullClip.name}_${kind}`, fullClip.duration, tracks);
}

/**
 * This GLTF uses one timeline for everything. Key poses (25s clip):
 * - ~1.5s: gear down + main-gear doors open
 * - ~10.8s: weapons bay missiles extended
 * - 25s: gear up, weapons stowed
 */
function resolveClipTimes(kind, duration) {
  const s = duration / 25;
  if (kind === 'gear') {
    return { stowed: duration, deployed: 1.5 * s };
  }
  if (kind === 'weapons') {
    return { stowed: duration, deployed: 10.791666984558105 * s };
  }
  return { stowed: 0, deployed: duration };
}

function createClipController(mixer, subclip, kind, model, bodyCenter) {
  const action = mixer.clipAction(subclip);
  action.clampWhenFinished = true;
  action.setLoop(THREE.LoopOnce, 1);
  action.enabled = true;
  action.setEffectiveWeight(1);
  action.play();
  action.paused = true;

  const times = resolveClipTimes(kind, subclip.duration);
  const tStowed = times.stowed;
  const tDeployed = times.deployed;

  let current = tStowed;
  let target = tStowed;
  let isDeployed = false;

  action.time = tStowed;
  mixer.update(1 / 60);

  const tMin = Math.min(tStowed, tDeployed);
  const tMax = Math.max(tStowed, tDeployed);

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
      // Avoid scrubbing through unrelated poses (e.g. weapons bay at 2.7s).
      if (kind === 'weapons') {
        current = target;
        action.time = current;
      }
    },
    setGearDown(down) {
      this.setDeployed(down);
    },
    toggle() {
      this.setDeployed(!isDeployed);
      return isDeployed;
    },
    tick(dt) {
      if (kind === 'weapons') {
        current = target;
      } else if (Math.abs(current - target) < 0.001) {
        current = target;
      } else {
        const speed = subclip.duration / 2.2;
        current += Math.sign(target - current) * speed * dt;
        current = THREE.MathUtils.clamp(current, tMin, tMax);
      }
      action.time = current;
      action.paused = true;
    },
    /** @deprecated Prefer aircraftAnimRig.update(); kept for procedural weapons fallback. */
    update(dt) {
      this.tick(dt);
      mixer.update(Math.max(dt, 1 / 120));
    },
  };
}

/** One mixer + gear/weapons actions so door and missile tracks stay in sync. */
export function createAircraftAnimRig(gltf, model, bodyCenter) {
  if (!gltf.animations?.length) return null;

  const fullClip = gltf.animations[0];
  const gearClip = extractSubclip(fullClip, model, 'gear');
  const weaponsClip = extractSubclip(fullClip, model, 'weapons');
  if (!gearClip && !weaponsClip) return null;

  const mixer = new THREE.AnimationMixer(model);
  const gear = gearClip
    ? createClipController(mixer, gearClip, 'gear', model, bodyCenter)
    : null;
  const weapons = weaponsClip
    ? createClipController(mixer, weaponsClip, 'weapons', model, bodyCenter)
    : null;

  return {
    mixer,
    gear,
    weapons,
    update(dt) {
      const step = Math.max(dt, 1 / 120);
      gear?.tick(dt);
      weapons?.tick(dt);
      mixer.update(step);
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
