// Listing Finder: finds your photo with Google Lens (eBay AU pages, Facebook), then searches
// eBay AU's current listings by the item's name, ranking each result by how closely its
// photo matches yours. All network calls go through server.py.

const $ = (id) => document.getElementById(id);
const fileInput = $('file'), drop = $('drop'), preview = $('preview'), statusEl = $('status');
const resultsEl = $('results'), queryEl = $('query');

let runId = 0;
let mine = null;          // fingerprint of the current photo
let lensGroups = null;    // Lens results for the current photo, reused by "Search again"
let setup = { serpapi: false };
let lastGroups = null;    // results currently shown, re-rendered when the postcode changes

// ---------- input ----------
fileInput.addEventListener('change', () => fileInput.files[0] && runImage(fileInput.files[0]));
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault(); drop.classList.remove('over');
  const f = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
  if (f) runImage(f);
});
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
document.addEventListener('paste', (e) => {
  if (e.target === queryEl) return;
  const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'));
  if (item) runImage(item.getAsFile());
});
queryEl.addEventListener('input', updateLinks);

// Marketplace city, remembered between visits
const cityEl = $('city');
try { cityEl.value = localStorage.getItem('city') || 'sydney'; } catch { cityEl.value = 'sydney'; }
cityEl.addEventListener('change', () => { try { localStorage.setItem('city', cityEl.value); } catch {} updateLinks(); });

// Optional postcode: Marketplace links can't take a postcode, so it's turned into the
// nearest city Facebook has a Marketplace page for. Overrides the city list while set.
const MARKET_CITIES = [
  ['sydney', 'Sydney', -33.87, 151.21], ['melbourne', 'Melbourne', -37.81, 144.96],
  ['brisbane', 'Brisbane', -27.47, 153.03], ['perth', 'Perth', -31.95, 115.86],
  ['adelaide', 'Adelaide', -34.93, 138.6], ['canberra', 'Canberra', -35.28, 149.13],
  ['hobart', 'Hobart', -42.88, 147.33], ['darwin', 'Darwin', -12.46, 130.84],
  ['goldcoast', 'Gold Coast', -28.02, 153.4], ['newcastle', 'Newcastle', -32.93, 151.78],
  ['wollongong', 'Wollongong', -34.42, 150.89], ['geelong', 'Geelong', -38.15, 144.36],
  ['townsville', 'Townsville', -19.26, 146.82], ['cairns', 'Cairns', -16.92, 145.77],
  ['toowoomba', 'Toowoomba', -27.56, 151.95], ['ballarat', 'Ballarat', -37.56, 143.85],
  ['bendigo', 'Bendigo', -36.76, 144.28], ['launceston', 'Launceston', -41.43, 147.14],
];
const postcodeEl = $('postcode'), pcInfo = $('pcInfo');
let pcCity = null; // [slug, name] nearest to the entered postcode

