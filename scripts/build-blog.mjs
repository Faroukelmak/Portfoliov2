#!/usr/bin/env node
/*
 * Static bilingual blog generator (FR / EN). No npm install needed:
 * marked and highlight.js are vendored in scripts/vendor/.
 *
 *   node scripts/build-blog.mjs
 *
 * Reads   content/blog/<slug>.md      French article
 *         content/blog/<slug>.en.md   English version (optional, same slug)
 *         Files starting with "_" and README.md are ignored.
 *
 * Writes  blog/index.html, blog/<slug>/index.html, blog/feed.xml          (FR)
 *         en/blog/index.html, en/blog/<slug>/index.html, en/blog/feed.xml (EN)
 *
 * Front matter (between --- lines at the top of each .md):
 *   title:    Titre de l'article                   (required)
 *   date:     2026-11-24                           (required, YYYY-MM-DD)
 *   excerpt:  Une phrase qui donne envie de lire   (required)
 *   tags:     [OCR, ONNX, Production]
 *   versions: [pydantic 2.14.4, langchain 1.5.0]   (optional, "name version")
 *   model:    openai/gpt-oss-20b via Groq          (optional, shown with the versions)
 *   draft:    true                                 (optional, skipped when true)
 *
 * In the Markdown body:
 *   ```python ... ```          highlighted code block with a copy button
 *   ```output [label] ... ```  result block (default label "Résultat" / "Result")
 *   :yes: / :no:               check / cross icons (for comparison tables)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { marked } from './vendor/marked.esm.js';

const require = createRequire(import.meta.url);
const hljs = require('./vendor/highlight/core.js');
for (const l of ['python', 'json', 'bash', 'plaintext']) hljs.registerLanguage(l, require(`./vendor/highlight/languages/${l}.js`));
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['sh', 'shell'], { languageName: 'bash' });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'content/blog');
const SITE = 'https://faroukelmak.vercel.app';
const AUTHOR = 'Farouk El Makhchoune';
const LINKEDIN = 'https://www.linkedin.com/in/farouk-el-makhchoune-6753b1248/';
const GITHUB = 'https://github.com/Faroukelmak';

/* ---------------------------------------------------------------- strings */
const T = {
  fr: {
    base: '/blog/', out: 'blog', locale: 'fr-FR', ogLocale: 'fr_FR',
    listTitle: `Blog · ${AUTHOR}`,
    h1: 'Idées, notes <em>et découvertes.</em>',
    sub: "Ce que j'apprends, ce que je teste et ce que je construis. Un sujet à la fois, en quelques minutes de lecture.",
    search: 'Rechercher un article…', searchLabel: 'Rechercher dans le blog',
    noneHtml: 'Aucun article pour « <span id="qv"></span> » pour l\'instant.',
    soon: 'Premier article bientôt.',
    contact: 'Me contacter', all: 'Tous les articles', read: 'min de lecture', min: 'min',
    share: 'Partager', copyLink: 'Copier le lien', copied: 'Lien copié', copy: 'Copier', copiedCode: 'Copié',
    prev: '← Précédent', next: 'Suivant →', others: 'Autres articles',
    ctaH: 'Vous recrutez un Ingénieur IA ?',
    ctaP: 'Je cherche mon premier CDI dans les agents, le RAG et le fine-tuning de modèles. Paris ou partout en France.',
    env: 'Environnement de test', model: 'Modèle', tested: (d) => `Testé le ${d}`,
    result: 'Résultat', yes: 'oui', no: 'non', feed: 'Idées, notes et découvertes.',
  },
  en: {
    base: '/en/blog/', out: 'en/blog', locale: 'en-GB', ogLocale: 'en_GB',
    listTitle: `Blog · ${AUTHOR}`,
    h1: 'Ideas, notes <em>and discoveries.</em>',
    sub: 'What I learn, what I test and what I build. One topic at a time, a few minutes of reading.',
    search: 'Search an article…', searchLabel: 'Search the blog',
    noneHtml: 'No article for "<span id="qv"></span>" yet.',
    soon: 'First article coming soon.',
    contact: 'Get in touch', all: 'All articles', read: 'min read', min: 'min',
    share: 'Share', copyLink: 'Copy link', copied: 'Link copied', copy: 'Copy', copiedCode: 'Copied',
    prev: '← Previous', next: 'Next →', others: 'More articles',
    ctaH: 'Hiring an AI Engineer?',
    ctaP: "I'm looking for my first full-time role in agents, RAG and model fine-tuning. Paris or anywhere in France.",
    env: 'Test environment', model: 'Model', tested: (d) => `Tested on ${d}`,
    result: 'Result', yes: 'yes', no: 'no', feed: 'Ideas, notes and discoveries.',
  },
};
const LANGS = Object.keys(T);

