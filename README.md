# HSK 4 Writing · Hanzi Studio

A writing-practice website and printable workbook builder with 45 practice sets. Each set has 10 sentence-ordering questions and 5 picture-and-keyword prompts, laid out across two clean portrait A4 pages.

## Run locally

```sh
npm ci
npm run dev
```

Open http://localhost:5174/. The webpage entry is `index.html`; the main interface is `src/hsk/WorkbookApp.tsx` and its styles are in `src/hsk/styles.css`.

## Use the workbook

- **Solve exercises** opens by default. Type your sentences and choose **Check answers** to compare with the saved answer key. Your answers stay in this browser across sets and reloads; they are not published or included in workbook backups.
- Open **Answer key** to enter accepted sentences, one per line (up to 10 alternatives per question). Keys save automatically with the shared workbook. No answer keys are supplied initially.
- Checking ignores whitespace and common punctuation. Questions without a key are not graded. Picture sentences that differ from the key are marked for review because other sentences may also be valid; this is a comparison tool, not a grammar or meaning evaluator.
- Select a set and choose **Edit content** to add word groups, keywords, and pictures.
- Pictures support JPG/JPEG, PNG, WebP, and GIF files up to 4 MB. JPGs work even when the device supplies missing or nonstandard file-type metadata.
- Choose English or Vietnamese instructions.
- Use **Worksheet preview** or **Print / Save PDF** for blank worksheets: the current set (2 pages) or all 45 sets (90 pages). Learner answers and keys do not appear in print. Turn off browser headers and footers for clean pages.
- Use **Back up workbook** to download a portable JSON file. **Import data** replaces matching numbered sets and retains the rest.
- The supplied text includes 440 word-order questions and 215 picture keywords, kept in the original scrambled order. Set 12 is missing, as are the picture keywords for Set 28. Actual picture files still need to be added.

Uploads and edits automatically save locally and publish the complete workbook to shared Vercel Blob storage. Wait for **Up to date with website** and check **Pictures saved to website** before closing the uploading device. Edits made during a save are queued for the next save. **Save to website** retries a failed publication; older drafts without a recorded website revision need explicit review/save. **Load website copy** refreshes manually and first downloads a backup of unpublished edits. Older tabs cannot overwrite newer website saves.

Fresh and incognito browsers load the website materials even when browser storage is unavailable. Returning to a clean page or reconnecting checks for newer website content. Unpublished local drafts are preserved. Browser-only materials from an older version must be synced from the original uploading device; they cannot be recovered from an incognito window.

There is no login: anyone with the link can edit the shared workbook. Storage uses the existing Vercel Hobby account within its free usage limits. Keep JSON backups of important work.

See [content and backup format](docs/hsk-worksheet-content.md) and the [project map](docs/PROJECT_MAP.md).

## Verification

```sh
npm run build
npm run lint
npm run verify:content
npm run verify:cloud
npm run verify:practice
# With npm run dev running in another terminal:
npm run verify:hsk
npm run verify:practice-browser
npm run verify:sync
```

Browser checks require Google Chrome and Poppler's `pdfinfo` command (on macOS: `brew install poppler`). Playwright is a development dependency. The checks use an isolated browser context and verify editing, uploads, persistence, partial imports, invalid images, language selection, print controls, A4 page counts, long prompts, mobile layouts, and cross-tab conflict handling. Generated screenshots/PDFs stay in ignored `artifacts/hsk/`.

To test another server, set `HSK_BASE_URL`. To use an externally installed Playwright module, set `HSK_PLAYWRIGHT_MODULE` to its module path.

## Deployment

Live website: https://hsk4writing.vercel.app

GitHub: https://github.com/Merojiddin/hsk4writing

The Vercel project `hsk4writing` is connected to this repository. Pushes to `main` deploy to production automatically.

Vercel configuration is in `vercel.json`: framework Vite, build command `npm run build`, output `dist`. The application is served at `/`; old `/hsk` and `/hsk.html` paths redirect there. The server requires `BLOB_READ_WRITE_TOKEN`, automatically provisioned by the linked private Blob store. Never expose it with a `VITE_` prefix or commit `.env.local`. `npm run dev` supports local editing; use `vercel dev` for cloud API development.
