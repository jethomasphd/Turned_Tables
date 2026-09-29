/**
 * 05_build_preprint.js — renders manuscript/manuscript.md into Tables_Turned_preprint.docx
 *
 * Markdown dialect (deliberately small):
 *   # / ##                      section / subsection headings
 *   - item                      bullets
 *   **bold** *italic* `code`    inline styles;  _{sub}  ^{sup}  subscripts / superscripts
 *   [@key] or [@a; @b]          citations -> numbered in order of first appearance (Vancouver)
 *   ::: keypoints | abstract    shaded boxes
 *   ::: figure file.png 6.5     image (width in inches) + caption paragraph
 *   ::: table w1,w2,...         caption line, pipe rows, optional "^ note" lines (widths in DXA)
 *   ::: equation                centered display equation
 *   ::: references              reference list (manuscript/references.json)
 *   ::: prompts                 production prompts, read verbatim from commons-table/js/synthesis.js
 *
 *   npm install docx   (once, in preprint/)
 *   node scripts/05_build_preprint.js
 */

const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header, Footer,
  AlignmentType, WidthType, ShadingType, BorderStyle, LevelFormat, PageNumber, ExternalHyperlink,
  TabStopType, HeadingLevel, TableLayoutType, VerticalAlign,
} = require(path.join(__dirname, "..", "node_modules", "docx"));

const ROOT = path.join(__dirname, "..");
const REPO = path.join(ROOT, "..");
const MD = fs.readFileSync(path.join(ROOT, "manuscript", "manuscript.md"), "utf8");
const REFS = JSON.parse(fs.readFileSync(path.join(ROOT, "manuscript", "references.json"), "utf8"));
const OUT = path.join(ROOT, "Tables_Turned_preprint.docx");

// ── Design tokens ─────────────────────────────────────────────
const SERIF = "Times New Roman";
const SANS = "Arial";
const MONO = "Courier New";
const INK = "0B0B0B", INK2 = "52514E", MUTED = "898781", ACCENT = "1C5CAB", NAVY = "0D2A52";
const WASH_BLUE = "EDF4FC", WASH_GREY = "F4F3EF", RULE = "C3C2B7";
const BODY = 21;            // half-points (10.5 pt)
const CONTENT_W = 9360;     // 6.5 in in DXA

// ── Citation numbering ────────────────────────────────────────
const citeOrder = [];
function citeNumber(key) {
  if (!REFS[key]) throw new Error(`Unknown reference key: ${key}`);
  let i = citeOrder.indexOf(key);
  if (i === -1) { citeOrder.push(key); i = citeOrder.length - 1; }
  return i + 1;
}
function formatCite(keys) {
  const nums = [...new Set(keys.map(citeNumber))].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(j - i >= 2 ? `${nums[i]}–${nums[j]}` : (j > i ? `${nums[i]},${nums[j]}` : `${nums[i]}`));
    i = j;
  }
  return `[${parts.join(",")}]`;
}

