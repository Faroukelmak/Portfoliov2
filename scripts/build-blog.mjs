#!/usr/bin/env node
/*
 * Static blog generator, zero dependency (marked is vendored).
 *
 *   node scripts/build-blog.mjs
 *
 * Reads   content/blog/*.md   (files starting with "_" and README.md are ignored)
 * Writes  blog/index.html            listing
 *         blog/<slug>/index.html     one page per article
 *         blog/feed.xml              RSS feed
 *
 * Front matter (between --- lines at the top of each .md):
 *   title:   Titre de l'article                 (required)
 *   date:    2026-11-24                         (required, YYYY-MM-DD)
 *   excerpt: Une phrase qui donne envie de lire (required)
 *   tags:    [OCR, ONNX, Production]
 *   slug:    mon-url                            (optional, defaults to the file name)
 *   draft:   true                               (optional, skipped when true)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from './vendor/marked.esm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'content/blog');
const OUT = path.join(ROOT, 'blog');
const SITE = 'https://faroukelmak.vercel.app';
const AUTHOR = 'Farouk El Makhchoune';
const LINKEDIN = 'https://www.linkedin.com/in/farouk-el-makhchoune-6753b1248/';
const GITHUB = 'https://github.com/Faroukelmak';

/* ---------------------------------------------------------------- helpers */
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const fmtDate = (d) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);

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

/* headings get stable ids, external links open in a new tab */
const renderer = new marked.Renderer();
renderer.heading = function ({ tokens, depth }) {
  const text = this.parser.parseInline(tokens);
  const id = slugify(text.replace(/<[^>]+>/g, ''));
  return `<h${depth} id="${id}">${text}</h${depth}>\n`;
};
renderer.link = function ({ href, title, tokens }) {
  const text = this.parser.parseInline(tokens);
  const ext = /^https?:\/\//.test(href) && !href.startsWith(SITE);
  return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}${ext ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
};
marked.use({ renderer, gfm: true });

/* favicon is shared with the landing page */
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const favicon = (indexHtml.match(/<link rel="icon"[^>]*>/) || [''])[0];

