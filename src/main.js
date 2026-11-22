import {createCamera} from './device/camera.js';
import {createOrientation} from './device/orientation.js?v=23';
import {createPosition} from './device/position.js';
import {createPoseProvider} from './ar/pose.js';
import {createOverlay} from './ar/overlay.js';
import {createMapPanel} from './map/map-panel.js?v=27';
import {createNearbyPois} from './data/nearbyPois.js?v=28';
import {pois} from './data/mainzTestPois.js';
import {regionalLod2Pois} from './data/regionalLod2Pois.js';
import {poiEnrichment} from './data/poiEnrichment.js';
import {createPoiDetails} from './data/details.js?v=28';
import {createAtlas} from './atlas/store.js';
import {renderDashboard} from './atlas/view.js';
import {createJourneyRecorder} from './journey/recorder.js';
import {createLocalBuildingProvider} from './data/providers/localBuildings.js';
import {applyBuildingManifest} from './data/buildingManifest.js';
import {applyLod2Manifest, createLod2BuildingProvider} from './data/providers/lod2Buildings.js';
import {createBuildingStream} from './poi/visibilityManager.js';

const $ = id => document.getElementById(id);
const announce = message => { $('status').textContent = message; };
const currentPois = [...pois, ...regionalLod2Pois].map(poi => ({
  ...poi,
  ...(poiEnrichment[poi.id] ?? {}),
}));
console.log(`Bahnorama: ${currentPois.length} POIs geladen`);

const loadNearbyPois = createNearbyPois();
const nearbyGps = $('nearby-gps');
const nearbyStatus = $('nearby-status');
const localOsmRefs = new Set(currentPois.map(poi => poi.osmRef).filter(Boolean));
const newPois = list => list.filter(poi => !poi.osmRef || !localOsmRefs.has(poi.osmRef));

const atlas = createAtlas();
const recorder = createJourneyRecorder();
const collectedPoiIds = () => {
  try {
    return atlas.read().objects.map(entry => entry.poiId);
  } catch {
    return [];
  }
};
function syncCollectedPois() {
  const ids = collectedPoiIds();
  mapPanel?.setCollected(ids);
  $('dashboard').querySelector('[data-count]').textContent = ids.length;
}
let selectedLivePoi;
const openDetails = createPoiDetails($('poi-dialog'), id => {
  atlas.collect(id, selectedLivePoi?.id === id ? selectedLivePoi : undefined);
  syncCollectedPois();
}, announce, id => collectedPoiIds().includes(id));
function openPoi(poi) {
  selectedLivePoi = poi.id.startsWith('osm-') || poi.id.startsWith('wikipedia-de-') ? poi : undefined;
  openDetails(poi);
}
const video = $('camera');
const stage = $('scene-stage');
export const desktopLayout = window.matchMedia('(min-width: 1024px)');
let activeView = desktopLayout.matches ? 'map' : 'ar';
const sheet = $('sheet');

const mapPanel = window.L ? createMapPanel($('map-panel'), {
  pois: currentPois,
  center: [49.9881632, 8.2270956],
  zoom: 12,
  collectedIds: collectedPoiIds(),
  onPoiClick: openPoi,
  onViewportChange: refreshMapPois,
}) : null;

syncCollectedPois();

const mapPoiStatus = $('map-poi-status');
let mapQuery = 0;
let mapQueryTimer;
function refreshMapPois({lat, lon}) {
  const query = ++mapQuery;
  clearTimeout(mapQueryTimer);
  mapPoiStatus.textContent = 'Orte in der Kartenmitte werden geladen …';
  mapQueryTimer = setTimeout(async () => {
    try {
      const results = await loadNearbyPois(lat, lon);
      if (query !== mapQuery) return;
      const nearby = newPois(results);
      mapPanel.setPois([...currentPois, ...nearby]);
      mapPoiStatus.textContent = nearby.length
        ? `${nearby.length} zusätzliche Orte rund um die Kartenmitte geladen.`
        : 'Keine zusätzlichen Orte rund um die Kartenmitte gefunden.';
    } catch (error) {
      if (query !== mapQuery) return;
      console.warn('Bahnorama: Orte konnten nicht geladen werden', error);
      mapPanel.setPois(currentPois);
      mapPoiStatus.textContent = 'Zusätzliche Orte sind derzeit nicht abrufbar.';
    }
  }, 450);
}