// ── Inline markdown -> TextRun[] ───────────────────────────────
const TOKEN = /(\*\*[^*]+?\*\*|\*[^*\s][^*]*?\*|`[^`]+`|_\{[^}]+\}|\^\{[^}]+\}|\[@[^\]]+\])/g;
function runs(text, base = {}) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const t = m[0];
    if (t.startsWith("**")) out.push(...runs(t.slice(2, -2), { ...base, bold: true }));
    else if (t.startsWith("`")) out.push(new TextRun({ text: t.slice(1, -1), ...base, font: MONO, size: (base.size || BODY) - 2 }));
    else if (t.startsWith("_{")) out.push(new TextRun({ text: t.slice(2, -1), ...base, subScript: true }));
    else if (t.startsWith("^{")) out.push(new TextRun({ text: t.slice(2, -1), ...base, superScript: true }));
    else if (t.startsWith("[@")) {
      const keys = t.slice(1, -1).split(";").map(k => k.trim().replace(/^@/, ""));
      out.push(new TextRun({ text: formatCite(keys), ...base }));
    } else out.push(...runs(t.slice(1, -1), { ...base, italics: true }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}

// ── Block builders ────────────────────────────────────────────
const para = (text, opts = {}) => new Paragraph({
  children: runs(text, { font: SERIF, size: BODY, color: INK, ...(opts.run || {}) }),
  alignment: opts.align || AlignmentType.JUSTIFIED,
  spacing: { after: opts.after ?? 110, before: opts.before ?? 0, line: opts.line ?? 262 },
  indent: opts.indent,
  keepNext: opts.keepNext,
});

let h1Count = 0;
function heading1(text) {
  const m = text.match(/^(\d+|[A-Z]\.?|Appendix [A-Z]\.)\s+(.*)$/);
  const children = [];
  if (m && /^\d+$/.test(m[1])) {
    children.push(new TextRun({ text: m[1] + "  ", font: SANS, size: 24, bold: true, color: ACCENT }));
    children.push(new TextRun({ text: m[2], font: SANS, size: 24, bold: true, color: NAVY }));
  } else {
    children.push(new TextRun({ text, font: SANS, size: 24, bold: true, color: NAVY }));
  }
  h1Count++;
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, children, keepNext: true,
    spacing: { before: 220, after: 90 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "D9E6F6", space: 2 } },
  });
}
function heading2(text) {
  const m = text.match(/^(\d+\.\d+)\s+(.*)$/);
  const children = m
    ? [new TextRun({ text: m[1] + "  ", font: SANS, size: 20, bold: true, color: ACCENT }),
       new TextRun({ text: m[2], font: SANS, size: 20, bold: true, color: INK })]
    : [new TextRun({ text, font: SANS, size: 20, bold: true, color: INK })];
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children, keepNext: true, spacing: { before: 150, after: 60 } });
}
const bullet = (text) => new Paragraph({
  children: runs(text, { font: SERIF, size: BODY, color: INK }),
  numbering: { reference: "bullets", level: 0 },
  alignment: AlignmentType.JUSTIFIED, spacing: { after: 60, line: 252 },
});

function box(lines, fill, borderColor, opts = {}) {
  const children = [];
  if (opts.label) {
    children.push(new Paragraph({
      children: [new TextRun({ text: opts.label, font: SANS, size: 16, bold: true, color: borderColor, characterSpacing: 30 })],
      spacing: { after: 80 },
    }));
  }
  for (const l of lines) {
    children.push(new Paragraph({
      children: runs(l, { font: opts.font || SANS, size: opts.size || 17, color: INK }),
      alignment: opts.align || AlignmentType.LEFT, spacing: { after: 70, line: opts.line || 240 },
    }));
  }
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [CONTENT_W],
    rows: [new TableRow({ children: [new TableCell({
      width: { size: CONTENT_W, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR, color: "auto" },
      margins: { top: 140, bottom: 70, left: 200, right: 200 },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        left: { style: BorderStyle.SINGLE, size: 24, color: borderColor },
      },
      children,
    })] })],
  });
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), data: b };
}
function figure(file, widthIn, captionLines) {
  const img = pngSize(path.join(ROOT, "figures", file));
  const wpx = Math.round(widthIn * 96);
  const hpx = Math.round(wpx * img.h / img.w);
  return [
    new Paragraph({
      children: [new ImageRun({ type: "png", data: img.data, transformation: { width: wpx, height: hpx },
        altText: { title: file, description: captionLines.join(" ").slice(0, 250), name: file } })],
      alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, keepNext: true,
    }),
    ...captionLines.map(c => new Paragraph({
      children: runs(c, { font: SANS, size: 15, color: INK2 }),
      alignment: AlignmentType.JUSTIFIED, spacing: { after: 160, line: 228 },
    })),
  ];
}

