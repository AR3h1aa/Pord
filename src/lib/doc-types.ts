// Block-level document model used by the editor.

export type BlockType =
  | "title"
  | "subtitle"
  | "h2"
  | "h3"
  | "paragraph"
  | "bullet"
  | "quote"
  | "callout"
  | "image"
  | "divider"
  | "table"
  | "code"
  | "spacer"
  | "columns"
  | "footnote" // inline footnote marker + footnote text (rendered below main content)
  | "toc" // auto-generated table of contents
  | "glossary" // auto-detected English-word glossary
  | "pageBreak"; // manual page break

export type FontSize = "sm" | "md" | "lg" | "xl";
export type BlockWidth = "full" | "wide" | "medium" | "narrow";

export interface BaseBlock {
  id: string;
  type: BlockType;
  // Per-block styling (optional; falls back to type defaults)
  fontSize?: FontSize;
  blockWidth?: BlockWidth;
  marginBottom?: number; // px override
}

export interface TextBlock extends BaseBlock {
  type:
    | "title"
    | "subtitle"
    | "h2"
    | "h3"
    | "paragraph"
    | "quote"
    | "callout";
  text: string;
}

export interface BulletBlock extends BaseBlock {
  type: "bullet";
  items: string[];
}

export interface ImageBlock extends BaseBlock {
  type: "image";
  src: string;
  caption: string;
  alt: string;
  width: number; // 0 = full width
  align: "start" | "center" | "end";
}

export interface DividerBlock extends BaseBlock {
  type: "divider";
}

export interface TableBlock extends BaseBlock {
  type: "table";
  rows: string[][]; // 2D array of cell text
  hasHeader: boolean; // first row styled as header
}

export interface CodeBlock extends BaseBlock {
  type: "code";
  code: string;
  language: string; // 'plain', 'javascript', 'python', 'bash', ...
}

export interface SpacerBlock extends BaseBlock {
  type: "spacer";
  height: number; // px
}

// Columns container — holds text-only blocks in N columns side by side
export interface ColumnsBlock extends BaseBlock {
  type: "columns";
  columnCount: 2 | 3;
  columns: TextBlock[][]; // each column is an array of text-type blocks
}

// Footnote block — represents a single footnote. It has an inline marker
// (auto-numbered based on order) and free-form text. The marker is inserted
// into the source block as a token like {{fn:ID}}.
export interface FootnoteBlock extends BaseBlock {
  type: "footnote";
  text: string;
  // sourceBlockId is set when the footnote is created from a text block; used for back-link.
  sourceBlockId?: string;
}

// TOC block — auto-generated table of contents. Has a config of which
// heading levels to include, plus a custom title.
export interface TocBlock extends BaseBlock {
  type: "toc";
  title: string;
  includeH2: boolean;
  includeH3: boolean;
  includeSubtitle: boolean;
}

// Glossary entry — a single detected English word plus its meaning.
export interface GlossaryEntry {
  id: string;
  word: string;
  meaning: string; // user-editable translation / explanation
}

// Glossary block — auto-detects English words from the whole document,
// then lets the user fill in meanings. Rendered as a full-page (or multi-page) section.
export interface GlossaryBlock extends BaseBlock {
  type: "glossary";
  title: string;
  entries: GlossaryEntry[]; // editable list
  autoDetect: boolean; // when true, scan the document for new English words on each render
  twoColumn: boolean; // render entries in 2 columns
}

// Manual page break — forces content after this block to a new A4 page.
export interface PageBreakBlock extends BaseBlock {
  type: "pageBreak";
}

export type Block =
  | TextBlock
  | BulletBlock
  | ImageBlock
  | DividerBlock
  | TableBlock
  | CodeBlock
  | SpacerBlock
  | ColumnsBlock
  | FootnoteBlock
  | TocBlock
  | GlossaryBlock
  | PageBreakBlock;

export interface DocMeta {
  title: string;
  author: string;
  date: string;
  // UI prefs persisted with the doc:
  showHeroSubtitle?: boolean; // show "ساخته‌شده با Pord" line under the title (default: true)
  showFooterCredit?: boolean; // show "سازنده ارشی/Arshi" footer line (default: true)
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "id-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function makeBlock(type: BlockType): Block {
  const id = newId();
  switch (type) {
    case "bullet":
      return { id, type, items: ["مورد اول", "مورد دوم"] };
    case "image":
      return { id, type, src: "", caption: "", alt: "", width: 0, align: "center" };
    case "divider":
      return { id, type };
    case "table":
      return {
        id,
        type,
        rows: [
          ["ستون ۱", "ستون ۲", "ستون ۳"],
          ["مقدار", "مقدار", "مقدار"],
        ],
        hasHeader: true,
      };
    case "code":
      return {
        id,
        type,
        code: "// کد خود را اینجا بنویسید\nconsole.log('سلام دنیا');",
        language: "javascript",
      };
    case "spacer":
      return { id, type, height: 32 };
    case "columns":
      return {
        id,
        type,
        columnCount: 2,
        columns: [
          [{ id: newId(), type: "paragraph", text: "متن ستون اول" }],
          [{ id: newId(), type: "paragraph", text: "متن ستون دوم" }],
        ],
      };
    case "footnote":
      return { id, type, text: "" };
    case "toc":
      return {
        id,
        type,
        title: "فهرست مطالب",
        includeH2: true,
        includeH3: true,
        includeSubtitle: false,
      };
    case "glossary":
      return { id, type, title: "لغت‌نامه", entries: [], autoDetect: true, twoColumn: true };
    case "pageBreak":
      return { id, type };
    default:
      return { id, type, text: "" };
  }
}

