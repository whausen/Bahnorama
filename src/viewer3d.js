export function createViewer3d(root) {

const canvas = root.getElementById('view');
const ctx = canvas.getContext('2d');
const colors = getComputedStyle(root.host || document.documentElement);
const gridColor = colors.getPropertyValue('--grid').trim();
const locationColor = colors.getPropertyValue('--location').trim();
const modelData = JSON.parse(root.getElementById('models').textContent);
const startLon = 8.25877;
const startLat = 50.00141;
const radians = Math.PI / 180;
const metresPerDegree = 111195;
const lonScale = Math.cos(startLat * radians) * metresPerDegree;
const baseHeight = 88;
const initialYaw = -.38;
const initialPitch = .92;
const buildings = new Map(Object.entries(modelData.buildings).map(([id, {origin, vertices, triangles}]) => {
  const east = (origin[0] - startLon) * lonScale;
  const north = (origin[1] - startLat) * metresPerDegree;
  const up = origin[2] - baseHeight;
  const points = vertices.map(([x, y, z]) => [east + x, north + y, up + z]);
  const faces = triangles.map(([roof, a, b, c]) => {
    const [ax, ay, az] = points[a];
    const [bx, by, bz] = points[b];
    const [cx, cy, cz] = points[c];
    const u = [bx-ax, by-ay, bz-az], v = [cx-ax, cy-ay, cz-az];
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const norm = Math.hypot(...n) || 1;
    const light = Math.max(.32, .66 + .34 * (-.38*n[0] + .5*n[1] + .77*n[2]) / norm);
    const rgb = roof ? [140, 224, 207] : [93, 181, 172];
    const shade = channels => 'rgb(' + channels.map(value => Math.round(value * light)).join(',') + ')';
    return {a, b, c, color: shade(rgb), highlight: shade([255, 193, 107])};
  });
  return [id, {points, faces}];
}));
const views = new Map();
const picker = root.getElementById('poi');
for (const poi of [...modelData.pois].sort((a, b) => a.name.localeCompare(b.name, 'de'))) {
  const key = poi.id === 'hauptbahnhof' ? 'station' : poi.id;
  const label = poi.name + (poi.models.length ? '' : ' · Standort');
  picker.add(new Option(label, key));
  const scene = poi.models.map(id => ({building:buildings.get(id), highlight:true}));
  const points = scene.flatMap(({building}) => building.points);
  const center = points.length ? [0,1,2].map(axis => {
    const values = points.map(point => point[axis]);
    return (Math.min(...values) + Math.max(...values)) / 2;
  }) : [(poi.lon-startLon)*lonScale, (poi.lat-startLat)*metresPerDegree, 0];
  const extent = points.length ? Math.max(45, 2.45 * Math.max(...points.map(point =>
    Math.hypot(...point.map((value, axis) => value-center[axis]))))) : 140;
  views.set(key, {title:poi.name, center, extent, scene, point:!points.length, lat:poi.lat, lon:poi.lon});
}

let yaw = initialYaw, pitch = initialPitch, zoom = 1, focus = 'station', scheduled = false;
let gesture;

function render() {
  scheduled = false;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * pixelRatio), pixelHeight = Math.round(height * pixelRatio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const sinA = Math.sin(yaw), cosA = Math.cos(yaw);
  const sinP = Math.sin(pitch), cosP = Math.cos(pitch);
  const {center, extent, scene, point} = views.get(focus);
  const scale = zoom * Math.min(width, height) / extent;
  function project(point) {
    const [x, y, z] = point.map((value, axis) => value - center[axis]);
    const horizontal = x*cosA - y*sinA;
    const forward = x*sinA + y*cosA;
    return [width*.5 + horizontal*scale, height*.52 - (forward*sinP + z*cosP)*scale, z*sinP - forward*cosP];
  }
  const visible = [];
  for (const {building, highlight} of scene) {
    const points = building.points.map(project);
    for (const face of building.faces) {
      const a = points[face.a], b = points[face.b], c = points[face.c];
      if (Math.max(a[0],b[0],c[0]) < 0 || Math.min(a[0],b[0],c[0]) > width ||
          Math.max(a[1],b[1],c[1]) < 0 || Math.min(a[1],b[1],c[1]) > height) continue;
      if ((b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]) >= 0) continue;
      visible.push({a, b, c, color:highlight ? face.highlight : face.color, depth:a[2]+b[2]+c[2]});
    }
  }
  visible.sort((a,b) => a.depth - b.depth);
  for (const face of visible) {
    ctx.fillStyle = face.color;
    ctx.beginPath();
    ctx.moveTo(face.a[0], face.a[1]);
    ctx.lineTo(face.b[0], face.b[1]);
    ctx.lineTo(face.c[0], face.c[1]);
    ctx.closePath();
    ctx.fill();
  }
  if (point) {
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -60; i <= 60; i += 15) {
      for (const [a, b] of [[[i,-60],[i,60]],[[-60,i],[60,i]]]) {
        const start = project([center[0]+a[0],center[1]+a[1],0]);
        const end = project([center[0]+b[0],center[1]+b[1],0]);
        ctx.moveTo(start[0],start[1]);
        ctx.lineTo(end[0],end[1]);
      }
    }
    ctx.stroke();
    const [x, ground] = project(center);
    const [, raised] = project([center[0],center[1],23]);
    ctx.strokeStyle = locationColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x,ground);
    ctx.lineTo(x,raised);
    ctx.stroke();
    ctx.fillStyle = locationColor;
    ctx.beginPath();
    ctx.arc(x,raised,8,0,2*Math.PI);
    ctx.fill();
  }
}

