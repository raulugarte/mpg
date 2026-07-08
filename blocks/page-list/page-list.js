// Projekt-Konstanten (bei Bedarf anpassen)
const EDS_ORIGIN = 'https://main--mpg--raulugarte.aem.page';
const AEM_SITE_ROOT = '/content/mpg/language-masters';

// Merkt sich einmal geholte query-index-Antworten (kein Doppel-Fetch)
const indexCache = {};

function isEdsOrigin() {
  return /\.aem\.(page|live)$/.test(window.location.hostname);
}

function isAuthor() {
  return !isEdsOrigin()
    && (window.location.hostname.includes('adobeaemcloud.com')
      || window.location.pathname.startsWith('/content/'));
}

function firstSeg(p) {
  return (p || '').split('/').filter(Boolean)[0] || '';
}

function depthOf(path) {
  return path.split('/').filter(Boolean).length;
}

// relative Bild-URL (auch EDS-Media wie ./media_xxx) absolut machen
function absUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//.test(u)) return u;
  const clean = u.replace(/^\.?\//, '');
  return `${isEdsOrigin() ? '' : EDS_ORIGIN}/${clean}`;
}

// AEM-Content-Pfad -> öffentlicher Pfad
function toPublic(p) {
  if (!p) return '/';
  let out = p.startsWith(AEM_SITE_ROOT) ? p.slice(AEM_SITE_ROOT.length) : p;
  out = out.replace(/\.html$/, '');
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out || '/';
}

function normalizeTags(tags) {
  if (!tags) return [];
  const arr = Array.isArray(tags) ? tags : String(tags).split(',');
  return arr.map((t) => t.trim().toLowerCase()).filter(Boolean);
}

function edsDateOf(p) {
  return Number(p.publishDate) || Number(p.lastModified) || 0;
}

function pathScopeOk(path, publicPrefix, scope, prefixDepth) {
  if (publicPrefix === '/') {
    return scope === 'children' ? depthOf(path) === 1 : true;
  }
  if (path !== publicPrefix && !path.startsWith(`${publicPrefix}/`)) return false;
  return scope === 'children' ? depthOf(path) === prefixDepth + 1 : true;
}

// -------- query-index (gemerkt) --------
function indexUrlFor(publicPrefix) {
  const seg = firstSeg(publicPrefix !== '/' ? publicPrefix : window.location.pathname) || 'en';
  const path = `/${seg}/query-index.json`;
  return isEdsOrigin() ? path : `${EDS_ORIGIN}${path}`;
}

function fetchIndexJson(url) {
  if (!indexCache[url]) {
    indexCache[url] = fetch(url)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .catch(() => ({ data: [] }));
  }
  return indexCache[url];
}

// -------- Quelle 1: EDS (publizierte Seiten) --------
async function fromEds(publicPrefix, scope, prefixDepth) {
  const json = await fetchIndexJson(indexUrlFor(publicPrefix));
  return (json.data || [])
    .filter((p) => p.path && pathScopeOk(p.path, publicPrefix, scope, prefixDepth))
    .map((p) => ({
      path: p.path,
      title: p.title || p.navTitle || p.path,
      description: '',
      image: '',
      tags: p.tags,
      date: edsDateOf(p),
    }));
}

// -------- Quelle 2: Author (alle Seiten, auch unveröffentlicht) --------
async function walk(nodePath, depthRemaining, out) {
  let json;
  try {
    const resp = await fetch(`${nodePath}.2.json`, { credentials: 'include' });
    if (!resp.ok) return;
    json = await resp.json();
  } catch (e) {
    return;
  }

  const childPages = Object.keys(json)
    .filter((k) => json[k] && typeof json[k] === 'object' && json[k]['jcr:primaryType'] === 'cq:Page')
    .map((k) => ({ key: k, node: json[k] }));

  childPages.forEach(({ key, node }) => {
    const content = node['jcr:content'] || {};
    const childPath = `${nodePath}/${key}`;
    out.push({
      path: childPath.replace(AEM_SITE_ROOT, ''),
      title: content['jcr:title'] || key,
      description: content['jcr:description'] || '',
      image: '',
      tags: content['cq:tags'] || [],
      date: Date.parse(content['cq:lastModified'] || node['jcr:created'] || '') || 0,
    });
  });

  if (depthRemaining > 0) {
    await Promise.all(
      childPages.map(({ key }) => walk(`${nodePath}/${key}`, depthRemaining - 1, out)),
    );
  }
}

