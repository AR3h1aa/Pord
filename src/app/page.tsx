"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  FileText,
  FileType2,
  Plus,
  Save,
  FileDown,
  Eye,
  Pencil,
  Sparkles,
  Upload,
  Download,
  FolderOpen,
  Trash2,
  Table as TableIcon,
  Code2,
  Square,
  Columns3,
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  Quote,
  Info,
  ImageIcon,
  Minus,
  Subtitles,
  Search,
  ClipboardPaste,
  Bookmark,
  BookOpen,
  ListTree,
  FileOutput,
  Languages,
  X,
  Edit3,
  RefreshCw,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import BlockEditor from "@/components/doc/BlockEditor";
import {
  Block,
  BlockType,
  DocMeta,
  GlossaryBlock,
  ImageBlock,
  SavedSnapshot,
  TextBlock,
  TocEntry,
  convertBlock,
  countWordsAndChars,
  collectTocEntries,
  deleteSnapshot,
  detectEnglishWords,
  formatSnapshotTime,
  headingAnchor,
  loadSnapshots,
  makeBlock,
  mergeBlocks,
  newId,
  parseHtmlToBlocks,
  parseTextToBlocks,
  parseTxtToDocument,
  renameSnapshot,
  saveSnapshot,
  seedDocument,
  serializeDocumentToTxt,
  syncGlossaryEntries,
} from "@/lib/doc-types";
import { exportToPdf, exportToWord } from "@/lib/export-doc";

type ViewMode = "edit" | "preview";

const FONT_SIZE_PX: Record<string, number> = { sm: 12, md: 15, lg: 19, xl: 24 };
const WIDTH_PCT: Record<string, string> = {
  full: "100%",
  wide: "85%",
  medium: "65%",
  narrow: "45%",
};

const CLIPBOARD_MIME = "application/x-doc-block+json";

