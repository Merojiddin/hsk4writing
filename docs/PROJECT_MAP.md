# HSK 4 Writing project map

Last updated: 2026-09-24.

## Architecture and files

Standalone React 19 + TypeScript application built with Vite. `index.html` loads `src/hsk/main.tsx`, which mounts `WorkbookApp`. It has no backend, authentication, external data services, or relationship to another application's runtime.

| File | Responsibility |
| --- | --- |
| `index.html`, `src/hsk/main.tsx` | HTML entry, React root, page metadata, and stylesheet import. |
| `src/hsk/WorkbookApp.tsx` | Set navigation, word/picture editing, uploads, imports/backups, save feedback, language selection, preview, and printing. `Sheet` is shared between preview and print. |
| `src/hsk/styles.css` | Responsive interface, physical A4 pages, word-length typography, and print rules that hide controls/backgrounds. |
| `src/hsk/data.ts` | Workbook types, 45-set starter, strict validation, partial merging, image budgets, and revision-aware IndexedDB persistence. |
| `src/hsk/locales/en.ts`, `src/hsk/locales/vi.ts` | English and Vietnamese interface and worksheet messages. |
| `public/hsk-favicon.svg` | App icon. |
| `scripts/verify-hsk-workbook.mjs` | Isolated browser and PDF regression checks; writes ignored `artifacts/hsk/`. |
| `docs/hsk-worksheet-content.md` | Editable content schema, limits, import semantics, and storage details. |
| `vite.config.ts`, `tsconfig.json`, `package.json` | Standalone build, TypeScript, dependencies, and verification commands. |
| `vercel.json` | Vite deployment and redirects from `/hsk` and `/hsk.html` to `/`. |

## Behavior and data flow

- A workbook has 45 numbered sets; each set contains exactly 10 word-order questions and 5 picture prompts. Each prompt combines an image and a supplied keyword.
- Set 01 starts with draft reference phrases and keywords, with no installed photos. The other sets start blank.
- Text fields update the selected set. Uploaded images must decode successfully. Import validates JSON and images, then replaces only matching numbered sets. Backups embed pictures in portable JSON.
- Version 1 JSON: `{ version: 1, sets: [{ id, words: [{ id, words }], pictures: [{ id, word, image, alt }] }] }`. Set IDs are 1–45. Question IDs must be unique. Word groups allow 100 characters; keywords 12; image descriptions 200.
- PNG/JPEG/WebP/GIF data URLs are supported, at most 4 MiB decoded per image. A workbook allows 90 MiB total image-string characters, keeping its exported backup below the 100 MiB import limit. External image URLs and SVGs are rejected.
- Debounced saves use IndexedDB database `hsk-writing-workbook` v1, store `workbooks`, key `current`. Stored value: `{ revision, workbook }`; exported JSON remains the plain workbook. Legacy bare stored workbooks still load.
- Queued saves compare the previously loaded revision inside an atomic read/write transaction. A stale tab cannot overwrite a newer tab's changes; it retains unsaved edits for backup and must reload before saving again.
- Storage is local to each browser/origin. There is no cloud sync. Moving from localhost to Vercel requires JSON backup/import for previously entered content.
- `Sheet` prints two portrait A4 pages per set, with 10 word questions on the first page and 5 picture prompts on the second. Current-set output has 2 pages; all-set output has 90. Controls and decorative interface backgrounds are hidden when printing.

## Verification

- `npm run build`: TypeScript and production Vite build.
- `npm run lint`: Oxlint.
- `npm run verify:hsk`: requires a running local server at `http://127.0.0.1:5174`, Google Chrome, and Poppler `pdfinfo`. Covers edits, pictures, reload persistence, backup/partial import, malformed images, languages, print button, exact A4 page counts, long-text page bounds, mobile overflow, and cross-tab conflicts. Playwright is a development dependency; `HSK_PLAYWRIGHT_MODULE` can override its module path and `HSK_BASE_URL` can override the tested server.
- Visual print QA: render PDFs from `artifacts/hsk/` using `pdftoppm`, then inspect the page images.

## Update notes

- 2026-09-24: Extracted only the HSK worksheet into its own project and repository. The application now opens at `/`. Added independent dependencies/configuration and Vercel deployment support; retained compatible workbook storage and JSON backups.
