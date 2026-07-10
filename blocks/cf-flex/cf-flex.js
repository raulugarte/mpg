import { getMetadata } from '../../scripts/aem.js';
import { isAuthorEnvironment } from '../../scripts/scripts.js';
import { getHostname, mapAemPathToSitePath } from '../../scripts/utils.js';

/* Wrapper-Service für die Live-Auslieferung (wie im bestehenden content-fragment Block) */
const WRAPPER_SERVICE_URL = 'https://3635370-refdemoapigateway-stage.adobeioruntime.net/api/v1/web/ref-demo-api-gateway/fetch-cf';

/* Modell-Zuordnung: pro CF-Modell die passende Persisted Query + Feldnamen (= echte CF-Feldnamen). */
const MODEL_MAP = {
  '/conf/ref-demo-eds/settings/dam/cfm/models/cta': {
    query: '/graphql/execute.json/ref-demo-eds/CTAByPath',
    key: 'ctaByPath',
    typename: 'CtaModel',
    fields: {
      image: 'bannerimage', title: 'title', subtitle: 'subtitle', text: 'description', ctaUrl: 'ctaurl', ctaLabel: 'ctalabel',
    },
  },
  '/conf/ref-demo-eds/settings/dam/cfm/models/article': {
    query: '/graphql/execute.json/ref-demo-eds/ArticleByPath',
    key: 'articleByPath',
    typename: 'ArticleModel',
    fields: { image: 'featuredImage', title: 'title', text: 'main' },
  },
  '/conf/ref-demo-eds/settings/dam/cfm/models/blog-article': {
    query: '/graphql/execute.json/ref-demo-eds/BlogArticleByPath',
    key: 'blogArticleByPath',
    typename: 'BlogArticleModel',
    fields: { image: 'image', title: 'title', text: 'content' },
  },
  '/conf/ref-demo-eds/settings/dam/cfm/models/faq': {
    query: '/graphql/execute.json/ref-demo-eds/FaqByPath',
    key: 'faqByPath',
    typename: 'FaqModel',
    fields: { title: 'question', text: 'answer' },
  },
};

/* Reihenfolge, in der Modelle probiert werden, bis eine Query ein Item liefert.
   CTA steht bewusst zuletzt: CTAByPath liefert für viele Pfade ein (leeres) Item,
   deshalb müssen die spezifischen Modelle zuerst über _model._path matchen. */
const PROBE_ORDER = [
  '/conf/ref-demo-eds/settings/dam/cfm/models/article',
  '/conf/ref-demo-eds/settings/dam/cfm/models/blog-article',
  '/conf/ref-demo-eds/settings/dam/cfm/models/faq',
  '/conf/ref-demo-eds/settings/dam/cfm/models/cta',
];

/* AEM-Inline-Styles entfernen, damit das eigene CSS greift */
function stripInlineStyles(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('[style]').forEach((el) => el.removeAttribute('style'));
  return doc.body.innerHTML;
}

/* Bild-URL je Umgebung wählen */
function imageUrl(imgObj, isAuthor) {
  if (!imgObj) return '';
  return (isAuthor ? imgObj._authorUrl : imgObj._publishUrl)
    || imgObj._publishUrl || imgObj._authorUrl || imgObj._dynamicUrl || '';
}

/* Text als HTML (main/content/answer = {html}) oder plaintext (description) */
function textToHtml(value) {
  if (!value) return '';
  if (typeof value === 'string') return `<p>${value}</p>`;
  if (value.html) return stripInlineStyles(value.html);
  if (value.plaintext) return `<p>${value.plaintext}</p>`;
  return '';
}

