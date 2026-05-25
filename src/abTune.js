import * as THREE from 'three';

export const AB_TUNE_STORAGE_KEY = 'f22-ab-tune';

/** @typedef {{ x: number, y: number, z: number }} Vec3Tune */
/** @typedef {{ position: Vec3Tune, rotation: Vec3Tune }} PlumeTune */
/** @typedef {{ separation: number, port: PlumeTune, starboard: PlumeTune }} AbTunePayload */

/** Baked-in defaults from in-app tune (May 2026). */
export const AB_TUNE_DEFAULTS = {
  separation: -0.25,
  port: {
    position: { x: 0.01, y: -0.25, z: -0.29 },
    rotation: { x: -6, y: -6, z: 0 },
  },
  starboard: {
    position: { x: 0.01, y: -0.25, z: -0.29 },
    rotation: { x: -6, y: -6, z: 0 },
  },
};

export function resolveAbTune(saved) {
  const base = {
    separation: AB_TUNE_DEFAULTS.separation,
    port: clonePlumeTune(AB_TUNE_DEFAULTS.port),
    starboard: clonePlumeTune(AB_TUNE_DEFAULTS.starboard),
  };
  if (!saved) return base;
  if (typeof saved.separation === 'number') base.separation = saved.separation;
  if (saved.port) base.port = clonePlumeTune(saved.port);
  if (saved.starboard) base.starboard = clonePlumeTune(saved.starboard);
  return base;
}