/* ---------------------------------------------------------------- helpers */
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const fmtDate = (d, lang) => new Intl.DateTimeFormat(T[lang].locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

function parseFrontMatter(raw, file) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: front matter manquant (bloc --- en tête de fichier)`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let [, k, v] = kv;
    v = v.trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else if (v === 'true' || v === 'false') v = v === 'true';
    else v = v.replace(/^["']|["']$/g, '');
    meta[k] = v;
  }
  for (const k of ['title', 'date', 'excerpt']) if (!meta[k]) throw new Error(`${file}: champ "${k}" manquant`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) throw new Error(`${file}: date attendue au format YYYY-MM-DD`);
  return { meta, body: m[2] };
}

/* ---------------------------------------------------------------- markdown */
let LANG = 'fr'; // language of the article being rendered (labels inside blocks)

const renderer = new marked.Renderer();
renderer.heading = function ({ tokens, depth }) {
  const text = this.parser.parseInline(tokens);
  return `<h${depth} id="${slugify(text.replace(/<[^>]+>/g, ''))}">${text}</h${depth}>\n`;
};
renderer.link = function ({ href, title, tokens }) {
  const text = this.parser.parseInline(tokens);
  const ext = /^https?:\/\//.test(href) && !href.startsWith(SITE);
  return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}${ext ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
};
const LANG_LABEL = { python: 'Python', py: 'Python', json: 'JSON', bash: 'Terminal', sh: 'Terminal', shell: 'Terminal' };
renderer.code = function ({ text, lang = '' }) {
  const [kind, ...rest] = lang.trim().split(/\s+/);
  if (kind === 'output') {
    return `<figure class="code out"><figcaption>${esc(rest.join(' ') || T[LANG].result)}</figcaption><pre><code>${esc(text)}</code></pre></figure>\n`;
  }
  const known = kind && hljs.getLanguage(kind);
  const body = known ? hljs.highlight(text, { language: kind }).value : esc(text);
  return `<figure class="code"><figcaption><span>${esc(LANG_LABEL[kind] || kind || 'Code')}</span><button type="button" class="copy-code">${T[LANG].copy}</button></figcaption><pre><code class="hljs">${body}</code></pre></figure>\n`;
};
marked.use({ renderer, gfm: true });

const icon = (ok) => ok
  ? `<span class="ic ic-yes" role="img" aria-label="${T[LANG].yes}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>`
  : `<span class="ic ic-no" role="img" aria-label="${T[LANG].no}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg></span>`;
const render = (md, lang) => {
  LANG = lang;
  return marked.parse(md).replace(/:yes:/g, icon(true)).replace(/:no:/g, icon(false));
};

/* favicon is shared with the landing page */
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const favicon = (indexHtml.match(/<link rel="icon"[^>]*>/) || [''])[0];

/* ---------------------------------------------------------------- read posts */
const posts = { fr: [], en: [] };
for (const f of fs.readdirSync(SRC)) {
  if (!f.endsWith('.md') || f.startsWith('_') || f.toLowerCase() === 'readme.md') continue;
  const lang = f.endsWith('.en.md') ? 'en' : 'fr';
  const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(SRC, f), 'utf8'), f);
  if (meta.draft) continue;
  const words = body.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length;
  posts[lang].push({
    ...meta, lang,
    tags: list(meta.tags),
    versions: list(meta.versions),
    slug: meta.slug || slugify(f.replace(/\.en\.md$|\.md$/, '')),
    dateObj: new Date(meta.date + 'T00:00:00Z'),
    minutes: Math.max(1, Math.round(words / 220)),
    html: render(body, lang),
    text: body.replace(/```[\s\S]*?```/g, ' ').replace(/[#*_>`[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim(),
  });
}
for (const l of LANGS) posts[l].sort((a, b) => b.dateObj - a.dateObj || a.slug.localeCompare(b.slug));
const counterpart = (p, lang) => posts[lang].find((x) => x.slug === p.slug);

/* ---------------------------------------------------------------- shared chrome */
const ICONS = {
  in: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/><path d="M10 9v12"/><path d="M10 13a4 4 0 018 0v8"/></svg>',
  gh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 00-.9-2.6c3-.3 6.2-1.5 6.2-6.7A5.2 5.2 0 0019.9 5 4.9 4.9 0 0019.8.5S18.6.1 16 1.9a13.4 13.4 0 00-7 0C6.4.1 5.2.5 5.2.5A4.9 4.9 0 005.1 5a5.2 5.2 0 00-1.4 3.6c0 5.2 3.2 6.4 6.2 6.7a3.4 3.4 0 00-.9 2.6V22"/></svg>',
  arrow: '<svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
};

/* alt = { fr: '/blog/x/', en: '/en/blog/x/' } : where each language version lives */
const head = ({ lang, title, description, url, alt, type = 'website', extra = '' }) => `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${url}">
${LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${SITE}${alt[l]}">`).join('\n')}
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}${url}">
<meta property="og:locale" content="${T[lang].ogLocale}">
<meta property="og:site_name" content="${AUTHOR}">
<meta name="twitter:card" content="summary">
<meta name="author" content="${AUTHOR}">
<link rel="alternate" type="application/rss+xml" title="Blog · ${AUTHOR}" href="${T[lang].base}feed.xml">
${favicon}
<link rel="preload" href="/assets/fonts/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/blog.css">
${extra}</head>
<body>`;

const nav = (lang, alt) => `
<nav class="nav" id="nav">
  <a class="brand" href="/">FAROUK EL MAKHCHOUNE</a>
  <div class="nav-right">
    <a class="nav-link" href="/">Portfolio</a>
    <a class="nav-link" href="${T[lang].base}" aria-current="page">Blog</a>
    <div class="lang-switch${lang === 'en' ? ' en' : ''}" role="group" aria-label="Language">
      <span class="thumb"></span>
      ${LANGS.map((l) => `<a href="${alt[l]}" hreflang="${l}"${l === lang ? ' class="active" aria-current="true"' : ''}>${l.toUpperCase()}</a>`).join('')}
    </div>
    <a class="icon-btn" href="${LINKEDIN}" target="_blank" rel="noopener" aria-label="LinkedIn">${ICONS.in}</a>
    <a class="icon-btn" href="${GITHUB}" target="_blank" rel="noopener" aria-label="GitHub">${ICONS.gh}</a>
    <a class="nav-cta" href="/#contact">${T[lang].contact}</a>
  </div>
