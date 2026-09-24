# HSK 4 Writing · Hanzi Studio

A standalone, printable writing-workbook builder with 45 practice sets. Each set has 10 sentence-ordering questions and 5 picture-and-keyword prompts, laid out across two clean portrait A4 pages.

## Run locally

```sh
npm ci
npm run dev
```

Open http://localhost:5174/. The webpage entry is `index.html`; the main interface is `src/hsk/WorkbookApp.tsx` and its styles are in `src/hsk/styles.css`.

## Use the workbook

- Select a set and choose **Edit content** to add word groups, keywords, and pictures.
- Choose English or Vietnamese instructions.
- Use **Print / Save PDF** to print the current set (2 pages) or all 45 sets (90 pages). Turn off browser headers and footers for clean pages.
- Use **Back up workbook** to download a portable JSON file. **Import data** replaces matching numbered sets and retains the rest.
- The supplied text includes 440 word-order questions and 215 picture keywords, kept in the original scrambled order. Set 12 is missing, as are the picture keywords for Set 28. Actual picture files still need to be added.

Changes are saved in this browser's IndexedDB. There are no accounts, server database, or secret environment variables. Content is local to each browser and website origin; use JSON backup/import to move saved work between localhost, deployed websites, or devices. Hosting the application does not publish locally entered worksheets.

See [content and backup format](docs/hsk-worksheet-content.md) and the [project map](docs/PROJECT_MAP.md).

## Verification

```sh
npm run build
npm run lint
npm run verify:content
# With npm run dev running in another terminal:
npm run verify:hsk
```

Browser checks require Google Chrome and Poppler's `pdfinfo` command (on macOS: `brew install poppler`). Playwright is a development dependency. The checks use an isolated browser context and verify editing, uploads, persistence, partial imports, invalid images, language selection, print controls, A4 page counts, long prompts, mobile layouts, and cross-tab conflict handling. Generated screenshots/PDFs stay in ignored `artifacts/hsk/`.

To test another server, set `HSK_BASE_URL`. To use an externally installed Playwright module, set `HSK_PLAYWRIGHT_MODULE` to its module path.

## Deployment

GitHub: https://github.com/Merojiddin/hsk4writing

Vercel configuration is in `vercel.json`: framework Vite, build command `npm run build`, output `dist`. The application is served at `/`; old `/hsk` and `/hsk.html` paths redirect there. No environment variables are required.
