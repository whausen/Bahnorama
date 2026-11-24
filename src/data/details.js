async function loadWikipediaDetails(pageId, article) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*',
    prop: 'extracts|pageprops|pageimages', ppprop: 'wikibase_item',
    piprop: 'name|thumbnail', pithumbsize: '800', pilicense: 'free',
    exintro: '1', explaintext: '1', exchars: '350', redirects: '1',
  });
  params.set(pageId ? 'pageids' : 'titles', pageId || article);
  const response = await fetch('https://de.wikipedia.org/w/api.php?' + params, {
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) return null;
  return (await response.json()).query?.pages?.[0];
}

async function loadWikipediaPhoto(page, name) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*',
    prop: 'imageinfo', titles: 'File:' + page.pageimage,
    iiprop: 'url|extmetadata', iiextmetadatafilter: 'Artist|LicenseShortName|Attribution',
  });
  const response = await fetch('https://de.wikipedia.org/w/api.php?' + params, {
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) return null;
  const image = (await response.json()).query?.pages?.[0]?.imageinfo?.[0];
  const metadata = image?.extmetadata;
  if (!image?.descriptionurl || !metadata?.LicenseShortName?.value) return null;
  const parser = new DOMParser();
  const plainText = html => parser.parseFromString(html ?? '', 'text/html').body.textContent.trim();
  const artist = plainText(metadata.Attribution?.value || metadata.Artist?.value);
  const license = plainText(metadata.LicenseShortName.value);
  return {
    url: page.thumbnail.source,
    alt: name,
    source: image.descriptionurl,
    credit: [artist, license].filter(Boolean).join(' · '),
  };
}

