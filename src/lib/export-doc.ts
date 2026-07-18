// Builds a self-contained HTML document (with inlined CSS + base64 font + base64 images)
// that reproduces the site's premium look. Used by both the PDF (print) and Word (.doc) exports.

import type {
  Block,
  DocMeta,
  FootnoteBlock,
  GlossaryBlock,
  TocBlock,
} from "./doc-types";
import {
  collectFootnotes,
  collectTocEntries,
  footnoteAnchor,
  headingAnchor,
} from "./doc-types";

// Inline Vazirmatn as base64 so the exported file renders identically even when offline.
let vazirRegularB64: string | null = null;
let vazirBoldB64: string | null = null;
let vazirMediumB64: string | null = null;

async function fetchFontAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function ensureFonts() {
  if (!vazirRegularB64) {
    const [r, m, b] = await Promise.all([
      fetchFontAsBase64("/fonts/Vazirmatn-Regular.woff2"),
      fetchFontAsBase64("/fonts/Vazirmatn-Medium.woff2"),
      fetchFontAsBase64("/fonts/Vazirmatn-Bold.woff2"),
    ]);
    vazirRegularB64 = r;
    vazirMediumB64 = m;
    vazirBoldB64 = b;
  }
  return { regular: vazirRegularB64!, medium: vazirMediumB64!, bold: vazirBoldB64! };
}

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function faDigit(input: string | number): string {
  const fa = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
  return String(input).replace(/\d/g, (d) => fa[+d]);
}

function formatFaDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso + "T00:00:00");
    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(d);
  } catch {
    return iso;
  }
}

const FONT_SIZE_PX: Record<string, number> = { sm: 12, md: 15, lg: 19, xl: 24 };
const WIDTH_PCT: Record<string, string> = {
  full: "100%",
  wide: "85%",
  medium: "65%",
  narrow: "45%",
};

// Build inline style string for a block (font-size, width, margin-bottom)
function blockStyleAttr(b: Block): string {
  const decls: string[] = [];
  if (b.fontSize) decls.push(`font-size:${FONT_SIZE_PX[b.fontSize]}px`);
  if (b.blockWidth && b.blockWidth !== "full") {
    decls.push(`width:${WIDTH_PCT[b.blockWidth]}`);
    decls.push("margin-left:auto");
    decls.push("margin-right:auto");
  }
  if (b.marginBottom !== undefined) decls.push(`margin-bottom:${b.marginBottom}px`);
  return decls.length ? ` style="${decls.join(";")}"` : "";
}

// Replace {{fn:ID}} tokens in text with proper footnote markers.
// footnoteNumberMap: Map<footnoteId, number>
function renderFootnoteTokens(
  text: string,
  fnNumberMap: Map<string, number>
): string {
  return text.replace(/\{\{fn:([a-zA-Z0-9_-]+)\}\}/g, (_m, fnId) => {
    const num = fnNumberMap.get(fnId);
    if (num == null) return "";
    const anchor = footnoteAnchor(fnId);
    return `<sup class="fn-ref"><a href="#${anchor}">[${faDigit(num)}]</a></sup>`;
  });
}

