# Career Platform — Build Specification

**Version:** 1.0 (original spec, 2026-07-02) — **Status:** superseded by the implemented design.

> This is the original planning document that proposed a separate `career-platform` monorepo
> vendoring both `career-ops` and `reactive-resume` as subtrees under `vendor/`. After review,
> the actual implementation took a different, simpler shape: career-ops **stays the repo root**
> (unchanged, so upstream sync via `node update-system.mjs` stays conflict-free), and Reactive
> Resume is vendored as a **git submodule** inside `custom-integrations/vendor/reactive-resume/`
> instead of a second sibling repo with subtrees.
>
> The canonical-schema/glue-layer philosophy below (Sections 2–3) still holds and is what
> `custom-integrations/` implements. For the as-built architecture, adapter, and usage, see
> [`custom-integrations/README.md`](../README.md). Kept here as a historical/decision record.

> **Audience:** This document is written for Claude Code (or any coding agent). It is a complete, executable plan to build a personal "one-stop" job-search platform as a vendored monorepo. Follow the phases in order. Do not skip the design rules in Section 3 — they are what keep the project maintainable long-term.
> 

---

## 1. Objective

Build a single Git repository (`career-platform`) that acts as a one-stop job-search solution by combining two existing open-source projects and leaving room for more to be added later.

The two projects, both forks owned by the user:

| Project | Fork URL | Role in the platform |
| --- | --- | --- |
| **career-ops** | `https://github.com/karangupta8/career-ops-custom.git` | The **engine / brain.** An agentic CLI that evaluates job offers (A–F scoring), scans portals (Greenhouse, Ashby, Lever), generates ATS-optimized CVs and cover letters, batch-processes offers, and tracks a pipeline. Node.js + Go stack. |
| **reactive-resume** | `https://github.com/karangupta8/reactive-resume-fork.git` | The **resume system.** A privacy-first, open-source, self-hostable web app that builds resumes from structured data and exports polished PDFs. TypeScript / web-app stack. |

**End-state capability the user wants:** career-ops produces tailored *resume data*, and reactive-resume turns that data into a polished resume automatically — driven from one repo. Additional job-related open-source tools should be addable later with minimal effort.

---

## 2. Architecture Overview

Three layers with a strict, one-directional dependency rule.

```
┌─────────────────────────────────────────────────────────────┐
│  YOUR LAYER  — glue/, config/, scripts/  (user owns, fully)   │
│  • orchestration, adapters, canonical data contract           │
│  • NEVER overwritten by upstream syncs                        │
└──────────────┬────────────────────────────┬──────────────────┘
               │ imports / calls             │ imports / calls
               ▼                             ▼
┌──────────────────────────┐   ┌────────────────────────────────┐
│ vendor/career-ops         │   │ vendor/reactive-resume          │
│ (git subtree, read-only)  │   │ (git subtree, read-only)        │
└──────────────┬───────────┘   └───────────────┬────────────────┘
               │ subtree pull                   │ subtree pull
               ▼                                ▼
   karangupta8/career-ops-custom     karangupta8/reactive-resume-fork
```

**The golden rule:** *Your code depends on the vendored tools; the vendored tools never depend on your code.* This one-way arrow is what keeps `git subtree pull` conflict-free indefinitely.

**Integration mechanism:** The two projects do **not** share a runtime (Node/Go vs TypeScript web app). They communicate by exchanging JSON files conforming to a **canonical resume schema** that the user owns. career-ops *produces* canonical JSON; reactive-resume *consumes* it. Every future tool either produces or consumes this schema.

---

## 3. Non-Negotiable Design Rules

These prevent the project from rotting. Enforce them in code review and in the README.

1. **Never hand-edit anything inside `vendor/`.** Editing vendored files causes merge conflicts on every upstream sync. To change upstream behavior, use the tool's own extension points (career-ops is designed to be customized via its `modes/` and `config/` files — those are the legitimate seams), or keep a re-appliable patch in `glue/patches/`, or consciously decide that folder is now a hard fork and stop syncing it.
2. **All customization lives in `glue/`, `config/`, or `scripts/`.** Never in `vendor/`.
3. **All inter-tool communication goes through the canonical schema** in `glue/shared-schema/`. No tool calls another tool's internals directly.
4. **Use `-squash` on every subtree operation.** Keeps history readable and repo size sane.
5. **Generated artifacts (PDFs, scan results, trackers) go in `data/` and are gitignored.** The repo is about code + config, not output.
6. **CI tests the glue layer only** — do not re-run the vendored projects' own CI.