function nearestCity(lat, lon) {
  const rad = Math.PI / 180;
  const km = ([, , la, lo]) => {
    const a = Math.sin((la - lat) * rad / 2) ** 2 + Math.cos(lat * rad) * Math.cos(la * rad) * Math.sin((lo - lon) * rad / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
  };
  return MARKET_CITIES.map((c) => [c, km(c)]).sort((a, b) => a[1] - b[1])[0];
}

async function applyPostcode() {
  const pc = postcodeEl.value.trim();
  try { localStorage.setItem('postcode', pc); } catch {}
  pcCity = null;
  cityEl.disabled = false;
  pcInfo.hidden = !pc;
  if (pc && !/^\d{4}$/.test(pc)) { pcInfo.textContent = 'Enter a 4-digit postcode.'; updateLinks(); return; }
  if (pc) {
    pcInfo.textContent = `Looking up ${pc}…`;
    try {
      const p = await api(`api/postcode?pc=${pc}`);
      if (postcodeEl.value.trim() !== pc) return;
      const [[slug, name], dist] = nearestCity(p.lat, p.lon);
      pcCity = [slug, name];
      cityEl.disabled = true;
      const where = [p.place, p.state].filter(Boolean).join(', ') || `postcode ${pc}`;
      pcInfo.textContent = `${where} ${pc}: Marketplace will search around ${name}` +
        (dist > 60 ? ` (nearest Marketplace city, ${Math.round(dist)} km away; you can narrow the area on Facebook)` : '') + '.';
    } catch (e) {
      pcInfo.textContent = e.message;
    }
  }
  updateLinks();
  if (lastGroups) render(withExactOnTop(lastGroups)); // refresh "Search Marketplace" links on cards
}
let pcTimer;
postcodeEl.addEventListener('input', () => { clearTimeout(pcTimer); pcTimer = setTimeout(applyPostcode, 500); });
try { postcodeEl.value = localStorage.getItem('postcode') || ''; } catch {}
if (postcodeEl.value) applyPostcode();
$('nameForm').addEventListener('submit', (e) => { e.preventDefault(); runName(); });

// ---------- setup check ----------
fetch('api/status').then((r) => r.json()).then((s) => {
  setup = s;
  if (!s.serpapi) {
    $('setup').innerHTML = '<p><strong>No SerpApi key:</strong> searching is off. Add <code>serpApiKey</code> to <code>config.json</code> and restart (see README). The site buttons below still work.</p>';
    $('setup').hidden = false;
  }
}).catch(() => {
  $('setup').innerHTML = '<p><strong>Server not running.</strong> Start it with <code>python server.py</code> and open <code>http://localhost:8765</code>.</p>';
  $('setup').hidden = false;
});
updateLinks();

// ---------- image helpers ----------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// JPEG base64 (no data: prefix) under SerpApi's 500 KB upload limit
function toJpegBase64(img) {
  for (const [size, quality] of [[1000, 0.88], [800, 0.85], [640, 0.8], [480, 0.75]]) {
    const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const b64 = c.toDataURL('image/jpeg', quality).split(',')[1];
    if (b64.length * 0.75 < 480 * 1024) return b64;
  }
  throw new Error('Image too large');
}

// Fingerprint = difference hash (brightness gradients on a 9x8 grid, 64 bits)
// plus average colour on a 4x4 grid. Robust to resizing and recompression.
function fingerprint(img) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const draw = (w, h) => { c.width = w; c.height = h; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h); };
  c.width = 9; c.height = 8;
  ctx.drawImage(img, 0, 0, 9, 8);
  const d = ctx.getImageData(0, 0, 9, 8).data;
  const gray = (x, y) => { const i = (y * 9 + x) * 4; return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; };
  const bits = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(gray(x, y) > gray(x + 1, y) ? 1 : 0);
  c.width = 4; c.height = 4;
  ctx.drawImage(img, 0, 0, 4, 4);
  const colour = [...ctx.getImageData(0, 0, 4, 4).data].filter((_, i) => i % 4 !== 3);

  // Detail for the strict "identical photo" check: 24x24 brightness (normalised so overall
  // brightness/contrast changes don't matter) and 8x8 colour
  draw(24, 24);
  const g = ctx.getImageData(0, 0, 24, 24).data;
  const fine = [];
  for (let i = 0; i < g.length; i += 4) fine.push(g[i] * 0.299 + g[i + 1] * 0.587 + g[i + 2] * 0.114);
  const mean = fine.reduce((s, v) => s + v, 0) / fine.length;
  const sd = Math.sqrt(fine.reduce((s, v) => s + (v - mean) ** 2, 0) / fine.length) || 1;
  draw(8, 8);
  const colour8 = [...ctx.getImageData(0, 0, 8, 8).data].filter((_, i) => i % 4 !== 3);
  return {
    bits, colour, colour8,
    fine: fine.map((v) => (v - mean) / sd),
    aspect: img.naturalWidth / img.naturalHeight,
  };
}

