# HSK 4 Writing project map

Last updated: 2026-09-25.

## Architecture and files

Standalone React 19 + TypeScript application built with Vite. `index.html` loads `src/hsk/main.tsx`, which mounts `WorkbookApp`. A Vercel Node function persists a shared workbook in a private Vercel Blob store. Editing is anonymous, with no authentication.

| File | Responsibility |
| --- | --- |
| `index.html`, `src/hsk/main.tsx` | HTML entry, React root, page metadata, and stylesheet import. |
| `src/hsk/WorkbookApp.tsx` | Set navigation, word/picture editing, uploads, imports/backups, save feedback, language selection, preview, and printing. `Sheet` is shared between preview and print. |
| `src/hsk/styles.css` | Responsive interface, physical A4 pages, word-length typography, and print rules that hide controls/backgrounds. |
| `src/hsk/provided-content.json` | Supplied transcription: 440 word groups and 215 keywords in original order, with explicit empty arrays for missing parts. |
| `src/hsk/data.ts` | Workbook types, 45-set starter, strict validation, partial merging, image budgets, and revision-aware IndexedDB persistence. |
| `src/hsk/locales/en.ts`, `src/hsk/locales/vi.ts` | English and Vietnamese interface and worksheet messages. |
| `src/hsk/cloud.ts` | Cloud fetch/publish protocol and preservation of unpublished local drafts. |
| `api/workbook.ts`, `server/workbook-cloud.ts` | Same-origin JSON endpoint, signed direct uploads/downloads, snapshot validation, conditional pointer publication, and old snapshot cleanup. |
| `public/hsk-favicon.svg` | App icon. |
| `scripts/verify-hsk-workbook.mjs` | Isolated browser and PDF regression checks; writes ignored `artifacts/hsk/`. |
| `docs/hsk-worksheet-content.md` | Editable content schema, limits, import semantics, and storage details. |
| `vite.config.ts`, `tsconfig.json`, `package.json` | Standalone build, TypeScript, dependencies, and verification commands. |
| `vercel.json` | Vite deployment and redirects from `/hsk` and `/hsk.html` to `/`. |

## Behavior and data flow

- A workbook has 45 numbered sets; each set contains exactly 10 word-order questions and 5 picture prompts. Each prompt combines an image and a supplied keyword.
- Starter content comes from the supplied transcription: 440 word-order questions and 215 keywords. Set 12 is blank; Set 28 has no picture keywords. Actual picture files were not supplied. Duplicated source uploads for Sets 29 and 45 do not create duplicate sets.
- Text fields update the selected set. Uploaded images must decode successfully. Import validates JSON and images, then replaces only matching numbered sets. Backups embed pictures in portable JSON.
- Version 1 JSON: `{ version: 1, sets: [{ id, words: [{ id, words }], pictures: [{ id, word, image, alt }] }] }`. Set IDs are 1–45. Question IDs must be unique. Word groups allow 100 characters; keywords 12; image descriptions 200.
- PNG/JPEG/WebP/GIF data URLs are supported, at most 4 MiB decoded per image. A workbook allows 90 MiB total image-string characters, keeping its exported backup below the 100 MiB import limit. External image URLs and SVGs are rejected.
- Optional `providedContentRevision: 1` marks the supplied content as applied. On first load of an older workbook, `restoreWorkbook` fills blank fields and replaces the untouched original Set 01 sample; authored nonempty fields and pictures are preserved. This migration runs once so subsequent intentional deletions stay deleted. JSON validation and partial merges retain the revision.
- Debounced saves use IndexedDB database `hsk-writing-workbook` v1, store `workbooks`, key `current`. Stored value: `{ revision, workbook }`; exported JSON remains the plain workbook. Legacy bare stored workbooks still load.
- Queued saves compare the previously loaded revision inside an atomic read/write transaction. A stale tab cannot overwrite a newer tab's changes; it retains unsaved edits for backup and must reload before saving again.
- IndexedDB remains the local draft cache. Optional `cloudRevision` (ETag or null) and `cloudDirty` track shared publication; portable backups strip these fields. On startup clean caches refresh from the cloud; unpublished and legacy authored drafts are preserved. **Save to website** explicitly publishes; **Load website copy** downloads a dirty draft backup before replacement.
- Private Vercel Blob snapshots at `snapshots/<uuid>.json` embed all images; signed URLs expire after 15 minutes and direct transfers bypass function request limits. Uploads allow JSON up to 100 MiB; publication validates all 45 sets and image signatures. `published/current.json` contains `{pathname,savedAt,previous?}`. Atomic ETag conditional writes reject stale saves with HTTP 409. Cleanup retains current/previous snapshots and removes unused snapshots older than one hour (up to 1000 listed per save).
- Anonymous editing is intentional: anyone with the website link can read and replace the shared workbook. Browser cross-origin writes are rejected, but there is no access control. The Blob token is server-only and stored in Vercel environments; `.env.local` is ignored. Hobby usage limits apply.
- `Sheet` prints two portrait A4 pages per set, with 10 word questions on the first page and 5 picture prompts on the second. Current-set output has 2 pages; all-set output has 90. Controls and decorative interface backgrounds are hidden when printing.

## Verification

- `npm run build`: TypeScript and production Vite build.
- `npm run lint`: Oxlint.
- `npm run verify:cloud`: draft reconciliation, remote refresh, legacy content preservation, metadata validation and portable backup checks.
- `npm run dev` serves local editing only. Use `vercel dev` with linked Blob environment variables for full local cloud endpoints.
- `npm run verify:content`: validates supplied-content counts, missing parts, exact representative transcription, and safe one-time migration. Its Vite cache is isolated in `node_modules/.vite-content-verification` so it cannot invalidate a running development server.
- `npm run verify:hsk`: requires a running local server at `http://127.0.0.1:5174`, Google Chrome, and Poppler `pdfinfo`. Covers edits, pictures, reload persistence, backup/partial import, malformed images, languages, print button, exact A4 page counts, long-text page bounds, mobile overflow, and cross-tab conflicts. Playwright is a development dependency; `HSK_PLAYWRIGHT_MODULE` can override its module path and `HSK_BASE_URL` can override the tested server.
- Visual print QA: render PDFs from `artifacts/hsk/` using `pdftoppm`, then inspect the page images.

## Update notes

- 2026-09-24: Published to `https://hsk4writing.vercel.app` and connected Vercel project `hsk4writing` to `Merojiddin/hsk4writing`; pushes to `main` trigger production deployment.
- 2026-09-24: Added supplied text for 44 Part 1 sets and 43 Part 2 keyword sets without correcting or rearranging the transcription. Added an explicit missing-content notice in both languages and a one-time migration preserving existing edits and images.

- 2026-09-24: Extracted only the HSK worksheet into its own project and repository. The application now opens at `/`. Added independent dependencies/configuration and Vercel deployment support; retained compatible workbook storage and JSON backups.

- 2026-09-25: Added anonymous shared website saving with Vercel Blob, explicit save/load controls in both languages, local draft preservation, and atomic stale-write protection.
- Live verification: browser save and fresh-browser load passed; two simultaneous unchanged publications returned 200/409 and preserved the workbook. Full local workbook/PDF regression passed (2/90 A4 pages). Server JSON imports use a Node-compatible import attribute. Snapshot size is checked from received bytes because streamed Blob GET responses may report size zero.
