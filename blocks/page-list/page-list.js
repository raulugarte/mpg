// Projekt-Konstanten (bei Bedarf anpassen)
const EDS_ORIGIN = 'https://main--mpg--raulugarte.aem.page';
const AEM_SITE_ROOT = '/content/mpg/language-masters';

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

// AEM-Content-Pfad -> öffentlicher Pfad (/content/mpg/language-masters/en/x -> /en/x)
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

// -------- Quelle 1: EDS (publizierte Seiten via query-index.json) --------
function indexUrlFor(publicPrefix) {
  const seg = firstSeg(publicPrefix !== '/' ? publicPrefix : window.location.pathname) || 'en';
  const path = `/${seg}/query-index.json`;
  return isEdsOrigin() ? path : `${EDS_ORIGIN}${path}`;
}

async function fromEds(publicPrefix, scope, prefixDepth) {
  const json = await (await fetch(indexUrlFor(publicPrefix))).json();
  return (json.data || [])
    .filter((p) => p.path && pathScopeOk(p.path, publicPrefix, scope, prefixDepth))
    .map((p) => ({
      path: p.path,
      title: p.title || p.navTitle || p.path,
      description: p.description || '',
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
    return null; // ganze Site im Author nicht sinnvoll auflösbar
  }
  const out = [];
  await walk(authorBase, scope === 'children' ? 0 : 6, out);
  return out;
}

export default async function decorate(block) {
  const rows = [...block.children];
  const cellText = (i) => (rows[i]?.textContent || '').trim();
  // Mehrfachwerte (z. B. Tag-Picker): einzelne Einträge sauber sammeln
  const cellList = (i) => {
    const row = rows[i];
    if (!row) return [];
    const els = [...row.querySelectorAll('p, li, a')].map((el) => el.textContent.trim());
    const base = els.filter(Boolean).length ? els : (row.textContent || '').split(',');
    return base.map((t) => t.trim().toLowerCase()).filter(Boolean);
  };

  // 0 Titel, 1 Pfad, 2 Scope, 3 Tags, 4 Tag-Match, 5 Sortierung, 6 Limit
  const title = cellText(0);
  const rawPath = cellText(1) || '/';
  const publicPrefix = toPublic(rawPath);
  const scope = cellText(2) || 'descendants';
  const filterTags = cellList(3);
  const tagMatch = cellText(4) || 'any';
  const sortBy = cellText(5) || 'newest';
  const limit = parseInt(cellText(6), 10) || 0;

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

    if (isAuthor()) {
      entries = await fromAuthor(rawPath, publicPrefix, scope);
    }
    if (!entries) {
      entries = await fromEds(publicPrefix, scope, prefixDepth);
    }

    const here = window.location.pathname.replace(/\.html$/, '');
    entries = entries.filter((e) => e.path && e.path !== here && e.path !== publicPrefix);

    if (filterTags.length) {
      entries = entries.filter((e) => {
        const tags = normalizeTags(e.tags);
        const has = (t) => tags.some((pt) => pt.includes(t));
        return tagMatch === 'all' ? filterTags.every(has) : filterTags.some(has);
      });
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
      const a = document.createElement('a');
      a.href = e.path;
      a.textContent = e.title;
      li.append(a);
      if (e.description) {
        const desc = document.createElement('p');
        desc.textContent = e.description;
        li.append(desc);
      }
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