function table(widths, caption, rows, notes) {
  const cellBorder = { style: BorderStyle.SINGLE, size: 2, color: "E1E0D9" };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const header = rows[0];
  const trs = rows.map((r, ri) => new TableRow({
    tableHeader: ri === 0,
    cantSplit: true,
    children: r.map((c, ci) => new TableCell({
      width: { size: widths[ci], type: WidthType.DXA },
      shading: ri === 0 ? { fill: WASH_BLUE, type: ShadingType.CLEAR, color: "auto" } : undefined,
      margins: { top: 50, bottom: 50, left: 80, right: 80 },
      verticalAlign: VerticalAlign.TOP,
      borders: {
        top: ri === 0 ? { style: BorderStyle.SINGLE, size: 8, color: ACCENT } : cellBorder,
        bottom: ri === rows.length - 1 ? { style: BorderStyle.SINGLE, size: 8, color: ACCENT } : cellBorder,
        left: none, right: none,
      },
      children: [new Paragraph({
        children: runs(c.trim(), { font: SANS, size: 14, color: INK, bold: ri === 0 }),
        spacing: { after: 0, line: 216 },
      })],
    })),
  }));
  const out = [
    new Paragraph({ children: runs(caption, { font: SANS, size: 15, color: INK2 }),
      spacing: { before: 140, after: 70, line: 228 }, keepNext: true, alignment: AlignmentType.JUSTIFIED }),
    new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths, rows: trs,
      layout: TableLayoutType.FIXED }),
  ];
  for (const n of notes) out.push(new Paragraph({ children: runs(n, { font: SANS, size: 13, color: MUTED }),
    spacing: { before: 40, after: 60 } }));
  out.push(new Paragraph({ children: [], spacing: { after: 60 } }));
  return out;
}

function references() {
  const out = [];
  citeOrder.forEach((key, i) => {
    const r = REFS[key];
    const children = [new TextRun({ text: `${i + 1}.\t`, font: SERIF, size: 16, color: INK })];
    children.push(new TextRun({ text: r.text + " ", font: SERIF, size: 16, color: INK }));
    if (r.doi) children.push(new ExternalHyperlink({ link: `https://doi.org/${r.doi}`,
      children: [new TextRun({ text: `doi:${r.doi}`, font: SERIF, size: 16, color: ACCENT })] }));
    if (r.pmid) {
      children.push(new TextRun({ text: r.doi ? "  " : "", font: SERIF, size: 16 }));
      children.push(new ExternalHyperlink({ link: `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`,
        children: [new TextRun({ text: `PMID: ${r.pmid}`, font: SERIF, size: 16, color: ACCENT })] }));
    }
    out.push(new Paragraph({ children, indent: { left: 360, hanging: 360 },
      tabStops: [{ type: TabStopType.LEFT, position: 360 }], spacing: { after: 30, line: 216 } }));
  });
  return out;
}

function prompts() {
  const src = fs.readFileSync(path.join(REPO, "commons-table", "js", "synthesis.js"), "utf8");
  const out = [];
  for (const [name, label] of [["SEARCH_SYSTEM", "A.1  Search-strategy prompt (stage 2)"],
                               ["SUMMARY_SYSTEM", "A.2  Plain-language translation prompt (stage 4)"],
                               ["SYNTH_SYSTEM", "A.3  Synthesis contract (stage 6)"]]) {
    const m = src.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
    if (!m) throw new Error(`prompt ${name} not found`);
    out.push(new Paragraph({ children: [new TextRun({ text: label, font: SANS, size: 17, bold: true, color: INK })],
      spacing: { before: 120, after: 50 }, keepNext: true }));
    const lines = m[1].split("\n");
    const cellChildren = lines.map(l => new Paragraph({
      children: [new TextRun({ text: l.length ? l : " ", font: MONO, size: 13, color: INK })],
      spacing: { after: 0, line: 180 },
    }));
    out.push(new Table({
      width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [CONTENT_W],
      rows: [new TableRow({ children: [new TableCell({
        width: { size: CONTENT_W, type: WidthType.DXA },
        shading: { fill: WASH_GREY, type: ShadingType.CLEAR, color: "auto" },
        margins: { top: 80, bottom: 80, left: 140, right: 140 },
        borders: { top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                   right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, left: { style: BorderStyle.SINGLE, size: 12, color: RULE } },
        children: cellChildren,
      })] })],
    }));
  }
  return out;
}

