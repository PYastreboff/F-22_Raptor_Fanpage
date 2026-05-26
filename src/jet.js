import * as THREE from 'three';

const SCHEMES = {
  stealth: {
    body: 0x7a8894,
    accent: 0x5c6a74,
    canopy: 0x1e3a52,
    metalness: 0.55,
    roughness: 0.38,
  },
  arctic: {
    body: 0xe8f0f6,
    accent: 0xc0d0dc,
    canopy: 0x284860,
    metalness: 0.45,
    roughness: 0.42,
  },
  aggressor: {
    body: 0x3a6898,
    accent: 0x2a5078,
    canopy: 0x142838,
    metalness: 0.6,
    roughness: 0.32,
  },
};

function mat(color, scheme, opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: scheme.metalness,
    roughness: scheme.roughness,
    clearcoat: 0.35,
    clearcoatRoughness: 0.25,
    envMapIntensity: 1.2,
    ...opts,
  });
}

function addEdges(parent, color = 0x2a3540, threshold = 12) {
  parent.traverse((child) => {
    if (!child.isMesh || child.userData.skipEdges) return;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(child.geometry, threshold),
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.35,
      })
    );
    edges.userData.isEdge = true;
    child.add(edges);
  });
}

export function createRaptor(schemeName = 'stealth', envMap = null) {
  const scheme = SCHEMES[schemeName] || SCHEMES.stealth;
  const group = new THREE.Group();
  group.name = 'raptor';

  const bodyMat = mat(scheme.body, scheme);
  const accentMat = mat(scheme.accent, scheme);
  const darkMat = mat(0x2a3038, scheme, { metalness: 0.7, roughness: 0.35 });
  const canopyMat = mat(scheme.canopy, scheme, {
    metalness: 0.18,
    roughness: 0.1,
    transparent: false,
    opacity: 1,
    transmission: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
  });

  if (envMap) {
    bodyMat.envMap = accentMat.envMap = canopyMat.envMap = darkMat.envMap = envMap;
  }

  const fuselageProfile = [
    new THREE.Vector2(0.02, -2.85),
    new THREE.Vector2(0.12, -2.4),
    new THREE.Vector2(0.28, -1.6),
    new THREE.Vector2(0.34, -0.6),
    new THREE.Vector2(0.36, 0.2),
    new THREE.Vector2(0.34, 1.0),
    new THREE.Vector2(0.28, 1.8),
    new THREE.Vector2(0.18, 2.5),
    new THREE.Vector2(0.06, 2.95),
    new THREE.Vector2(0.02, 3.05),
  ];
  const fuselage = new THREE.Mesh(
    new THREE.LatheGeometry(fuselageProfile, 32),
    bodyMat
  );
  fuselage.rotation.x = Math.PI / 2;
  fuselage.rotation.z = Math.PI / 2;
  fuselage.name = 'fuselage';
  group.add(fuselage);

  const spine = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 0.12, 0.22),
    accentMat
  );
  spine.position.set(0.2, 0.2, 0);
  spine.name = 'fuselage';
  group.add(spine);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 1.1, 4, 1),
    bodyMat
  );
  nose.rotation.z = -Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.position.x = 3.05;
  nose.name = 'nose';
  group.add(nose);

  const wingShape = new THREE.Shape();
  wingShape.moveTo(-0.4, 0);
  wingShape.lineTo(0.8, 0.12);
  wingShape.lineTo(2.4, 0.35);
  wingShape.lineTo(2.65, 2.05);
  wingShape.lineTo(1.2, 2.35);
  wingShape.lineTo(-0.5, 0.35);
  wingShape.closePath();

  const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
    depth: 0.1,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.02,
    bevelSegments: 3,
  });
  wingGeo.rotateX(-Math.PI / 2);
  wingGeo.translate(0, 0.05, 0);

  const wing = new THREE.Mesh(wingGeo, bodyMat);
  wing.position.set(-0.15, -0.02, 0);
  wing.name = 'wing';
  group.add(wing);

  const wingLE = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 0.04, 0.06),
    darkMat
  );
  wingLE.rotation.z = -0.32;
  wingLE.position.set(1.0, 0.06, 1.05);
  wingLE.name = 'wing';
  group.add(wingLE);
  const wingLE2 = wingLE.clone();
  wingLE2.position.z = -1.05;
  wingLE2.rotation.z = 0.32;
  group.add(wingLE2);

  function cantedTail(side) {
    const tailGroup = new THREE.Group();
    const stabShape = new THREE.Shape();
    stabShape.moveTo(0, 0);
    stabShape.lineTo(0.75, 0.15);
    stabShape.lineTo(0.85, 0.95);
    stabShape.lineTo(0.15, 0.75);
    stabShape.lineTo(-0.1, 0.2);
    stabShape.closePath();
    const stabGeo = new THREE.ExtrudeGeometry(stabShape, {
      depth: 0.07,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.01,
      bevelSegments: 1,
    });
    stabGeo.rotateX(-Math.PI / 2);

    const stab = new THREE.Mesh(stabGeo, accentMat);
    stab.name = 'tail';
    tailGroup.add(stab);

    const root = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.08, 0.35),
      accentMat
    );
    root.position.set(-0.15, 0, 0);
    root.name = 'tail';
    tailGroup.add(root);

    tailGroup.position.set(-2.35, 0.15, side * 0.72);
    tailGroup.rotation.y = side * 0.42;
    tailGroup.rotation.z = side * 0.18;
    return tailGroup;
  }

  group.add(cantedTail(1));
  group.add(cantedTail(-1));

  const hStabShape = new THREE.Shape();
  hStabShape.moveTo(0, 0);
  hStabShape.lineTo(0.9, 0.08);
  hStabShape.lineTo(0.95, 0.42);
  hStabShape.lineTo(0.1, 0.38);
  hStabShape.closePath();
  const hStabGeo = new THREE.ExtrudeGeometry(hStabShape, { depth: 0.06, bevelEnabled: false });
  hStabGeo.rotateX(-Math.PI / 2);
  const hStab = new THREE.Mesh(hStabGeo, accentMat);
  hStab.position.set(-2.15, 0.08, 0);
  hStab.scale.set(1, 1, 1.1);
  hStab.name = 'tail';
  group.add(hStab);

  function intake(side) {
    const g = new THREE.Group();
    const duct = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.2, 0.55),
      darkMat
    );
    duct.position.set(0.35, -0.12, side * 0.52);
    duct.name = 'intake';
    g.add(duct);
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.06, 0.5),
      accentMat
    );
    lip.position.set(0.5, -0.02, side * 0.52);
    lip.name = 'intake';
    g.add(lip);
    return g;
  }
  group.add(intake(1));
  group.add(intake(-1));

  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.45),
    canopyMat
  );
  canopy.rotation.z = -Math.PI / 2;
  canopy.position.set(1.05, 0.28, 0);
  canopy.scale.set(1.85, 0.95, 0.75);
  canopy.name = 'cockpit';
  group.add(canopy);

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.35, 0.7),
    darkMat
  );
  frame.rotation.z = -Math.PI / 2;
  frame.position.set(1.0, 0.3, 0);
  frame.name = 'cockpit';
  group.add(frame);

  function engineBay(side) {
    const bay = new THREE.Group();
    const nacelle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.26, 1.35, 16),
      accentMat
    );
    nacelle.rotation.z = Math.PI / 2;
    nacelle.position.set(-2.35, 0, side * 0.38);
    nacelle.name = 'engine';
    bay.add(nacelle);

    const nozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.4, 16),
      darkMat
    );
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(-2.95, 0, side * 0.38);
    bay.add(nozzle);

    const petal = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.22, 0.08),
      darkMat
    );
    petal.rotation.z = Math.PI / 2;
    petal.position.set(-2.88, 0.08, side * 0.38);
    bay.add(petal);

    return bay;
  }
  group.add(engineBay(1));
  group.add(engineBay(-1));

  const bayDoor = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.04, 0.5),
    darkMat
  );
  bayDoor.position.set(-0.1, -0.08, 0);
  bayDoor.name = 'weapons-bay-door';
  bayDoor.userData.isWeaponsDoor = true;
  group.add(bayDoor);

  group.scale.setScalar(0.95);
  addEdges(group, 0x1a2228, 15);

  group.userData.materials = { bodyMat, accentMat, canopyMat, darkMat, schemeName };
  group.userData.hotspots = buildHotspots();

  return group;
}

