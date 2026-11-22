import {desktopLayout, showView} from './main.js?v=29';

const desktop = document.getElementById('desktop-app');
const dashboard = document.getElementById('dashboard');

const slots = [
  ['map-panel', 'desktop-map-host'],
  ['record', 'desktop-record-host'],
  ['recording', 'desktop-record-host'],
  ['permission-banner', 'desktop-ar-permissions'],
].map(([id, host]) => [document.getElementById(id), document.getElementById(host)]);

slots.push(
  [document.querySelector('#sheet-body .sheet-settings'), document.getElementById('desktop-settings-host')],
  [document.querySelector('#sheet-body .data-attribution'), document.getElementById('desktop-attribution-host')],
  [document.getElementById('scene-stage'), document.getElementById('desktop-ar-stage')],
  [dashboard, desktop],
);

const placements = slots.map(([element, host]) => {
  const anchor = document.createComment(element.id || 'mobile placement');
  element.before(anchor);
  return {element, host, anchor};
});

function syncLayout() {
  const isDesktop = desktopLayout.matches;
  for (const {element, host, anchor} of placements) {
    if (isDesktop) host.append(element);
    else anchor.after(element);
  }
  desktop.hidden = !isDesktop;
  document.body.classList.toggle('desktop-active', isDesktop);
  showView(dashboard.hidden ? (isDesktop ? 'map' : 'ar') : 'atlas');
}

desktopLayout.addEventListener('change', syncLayout);
syncLayout();

const desktopLocation = document.getElementById('desktop-location');
const desktopCollected = document.getElementById('desktop-collected');
const desktopKm = document.getElementById('desktop-km');
const mobilePosition = document.getElementById('position');
const atlasCount = document.querySelector('#dashboard [data-count]');
const atlasDistance = document.querySelector('#dashboard [data-distance]');
function updateDesktopTrip() {
  const pos = mobilePosition?.textContent?.trim();
  desktopLocation.textContent = pos && pos !== '—' ? pos : 'Noch nicht verfügbar';
  desktopCollected.textContent = atlasCount?.textContent?.trim() || '0';
  desktopKm.textContent = `${atlasDistance?.textContent?.trim() || '0'} km`;
}
const tripObserver = new MutationObserver(updateDesktopTrip);
for (const element of [mobilePosition, atlasCount, atlasDistance]) {
  if (element) tripObserver.observe(element, {childList:true,characterData:true,subtree:true});
}
document.getElementById('desktop-open-atlas').addEventListener('click', () => {
  document.getElementById('desktop-atlas-button').focus();
  showView('atlas');
});
updateDesktopTrip();