function renderBlock(
  b: Block,
  fnNumberMap: Map<string, number>,
  ctx?: { tocEntriesHtml?: string }
): string {
  const styleAttr = blockStyleAttr(b);
  switch (b.type) {
    case "title":
      return `<h1 class="doc-title" id="${headingAnchor(b.id)}"${styleAttr}>${esc(b.text)}</h1>`;
    case "subtitle":
      return `<h2 class="doc-subtitle" id="${headingAnchor(b.id)}"${styleAttr}>${esc(b.text)}</h2>`;
    case "h2":
      return `<h2 class="doc-h2" id="${headingAnchor(b.id)}"${styleAttr}>${esc(b.text)}</h2>`;
    case "h3":
      return `<h3 class="doc-h3" id="${headingAnchor(b.id)}"${styleAttr}>${esc(b.text)}</h3>`;
    case "paragraph":
      return `<p class="doc-paragraph"${styleAttr}>${renderFootnoteTokens(esc(b.text), fnNumberMap)}</p>`;
    case "bullet":
      return (
        `<ul class="doc-bullet"${styleAttr}>` +
        b.items.map((i) => `<li>${renderFootnoteTokens(esc(i), fnNumberMap)}</li>`).join("") +
        `</ul>`
      );
    case "quote":
      return `<blockquote class="doc-quote"${styleAttr}>${renderFootnoteTokens(esc(b.text), fnNumberMap)}</blockquote>`;
    case "callout":
      return `<div class="doc-callout"${styleAttr}>${renderFootnoteTokens(esc(b.text), fnNumberMap)}</div>`;
    case "divider":
      return `<hr class="doc-divider"${styleAttr} />`;
    case "image": {
      if (!b.src) return "";
      const alignCls =
        b.align === "start"
          ? "img-start"
          : b.align === "end"
          ? "img-end"
          : "img-center";
      const widthStyle = b.width > 0 ? ` style="max-width:${b.width}px"` : "";
      const cap = b.caption
        ? `<span class="doc-image-caption">${esc(b.caption)}</span>`
        : "";
      return `<figure class="doc-image ${alignCls}"${widthStyle}${styleAttr}><img src="${b.src}" alt="${esc(
        b.alt || b.caption || ""
      )}" />${cap}</figure>`;
    }
    case "table": {
      const headerHtml = b.hasHeader && b.rows.length > 0
        ? `<thead><tr>${b.rows[0].map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>`
        : "";
      const bodyRows = b.rows.slice(b.hasHeader ? 1 : 0);
      const bodyHtml = bodyRows
        .map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
        .join("");
      return `<table class="doc-table"${styleAttr}>${headerHtml}<tbody>${bodyHtml}</tbody></table>`;
    }
    case "code": {
      return (
        `<div class="doc-code-wrap"${styleAttr}>` +
        `<span class="doc-code-language">${esc(b.language || "plain")}</span>` +
        `<pre class="doc-code">${esc(b.code)}</pre>` +
        `</div>`
      );
    }
    case "spacer": {
      return `<div class="doc-spacer" style="height:${Math.max(16, b.height)}px"${styleAttr}></div>`;
    }
    case "columns": {
      const cols = b.columns
        .map(
          (col) =>
            `<div class="doc-column">${col
              .map((item) => renderColumnItem(item))
              .join("")}</div>`
        )
        .join("");
      return `<div class="doc-columns cols-${b.columnCount}"${styleAttr}>${cols}</div>`;
    }
    case "footnote": {
      // Render an inline anchor target — the actual footnote text is rendered in the footer section.
      return `<a id="${footnoteAnchor(b.id)}" class="fn-anchor" aria-hidden="true"></a>`;
    }
    case "toc": {
      return renderToc(b, ctx?.tocEntriesHtml ?? "");
    }
    case "glossary": {
      return renderGlossary(b);
    }
    case "pageBreak": {
      return `<div class="doc-pagebreak" aria-hidden="true"></div>`;
    }
    default:
      return "";
  }
}

function renderColumnItem(item: {
  type: string;
  text: string;
}): string {
  const tag =
    item.type === "title"
      ? "h1"
      : item.type === "h2"
      ? "h2"
      : item.type === "h3"
      ? "h3"
      : item.type === "quote"
      ? "blockquote"
      : "p";
  const cls =
    item.type === "title"
      ? "doc-title"
      : item.type === "h2"
      ? "doc-h2"
      : item.type === "h3"
      ? "doc-h3"
      : item.type === "quote"
      ? "doc-quote"
      : item.type === "callout"
      ? "doc-callout"
      : "doc-paragraph";
  return `<${tag} class="${cls}" style="margin:0 0 6px 0">${esc(item.text)}</${tag}>`;
}

function renderToc(block: TocBlock, entriesHtml: string): string {
  const isEmpty = !entriesHtml || entriesHtml.trim() === "";
  return `<div class="doc-toc" data-toc-id="${block.id}"${blockStyleAttr(block)}>
    <h2 class="doc-toc-title">${esc(block.title || "فهرست مطالب")}</h2>
    <div class="doc-toc-entries" data-toc-entries="${block.id}">
      ${isEmpty ? '<p class="doc-toc-empty">برای ساخت فهرست، عنوان‌های h2 یا h3 به سند اضافه کنید.</p>' : entriesHtml}
    </div>
  </div>`;
}