export default function Home() {
  const initial = useMemo(() => seedDocument(), []);
  const [meta, setMeta] = useState<DocMeta>(initial.meta);
  const [blocks, setBlocks] = useState<Block[]>(initial.blocks);
  const [view, setView] = useState<ViewMode>("edit");
  const [exporting, setExporting] = useState<"pdf" | "word" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [pasteHint, setPasteHint] = useState<string | null>(null);

  // ===== Editor pagination =====
  // Splits the long block list into A4-style pages with prev/next navigation.
  const BLOCKS_PER_PAGE = 6;
  const [editorPage, setEditorPage] = useState(0);
  // Periodic autosave (every 60s) — shows a top-left toast with a spin animation
  const [autosavePulse, setAutosavePulse] = useState<"idle" | "saving" | "done">("idle");
  const [autosaveToastVisible, setAutosaveToastVisible] = useState(false);
  const autosaveToastTimerRef = useRef<number | null>(null);
  // Saved snapshots panel + save dialog
  const [snapshots, setSnapshots] = useState<SavedSnapshot[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const txtInputRef = useRef<HTMLInputElement>(null);
  const pendingImageIdRef = useRef<string | null>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const snapshotsPanelRef = useRef<HTMLDivElement>(null);
  const saveDialogRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ===== Pagination derived state =====
  const totalPages = Math.max(1, Math.ceil(blocks.length / BLOCKS_PER_PAGE));
  // Clamp current page if blocks shrank (e.g., after deletion).
  const safePage = Math.min(editorPage, totalPages - 1);
  const pageStart = safePage * BLOCKS_PER_PAGE;
  const pageEnd = Math.min(pageStart + BLOCKS_PER_PAGE, blocks.length);
  const pageBlocks = blocks.slice(pageStart, pageEnd);

  // When blocks count changes, keep editorPage in range.
  useEffect(() => {
    if (editorPage > totalPages - 1) setEditorPage(Math.max(0, totalPages - 1));
  }, [editorPage, totalPages]);

  // Merge BlockEditor's per-page changes back into the full blocks list.
  function handlePageBlocksChange(newPageBlocks: Block[]) {
    setBlocks((prev) => {
      const start = safePage * BLOCKS_PER_PAGE;
      const next = [...prev];
      // Overwrite positions [start .. start + newPageBlocks.length) with newPageBlocks.
      // This preserves reordering within the page (BlockEditor returns blocks in
      // the order it sees them), and keeps IDs intact so the rest of the document
      // is untouched.
      for (let i = 0; i < newPageBlocks.length; i++) {
        next[start + i] = newPageBlocks[i];
      }
      return next;
    });
  }

  // When a block is inserted, jump to the page that contains the new block.
  function insertBlockAndNavigate(type: BlockType, afterId?: string) {
    const newId = insertBlock(type, afterId);
    // Compute target page: where the new block lives.
    const idx = afterId
      ? blocks.findIndex((b) => b.id === afterId) + 1
      : blocks.length; // appended at end
    const targetPage = Math.floor(idx / BLOCKS_PER_PAGE);
    setEditorPage(Math.min(targetPage, totalPages)); // totalPages was computed before insert; clamp via effect
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem("doc-editor-state");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.meta) setMeta(parsed.meta);
        if (Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
          setBlocks(parsed.blocks);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem("doc-editor-state", JSON.stringify({ meta, blocks }));
        setSavedAt(new Date().toLocaleTimeString("fa-IR"));
      } catch {}
    }, 600);
    return () => clearTimeout(id);
  }, [meta, blocks]);

  // ===== Periodic autosave (every 60 seconds) =====
  // Keeps a live ref to the latest state so the interval callback always sees
  // up-to-date data without re-subscribing on every keystroke.
  const latestStateRef = useRef({ meta, blocks });
  useEffect(() => {
    latestStateRef.current = { meta, blocks };
  }, [meta, blocks]);

  useEffect(() => {
    const id = window.setInterval(() => {
      // Show "saving" state with spin animation
      setAutosavePulse("saving");
      setAutosaveToastVisible(true);

      // Save to localStorage (same key as the debounced autosave)
      try {
        const { meta: m, blocks: bs } = latestStateRef.current;
        localStorage.setItem("doc-editor-state", JSON.stringify({ meta: m, blocks: bs }));
        const now = new Date().toLocaleTimeString("fa-IR");
        setSavedAt(now);
      } catch {}

      // After ~700ms, switch to "done" state with check icon
      window.setTimeout(() => {
        setAutosavePulse("done");
      }, 700);

      // After 3.2s total, hide the toast
      if (autosaveToastTimerRef.current) {
        window.clearTimeout(autosaveToastTimerRef.current);
      }
      autosaveToastTimerRef.current = window.setTimeout(() => {
        setAutosaveToastVisible(false);
        setAutosavePulse("idle");
      }, 3200);
    }, 60_000); // 1 minute — production interval

    return () => {
      window.clearInterval(id);
      if (autosaveToastTimerRef.current) {
        window.clearTimeout(autosaveToastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showAddMenu) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAddMenu]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!pasteHint) return;
    const t = setTimeout(() => setPasteHint(null), 4000);
    return () => clearTimeout(t);
  }, [pasteHint]);

  // Load saved snapshots from localStorage on mount
  useEffect(() => {
    setSnapshots(loadSnapshots());
  }, []);

  // Click-outside handler for the snapshots panel and save dialog
  useEffect(() => {
    if (!showSnapshots && !showSaveDialog) return;
    const handler = (e: MouseEvent) => {
      if (
        snapshotsPanelRef.current &&
        !snapshotsPanelRef.current.contains(e.target as Node) &&
        saveDialogRef.current &&
        !saveDialogRef.current.contains(e.target as Node)
      ) {
        // Only close the panel; the save dialog has its own buttons
        const target = e.target as HTMLElement;
        // Don't close if the click was on the "saved" or "save" toolbar button
        if (!target.closest("[data-snapshot-toggle]")) {
          setShowSnapshots(false);
        }
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSnapshots, showSaveDialog]);

  // ===== Auto-detect English words and sync glossary blocks =====
  useEffect(() => {
    setBlocks((prev) => {
      const detected = detectEnglishWords(prev);
      let changed = false;
      const next = prev.map((b) => {
        if (b.type === "glossary" && b.autoDetect) {
          const synced = syncGlossaryEntries(b, detected);
          if (synced.entries !== b.entries) {
            changed = true;
            return synced;
          }
        }
        return b;
      });
      return changed ? next : prev;
    });
  }, [blocks.length, meta.title]);

  // ===== Live word/character count =====
  const { words, chars } = useMemo(() => countWordsAndChars(blocks), [blocks]);

  // ===== Search results: list of matching block indices =====
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const out: { idx: number; preview: string }[] = [];
    blocks.forEach((b, idx) => {
      const hay: string[] = [];
      if ("text" in b) hay.push((b as TextBlock).text);
      if (b.type === "bullet") hay.push(...b.items);
      if (b.type === "code") hay.push(b.code);
      if (b.type === "table") b.rows.forEach((r) => hay.push(...r));
      if (b.type === "columns")
        b.columns.forEach((c) => c.forEach((it) => hay.push(it.text)));
      if (b.type === "footnote") hay.push(b.text);
      if (b.type === "glossary")
        b.entries.forEach((e) => hay.push(e.word + " " + e.meaning));
      const found = hay.some((h) => h.toLowerCase().includes(q));
      if (found) {
        const preview = hay.find((h) => h.toLowerCase().includes(q)) || "";
        out.push({ idx, preview: preview.slice(0, 60) });
      }
    });
    return out;
  }, [searchQuery, blocks]);

  function showToast(msg: string) {
    setToast(msg);
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setBlocks((prev) => {
      const oldIdx = prev.findIndex((b) => b.id === active.id);
      const newIdx = prev.findIndex((b) => b.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(oldIdx, 1);
      next.splice(newIdx, 0, moved);
      return next;
    });
  }

  function insertBlock(type: BlockType, afterId?: string) {
    const b = makeBlock(type);
    setBlocks((prev) => {
      if (!afterId) return [...prev, b];
      const idx = prev.findIndex((x) => x.id === afterId);
      if (idx === -1) return [...prev, b];
      const next = [...prev];
      next.splice(idx + 1, 0, b);
      return next;
    });
    return b.id;
  }

  function insertAtEnd(type: BlockType) {
    insertBlock(type);
    setShowAddMenu(false);
  }

  function removeBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }

  function duplicateBlock(id: string) {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx === -1) return prev;
      const orig = prev[idx];
      const copy = deepCloneBlock(orig);
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }

  function moveUp(id: string) {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }

  function moveDown(id: string) {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx === -1 || idx === prev.length - 1) return prev;
      const next = [...prev];
      [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
      return next;
    });
  }

  function convertBlockType(id: string, newType: BlockType) {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx === -1) return prev;
      const converted = convertBlock(prev[idx], newType);
      const next = [...prev];
      next[idx] = converted;
      return next;
    });
    showToast("نوع بلوک تغییر کرد ✓");
  }

  function mergeWithNext(id: string) {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx === -1 || idx === prev.length - 1) return prev;
      const merged = mergeBlocks(prev[idx], prev[idx + 1]);
      if (!merged) {
        showToast("این دو بلوک قابل ادغام نیستند");
        return prev;
      }
      const next = [...prev];
      next[idx] = merged;
      next.splice(idx + 1, 1);
      return next;
    });
    showToast("بلوک‌ها ادغام شدند ✓");
  }

  // ===== Add a footnote for a given block =====
  function addFootnoteFor(blockId: string) {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === blockId);
      if (idx === -1) return prev;
      const fnId = newId();
      const fnBlock: Block = {
        id: fnId,
        type: "footnote",
        text: "",
        sourceBlockId: blockId,
      };
      // Inject {{fn:ID}} token at the end of the source block's text
      const next = [...prev];
      const src = next[idx];
      if ("text" in src) {
        const tb = src as TextBlock;
        next[idx] = { ...tb, text: tb.text + ` {{fn:${fnId}}}` } as Block;
      } else if (src.type === "bullet") {
        // Append the footnote marker to the last item
        const items = [...src.items];
        if (items.length > 0) {
          items[items.length - 1] = items[items.length - 1] + ` {{fn:${fnId}}}`;
        }
        next[idx] = { ...src, items } as Block;
      }
      next.splice(idx + 1, 0, fnBlock);
      return next;
    });
    showToast("پاورقی اضافه شد — متن آن را در بلوک جدید بنویسید");
  }

  function openImagePicker(id: string) {
    pendingImageIdRef.current = id;
    fileInputRef.current?.click();
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const id = pendingImageIdRef.current;
    pendingImageIdRef.current = null;
    if (!id) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === id && b.type === "image"
            ? { ...b, src: dataUrl, alt: b.alt || file.name }
            : b
        )
      );
      showToast("عکس اضافه شد ✓");
    };
    reader.readAsDataURL(file);
  }

  function openTxtPicker() {
    txtInputRef.current?.click();
  }

  // handleTxtChosen is defined further down (after snapshot handlers) so it
  // can use the native-format parser. The version near openTxtPicker has been
  // removed to avoid duplication.

  // ===== Copy block to clipboard (with custom MIME) =====
  async function copyBlockToClipboard(id: string) {
    const block = blocks.find((b) => b.id === id);
    if (!block) return;
    const payload = JSON.stringify({ type: CLIPBOARD_MIME, block });
    try {
      if (navigator.clipboard && navigator.clipboard.write) {
        // Use ClipboardItem with a custom MIME type
        const blob = new Blob([payload], { type: CLIPBOARD_MIME });
        // Some browsers don't allow custom MIME types — fallback below
        try {
          // @ts-expect-error ClipboardItem may not be in lib.dom for custom types
          const item = new ClipboardItem({
            [CLIPBOARD_MIME]: blob,
            "text/plain": new Blob([payload], { type: "text/plain" }),
          });
          await navigator.clipboard.write([item]);
          showToast("بلوک کپی شد — می‌توانید در این سند یا سند دیگر پیست کنید");
          setPasteHint("یک بلوک در کلیپ‌بورد آماده پیست است");
          return;
        } catch {
          // fall through
        }
      }
      // Fallback: use text/plain with our payload
      await navigator.clipboard.writeText(payload);
      showToast("بلوک کپی شد ✓");
      setPasteHint("یک بلوک در کلیپ‌بورد آماده پیست است");
    } catch {
      showToast("خطا در کپی —的可能 مرورگر اجازه دسترسی به کلیپ‌بورد را نمی‌دهد");
    }
  }

  // ===== Paste block from clipboard =====
  async function pasteBlockFromClipboard() {
    try {
      let text = "";
      if (navigator.clipboard && navigator.clipboard.readText) {
        text = await navigator.clipboard.readText();
      }
      if (!text) {
        showToast("کلیپ‌بورد خالی است");
        return;
      }
      const parsed = JSON.parse(text);
      if (parsed.type !== CLIPBOARD_MIME || !parsed.block) {
        showToast("محتوای کلیپ‌بورد یک بلوک ویرایشگر نیست");
        return;
      }
      const cloned = deepCloneBlock(parsed.block as Block);
      setBlocks((prev) => [...prev, cloned]);
      showToast("بلوک از کلیپ‌بورد پیست شد ✓");
    } catch {
      showToast("خطا در خواندن کلیپ‌بورد — لطفاً دوباره تلاش کنید");
    }
  }

  // ===== Smart paste into the editor canvas =====
  // Handles three clipboard payloads:
  //   1. Image files (Ctrl+V a screenshot) → image block(s) with embedded data URL
  //   2. HTML (e.g. copying from ChatGPT or a rendered markdown view) → parsed
  //      into typed blocks (headings, paragraphs, lists, tables, code, …)
  //   3. Plain text → parsed with markdown-style heuristics (same as .txt import)
  // The new blocks are inserted after the currently-focused block (or at end
  // if no block is focused). The original block's content is left untouched.
  function handleEditorPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const dt = e.clipboardData;
    if (!dt) return;

    // ----- 1. Image paste -----
    const imageItems: DataTransferItem[] = [];
    for (let i = 0; i < dt.items.length; i++) {
      const it = dt.items[i];
      if (it.type.startsWith("image/")) imageItems.push(it);
    }
    if (imageItems.length > 0) {
      e.preventDefault();
      // Find the focused block (if any)
      const focusId = focusedBlockId();
      imageItems.forEach((it) => {
        const file = it.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const newBlock: ImageBlock = {
            id: newId(),
            type: "image",
            src: dataUrl,
            caption: "",
            alt: file.name || "عکس پیست‌شده",
            width: 0,
            align: "center",
          };
          setBlocks((prev) => {
            if (!focusId) return [...prev, newBlock];
            const idx = prev.findIndex((b) => b.id === focusId);
            if (idx === -1) return [...prev, newBlock];
            const next = [...prev];
            next.splice(idx + 1, 0, newBlock);
            return next;
          });
        };
        reader.readAsDataURL(file);
      });
      showToast(`${imageItems.length} عکس از کلیپ‌بورد پیست شد ✓`);
      return;
    }

    // ----- 2. HTML paste (AI chat / web content) -----
    const html = dt.getData("text/html");
    const text = dt.getData("text/plain") || "";
    // If the user is editing inside a contentEditable text block and pasted
    // plain text without structure, let the browser do the default insert
    // (so the user keeps fine-grained cursor control).
    const editingTextBlock = isEditingTextBlock();

    if (html && html.trim()) {
      // Parse HTML into structured blocks
      const parsed = parseHtmlToBlocks(html);
      if (parsed.length === 0) {
        // HTML parsed to nothing — fall back to plain text
        if (!text.trim()) return;
        const textParsed = parseTextToBlocks(text);
        if (textParsed.length === 0) return;
        e.preventDefault();
        insertParsedBlocks(textParsed);
        return;
      }
      // If we parsed exactly ONE paragraph AND the user is actively editing
      // a text block, treat it as inline paste (let the browser handle it)
      // so the user keeps cursor control.
      if (
        parsed.length === 1 &&
        parsed[0].type === "paragraph" &&
        editingTextBlock
      ) {
        return; // do not preventDefault — let browser paste
      }
      e.preventDefault();
      insertParsedBlocks(parsed);
      return;
    }

    // ----- 3. Plain text paste with smart parsing -----
    if (!text.trim()) return;
    // For very short single-line pastes inside a text block, let the browser
    // handle it natively (preserves cursor position).
    if (editingTextBlock && !text.includes("\n")) {
      return;
    }
    const parsed = parseTextToBlocks(text);
    if (parsed.length === 0) return;
    if (parsed.length === 1 && parsed[0].type === "paragraph" && editingTextBlock) {
      return; // single paragraph — let native paste handle it
    }
    e.preventDefault();
    insertParsedBlocks(parsed);
  }

  // Determine which block (if any) currently has focus inside the editor.
  function focusedBlockId(): string | null {
    const active = document.activeElement;
    if (!active) return null;
    const wrap = (active as HTMLElement).closest("[data-block-id]") as HTMLElement | null;
    return wrap?.dataset.blockId || null;
  }

  function isEditingTextBlock(): boolean {
    const active = document.activeElement;
    if (!active) return false;
    const el = active as HTMLElement;
    if (el.isContentEditable) return true;
    const tag = el.tagName.toLowerCase();
    return tag === "input" || tag === "textarea";
  }

  // Insert a list of parsed blocks after the focused block (or at end).
  function insertParsedBlocks(parsed: Block[]) {
    const focusId = focusedBlockId();
    setBlocks((prev) => {
      if (!focusId) return [...prev, ...parsed];
      const idx = prev.findIndex((b) => b.id === focusId);
      if (idx === -1) return [...prev, ...parsed];
      const next = [...prev];
      next.splice(idx + 1, 0, ...parsed);
      return next;
    });
    showToast(`${parsed.length} بلوک از کلیپ‌بورد ساخته شد ✓`);
  }

  async function handleExportPdf() {
    setExporting("pdf");
    try {
      await exportToPdf(meta, blocks);
      showToast("پنجره چاپ باز شد — «Save as PDF» را انتخاب کنید");
    } catch (err) {
      console.error(err);
      showToast("خطا در ساخت PDF");
    } finally {
      setTimeout(() => setExporting(null), 1200);
    }
  }

  async function handleExportWord() {
    setExporting("word");
    try {
      await exportToWord(meta, blocks);
      showToast("فایل Word دانلود شد ✓");
    } catch (err) {
      console.error(err);
      showToast("خطا در ساخت Word");
    } finally {
      setTimeout(() => setExporting(null), 1200);
    }
  }

  function resetDoc() {
    if (!confirm("همه بلوک‌ها پاک شوند و یک سند خالی شروع شود؟")) return;
    const fresh = seedDocument();
    setMeta({ ...fresh.meta, title: "سند جدید", author: "" });
    setBlocks([
      { id: newId(), type: "title", text: "سند جدید" },
      { id: newId(), type: "paragraph", text: "" },
    ]);
  }

  // ===== Saved snapshots =====
  function openSaveDialog() {
    setSnapshotName(meta.title || "سند " + new Date().toLocaleDateString("fa-IR"));
    setShowSaveDialog(true);
    setShowSnapshots(false);
  }

  function confirmSaveSnapshot() {
    const name = snapshotName.trim() || "بدون نام";
    saveSnapshot(name, meta, blocks);
    setSnapshots(loadSnapshots());
    setShowSaveDialog(false);
    showToast(`«${name}» ذخیره شد ✓`);
  }

  function loadSnapshotById(id: string) {
    const snap = snapshots.find((s) => s.id === id);
    if (!snap) return;
    setMeta({ ...snap.meta });
    // Deep clone so editing doesn't mutate the saved snapshot
    setBlocks(JSON.parse(JSON.stringify(snap.blocks)) as Block[]);
    setShowSnapshots(false);
    showToast(`«${snap.name}» بارگذاری شد ✓`);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
  }

  function removeSnapshot(id: string) {
    const snap = snapshots.find((s) => s.id === id);
    if (!snap) return;
    if (!confirm(`سند ذخیره‌شده «${snap.name}» حذف شود؟`)) return;
    deleteSnapshot(id);
    setSnapshots(loadSnapshots());
    showToast("سند ذخیره‌شده حذف شد");
  }

  function renameSnapshotById(id: string) {
    const snap = snapshots.find((s) => s.id === id);
    if (!snap) return;
    const newName = prompt("نام جدید را وارد کنید:", snap.name);
    if (newName === null || newName.trim() === "") return;
    renameSnapshot(id, newName.trim());
    setSnapshots(loadSnapshots());
    showToast("نام تغییر کرد ✓");
  }

  // ===== Export TXT (round-trip native format) =====
  function handleExportTxt() {
    const txt = serializeDocumentToTxt(meta, blocks);
    const safeTitle = (meta.title || "document")
      .replace(/[\\/:*?\"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 60);
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeTitle || "document"}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("خروجی TXT ساخته شد — با ایمپورت txt قابل بازیابی است ✓");
  }

  // ===== Updated TXT import — detects native format and restores blocks =====
  function handleTxtChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const result = parseTxtToDocument(text);
      if (result.blocks.length === 0) {
        showToast("فایل خالی است");
        return;
      }
      if (result.isNative) {
        // Native format — full round-trip restore (meta + typed blocks)
        const replace = confirm(
          `${result.blocks.length} بلوک از فایل خوانده شد (فرمت بومی).\nOK = جایگزینی کل سند\nCancel = افزودن به انتهای سند فعلی`
        );
        if (replace) {
          if (result.meta) setMeta(result.meta);
          setBlocks(result.blocks);
        } else {
          setBlocks((prev) => [...prev, ...result.blocks]);
        }
        showToast(`${result.blocks.length} بلوک از فایل بازیابی شد ✓`);
      } else {
        // Legacy plain-text file — parse with markdown heuristics
        const parsed = result.blocks;
        const replace = confirm(
          `${parsed.length} بلوک از فایل خوانده شد (متن خام).\nOK = جایگزینی کل سند\nCancel = افزودن به انتهای سند فعلی`
        );
        if (replace) {
          setBlocks(parsed);
          if (parsed[0] && "text" in parsed[0]) {
            setMeta((m) => ({ ...m, title: (parsed[0] as TextBlock).text || m.title }));
          }
        } else {
          setBlocks((prev) => [...prev, ...parsed]);
        }
        showToast(`${parsed.length} بلوک ایمپورت شد ✓`);
      }
    };
    reader.readAsText(file);
  }

  // Scroll to a block by index when user clicks a search result
  function scrollToBlock(idx: number) {
    const el = document.querySelector(`[data-block-idx="${idx}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* ===== Header (site-style sticky glass bar) ===== */}
      <header className="site-header-bar">
        <div
          style={{
            width: "min(1280px, 94vw)",
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            padding: "0 1rem",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: 38,
                height: 38,
                borderRadius: 10,
                background: "linear-gradient(135deg, #1d4ed8, #6366f1)",
                color: "#fff",
                boxShadow: "0 6px 14px rgba(37,99,235,0.32)",
              }}
            >
              <FileText size={20} />
            </span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 800, color: "#0c1a3b", fontSize: 18, letterSpacing: "0.5px" }}>
                Pord
                <span style={{ fontSize: 11, color: "#6366f1", fontWeight: 600, marginInlineStart: 6 }}>
                  Persian Word
                </span>
              </span>
              <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>
                ویرایشگر سند فارسی • PDF / Word • A4
              </span>
            </div>
          </div>

          <div style={{ flex: 1 }} />

          {/* Search box */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="tool-pill ghost"
              onClick={() => setSearchOpen((v) => !v)}
              title="جستجو در سند"
              style={{
                background: searchOpen ? "#dbeafe" : undefined,
                color: searchOpen ? "#1d4ed8" : undefined,
              }}
            >
              <Search size={14} />
              <span>جستجو</span>
            </button>
            {searchOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  insetInlineEnd: 0,
                  width: 320,
                  background: "#fff",
                  border: "1px solid rgba(148,163,184,0.32)",
                  borderRadius: 10,
                  boxShadow: "0 12px 28px rgba(15,23,42,0.18)",
                  padding: 10,
                  zIndex: 50,
                }}
              >
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <Search size={14} style={{ color: "#64748b" }} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="جستجو در متن بلوک‌ها…"
                    autoFocus
                    style={{
                      flex: 1,
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: "1px solid rgba(148,163,184,0.32)",
                      background: "#fff",
                      fontFamily: "inherit",
                      fontSize: 13,
                      color: "#0c1a3b",
                      textAlign: "right",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setSearchOpen(false);
                    }}
                    style={{
                      width: 24,
                      height: 24,
                      display: "grid",
                      placeItems: "center",
                      border: "none",
                      background: "transparent",
                      color: "#64748b",
                      cursor: "pointer",
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
                {searchQuery.trim() && (
                  <div style={{ marginTop: 8, fontSize: 11.5, color: "#64748b" }}>
                    {searchResults.length} نتیجه یافت شد
                  </div>
                )}
                {searchResults.length > 0 && (
                  <div
                    style={{
                      marginTop: 6,
                      maxHeight: 260,
                      overflowY: "auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    {searchResults.map((r) => (
                      <button
                        key={r.idx}
                        type="button"
                        onClick={() => scrollToBlock(r.idx)}
                        style={{
                          textAlign: "right",
                          padding: "6px 8px",
                          borderRadius: 6,
                          border: "1px solid rgba(148,163,184,0.22)",
                          background: "rgba(248,250,255,0.7)",
                          fontFamily: "inherit",
                          fontSize: 12,
                          color: "#1e293b",
                          cursor: "pointer",
                          lineHeight: 1.5,
                        }}
                      >
                        <span style={{ color: "#1d4ed8", fontWeight: 700 }}>
                          بلوک {r.idx + 1}:
                        </span>{" "}
                        {r.preview}…
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            className="tool-pill ghost"
            onClick={pasteBlockFromClipboard}
            title="پیست بلوک از کلیپ‌بورد"
          >
            <ClipboardPaste size={14} />
            <span>پیست</span>
          </button>

          {/* View toggle */}
          <div
            style={{
              display: "inline-flex",
              background: "rgba(255,255,255,0.7)",
              border: "1px solid rgba(148,163,184,0.3)",
              borderRadius: 10,
              padding: 3,
              gap: 2,
            }}
          >
            <button
              type="button"
              onClick={() => setView("edit")}
              className="tool-pill"
              style={{
                padding: "6px 12px",
                background: view === "edit" ? "#1d4ed8" : "transparent",
                color: view === "edit" ? "#fff" : "#475569",
                border: "none",
                boxShadow: "none",
              }}
            >
              <Pencil size={14} />
              <span>ویرایش</span>
            </button>
            <button
              type="button"
              onClick={() => setView("preview")}
              className="tool-pill"
              style={{
                padding: "6px 12px",
                background: view === "preview" ? "#1d4ed8" : "transparent",
                color: view === "preview" ? "#fff" : "#475569",
                border: "none",
                boxShadow: "none",
              }}
            >
              <Eye size={14} />
              <span>پیش‌نمایش</span>
            </button>
          </div>

          <button
            type="button"
            className="tool-pill ghost"
            onClick={openTxtPicker}
            title="ایمپورت از فایل متنی (.txt) — هم متن خام و هم فرمت بومی ویرایشگر را تشخیص می‌دهد"
          >
            <Upload size={14} />
            <span>ایمپورت txt</span>
          </button>

          <button
            type="button"
            className="tool-pill ghost"
            onClick={handleExportTxt}
            title="خروجی TXT با حفظ نوع بلوک‌ها — با ایمپورت دوباره، سند دقیقاً همین‌طور برمی‌گردد"
          >
            <Download size={14} />
            <span>خروجی txt</span>
          </button>

          <button
            type="button"
            className="tool-pill ghost"
            onClick={openSaveDialog}
            data-snapshot-toggle="save"
            title="ذخیره‌ی نسخه‌ی فعلی سند برای ویرایش بعدی"
          >
            <Save size={14} />
            <span>ذخیره</span>
          </button>

          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="tool-pill ghost"
              onClick={() => {
                setShowSnapshots((v) => !v);
                setSnapshots(loadSnapshots());
              }}
              data-snapshot-toggle="open"
              title="سندهای ذخیره‌شده قبلی"
              style={{ position: "relative" }}
            >
              <FolderOpen size={14} />
              <span>سندهای من</span>
              {snapshots.length > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -4,
                    insetInlineEnd: -4,
                    background: "#6366f1",
                    color: "#fff",
                    borderRadius: 999,
                    minWidth: 16,
                    height: 16,
                    padding: "0 4px",
                    fontSize: 10,
                    fontWeight: 700,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {snapshots.length}
                </span>
              )}
            </button>
            {showSnapshots && (
              <div
                ref={snapshotsPanelRef}
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  insetInlineStart: 0,
                  width: 380,
                  maxHeight: 480,
                  overflowY: "auto",
                  background: "#fff",
                  border: "1px solid rgba(148,163,184,0.32)",
                  borderRadius: 12,
                  boxShadow: "0 16px 36px rgba(15,23,42,0.22)",
                  padding: 8,
                  zIndex: 60,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "4px 8px 8px",
                    borderBottom: "1px solid rgba(148,163,184,0.18)",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#0c1a3b",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <FolderOpen size={14} style={{ color: "#4338ca" }} />
                    سندهای ذخیره‌شده
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSnapshots(false)}
                    style={{
                      width: 22,
                      height: 22,
                      display: "grid",
                      placeItems: "center",
                      borderRadius: 5,
                      border: "none",
                      background: "transparent",
                      color: "#64748b",
                      cursor: "pointer",
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
                {snapshots.length === 0 ? (
                  <div
                    style={{
                      padding: "16px 12px",
                      textAlign: "center",
                      color: "#64748b",
                      fontSize: 12.5,
                      lineHeight: 1.7,
                    }}
                  >
                    هنوز سندی ذخیره نشده است.
                    <br />
                    روی دکمه‌ی «ذخیره» بزنید تا نسخه‌ی فعلی سند برای ویرایش بعدی ذخیره شود.
                  </div>
                ) : (
                  snapshots.map((snap) => (
                    <div
                      key={snap.id}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(148,163,184,0.16)",
                        background: "rgba(238,242,255,0.4)",
                        marginBottom: 4,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "#0c1a3b",
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={snap.name}
                        >
                          {snap.name}
                        </span>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            type="button"
                            onClick={() => renameSnapshotById(snap.id)}
                            title="تغییر نام"
                            style={{
                              width: 22,
                              height: 22,
                              display: "grid",
                              placeItems: "center",
                              borderRadius: 5,
                              border: "1px solid rgba(148,163,184,0.32)",
                              background: "#fff",
                              color: "#475569",
                              cursor: "pointer",
                            }}
                          >
                            <Edit3 size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSnapshot(snap.id)}
                            title="حذف"
                            style={{
                              width: 22,
                              height: 22,
                              display: "grid",
                              placeItems: "center",
                              borderRadius: 5,
                              border: "1px solid rgba(220,38,38,0.3)",
                              background: "#fff",
                              color: "#dc2626",
                              cursor: "pointer",
                            }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 6,
                          fontSize: 11,
                          color: "#64748b",
                        }}
                      >
                        <span>{formatSnapshotTime(snap.savedAt)}</span>
                        <span>
                          {snap.blocks.length} بلوک
                          {snap.meta.author ? " • " + snap.meta.author : ""}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => loadSnapshotById(snap.id)}
                        style={{
                          marginTop: 2,
                          padding: "5px 10px",
                          borderRadius: 6,
                          border: "1px solid #2563eb",
                          background: "linear-gradient(135deg, #2563eb, #4338ca)",
                          color: "#fff",
                          fontFamily: "inherit",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        بارگذاری این سند
                      </button>
                    </div>
                  ))
                )}
                {snapshots.length > 0 && (
                  <div
                    style={{
                      marginTop: 6,
                      padding: "6px 8px",
                      fontSize: 11,
                      color: "#64748b",
                      textAlign: "center",
                      borderTop: "1px solid rgba(148,163,184,0.18)",
                    }}
                  >
                    سندها فقط روی همین مرورگر ذخیره می‌شوند. برای انتقال به دستگاه دیگر،
                    از «خروجی txt» استفاده کنید.
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            className="tool-pill ghost"
            onClick={resetDoc}
            title="شروع سند جدید"
          >
            <Sparkles size={14} />
            <span>سند جدید</span>
          </button>

          {/* Toggle hero subtitle */}
          <button
            type="button"
            className="tool-pill ghost"
            onClick={() => setMeta({ ...meta, showHeroSubtitle: !(meta.showHeroSubtitle !== false) })}
            title="نمایش یا پنهان کردن زیرعنوان «ساخته‌شده با Pord» در بالای سند"
            style={{
              background: (meta.showHeroSubtitle !== false) ? "rgba(29,78,216,0.10)" : "transparent",
              color: (meta.showHeroSubtitle !== false) ? "#1d4ed8" : "#94a3b8",
              border: "1px solid " + ((meta.showHeroSubtitle !== false) ? "rgba(29,78,216,0.32)" : "rgba(148,163,184,0.32)"),
            }}
          >
            <Subtitles size={14} />
            <span>زیرعنوان</span>
          </button>

          {/* Toggle footer credit */}
          <button
            type="button"
            className="tool-pill ghost"
            onClick={() => setMeta({ ...meta, showFooterCredit: !(meta.showFooterCredit !== false) })}
            title="نمایش یا پنهان کردن امضای «سازنده ارشی/Arshi» در فوتر"
            style={{
              background: (meta.showFooterCredit !== false) ? "rgba(99,102,241,0.10)" : "transparent",
              color: (meta.showFooterCredit !== false) ? "#4338ca" : "#94a3b8",
              border: "1px solid " + ((meta.showFooterCredit !== false) ? "rgba(99,102,241,0.32)" : "rgba(148,163,184,0.32)"),
            }}
          >
            <Bookmark size={14} />
            <span>امضای فوتر</span>
          </button>

          <button
            type="button"
            className="tool-pill violet"
            onClick={handleExportWord}
            disabled={exporting !== null}
            style={{ opacity: exporting !== null ? 0.7 : 1 }}
          >
            <FileType2 size={14} />
            <span>{exporting === "word" ? "در حال ساخت…" : "خروجی Word"}</span>
          </button>

          <button
            type="button"
            className="tool-pill primary"
            onClick={handleExportPdf}
            disabled={exporting !== null}
            style={{ opacity: exporting !== null ? 0.7 : 1 }}
          >
            <FileDown size={14} />
            <span>{exporting === "pdf" ? "در حال ساخت…" : "خروجی PDF"}</span>
          </button>
        </div>
      </header>

      {/* ===== Document meta bar ===== */}
      <div
        style={{
          width: "min(1280px, 94vw)",
          margin: "1.2rem auto 0",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "0.7rem",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>
            عنوان سند
          </span>
          <input
            type="text"
            value={meta.title}
            onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            placeholder="عنوان سند…"
            style={metaInputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>
            نویسنده
          </span>
          <input
            type="text"
            value={meta.author}
            onChange={(e) => setMeta({ ...meta, author: e.target.value })}
            placeholder="نام نویسنده…"
            style={metaInputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>
            تاریخ
          </span>
          <input
            type="date"
            value={meta.date}
            onChange={(e) => setMeta({ ...meta, date: e.target.value })}
            style={{ ...metaInputStyle, textAlign: "right" }}
          />
        </label>
      </div>

      {/* ===== Toolbar (Add block) ===== */}
      <div
        style={{
          width: "min(1280px, 94vw)",
          margin: "0.8rem auto 0",
          display: "flex",
          gap: "0.5rem",
          alignItems: "center",
          flexWrap: "wrap",
          position: "relative",
        }}
      >
        <div ref={addMenuRef} style={{ position: "relative" }}>
          <button
            type="button"
            className="tool-pill primary"
            onClick={() => setShowAddMenu((v) => !v)}
          >
            <Plus size={14} />
            <span>افزودن بلوک</span>
          </button>
          {showAddMenu && (
            <BlockTypeMenuSimple
              onPick={(t) => {
                insertAtEnd(t);
              }}
            />
          )}
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 12,
            color: "#64748b",
            flexWrap: "wrap",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Save size={13} />
            {savedAt ? `ذخیره خودکار در ${savedAt}` : "ذخیره خودکار فعال"}
          </span>
          <span style={{ color: "#cbd5e1" }}>•</span>
          <span>{blocks.length} بلوک</span>
          <span style={{ color: "#cbd5e1" }}>•</span>
          <span style={{ color: "#1d4ed8", fontWeight: 700 }}>
            {words.toLocaleString("fa-IR")} کلمه
          </span>
          <span style={{ color: "#cbd5e1" }}>•</span>
          <span>{chars.toLocaleString("fa-IR")} کاراکتر</span>
        </div>
      </div>

      {/* ===== Paste hint banner ===== */}
      {pasteHint && (
        <div
          style={{
            width: "min(1280px, 94vw)",
            margin: "0.6rem auto 0",
            padding: "8px 14px",
            borderRadius: 10,
            background: "linear-gradient(135deg, #fef3c7, #fde68a)",
            border: "1px solid rgba(245,158,11,0.4)",
            color: "#92400e",
            fontSize: 12.5,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <ClipboardPaste size={14} />
          <span>{pasteHint}</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={pasteBlockFromClipboard}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid #92400e",
              background: "#92400e",
              color: "#fff",
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            پیست در سند
          </button>
          <button
            type="button"
            onClick={() => setPasteHint(null)}
            style={{
              width: 22,
              height: 22,
              display: "grid",
              placeItems: "center",
              border: "none",
              background: "transparent",
              color: "#92400e",
              cursor: "pointer",
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* ===== Main canvas ===== */}
      <main
        style={{
          width: "min(1280px, 94vw)",
          margin: "1rem auto 4rem",
          flex: "1 0 auto",
        }}
      >
        {view === "edit" ? (
          <div
            className="doc-paper"
            style={{ paddingInlineStart: 44 }}
            onPaste={handleEditorPaste}
          >
            <div className="doc-paper-deco" aria-hidden />

            {/* ===== Pagination nav (top) ===== */}
            {blocks.length > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "8px 14px",
                  marginBottom: 10,
                  borderRadius: 10,
                  background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(37,99,235,0.04))",
                  border: "1px solid rgba(99,102,241,0.18)",
                  position: "relative",
                  zIndex: 2,
                }}
              >
                <button
                  type="button"
                  onClick={() => setEditorPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid rgba(99,102,241,0.32)",
                    background: safePage === 0 ? "transparent" : "#fff",
                    color: safePage === 0 ? "#cbd5e1" : "#4338ca",
                    cursor: safePage === 0 ? "not-allowed" : "pointer",
                    fontWeight: 600,
                    fontSize: 12,
                    fontFamily: "inherit",
                  }}
                >
                  <ChevronRight size={14} />
                  صفحه قبل
                </button>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#0c1a3b" }}>
                    صفحه {faDigit(safePage + 1)} از {faDigit(totalPages)}
                  </span>
                  <span style={{ fontSize: 11, color: "#64748b" }}>
                    (بلوک‌های {faDigit(pageStart + 1)} تا {faDigit(pageEnd)} از {faDigit(blocks.length)})
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setEditorPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid rgba(99,102,241,0.32)",
                    background: safePage >= totalPages - 1 ? "transparent" : "#fff",
                    color: safePage >= totalPages - 1 ? "#cbd5e1" : "#4338ca",
                    cursor: safePage >= totalPages - 1 ? "not-allowed" : "pointer",
                    fontWeight: 600,
                    fontSize: 12,
                    fontFamily: "inherit",
                  }}
                >
                  صفحه بعد
                  <ChevronLeft size={14} />
                </button>
              </div>
            )}

            <div style={{ position: "relative", zIndex: 1 }}>
              {blocks.length === 0 ? (
                <div className="empty-hint">
                  هیچ بلوکی وجود ندارد. روی «افزودن بلوک» بزنید تا شروع کنید.
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  {pageBlocks.map((b, idx) => (
                    <div key={b.id} data-block-idx={idx} />
                  ))}
                  <BlockEditor
                    blocks={pageBlocks}
                    onChange={handlePageBlocksChange}
                    onInsertAfter={(id, t) => insertBlockAndNavigate(t, id)}
                    onRemove={removeBlock}
                    onDuplicate={duplicateBlock}
                    onMoveUp={moveUp}
                    onMoveDown={moveDown}
                    onConvert={convertBlockType}
                    onMergeWithNext={mergeWithNext}
                    onOpenImagePicker={openImagePicker}
                    onCopyBlock={copyBlockToClipboard}
                    onAddFootnoteFor={addFootnoteFor}
                    searchQuery={searchQuery}
                    allBlocks={blocks}
                  />
                </DndContext>
              )}

              {/* Page-end footer marker — visual cue that we're on a paged view */}
              {blocks.length > 0 && (
                <div
                  style={{
                    marginTop: 24,
                    padding: "10px 14px",
                    borderTop: "2px dashed rgba(99,102,241,0.24)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 11,
                    color: "#64748b",
                  }}
                >
                  <span>
                    پایان صفحه {faDigit(safePage + 1)}
                  </span>
                  <span>
                    {safePage < totalPages - 1
                      ? "برای دیدن ادامه، صفحه بعد را بزنید"
                      : "این آخرین صفحه است"}
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <PreviewPane meta={meta} blocks={blocks} />
        )}

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileChosen}
        />
        <input
          ref={txtInputRef}
          type="file"
          accept=".txt,text/plain"
          style={{ display: "none" }}
          onChange={handleTxtChosen}
        />
      </main>

      {/* ===== Footer ===== */}
      <footer
        style={{
          width: "100%",
          padding: "1.6rem 1rem",
          textAlign: "center",
          color: "#64748b",
          fontSize: 12,
          borderTop: "1px solid rgba(15,23,42,0.08)",
          background: "rgba(255,255,255,0.6)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div>
          ساخته‌شده با فونت Vazirmatn و تم سایت — خروجی PDF و Word با حفظ کامل استایل و
          صفحه‌بندی A4
        </div>
        <div style={{ marginTop: 6, fontWeight: 600, color: "#4338ca" }}>
          Pord — Persian Word • سازنده ارشی / Arshi
        </div>
      </footer>

      {/* ===== Save snapshot dialog ===== */}
      {showSaveDialog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.5)",
            backdropFilter: "blur(4px)",
            display: "grid",
            placeItems: "center",
            zIndex: 100,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSaveDialog(false);
          }}
        >
          <div
            ref={saveDialogRef}
            style={{
              width: "min(440px, 94vw)",
              background: "#fff",
              borderRadius: 16,
              border: "1px solid rgba(148,163,184,0.32)",
              boxShadow: "0 24px 56px rgba(15,23,42,0.32)",
              padding: 22,
              fontFamily: "inherit",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  display: "grid",
                  placeItems: "center",
                  background: "linear-gradient(135deg, #6366f1, #2563eb)",
                  color: "#fff",
                }}
              >
                <Save size={18} />
              </div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#0c1a3b" }}>
                  ذخیره‌ی سند
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                  سند با تمام بلوک‌ها و تنظیمات در مرورگر شما ذخیره می‌شود
                </div>
              </div>
            </div>
            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "#475569",
                marginBottom: 6,
              }}
            >
              نام سند
            </label>
            <input
              type="text"
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              autoFocus
              placeholder="مثلاً: گزارش فروش تابستان"
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmSaveSnapshot();
                if (e.key === "Escape") setShowSaveDialog(false);
              }}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(148,163,184,0.32)",
                background: "#fff",
                fontFamily: "inherit",
                fontSize: 14,
                color: "#0c1a3b",
                textAlign: "right",
              }}
            />
            <div
              style={{
                marginTop: 10,
                padding: "8px 10px",
                background: "rgba(238,242,255,0.7)",
                border: "1px dashed rgba(99,102,241,0.3)",
                borderRadius: 8,
                fontSize: 11.5,
                color: "#475569",
                lineHeight: 1.7,
              }}
            >
              <strong style={{ color: "#4338ca" }}>اطلاعات سند:</strong>{" "}
              {blocks.length} بلوک • عنوان: «{meta.title || "بدون عنوان"}»
              {meta.author ? " • نویسنده: " + meta.author : ""}
              <br />
              برای انتقال بین دستگاه‌ها از «خروجی txt» استفاده کنید.
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 16,
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={() => setShowSaveDialog(false)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid rgba(148,163,184,0.32)",
                  background: "#fff",
                  color: "#475569",
                  fontFamily: "inherit",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                لغو
              </button>
              <button
                type="button"
                onClick={confirmSaveSnapshot}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(135deg, #2563eb, #4338ca)",
                  color: "#fff",
                  fontFamily: "inherit",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(99,102,241,0.32)",
                }}
              >
                ذخیره کن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Toast ===== */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "10px 18px",
            borderRadius: 12,
            background: "linear-gradient(135deg, #1d4ed8, #6366f1)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 12px 28px rgba(37,99,235,0.4)",
            zIndex: 100,
            animation: "blockEnter 220ms ease both",
          }}
        >
          {toast}
        </div>
      )}

      {/* ===== Periodic autosave toast (top-left, with animation) ===== */}
      <div
        className={`autosave-toast ${autosaveToastVisible ? "is-visible" : ""}`}
        aria-live="polite"
        dir="rtl"
      >
        <div className="autosave-toast-inner">
          <span className="autosave-toast-icon" aria-hidden>
            {autosavePulse === "saving" ? (
              <RefreshCw size={15} className="autosave-spin" />
            ) : autosavePulse === "done" ? (
              <CheckCircle2 size={15} />
            ) : (
              <Save size={15} />
            )}
          </span>
          <span className="autosave-toast-text">
            {autosavePulse === "saving"
              ? "در حال ذخیره خودکار…"
              : autosavePulse === "done"
              ? `ذخیره خودکار شد • ${savedAt ?? ""}`
              : "ذخیره خودکار فعال"}
          </span>
          <span className="autosave-toast-progress" aria-hidden>
            <span className="autosave-toast-progress-bar" />
          </span>
        </div>
      </div>
    </div>
  );
}

// Deep clone a block, assigning new ids to the block itself and any nested items
// (so the pasted copy is independent of the source).
function deepCloneBlock(b: Block): Block {
  const clone = { ...b, id: newId() } as Block;
  if (clone.type === "bullet") {
    clone.items = [...b.items];
  } else if (clone.type === "table") {
    clone.rows = b.rows.map((r) => [...r]);
  } else if (clone.type === "columns") {
    clone.columns = b.columns.map((col) =>
      col.map((it) => ({ ...it, id: newId() }))
    );
  } else if (clone.type === "glossary") {
    clone.entries = b.entries.map((e) => ({ ...e, id: newId() }));
  } else if (clone.type === "footnote") {
    // Clear sourceBlockId since the new footnote is independent
    clone.sourceBlockId = undefined;
  }
  return clone;
}

const metaInputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,0.32)",
  background: "rgba(255,255,255,0.92)",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 600,
  color: "#0c1a3b",
  width: "100%",
  textAlign: "right",
};

// Compact add-block dropdown (mirrors the per-block menu)
function BlockTypeMenuSimple({ onPick }: { onPick: (t: BlockType) => void }) {
  const items: { type: BlockType; label: string; icon: React.ReactNode }[] = [
    { type: "title", label: "عنوان اصلی", icon: <Heading1 size={14} /> },
    { type: "subtitle", label: "زیرعنوان", icon: <Subtitles size={14} /> },
    { type: "h2", label: "تیتر بخش", icon: <Heading2 size={14} /> },
    { type: "h3", label: "تیتر فرعی", icon: <Heading3 size={14} /> },
    { type: "paragraph", label: "پاراگراف", icon: <Type size={14} /> },
    { type: "bullet", label: "فهرست نقطه‌ای", icon: <List size={14} /> },
    { type: "quote", label: "نقل‌قول", icon: <Quote size={14} /> },
    { type: "callout", label: "فراخوانی (callout)", icon: <Info size={14} /> },
    { type: "image", label: "عکس", icon: <ImageIcon size={14} /> },
    { type: "table", label: "جدول", icon: <TableIcon size={14} /> },
    { type: "code", label: "کد", icon: <Code2 size={14} /> },
    { type: "columns", label: "چندستونه", icon: <Columns3 size={14} /> },
    { type: "spacer", label: "فاصله (spacer)", icon: <Square size={14} /> },
    { type: "divider", label: "خط جداکننده", icon: <Minus size={14} /> },
    { type: "footnote", label: "پاورقی", icon: <Bookmark size={14} /> },
    { type: "toc", label: "فهرست مطالب", icon: <ListTree size={14} /> },
    { type: "glossary", label: "لغت‌نامه", icon: <BookOpen size={14} /> },
    { type: "pageBreak", label: "شکست صفحه A4", icon: <FileOutput size={14} /> },
  ];
  return (
    <div
      className="type-menu"
      role="menu"
      style={{ insetInlineStart: 0, top: "calc(100% + 6px)" }}
    >
      {items.map((it) => (
        <button
          key={it.type}
          type="button"
          className="type-menu-item"
          onClick={() => onPick(it.type)}
          role="menuitem"
        >
          <span className="icon-wrap">{it.icon}</span>
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}

// Preview pane — renders the document exactly as the export will look, on A4-styled paper.
function PreviewPane({ meta, blocks }: { meta: DocMeta; blocks: Block[] }) {
  // Compute footnote numbering
  const footnotes = blocks.filter(
    (b): b is Extract<Block, { type: "footnote" }> => b.type === "footnote"
  );
  const fnNumberMap = new Map<string, number>();
  footnotes.forEach((fn, idx) => fnNumberMap.set(fn.id, idx + 1));
  const showHeroSubtitle = meta.showHeroSubtitle !== false;
  const showFooterCredit = meta.showFooterCredit !== false;

  return (
    <div className="a4-paper">
      <div className="a4-page">
        {/* Hero */}
        <div className="preview-hero">
          <div className="preview-hero-pills">
            {meta.author && <span className="pill author">نویسنده: {meta.author}</span>}
            {meta.date && <span className="pill">تاریخ: {faDate(meta.date)}</span>}
          </div>
          <h1 className="doc-title" style={{ fontSize: 28, marginBottom: 6 }}>
            {meta.title || "سند بدون عنوان"}
          </h1>
          {showHeroSubtitle && (
            <p style={{ margin: 0, fontSize: 15, color: "#475569", lineHeight: 1.7 }}>
              ساخته‌شده با Pord — ویرایشگر سند فارسی
            </p>
          )}
        </div>

        {/* Main content */}
        <div className="preview-content">
          {blocks.length === 0 ? (
            <div className="empty-hint">سند خالی است.</div>
          ) : (
            blocks.map((b) => (
              <PreviewBlock
                key={b.id}
                block={b}
                fnNumberMap={fnNumberMap}
                allBlocks={blocks}
              />
            ))
          )}
        </div>

        {/* Footnotes section */}
        {footnotes.length > 0 && (
          <section className="preview-footnotes">
            <h3 className="preview-footnotes-title">پاورقی‌ها</h3>
            {footnotes.map((fn, idx) => (
              <div key={fn.id} className="preview-footnote-item">
                <span className="preview-footnote-num">[{faDigit(idx + 1)}]</span>
                <span>{fn.text || "(پاورقی خالی)"}</span>
              </div>
            ))}
          </section>
        )}

        {/* Footer credit */}
        <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px dashed rgba(148,163,184,0.32)", textAlign: "center" }}>
          <div style={{ fontSize: 11.5, color: "#94a3b8" }}>
            ساخته‌شده با Pord • {faDate(new Date().toISOString().slice(0, 10))}
          </div>
          {showFooterCredit && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#64748b", fontWeight: 600 }}>
              سازنده ارشی / Arshi
            </div>
          )}
        </div>

        <div className="a4-page-number">صفحه {faDigit(1)}</div>
      </div>
    </div>
  );
}

function PreviewBlock({
  block,
  fnNumberMap,
  allBlocks,
}: {
  block: Block;
  fnNumberMap: Map<string, number>;
  allBlocks?: Block[];
}) {
  const style: React.CSSProperties = {};
  if (block.fontSize) style.fontSize = `${FONT_SIZE_PX[block.fontSize]}px`;
  if (block.blockWidth && block.blockWidth !== "full") {
    style.width = WIDTH_PCT[block.blockWidth];
    style.marginInlineStart = "auto";
    style.marginInlineEnd = "auto";
  }
  if (block.marginBottom !== undefined) style.marginBottom = `${block.marginBottom}px`;

  // Replace {{fn:ID}} tokens with rendered markers in preview
  function renderText(text: string): React.ReactNode {
    if (!text) return null;
    const parts = text.split(/(\{\{fn:[a-zA-Z0-9_-]+\}\})/g);
    return parts.map((p, i) => {
      const m = p.match(/^\{\{fn:([a-zA-Z0-9_-]+)\}\}$/);
      if (m) {
        const num = fnNumberMap.get(m[1]);
        if (num == null) return null;
        return (
          <sup key={i} style={{ color: "#1d4ed8", fontWeight: 700, fontSize: "0.75em" }}>
            [{faDigit(num)}]
          </sup>
        );
      }
      return <span key={i}>{p}</span>;
    });
  }

  // Stable anchor id for headings (so the TOC links can scroll to them in preview too)
  const headingId =
    block.type === "title" ||
    block.type === "subtitle" ||
    block.type === "h2" ||
    block.type === "h3"
      ? headingAnchor(block.id)
      : undefined;

  switch (block.type) {
    case "title":
      return <h1 id={headingId} className="doc-title" style={style}>{block.text}</h1>;
    case "subtitle":
      return <h2 id={headingId} className="doc-subtitle" style={style}>{block.text}</h2>;
    case "h2":
      return <h2 id={headingId} className="doc-h2" style={style}>{block.text}</h2>;
    case "h3":
      return <h3 id={headingId} className="doc-h3" style={style}>{block.text}</h3>;
    case "paragraph":
      return <p className="doc-paragraph" style={style}>{renderText(block.text)}</p>;
    case "bullet":
      return (
        <ul className="doc-bullet" style={style}>
          {block.items.map((i, idx) => <li key={idx}>{renderText(i)}</li>)}
        </ul>
      );
    case "quote":
      return <blockquote className="doc-quote" style={style}>{renderText(block.text)}</blockquote>;
    case "callout":
      return <div className="doc-callout" style={style}>{renderText(block.text)}</div>;
    case "divider":
      return <hr className="doc-divider" style={style} />;
    case "image":
      if (!block.src) return null;
      return (
        <figure
          className="doc-image"
          style={{
            width: block.width > 0 ? `${block.width}px` : "100%",
            margin:
              block.align === "start"
                ? "0 0 0 auto"
                : block.align === "end"
                ? "0 auto 0 0"
                : "0 auto",
            ...style,
          }}
        >
          <img src={block.src} alt={block.alt || block.caption || ""} />
          {block.caption && (
            <span className="doc-image-caption">{block.caption}</span>
          )}
        </figure>
      );
    case "table":
      return (
        <table className="doc-table" style={style}>
          {block.hasHeader && block.rows.length > 0 && (
            <thead>
              <tr>
                {block.rows[0].map((cell, i) => <th key={i}>{cell}</th>)}
              </tr>
            </thead>
          )}
          <tbody>
            {block.rows.slice(block.hasHeader ? 1 : 0).map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => <td key={c}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "code":
      return (
        <div className="doc-code-wrap" style={style}>
          <span className="doc-code-language">
            <Code2 size={11} />
            {block.language || "plain"}
          </span>
          <pre className="doc-code">{block.code}</pre>
        </div>
      );
    case "spacer":
      return (
        <div className="doc-spacer" style={{ height: Math.max(16, block.height), ...style }} />
      );
    case "columns":
      return (
        <div className={`doc-columns cols-${block.columnCount}`} style={style}>
          {block.columns.map((col, ci) => (
            <div key={ci} className="doc-column">
              {col.map((item, bi) => {
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
                const Comp = item.type === "title" || item.type === "h2" || item.type === "h3"
                  ? item.type === "title"
                    ? "h1"
                    : item.type === "h2"
                    ? "h2"
                    : "h3"
                  : item.type === "quote"
                  ? "blockquote"
                  : "p";
                return (
                  // @ts-expect-error dynamic tag
                  <Comp key={item.id} className={cls} style={{ margin: 0 }}>
                    {item.text}
                  </Comp>
                );
              })}
            </div>
          ))}
        </div>
      );
    case "footnote":
      // Footnotes are rendered in the footer section of PreviewPane, not inline.
      return null;
    case "toc":
      return <PreviewToc block={block} allBlocks={allBlocks ?? [block]} />;
    case "glossary":
      return <PreviewGlossary block={block} />;
    case "pageBreak":
      return (
        <div
          style={{
            margin: "24px 0",
            padding: "10px 14px",
            borderRadius: 8,
            background:
              "repeating-linear-gradient(135deg, rgba(99,102,241,0.06) 0px, rgba(99,102,241,0.06) 8px, transparent 8px, transparent 16px)",
            border: "1px dashed rgba(99,102,241,0.32)",
            color: "#4338ca",
            fontSize: 12,
            fontWeight: 700,
            textAlign: "center",
            breakAfter: "page",
          }}
        >
          ── شکست صفحه A4 ──
        </div>
      );
    default:
      return null;
  }
}

function PreviewToc({
  block,
  allBlocks,
}: {
  block: Extract<Block, { type: "toc" }>;
  allBlocks: Block[];
}) {
  const entries: TocEntry[] = collectTocEntries(allBlocks, {
    includeH2: block.includeH2,
    includeH3: block.includeH3,
    includeSubtitle: block.includeSubtitle,
  });

  const activeLevels = [
    block.includeSubtitle && "زیرعنوان",
    block.includeH2 && "تیتر بخش",
    block.includeH3 && "تیتر فرعی",
  ].filter(Boolean);

  return (
    <div className="doc-toc">
      <h2 className="doc-toc-title">{block.title || "فهرست مطالب"}</h2>
      {entries.length === 0 ? (
        <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7 }}>
          برای ساخت فهرست، عنوان‌های <strong>h2</strong> یا <strong>h3</strong> به
          سند اضافه کنید. سطوح فعال: {activeLevels.join("، ") || "—"}.
          شماره صفحه‌ها در خروجی PDF به‌طور خودکار محاسبه و درج می‌شوند.
        </div>
      ) : (
        <>
          <ol
            className="doc-toc-list"
            style={{
              listStyle: "none",
              padding: 0,
              margin: "8px 0 0",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {entries.map((e, idx) => {
              const anchor = headingAnchor(e.id);
              const indent = e.level === 1 ? 0 : e.level === 2 ? 18 : 36;
              const isLvl1 = e.level === 1;
              const isLvl2 = e.level === 2;
              const isLvl3 = e.level === 3;
              return (
                <li
                  key={e.id}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    padding: "4px 8px",
                    borderRadius: 6,
                    paddingInlineStart: indent + 8,
                    color: isLvl1
                      ? "#0c1a3b"
                      : isLvl2
                      ? "#1d4ed8"
                      : "#475569",
                    fontWeight: isLvl1 ? 700 : isLvl2 ? 600 : 400,
                    fontSize: isLvl1 ? 14.5 : isLvl2 ? 13.5 : 13,
                  }}
                >
                  <span
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      opacity: 0.55,
                      minWidth: 20,
                    }}
                  >
                    {(idx + 1).toLocaleString("fa-IR")}.
                  </span>
                  <a
                    href={`#${anchor}`}
                    style={{
                      flex: 1,
                      color: "inherit",
                      textDecoration: "none",
                    }}
                  >
                    {e.text || "(بدون عنوان)"}
                  </a>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: isLvl1 ? "#1d4ed8" : isLvl2 ? "#6366f1" : "#94a3b8",
                      padding: "1px 7px",
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.7)",
                      border: "1px solid rgba(148,163,184,0.24)",
                      flexShrink: 0,
                    }}
                  >
                    {isLvl1 ? "زیرعنوان" : isLvl2 ? "h2" : "h3"}
                  </span>
                </li>
              );
            })}
          </ol>
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: "#94a3b8",
              fontStyle: "italic",
            }}
          >
            شماره صفحه‌ها در خروجی PDF/Word به‌طور خودکار محاسبه و درج می‌شوند.
            سطوح فعال: {activeLevels.join("، ") || "—"}.
          </div>
        </>
      )}
    </div>
  );
}

function PreviewGlossary({ block }: { block: Extract<Block, { type: "glossary" }> }) {
  return (
    <div className={`doc-glossary ${block.twoColumn ? "two-col" : "one-col"}`}>
      <h2 className="doc-glossary-title">{block.title || "لغت‌نامه"}</h2>
      {block.entries.length === 0 ? (
        <p style={{ fontSize: 13, color: "#64748b", fontStyle: "italic", margin: 0 }}>
          هنوز کلمه‌ای ثبت نشده است.
        </p>
      ) : (
        <div className="doc-glossary-list">
          {block.entries.map((e) => (
            <div key={e.id} className="doc-glossary-entry">
              <span className="doc-glossary-word">{e.word}</span>
              <span className="doc-glossary-meaning">{e.meaning || "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function faDate(iso: string): string {
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

function faDigit(input: string | number): string {
  const fa = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
  return String(input).replace(/\d/g, (d) => fa[+d]);
}
