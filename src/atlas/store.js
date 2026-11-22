const key = 'bahnorama.atlas.v1';

export function createAtlas(storage) {
  const read = () => {
    const target = storage ?? globalThis.localStorage;
    const saved = target.getItem(key) ?? target.getItem('windowlens.atlas.v1');
    const data = JSON.parse(saved ?? '{"objects":[],"journeys":[]}');
    if (!data || !Array.isArray(data.objects) || !Array.isArray(data.journeys)) throw new Error('Atlasformat ungültig.');
    return data;
  };
  function update(change) {
    const data = read();
    change(data);
    (storage ?? globalThis.localStorage).setItem(key, JSON.stringify(data));
  }
  return {
    read,
    collect(poiId, poi) {
      update(data => {
        if (!data.objects.some(object => object.poiId === poiId)) {
          data.objects.push({poiId, collectedAt: new Date().toISOString(), ...(poi ? {poi} : {})});
        }
      });
    },
    saveJourney(journey) { update(data => data.journeys.push(journey)); },
  };
}