// Convert a block to a new type while preserving text content where possible.
export function convertBlock(block: Block, newType: BlockType): Block {
  if (block.type === newType) return block;
  const id = block.id;
  const style = {
    fontSize: block.fontSize,
    blockWidth: block.blockWidth,
    marginBottom: block.marginBottom,
  };

  // Extract text content from the source block
  let text = "";
  if ("text" in block) text = (block as TextBlock).text;
  else if (block.type === "bullet") text = block.items.join("\n");
  else if (block.type === "code") text = block.code;
  else if (block.type === "table") text = block.rows.map((r) => r.join(" ")).join("\n");
  else if (block.type === "columns")
    text = block.columns.flat().map((b) => b.text).join("\n");
  else if (block.type === "footnote") text = block.text;

  switch (newType) {
    case "title":
    case "subtitle":
    case "h2":
    case "h3":
    case "paragraph":
    case "quote":
    case "callout":
      return { id, type: newType, text, ...style };
    case "bullet":
      return {
        id,
        type: "bullet",
        items: text.split("\n").map((s) => s.trim()).filter(Boolean),
        ...style,
      };
    case "code":
      return { id, type: "code", code: text, language: "plain", ...style };
    case "image":
      return {
        id,
        type: "image",
        src: "",
        caption: "",
        alt: "",
        width: 0,
        align: "center",
        ...style,
      };
    case "divider":
      return { id, type: "divider", ...style };
    case "spacer":
      return { id, type: "spacer", height: 32, ...style };
    case "table":
      return {
        id,
        type: "table",
        rows: [[text || "عنوان"], ["مقدار"]],
        hasHeader: true,
        ...style,
      };
    case "columns":
      return {
        id,
        type: "columns",
        columnCount: 2,
        columns: [
          [{ id: newId(), type: "paragraph", text: text || "ستون اول" }],
          [{ id: newId(), type: "paragraph", text: "ستون دوم" }],
        ],
        ...style,
      };
    case "footnote":
      return { id, type: "footnote", text, ...style };
    case "toc":
      return {
        id,
        type: "toc",
        title: text || "فهرست مطالب",
        includeH2: true,
        includeH3: true,
        includeSubtitle: false,
        ...style,
      };
    case "glossary":
      return {
        id,
        type: "glossary",
        title: text || "لغت‌نامه",
        entries: [],
        autoDetect: true,
        twoColumn: true,
        ...style,
      };
    case "pageBreak":
      return { id, type: "pageBreak", ...style };
    default:
      return block;
  }
}

// Two adjacent blocks can be merged if they share a compatible content shape.
export function canMerge(a: Block, b: Block): boolean {
  const textTypes: BlockType[] = [
    "title",
    "subtitle",
    "h2",
    "h3",
    "paragraph",
    "quote",
    "callout",
  ];
  if (textTypes.includes(a.type) && textTypes.includes(b.type)) return true;
  if (a.type === "bullet" && b.type === "bullet") return true;
  if (a.type === "footnote" && b.type === "footnote") return true;
  return false;
}

export function mergeBlocks(a: Block, b: Block): Block | null {
  if (!canMerge(a, b)) return null;
  if (a.type === "bullet" && b.type === "bullet") {
    return { ...a, items: [...a.items, ...b.items] };
  }
  if (a.type === "footnote" && b.type === "footnote") {
    return { ...a, text: a.text + "\n" + b.text };
  }
  if ("text" in a && "text" in b) {
    return { ...a, text: (a as TextBlock).text + "\n" + (b as TextBlock).text };
  }
  return null;
}