// Sicherstellen, dass alle POIs auf der Karte liegen.
if (mapPanel) {
  refreshMapPois({lat: 49.9881632, lon: 8.2270956});

  fetch('./src/data/rail.geojson')
    .then(response => {
      if (!response.ok) throw new Error(`Schienennetz: HTTP ${response.status}`);
      return response.json();
    })
    .then(data => mapPanel.addGeoJson(data, {
      color: '#475569', weight: 2, opacity: 0.8,
    }))
    .catch(error => console.warn('Schienennetz konnte nicht geladen werden:', error));

  fetch('./src/data/stations.geojson')
    .then(response => {
      if (!response.ok) {
        throw new Error(`Bahnhöfe: HTTP ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      mapPanel.addStations(data);
    })
    .catch(error => {
      console.warn('Bahnhöfe konnten nicht geladen werden:', error);
    });
} else {
  $('map-panel').textContent = 'Karte derzeit nicht verfügbar.';
}

// ============================================================
// Gebäudestreaming: LoD2 mit OSM-Fallback.
// ============================================================
const buildingProvider = createLod2BuildingProvider(createLocalBuildingProvider());
const buildings = createBuildingStream(currentPois, buildingProvider, {
  onStatus: ({loaded, loading, errors}) => {
    $('building-status').textContent =
      `${loaded} Gebäude geladen` +
      (loading ? ` · ${loading} im Abruf` : '') +
      (errors ? ` · ${errors} ohne abrufbares Modell` : '');
  },
});

async function loadBuildingManifest(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`Building manifest unavailable at ${path}:`, error);
    return null;
  }
}

Promise.all([
  loadBuildingManifest('./assets/buildings/manifest.json'),
  loadBuildingManifest('./assets/buildings/lod2/manifest.json?v=26'),
]).then(([osmManifest, lod2Manifest]) => {
  const osm = applyBuildingManifest(currentPois, osmManifest);
  const lod2 = applyLod2Manifest(currentPois, lod2Manifest);
  console.info(`Bahnorama: ${lod2} LoD2 POIs, ${osm} POIs with OSM geometry`);
});

// User preferences – off by default; survive page reloads.
const DISTANCE_STORAGE_KEY = 'bahnorama.showPoiDistance.v1';
try {
  const savedDistance = localStorage.getItem(DISTANCE_STORAGE_KEY) ??
    localStorage.getItem('windowlens.showPoiDistance.v1');
  $('show-poi-distance').checked = savedDistance === 'true';
} catch { /* Private mode can disallow storage. */ }
$('show-poi-distance').addEventListener('change', () => {
  try {
    localStorage.setItem(DISTANCE_STORAGE_KEY, String($('show-poi-distance').checked));
  } catch { /* Preference remains active for this session. */ }
});

// The document head has already selected the initial appearance.
const glassSurfaces = $('glass-surfaces');
glassSurfaces.checked = document.documentElement.dataset.glass !== 'off';
glassSurfaces.addEventListener('change', () => {
  if (glassSurfaces.checked) delete document.documentElement.dataset.glass;
  else document.documentElement.dataset.glass = 'off';
  try {
    localStorage.setItem('bahnorama.glassSurfaces.v1', glassSurfaces.checked ? 'on' : 'off');
  } catch { /* Preference remains active for this session. */ }
});

// AR-Overlay – nur eine einzige Instanz
const overlayFor = entries => createOverlay(
  $('models'), $('markers'), entries, openPoi, video,
  poi => buildings.getModel(poi),
  {showDistance: () => $('show-poi-distance').checked}
);

let renderOverlay = overlayFor(currentPois);
let gpsQuery;
let nextGpsSearch = 0;
function refreshGpsPois(fix) {
  if (!nearbyGps.checked || fix.source !== 'gps') {
    if (gpsQuery) {
      gpsQuery = null;
      nextGpsSearch = 0;
      renderOverlay = overlayFor(currentPois);
      nearbyStatus.textContent = '';
    }
    return;
  }
  if (Date.now() < nextGpsSearch) return;
  nextGpsSearch = Date.now() + 15000;
  const query = loadNearbyPois(fix.lat, fix.lon);
  if (query === gpsQuery) return;
  gpsQuery = query;
  nearbyStatus.textContent = 'Orte in der Umgebung werden geladen …';
  query.then(results => {
    if (gpsQuery !== query) return;
    const nearby = newPois(results);
    renderOverlay = overlayFor([...currentPois, ...nearby]);
    nearbyStatus.textContent = `${nearby.length} zusätzliche Orte geladen.`;
  }).catch(() => {
    if (gpsQuery !== query) return;
    renderOverlay = overlayFor(currentPois);
    nearbyStatus.textContent = 'Orte in der Umgebung sind derzeit nicht abrufbar.';
  });
}

// ============================================================
// Bottom-Sheet im Apple-Maps-Stil
// Drei Zustände: peek (angedeutet), half (halb), full (maximiert).
// Ziehen am Grabber, Tippen auf Grabber und Tastatur wechseln
// zwischen den Zuständen.
// ============================================================
const grabber = $('sheet-grabber');
const sheetMapToggle = $('sheet-map-toggle');
const sheetBody = $('sheet-body');
// HUD-Chips (Standort/Blickrichtung), die über dem Sheet schweben.
const hudDock = $('hud-dock');
const hudHeader = document.querySelector('.header');
const SHEET_STATES = ['peek', 'half', 'full'];
let sheetState = 'peek';
let sheetTimer = null;

function resizeMapAfterSheetChange() {
  // Leaflet-Karte hängt im Sheet-Body: Nach jeder
  // Größenänderung neu messen lassen, sonst bleiben
  // Kacheln leer oder verschieben sich.
  window.clearTimeout(sheetTimer);
  sheetTimer = window.setTimeout(
    () => mapPanel?.invalidate(),
    500
  );
}

function setSheetState(state) {
  sheetState = state;
  sheet.className = `sheet sheet--${state}`;
  const expanded = state !== 'peek';
  for (const control of [grabber, sheetMapToggle]) control.setAttribute('aria-expanded', String(expanded));
  sheetMapToggle.textContent = expanded ? 'Karte schließen' : 'Karte öffnen';
  sheetBody.inert = state === 'peek';
  // Voll ausgefahren: HUD-Chips verschwinden garantiert.
  hudDock.classList.toggle('hud-dock--hidden', state === 'full');

  // Bei full Sheet: Karte auf volle Höhe ausdehnen
  if (mapPanel) {
    mapPanel.setOpen(state === 'full');
  }

  resizeMapAfterSheetChange();
}

function stepSheet(direction) {
  const index = Math.min(
    SHEET_STATES.length - 1,
    Math.max(0, SHEET_STATES.indexOf(sheetState) + direction)
  );
  setSheetState(SHEET_STATES[index]);
}

function toggleSheet() {
  setSheetState(sheetState === 'peek' ? 'full' : 'peek');
}

sheetMapToggle.addEventListener('click', toggleSheet);

(() => {
  let startY = 0;
  let startTravel = 0;
  let dragging = false;
  let suppressClick = false;

  const currentTravel = () =>
    window.innerHeight - sheet.getBoundingClientRect().top;

  grabber.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    dragging = true;
    startY = event.clientY;
    startTravel = currentTravel();
    sheet.classList.add('dragging');
    grabber.setPointerCapture(event.pointerId);
  });

  grabber.addEventListener('pointermove', event => {
    if (!dragging) return;
    const delta = startY - event.clientY;
    sheet.style.transform =
      `translate(-50%, calc(100% - ${Math.max(40, startTravel + delta)}px))`;
  });

  grabber.addEventListener('pointerup', event => {
    if (!dragging) return;
    const delta = startY - event.clientY;
    dragging = false;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    const threshold = 40;

    if (Math.abs(delta) > threshold) {
      suppressClick = true;
      stepSheet(delta > 0 ? 1 : -1);
    }
  });

  grabber.addEventListener('pointercancel', () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
  });

  grabber.addEventListener('click', event => {
    if (suppressClick && event.detail > 0) return;
    toggleSheet();
  });
  grabber.addEventListener('keydown', event => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      stepSheet(1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      stepSheet(-1);
    }
  });
})();

// Das Drei-Punkte-Menü wurde mit dem UI-Redesign aus index.html entfernt;
// die Einstellungen liegen jetzt direkt im Sheet. Der alte Menü-Code hier
// griff weiterhin auf $('menu-root') / $('menu-toggle') / $('app-menu') zu
// und ließ das gesamte Modul beim Start mit einem TypeError sterben.

// ============================================================
// Geräte: Kamera, Sensoren, GPS.
// ============================================================
let cameraRetryNeeded = false;
let gpsRetryNeeded = false;
let gpsMessage = '';
let sensorNeedsGesture = false;
let sensorStatus = 'Nicht gestartet';
let cameraBusy = false;
let cameraWanted = true;
let autoSwitchToSensors = true;

function syncControls() {
  $('camera-toggle').textContent = camera.active ? 'Kamera stoppen' : 'Kamera aktivieren';
  $('camera-toggle').disabled = cameraBusy;
  $('desktop-camera-toggle').textContent = $('camera-toggle').textContent;
  $('desktop-camera-toggle').disabled = cameraBusy;
  $('switch').disabled = !camera.active || cameraBusy;
  $('gps').textContent = position.active ? 'GPS stoppen' : 'GPS aktivieren';
  $('sensors').textContent = orientation.active ? 'Sensoren stoppen' : 'Sensoren aktivieren';
  $('sensor-status').textContent = sensorStatus;
}

function updatePermissionBanner() {
  const needsAction = sensorNeedsGesture || cameraRetryNeeded || gpsRetryNeeded;
  $('permission-banner').hidden = !needsAction;
  $('permission-gps').hidden = !gpsRetryNeeded || !(sensorNeedsGesture || cameraRetryNeeded);
  const gpsStatus = $('permission-gps-status');
  gpsStatus.textContent = $('permission-gps').hidden ? '' : gpsMessage;
  gpsStatus.hidden = !gpsStatus.textContent;
  if (!needsAction) return;

  const action = sensorNeedsGesture
    ? ['Bewegungssensoren für AR freigeben.', 'Sensoren aktivieren']
    : cameraRetryNeeded
      ? ['Kamera für AR freigeben.', 'Kamera aktivieren']
      : [gpsMessage || 'Standort für AR freigeben.', 'GPS aktivieren'];
  $('permission-message').textContent = action[0];
  $('enable-ar').textContent = action[1];
}

const camera = createCamera(video, active => {
  video.classList.toggle('active', active);
  syncControls();
});

const orientation = createOrientation(status => {
  sensorStatus = status;
  $('sensor-status').textContent = status;
  // Give a visible diagnostic for relative-only sensors requiring calibration.
  if (status.includes('Relative') || status.includes('Keine Sensordaten')) announce(status);
});

let mapCentered = false;
function handlePositionUpdate(fix, status, error) {
  // Standort-Chip zeigt nur die aktuelle Positionsgenauigkeit.
  $('position').textContent =
    fix.source === 'gps' && Number.isFinite(fix.accuracy)
      ? `±${Math.round(fix.accuracy)} m`
      : '—';
  // Karte nutzt denselben Standort-Service; der Mainz-Fallback wird nicht
  // als vermeintlicher GPS-Fix eingezeichnet.
  const hasGpsFix = fix.source === 'gps' &&
    Number.isFinite(fix.lat) && Number.isFinite(fix.lon);
  mapPanel?.setLocation(hasGpsFix ? fix.lat : null, hasGpsFix ? fix.lon : null);
  recorder.sample(fix);
  refreshGpsPois(fix);
  mapPanel?.setLocation(fix);
  if (fix.source === 'gps' && !mapCentered) {
    mapPanel?.setView(fix.lat, fix.lon, undefined, nearbyGps.checked);
    mapCentered = true;
  }
  if (error) {
    gpsRetryNeeded = true;
    gpsMessage = status;
  }
  if (fix.source === 'gps') gpsRetryNeeded = false;
  syncControls();
  updatePermissionBanner();
  announce(status);
}
const position = createPosition(handlePositionUpdate);
nearbyGps.addEventListener('change', () => refreshGpsPois(position.current));
const poses = createPoseProvider(position, orientation);
const value = id => Number($(id).value);

const run = async action => {
  try { await action(); }
  catch (error) {
    console.error(error);
    announce(error.message || String(error));
  }
};

async function startCamera(facing = 'environment') {
  if (cameraBusy || activeView !== 'ar') return;
  cameraBusy = true;
  syncControls();
  try {
    await camera.start(facing);
    cameraRetryNeeded = false;
  } catch (error) {
    cameraRetryNeeded = true;
    announce(`Kamera: ${error.message}`);
    console.warn('Kamera nicht automatisch gestartet:', error);
  } finally {
    cameraBusy = false;
    syncControls();
    updatePermissionBanner();
  }
}

function startGps(userGesture = false) {
  try {
    gpsRetryNeeded = false;
    gpsMessage = '';
    if (!position.active) position.start({userGesture});
  } catch (error) {
    gpsRetryNeeded = true;
    gpsMessage = error.message;
    announce(`Standort: ${error.message}`);
    console.warn('GPS nicht automatisch gestartet:', error);
  }
  syncControls();
  updatePermissionBanner();
}

async function startSensors(userGesture = false) {
  if (orientation.active) return;
  const api = window.DeviceOrientationEvent;
  if (!api) {
    sensorNeedsGesture = false;
    sensorStatus = 'Keine Orientierungssensoren verfügbar – manuelle Blickrichtung nutzen.';
    syncControls();
    return;
  }

  // iOS requires requestPermission() from a real tap, even when site loading.
  if (typeof api.requestPermission === 'function' && !userGesture && !orientation.permissionGranted) {
    sensorNeedsGesture = true;
    sensorStatus = 'Zum Aktivieren der Sensoren bitte „Sensoren aktivieren“ antippen.';
    syncControls();
    updatePermissionBanner();
    return;
  }

  try {
    // IMPORTANT: orientation.start() is called synchronously within the
    // click handler before any await (needed for iOS transient activation).
    await orientation.start();
    if (!orientation.active) return;
    sensorNeedsGesture = false;
    sensorStatus = 'Sensoren aktiv – warte auf verwertbare Orientierung.';
    autoSwitchToSensors = true;
  } catch (error) {
    sensorNeedsGesture = typeof api.requestPermission === 'function';
    sensorStatus = `Sensoren: ${error.message}`;
    console.warn('Orientierungssensoren nicht gestartet:', error);
  } finally {
    syncControls();
    updatePermissionBanner();
  }
}

// GPS stays available even if another permission is denied.
$('permission-gps').addEventListener('click', () => startGps(true));

// Each permission starts in its own click handler, before any await.
$('enable-ar').addEventListener('click', () => {
  if (sensorNeedsGesture) void startSensors(true);
  else if (cameraRetryNeeded) void startCamera();
  else if (gpsRetryNeeded) startGps(true);
});

function toggleCamera() {
  if (camera.active) {
    cameraWanted = false;
    camera.stop();
    cameraRetryNeeded = false;
    syncControls();
    updatePermissionBanner();
  } else {
    cameraWanted = true;
    if (activeView !== 'ar') showView('ar');
    else void startCamera();
  }
}
$('camera-toggle').addEventListener('click', toggleCamera);
$('desktop-camera-toggle').addEventListener('click', toggleCamera);
$('switch').addEventListener('click', () => {
  cameraWanted = true;
  void startCamera(camera.facing === 'environment' ? 'user' : 'environment');
});
$('gps').addEventListener('click', () => {
  if (position.active) {
    position.stop();
    gpsRetryNeeded = false;
    syncControls();
    updatePermissionBanner();
  } else startGps(true);
});
$('sensors').addEventListener('click', () => {
  if (orientation.active) {
    orientation.stop();
    sensorStatus = 'Sensoren ausgeschaltet; manuelle Blickrichtung aktiv.';
    $('manual').checked = true;
    autoSwitchToSensors = false;
    updateManual();
    sensorNeedsGesture = false;
    syncControls();
    updatePermissionBanner();
  } else {
    // Do not wrap this in an awaited helper before requestPermission().
    void startSensors(true);
  }
});

function updateManual() {
  $('manual-controls').hidden = !$('manual').checked;
}
$('manual').addEventListener('change', () => {
  // Respect explicit user input; don't override manual mode later.
  autoSwitchToSensors = false;
  updateManual();
});
updateManual();

$('calibration').addEventListener('submit', event => {
  event.preventDefault();
  void run(() => {
    orientation.calibrateHeading(value('known-heading'), camera.facing);
    $('manual').checked = false;
    autoSwitchToSensors = false;
    updateManual();
    announce('Azimut kalibriert.');
  });
});
$('zero').addEventListener('click', () => void run(() => {
  orientation.zeroPitch(camera.facing);
  announce('Neigung genullt.');
}));
$('reset').addEventListener('click', () => {
  orientation.reset();
  announce('Kalibrierung zurückgesetzt.');
});

$('record').addEventListener('click', () => void run(() => {
  if (recorder.current) {
    const hasPoints = recorder.current.segments.length > 0;
    recorder.finish(trip => atlas.saveJourney(trip));
    announce(hasPoints ? 'Fahrt im Atlas gespeichert.' : 'Keine verwertbaren Standortpunkte empfangen.');
  } else {
    if (!position.active) startGps(true);
    recorder.start();
    recorder.sample(position.current);
    announce('Fahrtaufzeichnung läuft.');
  }
  $('record').textContent = recorder.current ? 'Fahrt beenden' : 'Fahrt starten';
}));

export function showView(view) {
  const previousView = activeView;
  const atlasVisible = view === 'atlas';
  const dashboard = $('dashboard');
  let data;
  if (atlasVisible) {
    try { data = atlas.read(); }
    catch (error) {
      announce(error.message);
      data = {objects: [], journeys: []};
    }
  }
  activeView = view;
  stage.hidden = view !== 'ar';
  $('scene').hidden = atlasVisible;
  dashboard.hidden = !atlasVisible;
  $('desktop-main').hidden = atlasVisible;
  $('desktop-attribution-host').hidden = atlasVisible;
  $('desktop-map-host').hidden = view !== 'map';
  $('desktop-ar-host').hidden = view !== 'ar';
  $('desktop-map-title').textContent = view === 'ar' ? 'Blick aus dem Zug' : 'Strecken & Sehenswürdigkeiten';
  $('desktop-map-subtitle').textContent = view === 'ar' ? 'AR-Ansicht' : 'Interaktive Karte';
  for (const name of ['map', 'ar', 'atlas']) {
    $('desktop-' + name + '-button').setAttribute('aria-pressed', String(name === view));
  }
  $('explore').setAttribute('aria-pressed', String(!atlasVisible));
  $('atlas').setAttribute('aria-pressed', String(atlasVisible));

  if (view === 'ar' && previousView !== 'ar') resumeCamera();
  if (atlasVisible) renderDashboard(dashboard, data, currentPois, openPoi);
  else {
    requestAnimationFrame(() => mapPanel?.invalidate());
    resizeMapAfterSheetChange();
  }
  syncControls();
}

$('atlas').addEventListener('click', () => void run(() => showView('atlas')));
$('explore').addEventListener('click', () => showView(desktopLayout.matches ? 'map' : 'ar'));
for (const view of ['map', 'ar', 'atlas']) {
  $('desktop-' + view + '-button').addEventListener('click', () => void run(() => showView(view)));
}

// ============================================================
// HUD-Dock: Standort- und Blickrichtungs-Chips folgen dem Sheet.
// `bottom` wird jeden Frame aus der sichtbaren Sheet-Höhe
// berechnet, dadurch bewegen sich die Chips auch beim Ziehen
// live mit. Im Full-Zustand und ohne Platz über dem Sheet
// werden sie ausgeblendet.
// ============================================================
function trackHudOverSheet() {
  const sheetTop = sheet.getBoundingClientRect().top;
  hudDock.style.bottom = `calc(${window.innerHeight - sheetTop}px + .75rem)`;
  const room = sheetTop - (hudHeader ? hudHeader.getBoundingClientRect().bottom : 0);
  hudDock.classList.toggle(
    'hud-dock--hidden',
    sheetState === 'full' || room < hudDock.offsetHeight + 16
  );
}

function draw() {
  if (!stage.hidden && $('preview-3d').hidden) {
    // Switch from demonstration heading to real absolute orientation only
    // when a valid sensor pose actually exists (relative-only sensors need calibration).
    if (autoSwitchToSensors && orientation.active && $('manual').checked &&
        orientation.getPose({facing: camera.facing, manual: null})) {
      $('manual').checked = false;
      autoSwitchToSensors = false;
      updateManual();
    }

    const manual = $('manual').checked
      ? {heading: value('heading'), pitch: value('pitch')}
      : null;
    const frame = poses.getFrame({facing: camera.facing, manual});
    buildings.update(frame);
    // Blickrichtungs-Chip zeigt nur den Azimut in Grad.
    $('pose').textContent = frame.camera
      ? (frame.camera.heading == null ? '—' : `${Math.round(frame.camera.heading)}°`)
      : '—';
    renderOverlay(frame, [value('hfov'), value('vfov')]);
  }
  const distance = recorder.current ? `${(recorder.current.distanceM / 1000).toFixed(2)} km` : '';
  if ($('recording').textContent !== distance) $('recording').textContent = distance;
  trackHudOverSheet();
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

function resumeCamera() {
  if (camera.active) {
    void video.play().catch(error => announce('Kamerabild: ' + error.message));
  } else if (cameraWanted) {
    void startCamera();
  }
}

window.addEventListener('bahnorama-3d-closed', () => {
  if (activeView === 'ar') resumeCamera();
  syncControls();
  updatePermissionBanner();
});

let suspendedDevices;
window.addEventListener('pagehide', () => {
  suspendedDevices = {
    camera: camera.active || cameraBusy,
    sensors: orientation.active,
    gps: position.active,
  };
  camera.stop();
  orientation.stop();
  position.stop();
});
window.addEventListener('pageshow', event => {
  if (!event.persisted || !suspendedDevices) return;
  const resume = suspendedDevices;
  suspendedDevices = null;
  if (resume.camera && activeView === 'ar') resumeCamera();
  if (resume.sensors) void startSensors(false);
  if (resume.gps) startGps(false);
});

// Browsers that require a gesture for orientation use the permission banner.
const needsGestureForSensors = typeof window.DeviceOrientationEvent?.requestPermission === 'function';
if (needsGestureForSensors) {
  cameraRetryNeeded = true;
  gpsRetryNeeded = true;
} else {
  void (async () => {
    await startCamera();
    startGps();
  })();
}
syncControls();
void startSensors(false);