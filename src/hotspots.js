import * as THREE from 'three';

/** Material / mesh rules → hotspot id (first match wins). */
const RULES = [
  {
    id: 'nose',
    test: (mat, name) => /gray_nose|^nose/i.test(mat) || /nose/i.test(name),
    label: 'NOSE & SENSORS',
    detail: 'Radar-absorbent nose cone and forward sensor apertures for LO signature control.',
  },
  {
    id: 'canopy',
    test: (mat) => /^glass$/i.test(mat),
    label: 'CANOPY & COCKPIT',
    detail: 'Frameless canopy with excellent visibility; supports helmet-mounted cueing and sensor fusion.',
  },
  {
    id: 'engine',
    test: (mat, name) =>
      /Material\.(009|010|011|005|012)/.test(mat) ||
      /^Object_(5|9|10|11|55)$/.test(name),
    label: 'F119-PW-100 EXHAUST',
    detail: 'Twin Pratt & Whitney F119 engines with two-dimensional thrust-vectoring nozzles.',
  },
  {
    id: 'tail',
    test: (mat) => /^tail$/i.test(mat),
    label: 'CANTED TAIL STABILIZERS',
    detail: 'Angled vertical tails reduce radar returns and improve high-AoA authority.',
  },
  {
    id: 'gear',
    test: (mat) => /tyre|white_disk/i.test(mat),
    label: 'LANDING GEAR',
    detail: 'Tricycle gear with low-observable doors; animated deployment on this model.',
  },
  {
    id: 'weapons',
    test: (mat) => /rocket/i.test(mat),
    label: 'EXTERNAL STORES / MISSILES',
    detail: 'Training or ferry stores; operational F-22 carries AIM-120 and AIM-9 in internal bays.',
  },
  {
    id: 'intake',
    test: (mat, name) =>
      /air_tube|black\.001|^black$/i.test(mat) || /cylinder/i.test(name),
    label: 'ENGINE INTAKE',
    detail: 'Divertless supersonic inlet manages boundary layer bleed for stable engine airflow.',
  },
  {
    id: 'wing',
    test: (mat) => /body_1|^gray$/i.test(mat),
    label: 'WING LEADING EDGE',
    detail: 'Trapezoidal wing with edge alignment for reduced radar cross-section.',
  },
  {
    id: 'fuselage',
    test: (mat) => /^body$|body\.001|body_cabin|cabin_black/i.test(mat),
    label: 'FUSELAGE & WEAPONS BAY',
    detail: 'Internal weapons bays preserve stealth until weapons release.',
  },
];

const DEFAULT_HOTSPOT = {
  id: 'airframe',
  label: 'F-22 AIRFRAME',
  detail: 'Fifth-generation air-superiority fighter — supercruise and all-aspect stealth.',
};

export function buildHotspotCatalog() {
  const catalog = { [DEFAULT_HOTSPOT.id]: DEFAULT_HOTSPOT };
  for (const rule of RULES) {
    catalog[rule.id] = {
      id: rule.id,
      label: rule.label,
      detail: rule.detail,
    };
  }
  return catalog;
}

function materialName(mesh) {
  const m = mesh.material;
  if (Array.isArray(m)) return m.map((x) => x?.name || '').join(' ');
  return m?.name || '';
}

export function tagMeshHotspots(model) {
  const catalog = buildHotspotCatalog();

  model.traverse((child) => {
    if (!child.isMesh || child.userData.isEdge) return;
    const mat = materialName(child);
    const name = child.name || '';

    for (const rule of RULES) {
      if (rule.test(mat, name)) {
        child.userData.hotspotId = rule.id;
        return;
      }
    }
    child.userData.hotspotId = DEFAULT_HOTSPOT.id;
  });

  return catalog;
}

export function resolveHotspotFromMesh(mesh, catalog) {
  if (!mesh || !catalog) return null;
  let node = mesh;
  while (node) {
    const id = node.userData?.hotspotId;
    if (id && catalog[id]) return catalog[id];
    node = node.parent;
  }
  return null;
}

/** Proximity zones from aircraft axes (fallback when raycast misses). */
export function buildProximityZones(axes) {
  const { bodyCenter, forward, exhaustDir, lateral, bodyBox } = axes;
  const latSpan = bodyBox.max[lateral] - bodyBox.min[lateral];

  const zone = (id, offsetAlong, offsetLat, offsetVert) => {
    const pos = bodyCenter.clone();
    pos.add(forward.clone().multiplyScalar(offsetAlong));
    pos[lateral] += offsetLat * latSpan * 0.5;
    pos.y += offsetVert;
    return { id, position: pos };
  };

  return [
    zone('nose', axes.alongSpan * 0.32, 0, 0.15),
    zone('canopy', axes.alongSpan * 0.18, 0, 0.35),
    zone('wing', axes.alongSpan * 0.05, 0.38, 0.05),
    zone('fuselage', 0, 0, 0),
    zone('engine', -axes.alongSpan * 0.38, 0.22, 0),
    zone('engine', -axes.alongSpan * 0.38, -0.22, 0),
    zone('tail', -axes.alongSpan * 0.35, 0, 0.28),
    zone('gear', -axes.alongSpan * 0.05, 0.35, -0.25),
  ];
}

export function findProximityHotspot(zones, catalog, nx, ny, camera, jetGroup) {
  let best = null;
  let bestD = 72;

  for (const z of zones) {
    const p = z.position.clone();
    jetGroup.localToWorld(p);
    p.project(camera);
    const dx = (p.x - nx) * window.innerWidth * 0.5;
    const dy = (p.y - ny) * window.innerHeight * 0.5;
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = catalog[z.id];
    }
  }

  return best;
}
