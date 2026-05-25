import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRaptor, createAfterburnerGlow } from './jet.js';
import {
  createAircraftAnimRig,
  createProceduralWeaponsController,
  attachAfterburnerToThrusters,
  resolveJetAxes,
} from './aircraftSystems.js';
import { tagMeshHotspots, buildHotspotCatalog, buildProximityZones } from './hotspots.js';

const MODEL_URL = `${import.meta.env.BASE_URL}f22_raptor/scene.gltf`;

const LIVERIES = {
  stealth: { tint: 0xffffff, metal: 1, rough: 1, env: 1.35 },
  arctic: { tint: 0xd8e8f4, metal: 0.85, rough: 1.1, env: 1.2 },
  aggressor: { tint: 0x88a8c8, metal: 1.05, rough: 0.95, env: 1.3 },
};

export function loadJetModel(envMap, onProgress) {
  return new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        const model = gltf.scene;
        const materials = enhanceMaterials(model, envMap);

        centerAndScale(model);
        orientForDisplay(model);

        model.updateMatrixWorld(true);

        const axes = resolveJetAxes(model);
        model.userData.axes = axes;

        const animRig = createAircraftAnimRig(gltf, model, axes.bodyCenter);
        const gear = animRig?.gear ?? null;
        const weapons = animRig?.weapons ?? null;
        const afterburner = attachAfterburnerToThrusters(model, axes);
        const ports = model.userData.enginePorts || [];
        const exhaustDir = model.userData.exhaustDir;

        model.userData.isGltf = true;
        model.userData.materials = materials;
        model.userData.hotspotCatalog = tagMeshHotspots(model);
        model.userData.proximityZones = buildProximityZones(axes);
        model.userData.livery = 'stealth';
        model.userData.animRig = animRig;
        model.userData.gear = gear;
        model.userData.weapons = weapons;

        resolve({
          model,
          afterburner,
          isGltf: true,
          animRig,
          gear,
          weapons,
          enginePorts: ports,
          exhaustDir,
        });
      },
      (xhr) => {
        if (onProgress && xhr.lengthComputable && xhr.total) {
          onProgress(xhr.loaded / xhr.total);
        }
      },
      () => {
        const model = createRaptor('stealth', envMap);
        const afterburner = createAfterburnerGlow();
        model.add(afterburner);
        model.userData.afterburner = afterburner;
        centerAndScale(model);
        const weapons = createProceduralWeaponsController(model);
        model.userData.weapons = weapons;
        const box = new THREE.Box3().setFromObject(model);
        resolve({
          model,
          afterburner,
          isGltf: false,
          gear: null,
          weapons,
          enginePorts: [
            new THREE.Vector3(box.min.x, 0, 0.38),
            new THREE.Vector3(box.min.x, 0, -0.38),
          ],
          exhaustDir: new THREE.Vector3(-1, 0, 0),
        });
      }
    );
  });
}

/** Windscreen: tinted and opaque so empty cockpit geometry does not show through. */
function tuneCanopyGlass(mat) {
  mat.transmission = 0;
  mat.thickness = 0;
  mat.transparent = false;
  mat.opacity = 1;
  mat.depthWrite = true;
  mat.side = THREE.FrontSide;
  mat.metalness = 0.15;
  mat.roughness = 0.12;
  mat.color.setRGB(0.06, 0.1, 0.14);
  if (mat.specularColor) mat.specularColor.setRGB(0.35, 0.42, 0.5);
  mat.envMapIntensity = 1.1;
  mat.clearcoat = 0.85;
  mat.clearcoatRoughness = 0.08;
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

      if (/^glass$/i.test(physical.name || m.name || '')) {
        tuneCanopyGlass(physical);
      }

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
  model.rotation.set(0, 0, 0);
}