function buildHotspots() {
  return [
    {
      name: 'cockpit',
      label: 'AN/APG-77 AESA RADAR & COCKPIT',
      detail:
        'Helmet-mounted cueing, sensor fusion, and first-look / first-kill situational awareness.',
      position: new THREE.Vector3(1.2, 0.4, 0),
      meshNames: ['cockpit', 'nose'],
    },
    {
      name: 'wing',
      label: 'LOW-OBSERVABLE PLANFORM',
      detail:
        'Trapezoidal wings and aligned edges reduce radar cross-section while preserving agility.',
      position: new THREE.Vector3(0.5, 0, 1.2),
      meshNames: ['wing'],
    },
    {
      name: 'engine',
      label: 'F119-PW-100 THRUST VECTORING',
      detail:
        'Two-dimensional nozzle vectoring enables supermaneuverability beyond conventional fighters.',
      position: new THREE.Vector3(-2.5, 0, 0.5),
      meshNames: ['engine'],
    },
    {
      name: 'fuselage',
      label: 'INTERNAL WEAPONS BAY',
      detail:
        'Carries AIM-120 and AIM-9 internally to maintain stealth profile until engagement.',
      position: new THREE.Vector3(0, 0, 0),
      meshNames: ['fuselage'],
    },
    {
      name: 'tail',
      label: 'CANTED VERTICAL STABILIZERS',
      detail:
        'Angled tails deflect radar returns and support extreme angle-of-attack control.',
      position: new THREE.Vector3(-2, 0.6, 0.7),
      meshNames: ['tail'],
    },
  ];
}

