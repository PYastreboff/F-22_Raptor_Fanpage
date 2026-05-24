import * as THREE from 'three';

export const WEATHER_PRESETS = {
  clear: {
    label: 'Clear',
    fogColor: 0x9bb8d4,
    fogDensity: 0.01,
    bgIntensity: 1.08,
    envIntensity: 1.38,
    exposure: 1.08,
    sunColor: 0xfff8ee,
    sun: 2.85,
    fillColor: 0x88b8ff,
    fill: 0.55,
    hemiSky: 0xc8e4ff,
    hemiGround: 0x8aa090,
    hemi: 0.48,
    cloudOpacity: 0.32,
    cloudDeck: 0.28,
    rain: 0,
    rainSpeed: 0,
    wind: 0.004,
    bgTint: 0xffffff,
    bgTintStrength: 0,
  },
  cloudy: {
    label: 'Cloudy',
    fogColor: 0x8aa8bc,
    fogDensity: 0.018,
    bgIntensity: 0.92,
    envIntensity: 1.15,
    exposure: 0.98,
    sunColor: 0xfff0e0,
    sun: 2.1,
    fillColor: 0x9aaccc,
    fill: 0.65,
    hemiSky: 0xb0c8e0,
    hemiGround: 0x7a9088,
    hemi: 0.55,
    cloudOpacity: 0.72,
    cloudDeck: 0.55,
    rain: 0,
    rainSpeed: 0,
    wind: 0.008,
    bgTint: 0xc8d8e8,
    bgTintStrength: 0.25,
  },
  overcast: {
    label: 'Overcast',
    fogColor: 0x7a8894,
    fogDensity: 0.028,
    bgIntensity: 0.72,
    envIntensity: 0.9,
    exposure: 0.88,
    sunColor: 0xe8eef4,
    sun: 1.35,
    fillColor: 0xa8b4c4,
    fill: 0.75,
    hemiSky: 0x98a8b8,
    hemiGround: 0x6a7478,
    hemi: 0.62,
    cloudOpacity: 0.9,
    cloudDeck: 0.75,
    rain: 0,
    rainSpeed: 0,
    wind: 0.006,
    bgTint: 0x8898a8,
    bgTintStrength: 0.45,
  },
  rain: {
    label: 'Rain',
    fogColor: 0x5a6878,
    fogDensity: 0.038,
    bgIntensity: 0.58,
    envIntensity: 0.75,
    exposure: 0.82,
    sunColor: 0xd0dce8,
    sun: 0.95,
    fillColor: 0x8898b0,
    fill: 0.7,
    hemiSky: 0x788898,
    hemiGround: 0x505860,
    hemi: 0.68,
    cloudOpacity: 0.95,
    cloudDeck: 0.82,
    rain: 1,
    rainSpeed: 1,
    wind: 0.014,
    bgTint: 0x606c78,
    bgTintStrength: 0.55,
  },
  storm: {
    label: 'Storm',
    fogColor: 0x3a4550,
    fogDensity: 0.052,
    bgIntensity: 0.42,
    envIntensity: 0.55,
    exposure: 0.72,
    sunColor: 0xb8c8d8,
    sun: 0.55,
    fillColor: 0x6a7a90,
    fill: 0.85,
    hemiSky: 0x4a5560,
    hemiGround: 0x303840,
    hemi: 0.75,
    cloudOpacity: 1,
    cloudDeck: 0.9,
    rain: 1,
    rainSpeed: 1.8,
    wind: 0.022,
    bgTint: 0x384048,
    bgTintStrength: 0.65,
  },
  night: {
    label: 'Night',
    fogColor: 0x0a1428,
    fogDensity: 0.022,
    bgIntensity: 0.35,
    envIntensity: 0.45,
    exposure: 0.78,
    sunColor: 0xa8c8ff,
    sun: 0.35,
    fillColor: 0x4060a0,
    fill: 0.4,
    hemiSky: 0x1a2848,
    hemiGround: 0x080c14,
    hemi: 0.5,
    cloudOpacity: 0.2,
    cloudDeck: 0.12,
    rain: 0,
    rainSpeed: 0,
    wind: 0.003,
    bgTint: 0x0c1830,
    bgTintStrength: 0.7,
  },
};

const COLOR_KEYS = ['fogColor', 'sunColor', 'fillColor', 'hemiSky', 'hemiGround', 'bgTint'];

