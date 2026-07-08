// EDS-Domain, auf der die query-index.json liegt (bei Bedarf anpassen).
const EDS_ORIGIN = 'https://main--mpg--raulugarte.aem.page';

function isEdsOrigin() {
  return /\.aem\.(page|live)$/.test(window.location.hostname);
}

// Author/UE: nicht EDS und auf einer AEM-/Content-URL
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

function normalizeTags(tags) {
  if (!tags) return [];
  const arr = Array.isArray(tags) ? tags : String(tags).split(',');
  return arr.map((t) => t.trim().toLowerCase()).filter(Boolean);
}

function edsDateOf(p) {
  return Number(p.publishDate) || Number(p.lastModified) || 0;
}

function pathScopeOk(path, pathPrefix, scope, prefixDepth) {
  if (pathPrefix === '/') {
    return scope === 'children' ? depthOf(path) === 1 : true;
  }
  if (path !== pathPrefix && !path.startsWith(`${pathPrefix}/`)) return false;
  return scope === 'children' ? depthOf(path) === prefixDepth + 1 : true;
}

// -------- Quelle 1: EDS (publizierte Seiten via query-index.json) --------
function indexUrlFor(pathPrefix) {
  const source = pathPrefix && pathPrefix !== '/' ? pathPrefix : window.location.pathname;
  const seg = firstSeg(source) || 'en';
  const path = `/${seg}/query-index.json`;
  return isEdsOrigin() ? path : `${EDS_ORIGIN}${path}`;
}

async function fromEds(pathPrefix, scope, prefixDepth) {
  const json = await (await fetch(indexUrlFor(pathPrefix))).json();
  return (json.data || [])
    .filter((p) => p.path && pathScopeOk(p.path, pathPrefix, scope, prefixDepth))
    .map((p) => ({
      path: p.path,
      title: p.title || p.navTitle || p.path,
      description: p.description || '',
      tags: p.tags,
      date: edsDateOf(p),
    }));
}

// -------- Quelle 2: Author (alle Seiten, auch unveröffentlicht) --------
async function walk(nodePath, authorRoot, depthRemaining, out) {
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
      path: childPath.replace(authorRoot, ''),
      title: content['jcr:title'] || key,
      description: content['jcr:description'] || '',
      tags: content['cq:tags'] || [],
      date: Date.parse(content['cq:lastModified'] || node['jcr:created'] || '') || 0,
    });
  });

  if (depthRemaining > 0) {
    await Promise.all(
      childPages.map(({ key }) => walk(`${nodePath}/${key}`, authorRoot, depthRemaining - 1, out)),
    );
  }
}

async function fromAuthor(pathPrefix, scope) {
  const lang = firstSeg(pathPrefix);
  if (!lang) return null; // z. B. pathPrefix "/" -> im Author nicht sinnvoll auflösbar
  const marker = `/${lang}/`;
  const idx = window.location.pathname.indexOf(marker);
  if (idx < 0) return null;
  const authorRoot = window.location.pathname.slice(0, idx);
  const authorBase = `${authorRoot}${pathPrefix}`;
  const out = [];
  await walk(authorBase, authorRoot, scope === 'children' ? 0 : 6, out);
  return out;
}

export default async function decorate(block) {
  // Config-Zeilen: 0 Titel, 1 Pfad, 2 Scope, 3 Tags, 4 Tag-Match, 5 Sortierung, 6 Limit
  const cfg = [...block.children].map((row) => row.textContent.trim());
  const title = cfg[0] || '';
  let pathPrefix = (cfg[1] || '/').trim();
  const scope = cfg[2] || 'descendants';
  const filterTags = (cfg[3] || '')
    .split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  const tagMatch = cfg[4] || 'any';
  const sortBy = cfg[5] || 'newest';
  const limit = parseInt(cfg[6], 10) || 0;

  if (pathPrefix.length > 1 && pathPrefix.endsWith('/')) pathPrefix = pathPrefix.slice(0, -1);
  const prefixDepth = depthOf(pathPrefix);

  block.textContent = '';
  if (title) {
    const h = document.createElement('h2');
    h.textContent = title;
    block.append(h);
  }

  const ul = document.createElement('ul');

  try {
    let entries = null;

    // Author/UE zuerst (zeigt auch unveröffentlichte Seiten). Bei Bedarf Fallback auf EDS.
    if (isAuthor()) {
      entries = await fromAuthor(pathPrefix, scope);
    }
    if (!entries) {
      entries = await fromEds(pathPrefix, scope, prefixDepth);
    }

    // aktuelle Seite nicht auflisten
    const here = window.location.pathname.replace(/\.html$/, '');
    entries = entries.filter((e) => e.path && e.path !== here);

    // Tag-Filter (Teilstring-Match)
    if (filterTags.length) {
      entries = entries.filter((e) => {
        const tags = normalizeTags(e.tags);
        const has = (t) => tags.some((pt) => pt.includes(t));
        return tagMatch === 'all' ? filterTags.every(has) : filterTags.some(has);
      });
    }

    // Sortierung
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
      empty.textContent = 'Keine Seiten gefunden.';
      ul.append(empty);
    }
  } catch (e) {
    const err = document.createElement('p');
    err.textContent = 'Liste konnte nicht geladen werden.';
    ul.append(err);
  }

  block.append(ul);
}