// Strict check: is this the very same photo (same background, framing and colours), just
// resized or recompressed? Different photos of the same item fail this.
function identicalPhoto(a, b) {
  if (Math.abs(Math.log(a.aspect / b.aspect)) > 0.06) return false;   // different shape/crop
  let corr = 0;
  for (let i = 0; i < a.fine.length; i++) corr += a.fine[i] * b.fine[i];
  corr /= a.fine.length;                                                // 1 = identical layout
  let cd = 0;
  for (let i = 0; i < a.colour8.length; i++) cd += Math.abs(a.colour8[i] - b.colour8[i]);
  cd /= a.colour8.length;                                               // average colour gap 0..255
  return corr >= IDENTICAL_CORR && cd <= IDENTICAL_COLOUR;
}
// Measured on eBay photos: the same photo at other sizes/qualities scored 0.94-0.99 layout and
// colour gaps up to ~15; different photos of the same card scored at most 0.6 and gaps of 50+.
const IDENTICAL_CORR = 0.9, IDENTICAL_COLOUR = 25;

// 0..100, higher = more alike
function similarity(a, b) {
  let diff = 0;
  for (let i = 0; i < 64; i++) diff += a.bits[i] !== b.bits[i];
  let cd = 0;
  for (let i = 0; i < a.colour.length; i++) cd += Math.abs(a.colour[i] - b.colour[i]);
  const shape = 1 - diff / 32;                       // 32+ differing bits = unrelated
  const colour = 1 - cd / a.colour.length / 80;      // average channel gap of 80 = unrelated
  return Math.round(100 * Math.max(0, Math.min(1, 0.7 * shape + 0.3 * colour)));
}

// ---------- helpers ----------
async function api(url, image) {
  const opts = image ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) } : {};
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const getItems = (path, q) => api(`api/${path}?q=${encodeURIComponent(q)}`).then((j) => j.items);

// Thumbnails load through server.py, so browser blockers or hotlink rules can't stop them.
// eBay images are asked for at 225px (s-l225) instead of 500px to load faster.
const proxied = (url) => 'api/img?url=' + encodeURIComponent(url.replace(/(ebayimg\.com\/.*\/s-l)\d+(\.\w+)$/, '$1225$2'));

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
function ebayId(url) { const m = /\/itm\/(?:[^/?]+\/)?(\d{9,15})/.exec(url || ''); return m && m[1]; }

function words(title) {
  return (title || '')
    .replace(/(\.\.\.|…)\s*$/, '')
    .replace(/\b(free (post|postage|shipping)|fast post|aus seller|au stock|brand new|bnib|look|wow|rare|for sale)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}/#\- ]+/gu, ' ').split(/\s+/)
    .filter((w) => w && w !== '-' && !/^(the|a|an|and|of|for|with|in|on|to|my|your|is)$/i.test(w));
}

// Item name for the searches: the words most match titles agree on, in the order they
// appear in the best titles. Falls back to the best title itself.
function guessName(titles) {
  titles = titles.filter(Boolean).slice(0, 15);
  if (!titles.length) return '';
  const df = new Map();
  for (const t of titles) for (const w of new Set(words(t).map((w) => w.toLowerCase()))) df.set(w, (df.get(w) || 0) + 1);
  const need = Math.max(2, Math.ceil(titles.length * 0.3));
  const seen = new Set(), picked = [];
  for (const t of titles) for (const w of words(t)) {
    const k = w.toLowerCase();
    if (df.get(k) >= need && !seen.has(k)) { seen.add(k); picked.push(w); }
  }
  return (picked.length >= 2 ? picked : words(titles[0])).slice(0, 8).join(' ');
}

function updateLinks() {
  const q = encodeURIComponent(queryEl.value.trim());
  // LH_PrefLoc=1: items located in Australia only
  $('lnkSold').href = `https://www.ebay.com.au/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1&LH_PrefLoc=1`;
  $('lnkActive').href = `https://www.ebay.com.au/sch/i.html?_nkw=${q}&LH_PrefLoc=1`;
  $('lnkMarket').href = marketplaceUrl(queryEl.value.trim());
}