/* ---------------------------------------------------------------- read posts */
const posts = fs.readdirSync(SRC)
  .filter((f) => f.endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md')
  .map((f) => {
    const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(SRC, f), 'utf8'), f);
    const words = body.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length;
    return {
      ...meta,
      tags: Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : [],
      slug: meta.slug || slugify(path.basename(f, '.md')),
      dateObj: new Date(meta.date + 'T00:00:00Z'),
      minutes: Math.max(1, Math.round(words / 220)),
      html: marked.parse(body),
      text: body.replace(/```[\s\S]*?```/g, ' ').replace(/[#*_>`\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim(),
    };
  })
  .filter((p) => !p.draft)
  .sort((a, b) => b.dateObj - a.dateObj);

/* ---------------------------------------------------------------- shared chrome */
const ICONS = {
  in: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/><path d="M10 9v12"/><path d="M10 13a4 4 0 018 0v8"/></svg>',
  gh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 00-.9-2.6c3-.3 6.2-1.5 6.2-6.7A5.2 5.2 0 0019.9 5 4.9 4.9 0 0019.8.5S18.6.1 16 1.9a13.4 13.4 0 00-7 0C6.4.1 5.2.5 5.2.5A4.9 4.9 0 005.1 5a5.2 5.2 0 00-1.4 3.6c0 5.2 3.2 6.4 6.2 6.7a3.4 3.4 0 00-.9 2.6V22"/></svg>',
  arrow: '<svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
};

const head = ({ title, description, url, type = 'website', extra = '' }) => `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="${AUTHOR}">
<meta name="twitter:card" content="summary">
<meta name="author" content="${AUTHOR}">
<link rel="alternate" type="application/rss+xml" title="Blog · ${AUTHOR}" href="/blog/feed.xml">
${favicon}
<link rel="preload" href="/assets/fonts/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/blog.css">
${extra}</head>
<body>`;

const nav = () => `
<nav class="nav" id="nav">
  <a class="brand" href="/">FAROUK EL MAKHCHOUNE</a>
  <div class="nav-right">
    <a class="nav-link" href="/">Portfolio</a>
    <a class="nav-link" href="/blog/" aria-current="page">Blog</a>
    <a class="icon-btn" href="${LINKEDIN}" target="_blank" rel="noopener" aria-label="LinkedIn">${ICONS.in}</a>
    <a class="icon-btn" href="${GITHUB}" target="_blank" rel="noopener" aria-label="GitHub">${ICONS.gh}</a>
    <a class="nav-cta" href="/#contact">Me contacter</a>
  </div>
</nav>`;

const foot = () => `
<div class="wrap"><footer class="foot">
  <span>© ${new Date().getFullYear()} ${AUTHOR}</span>
  <span><a href="/">Portfolio</a> · <a href="/blog/feed.xml">RSS</a> · <a href="${LINKEDIN}" target="_blank" rel="noopener">LinkedIn</a></span>
</footer></div>
<script>
  (function(){var n=document.getElementById('nav');function f(){n.classList.toggle('scrolled',window.scrollY>24);}
  window.addEventListener('scroll',f,{passive:true});f();})();
</script>`;

const metaLine = (p) => `<time datetime="${p.date}">${fmtDate(p.dateObj)}</time><span class="sep">·</span>${p.minutes} min`;

/* ---------------------------------------------------------------- listing */
const listing = `${head({
  title: `Blog · ${AUTHOR}`,
  description: "Architectures de modèles, VLM, librairies Python, frameworks, LangChain, LangGraph : ce que je construis et décortique, un sujet à la fois.",
  url: `${SITE}/blog/`,
})}
${nav()}
<main class="wrap">
  <header class="blog-head">
    <span class="kicker rise">Blog</span>
    <h1 class="rise" style="animation-delay:.08s">Ce que je construis, <em>expliqué simplement.</em></h1>
    <p class="rise" style="animation-delay:.16s">Architectures de modèles, VLM, librairies Python, frameworks, middlewares LangChain, LangGraph… Un sujet à la fois, en quelques minutes de lecture.</p>
    <label class="search rise" style="animation-delay:.24s">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input id="q" type="search" placeholder="Rechercher : Qwen, LangGraph, VLM…" autocomplete="off" aria-label="Rechercher dans le blog">
      <kbd>/</kbd>
    </label>
  </header>
  ${posts.length ? `<ul class="posts rise"  style="animation-delay:.3s">
${posts.map((p) => `    <li class="post-row" data-s="${esc([p.title, p.excerpt, p.tags.join(' '), p.text].join(' '))}"><a href="/blog/${p.slug}/">
      <span class="meta">${metaLine(p)}</span>
      <div><h2>${esc(p.title)}</h2><p>${esc(p.excerpt)}</p><div class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>
      ${ICONS.arrow}
    </a></li>`).join('\n')}
  </ul>
  <p class="empty" id="none" hidden>Aucun article pour « <span id="qv"></span> » pour l'instant.</p>` : '<p class="empty">Premier article bientôt.</p>'}
</main>
${foot()}
<script>
  (function(){var q=document.getElementById('q');if(!q)return;
  var rows=[].slice.call(document.querySelectorAll('.post-row')),none=document.getElementById('none'),list=document.querySelector('.posts'),qv=document.getElementById('qv');
  function norm(s){return s.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');}
  rows.forEach(function(r){r._s=norm(r.dataset.s);});
  function run(){var words=norm(q.value).split(/\\s+/).filter(Boolean),n=0;
    rows.forEach(function(r){var ok=words.every(function(w){return r._s.indexOf(w)>-1;});r.hidden=!ok;if(ok)n++;});
    if(none){none.hidden=n>0;list.hidden=n===0;qv.textContent=q.value.trim();}
    var u=new URL(location.href);q.value.trim()?u.searchParams.set('q',q.value.trim()):u.searchParams.delete('q');history.replaceState(null,'',u);}
  q.addEventListener('input',run);
  var init=new URLSearchParams(location.search).get('q');if(init){q.value=init;run();}
  document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus();}
    if(e.key==='Escape'&&document.activeElement===q){q.value='';run();q.blur();}});})();
</script>
</body>
</html>
`;

/* ---------------------------------------------------------------- article */
const article = (p, i) => {
  const url = `${SITE}/blog/${p.slug}/`;
  const newer = posts[i - 1], older = posts[i + 1];
  const ld = {
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.excerpt,
    datePublished: p.date, author: { '@type': 'Person', name: AUTHOR, url: SITE }, mainEntityOfPage: url,
  };
  return `${head({
    title: `${p.title} · ${AUTHOR}`, description: p.excerpt, url, type: 'article',
    extra: `<meta property="article:published_time" content="${p.date}">\n${p.tags.map((t) => `<meta property="article:tag" content="${esc(t)}">`).join('\n')}\n<script type="application/ld+json">${JSON.stringify(ld)}</script>\n`,
  })}
