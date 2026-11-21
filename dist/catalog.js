'use strict';

const catalogCountries = [...WORLD.countries].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
const catalogById = new Map(catalogCountries.map(country => [country.id, country]));
let catalogSelection = null;
let gameScroll = 0;
let catalogVisible = false;

function flagImage(country) {
  return element('img', null, { src: country.flag, alt: '', loading: 'lazy', decoding: 'async' });
}

function renderCatalogResults() {
  const query = normalize($('catalog-search').value);
  const selectedRegion = $('catalog-region').value;
  const results = catalogCountries.filter(country => {
    return (selectedRegion === 'World' || country.region === selectedRegion)
      && [country.name, ...country.capitals].some(name => normalize(name).includes(query));
  });
  const entries = results.map(country => {
    const item = element('li');
    const link = element('a', null, { href: '#catalog/' + country.id });
    link.dataset.country = country.id;
    link.append(flagImage(country), element('span', country.name));
    if (country.id === catalogSelection) link.setAttribute('aria-current', 'true');
    link.addEventListener('click', () => {
      if (country.id === catalogSelection) focusCatalogProfile();
    });
    item.append(link);
    return item;
  });
  $('catalog-results').replaceChildren(...entries);
  $('catalog-match').textContent = results.length ? 'Найдено: ' + formatNumber.format(results.length) : 'Ничего не найдено';
}

function galleryFor(country) {
  const photos = COUNTRY_PHOTOS[country.id];
  if (!photos?.length) return null;
  const section = element('section', null, { className: 'card country-gallery' });
  const grid = element('div', null, { className: 'photo-grid' });
  for (const photo of photos) {
    const figure = element('figure', null, { className: 'photo-tile' });
    const img = element('img', null, { alt: photo.label, loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer' });
    const caption = element('figcaption');
    const title = element('strong', photo.label);
    const credits = element('span', null, { className: 'photo-credit' });
    if (photo.author) credits.append(element('span', photo.author + ' · '));
    credits.append(sourceLink('Wikimedia Commons', photo.url));
    credits.append(' · ', photo.licenseUrl ? sourceLink(photo.license, photo.licenseUrl) : element('span', photo.license));
    caption.append(title, credits);
    img.addEventListener('error', () => {
      if (photo.fallback && !img.dataset.fallback) {
        img.dataset.fallback = 'true';
        img.removeAttribute('srcset');
        img.src = photo.fallback;
      } else if (photo.preview && img.dataset.fallback !== 'preview') {
        img.dataset.fallback = 'preview';
        img.removeAttribute('srcset');
        img.src = photo.preview;
      } else {
        img.replaceWith(sourceLink('Открыть фото на Wikimedia Commons', photo.url));
      }
    });
    img.src = photo.src;
    if (photo.preview && photo.width > 500) {
      img.srcset = photo.preview + ' 500w, ' + photo.src + ' ' + photo.width + 'w';
      img.sizes = photos.length === 1 ? '(max-width: 690px) 92vw, 960px' : '(max-width: 690px) 85vw, 400px';
    }
    figure.append(img, caption);
    grid.append(figure);
  }
  section.append(element('h3', 'Города и места'), grid);
  return section;
}

function renderCatalogCountry(country) {
  const intro = element('section', null, { className: 'catalog-country-head card' });
  const name = element('h2', country.name, { id: 'catalog-country-name', tabIndex: -1 });
  const subtitle = element('p', regions[country.region].name + ' · Столица — ' + country.capitals[0]);
  const titles = element('div');
  titles.append(name, subtitle);
  intro.append(flagImage(country), titles);
  const body = element('section', null, { className: 'card catalog-details' });
  body.append(countryCard(COUNTRY_INFO.profiles[country.id]));
  $('catalog-profile').replaceChildren(intro, body);
  const gallery = galleryFor(country);
  if (gallery) $('catalog-profile').append(gallery);
}

function focusCatalogProfile() {
  const title = $('catalog-country-name');
  title.focus({ preventScroll: true });
  if (matchMedia('(max-width: 690px)').matches) title.scrollIntoView({ block: 'start' });
}

function updatePage() {
  const [page, code] = location.hash.slice(1).split('/');
  const showCatalog = page === 'catalog';
  if (showCatalog && !catalogVisible) gameScroll = window.scrollY;
  $('game-page').hidden = showCatalog;
  $('catalog-page').hidden = !showCatalog;
  if (showCatalog) {
    $('catalog-link').setAttribute('aria-current', 'page');
    $('game-link').removeAttribute('aria-current');
    const selection = catalogById.get(code) || catalogById.get(catalogSelection) || catalogById.get('JP');
    const changed = selection.id !== catalogSelection;
    catalogSelection = selection.id;
    if (changed) {
      renderCatalogResults();
      renderCatalogCountry(selection);
    }
    if (!catalogVisible) {
      window.scrollTo(0, 0);
    }
    if (changed && code) focusCatalogProfile();
  } else {
    $('game-link').setAttribute('aria-current', 'page');
    $('catalog-link').removeAttribute('aria-current');
    if (catalogVisible) {
      window.scrollTo(0, gameScroll);
      resize();
    }
  }
  catalogVisible = showCatalog;
}

$('catalog-search').addEventListener('input', renderCatalogResults);
$('catalog-region').addEventListener('change', renderCatalogResults);
window.addEventListener('hashchange', updatePage);
updatePage();