function lerpPreset(a, b, t) {
  const out = { label: b.label };
  for (const k of COLOR_KEYS) {
    out[k] = new THREE.Color(a[k]).lerp(new THREE.Color(b[k]), t).getHex();
  }
  for (const k of Object.keys(a)) {
    if (k === 'label' || COLOR_KEYS.includes(k)) continue;
    out[k] = a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

function createRainSystem() {
  const count = 3500;
  const positions = new Float32Array(count * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xa8c0d8,
    size: 0.06,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  const rain = new THREE.Points(geo, mat);
  rain.frustumCulled = false;
  rain.userData.velocities = new Float32Array(count);

  return rain;
}

function resetRainDrop(rain, i, spread = 45) {
  const positions = rain.geometry.attributes.position.array;
  positions[i * 3] = (Math.random() - 0.5) * spread;
  positions[i * 3 + 1] = Math.random() * 25 + 2;
  positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
  rain.userData.velocities[i] = 8 + Math.random() * 14;
}

export function createWeatherController(scene, refs) {
  const {
    renderer,
    sun,
    fill,
    hemi,
    fog,
    cloudSea,
    baseEnvMap,
  } = refs;

  const puffMat = cloudSea.userData.puffMaterial;
  const deckMat = cloudSea.userData.deckMaterial;

  const rain = createRainSystem();
  for (let i = 0; i < rain.geometry.attributes.position.count; i++) {
    resetRainDrop(rain, i);
  }
  scene.add(rain);

  const tintOverlay = new THREE.Mesh(
    new THREE.SphereGeometry(140, 32, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      depthWrite: false,
    })
  );
  scene.add(tintOverlay);

  let currentId = 'clear';
  let targetId = 'clear';
  let blend = 1;
  const blendSpeed = 1.8;
  let lightningFlash = 0;

  const state = { ...WEATHER_PRESETS.clear };

  function getBlendedTarget() {
    if (currentId === targetId && blend >= 1) {
      return WEATHER_PRESETS[targetId];
    }
    const from = WEATHER_PRESETS[currentId];
    const to = WEATHER_PRESETS[targetId];
    return lerpPreset(from, to, blend);
  }

  function applyPreset(p) {
    fog.color.setHex(p.fogColor);
    fog.density = p.fogDensity;

    scene.backgroundIntensity = p.bgIntensity;
    scene.environmentIntensity = p.envIntensity;
    renderer.toneMappingExposure = p.exposure;

    sun.color.setHex(p.sunColor);
    sun.intensity = p.sun * (1 + lightningFlash * 2.5);
    fill.color.setHex(p.fillColor);
    fill.intensity = p.fill;
    hemi.color.setHex(p.hemiSky);
    hemi.groundColor.setHex(p.hemiGround);
    hemi.intensity = p.hemi;

    puffMat.opacity = p.cloudOpacity;
    deckMat.opacity = p.cloudDeck;

    rain.material.opacity = p.rain * 0.55;
    rain.visible = p.rain > 0.05;

    tintOverlay.material.color.setHex(p.bgTint);
    tintOverlay.material.opacity = p.bgTintStrength;

    if (baseEnvMap) {
      scene.environment = baseEnvMap;
      scene.background = baseEnvMap;
    }
  }

  function setWeather(id) {
    if (!WEATHER_PRESETS[id] || id === targetId) return;
    if (blend < 1) currentId = targetId;
    targetId = id;
    blend = 0;
  }

  function update(dt) {
    if (blend < 1) {
      blend = Math.min(1, blend + dt * blendSpeed);
      if (blend >= 1) currentId = targetId;
    }

    const p = getBlendedTarget();
    applyPreset(p);

    if (p.rain > 0.05) {
      const positions = rain.geometry.attributes.position.array;
      const spread = 42 + p.rainSpeed * 8;
      const fall = (14 + p.rainSpeed * 10) * dt;
      const windX = p.wind * 120 * dt;
      const windZ = p.wind * 80 * dt;

      for (let i = 0; i < positions.length / 3; i++) {
        if (rain.userData.velocities[i] === 0) resetRainDrop(rain, i, spread);
        positions[i * 3] += windX;
        positions[i * 3 + 1] -= rain.userData.velocities[i] * fall * 0.35;
        positions[i * 3 + 2] += windZ;
        if (positions[i * 3 + 1] < -6) resetRainDrop(rain, i, spread);
      }
      rain.geometry.attributes.position.needsUpdate = true;
    }

    if (targetId === 'storm' && Math.random() < 0.008 * dt * 60) {
      lightningFlash = 1;
    }
    lightningFlash *= Math.exp(-dt * 6);

    cloudSea.userData.wind = p.wind;
  }

  applyPreset(WEATHER_PRESETS.clear);

  return { setWeather, update, rain, get current() { return targetId; } };
}
