# HSK 4 writing worksheet content

The worksheet builder supports 45 numbered practice sets. Every set has 10 scrambled-word questions and 5 picture questions, each with a required word and space for a student's sentence. A set prints on two clean A4 pages, with no decorative background. The starter now includes the supplied 440 word-order questions and 215 picture keywords exactly in their original scrambled order. Set 12 is entirely missing, and Set 28 has no picture keywords. No actual exercise picture files were supplied. Duplicate source uploads for Sets 29 and 45 are represented only once. Review transcription accuracy before distributing to students; no wording has been silently corrected.

## Editing and backups

Use the builder to edit words, upload pictures, and export a JSON backup. Words are plain text; separate scrambled pieces with ` / `. Picture descriptions provide alternative text and should describe only the visible scene. All image content is embedded into JSON so exported backups can be moved between devices.

Importing a workbook replaces only the corresponding numbered sets and preserves every other set. To update one set, import a file containing only that set. Imported sets must still have all 10 word questions and all 5 picture questions; empty strings are allowed for unfinished content. Importing does not append questions inside a set. Export a backup before replacing existing sets.

## JSON format

The top-level format is `{ "version": 1, "sets": [...] }`. A workbook or partial import contains 1–45 sets. Set IDs are unique integers from 1 through 45. Question IDs are unique across the entire workbook, have at most 80 characters, and contain only letters, digits, underscores, or hyphens. Use `w<set>-<question>` and `p<set>-<question>` for predictable IDs.

The following illustrates the fields only; an import must include the complete 10-element `words` array and 5-element `pictures` array for each set.

```json
{
  "version": 1,
  "sets": [
    {
      "id": 1,
      "words": [
        { "id": "w1-1", "words": "是谁 / 厨房的 / 打破的 / 窗户 / 究竟", "answers": ["厨房的窗户究竟是谁打破的？"] }
      ],
      "pictures": [
        { "id": "p1-1", "word": "戴", "image": "", "alt": "", "answers": ["他戴着一顶帽子。", "他戴着帽子。"] }
      ]
    }
  ]
}
```

Field limits: `words` is at most 100 characters, `word` is at most 12 characters, and `alt` is at most 200 characters. Images are empty strings or base64 data URLs for PNG, JPEG, WebP, or GIF, limited to 4 MiB of decoded image data each. The entire workbook is limited to 90 MiB of image data URL characters, including base64 encoding and MIME prefixes. This leaves room for metadata in backups under the 100 MiB import-file limit. External image URLs and SVG images are not accepted. Character limits use JavaScript string length. Unsupported fields are discarded during validation. Malformed or oversized imports fail before any existing content is replaced; the total image limit also applies to merged workbooks.

Both question types accept an optional `answers` array of at most 10 strings, each at most 300 characters. Omitted or empty arrays mean no answer key; old version 1 backups remain valid. Keys are retained by local saves, website publication, export, and numbered-set imports. As with all other set content, importing a set replaces its complete answer key, including when the imported set omits answers. The examples above are illustrative; enter your own supplied keys through **Answer key**, one accepted sentence per line. No keys are inferred or added to the starter content.

## Solving and checking

**Solve exercises** accepts a Chinese sentence for every prompt and checks it when **Check answers** is selected. The comparison normalizes Unicode width, whitespace, and common punctuation; it does not infer meaning or assess grammar. Any accepted variant can match. Unkeyed questions are ungraded, blank answers remain unanswered, and nonmatching picture sentences need human review because multiple sentences may be valid. The supplied key is shown after checking. Editing an answer, prompt, or key invalidates displayed results until checked again. **Continue practicing** hides the results without clearing typed answers.

Learner attempts are stored separately from workbooks in browser localStorage, one entry per question. They are never sent to the website, exported in workbook JSON, or printed. Entries contain the typed answer and a compact signature of the question content; changed questions retain the typed sentence but require a fresh check. Storage failure is shown in the interface, and in-memory answers remain available while the page stays open. Attempts belong to this browser profile, not a signed-in student account.

## Storage and implementation

`src/hsk/data.ts` owns the typed workbook schema, blank/sample creation, strict validation, partial-import merging, and browser persistence. It stores one version 1 workbook in the dedicated IndexedDB database `hsk-writing-workbook`, object store `workbooks`, key `current`. The stored value is an envelope `{ revision: string, workbook: Workbook }`; exported JSON remains the plain version 1 workbook. Existing plain-workbook storage is accepted and upgraded to an envelope on its next save. Each successful save generates a new UUID revision.

Storage operations from one page are queued. Each save atomically reads the current revision, compares it with the revision that page last loaded or saved, and writes only if they match. A newer save from another tab causes `WorkbookConflictError`, leaves the stored workbook unchanged, and stops this page from saving again until it is reloaded. Export any unsaved work from the affected page before reloading; then import the desired sets after reviewing the newer workbook. Saves resolve only after the atomic write transaction completes. A failed transaction does not advance the expected revision.

The exported `MAX_TOTAL_IMAGE_CHARS` and `imageDataSize(workbook)` support upload-budget checks; `validateWorkbook`, `mergeWorkbook`, and `saveWorkbook` enforce the limit with `WorkbookSizeError`. The browser keeps a local draft in IndexedDB. Save to website publishes a shared copy to private Vercel Blob storage without login; anyone with the website link can edit it. Local-only `cloudRevision` and `cloudDirty` metadata preserve unpublished drafts and detect stale saves, and are stripped from portable backups. Browser data can be cleared, so keep exported backups of completed work.

Installed starter content is in `src/hsk/provided-content.json`. The optional workbook field `providedContentRevision: 1` records that this content has been applied. When an original template workbook is first opened, blank text fields are filled and an untouched original Set 01 sample is replaced by the supplied Set 01. Existing nonempty edits and uploaded pictures are preserved. After this one-time migration, intentionally cleared fields remain blank on reload. Further pictures and corrections can be entered through the editor or imported as numbered sets.