</nav>`;

const foot = () => `
<div class="wrap"><footer class="foot">
  <span>© ${new Date().getFullYear()} ${AUTHOR}</span>
  <span><a href="/">Portfolio</a> · <a href="${LINKEDIN}" target="_blank" rel="noopener">LinkedIn</a></span>
</footer></div>
<script>
  (function(){var n=document.getElementById('nav');function f(){n.classList.toggle('scrolled',window.scrollY>24);}
  window.addEventListener('scroll',f,{passive:true});f();})();
</script>`;

const metaLine = (p) => `<time datetime="${p.date}">${fmtDate(p.dateObj, p.lang)}</time><span class="sep">·</span>${p.minutes} ${T[p.lang].min}`;

/* ---------------------------------------------------------------- listing */
const listing = (lang) => {
  const t = T[lang], ps = posts[lang];
  const alt = Object.fromEntries(LANGS.map((l) => [l, T[l].base]));
  return `${head({ lang, title: t.listTitle, description: t.sub, url: t.base, alt })}
${nav(lang, alt)}
<main class="wrap">
  <header class="blog-head">
    <span class="kicker rise">Blog</span>
    <h1 class="rise" style="animation-delay:.08s">${t.h1}</h1>
    <p class="rise" style="animation-delay:.16s">${t.sub}</p>
    <label class="search rise" style="animation-delay:.24s">
      ${ICONS.search}
      <input id="q" type="search" placeholder="${t.search}" autocomplete="off" aria-label="${t.searchLabel}">
      <kbd>/</kbd>
    </label>
  </header>
  ${ps.length ? `<ul class="posts rise" style="animation-delay:.3s">
${ps.map((p) => `    <li class="post-row" data-s="${esc([p.title, p.excerpt, p.tags.join(' '), p.text].join(' '))}"><a href="${t.base}${p.slug}/">
      <span class="meta">${metaLine(p)}</span>
      <div><h2>${esc(p.title)}</h2><p>${esc(p.excerpt)}</p><div class="tags">${p.tags.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div></div>
      ${ICONS.arrow}
    </a></li>`).join('\n')}
  </ul>
  <p class="empty" id="none" hidden>${t.noneHtml}</p>` : `<p class="empty">${t.soon}</p>`}
</main>
${foot()}
<script>
  (function(){var q=document.getElementById('q');if(!q)return;
  var rows=[].slice.call(document.querySelectorAll('.post-row')),none=document.getElementById('none'),list=document.querySelector('.posts'),qv=document.getElementById('qv');
  function norm(s){return s.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');}
  rows.forEach(function(r){r._s=norm(r.dataset.s);});
  function run(){var words=norm(q.value).split(/\\s+/).filter(Boolean),n=0;
    rows.forEach(function(r){var ok=words.every(function(w){return r._s.indexOf(w)>-1;});r.hidden=!ok;if(ok)n++;});
    if(none){none.hidden=n>0;if(list)list.hidden=n===0;if(qv)qv.textContent=q.value.trim();}
    var u=new URL(location.href);q.value.trim()?u.searchParams.set('q',q.value.trim()):u.searchParams.delete('q');history.replaceState(null,'',u);}
  q.addEventListener('input',run);
  var init=new URLSearchParams(location.search).get('q');if(init){q.value=init;run();}
  document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus();}
    if(e.key==='Escape'&&document.activeElement===q){q.value='';run();q.blur();}});})();