function refresh() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(render);
}
function rotate(dx, dy) {
  yaw += dx;
  pitch = Math.max(.3, Math.min(1.52, pitch + dy));
  refresh();
}
function magnify(factor) {
  zoom = Math.max(.45, Math.min(5, zoom * factor));
  refresh();
}
function show(next) {
  focus = next;
  yaw = initialYaw;
  pitch = initialPitch;
  zoom = 1;
  const view = views.get(focus);
  picker.value = focus;
  root.getElementById('heading').textContent = view.title + ' in 3D';
  root.getElementById('description').textContent = view.point
      ? `Standort ${view.lat.toFixed(5)}°, ${view.lon.toFixed(5)}° · Kein LoD2-Gebäudemodell im Projekt`
      : 'Amtliches LoD2-Gebäudemodell';
  root.getElementById('landmark').textContent = view.point ? 'POI-Standort' : view.title;
  root.getElementById('landmark-dot').classList.toggle('location', Boolean(view.point));
  refresh();
}
picker.addEventListener('change', () => show(picker.value));
root.getElementById('reset').onclick = () => show(focus);
root.getElementById('zoom-in').onclick = () => magnify(1.25);
root.getElementById('zoom-out').onclick = () => magnify(.8);
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  magnify(event.deltaY < 0 ? 1.12 : .89);
}, {passive:false});
canvas.addEventListener('pointerdown', event => {
  if (gesture || event.button !== 0) return;
  gesture = {id:event.pointerId, x:event.clientX, y:event.clientY};
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (gesture?.id !== event.pointerId) return;
  rotate((event.clientX - gesture.x)*.009, (event.clientY - gesture.y)*.008);
  gesture.x = event.clientX;
  gesture.y = event.clientY;
});
canvas.addEventListener('lostpointercapture', event => {
  if (gesture?.id === event.pointerId) gesture = null;
});
const keys = {
  ArrowLeft: () => rotate(-.18,0), ArrowRight: () => rotate(.18,0),
  ArrowUp: () => rotate(0,.12), ArrowDown: () => rotate(0,-.12),
  '+': () => magnify(1.25), '-': () => magnify(.8),
};
canvas.addEventListener('keydown', event => {
  const action = keys[event.key];
  if (typeof action !== 'function') return;
  event.preventDefault();
  action();
});
new ResizeObserver(refresh).observe(canvas);
return hash => {
  const key = hash === 'mewa-arena' ? 'arena' : hash === 'hauptbahnhof' ? 'station' : hash;
  show(views.has(key) ? key : 'station');
};
}
