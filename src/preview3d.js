import {createViewer3d} from './viewer3d.js?v=23';

const panel = document.getElementById('preview-3d');
const root = panel.attachShadow({mode: 'open'});
let viewer;
let loading;
let opener;
let detailDialog;
let returning = false;
const previousInert = new Map();

async function loadViewer() {
  const response = await fetch('./3d.html?v=23');
  if (!response.ok) throw new Error('Die 3D-Ansicht konnte nicht geladen werden.');
  const page = new DOMParser().parseFromString(await response.text(), 'text/html');
  const style = page.querySelector('style');
  style.textContent = style.textContent.replace(':root {', ':host {');
  root.replaceChildren(style, page.querySelector('main'), page.getElementById('models'));
  root.querySelector('header a').addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    closePreview();
  });
  viewer = createViewer3d(root);
  return viewer;
}

document.addEventListener('click', async event => {
  const link = event.target.closest('a[href]');
  if (!link || event.defaultPrevented || event.button !== 0 ||
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || url.pathname !== new URL('./3d.html', location.href).pathname) return;
  event.preventDefault();
  if (returning || !panel.hidden) return;
  opener = link;
  detailDialog = link.closest('dialog[open]');
  detailDialog?.close();
  panel.hidden = false;
  for (const child of document.body.children) {
    if (child === panel || child.tagName === 'SCRIPT') continue;
    previousInert.set(child, child.inert);
    child.inert = true;
  }
  history.pushState({...history.state, bahnorama3d: true}, '', location.href);
  if (!viewer) {
    root.innerHTML = '<p role="status">3D-Ansicht wird geladen …</p>';
    loading ??= loadViewer().catch(error => {
      loading = null;
      throw error;
    });
  }
  try {
    const show = viewer || await loading;
    if (panel.hidden) return;
    show(decodeURIComponent(url.hash.slice(1)));
    panel.scrollTop = 0;
    root.querySelector('header a').focus({preventScroll: true});
  } catch (error) {
    if (panel.hidden) return;
    root.replaceChildren();
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = error.message;
    const back = document.createElement('button');
    back.textContent = 'Zurück';
    back.addEventListener('click', closePreview);
    root.append(message, back);
  }
});

function closePreview() {
  if (returning || panel.hidden) return;
  returning = true;
  history.back();
}

window.addEventListener('popstate', () => {
  returning = false;
  if (panel.hidden) return;
  panel.hidden = true;
  for (const [element, inert] of previousInert) element.inert = inert;
  previousInert.clear();
  if (detailDialog) detailDialog.showModal();
  opener?.focus({preventScroll: true});
  window.dispatchEvent(new Event('bahnorama-3d-closed'));
});

root.addEventListener('keydown', event => {
  if (event.key === 'Escape') closePreview();
});