</script>
</body>
</html>
`;
};

/* ---------------------------------------------------------------- article */
const versionsBox = (p) => {
  if (!p.versions.length && !p.model) return '';
  const t = T[p.lang];
  const rows = p.versions.map((v) => {
    const i = v.lastIndexOf(' ');
    return i > 0 ? [v.slice(0, i), v.slice(i + 1)] : [v, ''];
  });
  return `<aside class="env" aria-label="${t.env}">
      <div class="env-head"><span>${t.env}</span><span>${t.tested(fmtDate(p.dateObj, p.lang))}</span></div>
      <dl>${rows.map(([n, v]) => `<div><dt>${esc(n)}</dt><dd>${esc(v)}</dd></div>`).join('')}${p.model ? `<div class="env-model"><dt>${t.model}</dt><dd>${esc(p.model)}</dd></div>` : ''}</dl>
    </aside>`;
};

const article = (p, i) => {
  const t = T[p.lang], ps = posts[p.lang];
  const url = `${t.base}${p.slug}/`;
  const alt = Object.fromEntries(LANGS.map((l) => [l, counterpart(p, l) ? `${T[l].base}${p.slug}/` : T[l].base]));
  const newer = ps[i - 1], older = ps[i + 1];
  const ld = {
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.excerpt, inLanguage: p.lang,
    datePublished: p.date, author: { '@type': 'Person', name: AUTHOR, url: SITE }, mainEntityOfPage: SITE + url,
  };
  return `${head({
    lang: p.lang, title: `${p.title} · ${AUTHOR}`, description: p.excerpt, url, alt, type: 'article',
    extra: `<meta property="article:published_time" content="${p.date}">\n${p.tags.map((x) => `<meta property="article:tag" content="${esc(x)}">`).join('\n')}\n<script type="application/ld+json">${JSON.stringify(ld)}</script>\n`,
  })}