// Build the actual TOC entries HTML using target-counter for page numbers.
// This is called from buildBody where we have access to the full blocks list.
function renderTocEntries(
  blocks: Block[],
  tocBlock: TocBlock
): string {
  const entries: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.id === tocBlock.id) break;
    i++;
  }
  // Walk through all blocks (TOC entries reference all headings in the document,
  // not just the ones after the TOC block).
  const collected = collectTocEntries(blocks, {
    includeH2: tocBlock.includeH2,
    includeH3: tocBlock.includeH3,
    includeSubtitle: tocBlock.includeSubtitle,
  });
  for (const e of collected) {
    const anchor = headingAnchor(e.id);
    const indent = e.level === 1 ? 0 : e.level === 2 ? 14 : 28;
    const cls = e.level === 1 ? "lvl-1" : e.level === 2 ? "lvl-2" : "lvl-3";
    entries.push(
      `<a class="doc-toc-entry ${cls}" href="#${anchor}" style="padding-inline-start:${indent}px">
        <span class="doc-toc-text">${esc(e.text || "(بدون عنوان)")}</span>
        <span class="doc-toc-dots"></span>
        <span class="doc-toc-page"><a href="#${anchor}"></a></span>
      </a>`
    );
  }
  return entries.join("");
}

function renderGlossary(block: GlossaryBlock): string {
  const cols = block.twoColumn ? "two-col" : "one-col";
  const entriesHtml = block.entries.length === 0
    ? `<p class="doc-glossary-empty">هنوز کلمه‌ای شناسایی نشده است. در صورت فعال بودن تشخیص خودکار، با افزودن متن انگلیسی به سند، کلمات اینجا ظاهر می‌شوند.</p>`
    : block.entries
        .map(
          (e) =>
            `<div class="doc-glossary-entry">
              <span class="doc-glossary-word">${esc(e.word)}</span>
              <span class="doc-glossary-meaning">${esc(e.meaning || "—")}</span>
            </div>`
        )
        .join("");
  return `<div class="doc-glossary ${cols}"${blockStyleAttr(block)}>
    <h2 class="doc-glossary-title">${esc(block.title || "لغت‌نامه")}</h2>
    <div class="doc-glossary-list">${entriesHtml}</div>
  </div>`;
}

