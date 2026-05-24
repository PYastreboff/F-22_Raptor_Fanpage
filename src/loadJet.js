import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRaptor, createAfterburnerGlow } from './jet.js';

const MODEL_URL = `${import.meta.env.BASE_URL}f22_raptor/scene.gltf`;

const LIVERIES = {
  stealth: { tint: 0xffffff, metal: 1, rough: 1, env: 1.35 },
  arctic: { tint: 0xd8e8f4, metal: 0.85, rough: 1.1, env: 1.2 },
  aggressor: { tint: 0x88a8c8, metal: 1.05, rough: 0.95, env: 1.3 },
};

export function loadJetModel(envMap) {
  return new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        const model = gltf.scene;
        const materials = enhanceMaterials(model, envMap);
        setFlightPose(gltf, model);

        centerAndScale(model);
        orientForDisplay(model);

        model.updateMatrixWorld(true);
        attachAfterburner(model);

        model.userData.isGltf = true;
        model.userData.materials = materials;
        model.userData.hotspots = buildGltfHotspots();
        model.userData.livery = 'stealth';

        resolve({
          model,
          afterburner: model.userData.afterburner,
          isGltf: true,
        });
      },
      undefined,
      () => {
        const model = createRaptor('stealth', envMap);
        const afterburner = createAfterburnerGlow();
        model.add(afterburner);
        model.userData.afterburner = afterburner;
        centerAndScale(model);
        resolve({ model, afterburner, isGltf: false });
      }
    );
  });
}

function enhanceMaterials(root, envMap) {
  const saved = [];

  root.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = true;

    const mats = Array.isArray(child.material) ? child.material : [child.material];
    const upgraded = mats.map((m) => {
      if (!m) return m;

      const physical =
        m.isMeshPhysicalMaterial || m.isMeshStandardMaterial
          ? m
          : new THREE.MeshPhysicalMaterial().copy(m);

      if (physical.map) {
        physical.map.colorSpace = THREE.SRGBColorSpace;
        physical.map.anisotropy = 8;
      }
      if (physical.emissiveMap) physical.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      if (physical.normalMap) physical.normalMap.colorSpace = THREE.NoColorSpace;

      physical.envMap = envMap;
      physical.envMapIntensity = 1.35;
      physical.needsUpdate = true;

      saved.push({
        mat: physical,
        baseColor: physical.color.clone(),
        metalness: physical.metalness,
        roughness: physical.roughness,
        envIntensity: physical.envMapIntensity,
      });

      return physical;
    });

    child.material = upgraded.length === 1 ? upgraded[0] : upgraded;
  });

  return saved;
}

export function applyGltfLivery(materialRefs, schemeName, envMap) {
  const scheme = LIVERIES[schemeName] || LIVERIES.stealth;
  const tint = new THREE.Color(scheme.tint);

  for (const ref of materialRefs) {
    ref.mat.color.copy(ref.baseColor).multiply(tint);
    ref.mat.metalness = THREE.MathUtils.clamp(ref.metalness * scheme.metal, 0, 1);
    ref.mat.roughness = THREE.MathUtils.clamp(ref.roughness * scheme.rough, 0.04, 1);
    ref.mat.envMap = envMap;
    ref.mat.envMapIntensity = ref.envIntensity * scheme.env;
    ref.mat.needsUpdate = true;
  }
}

function setFlightPose(gltf, model) {
  if (!gltf.animations?.length) return;

  const mixer = new THREE.AnimationMixer(model);
  const clip = gltf.animations[gltf.animations.length - 1];
  const action = mixer.clipAction(clip);
  action.play();
  action.paused = true;
  action.time = clip.duration * 0.85;
  mixer.update(0);

  model.userData.mixer = mixer;
}

function centerAndScale(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 6.8 / maxDim;
  model.scale.setScalar(scale);
}

function orientForDisplay(model) {
  // Same orientation as the reference GLTF viewer — nose toward camera on +Z
  model.rotation.set(0, 0, 0);
}

function attachAfterburner(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const afterburner = createAfterburnerGlow();
  const spread = size.z * 0.09;
  const tailX = box.min.x - 0.08;
  afterburner.userData.flames[0].position.set(tailX, 0, spread);
  afterburner.userData.flames[1].position.set(tailX, 0, -spread);
  model.add(afterburner);
  model.userData.afterburner = afterburner;
}

function buildGltfHotspots() {
  return [
    {
      name: 'cockpit',
      label: 'AN/APG-77 AESA RADAR & COCKPIT',
      detail:
        'Helmet-mounted cueing, sensor fusion, and first-look / first-kill situational awareness.',
      position: new THREE.Vector3(2.2, 0.35, 0),
      meshNames: [],
    },
    {
      name: 'wing',
      label: 'LOW-OBSERVABLE PLANFORM',
      detail:
        'Trapezoidal wings and aligned edges reduce radar cross-section while preserving agility.',
      position: new THREE.Vector3(0.2, 0, 2.4),
      meshNames: [],
    },
    {
      name: 'engine',
      label: 'F119-PW-100 THRUST VECTORING',
      detail:
        'Two-dimensional nozzle vectoring enables supermaneuverability beyond conventional fighters.',
      position: new THREE.Vector3(-2.8, 0, 0.55),
      meshNames: [],
    },
    {
      name: 'fuselage',
      label: 'INTERNAL WEAPONS BAY',
      detail:
        'Carries AIM-120 and AIM-9 internally to maintain stealth profile until engagement.',
      position: new THREE.Vector3(0, 0, 0),
      meshNames: [],
    },
    {
      name: 'tail',
      label: 'CANTED VERTICAL STABILIZERS',
      detail:
        'Angled tails deflect radar returns and support extreme angle-of-attack control.',
      position: new THREE.Vector3(-2.4, 0.65, 0.9),
      meshNames: [],
    },
  ];
}