// ---------- photo search ----------
async function runImage(file) {
  const id = ++runId;
  resultsEl.innerHTML = '';
  const src = URL.createObjectURL(file);
  preview.src = src; preview.hidden = false;
  $('dropText').innerHTML = '<strong>Searching this photo.</strong> Drop or paste another to start over.';

  const img = await loadImage(src);
  mine = fingerprint(img);
  lensGroups = { ebay: [], facebook: [], other: [], overseas: [], error: '' };

  if (setup.serpapi) {
    statusEl.textContent = 'Identifying the photo with Google Lens…';
    try {
      const lens = await api('api/lens', toJpegBase64(img));
      if (id !== runId) return;
      sortLens(lens);
    } catch (e) {
      lensGroups.error = e.message;
    }
  } else {
    lensGroups.error = 'SerpApi key not set';
  }

  // Name for the by-name searches: prefer eBay titles, which describe the item well
  const all = [...lensGroups.ebay, ...lensGroups.other, ...lensGroups.overseas, ...lensGroups.facebook];
  queryEl.value = guessName([...all.filter((m) => m.exact), ...all.filter((m) => !m.exact)].map((m) => m.title));
  updateLinks();
  if (!queryEl.value) {
    statusEl.textContent = lensGroups.error
      ? `Photo search unavailable (${lensGroups.error}). Type the item's name above and press Search.`
      : 'Google Lens didn\'t recognise this photo. Type the item\'s name above and press Search.';
    render(buildGroups({}));
    queryEl.focus();
    return;
  }
  await runName(id);
}

// What a Facebook link says about where the image was posted. Google Lens only gives the
// link and title, so this is read from the link: the page or group name when it's in there.
function describeFacebook(url) {
  let path;
  try { path = decodeURIComponent(new URL(url).pathname); } catch { return { meta: 'Facebook post', fb: 'post' }; }
  const seg = path.split('/').filter(Boolean);
  const pretty = (s) => s.replace(/[-_.]+/g, ' ').trim();
  if (seg[0] === 'marketplace' && seg[1] === 'item') return { meta: 'Marketplace listing', fb: 'marketplace' };
  if (seg[0] === 'groups' && seg[1]) {
    return { meta: /^\d+$/.test(seg[1]) ? 'Posted in a Facebook group' : `Posted in group: ${pretty(seg[1])}`, fb: 'group' };
  }
  if (seg[0] === 'people' && seg[1]) return { meta: `Posted by: ${pretty(seg[1])}`, fb: 'post' };
  const generic = ['photo', 'photo.php', 'permalink.php', 'story.php', 'watch', 'reel', 'share', 'profile.php', 'media', 'events', 'p'];
  if (seg[0] && !generic.includes(seg[0]) && !/^\d+$/.test(seg[0])) return { meta: `Posted by: ${pretty(seg[0])}`, fb: 'post' };
  return { meta: 'Facebook post', fb: 'post' };
}

function marketplaceUrl(text) {
  const city = pcCity ? pcCity[0] : cityEl.value;
  return `https://www.facebook.com/marketplace/${city ? city + '/' : ''}search/?query=${encodeURIComponent(text)}`;
}

function sortLens(lens) {
  const seen = new Set();
  const exact = new Set((lens.exact_matches || []).map((m) => m.link));
  for (const m of [...(lens.exact_matches || []), ...(lens.visual_matches || [])]) {
    if (!m.link || seen.has(m.link)) continue;
    seen.add(m.link);
    const host = hostOf(m.link);
    const item = {
      title: m.title, url: m.link, price: m.price?.value || '', thumb: m.thumbnail || m.image,
      meta: m.source || host, exact: exact.has(m.link), via: 'Google Lens',
    };
    if (host.endsWith('ebay.com.au')) lensGroups.ebay.push(item);
    else if (host.endsWith('facebook.com') || host === 'fb.com') {
      Object.assign(item, describeFacebook(m.link));
      lensGroups.facebook.push(item);
    } else if (/\.au$/.test(host)) lensGroups.other.push(item);
    else lensGroups.overseas.push(item); // not shown, but helps work out the item's name
  }
}

