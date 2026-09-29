"""
fig_architecture.py — Figure 1: the Tables Turned pipeline, who acts at each step, and where trust lives.

Drawn with matplotlib patches so it regenerates with the rest of the package.
    python scripts/fig_architecture.py  ->  figures/fig1_architecture.png
"""

from __future__ import annotations

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

from tt_common import FIGURES

# Reference palette (dataviz skill, light mode) — role colors, fixed order.
INK, INK2, MUTED = "#0b0b0b", "#52514e", "#898781"
SURFACE, GRID, BASE = "#fcfcfb", "#e1e0d9", "#c3c2b7"
AI, PERSON, RECORD, CODE = "#2a78d6", "#eb6834", "#1baf7a", "#898781"
WASH = {AI: "#eaf2fc", PERSON: "#fdeee7", RECORD: "#e6f6f0", CODE: "#f2f1ee"}

plt.rcParams.update({"font.family": "Liberation Sans", "font.size": 8})

STAGES = [
    # (n, title, line1, line2, role)
    (1, "Ask", "plain-English question", "+ why you are asking", PERSON),
    (2, "Expand", "3–4 PubMed strategies", "MeSH · Boolean · synonyms", AI),
    (3, "Retrieve", "esearch → ≤25 PMIDs each", "efetch → titles, abstracts", RECORD),
    (4, "Rank", "3 × overlap + rank points", "keep top 12 · no LLM", CODE),
    (5, "Translate", "plain title + one-line", "summary per paper", AI),
    (6, "Curate", "keep or drop each paper", "full abstract on demand", PERSON),
    (7, "Synthesize", "one-page brief, streamed", "every claim → [PMID]", AI),
    (8, "Seal", "Tablet JSON · .docx · .md", "prompts + provenance log", CODE),
]


def box(ax, x, y, w, h, stage):
    n, title, l1, l2, role = stage
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=0.05",
                                fc=WASH[role], ec=role, lw=1.1, zorder=2))
    ax.add_patch(FancyBboxPatch((x + 0.004, y + h - 0.06), w - 0.008, 0.056, boxstyle="square,pad=0",
                                fc=role, ec="none", zorder=3))
    ax.text(x + 0.08, y + h - 0.21, f"{n}", fontsize=10, fontweight="bold", color=role, va="center", zorder=4)
    ax.text(x + 0.26, y + h - 0.21, title, fontsize=9, fontweight="bold", color=INK, va="center", zorder=4)
    ax.text(x + 0.08, y + h - 0.44, l1, fontsize=6.3, color=INK2, va="center", zorder=4)
    ax.text(x + 0.08, y + h - 0.59, l2, fontsize=6.3, color=INK2, va="center", zorder=4)


def arrow(ax, p, q, color=INK2, lw=1.0):
    ax.add_patch(FancyArrowPatch(p, q, arrowstyle="-|>", mutation_scale=8, color=color, lw=lw,
                                 zorder=1, shrinkA=0, shrinkB=0))


def service(ax, x, y, w, h, role, title, l1, l2):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=0.05",
                                fc="white", ec=role, lw=1.0, zorder=2))
    ax.add_patch(FancyBboxPatch((x, y), 0.06, h, boxstyle="square,pad=0", fc=role, ec="none", zorder=3))
    ax.text(x + 0.16, y + h - 0.17, title, fontsize=7.4, fontweight="bold", color=INK, va="center")
    ax.text(x + 0.16, y + h - 0.37, l1, fontsize=6.6, color=INK2, va="center")
    ax.text(x + 0.16, y + h - 0.53, l2, fontsize=6.6, color=INK2, va="center")


def main() -> None:
    W, H = 7.0, 3.95
    fig, ax = plt.subplots(figsize=(W, H), dpi=300)
    fig.patch.set_facecolor("white")
    ax.set_xlim(0, W)
    ax.set_ylim(0, H)
    ax.axis("off")

    w, h, gap, x0 = 1.56, 0.74, 0.20, 0.13
    ys = (2.86, 1.45)
    zone_y = 1.28
    ax.add_patch(FancyBboxPatch((0.03, zone_y), W - 0.06, H - zone_y - 0.02,
                                boxstyle="round,pad=0,rounding_size=0.07",
                                fc="none", ec=BASE, lw=0.8, ls=(0, (4, 3)), zorder=0))
    ax.text(0.13, H - 0.16, "THE READER'S BROWSER", fontsize=6.8, fontweight="bold", color=MUTED, va="center")
    ax.text(1.76, H - 0.16, "vanilla HTML · CSS · JS  ·  no account  ·  no server-side state  ·  every prompt viewable",
            fontsize=6.6, color=MUTED, va="center")

    pos = {}
    for i, st in enumerate(STAGES):
        row, col = divmod(i, 4)
        x, y = x0 + col * (w + gap), ys[row]
        box(ax, x, y, w, h, st)
        pos[st[0]] = (x, y)
    for a in (1, 2, 3, 5, 6, 7):
        (xa, ya), (xb, _) = pos[a], pos[a + 1]
        arrow(ax, (xa + w + 0.015, ya + h / 2), (xb - 0.015, ya + h / 2))

    # 4 -> 5 return sweep with its caption beneath the line
    (x4, y4), (x5, y5) = pos[4], pos[5]
    yl = 2.55
    ax.plot([x4 + w / 2] * 2, [y4 - 0.01, yl], color=INK2, lw=1.0, zorder=1)
    ax.plot([x4 + w / 2, x5 + w / 2], [yl, yl], color=INK2, lw=1.0, zorder=1)
    arrow(ax, (x5 + w / 2, yl), (x5 + w / 2, y5 + h + 0.015))
    ax.text((x5 + x4 + w) / 2, yl - 0.07, "top 12 papers · plain-language card · overlap badge · clickable PMID",
            fontsize=6.5, color=MUTED, ha="center", va="top", style="italic")
    x6, y6 = pos[6]
    ax.text(x6 + w / 2, y6 - 0.05, "deselected papers never reach the model", fontsize=6.2, color=PERSON,
            ha="center", va="top", style="italic")

    # External services (colour-keyed, no crossing connectors)
    sy, sh = 0.36, 0.72
    service(ax, 0.13, sy, 3.30, sh, AI, "Blue steps → Cloudflare Worker → Anthropic API",
            "API key kept server-side (Worker secret) · CORS allow-list",
            "claude-opus-4-6 · synthesis streamed as server-sent events")
    service(ax, 3.57, sy, 3.30, sh, RECORD, "Green step → NCBI E-utilities (PubMed)",
            "39M+ citations · free · public · CORS-enabled",
            "esearch + efetch · 350 ms spacing (≤3 requests/s)")

    # Legend
    items = [(PERSON, "the reader decides"), (AI, "Claude (LLM) step"),
             (RECORD, "public record"), (CODE, "deterministic code")]
    lx, ly = 0.15, 0.13
    for c, label in items:
        ax.add_patch(FancyBboxPatch((lx, ly - 0.05), 0.14, 0.10, boxstyle="round,pad=0,rounding_size=0.02",
                                    fc=WASH[c], ec=c, lw=1.0))
        ax.text(lx + 0.2, ly, label, fontsize=6.8, color=INK2, va="center")
        lx += 0.2 + len(label) * 0.052 + 0.32

    FIGURES.mkdir(parents=True, exist_ok=True)
    out = FIGURES / "fig1_architecture.png"
    fig.savefig(out, dpi=300, bbox_inches="tight", facecolor="white", pad_inches=0.03)
    print("wrote", out)


if __name__ == "__main__":
    main()
