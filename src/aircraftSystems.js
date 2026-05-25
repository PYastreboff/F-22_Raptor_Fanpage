import * as THREE from 'three';
import { PropertyBinding } from 'three';
import { createAfterburnerAssembly } from './jet.js';

const CAMERA_FORWARD = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _dirLocal = new THREE.Vector3();
const _exit = new THREE.Vector3();
const _worldExit = new THREE.Vector3();
const _modelUp = new THREE.Vector3();
const _modelDown = new THREE.Vector3();

/** Nudge exhaust anchors down along the airframe up axis (fraction of nozzle size). */
const EXHAUST_DOWN_FACTOR = 0.28;

function modelUpFromAxes(axes) {
  const lat = new THREE.Vector3();
  lat[axes.lateral] = 1;
  return _modelUp.copy(lat).cross(axes.forward).normalize();
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

function getNozzleExitWorldPoint(mesh, worldExhaustDir, modelUp) {
  mesh.updateWorldMatrix(true, false);

  const exhaust = worldExhaustDir.clone().normalize();
  const worldBox = new THREE.Box3().setFromObject(mesh);
  const size = worldBox.getSize(new THREE.Vector3());
  const worldCorners = boxCorners(worldBox);

  let maxProj = -Infinity;
  for (const corner of worldCorners) {
    maxProj = Math.max(maxProj, exhaust.dot(corner));
  }

  const eps = Math.max(size.length() * 1e-4, 1e-5);
  const rear = [];
  for (const corner of worldCorners) {
    if (maxProj - exhaust.dot(corner) <= eps) rear.push(corner);
  }
  if (!rear.length) rear.push(...worldCorners);

  _worldExit.set(0, 0, 0);
  for (const point of rear) _worldExit.add(point);
  _worldExit.divideScalar(rear.length);

  if (modelUp) {
    let lowest = rear[0];
    let minUp = modelUp.dot(lowest);
    for (const point of rear) {
      const up = modelUp.dot(point);
      if (up < minUp) {
        minUp = up;
        lowest = point;
      }
    }
    _worldExit.addScaledVector(modelUp, minUp - modelUp.dot(_worldExit));
    _modelDown.copy(modelUp).negate();
    _worldExit.addScaledVector(_modelDown, size.length() * EXHAUST_DOWN_FACTOR);
  }

  _worldExit.addScaledVector(exhaust, size.length() * 0.012);

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
      anchor.position.copy(getNozzleExitLocal(mesh, exitMesh || mesh, dir, modelUp));
      mesh.add(anchor);
    } else {
      anchor.position.copy(worldPointToModelLocal(model, world));
      model.add(anchor);
    }

    anchor.quaternion.setFromUnitVectors(Y_AXIS, dirLocal);

    const plume = createAfterburnerAssembly();
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

/** Bay doors + missiles (aft fuselage); kept out of gear so doors open with weapons. */
const WEAPONS_NODE =
  /^Cube\.(016|043|044|050|051|052|055|056|058|059|060|061|062|064|068|069)(?:_|$)/;
const WEAPONS_EMPTY =
  /^Empty\.(004|005|007|008|009|010|011|012)(?:_|$)/;
/** Landing gear wells, struts, and main gear doors only. */
const GEAR_NODE =
  /^Cube\.(048|049)(?:_|$)|^Cylinder\.(013|018)(?:_|$)|^Empty\.003(?:_|$)/;

/** Classify animated nodes so gear and weapons can use separate mixers. */
function classifyAnimatedNode(model, nodeName) {
  if (WEAPONS_NODE.test(nodeName) || WEAPONS_EMPTY.test(nodeName)) {
    return 'weapons';
  }
  if (GEAR_NODE.test(nodeName)) return 'gear';

  const node = model.getObjectByName(nodeName);
  if (!node) return null;

  let rocket = false;
  let tyre = false;
  node.traverse((child) => {
    if (!child.isMesh) return;
    const label = materialLabel(child.material);
    if (/rocket/i.test(label)) rocket = true;
    if (/tyre/i.test(label)) tyre = true;
  });
  if (tyre) return 'gear';
  if (rocket) return 'weapons';

  return null;
}

function extractSubclip(fullClip, model, kind) {
  const tracks = fullClip.tracks.filter(
    (track) => classifyAnimatedNode(model, trackNodeName(track)) === kind
  );
  if (!tracks.length) return null;
  return new THREE.AnimationClip(`${fullClip.name}_${kind}`, fullClip.duration, tracks);
}

function measureTyreSpread(model, center) {
  const tmp = new THREE.Vector3();
  let sum = 0;
  let count = 0;
  model.traverse((child) => {
    if (!child.isMesh) return;
    if (!/tyre/i.test(materialLabel(child.material))) return;
    child.getWorldPosition(tmp);
    sum += tmp.distanceTo(center);
    count++;
  });
  return count ? sum / count : 0;
}

function measureBayOpenness(model) {
  let sum = 0;
  model.traverse((obj) => {
    const name = obj.name || '';
    if (!WEAPONS_NODE.test(name) && !WEAPONS_EMPTY.test(name)) return;
    sum +=
      Math.abs(obj.rotation.x) +
      Math.abs(obj.rotation.y) +
      Math.abs(obj.rotation.z);
  });
  return sum;
}

function measureRocketExposure(model) {
  let sum = 0;
  let count = 0;
  model.traverse((child) => {
    if (!child.isMesh) return;
    if (!/rocket/i.test(materialLabel(child.material))) return;
    const size = new THREE.Box3().setFromObject(child).getSize(new THREE.Vector3());
    sum += size.length();
    count++;
  });
  return count ? sum / count : 0;
}

function measureWeaponsDeployment(model, center) {
  return measureBayOpenness(model) + measureRocketExposure(model) * 2;
}

function sampleClipAt(mixer, action, time, probe, model, center) {
  action.time = time;
  mixer.update(1 / 60);
  return probe === 'gear'
    ? measureTyreSpread(model, center)
    : measureWeaponsDeployment(model, center);
}

function createSubclipController(gltf, model, kind, bodyCenter) {
  if (!gltf.animations?.length) return null;

  const subclip = extractSubclip(gltf.animations[0], model, kind);
  if (!subclip) return null;

  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(subclip);
  action.clampWhenFinished = true;
  action.setLoop(THREE.LoopOnce, 1);
  action.play();
  action.paused = true;
  action.setEffectiveWeight(1);

  const center =
    bodyCenter || new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());

  const atStart = sampleClipAt(mixer, action, 0, kind, model, center);
  const atEnd = sampleClipAt(mixer, action, subclip.duration, kind, model, center);

  let tStowed = 0;
  let tDeployed = subclip.duration;

  if (kind === 'gear') {
    tStowed = 0;
    tDeployed = subclip.duration;
  } else if (kind === 'weapons') {
    // t=0 = bays closed / stowed; end = doors open + missiles out.
    if (atEnd >= atStart) {
      tStowed = 0;
      tDeployed = subclip.duration;
    } else {
      tStowed = subclip.duration;
      tDeployed = 0;
    }
  } else if (atStart > atEnd) {
    tStowed = subclip.duration;
    tDeployed = 0;
  }

  let current = tStowed;
  let target = tStowed;
  let isDeployed = false;

  action.time = tStowed;
  mixer.update(1 / 60);

  return {
    mixer,
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
    update(dt) {
      if (Math.abs(current - target) < 0.002) {
        current = target;
      } else {
        const speed = subclip.duration / 2.5;
        current += Math.sign(target - current) * speed * dt;
        current = THREE.MathUtils.clamp(
          current,
          Math.min(tStowed, tDeployed),
          Math.max(tStowed, tDeployed)
        );
      }
      action.time = current;
      action.paused = true;
      mixer.update(Math.max(dt, 1 / 120));
    },
  };
}

export function createGearController(gltf, model, bodyCenter) {
  return createSubclipController(gltf, model, 'gear', bodyCenter);
}

export function createWeaponsController(gltf, model, bodyCenter) {
  return createSubclipController(gltf, model, 'weapons', bodyCenter);
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
