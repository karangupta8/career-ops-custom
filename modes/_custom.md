# Custom Instructions — career-ops

<!-- ============================================================
     THIS FILE IS YOURS. It will NEVER be auto-updated.

     Put your own house rules, custom workflows, and automations
     here -- anything you want the agent to ALWAYS do (or never do).

     This is for PROCEDURAL rules ("HOW I want things done").
     For WHO you are (archetypes, narrative, comp, negotiation),
     use modes/_profile.md instead. Keeping the two separate keeps
     each one readable.
     ============================================================ -->

## House Rules

- After every `apply` mode output, automatically append a **Claude Extension Prompt** block (see Custom Workflows → extension-fill below). I always want this at the end of apply outputs so I can copy-paste it into the Claude browser extension to fill the form.
- When running scan mode, always scan India portals (Naukri entries) and Gulf portals (Bayt entries) alongside the default ATS-hosted sources.
- Always check job liveness with `check-liveness.mjs` before generating a cover letter or PDF.

## Custom Workflows

### extension-fill

**Trigger:** User says "extension fill", "fill prompt", or "give me the fill prompt" — OR automatically appended after every `apply` mode run.

**Purpose:** Generate a self-contained prompt the user can paste into the Claude browser extension (claude.ai) while the company's application form is open in Chrome. Claude in the extension will read the visible form fields and fill them one by one using this data.

**How to generate the prompt:**

Read `config/profile.yml` and the answers already generated (from the current `apply` mode output, or from `interview-prep/{company}-{role}.md` if it exists). Then output the block below between the `---COPY START---` and `---COPY END---` markers. The user copies everything between the markers into the Claude extension sidebar.

```
---COPY START---
I'm filling out a job application form on the current page.
Please read every visible form field and fill it using the data below.
Go field by field. Do NOT click Submit or Apply — stop when all fields
are filled and ask me to review before submitting.

## My Info
Name: {candidate.full_name}
Email: {candidate.email}
Phone: {candidate.phone}
LinkedIn: {candidate.linkedin}
Portfolio: {candidate.portfolio_url}
Location: {candidate.location}
Current Title: {target_roles.primary[0]}

## Open-ended Answers
{For each question in the apply mode output, list it as:
Q: [question text]
A: [answer text]}

## CV Summary (paste if the form asks for a summary/bio)
{narrative.headline}
{narrative.exit_story — first 2 sentences only}

## File Uploads
- Resume/CV: I will upload the PDF manually — alert me when you reach a file upload field.

## Instructions for Claude
- Match each form field label to the closest key above (fuzzy match is fine).
- For dropdowns: pick the closest valid option to the value above.
- For checkboxes (e.g. "I agree to terms"): tick only if it is a standard consent/GDPR checkbox.
- For salary fields: use {compensation.target_range or "open to discussion"}.
- If you see a field you cannot match, leave it blank and list it at the end for me to fill.
- After filling all fields, show me a summary of what was filled and what needs my attention.
---COPY END---
```

**Notes:**
- Replace all `{...}` placeholders with real values from `config/profile.yml` and the current apply output before generating the block.
- Keep answers under 150 words each — Claude extension context is limited.
- Never include sensitive data (passwords, SSN, passport numbers) in this prompt.

### weekly-scan

**Trigger:** User says "weekly scan" or "run weekly review".

**Steps:**
1. Run `node scan.mjs` to pull new offers from all enabled portals (including Naukri via plugin).
2. Show a count: how many new URLs were added to `data/pipeline.md`.
3. Ask: "Want me to run the pipeline and evaluate these now?"
4. If yes, process `data/pipeline.md` in batch (up to 10 at a time).

## Output Preferences

- Lead evaluation reports with the **score and one-line verdict** before the block breakdown.
- After a batch run, show the token breakdown and a top-3 shortlist sorted by score.
- Save PDFs as: `output/YYYY-MM-DD-{company-slug}.pdf`

## Off-Limits

- Never auto-submit or auto-click Submit/Apply on any form under any circumstance.
- Never edit `modes/_shared.md`, `CLAUDE.md`, `AGENTS.md`, or any other system file to store my customizations — put everything in this file or `modes/_profile.md`.