export function createPoiDetails(dialog, collect, announce, isCollected = () => false) {
  let selected;
  const articles = new Map();

  const title = dialog.querySelector('#poi-title');
  const lod2Preview = dialog.querySelector('[data-lod2-preview]');
  const subtitle = dialog.querySelector('[data-subtitle]');
  const category = dialog.querySelector('[data-category]');
  const area = dialog.querySelector('[data-area]');
  const atlasStatus = dialog.querySelector('[data-atlas-status]');
  const photosContainer = dialog.querySelector('[data-photos]');
  const descriptionSection = dialog.querySelector('[data-description-section]');
  const description = dialog.querySelector('[data-description]');
  const descriptionCredit = dialog.querySelector('[data-description-credit]');
  const factsSection = dialog.querySelector('[data-facts-section]');
  const factsList = dialog.querySelector('[data-facts]');
  const linksSection = dialog.querySelector('[data-links-section]');
  const linksList = dialog.querySelector('[data-links]');
  const coordinates = dialog.querySelector('[data-coordinates]');
  const sources = dialog.querySelector('[data-sources]');
  const error = dialog.querySelector('[data-error]');
  const collectButton = dialog.querySelector('[data-collect]');

  function externalLink(href, text, className = '') {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = text;
    if (className) link.className = className;
    return link;
  }

  function hostLabel(href) {
    try {
      return new URL(href).hostname.replace(/^www\./, '');
    } catch {
      return 'externer Link';
    }
  }

  function setChip(element, value) {
    element.textContent = value ?? '';
    element.hidden = !value;
  }

  function renderPhotos(poi) {
    photosContainer.replaceChildren();
    photosContainer.hidden = true;

    (poi.photos ?? []).forEach((photo, index) => {
      if (!photo?.url) return;
      const figure = document.createElement('figure');
      figure.className = 'poi-photo';

      const image = document.createElement('img');
      image.src = photo.url;
      image.alt = photo.alt || poi.name;
      image.loading = index === 0 ? 'eager' : 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => {
        figure.remove();
        if (!photosContainer.children.length) photosContainer.hidden = true;
      });

      const caption = document.createElement('figcaption');
      const credit = document.createElement('span');
      credit.textContent = photo.credit || 'Bild: Wikimedia Commons';
      caption.append(credit);

      if (photo.source) {
        caption.append(document.createTextNode(' · '));
        caption.append(externalLink(photo.source, 'Bildquelle ↗', 'poi-photo__source'));
      }

      figure.append(image, caption);
      photosContainer.append(figure);
    });

    photosContainer.hidden = photosContainer.children.length === 0;
  }

  function renderDescription(poi) {
    const text = poi.description?.trim();
    description.textContent = text ?? '';
    descriptionSection.hidden = !text;

    const credit = poi.descriptionCredit?.trim();
    descriptionCredit.replaceChildren();
    if (credit) {
      descriptionCredit.append(document.createTextNode(credit));
      if (poi.descriptionSource) {
        descriptionCredit.append(document.createTextNode(' · '));
        descriptionCredit.append(externalLink(poi.descriptionSource, 'Quelle ↗'));
      }
    }
    descriptionCredit.hidden = !credit;
  }

  function renderFacts(poi) {
    const facts = (poi.facts ?? []).filter(fact => fact?.label && fact?.value);
    factsList.replaceChildren(...facts.map(fact => {
      const item = document.createElement('div');
      item.className = 'poi-fact';
      const label = document.createElement('dt');
      label.textContent = fact.label;
      const value = document.createElement('dd');
      value.textContent = fact.value;
      if (fact.source) value.title = `Quelle: ${fact.source}`;
      item.append(label, value);
      return item;
    }));
    factsSection.hidden = facts.length === 0;
  }

  function renderLinks(poi) {
    const links = (poi.links ?? []).filter(link => link?.label && link?.href);
    if (!links.length && poi.source) links.push({label: 'Quelle', href: poi.source});

    linksList.replaceChildren(...links.map(link => {
      const anchor = externalLink(link.href, '', 'poi-link');
      const label = document.createElement('span');
      label.className = 'poi-link__label';
      label.textContent = link.label;
      const hint = document.createElement('span');
      hint.className = 'poi-link__hint';
      hint.textContent = hostLabel(link.href);
      anchor.append(label, hint);
      return anchor;
    }));
    linksSection.hidden = links.length === 0;
  }

  function renderSources(poi) {
    const entries = (poi.sources ?? []).filter(source => source?.label);
    sources.replaceChildren();
    if (entries.length) {
      sources.append(document.createTextNode('Daten: '));
      entries.forEach((source, index) => {
        if (index) sources.append(document.createTextNode(' · '));
        if (source.url) {
          sources.append(externalLink(source.url, source.label));
        } else {
          sources.append(document.createTextNode(source.label));
        }
        if (source.license) {
          sources.append(document.createTextNode(` (${source.license})`));
        }
      });
    }
    sources.hidden = entries.length === 0;
  }

  collectButton.addEventListener('click', () => {
    if (!selected || collectButton.hidden) return;
    try {
      collect(selected.id);
      error.hidden = true;
      collectButton.hidden = true;
      atlasStatus.hidden = false;
      atlasStatus.focus();
      announce(`${selected.name} ist im Atlas.`);
    } catch (error) {
      error.textContent = error.message;
      error.hidden = false;
    }
  });

  return poi => {
    selected = poi;

    title.textContent = poi.name;
    if (lod2Preview) {
      const hasLocation = typeof poi.id === 'string' && !/^(osm-|wikipedia-de-)/.test(poi.id) && Number.isFinite(poi.lat) && Number.isFinite(poi.lon);
      lod2Preview.hidden = !hasLocation;
      if (hasLocation) lod2Preview.href = './3d.html#' + encodeURIComponent(poi.id);
      lod2Preview.textContent = 'In der 3D-Ansicht öffnen';
    }
    setChip(category, poi.category);
    setChip(area, poi.area);
    subtitle.textContent = poi.subtitle ?? '';
    subtitle.hidden = !poi.subtitle;

    let collected = false;
    try {
      collected = Boolean(isCollected(poi.id));
    } catch {
      collected = false;
    }
    atlasStatus.hidden = !collected;
    collectButton.hidden = collected;

    renderPhotos(poi);
    renderDescription(poi);
    renderFacts(poi);
    renderLinks(poi);
    renderSources(poi);

    const hasCoordinates = Number.isFinite(poi.lat) && Number.isFinite(poi.lon);
    coordinates.textContent = hasCoordinates
      ? `${poi.lat.toFixed(5)}° N · ${poi.lon.toFixed(5)}° E`
      : '';
    coordinates.hidden = !hasCoordinates;

    error.textContent = '';
    error.hidden = true;
    dialog.scrollTop = 0;
    dialog.showModal();

    const pageId = /^wikipedia-de-(\d+)$/.exec(poi.id)?.[1];
    const article = poi.wikipediaArticle;
    if (!pageId && !article) return;
    const key = pageId ? 'id:' + pageId : 'title:' + article;
    if (!articles.has(key)) {
      if (articles.size >= 64) articles.delete(articles.keys().next().value);
      const request = loadWikipediaDetails(pageId, article).catch(() => null);
      articles.set(key, request);
      request.then(page => {
        if (!page && articles.get(key) === request) articles.delete(key);
      });
    }
    articles.get(key).then(async page => {
      if (!page || page.missing || selected !== poi || !dialog.open) return;
      const articleUrl = 'https://de.wikipedia.org/?curid=' + page.pageid;
      const links = [...(poi.links ?? [{label: 'Wikipedia', href: articleUrl}])];
      const entity = page.pageprops?.wikibase_item;
      if (/^Q\d+$/.test(entity) && !links.some(link => link.href.endsWith('/' + entity))) {
        links.push({label: 'Wikidata', href: 'https://www.wikidata.org/wiki/' + entity});
      }
      renderLinks({...poi, links});
      if (page.extract) renderDescription({
        description: page.extract,
        descriptionCredit: 'Auszug aus Wikipedia · CC BY-SA',
        descriptionSource: articleUrl,
      });
      if (poi.photos?.some(photo => photo?.url) || !page.thumbnail?.source || !page.pageimage) return;
      const photo = await loadWikipediaPhoto(page, poi.name).catch(() => null);
      if (photo && selected === poi && dialog.open) renderPhotos({...poi, photos: [photo]});
    });
  };
}