function buildStyles(): string {
  return `
@font-face {
  font-family: "Vazirmatn";
  src: url(data:font/woff2;base64,${"__REG__"}) format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: "Vazirmatn";
  src: url(data:font/woff2;base64,${"__MED__"}) format("woff2");
  font-weight: 500;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: "Vazirmatn";
  src: url(data:font/woff2;base64,${"__BLD__"}) format("woff2");
  font-weight: 700;
  font-style: normal;
  font-display: block;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  font-family: "Vazirmatn", "Segoe UI", sans-serif;
  text-align: right;
  direction: rtl;
  color: #0f172a;
  background: #ffffff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.page {
  max-width: 800px;
  margin: 0 auto;
  padding: 56px 56px 64px;
}
.hero {
  position: relative;
  overflow: hidden;
  border-radius: 22px;
  padding: 32px 32px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  background:
    linear-gradient(135deg,
      rgba(238, 242, 255, 0.96) 0%,
      rgba(228, 235, 252, 0.92) 50%,
      rgba(245, 230, 255, 0.94) 100%);
  box-shadow:
    0 1px 3px rgba(15, 23, 42, 0.05),
    0 12px 32px rgba(15, 23, 42, 0.10),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
  margin-bottom: 28px;
}
.hero::before {
  content: "";
  position: absolute;
  top: -40px; left: -40px;
  width: 220px; height: 220px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.16) 0%, transparent 70%);
  pointer-events: none;
}
.hero-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.hero-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid rgba(99, 102, 241, 0.28);
  background: rgba(255, 255, 255, 0.78);
  color: #3730a3;
}
.hero-pill.author {
  border-color: rgba(79, 70, 229, 0.18);
  color: #4338ca;
}
.hero-title {
  margin: 0 0 6px;
  font-size: 28px;
  line-height: 1.2;
  color: #0c1a3b;
  font-weight: 800;
}
.hero-sub {
  margin: 0;
  font-size: 15px;
  color: #475569;
  line-height: 1.7;
}
.content {
  position: relative;
  border-radius: 18px;
  padding: 28px 30px 30px;
  background: linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(248,250,255,0.92) 100%);
  border: 1px solid rgba(148, 163, 184, 0.22);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
}
.content > * + * { margin-top: 14px; }
.doc-title { font-size: 26px; font-weight: 800; color: #0c1a3b; line-height: 1.25; margin: 0; }
.doc-subtitle { font-size: 17px; font-weight: 600; color: #4338ca; margin: 0; }
.doc-h2 {
  font-size: 21px; font-weight: 700; color: #0c1a3b;
  margin: 6px 0 8px;
  padding-bottom: 8px;
  border-bottom: 2px solid rgba(99, 102, 241, 0.22);
  break-after: avoid;
  break-inside: avoid;
}
.doc-h3 { font-size: 18px; font-weight: 700; color: #1d4ed8; margin: 4px 0 6px; break-after: avoid; break-inside: avoid; }
.doc-paragraph { font-size: 14.5px; line-height: 2; color: #1e293b; margin: 0; }
.doc-bullet { list-style: none; padding: 0; margin: 0; }
.doc-bullet li {
  position: relative;
  padding-right: 24px;
  font-size: 14.5px;
  line-height: 1.95;
  color: #1e293b;
  margin-bottom: 6px;
}
.doc-bullet li::before {
  content: "";
  position: absolute;
  right: 6px;
  top: 0.7em;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #2563eb);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
}
.doc-quote {
  position: relative;
  padding: 12px 18px;
  border-right: 4px solid #6366f1;
  background: linear-gradient(135deg, rgba(238, 242, 255, 0.85), rgba(245, 243, 255, 0.85));
  border-radius: 10px;
  font-size: 15px;
  font-style: italic;
  color: #312e81;
  line-height: 1.85;
  margin: 0;
}
.doc-callout {
  padding: 12px 16px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(219, 234, 254, 0.95), rgba(232, 245, 255, 0.95));
  border: 1px solid rgba(59, 130, 246, 0.32);
  color: #1e3a8a;
  font-size: 14px;
  line-height: 1.85;
}
.doc-divider { height: 0; border: none; border-top: 2px dashed rgba(99, 102, 241, 0.35); margin: 8px 0; }
.doc-image {
  margin: 6px auto;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.14);
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: #fff;
  display: block;
  width: 100%;
  max-width: 100%;
  break-inside: avoid;
}
.doc-image.img-start { margin-right: 0; margin-left: auto; }
.doc-image.img-end { margin-left: 0; margin-right: auto; }
.doc-image img { display: block; width: 100%; height: auto; }
.doc-image-caption { display: block; margin-top: 6px; padding: 6px 8px; font-size: 12px; color: #64748b; text-align: center; }
.doc-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid rgba(99, 102, 241, 0.22);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
  font-size: 13px;
  margin: 6px 0;
  break-inside: avoid;
}
.doc-table th, .doc-table td {
  padding: 8px 11px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
  border-right: 1px solid rgba(148, 163, 184, 0.16);
  text-align: right;
  color: #1e293b;
  line-height: 1.6;
  vertical-align: top;
}
.doc-table th:first-child, .doc-table td:first-child { border-right: none; }
.doc-table th {
  background: linear-gradient(135deg, rgba(238, 242, 255, 0.95), rgba(232, 245, 255, 0.95));
  color: #1d4ed8;
  font-weight: 700;
  font-size: 12.5px;
}
.doc-table tbody tr:nth-child(even) td { background: rgba(248, 250, 255, 0.7); }
.doc-code-wrap { display: flex; flex-direction: column; align-items: flex-start; margin: 6px 0; break-inside: avoid; }
.doc-code-language {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 8px 8px 0 0;
  background: #1e1b4b;
  color: #c7d2fe;
  font-size: 10.5px;
  font-weight: 700;
  font-family: "Consolas", "Menlo", monospace;
  border: 1px solid rgba(99, 102, 241, 0.32);
  border-bottom: none;
}
.doc-code {
  direction: ltr;
  text-align: left;
  background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
  color: #e2e8f0;
  padding: 12px 14px;
  border-radius: 0 10px 10px 10px;
  font-family: "Consolas", "Menlo", "Courier New", monospace;
  font-size: 12px;
  line-height: 1.65;
  overflow-x: auto;
  border: 1px solid rgba(99, 102, 241, 0.32);
  white-space: pre;
  margin: 0;
  width: 100%;
}
.doc-spacer {
  width: 100%;
  background: transparent;
  display: block;
}
.doc-columns { display: grid; gap: 12px; width: 100%; margin: 6px 0; break-inside: avoid; }
.doc-columns.cols-2 { grid-template-columns: 1fr 1fr; }
.doc-columns.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
.doc-column {
  background: rgba(248, 250, 255, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 10px;
  padding: 10px 12px;
  min-width: 0;
}
.doc-column > * + * { margin-top: 6px; }

/* Footnote references and footer */
.fn-ref a {
  color: #1d4ed8;
  text-decoration: none;
  font-weight: 700;
  font-size: 0.75em;
  padding: 0 2px;
}
.fn-ref a:hover { text-decoration: underline; }
.fn-anchor { display: block; position: relative; top: -80px; visibility: hidden; }
.doc-footnotes {
  margin-top: 36px;
  padding: 18px 20px 16px;
  border-top: 2px solid rgba(99, 102, 241, 0.25);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(248, 250, 255, 0.7), rgba(255,255,255,0.4));
  break-inside: avoid;
}
.doc-footnotes-title {
  font-size: 14px;
  font-weight: 800;
  color: #1d4ed8;
  margin: 0 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px dashed rgba(99,102,241,0.32);
}
.doc-footnote-item {
  font-size: 12.5px;
  line-height: 1.85;
  color: #334155;
  margin-bottom: 6px;
  padding-right: 28px;
  position: relative;
}
.doc-footnote-num {
  position: absolute;
  right: 0;
  top: 0;
  font-weight: 700;
  color: #1d4ed8;
}
.doc-footnote-back {
  display: inline-block;
  margin-right: 4px;
  color: #6366f1;
  text-decoration: none;
  font-size: 11px;
}

/* Table of contents */
.doc-toc {
  background: linear-gradient(135deg, rgba(238,242,255,0.7), rgba(245,243,255,0.6));
  border: 1px solid rgba(99,102,241,0.22);
  border-radius: 14px;
  padding: 22px 26px;
  margin: 6px 0 14px;
  break-after: page;
  break-inside: avoid;
}
.doc-toc-title {
  font-size: 22px;
  font-weight: 800;
  color: #0c1a3b;
  margin: 0 0 14px;
  padding-bottom: 8px;
  border-bottom: 2px solid rgba(99,102,241,0.22);
}
.doc-toc-entries {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.doc-toc-entry {
  display: flex;
  align-items: baseline;
  gap: 8px;
  text-decoration: none;
  color: #1e293b;
  font-size: 14px;
  line-height: 1.9;
  padding: 2px 0;
  border-bottom: 1px dotted rgba(148,163,184,0.28);
}
.doc-toc-entry.lvl-1 { font-weight: 700; color: #0c1a3b; font-size: 15px; }
.doc-toc-entry.lvl-2 { font-weight: 600; color: #1d4ed8; }
.doc-toc-entry.lvl-3 { font-weight: 400; color: #475569; font-size: 13px; }
.doc-toc-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 80%; }
.doc-toc-dots {
  flex: 1;
  border-bottom: 1px dotted rgba(148,163,184,0.5);
  margin: 0 4px;
  transform: translateY(-3px);
}
.doc-toc-page {
  font-weight: 700;
  color: #1d4ed8;
  min-width: 28px;
  text-align: left;
}
.doc-toc-page::before {
  content: target-counter(attr(data-ref) attr(href), page);
}
.doc-toc-page a { color: inherit; text-decoration: none; }
.doc-toc-empty {
  font-size: 13px;
  color: #64748b;
  font-style: italic;
  margin: 0;
}

/* Glossary */
.doc-glossary {
  background: linear-gradient(135deg, rgba(238,242,255,0.7), rgba(255,250,240,0.6));
  border: 1px solid rgba(99,102,241,0.22);
  border-radius: 14px;
  padding: 22px 26px;
  margin: 6px 0 14px;
  break-before: page;
  break-inside: avoid;
}
.doc-glossary-title {
  font-size: 22px;
  font-weight: 800;
  color: #0c1a3b;
  margin: 0 0 14px;
  padding-bottom: 8px;
  border-bottom: 2px solid rgba(249,115,22,0.32);
}
.doc-glossary-list {
  display: grid;
  gap: 8px;
}
.doc-glossary.two-col .doc-glossary-list {
  grid-template-columns: 1fr 1fr;
}
.doc-glossary.one-col .doc-glossary-list {
  grid-template-columns: 1fr;
}
.doc-glossary-entry {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255,255,255,0.7);
  border: 1px solid rgba(148,163,184,0.18);
  break-inside: avoid;
}
.doc-glossary-word {
  font-weight: 700;
  color: #1d4ed8;
  font-size: 13.5px;
  direction: ltr;
  text-align: left;
  font-family: "Consolas", "Menlo", monospace;
}
.doc-glossary-meaning {
  font-size: 12.5px;
  color: #334155;
  line-height: 1.7;
}
.doc-glossary-empty {
  font-size: 13px;
  color: #64748b;
  font-style: italic;
  margin: 0;
  grid-column: 1 / -1;
}

/* Page break — forces a new A4 page in print */
.doc-pagebreak {
  break-after: page;
  page-break-after: always;
  height: 0;
  margin: 0;
  padding: 0;
}

.footer {
  margin-top: 22px;
  padding-top: 14px;
  border-top: 1px dashed rgba(148, 163, 184, 0.32);
  font-size: 11.5px;
  color: #94a3b8;
  text-align: center;
}
.footer .footer-line { margin: 0; }
.footer .footer-credit {
  margin-top: 6px;
  font-size: 11px;
  color: #64748b;
  font-weight: 600;
  letter-spacing: 0.2px;
}

/* A4 page rules — page size and page numbers in footer */
@page {
  size: A4;
  margin: 14mm 12mm 16mm 12mm;
  @bottom-center {
    content: "صفحه " counter(page) " از " counter(pages);
    font-family: "Vazirmatn", "Segoe UI", sans-serif;
    font-size: 10pt;
    color: #94a3b8;
  }
}
@media print {
  body { background: #fff !important; }
  .page { padding: 0 !important; max-width: none !important; }
  .hero, .content { box-shadow: none !important; }
  .doc-toc, .doc-glossary, .doc-footnotes { box-shadow: none !important; }
  /* Ensure each heading doesn't get orphaned at page bottom */
  .doc-h2, .doc-h3 { break-after: avoid; }
}
`.trim();
}

