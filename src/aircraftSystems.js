import * as THREE from 'three';
import { createFlameMesh } from './jet.js';

function averageTyreHeight(model, mixer, action, time) {
  action.time = time;
  mixer.update(0);
  const tmp = new THREE.Vector3();
  let sum = 0;
  let n = 0;
  model.traverse((child) => {
    if (!child.isMesh) return;
    if (!materialLabel(child.material).toLowerCase().includes('tyre')) return;
    child.getWorldPosition(tmp);
    sum += tmp.y;
    n++;
  });
  return n ? sum / n : 0;
}

/** Landing gear animation with retracted default (in flight). */
export function createGearController(gltf, model) {
  if (!gltf.animations?.length) return null;

  const clip =
    gltf.animations.find((a) => /gear|landing/i.test(a.name)) ||
    gltf.animations[0];
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.play();
  action.paused = true;

  let tUp = 0;
  let tDown = clip.duration;
  const tyreY0 = averageTyreHeight(model, mixer, action, 0);
  const tyreY1 = averageTyreHeight(model, mixer, action, clip.duration);
  if (tyreY0 < tyreY1) {
    tUp = clip.duration;
    tDown = 0;
  }

  let current = tUp;
  let target = tUp;
  let isDown = false;

  action.time = tUp;
  mixer.update(0);

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
        current = THREE.MathUtils.clamp(current, tUp, tDown);
      }
      action.time = current;
      action.paused = true;
      mixer.update(0);
    },
  };
}

/** Fuselage axis from Gray_nose material; twin exhaust ports at rear. */
export function findExhaustPorts(model) {
  model.updateMatrixWorld(true);

  const nosePoint = new THREE.Vector3();
  let noseCount = 0;
  const rearCandidates = [];

  model.traverse((child) => {
    if (!child.isMesh) return;
    const box = new THREE.Box3().setFromObject(child);
    const center = box.getCenter(new THREE.Vector3());
    const matName = materialLabel(child.material).toLowerCase();

    if (matName.includes('nose') || matName.includes('gray_nose')) {
      nosePoint.add(center);
      noseCount++;
    }

    if (
      matName.includes('black') ||
      matName.includes('material.005') ||
      matName.includes('material.009') ||
      matName.includes('material.010')
    ) {
      const size = box.getSize(new THREE.Vector3());
      const vol = size.x * size.y * size.z;
      if (vol < 0.0001 || vol > 2) return;
      rearCandidates.push({ center, box, vol });
    }
  });

  const bodyBox = new THREE.Box3().setFromObject(model);
  const bodySize = bodyBox.getSize(new THREE.Vector3());
  const bodyCenter = bodyBox.getCenter(new THREE.Vector3());

  let forward = new THREE.Vector3(0, 0, 1);
  if (noseCount > 0) {
    nosePoint.divideScalar(noseCount);
    forward.subVectors(nosePoint, bodyCenter).normalize();
  } else {
    const axis =
      bodySize.x >= bodySize.y && bodySize.x >= bodySize.z
        ? 'x'
        : bodySize.y >= bodySize.z
          ? 'y'
          : 'z';
    forward.set(
      axis === 'x' ? 1 : 0,
      axis === 'y' ? 1 : 0,
      axis === 'z' ? 1 : 0
    );
  }

  const exhaustDir = forward.clone().negate();

  const tailPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
    forward,
    bodyCenter
  );
  const tailDepth = bodySize.length() * 0.2;

  const rear = rearCandidates.filter(({ center }) => {
    const dist = Math.abs(tailPlane.distanceToPoint(center));
    return dist < tailDepth;
  });

  let ports = clusterExhaustPorts(rear, bodyCenter, forward);

  if (ports.length < 2) {
    ports = fallbackPorts(bodyBox, bodyCenter, forward, exhaustDir);
  }

  return { ports, exhaustDir, forward };
}

function materialLabel(material) {
  if (!material) return '';
  if (Array.isArray(material)) {
    return material.map((m) => m?.name || '').join(' ');
  }
  return material.name || '';
}

function clusterExhaustPorts(rear, bodyCenter, forward) {
  if (!rear.length) return [];

  const lateral = pickLateralAxis(forward);
  const sorted = [...rear].sort((a, b) => a.center[lateral] - b.center[lateral]);
  const mid = bodyCenter[lateral];
  const left = sorted.filter((r) => r.center[lateral] > mid + 0.02);
  const right = sorted.filter((r) => r.center[lateral] < mid - 0.02);

  const pick = (group) => {
    if (!group.length) return null;
    return group.reduce((best, r) => {
      const depth = forward.dot(r.center.clone().sub(bodyCenter));
      const bestDepth = forward.dot(best.center.clone().sub(bodyCenter));
      return depth < bestDepth ? r : best;
    }, group[0]);
  };

  const a = pick(left);
  const b = pick(right);
  const out = [];
  if (a) out.push(a.center);
  if (b) out.push(b.center);
  return out;
}

function pickLateralAxis(forward) {
  const ax = Math.abs(forward.x);
  const ay = Math.abs(forward.y);
  const az = Math.abs(forward.z);
  if (ay > ax && ay > az) return 'z';
  if (az > ax && az > ay) return 'x';
  return 'z';
}

function fallbackPorts(bodyBox, bodyCenter, forward, exhaustDir) {
  const lateral = pickLateralAxis(forward);
  const span = Math.max(
    bodyBox.max.x - bodyBox.min.x,
    bodyBox.max.y - bodyBox.min.y,
    bodyBox.max.z - bodyBox.min.z
  );
  const tail = bodyCenter.clone().add(exhaustDir.clone().multiplyScalar(span * 0.42));
  const spread =
    (lateral === 'z' ? bodyBox.max.z - bodyBox.min.z : bodyBox.max.x - bodyBox.min.x) *
    0.11;

  const p1 = tail.clone();
  const p2 = tail.clone();
  p1[lateral] += spread;
  p2[lateral] -= spread;
  return [p1, p2];
}

export function attachAfterburnerToPorts(model, ports, exhaustDir) {
  const group = new THREE.Group();
  const flames = [];
  const dir = exhaustDir.clone().normalize();

  ports.slice(0, 2).forEach((pos) => {
    const flame = createFlameMesh();
    const anchor = new THREE.Object3D();
    anchor.position.copy(pos);
    const tip = pos.clone().add(dir);
    anchor.lookAt(tip);
    flame.rotation.x = -Math.PI / 2;
    anchor.add(flame);
    group.add(anchor);
    flames.push(flame);
  });

  group.userData.flames = flames;
  model.add(group);
  model.userData.afterburner = group;
  model.userData.exhaustDir = dir;
  model.userData.enginePorts = ports;

  return group;
}
