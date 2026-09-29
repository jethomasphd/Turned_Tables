#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Reproduce the Tables Turned preprint.
#
#    ./run_all.sh            ANALYSIS mode (default, free, offline except npm/pip):
#                            recompute every number, figure and the .docx from the
#                            frozen data in data/. Output is identical to the paper.
#
#    ./run_all.sh full       FULL mode: re-run all three arms and the audits against
#                            live services (PubMed, Anthropic, web search), then rebuild.
#                            Needs TT_WORKER_URL (a Tables Turned Worker) or ANTHROPIC_API_KEY.
#                            Costs about USD 2.60 at list prices. Live systems change, so
#                            the numbers will differ from the paper; the manuscript text
#                            quotes the frozen values in data/metrics/summary.json and must
#                            be updated by hand if you want it to describe a new run.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-analysis}"

echo "▸ installing dependencies"
python3 -m pip install -q -r requirements.txt
npm install --silent

if [[ "$MODE" == "full" ]]; then
  if [[ -z "${TT_WORKER_URL:-}" && -z "${ANTHROPIC_API_KEY:-}" ]]; then
    echo "Set TT_WORKER_URL or ANTHROPIC_API_KEY for full mode." >&2; exit 1
  fi
  echo "▸ arm 1: Tables Turned (6 questions + 2 extra flagship replicates)"
  python3 scripts/01_run_tables_turned.py
  python3 scripts/01_run_tables_turned.py --only Q1 --replicates 2 --start-rep 2
  echo "▸ arms 2-3: Claude free + modeled AI Overview"
  python3 scripts/02_run_comparators.py
  python3 scripts/02_run_comparators.py --only Q1 --replicates 2 --start-rep 2
  echo "▸ audits (fresh reference extraction)"
  rm -f data/comparators/*/claude_free_run_*_references.json
  python3 scripts/03_audit_citations.py
  echo "▸ references + live PubMed count"
  python3 scripts/refs.py
  echo "▸ interface screenshots (replayed session)"
  python3 scripts/06_screenshots.py
fi

echo "▸ figures + metrics"
python3 scripts/fig_architecture.py
python3 scripts/04_analyze_and_plot.py
echo "▸ building the .docx"
node scripts/05_build_preprint.js

if command -v soffice >/dev/null 2>&1; then
  echo "▸ rendering PDF (LibreOffice Writer)"
  soffice --headless --convert-to pdf --outdir . Tables_Turned_preprint.docx >/dev/null 2>&1 \
    && echo "  wrote Tables_Turned_preprint.pdf" || echo "  PDF rendering skipped (LibreOffice Writer not available)"
fi
echo "✓ done"
