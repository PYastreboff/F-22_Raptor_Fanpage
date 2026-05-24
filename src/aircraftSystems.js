import * as THREE from 'three';
import { createFlameMesh } from './jet.js';

const CAMERA_FORWARD = new THREE.Vector3(0, 0, 1);

const EXHAUST_MATERIAL = /^Material\.(009|010|011|012|005)$/;
const NOZZLE_MESH = /^Object_(5|9|10|55|0)$/;

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

function exhaustMaterialPriority(matName) {
  if (/Material\.010|Material\.011/.test(matName)) return 4;
  if (/Material\.009/.test(matName)) return 3;
  if (/Material\.005/.test(matName)) return 2;
  if (/Material\.012/.test(matName)) return 1;
  return 0;
}

function isThrusterMesh(mesh) {
  if (NOZZLE_MESH.test(mesh.name || '')) return true;
  return EXHAUST_MATERIAL.test(materialLabel(mesh.material));
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

/** Pick the two rear nozzle meshes (one per engine). */
export function findThrusterNozzles(model, axes) {
  const { bodyCenter, forward, exhaustDir, lateral } = axes;
  const tailGate = axes.alongMin + axes.alongSpan * 0.38;

  const candidates = [];

  model.traverse((child) => {
    if (!child.isMesh || !isThrusterMesh(child)) return;

    child.updateWorldMatrix(true, false);
    const worldCenter = new THREE.Box3().setFromObject(child).getCenter(new THREE.Vector3());
    const along = axialOffset(worldCenter, bodyCenter, forward);

    if (along > tailGate) return;

    const mat = materialLabel(child.material);
    const priority = exhaustMaterialPriority(mat) + (NOZZLE_MESH.test(child.name) ? 0.5 : 0);

    candidates.push({ mesh: child, along, lateral: worldCenter[lateral], priority });
  });

  if (!candidates.length) return { nozzles: [], ports: [], exhaustDir };

  const sorted = [...candidates].sort((a, b) => a.lateral - b.lateral);
  const mid =
    sorted.length > 1
      ? (sorted[0].lateral + sorted[sorted.length - 1].lateral) * 0.5
      : bodyCenter[lateral];

  const banks = [[], []];
  for (const c of candidates) {
    banks[c.lateral >= mid ? 0 : 1].push(c);
  }

  const pickBest = (list) =>
    [...list].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.along - b.along;
    })[0];

  const nozzles = [];
  for (const bank of banks) {
    const best = pickBest(bank);
    if (best) nozzles.push(best.mesh);
  }

  if (nozzles.length < 2 && candidates.length >= 2) {
    const left = pickBest(candidates.filter((c) => c.lateral <= mid));
    const right = pickBest(candidates.filter((c) => c.lateral > mid));
    const pair = [];
    if (left) pair.push(left.mesh);
    if (right && right.mesh !== left?.mesh) pair.push(right.mesh);

    if (pair.length < 2) {
      let bestI = 0;
      let bestJ = 1;
      let maxSep = 0;
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const sep = Math.abs(candidates[i].lateral - candidates[j].lateral);
          if (sep > maxSep) {
            maxSep = sep;
            bestI = i;
            bestJ = j;
          }
        }
      }
      const a = candidates[bestI];
      const b = candidates[bestJ];
      if (a && b && a.mesh !== b.mesh) {
        pair.length = 0;
        pair.push(a.mesh, b.mesh);
      }
    }

    if (pair.length >= 2) {
      nozzles.length = 0;
      nozzles.push(...pair);
    }
  }

  const ports = nozzles.map((mesh) => getNozzleExitWorld(mesh, exhaustDir));

  return { nozzles, ports, exhaustDir };
}

function getNozzleExitLocal(mesh, worldExhaustDir) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;

  const inv = mesh.matrixWorld.clone().invert();
  const localExhaust = worldExhaustDir.clone().transformDirection(inv).normalize();

  let exit = box.getCenter(new THREE.Vector3());
  let minProj = Infinity;
  for (const corner of boxCorners(box)) {
    const proj = localExhaust.dot(corner);
    if (proj < minProj) {
      minProj = proj;
      exit = corner.clone();
    }
  }

  exit.add(localExhaust.clone().multiplyScalar(0.06));
  return exit;
}

export function getNozzleExitWorld(mesh, worldExhaustDir) {
  mesh.updateWorldMatrix(true, false);
  const local = getNozzleExitLocal(mesh, worldExhaustDir);
  return mesh.localToWorld(local);
}

export function attachAfterburnerToThrusters(model, axes) {
  const { nozzles, ports, exhaustDir } = findThrusterNozzles(model, axes);
  const dir = exhaustDir.clone().normalize();

  const group = new THREE.Group();
  const flames = [];

  for (const nozzleMesh of nozzles) {
    nozzleMesh.updateWorldMatrix(true, false);

    const anchor = new THREE.Object3D();
    const exitLocal = getNozzleExitLocal(nozzleMesh, dir);
    anchor.position.copy(exitLocal);

    const tipWorld = getNozzleExitWorld(nozzleMesh, dir).add(dir.clone().multiplyScalar(0.45));
    anchor.lookAt(tipWorld);

    const flame = createFlameMesh();
    // Cone default is +Y; +π/2 X maps +Y → +Z so flame extends along anchor +Z (lookAt target).
    flame.rotation.x = Math.PI / 2;
    flame.position.y = 0.02;
    anchor.add(flame);

    nozzleMesh.add(anchor);
    flames.push(flame);
  }

  group.userData.flames = flames;
  model.userData.nozzleMeshes = nozzles;
  model.add(group);
  model.userData.afterburner = group;
  model.userData.exhaustDir = dir;
  model.userData.enginePorts = ports;

  return group;
}

export function findExhaustPorts(model) {
  const axes = resolveJetAxes(model);
  const { ports, exhaustDir } = findThrusterNozzles(model, axes);
  return { ports, exhaustDir, forward: axes.forward, axes };
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

function sampleGearAt(model, center, mixer, action, time) {
  action.time = time;
  mixer.update(1 / 60);
  return measureTyreSpread(model, center);
}

export function createGearController(gltf, model, bodyCenter) {
  if (!gltf.animations?.length) return null;

  const clip = gltf.animations[0];
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.play();
  action.paused = true;
  action.setEffectiveWeight(1);

  const center =
    bodyCenter || new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());

  const ext0 = sampleGearAt(model, center, mixer, action, 0);
  const ext1 = sampleGearAt(model, center, mixer, action, clip.duration);

  let tUp = 0;
  let tDown = clip.duration;
  if (ext0 > ext1) {
    tUp = clip.duration;
    tDown = 0;
  }

  let current = tUp;
  let target = tUp;
  let isDown = false;

  action.time = tUp;
  mixer.update(1 / 60);

  return {
    mixer,
    isDown,
    setGearDown(down) {
      isDown = down;
      target = down ? tDown : tUp;
    },
    toggle() {
      this.setGearDown(!isDown);
      return isDown;
    },
    update(dt) {
      if (Math.abs(current - target) < 0.002) {
        current = target;
      } else {
        const speed = clip.duration / 2.5;
        current += Math.sign(target - current) * speed * dt;
        current = THREE.MathUtils.clamp(
          current,
          Math.min(tUp, tDown),
          Math.max(tUp, tDown)
        );
      }
      action.time = current;
      action.paused = true;
      mixer.update(Math.max(dt, 1 / 120));
    },
  };
}
