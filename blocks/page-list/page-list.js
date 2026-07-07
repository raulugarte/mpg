function depthOf(path) {
  return path.split('/').filter(Boolean).length;
}

function normalizeTags(tags) {
  if (!tags) return [];
  const arr = Array.isArray(tags) ? tags : String(tags).split(',');
  return arr.map((t) => t.trim().toLowerCase()).filter(Boolean);
}

function dateOf(p) {
  return Number(p.publishDate) || Number(p.lastModified) || 0;
}

// Sprach-Segment aus dem Pfad ableiten -> passender /{lang}/query-index.json
function indexUrlFor(pathPrefix) {
  const source = pathPrefix && pathPrefix !== '/' ? pathPrefix : window.location.pathname;
  const seg = source.split('/').filter(Boolean)[0] || 'en';
  return `/${seg}/query-index.json`;
}

export default async function decorate(block) {
  // Config-Zeilen (Reihenfolge):
  // 0 Titel, 1 Pfad-Präfix, 2 Scope, 3 Tags, 4 Tag-Match, 5 Sortierung, 6 Limit
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
    const json = await (await fetch(indexUrlFor(pathPrefix))).json();
    let pages = (json.data || []).filter(
      (p) => p.path && p.path !== window.location.pathname,
    );

    // 1) Pfad + Scope
    pages = pages.filter((p) => {
      if (pathPrefix === '/') {
        return scope === 'children' ? depthOf(p.path) === 1 : true;
      }
      if (p.path !== pathPrefix && !p.path.startsWith(`${pathPrefix}/`)) return false;
      return scope === 'children' ? depthOf(p.path) === prefixDepth + 1 : true;
    });

    // 2) Tag-Filter (Teilstring-Match, damit auch namespaced Tags greifen)
    if (filterTags.length) {
      pages = pages.filter((p) => {
        const pageTags = normalizeTags(p.tags);
        const has = (t) => pageTags.some((pt) => pt.includes(t));
        return tagMatch === 'all' ? filterTags.every(has) : filterTags.some(has);
      });
    }

    // 3) Sortierung
    pages.sort((a, b) => {
      switch (sortBy) {
        case 'oldest': return dateOf(a) - dateOf(b);
        case 'title-asc': return (a.title || '').localeCompare(b.title || '');
        case 'title-desc': return (b.title || '').localeCompare(a.title || '');
        case 'newest':
        default: return dateOf(b) - dateOf(a);
      }
    });

    // 4) Limit
    if (limit > 0) pages = pages.slice(0, limit);

    pages.forEach((p) => {
      const li = document.createElement('li');

      const a = document.createElement('a');
      a.href = p.path;
      a.textContent = p.title || p.navTitle || p.path;
      li.append(a);

      if (p.description) {
        const desc = document.createElement('p');
        desc.textContent = p.description;
        li.append(desc);
      }

      ul.append(li);
    });

    if (!pages.length) {
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
