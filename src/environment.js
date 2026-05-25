import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { createWeatherController } from './weather.js';

const HDR_URL = `${import.meta.env.BASE_URL}hdri/sky.hdr`;

export async function loadPhotoEnvironment(renderer, scene, onProgress) {
  const loader = new RGBELoader();
  const hdr = await new Promise((resolve, reject) => {
    loader.load(
      HDR_URL,
      resolve,
      (xhr) => {
        if (onProgress && xhr.lengthComputable && xhr.total) {
          onProgress(xhr.loaded / xhr.total);
        }
      },
      reject
    );
  });
  hdr.mapping = THREE.EquirectangularReflectionMapping;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envMap = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose();
  pmrem.dispose();

  scene.environment = envMap;
  scene.background = envMap;
  scene.backgroundBlurriness = 0.08;
  scene.backgroundIntensity = 1.05;
  scene.environmentIntensity = 1.35;

  const sunDir = new THREE.Vector3(0.55, 0.42, -0.72).normalize();

  const fog = new THREE.FogExp2(0x9bb8d4, 0.012);
  scene.fog = fog;

  const cloudSea = createCloudSea();
  scene.add(cloudSea);

  const sun = new THREE.DirectionalLight(0xfff8ee, 2.8);
  sun.position.copy(sunDir).multiplyScalar(40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.02;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  const s = 14;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x88b8ff, 0.55);
  fill.position.set(-12, 6, 8);
  scene.add(fill);

  const hemi = new THREE.HemisphereLight(0xc8e4ff, 0x8aa090, 0.45);
  scene.add(hemi);

  const weather = createWeatherController(scene, {
    renderer,
    sun,
    fill,
    hemi,
    fog,
    cloudSea,
    baseEnvMap: envMap,
  });

  return { envMap, sun, fill, cloudSea, sunDir, hemi, fog, weather };
}

function createCloudSea() {
  const group = new THREE.Group();
  group.position.y = -8;

  const puffMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
    roughness: 1,
    metalness: 0,
    depthWrite: true,
  });

  const geo = new THREE.SphereGeometry(1, 10, 8);
  const rng = (a, b) => a + Math.random() * (b - a);

  for (let i = 0; i < 120; i++) {
    const puff = new THREE.Mesh(geo, puffMat);
    const angle = rng(0, Math.PI * 2);
    const radius = rng(8, 55);
    puff.position.set(
      Math.cos(angle) * radius,
      rng(-1.5, 2.5),
      Math.sin(angle) * radius
    );
    puff.scale.set(rng(2, 7), rng(1.2, 3.5), rng(2, 6));
    group.add(puff);
  }

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0xe8f2fa,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.35,
  });
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), deckMat);
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = -0.5;
  group.add(deck);

  group.userData.puffMaterial = puffMat;
  group.userData.deckMaterial = deckMat;
  group.userData.wind = 0.004;

  return group;
}