---

## 4. Target Repository Layout

```
career-platform/
├── README.md                     # What this is + how to sync + how to add tools
├── .gitignore
├── vendor/                       # All subtrees; treated as read-only
│   ├── career-ops/               # subtree → karangupta8/career-ops-custom
│   └── reactive-resume/          # subtree → karangupta8/reactive-resume-fork
├── glue/                         # USER integration code (the seam layer)
│   ├── shared-schema/
│   │   └── resume.schema.json    # Canonical resume data contract (spine of platform)
│   ├── careerops-to-resume/      # Maps career-ops output → canonical → reactive-resume
│   ├── adapters/                 # One subfolder per integrated tool
│   └── patches/                  # Optional re-appliable patches to vendored code
├── config/
│   ├── profile.yml               # User CV/profile — single source of truth
│   └── platform.yml              # Which tools are active, paths, runtime settings
├── scripts/
│   ├── sync-upstream.sh          # Pull all subtrees in one command
│   ├── add-tool.sh               # Scaffold a new vendored tool + adapter
│   └── run-pipeline.sh           # End-to-end: scan → evaluate → build resume
├── data/                         # Generated artifacts (mostly gitignored)
└── .github/
    └── workflows/
        └── glue-ci.yml           # CI for the glue layer only
```

---

## 5. Build Phases

> Execute in order. Commit after each phase with the message shown.
> 

### Phase 0 — Preconditions

- Confirm `git` (with `git subtree` available — it ships with standard Git), `bash`, and network access to GitHub.
- Confirm the two fork URLs are reachable.
- Create the project directory outside any existing repo.

### Phase 1 — Scaffold the monorepo

```bash
mkdir career-platform && cd career-platform
git init && git commit --allow-empty -m "chore: init platform monorepo"

# Register upstreams as named remotes so later commands stay short
git remote add careerops-up <https://github.com/karangupta8/career-ops-custom.git>
git remote add resume-up     <https://github.com/karangupta8/reactive-resume-fork.git>

# Vendor both projects as subtrees under vendor/
git subtree add --prefix=vendor/career-ops      careerops-up main --squash
git subtree add --prefix=vendor/reactive-resume resume-up     main --squash
```

> **Branch check:** Verify the default branch of each fork before running (`main` vs `master`). Adjust the branch argument if needed.
> 

Then create the directory skeleton and commit:

```bash
mkdir -p glue/shared-schema glue/careerops-to-resume glue/adapters glue/patches
mkdir -p config scripts data .github/workflows
# (create the files specified in Sections 6–9)
git add . && git commit -m "feat: scaffold glue, config, scripts, and CI layout"
```

### Phase 2 — One-command upstream sync

Create `scripts/sync-upstream.sh` (see Section 7). Make it executable. Maintenance is then simply running this script when updates are wanted.

```bash
chmod +x scripts/sync-upstream.sh
git add scripts/sync-upstream.sh && git commit -m "feat: add one-command upstream sync script"
```

### Phase 3 — Define the canonical data contract

Create `glue/shared-schema/resume.schema.json` (see Section 8). Align it to the **JSON Resume** standard so the platform is not inventing a bespoke format. This file is the spine — every tool negotiates through it.

```bash
git add glue/shared-schema/ && git commit -m "feat: add canonical resume JSON schema (JSON Resume aligned)"
```

### Phase 4 — Wire career-ops → reactive-resume (the seam)

1. Inspect how career-ops emits CV/resume content (it has a CV/PDF generation pipeline; look at its `modes/`, templates, and the `.mjs` generation scripts). Determine the cleanest structured output it can produce.
2. In `glue/careerops-to-resume/`, write an **output adapter**: takes career-ops' generated resume data → serializes to the canonical `resume.schema.json` shape.
3. Write an **import adapter**: takes canonical JSON → feeds it into reactive-resume's import path. Reactive Resume supports JSON-based resume import; target that. (If self-hosting reactive-resume, the adapter may call its import API or write to its expected import format.)
4. If career-ops needs to emit cleaner structured output, achieve it through its **documented extension points** (`modes/`, `config/`, templates) — never by editing core vendored files.

```bash
git add glue/careerops-to-resume/ && git commit -m "feat: career-ops → canonical → reactive-resume adapters"
```