// Smart import of plain text into a list of blocks.
// Detects markdown headings (#, ##, ###), bullet items (-, *, •), numbered
// lists (1., 2., …), quotes (>), callouts (!, Note:), code fences (```…```)
// and markdown tables (| col | col |).
export function parseTextToBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let bulletBuffer: string[] = [];
  let numberedBuffer: string[] = [];
  let paraBuffer: string[] = [];
  let codeBuffer: string[] | null = null;
  let codeLang = "plain";

  const flushBullets = () => {
    if (bulletBuffer.length > 0) {
      blocks.push({ id: newId(), type: "bullet", items: [...bulletBuffer] });
      bulletBuffer = [];
    }
  };
  const flushNumbered = () => {
    if (numberedBuffer.length > 0) {
      // We don't have a numbered-list type; reuse bullet type but the items
      // keep their numbers prepended for clarity.
      blocks.push({ id: newId(), type: "bullet", items: [...numberedBuffer] });
      numberedBuffer = [];
    }
  };
  const flushPara = () => {
    if (paraBuffer.length > 0) {
      const joined = paraBuffer.join(" ").trim();
      if (joined) blocks.push({ id: newId(), type: "paragraph", text: joined });
      paraBuffer = [];
    }
  };
  const flushAll = () => {
    flushBullets();
    flushNumbered();
    flushPara();
  };

  // Detect a markdown table: a line of form "| ... | ... |" followed by a
  // separator line "|---|---|" or "|:--|:-:|" etc.
  const isTableRow = (s: string) =>
    /^\s*\|.*\|\s*$/.test(s) && s.split("|").length >= 3;
  const isTableSeparator = (s: string) =>
    /^\s*\|?[\s:]*-+[\s:|-]*\|?\s*$/.test(s) && s.includes("-");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Inside a code fence — capture until closing fence
    if (codeBuffer !== null) {
      if (/^```\s*$/.test(trimmed)) {
        blocks.push({
          id: newId(),
          type: "code",
          code: codeBuffer.join("\n"),
          language: codeLang,
        });
        codeBuffer = null;
        codeLang = "plain";
      } else {
        codeBuffer.push(raw);
      }
      continue;
    }

    // Code fence opening — optionally with language
    const fenceMatch = trimmed.match(/^```([\w-]+)?\s*$/);
    if (fenceMatch) {
      flushAll();
      codeBuffer = [];
      codeLang = fenceMatch[1] || "plain";
      continue;
    }

    if (trimmed === "") {
      flushAll();
      continue;
    }

    // Markdown table block — consume consecutive table rows
    if (isTableRow(trimmed)) {
      const tableLines: string[] = [trimmed];
      let j = i + 1;
      // optional separator
      if (j < lines.length && isTableSeparator(lines[j].trim())) {
        j++;
      }
      while (j < lines.length && isTableRow(lines[j].trim())) {
        tableLines.push(lines[j].trim());
        j++;
      }
      flushAll();
      const rows = tableLines.map((row) =>
        row
          .replace(/^\s*\|/, "")
          .replace(/\|\s*$/, "")
          .split("|")
          .map((c) => c.trim())
      );
      blocks.push({
        id: newId(),
        type: "table",
        rows,
        hasHeader: true,
      });
      i = j - 1;
      continue;
    }

    if (/^###\s+/.test(trimmed)) {
      flushAll();
      blocks.push({ id: newId(), type: "h3", text: trimmed.replace(/^###\s+/, "") });
    } else if (/^##\s+/.test(trimmed)) {
      flushAll();
      blocks.push({ id: newId(), type: "h2", text: trimmed.replace(/^##\s+/, "") });
    } else if (/^#\s+/.test(trimmed)) {
      flushAll();
      blocks.push({ id: newId(), type: "title", text: trimmed.replace(/^#\s+/, "") });
    } else if (/^>\s+/.test(trimmed)) {
      flushAll();
      blocks.push({ id: newId(), type: "quote", text: trimmed.replace(/^>\s+/, "") });
    } else if (/^(Note|نکته|توجه)\s*[:：]\s*/i.test(trimmed)) {
      flushAll();
      blocks.push({
        id: newId(),
        type: "callout",
        text: trimmed.replace(/^(Note|نکته|توجه)\s*[:：]\s*/i, ""),
      });
    } else if (/^!\s+/.test(trimmed)) {
      flushAll();
      blocks.push({ id: newId(), type: "callout", text: trimmed.replace(/^!\s+/, "") });
    } else if (/^[-*•·▪►]\s+/.test(trimmed)) {
      flushNumbered();
      flushPara();
      bulletBuffer.push(trimmed.replace(/^[-*•·▪►]\s+/, ""));
    } else if (/^[\d\u06F0-\u06F9]+[.)]\s+/.test(trimmed)) {
      // Numbered list — Latin or Persian digits, with "." or ")" separator
      flushBullets();
      flushPara();
      numberedBuffer.push(trimmed.replace(/^[\d\u06F0-\u06F9]+[.)]\s+/, ""));
    } else {
      flushBullets();
      flushNumbered();
      paraBuffer.push(trimmed);
    }
  }
  flushAll();

  // Fallback: if nothing was detected, create one paragraph with the whole text
  if (blocks.length === 0 && text.trim()) {
    blocks.push({ id: newId(), type: "paragraph", text: text.trim() });
  }
  return blocks;
}

// Parse pasted HTML into blocks. Handles common patterns from AI chat UIs:
// <h1>-<h6>, <p>, <ul><li>, <ol><li>, <blockquote>, <pre><code>, <table>,
// <strong>/<b>-only lines as mini-headings, and <hr>.
export function parseHtmlToBlocks(html: string): Block[] {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    // SSR fallback — strip tags and parse as text
    return parseTextToBlocks(html.replace(/<[^>]+>/g, ""));
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks: Block[] = [];

  const pushText = (type: BlockType, text: string) => {
    const t = text.trim();
    if (!t) return;
    blocks.push({ id: newId(), type, text: t } as Block);
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === "h1") return pushText("title", el.textContent || "");
      if (tag === "h2") return pushText("h2", el.textContent || "");
      if (tag === "h3") return pushText("h3", el.textContent || "");
      if (tag === "h4" || tag === "h5" || tag === "h6")
        return pushText("h3", el.textContent || "");
      if (tag === "p") return pushText("paragraph", el.textContent || "");
      if (tag === "blockquote") return pushText("quote", el.textContent || "");
      if (tag === "hr") {
        blocks.push({ id: newId(), type: "divider" });
        return;
      }
      if (tag === "pre") {
        const codeEl = el.querySelector("code");
        const codeText = codeEl ? codeEl.textContent || "" : el.textContent || "";
        // Try to detect language from class like "language-js"
        let lang = "plain";
        if (codeEl) {
          const cls = codeEl.className || "";
          const m = cls.match(/language-([\w-]+)/);
          if (m) lang = m[1];
        }
        blocks.push({
          id: newId(),
          type: "code",
          code: codeText.replace(/\n$/, ""),
          language: lang,
        });
        return;
      }
      if (tag === "ul" || tag === "ol") {
        const items: string[] = [];
        el.querySelectorAll(":scope > li").forEach((li) => {
          const t = (li.textContent || "").trim();
          if (t) items.push(t);
        });
        if (items.length > 0) {
          blocks.push({ id: newId(), type: "bullet", items });
        }
        return;
      }
      if (tag === "table") {
        const rows: string[][] = [];
        el.querySelectorAll("tr").forEach((tr) => {
          const cells: string[] = [];
          tr.querySelectorAll("th,td").forEach((cell) => {
            cells.push((cell.textContent || "").trim());
          });
          if (cells.length > 0) rows.push(cells);
        });
        if (rows.length > 0) {
          const hasHeader = !!el.querySelector("th");
          blocks.push({ id: newId(), type: "table", rows, hasHeader });
        }
        return;
      }
      // For container elements (div, section, article, body), recurse into children
      if (
        tag === "div" ||
        tag === "section" ||
        tag === "article" ||
        tag === "body" ||
        tag === "main" ||
        tag === "header" ||
        tag === "footer" ||
        tag === "span"
      ) {
        el.childNodes.forEach(walk);
        return;
      }
      // For other inline elements, treat text content as paragraph
      const text = (el.textContent || "").trim();
      if (text) pushText("paragraph", text);
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || "").trim();
      if (text) pushText("paragraph", text);
    }
  };

  doc.body.childNodes.forEach(walk);
  if (blocks.length === 0 && (doc.body.textContent || "").trim()) {
    blocks.push({
      id: newId(),
      type: "paragraph",
      text: (doc.body.textContent || "").trim(),
    });
  }
  return blocks;
}

// ===== Helpers for footnotes, TOC, glossary =====

// Collect all footnote blocks in document order, returning the indexed list.
export function collectFootnotes(blocks: Block[]): FootnoteBlock[] {
  return blocks.filter((b): b is FootnoteBlock => b.type === "footnote");
}

// Generate a stable anchor id from a block id (used for TOC links).
export function headingAnchor(blockId: string): string {
  return "h-" + blockId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
}

// Generate a stable anchor id for a footnote.
export function footnoteAnchor(blockId: string): string {
  return "fn-" + blockId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
}

// Extract all heading-like blocks (subtitle, h2, h3) — title is excluded as it's the doc title.
export interface TocEntry {
  id: string;
  level: 1 | 2 | 3; // 1 = subtitle, 2 = h2, 3 = h3
  text: string;
}

export function collectTocEntries(
  blocks: Block[],
  opts: { includeSubtitle: boolean; includeH2: boolean; includeH3: boolean }
): TocEntry[] {
  const out: TocEntry[] = [];
  for (const b of blocks) {
    if (b.type === "subtitle" && opts.includeSubtitle) {
      out.push({ id: b.id, level: 1, text: b.text });
    } else if (b.type === "h2" && opts.includeH2) {
      out.push({ id: b.id, level: 2, text: b.text });
    } else if (b.type === "h3" && opts.includeH3) {
      out.push({ id: b.id, level: 3, text: b.text });
    }
  }
  return out;
}

// Detect all unique English words across all text-bearing blocks.
// Returns lowercased unique words, sorted alphabetically.
export function detectEnglishWords(blocks: Block[]): string[] {
  const set = new Set<string>();
  const push = (s: string) => {
    const matches = s.match(/[A-Za-z][A-Za-z'-]*/g);
    if (matches) {
      for (const m of matches) {
        const w = m.toLowerCase();
        // ignore very short tokens and pure numbers
        if (w.length >= 2) set.add(w);
      }
    }
  };
  for (const b of blocks) {
    if ("text" in b) push((b as TextBlock).text);
    else if (b.type === "bullet") b.items.forEach(push);
    else if (b.type === "code") push(b.code);
    else if (b.type === "table") b.rows.forEach((r) => r.forEach(push));
    else if (b.type === "columns")
      b.columns.forEach((col) => col.forEach((item) => push(item.text)));
    else if (b.type === "footnote") push(b.text);
    else if (b.type === "glossary") b.entries.forEach((e) => push(e.meaning));
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// Sync a glossary block with the document's detected English words:
// adds new entries for words not yet present, preserves user-entered meanings.
export function syncGlossaryEntries(
  block: GlossaryBlock,
  detected: string[]
): GlossaryBlock {
  if (!block.autoDetect) return block;
  const existingByWord = new Map(block.entries.map((e) => [e.word.toLowerCase(), e]));
  const merged: GlossaryEntry[] = detected.map((w) => {
    const ex = existingByWord.get(w);
    if (ex) return ex;
    return { id: newId(), word: w, meaning: "" };
  });
  return { ...block, entries: merged };
}

// Count words and characters across all text-bearing blocks.
export function countWordsAndChars(blocks: Block[]): { words: number; chars: number } {
  let words = 0;
  let chars = 0;
  const add = (s: string) => {
    if (!s) return;
    chars += s.length;
    const tokens = s.trim().split(/\s+/).filter(Boolean);
    words += tokens.length;
  };
  for (const b of blocks) {
    if ("text" in b) add((b as TextBlock).text);
    else if (b.type === "bullet") b.items.forEach(add);
    else if (b.type === "code") add(b.code);
    else if (b.type === "table") b.rows.forEach((r) => r.forEach(add));
    else if (b.type === "columns")
      b.columns.forEach((col) => col.forEach((item) => add(item.text)));
    else if (b.type === "footnote") add(b.text);
    else if (b.type === "glossary") b.entries.forEach((e) => add(e.word + " " + e.meaning));
  }
  return { words, chars };
}

// =============================================================================
// Round-trip TXT serialization
// =============================================================================
// Goal: serialize the full document (meta + all typed blocks, including tables,
// code, images-as-alt-text, columns, footnotes, TOC config, glossary entries,
// page breaks) to a plain .txt file that a human can still read, AND that
// re-imports back into the editor with all block types restored.
//
// Format: a small, line-oriented set of markers. Every marker starts with `§`
// (section sign) at the start of a line, which is unusual enough in normal
// Persian / English prose that false matches are essentially impossible.
//
// Header:
//   §DOC v1
//   §META title=...
//   §META author=...
//   §META date=...
//   §BLOCKS
//
// Per block (one line of header + body):
//   §T type=<type> [fontSize=..] [blockWidth=..] [marginBottom=..]
//   <body lines>
//   §E
//
// Body encoding rules per type:
//   - Text types: the text as-is (may span multiple lines).
//   - bullet: one item per line, prefixed with `- `.
//   - table: rows separated by `§R`, cells by `|` (cells cannot contain `|`,
//     so we escape `\|`). Header flag is on the §T line as `header=1|0`.
//   - code: the code as-is, lines preserved. Language on the §T line.
//   - columns: column count on §T line as `cols=2|3`; each column separated by
//     `§C`; items inside a column separated by `§I` followed by `type=...`
//     and the item's text.
//   - image: `src=...` is omitted (data URLs would bloat the file). We keep
//     caption, alt, width, align so the user can re-attach an image later.
//   - footnote: text body.
//   - toc: title + flags on the §T line.
//   - glossary: title + flags on §T line; entries follow as `§G word | meaning`.
//   - pageBreak / divider / spacer: only §T line, no body.
//
// We also escape any body line that starts with `§` by prefixing `\§` so the
// parser doesn't confuse it with a marker.

const TXT_MAGIC = "§DOC v1";

function escapeTxtLine(s: string): string {
  // Escape lines that would confuse the parser
  if (s.startsWith("§")) return "\\" + s;
  return s;
}
function unescapeTxtLine(s: string): string {
  if (s.startsWith("\\§")) return s.slice(1);
  return s;
}

function fmtAttrs(attrs: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === "" || v === false) continue;
    if (v === true) {
      parts.push(`${k}=1`);
    } else {
      // Escape `|` and `\` in values so we can split later
      const esc = String(v).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
      parts.push(`${k}=${esc}`);
    }
  }
  return parts.length ? " " + parts.join(" ") : "";
}

function parseAttrs(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  // line looks like: "§T type=paragraph fontSize=md marginBottom=12"
  const m = line.match(/^§T\s+(.*)$/);
  if (!m) return out;
  const rest = m[1];
  // Split on space but respect escaped spaces inside values
  const tokens: string[] = [];
  let buf = "";
  let i = 0;
  while (i < rest.length) {
    const c = rest[i];
    if (c === "\\" && i + 1 < rest.length) {
      buf += c + rest[i + 1];
      i += 2;
      continue;
    }
    if (c === " ") {
      if (buf) tokens.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf) tokens.push(buf);
  for (const t of tokens) {
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq);
    const v = t
      .slice(eq + 1)
      .replace(/\\(.)/g, (_m, c: string) => c);
    out[k] = v;
  }
  return out;
}

// Serialize a single block to its TXT representation (header line + body lines + §E)
function serializeBlockToTxt(block: Block): string[] {
  const lines: string[] = [];
  const baseAttrs: Record<string, string | number | boolean | undefined> = {
    type: block.type,
    fontSize: block.fontSize,
    blockWidth: block.blockWidth,
    marginBottom: block.marginBottom,
  };

  switch (block.type) {
    case "title":
    case "subtitle":
    case "h2":
    case "h3":
    case "paragraph":
    case "quote":
    case "callout": {
      lines.push(`§T${fmtAttrs(baseAttrs)}`);
      for (const l of (block.text || "").split("\n")) {
        lines.push(escapeTxtLine(l));
      }
      lines.push("§E");
      break;
    }
    case "bullet": {
      lines.push(`§T${fmtAttrs(baseAttrs)}`);
      for (const item of block.items) {
        for (const l of item.split("\n")) {
          lines.push("- " + escapeTxtLine(l));
        }
      }
      lines.push("§E");
      break;
    }
    case "divider": {
      lines.push(`§T${fmtAttrs(baseAttrs)}`);
      lines.push("§E");
      break;
    }
    case "pageBreak": {
      lines.push(`§T${fmtAttrs(baseAttrs)}`);
      lines.push("§E");
      break;
    }
    case "spacer": {
      lines.push(`§T${fmtAttrs({ ...baseAttrs, height: block.height })}`);
      lines.push("§E");
      break;
    }
    case "image": {
      // Do not serialize the data URL (it can be megabytes). Keep metadata.
      const attrs = {
        ...baseAttrs,
        caption: block.caption,
        alt: block.alt,
        width: block.width,
        align: block.align,
      };
      lines.push(`§T${fmtAttrs(attrs)}`);
      lines.push("[image src omitted — re-attach via image block editor]");
      lines.push("§E");
      break;
    }
    case "table": {
      const attrs = { ...baseAttrs, header: block.hasHeader ? 1 : 0 };
      lines.push(`§T${fmtAttrs(attrs)}`);
      for (const row of block.rows) {
        const escaped = row.map((c) => c.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " "));
        lines.push("§R " + escaped.join(" | "));
      }
      lines.push("§E");
      break;
    }
    case "code": {
      const attrs = { ...baseAttrs, language: block.language };
      lines.push(`§T${fmtAttrs(attrs)}`);
      for (const l of (block.code || "").split("\n")) {
        lines.push(escapeTxtLine(l));
      }
      lines.push("§E");
      break;
    }
    case "footnote": {
      lines.push(`§T${fmtAttrs({ ...baseAttrs, source: block.sourceBlockId })}`);
      for (const l of (block.text || "").split("\n")) {
        lines.push(escapeTxtLine(l));
      }
      lines.push("§E");
      break;
    }
    case "toc": {
      const attrs = {
        ...baseAttrs,
        title: block.title,
        h2: block.includeH2 ? 1 : 0,
        h3: block.includeH3 ? 1 : 0,
        subtitle: block.includeSubtitle ? 1 : 0,
      };
      lines.push(`§T${fmtAttrs(attrs)}`);
      lines.push("§E");
      break;
    }
    case "glossary": {
      const attrs = {
        ...baseAttrs,
        title: block.title,
        autoDetect: block.autoDetect ? 1 : 0,
        twoColumn: block.twoColumn ? 1 : 0,
      };
      lines.push(`§T${fmtAttrs(attrs)}`);
      for (const e of block.entries) {
        const word = e.word.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
        const meaning = e.meaning.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
        lines.push(`§G ${word} | ${meaning}`);
      }
      lines.push("§E");
      break;
    }
    case "columns": {
      const attrs = { ...baseAttrs, cols: block.columnCount };
      lines.push(`§T${fmtAttrs(attrs)}`);
      for (const col of block.columns) {
        lines.push("§C");
        for (const item of col) {
          lines.push(`§I type=${item.type}`);
          for (const l of (item.text || "").split("\n")) {
            lines.push(escapeTxtLine(l));
          }
        }
      }
      lines.push("§E");
      break;
    }
  }
  return lines;
}

// Serialize a full document (meta + blocks) to a TXT string.
export function serializeDocumentToTxt(meta: DocMeta, blocks: Block[]): string {
  const lines: string[] = [];
  lines.push(TXT_MAGIC);
  lines.push(`§META title=${(meta.title || "").replace(/\n/g, " ")}`);
  lines.push(`§META author=${(meta.author || "").replace(/\n/g, " ")}`);
  lines.push(`§META date=${(meta.date || "").replace(/\n/g, " ")}`);
  if (meta.showHeroSubtitle === false) lines.push("§META showHeroSubtitle=false");
  if (meta.showFooterCredit === false) lines.push("§META showFooterCredit=false");
  lines.push("§BLOCKS");
  for (const b of blocks) {
    lines.push(...serializeBlockToTxt(b));
  }
  return lines.join("\n") + "\n";
}

// Parse a TXT file produced by serializeDocumentToTxt back into meta + blocks.
// If the file does not start with the §DOC marker, falls back to the legacy
// parseTextToBlocks() behavior (so old .txt files still work).
export function parseTxtToDocument(
  text: string
): { meta?: DocMeta; blocks: Block[]; isNative: boolean } {
  const trimmed = text.replace(/^\uFEFF/, ""); // strip BOM
  if (!trimmed.startsWith("§DOC")) {
    return { blocks: parseTextToBlocks(trimmed), isNative: false };
  }

  const lines = trimmed.replace(/\r\n/g, "\n").split("\n");
  const meta: DocMeta = { title: "", author: "", date: "" };
  const blocks: Block[] = [];
  let i = 0;

  // Skip the magic line
  if (lines[i]?.startsWith("§DOC")) i++;

  // Parse META lines until §BLOCKS
  while (i < lines.length && !lines[i].startsWith("§BLOCKS")) {
    const line = lines[i];
    if (line.startsWith("§META ")) {
      const rest = line.slice("§META ".length);
      const eq = rest.indexOf("=");
      if (eq !== -1) {
        const k = rest.slice(0, eq);
        const v = rest.slice(eq + 1);
        if (k === "title") meta.title = v;
        else if (k === "author") meta.author = v;
        else if (k === "date") meta.date = v;
        else if (k === "showHeroSubtitle") meta.showHeroSubtitle = v !== "false";
        else if (k === "showFooterCredit") meta.showFooterCredit = v !== "false";
      }
    }
    i++;
  }
  if (lines[i]?.startsWith("§BLOCKS")) i++;

  // Parse blocks
  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith("§T ")) {
      i++;
      continue;
    }
    const attrs = parseAttrs(line);
    const type = (attrs.type as BlockType) || "paragraph";
    const fontSize = attrs.fontSize as FontSize | undefined;
    const blockWidth = attrs.blockWidth as BlockWidth | undefined;
    const marginBottom = attrs.marginBottom !== undefined
      ? +attrs.marginBottom
      : undefined;
    const baseId = newId();
    const style = { fontSize, blockWidth, marginBottom };

    i++;
    const bodyLines: string[] = [];
    while (i < lines.length && !lines[i].startsWith("§E") && !lines[i].startsWith("§T ") && !lines[i].startsWith("§C") && !lines[i].startsWith("§I ") && !lines[i].startsWith("§G ") && !lines[i].startsWith("§R ")) {
      bodyLines.push(unescapeTxtLine(lines[i]));
      i++;
    }

    switch (type) {
      case "title":
      case "subtitle":
      case "h2":
      case "h3":
      case "paragraph":
      case "quote":
      case "callout": {
        blocks.push({
          id: baseId,
          type,
          text: bodyLines.join("\n"),
          ...style,
        } as Block);
        // consume §E
        if (lines[i]?.startsWith("§E")) i++;
        break;
      }
      case "bullet": {
        const items: string[] = [];
        let currentItem: string[] = [];
        for (const l of bodyLines) {
          if (l.startsWith("- ")) {
            if (currentItem.length > 0) items.push(currentItem.join("\n"));
            currentItem = [l.slice(2)];
          } else {
            currentItem.push(l);
          }
        }
        if (currentItem.length > 0) items.push(currentItem.join("\n"));
        blocks.push({
          id: baseId,
          type: "bullet",
          items: items.length > 0 ? items : [""],
          ...style,
        });
        if (lines[i]?.startsWith("§E")) i++;
        break;
      }
      case "divider": {
        blocks.push({ id: baseId, type: "divider", ...style });
        if (lines[i]?.startsWith("§E")) i++;
        break;
      }
      case "pageBreak": {
        blocks.push({ id: baseId, type: "pageBreak", ...style });
        if (lines[i]?.startsWith("§E")) i++;
        break;
      }
      case "spacer": {
        const height = attrs.height !== undefined ? +attrs.height : 32;
        blocks.push({ id: baseId, type: "spacer", height, ...style });
        if (lines[i]?.startsWith("§E")) i++;
        break;
      }
      case "image": {
        blocks.push({
          id: baseId,
          type: "image",
          src: "",
          caption: attrs.caption || "",
          alt: attrs.alt || "",
          width: attrs.width !== undefined ? +attrs.width : 0,
          align: (attrs.align as "start" | "center" | "end") || "center",
          ...style,
        });
        if (lines[i]?.startsWith("§E")) i++;
        break;
      }
      case "table": {
        const rows: string[][] = [];
        // bodyLines may contain §R lines we didn't consume (since they start with §R not §T)
        // Re-scan from current line backward: bodyLines only got plain lines.
        // We need to read §R lines separately.
        const rawRows: string[] = [];
        // First, check if bodyLines already captured them (it shouldn't have)
        // Read forward from current line until §E
        while (i < lines.length && !lines[i].startsWith("§E")) {
          if (lines[i].startsWith("§R ")) {
            rawRows.push(lines[i].slice("§R ".length));
          }
          i++;
        }
        for (const r of rawRows) {
          // Split on | but respect \|
          const cells: string[] = [];
          let buf = "";
          let j = 0;
          while (j < r.length) {
            const c = r[j];
            if (c === "\\" && j + 1 < r.length) {
              buf += r[j + 1];
              j += 2;
              continue;
            }
            if (c === "|") {
              cells.push(buf.trim());
              buf = "";
              j++;
              // skip the space after |
              if (r[j] === " ") j++;
              continue;
            }
            buf += c;
            j++;
          }
          if (buf || cells.length > 0) cells.push(buf.trim());
          if (cells.length > 0) rows.push(cells);
        }
        blocks.push({
          id: baseId,
          type: "table",
          rows: rows.length > 0 ? rows : [["", ""]],
          hasHeader: attrs.header === "1" || attrs.header === "true",
          ...style,
        });
        if (lines[i]?.startsWith("§E")) i++;
        break;
      }
      case "code": {
        blocks.push({
          id: baseId,
          type: "code",
          code: bodyLines.join("\n"),
          language: attrs.language || "plain",
          ...style,
        });
        if (lines[i]?.startsWith("§E")) i++;
        break;
      }
      case "footnote": {
        blocks.push({
          id: baseId,
          type: "footnote",
          text: bodyLines.join("\n"),
          sourceBlockId: attrs.source,
          ...style,
        });
        if (lines[i]?.startsWith("§E")) i++;
        break;
      }
      case "toc": {
        blocks.push({
          id: baseId,
          type: "toc",
          title: attrs.title || "فهرست مطالب",
          includeH2: attrs.h2 !== "0",
          includeH3: attrs.h3 !== "0",
          includeSubtitle: attrs.subtitle === "1",
          ...style,
        });
        if (lines[i]?.startsWith("§E")) i++;
        break;
      }
      case "glossary": {
        const entries: { id: string; word: string; meaning: string }[] = [];
        // Read §G lines until §E
        while (i < lines.length && !lines[i].startsWith("§E")) {
          if (lines[i].startsWith("§G ")) {
            const rest = lines[i].slice("§G ".length);
            // Split on first unescaped |
            let word = "";
            let meaning = "";
            let buf = "";
            let j = 0;
            let foundPipe = false;
            while (j < rest.length) {
              const c = rest[j];
              if (c === "\\" && j + 1 < rest.length) {
                buf += rest[j + 1];
                j += 2;
                continue;
              }
              if (c === "|" && !foundPipe) {
                word = buf.trim();
                buf = "";
                foundPipe = true;
                j++;
                if (rest[j] === " ") j++;
                continue;
              }
              buf += c;
              j++;
            }
            if (foundPipe) {
              meaning = buf.trim();
            } else {
              word = buf.trim();
            }
            entries.push({ id: newId(), word, meaning });
          }
          i++;
        }
        blocks.push({
          id: baseId,
          type: "glossary",
          title: attrs.title || "لغت‌نامه",
          entries,
          autoDetect: attrs.autoDetect !== "0",
          twoColumn: attrs.twoColumn === "1" || attrs.twoColumn === "true",
          ...style,
        });
        if (lines[i]?.startsWith("§E")) i++;
        break;
      }
      case "columns": {
        const cols: TextBlock[][] = [];
        let currentCol: TextBlock[] | null = null;
        let currentItem: { type: BlockType; text: string[] } | null = null;
        // Re-scan from after the §T line, reading §C / §I / body until §E
        // Note: bodyLines above only captured non-marker lines, but for columns
        // we want to re-walk from i forward. The bodyLines approach above
        // already advanced i past body lines that don't start with § markers.
        // So we need to also process bodyLines here, but in column mode bodyLines
        // may be empty (because §C and §I are markers we stopped at).
        // Strategy: collect all remaining lines until §E, then walk them.
        const colLines: string[] = [];
        // First append any bodyLines we captured (text lines before any §C)
        colLines.push(...bodyLines);
        while (i < lines.length && !lines[i].startsWith("§E")) {
          colLines.push(lines[i]);
          i++;
        }
        for (const l of colLines) {
          if (l.startsWith("§C")) {
            if (currentItem) {
              currentCol!.push({
                id: newId(),
                type: currentItem.type as any,
                text: currentItem.text.join("\n"),
              } as TextBlock);
              currentItem = null;
            }
            if (currentCol) cols.push(currentCol);
            currentCol = [];
            continue;
          }
          if (l.startsWith("§I ")) {
            if (currentItem && currentCol) {
              currentCol.push({
                id: newId(),
                type: currentItem.type as any,
                text: currentItem.text.join("\n"),
              } as TextBlock);
            }
            const itemAttrs = parseAttrs("§T " + l.slice("§I ".length));
            currentItem = { type: (itemAttrs.type as BlockType) || "paragraph", text: [] };
            continue;
          }
          // Plain body line for current item
          if (currentItem) {
            currentItem.text.push(unescapeTxtLine(l));
          }
        }
        if (currentItem && currentCol) {
          currentCol.push({
            id: newId(),
            type: currentItem.type as any,
            text: currentItem.text.join("\n"),
          } as TextBlock);
        }
        if (currentCol) cols.push(currentCol);
        const colCount = (attrs.cols === "3" ? 3 : 2) as 2 | 3;
        blocks.push({
          id: baseId,
          type: "columns",
          columnCount: colCount,
          columns: cols.length > 0 ? cols : [[{ id: newId(), type: "paragraph", text: "" }]],
          ...style,
        });
        if (lines[i]?.startsWith("§E")) i++;
        break;
      }
      default: {
        // Unknown block type — skip to §E
        while (i < lines.length && !lines[i].startsWith("§E")) i++;
        if (lines[i]?.startsWith("§E")) i++;
        break;
      }
    }
  }

  return { meta, blocks, isNative: true };
}

// =============================================================================
// Saved snapshots — persistent named documents in localStorage
// =============================================================================

export interface SavedSnapshot {
  id: string;
  name: string;
  savedAt: number; // epoch millis
  meta: DocMeta;
  blocks: Block[];
}

const SNAPSHOTS_KEY = "doc-editor-snapshots";

export function loadSnapshots(): SavedSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr as SavedSnapshot[];
  } catch {
    return [];
  }
}

