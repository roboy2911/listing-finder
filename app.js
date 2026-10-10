// Listing Finder: sends the image to eBay's image search and Google Lens (through serve.ps1),
// sorts what comes back into eBay AU for sale / eBay AU sold / Facebook, and ranks each
// result by how closely its photo matches yours.

const $ = (id) => document.getElementById(id);
const fileInput = $('file'), drop = $('drop'), preview = $('preview'), statusEl = $('status');
const resultsEl = $('results'), queryEl = $('query');

let runId = 0;

// ---------- input ----------
fileInput.addEventListener('change', () => fileInput.files[0] && run(fileInput.files[0]));
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault(); drop.classList.remove('over');
  const f = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
  if (f) run(f);
});
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
document.addEventListener('paste', (e) => {
  const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'));
  if (item) run(item.getAsFile());
});
queryEl.addEventListener('input', updateLinks);

// ---------- setup check ----------
fetch('api/status').then((r) => r.json()).then((s) => {
  const missing = [];
  if (!s.ebay) missing.push('eBay (<code>ebayClientId</code> / <code>ebayClientSecret</code>): finds current eBay AU listings');
  if (!s.lens) missing.push('Google Lens (<code>serpApiKey</code> + <code>imgbbApiKey</code>): finds sold eBay listings and Facebook posts');
  if (missing.length) {
    $('setup').innerHTML = `<strong>Some searches are off.</strong> Add keys to <code>config.json</code> (see README), then restart serve.ps1:<ul>${missing.map((m) => `<li>${m}</li>`).join('')}</ul>`;
    $('setup').hidden = false;
  }
}).catch(() => {
  $('setup').innerHTML = '<strong>Server not running.</strong> Start it with <code>powershell -ExecutionPolicy Bypass -File serve.ps1</code> and open <code>http://localhost:8765</code>.';
  $('setup').hidden = false;
});

// ---------- image helpers ----------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Shrink to at most 1000px and return base64 JPEG (no data: prefix)
function toJpegBase64(img) {
  const scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
}

// Fingerprint = difference hash (brightness gradients on a 9x8 grid, 64 bits)
// plus average colour on a 4x4 grid. Robust to resizing and recompression.
function fingerprint(img) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  c.width = 9; c.height = 8;
  ctx.drawImage(img, 0, 0, 9, 8);
  const d = ctx.getImageData(0, 0, 9, 8).data;
  const gray = (x, y) => { const i = (y * 9 + x) * 4; return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; };
  const bits = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(gray(x, y) > gray(x + 1, y) ? 1 : 0);
  c.width = 4; c.height = 4;
  ctx.drawImage(img, 0, 0, 4, 4);
  const colour = [...ctx.getImageData(0, 0, 4, 4).data].filter((_, i) => i % 4 !== 3);
  return { bits, colour };
}

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

// ---------- search ----------
async function post(url, image) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
function ebayId(url) { const m = /\/itm\/(?:[^/?]+\/)?(\d{9,15})/.exec(url || ''); return m && m[1]; }
function money(p) {
  if (!p) return '';
  if (p.value && p.currency) return `${p.currency === 'AUD' ? 'AU $' : p.currency + ' '}${Number(p.value).toFixed(2)}`;
  return p.value || '';
}