// ── Parse the manuscript ──────────────────────────────────────
function parse(md) {
  const lines = md.split("\n");
  const body = [];
  let i = 0;
  let paraBuf = [];
  const flush = () => { if (paraBuf.length) { body.push(para(paraBuf.join(" "))); paraBuf = []; } };
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith(":::")) {
      flush();
      const [kind, ...args] = line.slice(3).trim().split(/\s+/);
      const block = [];
      i++;
      while (i < lines.length && !lines[i].startsWith(":::")) { block.push(lines[i]); i++; }
      i++; // closing :::
      const paras = block.join("\n").split(/\n\s*\n/).map(p => p.replace(/\n/g, " ").trim()).filter(Boolean);
      if (kind === "keypoints") body.push(box(paras, WASH_BLUE, ACCENT, { label: "KEY POINTS", size: 16, line: 228 }), new Paragraph({ children: [], spacing: { after: 80 } }));
      else if (kind === "abstract") body.push(box(paras, WASH_GREY, NAVY, { label: "ABSTRACT", size: 16, line: 228, align: AlignmentType.JUSTIFIED }), new Paragraph({ children: [], spacing: { after: 60 } }));
      else if (kind === "figure") body.push(...figure(args[0], parseFloat(args[1] || "6.5"), paras));
      else if (kind === "equation") body.push(new Paragraph({ children: runs(paras.join(" "), { font: SERIF, size: 21, italics: true, color: INK }),
        alignment: AlignmentType.CENTER, spacing: { before: 80, after: 120 } }));
      else if (kind === "references") body.push(...references());
      else if (kind === "prompts") body.push(...prompts());
      else if (kind === "table") {
        const widths = args[0].split(",").map(Number);
        const rows = [], notes = [];
        let caption = "";
        for (const l of block) {
          if (!l.trim()) continue;
          if (l.startsWith("|")) {
            if (/^\|\s*-+/.test(l)) continue;
            rows.push(l.trim().replace(/^\||\|$/g, "").split("|"));
          } else if (l.startsWith("^ ")) notes.push(l.slice(2));
          else caption += (caption ? " " : "") + l.trim();
        }
        body.push(...table(widths, caption, rows, notes));
      }
      continue;
    }
    if (line.startsWith("# ")) { flush(); body.push(heading1(line.slice(2).trim())); }
    else if (line.startsWith("## ")) { flush(); body.push(heading2(line.slice(3).trim())); }
    else if (line.startsWith("- ")) { flush(); body.push(bullet(line.slice(2).trim())); }
    else if (!line.trim()) flush();
    else paraBuf.push(line.trim());
    i++;
  }
  flush();
  return body;
}