function buildBody(meta: DocMeta, blocks: Block[]): string {
  // Build footnote number map (in document order)
  const footnotes = collectFootnotes(blocks);
  const fnNumberMap = new Map<string, number>();
  footnotes.forEach((fn, idx) => {
    fnNumberMap.set(fn.id, idx + 1);
  });

  const showHeroSubtitle = meta.showHeroSubtitle !== false;
  const hero = `
    <header class="hero">
      <div class="hero-meta-row">
        ${meta.author ? `<span class="hero-pill author">نویسنده: ${esc(meta.author)}</span>` : ""}
        ${meta.date ? `<span class="hero-pill">تاریخ: ${esc(faDigit(formatFaDate(meta.date)))}</span>` : ""}
      </div>
      <h1 class="hero-title">${esc(meta.title || "سند بدون عنوان")}</h1>
      ${showHeroSubtitle ? `<p class="hero-sub">ساخته‌شده با Pord — ویرایشگر سند فارسی</p>` : ""}
    </header>
  `.trim();

  // Render each block; for TOC blocks, pass the precomputed entries HTML.
  const contentHtml = blocks
    .map((b) => {
      if (b.type === "toc") {
        const entriesHtml = renderTocEntries(blocks, b);
        return renderBlock(b, fnNumberMap, { tocEntriesHtml: entriesHtml });
      }
      return renderBlock(b, fnNumberMap);
    })
    .join("\n");

  const content = `<main class="content">${contentHtml}</main>`;

  // Footnotes section — rendered below the main content
  const footnotesHtml = footnotes.length
    ? `<section class="doc-footnotes">
        <h3 class="doc-footnotes-title">پاورقی‌ها</h3>
        ${footnotes
          .map((fn, idx) => {
            const num = idx + 1;
            const sourceAnchor = fn.sourceBlockId ? headingAnchor(fn.sourceBlockId) : null;
            return `<div class="doc-footnote-item" id="${footnoteAnchor(fn.id)}-note">
              <span class="doc-footnote-num">[${faDigit(num)}]</span>
              ${esc(fn.text)}
              ${sourceAnchor ? `<a class="doc-footnote-back" href="#${sourceAnchor}">↩</a>` : ""}
            </div>`;
          })
          .join("")}
      </section>`
    : "";

  const showFooterCredit = meta.showFooterCredit !== false;
  const footer = `<footer class="footer">
    <div class="footer-line">ساخته‌شده با Pord • ${esc(
      faDigit(formatFaDate(new Date().toISOString().slice(0, 10)))
    )}</div>
    ${showFooterCredit ? `<div class="footer-credit">سازنده ارشی / Arshi</div>` : ""}
  </footer>`;
  return `<div class="page">${hero}${content}${footnotesHtml}${footer}</div>`;
}