<div class="progress" id="progress"></div>
${nav(p.lang, alt)}
<main>
  <article class="article">
    <a class="back rise" href="${t.base}">${ICONS.back}${t.all}</a>
    <div class="tags rise" style="animation-delay:.05s">${p.tags.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>
    <h1 class="rise" style="animation-delay:.1s">${esc(p.title)}</h1>
    <p class="lead rise" style="animation-delay:.16s">${esc(p.excerpt)}</p>
    <div class="byline rise" style="animation-delay:.22s">
      <a class="avatar" href="/" aria-label="${AUTHOR}"><img src="/assets/blog/avatar.webp" alt="${AUTHOR}" width="52" height="52"></a>
      <div><a class="who" href="/">${AUTHOR}</a><div class="meta"><time datetime="${p.date}">${fmtDate(p.dateObj, p.lang)}</time><span class="sep">·</span>${p.minutes} ${t.read}</div></div>
    </div>
    <div class="prose rise" style="animation-delay:.28s">
${p.html}
    </div>
    ${versionsBox(p)}
    <div class="share">
      <span>${t.share}</span>
      <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SITE + url)}" target="_blank" rel="noopener">LinkedIn</a>
      <a href="https://x.com/intent/post?url=${encodeURIComponent(SITE + url)}&text=${encodeURIComponent(p.title)}" target="_blank" rel="noopener">X</a>
      <button type="button" id="copy" data-url="${SITE + url}">${t.copyLink}</button>
    </div>
    ${newer || older ? `<nav class="pager" aria-label="${t.others}">
      ${older ? `<a href="${t.base}${older.slug}/"><span class="meta">${t.prev}</span><b>${esc(older.title)}</b></a>` : '<div></div>'}
      ${newer ? `<a class="next" href="${t.base}${newer.slug}/"><span class="meta">${t.next}</span><b>${esc(newer.title)}</b></a>` : '<div></div>'}
    </nav>` : ''}
    <aside class="cta-box">
      <h2>${t.ctaH}</h2>
      <p>${t.ctaP}</p>
      <a class="btn" href="/#contact">${t.contact}</a>
    </aside>
  </article>
</main>
${foot()}
<script>
  (function(){var bar=document.getElementById('progress');
  function f(){var h=document.documentElement,max=h.scrollHeight-h.clientHeight;bar.style.transform='scaleX('+(max>0?h.scrollTop/max:0)+')';}
  window.addEventListener('scroll',f,{passive:true});f();
  var c=document.getElementById('copy');if(c)c.addEventListener('click',function(){
    var done=function(){c.textContent=${JSON.stringify(t.copied)};setTimeout(function(){c.textContent=${JSON.stringify(t.copyLink)};},1800);};
    if(navigator.clipboard)navigator.clipboard.writeText(c.dataset.url).then(done,function(){});});
  document.querySelectorAll('.copy-code').forEach(function(b){b.addEventListener('click',function(){
    var code=b.closest('figure').querySelector('code').innerText;
    if(navigator.clipboard)navigator.clipboard.writeText(code).then(function(){b.textContent=${JSON.stringify(t.copiedCode)};setTimeout(function(){b.textContent=${JSON.stringify(t.copy)};},1600);},function(){});});});})();
</script>
</body>
</html>
`;
};

/* ---------------------------------------------------------------- RSS */
const rss = (lang) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Blog · ${AUTHOR}</title>
  <link>${SITE}${T[lang].base}</link>
  <atom:link href="${SITE}${T[lang].base}feed.xml" rel="self" type="application/rss+xml"/>
  <description>${esc(T[lang].feed)}</description>
  <language>${lang}</language>
${posts[lang].map((p) => `  <item>
    <title>${esc(p.title)}</title>
    <link>${SITE}${T[lang].base}${p.slug}/</link>
    <guid>${SITE}${T[lang].base}${p.slug}/</guid>
    <pubDate>${p.dateObj.toUTCString()}</pubDate>
    <description>${esc(p.excerpt)}</description>
${p.tags.map((x) => `    <category>${esc(x)}</category>`).join('\n')}
  </item>`).join('\n')}
</channel>
</rss>
`;

/* ---------------------------------------------------------------- write */
for (const lang of LANGS) {
  const out = path.join(ROOT, T[lang].out);
  // wipe generated article folders so a renamed/deleted post does not linger
  if (fs.existsSync(out)) {
    for (const d of fs.readdirSync(out, { withFileTypes: true })) {
      if (d.isDirectory()) fs.rmSync(path.join(out, d.name), { recursive: true });
    }
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), listing(lang));
  fs.writeFileSync(path.join(out, 'feed.xml'), rss(lang));
  posts[lang].forEach((p, i) => {
    fs.mkdirSync(path.join(out, p.slug), { recursive: true });
    fs.writeFileSync(path.join(out, p.slug, 'index.html'), article(p, i));
  });
  console.log(`${lang}: ${posts[lang].length} article(s) → ${T[lang].out}/`);
  posts[lang].forEach((p) => console.log(`  ${T[lang].base}${p.slug}/  (${p.date}, ${p.minutes} min)`));
}