// ── Front matter ──────────────────────────────────────────────
function frontMatter() {
  const t = (text, o) => new TextRun({ text, ...o });
  return [
    new Paragraph({ children: [t("PREPRINT  ·  NOT PEER REVIEWED  ·  SEPTEMBER 2026", { font: SANS, size: 15, bold: true, color: ACCENT, characterSpacing: 40 })],
      spacing: { after: 160 } }),
    new Paragraph({ children: [t("Receipts, Not Answers:", { font: SANS, size: 36, bold: true, color: NAVY })], spacing: { after: 40, line: 240 } }),
    new Paragraph({ children: [t("Tables Turned, an Open Pipeline That Binds Every Health Claim to the Public Biomedical Record, Audited Against Free AI Answer Engines",
      { font: SANS, size: 25, color: NAVY })], spacing: { after: 220, line: 264 } }),
    new Paragraph({ children: [
      t("Jacob E. Thomas, MA, PhD", { font: SERIF, size: 22, bold: true, color: INK }), t("1,*", { font: SERIF, size: 22, superScript: true }),
      t("   ·   ", { font: SERIF, size: 22, color: MUTED }),
      t("Daniel S. Kreitzberg, PhD", { font: SERIF, size: 22, bold: true, color: INK }), t("2", { font: SERIF, size: 22, superScript: true }),
    ], spacing: { after: 80 } }),
    new Paragraph({ children: [t("1", { font: SERIF, size: 16, superScript: true }), t(" Austin, Texas, USA.   ", { font: SERIF, size: 16, color: INK2 }),
      t("2", { font: SERIF, size: 16, superScript: true }), t(" [Affiliation to be confirmed].", { font: SERIF, size: 16, color: INK2 })],
      spacing: { after: 30 } }),
    new Paragraph({ children: [t("* Correspondence: ", { font: SERIF, size: 16, color: INK2 }),
      new ExternalHyperlink({ link: "mailto:jethomasphd@gmail.com", children: [t("jethomasphd@gmail.com", { font: SERIF, size: 16, color: ACCENT })] }),
      t("   ·   Code, data and live tool: ", { font: SERIF, size: 16, color: INK2 }),
      new ExternalHyperlink({ link: "https://github.com/jethomasphd/Turned_Tables", children: [t("github.com/jethomasphd/Turned_Tables", { font: SERIF, size: 16, color: ACCENT })] }),
      t("  ·  ", { font: SERIF, size: 16, color: INK2 }),
      new ExternalHyperlink({ link: "https://tables-turned.com", children: [t("tables-turned.com", { font: SERIF, size: 16, color: ACCENT })] })],
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 8 } } }),
  ];
}

// ── Assemble ──────────────────────────────────────────────────
const bodyBlocks = parse(MD);
const header = new Header({ children: [new Paragraph({
  children: [
    new TextRun({ text: "Thomas & Kreitzberg  ·  Receipts, Not Answers", font: SANS, size: 14, color: MUTED }),
    new TextRun({ text: "\tPreprint · September 2026", font: SANS, size: 14, color: MUTED }),
  ],
  tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
  border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "E1E0D9", space: 4 } },
})] });
const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
  new TextRun({ children: [PageNumber.CURRENT], font: SANS, size: 15, color: MUTED }),
  new TextRun({ text: " / ", font: SANS, size: 15, color: MUTED }),
  new TextRun({ children: [PageNumber.TOTAL_PAGES], font: SANS, size: 15, color: MUTED }),
] })] });

const doc = new Document({
  creator: "Jacob E. Thomas; Daniel S. Kreitzberg",
  title: "Receipts, Not Answers: Tables Turned",
  description: "Preprint describing Tables Turned and a comparative audit against free AI answer engines",
  styles: {
    default: { document: { run: { font: SERIF, size: BODY } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: SANS, size: 24, bold: true, color: NAVY }, paragraph: { outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: SANS, size: 20, bold: true, color: INK }, paragraph: { outlineLevel: 1 } },
    ],
  },
  numbering: { config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•",
    alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 220 } } } }] }] },
  sections: [{
    properties: {
      page: { size: { width: 12240, height: 15840 }, margin: { top: 1300, bottom: 1200, left: 1440, right: 1440, header: 620, footer: 560 } },
      titlePage: true,
    },
    headers: { default: header, first: new Header({ children: [new Paragraph({ children: [] })] }) },
    footers: { default: footer, first: footer },
    children: [...frontMatter(), ...bodyBlocks],
  }],
});

// Every reference defined but never cited is reported, so nothing silently drops out.
const unused = Object.keys(REFS).filter(k => !citeOrder.includes(k));
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log(`wrote ${OUT}  (${citeOrder.length} references cited${unused.length ? `; not cited: ${unused.join(", ")}` : ""})`);
});
