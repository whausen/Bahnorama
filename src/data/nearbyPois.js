import {distanceAndBearing} from '../ar/geometry.js';

const endpoint = 'https://overpass-api.de/api/interpreter';
const radius = 5000;
const selectors = [
  '["tourism"~"^(attraction|museum|gallery|viewpoint|artwork|zoo|theme_park)$"]',
  '["historic"]',
  '["heritage"]',
  '["natural"~"^(peak|waterfall|cave_entrance)$"]',
  '["railway"~"^(station|halt)$"]',
];
const labels = {
  attraction: 'Sehenswürdigkeit', museum: 'Museum', gallery: 'Galerie',
  viewpoint: 'Aussichtspunkt', artwork: 'Kunstwerk', zoo: 'Zoo',
  theme_park: 'Freizeitpark', peak: 'Gipfel', waterfall: 'Wasserfall',
  cave_entrance: 'Höhle', station: 'Bahnhof', halt: 'Haltepunkt',
};

async function loadWikipediaPois(fetchData, lat, lon) {
  const params = new URLSearchParams({
    action: 'query', list: 'geosearch', gscoord: `${lat}|${lon}`,
    gsradius: String(radius), gslimit: '50', format: 'json', origin: '*',
  });
  const response = await fetchData(`https://de.wikipedia.org/w/api.php?${params}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Wikipedia: HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.query?.geosearch)) throw new Error('Wikipedia: ungültige Antwort');
  return data.query.geosearch.map(entry => ({
    id: `wikipedia-de-${entry.pageid}`,
    name: entry.title, lat: entry.lat, lon: entry.lon,
    subtitle: 'Ort mit Wikipedia-Artikel',
    source: `https://de.wikipedia.org/?curid=${entry.pageid}`,
  }));
}

export function createNearbyPois(fetchData = globalThis.fetch) {
  const cache = new Map();

  return function load(lat, lon) {
    // Use a shared search grid rather than sending the exact GPS fix.
    const centerLat = (Math.round(lat * 40) / 40).toFixed(3);
    const centerLon = (Math.round(lon * 40) / 40).toFixed(3);
    const key = centerLat + ',' + centerLon;
    if (cache.has(key)) return cache.get(key);
    if (cache.size >= 32) cache.delete(cache.keys().next().value);

    const around = `(around:${radius},${key})`;
    const query = '[out:json][timeout:15];(' +
      selectors.map(selector => `nwr${around}${selector}["name"];`).join('') +
      ');out center;';
    const params = new URLSearchParams({data: query});
    const request = (async () => {
      try {
        const response = await fetchData(`${endpoint}?${params}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`Overpass: HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.elements) || data.remark) throw new Error('Overpass: unvollständige Antwort');
        return data.elements.flatMap(element => {
          const {tags = {}, type, id} = element;
          const lat = element.lat ?? element.center?.lat;
          const lon = element.lon ?? element.center?.lon;
          const name = tags['name:de'] || tags.name;
          if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
          const osmRef = `${type}/${id}`;
          const source = `https://www.openstreetmap.org/${osmRef}`;
          const subtitle = labels[tags.tourism || tags.natural || tags.railway] ?? 'Kulturdenkmal';
          return [{
            id: `osm-${type}-${id}`, osmRef, lat, lon, name, subtitle, source,
            sources: [{label: '© OpenStreetMap-Mitwirkende', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL'}],
          }];
        }).sort((a, b) => distanceAndBearing(+centerLat, +centerLon, a.lat, a.lon).distance
          - distanceAndBearing(+centerLat, +centerLon, b.lat, b.lon).distance).slice(0, 100);
      } catch {
        return loadWikipediaPois(fetchData, centerLat, centerLon);
      }
    })().catch(error => {
        // Keep failed queries briefly to prevent a train's GPS events retrying in a loop.
        setTimeout(() => {
          if (cache.get(key) === request) cache.delete(key);
        }, 60000);
        throw error;
    });
    cache.set(key, request);
    return request;
  };
}