export function defaultPlumeTune(baseY = 0) {
  return {
    position: { x: 0, y: baseY, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

export function clonePlumeTune(tune) {
  return {
    position: { ...tune.position },
    rotation: { ...tune.rotation },
  };
}

/**
 * @param {import('three').Object3D} plume
 * @param {PlumeTune} tune
 * @param {{ side?: 'port' | 'starboard', separation?: number }} [opts]
 */
export function applyPlumeTune(plume, tune, opts = {}) {
  if (!plume || !tune) return;
  const { side, separation = 0 } = opts;
  plume.position.set(tune.position.x, tune.position.y, tune.position.z);
  if (separation && side && plume.userData.abSeparationDir) {
    const sign = side === 'port' ? -0.5 : 0.5;
    plume.position.addScaledVector(plume.userData.abSeparationDir, sign * separation);
  }
  plume.rotation.set(
    THREE.MathUtils.degToRad(tune.rotation.x),
    THREE.MathUtils.degToRad(tune.rotation.y),
    THREE.MathUtils.degToRad(tune.rotation.z)
  );
  plume.updateMatrix();
}

/** Unit vector in anchor space = aircraft lateral (wing-span). */
export function computeAnchorSeparationDir(anchor, model, lateralAxis) {
  _emitDir.set(0, 0, 0);
  _emitDir[lateralAxis] = 1;
  model.updateMatrixWorld(true);
  _emitDir.transformDirection(model.matrixWorld);
  anchor.updateWorldMatrix(true, false);
  anchor.getWorldQuaternion(_emitQuat);
  _emitDir.applyQuaternion(_emitQuat.invert()).normalize();
  return _emitDir.clone();
}

export function getAbSeparation(model) {
  return typeof model.userData.abSeparation === 'number'
    ? model.userData.abSeparation
    : 0;
}

export function setAbSeparation(model, value) {
  model.userData.abSeparation = value;
}

/** Re-apply stored per-plume tune + global separation. */
export function applyModelAbTunes(model) {
  const separation = getAbSeparation(model);
  const anchors = model.userData.exhaustAnchors || [];
  for (let i = 0; i < anchors.length; i++) {
    const plume = findPlumeOnAnchor(anchors[i]);
    if (!plume?.userData.abTune) continue;
    const side = plume.userData.abSide || (i === 0 ? 'port' : 'starboard');
    applyPlumeTune(plume, plume.userData.abTune, { side, separation });
  }
}

export function buildAbTunePayload(model) {
  const payload = { separation: getAbSeparation(model) };
  const anchors = model.userData.exhaustAnchors || [];
  for (let i = 0; i < anchors.length; i++) {
    const plume = findPlumeOnAnchor(anchors[i]);
    if (!plume) continue;
    const side = plume.userData.abSide || (i === 0 ? 'port' : 'starboard');
    payload[side] = plume.userData.abTune
      ? clonePlumeTune(plume.userData.abTune)
      : readPlumeTune(plume);
  }
  return payload;
}

export function readPlumeTune(plume) {
  const defaults = plume.userData.abTuneDefaults || defaultPlumeTune();
  return clonePlumeTune(plume.userData.abTune || defaults);
}

export function loadSavedAbTune() {
  try {
    const raw = localStorage.getItem(AB_TUNE_STORAGE_KEY);
    if (!raw) return resolveAbTune(null);
    return resolveAbTune(JSON.parse(raw));
  } catch {
    return resolveAbTune(null);
  }
}

export function saveAbTune(payload) {
  try {
    localStorage.setItem(AB_TUNE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

export function findPlumeOnAnchor(anchor) {
  return anchor.children.find((c) => c.userData?.flames?.length) || null;
}

const _emitPos = new THREE.Vector3();
const _emitDir = new THREE.Vector3();
const _emitQuat = new THREE.Quaternion();

/** World spawn point and exhaust direction (+Y of tuned plume). */
export function getPlumeWorldEmit(plume, outPos = _emitPos, outDir = _emitDir) {
  plume.updateWorldMatrix(true, false);
  plume.getWorldPosition(outPos);
  plume.getWorldQuaternion(_emitQuat);
  outDir.set(0, 1, 0).applyQuaternion(_emitQuat).normalize();
  return { position: outPos, direction: outDir };
}

/**
 * Per-engine exhaust emitters for particles (follows plume debug tune).
 * @param {import('three').Object3D} model
 * @returns {{ position: THREE.Vector3, direction: THREE.Vector3 }[]}
 */
/** Pitch nozzles up/down (thrust-vectoring demo). */
export function startThrustVectorDemo(model) {
  model.userData.thrustVectorDemo = {
    elapsed: 0,
    duration: 5.5,
    deflectDeg: 16,
  };
}

export function updateThrustVectorDemo(model, dt) {
  const demo = model.userData.thrustVectorDemo;
  if (!demo) return false;

  demo.elapsed += dt;
  if (demo.elapsed >= demo.duration) {
    delete model.userData.thrustVectorDemo;
    applyModelAbTunes(model);
    return false;
  }

  const t = demo.elapsed / demo.duration;
  const swing = Math.sin(t * Math.PI * 2) * demo.deflectDeg;
  const separation = getAbSeparation(model);
  const anchors = model.userData.exhaustAnchors || [];

  for (let i = 0; i < anchors.length; i++) {
    const plume = findPlumeOnAnchor(anchors[i]);
    if (!plume?.userData.abTune) continue;
    const side = plume.userData.abSide || (i === 0 ? 'port' : 'starboard');
    const tune = clonePlumeTune(plume.userData.abTune);
    tune.rotation.x += swing;
    applyPlumeTune(plume, tune, { side, separation });
  }

  return true;
}

export function collectExhaustEmits(model) {
  const anchors = model.userData.exhaustAnchors;
  if (!anchors?.length) return [];

  const emits = [];
  for (const anchor of anchors) {
    const plume = findPlumeOnAnchor(anchor);
    if (plume) {
      const pos = new THREE.Vector3();
      const dir = new THREE.Vector3();
      getPlumeWorldEmit(plume, pos, dir);
      emits.push({ position: pos, direction: dir });
      continue;
    }
    anchor.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    anchor.getWorldPosition(pos);
    const dir =
      model.userData.exhaustDir?.clone() || new THREE.Vector3(0, 0, -1);
    dir.transformDirection(model.matrixWorld).normalize();
    emits.push({ position: pos, direction: dir });
  }
  return emits;
}