export function saveSnapshot(name: string, meta: DocMeta, blocks: Block[]): SavedSnapshot {
  const snap: SavedSnapshot = {
    id: newId(),
    name: name.trim() || "بدون نام",
    savedAt: Date.now(),
    meta: { ...meta },
    blocks: JSON.parse(JSON.stringify(blocks)) as Block[],
  };
  const all = loadSnapshots();
  all.unshift(snap);
  // Cap at 50 snapshots to avoid filling localStorage
  const capped = all.slice(0, 50);
  if (typeof window !== "undefined") {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(capped));
  }
  return snap;
}

export function deleteSnapshot(id: string): void {
  if (typeof window === "undefined") return;
  const all = loadSnapshots();
  const next = all.filter((s) => s.id !== id);
  localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(next));
}

export function renameSnapshot(id: string, newName: string): void {
  if (typeof window === "undefined") return;
  const all = loadSnapshots();
  const next = all.map((s) => (s.id === id ? { ...s, name: newName } : s));
  localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(next));
}

// Format an epoch-millis timestamp as a Persian-relative string.
export function formatSnapshotTime(t: number): string {
  try {
    const d = new Date(t);
    return d.toLocaleString("fa-IR", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}


// Default starter document so the editor doesn't open empty.
export function seedDocument(): { meta: DocMeta; blocks: Block[] } {
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  return {
    meta: {
      title: "گزارش نمونه",
      author: "تیم محتوا",
      date: iso,
    },
    blocks: [
      { id: newId(), type: "title", text: "گزارش نمونه با استایل سایت" },
      {
        id: newId(),
        type: "subtitle",
        text: "چگونه یک سند حرفه‌ای بسازیم که دقیقاً شبیه وب‌سایت ما به نظر برسد",
      },
      {
        id: newId(),
        type: "toc",
        title: "فهرست مطالب",
        includeH2: true,
        includeH3: true,
        includeSubtitle: false,
      },
      { id: newId(), type: "pageBreak" },
      {
        id: newId(),
        type: "paragraph",
        text:
          "این سند با همان فونت Vazirmatn، همان پالت رنگی آبی/نیلی/نارنجی و همان حال‌وهوای شیشه‌ای (glassmorphism) ساخته شده که در وب‌سایت استفاده می‌شود. هر بلوک قابل جابجایی است؛ روی دستگیره کنار هر بلوک بکشید تا ترتیب را عوض کنید. می‌توانید عکس اضافه کنید، عنوان و زیرعنوان بنویسید، فهرست نقطه‌ای بسازید و در نهایت به صورت PDF یا Word خروجی بگیرید.",
      },
      { id: newId(), type: "h2", text: "ویژگی‌های کلیدی ویرایشگر" },
      {
        id: newId(),
        type: "bullet",
        items: [
          "بلوک‌های عنوان، پاراگراف، نقل‌قول و فراخوانی (callout)",
          "افزودن عکس با کشیدن و رها کردن برای جابجایی",
          "خروجی PDF با حفظ کامل استایل و فونت سایت",
          "خروجی Word (.doc) با همان ظاهر برای ویرایش در Microsoft Word",
          "بلوک جدول، کد، فاصله (spacer) و چندستونه",
          "تنظیم اندازه فونت، عرض و فاصله هر بلوک",
          "تبدیل نوع بلوک و ادغام بلوک‌های مجاور",
          "ایمپورت متن خام (txt) به سند زیبا",
          "پاورقی، فهرست مطالب، لغت‌نامه و صفحه‌بندی A4",
        ],
      },
      {
        id: newId(),
        type: "callout",
        text:
          "نکته: قبل از خروجی گرفتن، پیش‌نمایش سند را مرور کنید. همه‌چیز دقیقاً همان‌طور که در صفحه می‌بینید در PDF نهایی ظاهر می‌شود.",
      },
      {
        id: newId(),
        type: "paragraph",
        text:
          "این پاراگراف برای نمایش قابلیت پاورقی است. می‌توانید روی دکمه «پاورقی» در تنظیمات بلوک بزنید تا یک پاورقی برای این بلوک بسازید. English words مثل React و TypeScript و PDF در این متن وجود دارند تا لغت‌نامه آن‌ها را تشخیص دهد.",
      },
      {
        id: newId(),
        type: "footnote",
        text: "این یک پاورقی نمونه است که در زیر کادر اصلی نمایش داده می‌شود.",
      },
      { id: newId(), type: "pageBreak" },
      { id: newId(), type: "h2", text: "لغت‌نامه اصطلاحات" },
      {
        id: newId(),
        type: "glossary",
        title: "لغت‌نامه",
        entries: [],
        autoDetect: true,
        twoColumn: true,
      },
    ],
  };
}
