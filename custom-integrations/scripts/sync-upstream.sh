#!/usr/bin/env bash
#
# sync-upstream.sh — pull the latest for every vendored tool (git submodules).
#
# career-ops itself is the repo root and syncs via `node update-system.mjs`, NOT
# here. This script only advances the submodules under custom-integrations/vendor/.
#
# Windows: run via `bash custom-integrations/scripts/sync-upstream.sh` (Git Bash).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "⏳ Updating vendored submodules to their tracked branch tips..."
git submodule update --remote --merge custom-integrations/vendor/reactive-resume

echo "✅ Submodules synced. Review and commit the pointer bump:"
echo "   git add custom-integrations/vendor && git commit -m 'chore: sync vendored tools'"