async function run(file) {
  const id = ++runId;
  resultsEl.innerHTML = '';
  const src = URL.createObjectURL(file);
  preview.src = src; preview.hidden = false;
  $('dropText').innerHTML = '<strong>Searching this image.</strong> Drop or paste another to start over.';
  statusEl.textContent = 'Searching eBay and Google Lens…';

  const img = await loadImage(src);
  const b64 = toJpegBase64(img);
  const mine = fingerprint(img);

  const [ebay, lens] = await Promise.allSettled([post('api/ebay', b64), post('api/lens', b64)]);
  if (id !== runId) return;

  const groups = {
    active: { title: 'eBay AU: for sale now', items: [], error: ebay.status === 'rejected' ? ebay.reason.message : '' },
    sold: { title: 'eBay AU: sold or ended', note: 'eBay AU pages Google found that aren\'t in the current listings, so most have sold or ended. Open to check.', items: [], error: lens.status === 'rejected' ? lens.reason.message : '' },
    facebook: { title: 'Facebook & Marketplace', items: [], error: lens.status === 'rejected' ? lens.reason.message : '' },
    other: { title: 'Other sites', items: [], collapsed: true },
  };

  const activeIds = new Set();
  if (ebay.status === 'fulfilled') {
    for (const it of ebay.value.itemSummaries || []) {
      const id = ebayId(it.itemWebUrl) || it.legacyItemId;
      if (id) activeIds.add(String(id));
      groups.active.items.push({
        title: it.title, url: it.itemWebUrl, price: money(it.price),
        thumb: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl,
        meta: [it.condition, it.itemLocation?.city || it.itemLocation?.country].filter(Boolean).join(' · '),
      });
    }
  }

  if (lens.status === 'fulfilled') {
    const seen = new Set();
    const exact = new Set((lens.value.exact_matches || []).map((m) => m.link));
    const all = [...(lens.value.exact_matches || []), ...(lens.value.visual_matches || [])];
    for (const m of all) {
      if (!m.link || seen.has(m.link)) continue;
      seen.add(m.link);
      const host = hostOf(m.link);
      const item = {
        title: m.title, url: m.link, price: m.price?.value || '', thumb: m.thumbnail || m.image,
        meta: m.source || host, exact: exact.has(m.link),
      };
      if (host.endsWith('ebay.com.au')) {
        const eid = ebayId(m.link);
        if (eid && activeIds.has(eid)) continue; // already shown under "for sale"
        groups.sold.items.push(item);
      } else if (host.endsWith('facebook.com') || host === 'fb.com') {
        if (m.link.includes('/marketplace/')) item.meta = 'Marketplace';
        groups.facebook.items.push(item);
      } else {
        groups.other.items.push(item);
      }
    }
  }

  // Name suggestion for the manual search links
  const best = groups.active.items[0]?.title || groups.sold.items[0]?.title || groups.other.items[0]?.title || '';
  queryEl.value = cleanQuery(best);
  $('links').hidden = false;
  updateLinks();

  const total = Object.values(groups).reduce((n, g) => n + g.items.length, 0);
  statusEl.textContent = total ? `Found ${total} results. Comparing photos…` : 'No matches found. Try the name search below, or a clearer/cropped photo.';
  render(groups);

  await scoreAll(groups, mine, id);
  if (id !== runId) return;
  render(groups);
  statusEl.textContent = total ? `Found ${total} results, closest photos first.` : statusEl.textContent;
}

async function scoreAll(groups, mine, id) {
  const items = Object.values(groups).flatMap((g) => g.items).filter((it) => it.thumb);
  let next = 0;
  const worker = async () => {
    while (next < items.length && id === runId) {
      const it = items[next++];
      try {
        const img = await loadImage('api/img?url=' + encodeURIComponent(it.thumb));
        it.score = similarity(mine, fingerprint(img));
      } catch { /* thumbnail unavailable: leave unscored */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  for (const g of Object.values(groups)) {
    g.items.sort((a, b) => (b.exact - a.exact) || ((b.score ?? -1) - (a.score ?? -1)));
  }
}

function cleanQuery(title) {
  return title.replace(/[^\p{L}\p{N}/#.\- ]+/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 9).join(' ');
}

function updateLinks() {
  const q = encodeURIComponent(queryEl.value.trim());
  $('lnkSold').href = `https://www.ebay.com.au/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1`;
  $('lnkActive').href = `https://www.ebay.com.au/sch/i.html?_nkw=${q}`;
  $('lnkMarket').href = `https://www.facebook.com/marketplace/search/?query=${q}`;
}

// ---------- render ----------
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function badges(it) {
  const b = [];
  if (it.exact) b.push('<span class="badge same">Google: exact match</span>');
  if (it.score != null) {
    if (it.score >= 88) b.push(`<span class="badge same">Same photo ${it.score}%</span>`);
    else if (it.score >= 72) b.push(`<span class="badge close">Very similar ${it.score}%</span>`);
    else b.push(`<span class="badge">Similar ${it.score}%</span>`);
  }
  return b.join('');
}

function render(groups) {
  resultsEl.innerHTML = Object.values(groups).map((g) => {
    if (g === groups.other && !g.items.length) return '';
    const body = g.items.length
      ? `<div class="grid">${g.items.map((it) => `
          <a class="item" href="${esc(it.url)}" target="_blank" rel="noopener">
            <div class="thumb">${it.thumb ? `<img src="${esc(it.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</div>
            <div class="body">
              <div class="badges">${badges(it)}</div>
              <div class="title">${esc(it.title)}</div>
              ${it.price ? `<div class="price">${esc(it.price)}</div>` : ''}
              ${it.meta ? `<div class="meta">${esc(it.meta)}</div>` : ''}
            </div>
          </a>`).join('')}</div>`
      : `<p class="empty">${g.error ? `<span class="err">Not searched: ${esc(g.error)}</span>` : 'Nothing found here.'}</p>`;
    return `<details class="group" ${g.collapsed ? '' : 'open'}>
      <summary>${esc(g.title)} <span class="count">(${g.items.length})</span></summary>
      ${g.note && g.items.length ? `<p class="hint">${esc(g.note)}</p>` : ''}
      ${body}
    </details>`;
  }).join('');
}