// ---------- name search (also used by "Search") ----------
async function runName(id = ++runId) {
  const q = queryEl.value.trim();
  if (!q) { queryEl.focus(); return; }
  statusEl.textContent = `Searching eBay AU for "${q}"…`;

  const [active] = await Promise.allSettled([
    setup.serpapi ? getItems('ebay', q) : Promise.reject(new Error('SerpApi key not set')),
  ]);
  if (id !== runId) return;

  const groups = buildGroups(active);
  const total = Object.values(groups).reduce((n, g) => n + g.items.length, 0);
  lastGroups = groups;
  render(withExactOnTop(groups));
  if (mine && total) {
    statusEl.textContent = `Found ${total} results. Comparing photos…`;
    await scoreAll(groups, id);
    if (id !== runId) return;
    render(withExactOnTop(groups));
    statusEl.textContent = `Found ${total} results, closest photos first.`;
  } else {
    statusEl.textContent = total ? `Found ${total} results.` : 'Nothing found. Try a shorter or different name.';
  }
}

function buildGroups(active) {
  const lg = lensGroups || { ebay: [], facebook: [], other: [], error: '' };
  const activeItems = active?.status === 'fulfilled' ? active.value : [];
  const activeIds = new Set(activeItems.map((it) => ebayId(it.url)).filter(Boolean));
  // eBay pages showing your photo that aren't current listings have mostly sold or ended
  const lensEbay = lg.ebay.filter((it) => !activeIds.has(ebayId(it.url)));
  const exactIds = new Set(lg.ebay.filter((it) => it.exact).map((it) => ebayId(it.url)));
  for (const it of activeItems) if (exactIds.has(ebayId(it.url))) it.exact = true;
  const fb = [...lg.facebook].sort((a, b) => (b.fb === 'marketplace') - (a.fb === 'marketplace'));

  return {
    active: { title: 'eBay AU: for sale now', items: activeItems, error: active?.status === 'rejected' ? active.reason.message : '' },
    sold: { title: 'eBay AU: sold or ended', note: 'eBay AU pages showing this image that aren\'t current listings, so most have sold or ended. For full sold history use the "eBay AU sold" button above.', items: lensEbay, error: lg.error },
    facebook: { title: 'Facebook & Marketplace', note: 'Pages Google has found. Marketplace needs a login, so use the "Facebook Marketplace" button above for live listings.', items: fb, error: lg.error },
    other: { title: 'Other Australian sites', items: lg.other, collapsed: true, hideEmpty: true },
  };
}

// Results that are the identical photo (passed identicalPhoto) move to a section at the very
// top: listings for sale first, then sold, Marketplace, other posts.
const SAME_PHOTO = 80;
const isExact = (it) => !!it.identical;

function withExactOnTop(groups) {
  const label = { active: 'eBay AU · for sale', sold: 'eBay AU · sold/ended', facebook: 'Facebook', other: 'Other site' };
  const rank = (key, it) => (key === 'facebook' ? (it.fb === 'marketplace' ? 2 : 3) : { active: 0, sold: 1, other: 4 }[key]);
  const top = [];
  const rest = {};
  for (const [key, g] of Object.entries(groups)) {
    rest[key] = { ...g, items: g.items.filter((it) => !isExact(it)) };
    for (const it of g.items.filter(isExact)) {
      const where = key === 'facebook' && it.fb === 'marketplace' ? 'Facebook Marketplace' : label[key];
      const meta = it.meta && it.fb !== 'marketplace' ? `${where} · ${it.meta}` : where;
      top.push({ ...it, meta, rank: rank(key, it) });
    }
  }
  top.sort((a, b) => (a.rank - b.rank) || ((b.score ?? 0) - (a.score ?? 0)));
  if (!top.length) return rest;
  return { exact: { title: '★ Exact same photo found', note: 'The identical picture, background and all.', items: top, highlight: true }, ...rest };
}

