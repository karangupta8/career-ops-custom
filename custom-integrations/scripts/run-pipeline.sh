#!/usr/bin/env bash
#
# run-pipeline.sh — career-ops → canonical JSON Resume → Reactive Resume.
#
# Stage 1 (career-ops tailoring) is agent-driven and happens BEFORE this script:
# the career-ops agent evaluates a JD and writes a JD-tailored CV markdown that
# mirrors cv.md's section structure (default: the base cv.md when no tailoring).
#
# This script runs the deterministic stages:
#   2) convert CV markdown → canonical JSON Resume (RR-importable)
#   3) tell you exactly how to render it in Reactive Resume
#
# Usage:
#   bash custom-integrations/scripts/run-pipeline.sh [--cv <path>] [--job "<title @ company>"]
#
# Windows: run via Git Bash.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

CV_PATH="cv.md"
JOB=""
while [ $# -gt 0 ]; do
  case "$1" in
    --cv)  CV_PATH="$2"; shift 2 ;;
    --job) JOB="$2"; shift 2 ;;
    *)     echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

OUT="custom-integrations/output/resume.canonical.json"

echo "1/3 career-ops tailoring — done upstream by the agent (using: $CV_PATH)"

echo "2/3 Converting $CV_PATH → canonical JSON Resume..."
node custom-integrations/cv-to-resume/cv-to-jsonresume.mjs --cv "$CV_PATH" --out "$OUT" --pretty ${JOB:+--job "$JOB"}

echo "3/3 Render in Reactive Resume:"
echo "    • Self-hosted RR (Docker): docker compose -f custom-integrations/vendor/reactive-resume/compose.yml up -d"
echo "    • In RR: Dashboard → Create Resume → Import → 'JSON Resume' → upload:"
echo "        $ROOT/$OUT"
echo "    • Pick your template in the RR editor, then Export → PDF."
echo "✅ Canonical resume ready at $OUT"
