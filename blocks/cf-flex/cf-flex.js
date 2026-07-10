import { getMetadata } from '../../scripts/aem.js';
import { isAuthorEnvironment } from '../../scripts/scripts.js';
import { getHostname, mapAemPathToSitePath } from '../../scripts/utils.js';

/* Wrapper-Service für die Live-Auslieferung (wie im bestehenden content-fragment Block) */
const WRAPPER_SERVICE_URL = 'https://3635370-refdemoapigateway-stage.adobeioruntime.net/api/v1/web/ref-demo-api-gateway/fetch-cf';

/* Modell-Zuordnung: pro CF-Modell die passende Persisted Query + Feldnamen.
   modelPath = _model._path aus dem GraphQL-Response. */
const MODEL_MAP = {
  '/conf/ref-demo-eds/settings/dam/cfm/models/cta': {
    query: '/graphql/execute.json/ref-demo-eds/CTAByPath',
    key: 'ctaByPath',
    fields: {
      image: 'bannerimage', title: 'title', subtitle: 'subtitle', text: 'description', ctaUrl: 'ctaurl', ctaLabel: 'ctalabel',
    },
  },
  '/conf/ref-demo-eds/settings/dam/cfm/models/article': {
    query: '/graphql/execute.json/ref-demo-eds/ArticleByPath',
    key: 'articleByPath',
    fields: { image: 'featuredImage', title: 'title', text: 'main' },
  },
  '/conf/ref-demo-eds/settings/dam/cfm/models/blog-article': {
    query: '/graphql/execute.json/ref-demo-eds/BlogArticleByPath',
    key: 'blogArticleByPath',
    fields: { image: 'image', title: 'title', text: 'content' },
  },
  '/conf/ref-demo-eds/settings/dam/cfm/models/faq': {
    query: '/graphql/execute.json/ref-demo-eds/FaqByPath',
    key: 'faqByPath',
    fields: { title: 'question', text: 'answer' },
  },
};

/* Reihenfolge, in der Modelle probiert werden, wenn das Modell noch unbekannt ist */
const PROBE_ORDER = [
  '/conf/ref-demo-eds/settings/dam/cfm/models/cta',
  '/conf/ref-demo-eds/settings/dam/cfm/models/article',
  '/conf/ref-demo-eds/settings/dam/cfm/models/blog-article',
  '/conf/ref-demo-eds/settings/dam/cfm/models/faq',
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
  return (isAuthor ? imgObj._authorUrl : imgObj._publishUrl) || imgObj._publishUrl || imgObj._authorUrl || '';
}

/* Text als HTML (main/content/answer) oder plaintext (description) aufbereiten */
function textToHtml(value) {
  if (!value) return '';
  if (typeof value === 'string') return `<p>${value}</p>`;
  if (value.html) return stripInlineStyles(value.html);
  if (value.plaintext) return `<p>${value.plaintext}</p>`;
  return '';
}

/* Eine Persisted Query aufrufen (Author: direkt; Live: über Wrapper-Service) */
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
  const resp = await fetch(req.url, req.opts);
  if (!resp.ok) return null;
  try {
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

  // Config aus den authored Zeilen lesen
  const contentPath = block.querySelector(':scope div:nth-child(1) > div a')?.textContent?.trim();
  const variation = block.querySelector(':scope div:nth-child(2) > div')?.textContent?.trim()?.toLowerCase()?.replace(' ', '_') || 'master';
  const displayStyle = block.querySelector(':scope div:nth-child(3) > div')?.textContent?.trim() || '';
  const alignment = block.querySelector(':scope div:nth-child(4) > div')?.textContent?.trim() || 'text-left';

  block.innerHTML = '';
  if (!contentPath) return;

  // Modell noch unbekannt -> Queries der Reihe nach probieren, bis eine ein Item liefert
  let item = null;
  let mapping = null;
  // eslint-disable-next-line no-restricted-syntax
  for (const modelPath of PROBE_ORDER) {
    const m = MODEL_MAP[modelPath];
    // eslint-disable-next-line no-await-in-loop
    const json = await runQuery(m.query, contentPath, variation, isAuthor, authorUrl, publishUrl);
    const candidate = json?.data?.[m.key]?.item;
    if (candidate) { item = candidate; mapping = m; break; }
  }

  if (!item || !mapping) {
    // nichts gefunden -> still beenden (kein kaputtes Markup)
    return;
  }

  const f = mapping.fields;
  const title = item[f.title] || '';
  const subtitle = f.subtitle ? (item[f.subtitle] || '') : '';
  const textHtml = textToHtml(item[f.text]);
  const imgUrl = f.image ? imageUrl(item[f.image], isAuthor) : '';

  // CTA (nur wenn Modell eins hat)
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
      } catch (e) { /* Fallback: unveränderte href */ }
    }
  }

  // Layout-Klassen; ohne Bild fallen die image-* Layouts weg
  const styleClass = imgUrl ? displayStyle : '';
  const bgStyle = imgUrl ? `background-image:url(${imgUrl});` : '';

  const parts = [];
  parts.push(`<div class="cff-content block ${styleClass}" style="${bgStyle}">`);
  parts.push(`<div class="cff-detail ${alignment}">`);
  if (title) parts.push(`<h2 class="cff-title">${title}</h2>`);
  if (subtitle) parts.push(`<h3 class="cff-subtitle">${subtitle}</h3>`);
  if (textHtml) parts.push(`<div class="cff-text">${textHtml}</div>`);
  if (ctaHref) parts.push(`<p class="button-container"><a class="button" href="${ctaHref}" target="_blank" rel="noopener">${ctaLabel || 'Read more'}</a></p>`);
  parts.push('</div></div>');

  block.innerHTML = parts.join('');
}