async function scoreAll(groups, id) {
  const items = Object.values(groups).flatMap((g) => g.items).filter((it) => it.thumb && it.score == null);
  let next = 0;
  const worker = async () => {
    while (next < items.length && id === runId) {
      const it = items[next++];
      try {
        const img = await loadImage(proxied(it.thumb));
        const fp = fingerprint(img);
        it.score = similarity(mine, fp);
        it.identical = identicalPhoto(mine, fp);
      } catch { /* thumbnail unavailable: leave unscored */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  for (const g of Object.values(groups)) {
    g.items.sort((a, b) => (!!b.identical - !!a.identical) || (!!b.exact - !!a.exact) || ((b.score ?? -1) - (a.score ?? -1)));
  }
}

// ---------- render ----------
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function badges(it) {
  const b = [];
  if (it.exact) b.push('<span class="badge same">Google: exact match</span>');
  if (it.identical) b.push('<span class="badge same">Identical photo</span>');
  else if (it.score != null) {
    if (it.score >= SAME_PHOTO) b.push(`<span class="badge close">Very similar ${it.score}%</span>`);
    else b.push(`<span class="badge">Similar ${it.score}%</span>`);
  }
  return b.join('');
}

// Facebook cards have two links: the post itself (which shows who posted it) and a
// Marketplace search for the item in the chosen city
function facebookCard(it) {
  const name = words(it.title).slice(0, 6).join(' ') || queryEl.value.trim();
  const open = it.fb === 'marketplace' ? 'Open listing' : 'Open post (see who posted)';
  return `
    <div class="item">
      <a class="thumb" href="${esc(it.url)}" target="_blank" rel="noopener">${it.thumb ? `<img src="${esc(proxied(it.thumb))}" alt="" loading="lazy">` : ''}</a>
      <div class="body">
        <div class="badges">${badges(it)}</div>
        <div class="title">${esc(it.title)}</div>
        <div class="meta">${esc(it.meta)}</div>
        <div class="actions">
          <a href="${esc(it.url)}" target="_blank" rel="noopener">${open}</a>
          ${it.fb === 'marketplace' ? '' : `<a href="${esc(marketplaceUrl(name))}" target="_blank" rel="noopener">Search Marketplace</a>`}
        </div>
      </div>
    </div>`;
}

function render(groups) {
  resultsEl.innerHTML = Object.values(groups).map((g) => {
    if (g.hideEmpty && !g.items.length) return '';
    const body = g.items.length
      ? `<div class="grid">${g.items.map((it) => it.fb ? facebookCard(it) : `
          <a class="item" href="${esc(it.url)}" target="_blank" rel="noopener">
            <div class="thumb">${it.thumb ? `<img src="${esc(proxied(it.thumb))}" alt="" loading="lazy">` : ''}</div>
            <div class="body">
              <div class="badges">${badges(it)}</div>
              <div class="title">${esc(it.title)}</div>
              ${it.price ? `<div class="price">${esc(it.price)}</div>` : ''}
              ${it.meta ? `<div class="meta">${esc(it.meta)}</div>` : ''}
            </div>
          </a>`).join('')}</div>`
      : `<p class="empty">${g.error ? `<span class="err">Not searched: ${esc(g.error)}</span>` : 'Nothing found here.'}</p>`;
    return `<details class="group${g.highlight ? ' top' : ''}" ${g.collapsed ? '' : 'open'}>
      <summary>${esc(g.title)} <span class="count">(${g.items.length})</span></summary>
      ${g.note && g.items.length ? `<p class="hint">${esc(g.note)}</p>` : ''}
      ${body}
    </details>`;
  }).join('');
}