<div class="progress" id="progress"></div>
${nav()}
<main>
  <article class="article">
    <a class="back rise" href="/blog/">${ICONS.back}Tous les articles</a>
    <div class="tags rise" style="animation-delay:.05s">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    <h1 class="rise" style="animation-delay:.1s">${esc(p.title)}</h1>
    <p class="lead rise" style="animation-delay:.16s">${esc(p.excerpt)}</p>
    <div class="byline rise" style="animation-delay:.22s">
      <span class="avatar">FE</span>
      <div><div class="who">${AUTHOR}</div><div class="meta">${metaLine(p)} de lecture</div></div>
    </div>
    <div class="prose rise" style="animation-delay:.28s">
${p.html}
    </div>
    <div class="share">
      <span>Partager</span>
      <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}" target="_blank" rel="noopener">LinkedIn</a>
      <a href="https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(p.title)}" target="_blank" rel="noopener">X</a>
      <button type="button" id="copy" data-url="${url}">Copier le lien</button>
    </div>
    ${newer || older ? `<nav class="pager" aria-label="Autres articles">
      ${older ? `<a href="/blog/${older.slug}/"><span class="meta">← Précédent</span><b>${esc(older.title)}</b></a>` : '<div></div>'}
      ${newer ? `<a class="next" href="/blog/${newer.slug}/"><span class="meta">Suivant →</span><b>${esc(newer.title)}</b></a>` : '<div></div>'}
    </nav>` : ''}
    <aside class="cta-box">
      <h2>Vous recrutez un Ingénieur IA ?</h2>
      <p>Je cherche mon premier CDI : agents, RAG, fine-tuning de modèles. Paris ou partout en France.</p>
      <a class="btn" href="/#contact">Me contacter</a>
    </aside>
  </article>
</main>
${foot()}
<script>
  (function(){var bar=document.getElementById('progress');
  function f(){var h=document.documentElement,max=h.scrollHeight-h.clientHeight;bar.style.transform='scaleX('+(max>0?h.scrollTop/max:0)+')';}
  window.addEventListener('scroll',f,{passive:true});f();
  var c=document.getElementById('copy');if(c)c.addEventListener('click',function(){
    var done=function(){c.textContent='Lien copié';setTimeout(function(){c.textContent='Copier le lien';},1800);};
    if(navigator.clipboard)navigator.clipboard.writeText(c.dataset.url).then(done,function(){});});})();
</script>
</body>
</html>
`;
};

/* ---------------------------------------------------------------- RSS */
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Blog · ${AUTHOR}</title>
  <link>${SITE}/blog/</link>
  <atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml"/>
  <description>Notes rapides sur l'IA en production.</description>
  <language>fr</language>
${posts.map((p) => `  <item>
    <title>${esc(p.title)}</title>
    <link>${SITE}/blog/${p.slug}/</link>
    <guid>${SITE}/blog/${p.slug}/</guid>
    <pubDate>${p.dateObj.toUTCString()}</pubDate>
    <description>${esc(p.excerpt)}</description>
${p.tags.map((t) => `    <category>${esc(t)}</category>`).join('\n')}
  </item>`).join('\n')}
</channel>
</rss>
`;

/* ---------------------------------------------------------------- write */
// wipe generated article folders so a renamed/deleted post does not linger
if (fs.existsSync(OUT)) {
  for (const d of fs.readdirSync(OUT, { withFileTypes: true })) {
    if (d.isDirectory()) fs.rmSync(path.join(OUT, d.name), { recursive: true });
  }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), listing);
fs.writeFileSync(path.join(OUT, 'feed.xml'), rss);
posts.forEach((p, i) => {
  fs.mkdirSync(path.join(OUT, p.slug), { recursive: true });
  fs.writeFileSync(path.join(OUT, p.slug, 'index.html'), article(p, i));
});
console.log(`blog: ${posts.length} article(s) → blog/`);
posts.forEach((p) => console.log(`  /blog/${p.slug}/  (${p.date}, ${p.minutes} min)`));
