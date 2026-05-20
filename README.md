# Content Repurposer — Marketing Prototype

A first-iteration prototype that lets the Marketing team paste a long-form
blog post and instantly get **review-ready drafts** for every channel they
publish to: LinkedIn, Twitter/X, email newsletter, sales ROI one-pager,
Instagram carousel, and internal comms.

Goal: collapse the 15–20 hour repurposing workflow into minutes, while
keeping a human in the loop for every output.

## Run it

```powershell
npm install
npm run dev
```

Open http://localhost:5173.

## What it does

1. **Paste** the long-form post (and an optional title).
2. **Pick the formats** you want drafts for.
3. **Generate** — you get one editable draft per channel.
4. **Review & approve** each one. You can edit, leave a reviewer comment,
   approve, or request changes.
5. **Export** the approved package as JSON to hand off to channel owners.
   **Nothing is auto-posted to any social network.**

## Architecture

- `src/types.ts` — domain model (`Draft`, `FormatDefinition`, `ApprovalStatus`).
- `src/generator.ts` — pluggable content generator. The prototype uses
  deterministic template transforms so it runs with no API keys. The
  `generateDrafts()` function is async and can be swapped for a real call
  to Azure OpenAI / Anthropic / etc. without changing any UI code.
- `src/App.tsx` — three-step UI: source → formats → review/approve.
- `src/styles.css` — small custom design system, no UI library dependency.

## Roadmap (next iterations)

- **v0.2** — PDF upload + text extraction (e.g. `pdfjs-dist`).
- **v0.3** — Real LLM backend (Azure OpenAI), with brand voice prompts
  stored per format and per persona.
- **v0.4** — Multi-user review: assign approvers per channel, audit log,
  version history.
- **v0.5** — Direct channel hand-off (draft into Buffer / Hootsuite /
  Mailchimp via API — still requires explicit human "send").
- **v0.6** — Analytics loop: pull engagement back per channel to inform
  future generations.