### Phase 5 — End-to-end orchestration

Create `scripts/run-pipeline.sh` that chains: career-ops evaluates/scans a job → emits tailored resume data → adapter converts to canonical JSON → reactive-resume renders the final resume PDF. Keep each step a discrete, independently runnable command so failures are easy to isolate.

```bash
chmod +x scripts/run-pipeline.sh
git add scripts/run-pipeline.sh && git commit -m "feat: end-to-end pipeline orchestration script"
```

### Phase 6 — Extensibility for future tools

Create `scripts/add-tool.sh` (see Section 7) so adding tool #3 is mechanical: vendor it under `vendor/`, scaffold an adapter folder, then the only real work is writing one adapter to/from the canonical schema.

```bash
chmod +x scripts/add-tool.sh
git add scripts/add-tool.sh && git commit -m "feat: add-tool scaffolding script for future integrations"
```

### Phase 7 — Docs, gitignore, CI

Create `README.md`, `.gitignore`, and `.github/workflows/glue-ci.yml` (see Section 9). Commit.

```bash
git add README.md .gitignore .github/ && git commit -m "docs: README, gitignore, and glue-layer CI"
```

### Phase 8 — Push

```bash
# Create an empty GitHub repo named career-platform first, then:
git remote add origin <https://github.com/karangupta8/career-platform.git>
git push -u origin main
```

---

## 6. Config File Templates

**`config/platform.yml`**

```yaml
# Which vendored tools are active and where they live
tools:
  career-ops:
    path: vendor/career-ops
    upstream_remote: careerops-up
    branch: main
  reactive-resume:
    path: vendor/reactive-resume
    upstream_remote: resume-up
    branch: main

# Canonical schema location
schema: glue/shared-schema/resume.schema.json

# Where generated artifacts land
data_dir: data
```

**`config/profile.yml`** — single source of truth for the user's career data. Start minimal; career-ops and the adapters read from here.

```yaml
name: ""
headline: ""
contact:
  email: ""
  location: ""
  links: []
summary: ""
# Detailed work history, skills, etc. — expand as needed.
```

---

## 7. Script Templates

**`scripts/sync-upstream.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

git subtree pull --prefix=vendor/career-ops      careerops-up main --squash \
  -m "chore: sync career-ops from upstream"
git subtree pull --prefix=vendor/reactive-resume resume-up     main --squash \
  -m "chore: sync reactive-resume from upstream"

echo "✅ All subtrees synced."
```

**`scripts/add-tool.sh`**

```bash
#!/usr/bin/env bash
# Usage: ./scripts/add-tool.sh <name> <git-url> [branch]
set -euo pipefail

NAME="${1:?tool name required}"
URL="${2:?git url required}"
BRANCH="${3:-main}"

git remote add "${NAME}-up" "$URL"
git subtree add --prefix="vendor/${NAME}" "${NAME}-up" "$BRANCH" --squash \
  -m "feat: vendor ${NAME} as subtree"
mkdir -p "glue/adapters/${NAME}"

echo "✅ Vendored vendor/${NAME} and scaffolded glue/adapters/${NAME}."
echo "   Next: write the adapter mapping ${NAME} to/from glue/shared-schema/resume.schema.json,"
echo "   and add a sync line for ${NAME} in scripts/sync-upstream.sh."
```

**`scripts/run-pipeline.sh`** — skeleton to flesh out once the adapters exist.

```bash
#!/usr/bin/env bash
set -euo pipefail

JOB_INPUT="${1:?pass a job URL or JD file}"

echo "1/3 Running career-ops evaluation..."
# TODO: invoke career-ops to evaluate JOB_INPUT and emit tailored resume data

echo "2/3 Converting to canonical resume JSON..."
# TODO: run glue/careerops-to-resume output adapter -> data/resume.canonical.json

echo "3/3 Building resume via reactive-resume..."
# TODO: run import adapter -> reactive-resume render -> data/resume.pdf

echo "✅ Pipeline complete. Output in data/."
```

---

## 8. Canonical Schema Starter

Create `glue/shared-schema/resume.schema.json`, aligned to the JSON Resume standard. Minimum viable starting point — expand as adapters require:

```json
{
  "$schema": "<http://json-schema.org/draft-07/schema#>",
  "title": "CanonicalResume",
  "description": "Platform-owned resume contract. JSON Resume aligned. All tools negotiate through this.",
  "type": "object",
  "required": ["basics"],
  "properties": {
    "basics": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "label": { "type": "string" },
        "email": { "type": "string" },
        "phone": { "type": "string" },
        "location": { "type": "object" },
        "summary": { "type": "string" },
        "profiles": { "type": "array", "items": { "type": "object" } }
      }
    },
    "work": { "type": "array", "items": { "type": "object" } },
    "education": { "type": "array", "items": { "type": "object" } },
    "skills": { "type": "array", "items": { "type": "object" } },
    "projects": { "type": "array", "items": { "type": "object" } },
    "meta": {
      "type": "object",
      "description": "Platform metadata: source job, tailoring notes, generated timestamp.",
      "properties": {
        "tailoredForJob": { "type": "string" },
        "generatedBy": { "type": "string" },
        "generatedAt": { "type": "string" }
      }
    }
  }
}
```

---

## 9. README, .gitignore, CI

**`.gitignore`**

```
# Generated artifacts
data/**
!data/.gitkeep

# Dependency / build outputs from vendored tools (adjust per tool)
node_modules/
dist/
build/
*.log

# Env / secrets
.env
.env.*
```

**`README.md`** — should cover: what the platform is, the three-layer architecture diagram, the golden rule (never edit `vendor/`), how to sync upstream (`./scripts/sync-upstream.sh`), how to add a tool (`./scripts/add-tool.sh <name> <url>`), and how to run the pipeline.

**`.github/workflows/glue-ci.yml`** — lint/validate the glue layer and the schema only:

```yaml
name: glue-ci
on:
  push:
    paths: ["glue/**", "scripts/**", "config/**"]
  pull_request:
    paths: ["glue/**", "scripts/**", "config/**"]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Validate canonical schema is valid JSON
        run: |
          python3 -c "import json,sys; json.load(open('glue/shared-schema/resume.schema.json'))"
      - name: Shellcheck scripts
        run: |
          sudo apt-get update && sudo apt-get install -y shellcheck
          shellcheck scripts/*.sh
```

---

## 10. Maintenance Runbook

- **Get upstream updates:** `./scripts/sync-upstream.sh` — run on your own schedule.
- **Add a new job tool:** `./scripts/add-tool.sh <name> <git-url> [branch]`, then write its adapter to/from the canonical schema and add a sync line.
- **Run end-to-end:** `./scripts/run-pipeline.sh <job-url-or-file>`.
- **If a subtree pull conflicts:** it almost always means something inside `vendor/` was hand-edited. Move that change into `glue/` or `glue/patches/` and revert the vendored file.

---

## 11. Known Constraints & Escalation Path

- **Different runtimes:** career-ops (Node/Go) and reactive-resume (TypeScript web app, own DB/build) will not share a process. Integrate them as separate services exchanging canonical JSON files. Do not attempt to merge their dependency trees.
- **Branch names:** confirm `main` vs `master` per fork before subtree operations.
- **Reactive Resume self-hosting:** the import adapter may require a running self-hosted instance or use of its JSON import feature; check current reactive-resume docs for the supported import path at build time.
- **When to graduate off this design:** if the user ends up *heavily modifying* both vendored projects (not just gluing), the subtree-monorepo stops paying off. At that point, hard-fork each and convert the platform into a proper workspace monorepo (pnpm/npm workspaces, Nx, or Turborepo). Until real pain appears, the vendored-subtree + canonical-schema + glue-layer design here is the correct level of investment.

---

## 12. Definition of Done

- [ ]  `career-platform` repo initialized; both forks vendored under `vendor/` via subtree with `-squash`.
- [ ]  `glue/`, `config/`, `scripts/`, `data/`, `.github/` scaffolded.
- [ ]  `scripts/sync-upstream.sh` pulls both subtrees in one command.
- [ ]  `glue/shared-schema/resume.schema.json` exists and is valid JSON, JSON Resume aligned.
- [ ]  career-ops → canonical → reactive-resume adapters exist in `glue/careerops-to-resume/`.
- [ ]  `scripts/run-pipeline.sh` chains the full flow end-to-end.
- [ ]  `scripts/add-tool.sh` scaffolds new tools mechanically.
- [ ]  `README.md`, `.gitignore`, and `glue-ci.yml` present.
- [ ]  No files inside `vendor/` have been hand-edited.
- [ ]  Repo pushed to `origin`.