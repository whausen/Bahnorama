const radians = Math.PI / 180;

function distance(a, b) {
  const north = (a[1] - b[1]) * 111195;
  const east = (a[0] - b[0]) * 111195 * Math.cos((a[1] + b[1]) / 2 * radians);
  return Math.hypot(east, north);
}

function enqueue(queue, entry) {
  let index = queue.length;
  queue.push(entry);
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (queue[parent].score <= entry.score) break;
    queue[index] = queue[parent];
    index = parent;
  }
  queue[index] = entry;
}

function dequeue(queue) {
  const first = queue[0];
  const last = queue.pop();
  if (queue.length === 0) return first;
  let index = 0;
  while (index * 2 + 1 < queue.length) {
    let child = index * 2 + 1;
    if (queue[child + 1]?.score < queue[child].score) child++;
    if (last.score <= queue[child].score) break;
    queue[index] = queue[child];
    index = child;
  }
  queue[index] = last;
  return first;
}

export function createRailRouter(data) {
  const nodes = new Map();

  function nodeFor(point) {
    const key = point.slice(0, 2).map(value => Math.round(value * 100000)).join(',');
    if (!nodes.has(key)) nodes.set(key, {point, neighbours: new Map()});
    return nodes.get(key);
  }

  for (const {geometry} of data.features) {
    const lines = geometry?.type === 'LineString' ? [geometry.coordinates]
      : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
    for (const line of lines) {
      let previous;
      for (const point of line) {
        const node = nodeFor(point);
        if (previous && previous !== node) {
          const length = distance(previous.point, node.point);
          previous.neighbours.set(node, length);
          node.neighbours.set(previous, length);
        }
        previous = node;
      }
    }
  }

  function nearby(point) {
    const candidates = [];
    for (const node of nodes.values()) {
      const length = distance(point, node.point);
      if (length <= 450 && node.neighbours.size) candidates.push({node, length});
    }
    return candidates.sort((a, b) => a.length - b.length).slice(0, 16);
  }

  return function route(from, to) {
    const starts = nearby(from);
    const ends = new Map(nearby(to).map(({node, length}) => [node, length]));
    if (!starts.length || !ends.size) return null;
    const queue = [];
    const costs = new Map();
    const previous = new Map();
    for (const {node, length} of starts) {
      const cost = length * 3;
      costs.set(node, cost);
      enqueue(queue, {node, cost, score: cost + distance(node.point, to)});
    }
    let finish;
    let best = Infinity;
    while (queue.length) {
      const {node, cost, score} = dequeue(queue);
      if (score >= best) break;
      if (cost !== costs.get(node)) continue;
      if (ends.has(node) && cost + ends.get(node) * 3 < best) {
        best = cost + ends.get(node) * 3;
        finish = node;
      }
      for (const [next, length] of node.neighbours) {
        const nextCost = cost + length;
        if (nextCost >= (costs.get(next) ?? Infinity)) continue;
        costs.set(next, nextCost);
        previous.set(next, node);
        enqueue(queue, {node: next, cost: nextCost, score: nextCost + distance(next.point, to)});
      }
    }
    if (!finish) return null;
    const points = [];
    for (let node = finish; node; node = previous.get(node)) points.push(node.point);
    return points.length > 1 ? points.reverse() : null;
  };
}