export interface ExportHtmlResult {
  html: string;
}

export async function buildExportHtml(
  meta: DocMeta,
  blocks: Block[]
): Promise<ExportHtmlResult> {
  const fonts = await ensureFonts();
  const css = buildStyles()
    .replace("__REG__", fonts.regular)
    .replace("__MED__", fonts.medium)
    .replace("__BLD__", fonts.bold);
  const body = buildBody(meta, blocks);
  const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${esc(meta.title || "سند")}</title>
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;
  return { html };
}

// Trigger the browser's print dialog (user can "Save as PDF")
export async function exportToPdf(meta: DocMeta, blocks: Block[]): Promise<void> {
  const { html } = await buildExportHtml(meta, blocks);
  const iframe = document.createElement("iframe");
  iframe.className = "export-iframe";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    throw new Error("iframe document unavailable");
  }
  doc.open();
  doc.write(html);
  doc.close();
  // Wait for fonts + images to settle before printing.
  await new Promise<void>((resolve) => {
    if (iframe.contentWindow && (iframe.contentWindow as any).onload !== undefined) {
      iframe.onload = () => resolve();
    }
    // Always resolve after a generous timeout to avoid hanging.
    setTimeout(resolve, 1500);
  });
  // Give the browser a moment to lay out and decode images.
  await new Promise((r) => setTimeout(r, 300));
  try {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
  } finally {
    // Clean up after a delay so the print dialog has time to open.
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {}
    }, 1500);
  }
}

// Download as a Word-openable .doc (HTML with MS Office namespace).
export async function exportToWord(meta: DocMeta, blocks: Block[]): Promise<void> {
  const { html } = await buildExportHtml(meta, blocks);
  // Wrap with MS Office namespace so Word opens with proper rendering.
  const docx =
    `<!doctype html>\n` +
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:w="urn:schemas-microsoft-com:office:word" ` +
    `xmlns="http://www.w3.org/TR/REC-html40" lang="fa" dir="rtl">\n` +
    `<head>\n<meta charset="utf-8" />\n` +
    `<title>${esc(meta.title || "سند")}</title>\n` +
    `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->\n` +
    `<style>\nhtml, body { direction: rtl; text-align: right; }\n${html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || ""}\n</style>\n` +
    `</head>\n<body>\n${html.match(/<body>([\s\S]*?)<\/body>/)?.[1] || ""}\n</body>\n</html>`;
  const blob = new Blob(["\ufeff", docx], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeTitle = (meta.title || "document").replace(/[\\/:*?"<>|]/g, "_").trim();
  a.href = url;
  a.download = `${safeTitle || "document"}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