async function fromAuthor(rawPath, publicPrefix, scope) {
  let authorBase;
  if (rawPath.startsWith(AEM_SITE_ROOT)) {
    authorBase = rawPath.replace(/\.html$/, '').replace(/\/$/, '');
  } else if (publicPrefix && publicPrefix !== '/') {
    authorBase = `${AEM_SITE_ROOT}${publicPrefix}`;
  } else {
    return null;
  }
  const out = [];
  await walk(authorBase, scope === 'children' ? 0 : 6, out);
  return out;
}

// Bild + Beschreibung aus dem Content (via query-index) ergänzen
async function enrichFromContent(entries, publicPrefix) {
  const json = await fetchIndexJson(indexUrlFor(publicPrefix));
  const map = new Map((json.data || []).map((p) => [p.path, p]));
  return entries.map((e) => {
    const p = map.get(e.path);
    if (!p) return e;
    return {
      ...e,
      image: p.mainImage || p.image || e.image || '',
      description: p.excerpt || p.description || e.description,
    };
  });
}

export default async function decorate(block) {
  const rows = [...block.children];
  const cellText = (i) => (rows[i]?.textContent || '').trim();
  const cellList = (i) => {
    const row = rows[i];
    if (!row) return [];
    const els = [...row.querySelectorAll('p, li, a')].map((el) => el.textContent.trim());
    const base = els.filter(Boolean).length ? els : (row.textContent || '').split(',');
    return base.map((t) => t.trim().toLowerCase()).filter(Boolean);
  };

  // 0 Title, 1 Path, 2 Scope, 3 Tags, 4 Tag-Match, 5 Sort, 6 Limit, 7 Show Image, 8 Show Description
  const title = cellText(0);
  const rawPath = cellText(1) || '/';
  const publicPrefix = toPublic(rawPath);
  const scope = cellText(2) || 'descendants';
  const filterTags = cellList(3);
  const tagMatch = cellText(4) || 'any';
  const sortBy = cellText(5) || 'newest';
  const limit = parseInt(cellText(6), 10) || 0;
  const showImage = cellText(7) === 'true';
  const showDescription = cellText(8) === 'true';

  const prefixDepth = depthOf(publicPrefix);

  block.textContent = '';
  if (title) {
    const h = document.createElement('h2');
    h.textContent = title;
    block.append(h);
  }

  const ul = document.createElement('ul');

  try {
    let entries = null;
    if (isAuthor()) entries = await fromAuthor(rawPath, publicPrefix, scope);
    if (!entries) entries = await fromEds(publicPrefix, scope, prefixDepth);

    const here = window.location.pathname.replace(/\.html$/, '');
    entries = entries.filter((e) => e.path && e.path !== here && e.path !== publicPrefix);

    if (filterTags.length) {
      entries = entries.filter((e) => {
        const tags = normalizeTags(e.tags);
        const has = (t) => tags.some((pt) => pt.includes(t));
        return tagMatch === 'all' ? filterTags.every(has) : filterTags.some(has);
      });
    }

    // Content-Daten (Bild/Beschreibung) nur laden, wenn gebraucht
    if (showImage || showDescription) {
      entries = await enrichFromContent(entries, publicPrefix);
    }

    entries.sort((a, b) => {
      switch (sortBy) {
        case 'oldest': return a.date - b.date;
        case 'title-asc': return (a.title || '').localeCompare(b.title || '');
        case 'title-desc': return (b.title || '').localeCompare(a.title || '');
        case 'newest':
        default: return b.date - a.date;
      }
    });

    if (limit > 0) entries = entries.slice(0, limit);

    entries.forEach((e) => {
      const li = document.createElement('li');

      if (showImage && e.image) {
        const img = document.createElement('img');
        img.src = absUrl(e.image);
        img.alt = e.title || '';
        img.loading = 'lazy';
        li.append(img);
      }

      const body = document.createElement('div');
      body.className = 'pl-text';

      const a = document.createElement('a');
      a.href = e.path;
      a.textContent = e.title;
      body.append(a);

      if (showDescription && e.description) {
        const desc = document.createElement('p');
        desc.textContent = e.description;
        body.append(desc);
      }

      li.append(body);
      ul.append(li);
    });

    if (!entries.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No pages found.';
      ul.append(empty);
    }
  } catch (e) {
    const err = document.createElement('p');
    err.textContent = 'Could not load the list.';
    ul.append(err);
  }

  block.append(ul);
}