export function applyScheme(group, schemeName, envMap = null) {
  const scheme = SCHEMES[schemeName];
  if (!scheme || !group.userData.materials) return;

  const { bodyMat, accentMat, canopyMat } = group.userData.materials;
  bodyMat.color.setHex(scheme.body);
  accentMat.color.setHex(scheme.accent);
  canopyMat.color.setHex(scheme.canopy);
  bodyMat.metalness = accentMat.metalness = scheme.metalness;
  bodyMat.roughness = accentMat.roughness = scheme.roughness;
  if (envMap) {
    bodyMat.envMap = accentMat.envMap = canopyMat.envMap = envMap;
  }
  group.userData.materials.schemeName = schemeName;
}

function flameLayer(radius, height, color, opacity) {
  const geo = new THREE.ConeGeometry(radius, height, 16, 1, true);
  geo.translate(0, height * 0.5, 0);
  return new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
}

/** Multi-layer plume; align parent with quaternion (local +Y = exhaust). */
export function createAfterburnerAssembly() {
  const root = new THREE.Group();
  const core = flameLayer(0.06, 0.35, 0xfff4a8, 0);
  const mid = flameLayer(0.11, 0.72, 0xff8800, 0);
  const outer = flameLayer(0.16, 1.1, 0xff4400, 0);
  const halo = flameLayer(0.21, 1.4, 0xff2200, 0);
  root.add(core, mid, outer, halo);
  root.userData.flames = [core, mid, outer, halo];
  return root;
}

export function createFlameMesh() {
  return createAfterburnerAssembly();
}

export function createAfterburnerGlow() {
  const group = new THREE.Group();
  const left = createAfterburnerAssembly();
  const right = createAfterburnerAssembly();
  left.position.set(-3.2, 0, 0.38);
  right.position.set(-3.2, 0, -0.38);
  left.rotation.z = Math.PI / 2;
  right.rotation.z = Math.PI / 2;
  group.add(left, right);
  group.userData.flames = [...left.userData.flames, ...right.userData.flames];
  return group;
}

export function setAfterburnerIntensity(glowGroup, t) {
  const intensity = Math.pow(Math.max(0, Math.min(1, t)), 1.35);
  const flames = glowGroup.userData.flames || [];
  for (let i = 0; i < flames.length; i++) {
    const flame = flames[i];
    const layer = i % 4;
    flame.material.opacity = intensity * (0.72 - layer * 0.11);
    const sy = 0.4 + intensity * (2.1 - layer * 0.28);
    const sx = 0.48 + intensity * (1.02 - layer * 0.07);
    flame.scale.set(sx, sy, sx);
    const hue = 0.09 - intensity * 0.035 - layer * 0.007;
    flame.material.color.setHSL(hue, 1, 0.36 + intensity * 0.18 - layer * 0.04);
  }
}