/* Eine Persisted Query aufrufen (Author: direkt GET; Live: über Wrapper POST) */
async function runQuery(queryPath, contentPath, variation, isAuthor, authorUrl, publishUrl) {
  const req = isAuthor
    ? {
      url: `${authorUrl}${queryPath};path=${contentPath};variation=${variation};ts=${Date.now()}`,
      opts: { method: 'GET', headers: { 'Content-Type': 'application/json' } },
    }
    : {
      url: WRAPPER_SERVICE_URL,
      opts: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphQLPath: `${publishUrl}${queryPath}`,
          cfPath: contentPath,
          variation: `${variation};ts=${Date.now()}`,
        }),
      },
    };
  try {
    const resp = await fetch(req.url, req.opts);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

export default async function decorate(block) {
  const hostnameFromPlaceholders = await getHostname();
  const hostname = hostnameFromPlaceholders || getMetadata('hostname');
  const authorUrl = getMetadata('authorurl') || '';
  const publishUrl = hostname?.replace('author', 'publish')?.replace(/\/$/, '') || '';
  const isAuthor = isAuthorEnvironment();

  const contentPath = block.querySelector(':scope div:nth-child(1) > div a')?.textContent?.trim();
  const variation = block.querySelector(':scope div:nth-child(2) > div')?.textContent?.trim()?.toLowerCase()?.replace(' ', '_') || 'master';
  const displayStyle = block.querySelector(':scope div:nth-child(3) > div')?.textContent?.trim() || '';
  const alignment = block.querySelector(':scope div:nth-child(4) > div')?.textContent?.trim() || 'text-left';

  block.innerHTML = '';
  if (!contentPath) return;

  // Modell erkennen: Query probieren UND prüfen, dass das zurückgegebene
  // Item wirklich zum erwarteten Modell gehört. Wichtig, weil CTAByPath
  // für jeden Pfad ein (leeres) Item liefert und sonst fälschlich matcht.
  let item = null;
  let mapping = null;
  let matchedKey = '';
  // eslint-disable-next-line no-restricted-syntax
  for (const modelPath of PROBE_ORDER) {
    const m = MODEL_MAP[modelPath];
    // eslint-disable-next-line no-await-in-loop
    const json = await runQuery(m.query, contentPath, variation, isAuthor, authorUrl, publishUrl);
    const candidate = json?.data?.[m.key]?.item;
    if (!candidate) continue;
    // Modell des Items ermitteln (bevorzugt _model._path, ersatzweise __typename)
    const returnedModelPath = candidate?._model?._path || '';
    const typename = candidate?.__typename || '';
    const modelOk = returnedModelPath
      ? returnedModelPath === modelPath
      : typename === m.typename; // Fallback, wenn Query kein _model liefert
    if (modelOk) { item = candidate; mapping = m; matchedKey = m.key; break; }
  }

  if (isAuthor) {
    // Author-Diagnose in der Konsole
    // eslint-disable-next-line no-console
    console.log('[cf-flex]', { contentPath, matchedKey: matchedKey || 'NONE', model: item?._model?.title || '-' });
  }

  if (!item || !mapping) {
    if (isAuthor) {
      block.innerHTML = '<div class="cff-content"><div class="cff-detail text-left">'
        + '<p class="cff-empty">No matching content fragment model. Supported: Promotion, Article, Blog Article, FAQ.</p>'
        + '</div></div>';
    }
    return;
  }

  const f = mapping.fields;
  const title = item[f.title] || '';
  const subtitle = f.subtitle ? (item[f.subtitle] || '') : '';
  const textHtml = textToHtml(item[f.text]);
  const imgUrl = f.image ? imageUrl(item[f.image], isAuthor) : '';

  // CTA (nur bei Modellen mit CTA)
  let ctaHref = '';
  let ctaLabel = '';
  if (f.ctaUrl) {
    const cta = item[f.ctaUrl];
    ctaLabel = item[f.ctaLabel] || '';
    if (cta) {
      if (typeof cta === 'string') {
        ctaHref = /^https?:\/\//i.test(cta) ? cta : `${isAuthor ? authorUrl : publishUrl}${cta}`;
      } else {
        ctaHref = isAuthor ? (cta._authorUrl || (cta._path ? `${authorUrl}${cta._path}` : '')) : (cta._path || '');
      }
    }
    if (!isAuthor && ctaHref && ctaHref.startsWith('/content/')) {
      try {
        const mapped = await mapAemPathToSitePath(ctaHref);
        if (mapped) ctaHref = mapped;
      } catch (e) { /* Fallback: href unverändert */ }
    }
  }

  // Layout: image-* Klassen nur wenn ein Bild vorhanden ist
  const layoutClass = imgUrl ? (displayStyle || 'image-left') : 'no-image';

  // UE-Instrumentierung: CF-Felder inline editierbar
  const itemId = `urn:aemconnection:${contentPath}/jcr:content/data/${variation}`;
  block.setAttribute('data-aue-type', 'container');

  const parts = [];
  parts.push(`<div class="cff-content ${layoutClass}" data-aue-resource="${itemId}" data-aue-label="${item?._model?.title || 'Content Fragment'}" data-aue-type="reference" data-aue-filter="cf-flex">`);

  if (imgUrl && f.image) {
    parts.push(`<div class="cff-media"><img class="cff-image" src="${imgUrl}" alt="${title}" loading="lazy" data-aue-prop="${f.image}" data-aue-label="Image" data-aue-type="media"></div>`);
  }

  parts.push(`<div class="cff-detail ${alignment}">`);
  if (title) parts.push(`<h2 class="cff-title" data-aue-prop="${f.title}" data-aue-label="Title" data-aue-type="text">${title}</h2>`);
  if (subtitle) parts.push(`<h3 class="cff-subtitle" data-aue-prop="${f.subtitle}" data-aue-label="Subtitle" data-aue-type="text">${subtitle}</h3>`);
  if (textHtml) parts.push(`<div class="cff-text" data-aue-prop="${f.text}" data-aue-label="Text" data-aue-type="richtext">${textHtml}</div>`);
  if (ctaHref) {
    parts.push('<p class="button-container">'
      + `<a class="button" href="${ctaHref}" target="_blank" rel="noopener" data-aue-prop="${f.ctaUrl}" data-aue-label="CTA Link" data-aue-type="reference">`
      + `<span data-aue-prop="${f.ctaLabel}" data-aue-label="CTA Label" data-aue-type="text">${ctaLabel || 'Read more'}</span>`
      + '</a></p>');
  }
  parts.push('</div></div>');

  block.innerHTML = parts.join('');
}