import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'

const { chromium } = await import(process.env.HSK_PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.HSK_BASE_URL || 'http://127.0.0.1:5174'
const origin = new URL(base).origin
const blobOrigin = 'https://sync-verification.private.blob.vercel-storage.com'
const out = 'artifacts/hsk'
const browserErrors = []
const cloud = { workbook: null, upload: null, revision: null, publications: 0 }
const source = JSON.parse(await readFile('src/hsk/provided-content.json', 'utf8'))
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
async function requestStarted(gate, label) {
  let timer
  try {
    await Promise.race([
      gate.started.promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 20000) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
const mode = (page, name) =>
  page.locator('.mode-tabs').getByRole('button', { name, exact: true }).click()
const key = (page) => page.getByTestId('answer-key-w1-1')
const banner = (page) => page.getByTestId('website-sync')
const saveButton = (page) => banner(page).getByRole('button', { name: 'Save to website', exact: true })
const loadButton = (page) => banner(page).getByRole('button', { name: 'Load website copy', exact: true })
const saved = (page) => page.locator('.save-status').filter({ hasText: 'Saved on this device' }).waitFor()
const waitKey = (page, expected) => page.waitForFunction(
  (value) => document.querySelector('[data-testid="answer-key-w1-1"]')?.value === value,
  expected,
)
const waitBanner = (page, expected) => page.waitForFunction(
  (text) => document.querySelector('[data-testid="website-sync"]')?.textContent.includes(text),
  expected,
)
async function eventually(check, label) {
  const deadline = Date.now() + 20000
  while (!check()) {
    assert.ok(Date.now() < deadline, label)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
async function expectPicture(page, dataUrl) {
  const picture = page.locator('.practice-picture img').first()
  await picture.waitFor()
  assert.equal(await picture.getAttribute('src'), dataUrl)
  assert.equal(await picture.evaluate((image) => image.complete && image.naturalWidth > 0), true,
    'published picture decodes in the browser')
}
async function open(page) {
  await page.goto(`${base}/`)
  await page.getByTestId('practice-answer-w1-1').waitFor()
  await banner(page).waitFor()
}
async function storedRevision(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('hsk-writing-workbook', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const item = db.transaction('workbooks').objectStore('workbooks').get('current')
      item.onerror = () => { db.close(); reject(item.error) }
      item.onsuccess = () => { db.close(); resolve(item.result?.revision) }
    }
  }))
}
function replaceRemote(answer) {
  cloud.workbook = structuredClone(cloud.workbook)
  cloud.workbook.sets[0].words[0].answers = [answer]
  cloud.revision = `${cloud.revision}-new`
}
async function dispatchRefresh(page, event) {
  await page.evaluate((name) => {
    if (name === 'pageshow') {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    } else if (name === 'visibilitychange') {
      // Headless pages are visible; this exercises returning to a visible page.
      if (document.visibilityState !== 'visible') throw new Error('Expected a visible test page')
      document.dispatchEvent(new Event(name))
    } else {
      window.dispatchEvent(new Event(name))
    }
  }, event)
}

// Every API and signed Blob request is intercepted. This verifier never publishes
// to the real website, even when HSK_BASE_URL points at a deployed site.
async function isolatedContext(options = {}) {
  const state = { metadataGets: 0, snapshotGets: 0, uploadAttempts: 0, fail: false, failUploads: false, gate: null, uploadGate: null, ...options }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } })
  context.on('page', (page) => {
    page.on('pageerror', (error) => browserErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      // Network errors are expected only in the deliberate outage scenarios.
      if (state.allowOutageErrors && /Failed to load resource: the server responded with a status of 503/.test(message.text())) return
      if (state.allowConflicts && /Failed to load resource: the server responded with a status of 409/.test(message.text())) return
      browserErrors.push(message.text())
    })
  })
  await context.addInitScript(({ denyStorage }) => {
    window.syncCacheWrites = 0
    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'workbooks') window.syncCacheWrites += 1
      return originalPut.apply(this, args)
    }
    if (denyStorage) {
      indexedDB.open = () => { throw new DOMException('Simulated private-mode storage denial', 'SecurityError') }
    }
  }, { denyStorage: Boolean(state.denyStorage) })
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin && url.pathname === '/api/workbook') {
      if (request.method() === 'GET') {
        state.metadataGets += 1
        if (state.fail) return route.fulfill({ status: 503, json: { error: 'cloud_unavailable' } })
        return route.fulfill({ json: {
          revision: cloud.revision,
          downloadUrl: cloud.workbook ? `${blobOrigin}/snapshot.json` : null,
        } })
      }
      assert.equal(request.method(), 'POST')
      const body = request.postDataJSON()
      if (body.revision !== cloud.revision)
        return route.fulfill({ status: 409, json: { error: 'conflict' } })
      if (body.action === 'prepare') return route.fulfill({ json: {
        pathname: 'snapshots/sync-verification.json', uploadUrl: `${blobOrigin}/upload`,
      } })
      assert.equal(body.action, 'publish')
      assert.equal(body.pathname, 'snapshots/sync-verification.json')
      assert.ok(cloud.upload, 'publication follows a complete snapshot upload')
      cloud.workbook = structuredClone(cloud.upload)
      cloud.publications += 1
      cloud.revision = `sync-published-${cloud.publications}`
      return route.fulfill({ json: { revision: cloud.revision } })
    }
    if (url.origin === blobOrigin) {
      const headers = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store',
      }
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      if (url.pathname === '/upload' && request.method() === 'PUT') {
        state.uploadAttempts += 1
        if (state.failUploads) return route.fulfill({ status: 503, headers, body: '' })
        const snapshot = request.postDataJSON()
        if (state.uploadGate) {
          const gate = state.uploadGate
          gate.started.resolve()
          await gate.release.promise
        }
        cloud.upload = snapshot
        return route.fulfill({ status: 200, headers, body: '' })
      }
      assert.equal(url.pathname, '/snapshot.json')
      assert.equal(request.method(), 'GET')
      const snapshot = structuredClone(cloud.workbook)
      state.snapshotGets += 1
      if (state.gate) {
        const gate = state.gate
        gate.started.resolve()
        await gate.release.promise
      }
      return route.fulfill({ headers, json: snapshot })
    }
    if (url.origin === origin) return route.continue()
    return route.abort()
  })
  return { context, state }
}

try {
  const fixturePage = await browser.newPage()
  const pictureFixtures = await fixturePage.evaluate(() => Array.from({ length: 52 }, (_, index) => {
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 120
    const context = canvas.getContext('2d')
    context.fillStyle = `hsl(${index * 37 % 360} 52% 44%)`
    context.fillRect(0, 0, 160, 120)
    context.fillStyle = '#ffffff'
    context.fillRect(10 + index, 30, 60, 60)
    return canvas.toDataURL('image/jpeg')
  }))
  const [jpeg, uploadedJpeg] = pictureFixtures
  await fixturePage.close()
  cloud.workbook = {
    version: 1,
    providedContentRevision: 1,
    sets: source.sets.map((set, index) => ({
      id: index + 1,
      words: Array.from({ length: 10 }, (_, question) => ({
        id: `w${index + 1}-${question + 1}`, words: set.words[question] ?? '',
      })),
      pictures: Array.from({ length: 5 }, (_, question) => ({
        id: `p${index + 1}-${question + 1}`, word: set.keywords[question] ?? '', image: '', alt: '',
      })),
    })),
  }
  cloud.workbook.sets[0].pictures[0].image = jpeg
  cloud.workbook.sets[0].words[0].answers = ['网站上保存的答案。']
  cloud.revision = 'sync-initial'

  const gate = { started: deferred(), release: deferred() }
  const delayed = await isolatedContext({ gate })
  const delayedPage = await delayed.context.newPage()
  await delayedPage.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await requestStarted(gate, 'startup did not request the website snapshot')
  assert.equal(await delayedPage.locator('.loading-screen').isVisible(), true,
    'a pending snapshot shows explicit loading')
  assert.equal(await delayedPage.getByTestId('practice-answer-w1-1').count(), 0,
    'the empty starter never appears while published pictures are downloading')
  await delayedPage.screenshot({ path: `${out}/sync-loading.png` })
  gate.release.resolve()
  await delayedPage.getByTestId('practice-answer-w1-1').waitFor()
  await expectPicture(delayedPage, jpeg)
  await mode(delayedPage, 'Answer key')
  await waitKey(delayedPage, '网站上保存的答案。')
  await delayed.context.close()

  const denied = await isolatedContext({ denyStorage: true })
  const deniedPage = await denied.context.newPage()
  await open(deniedPage)
  await expectPicture(deniedPage, jpeg)
  await mode(deniedPage, 'Answer key')
  await waitKey(deniedPage, '网站上保存的答案。')
  assert.ok(denied.state.snapshotGets > 0, 'cloud still downloads when IndexedDB.open throws')
  await waitBanner(deniedPage, 'Up to date with website')
  await deniedPage.screenshot({ path: `${out}/sync-storage-denied.png` })
  await denied.context.close()

  const publisher = await isolatedContext()
  const page = await publisher.context.newPage()
  await open(page)
  await saved(page)
  await mode(page, 'Edit content')
  await page.getByLabel('Add picture 1', { exact: true }).setInputFiles({
    name: 'shared-material.JPG', mimeType: 'image/jpg', buffer: Buffer.from(uploadedJpeg.split(',')[1], 'base64'),
  })
  await page.waitForFunction((data) => document.querySelector('.image-upload img')?.getAttribute('src') === data, uploadedJpeg)
  await mode(page, 'Answer key')
  await key(page).fill('上传图片后保存的答案。')
  await saved(page)
  await eventually(() => cloud.publications === 1, 'JPEG and key changes automatically save to website')
  await waitBanner(page, 'Up to date with website')
  await saved(page)
  assert.equal(cloud.publications, 1)
  assert.equal(cloud.workbook.sets[0].pictures[0].image, uploadedJpeg)
  assert.deepEqual(cloud.workbook.sets[0].words[0].answers, ['上传图片后保存的答案。'])

  // Fifty uploads must survive publication; edits made during a slow upload must
  // be included in a subsequent snapshot rather than being marked as saved.
  const fifty = { version: 1, sets: structuredClone(cloud.workbook.sets.slice(0, 10)) }
  fifty.sets.forEach((set, setIndex) => set.pictures.forEach((picture, index) => {
    picture.image = pictureFixtures[setIndex * 5 + index + 2]
  }))
  const uploadGate = { started: deferred(), release: deferred() }
  publisher.state.uploadGate = uploadGate
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({
    name: 'fifty-shared-pictures.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fifty)),
  })
  await requestStarted(uploadGate, '50-picture import did not start automatic upload')
  await key(page).fill('五十张图片和上传期间编辑的答案。')
  await saved(page)
  publisher.state.uploadGate = null
  uploadGate.release.resolve()
  await eventually(() => cloud.publications >= 3, 'editing during an upload queues a second automatic snapshot')
  await waitBanner(page, 'Up to date with website')
  await saved(page)
  assert.deepEqual(cloud.workbook.sets[0].words[0].answers, ['五十张图片和上传期间编辑的答案。'])
  assert.equal(cloud.workbook.sets.flatMap((set) => set.pictures).filter((picture) => picture.image).length, 50,
    'all 50 pictures reach the published snapshot')

  const incognito = await isolatedContext()
  const freshPage = await incognito.context.newPage()
  await open(freshPage)
  await expectPicture(freshPage, pictureFixtures[2])
  for (let set = 1; set <= 10; set += 1) {
    await freshPage.locator(`.set-grid button[aria-label="Set ${set}"]`).click()
    const images = freshPage.locator('.practice-picture img')
    assert.equal(await images.count(), 5, `fresh browser receives five pictures for set ${set}`)
    for (let index = 0; index < 5; index += 1) {
      assert.equal(await images.nth(index).getAttribute('src'), pictureFixtures[(set - 1) * 5 + index + 2],
        `fresh browser receives exact published picture ${set}/${index + 1}`)
      assert.equal(await images.nth(index).evaluate((image) => image.complete && image.naturalWidth > 0), true)
    }
  }
  await freshPage.locator('.set-grid button[aria-label="Set 1"]').click()
  await mode(freshPage, 'Answer key')
  await waitKey(freshPage, '五十张图片和上传期间编辑的答案。')
  await saved(freshPage)
  await freshPage.screenshot({ path: `${out}/sync-fresh-context.png` })
  await incognito.context.close()

  publisher.state.failUploads = true
  publisher.state.allowOutageErrors = true
  publisher.state.allowConflicts = true
  const uploadsBeforeFailure = publisher.state.uploadAttempts
  const publicationsBeforeFailure = cloud.publications
  await key(page).fill('上传失败后重试保存的答案。')
  await saved(page)
  await eventually(() => publisher.state.uploadAttempts > uploadsBeforeFailure, 'automatic upload attempts to send the new draft')
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-testid="website-sync"]')
    return root && /could not|failed|not saved|retry/i.test(root.textContent)
  })
  assert.equal(cloud.publications, publicationsBeforeFailure, 'a failed upload is never reported as published')
  assert.equal(await key(page).inputValue(), '上传失败后重试保存的答案。', 'a failed upload retains edits')
  publisher.state.failUploads = false
  await saveButton(page).click()
  await eventually(() => cloud.publications > publicationsBeforeFailure, 'manual retry publishes the retained draft')
  await waitBanner(page, 'Up to date with website')
  await saved(page)
  const retried = await isolatedContext()
  const retriedPage = await retried.context.newPage()
  await open(retriedPage)
  await expectPicture(retriedPage, pictureFixtures[2])
  await mode(retriedPage, 'Answer key')
  await waitKey(retriedPage, '上传失败后重试保存的答案。')
  await retried.context.close()
  const successfulPublications = cloud.publications

  // A clean cache should not be rewritten just because validation/restoration
  // reconstructs object properties in a different order.
  const before = await storedRevision(page)
  await page.reload()
  await page.getByTestId('practice-answer-w1-1').waitFor()
  await waitBanner(page, 'Up to date with website')
  await page.waitForTimeout(500)
  assert.equal(await storedRevision(page), before, 'read-only reload keeps the local storage revision')
  assert.equal(await page.evaluate(() => window.syncCacheWrites), 0, 'read-only reload causes no IndexedDB write')
  await mode(page, 'Answer key')
  for (const event of ['focus', 'visibilitychange', 'pageshow', 'online']) {
    const newer = `新版本答案 ${event}`
    replaceRemote(newer)
    await dispatchRefresh(page, event)
    await waitKey(page, newer)
    await waitBanner(page, 'Up to date with website')
    await saved(page)
  }
  assert.equal(cloud.publications, successfulPublications, 'read-only refresh does not republish shared material')

  const refreshGate = { started: deferred(), release: deferred() }
  publisher.state.gate = refreshGate
  publisher.state.failUploads = true
  publisher.state.allowOutageErrors = true
  replaceRemote('下载期间发布的新答案。')
  await dispatchRefresh(page, 'focus')
  await requestStarted(refreshGate, 'focus did not refresh the website snapshot')
  await key(page).fill('下载期间正在编辑的本地答案。')
  await saved(page)
  refreshGate.release.resolve()
  publisher.state.gate = null
  await page.waitForTimeout(500)
  assert.equal(await key(page).inputValue(), '下载期间正在编辑的本地答案。',
    'a remote response cannot replace edits made while the download was running')
  assert.match(await banner(page).innerText(), /draft|not saved|newer version/i)
  replaceRemote('本地草稿之后的网站答案。')
  for (const event of ['focus', 'visibilitychange', 'pageshow', 'online']) await dispatchRefresh(page, event)
  await page.waitForTimeout(500)
  assert.equal(await key(page).inputValue(), '下载期间正在编辑的本地答案。',
    'background refresh preserves an unpublished local draft')
  await page.reload()
  await page.getByTestId('practice-answer-w1-1').waitFor()
  await mode(page, 'Answer key')
  await waitKey(page, '下载期间正在编辑的本地答案。')
  assert.match(await banner(page).innerText(), /draft|not saved|newer version/i)

  publisher.state.allowOutageErrors = true
  publisher.state.fail = true
  await page.reload()
  await page.getByTestId('practice-answer-w1-1').waitFor()
  await mode(page, 'Answer key')
  await waitKey(page, '下载期间正在编辑的本地答案。')
  assert.match(await banner(page).innerText(), /unavailable|could not|failed/i,
    'startup cloud failure stays visible alongside the retained local draft')
  assert.equal(await loadButton(page).isEnabled(), true, 'cloud failures offer an explicit retry')
  await loadButton(page).click()
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-testid="website-sync"]')
    return root && /unavailable|could not|failed/i.test(root.textContent)
  })
  assert.equal(await key(page).inputValue(), '下载期间正在编辑的本地答案。', 'a failed retry cannot clear the draft')
  await page.screenshot({ path: `${out}/sync-unavailable-draft.png` })
  publisher.state.fail = false
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    loadButton(page).click(),
  ])
  const draftBackup = JSON.parse(await readFile(await download.path(), 'utf8'))
  assert.deepEqual(draftBackup.sets[0].words[0].answers, ['下载期间正在编辑的本地答案。'],
    'explicitly loading the website copy backs up the unpublished draft')
  await waitKey(page, '本地草稿之后的网站答案。')
  await waitBanner(page, 'Up to date with website')
  await publisher.context.close()

  const outage = await isolatedContext({ fail: true, allowOutageErrors: true })
  const outagePage = await outage.context.newPage()
  await open(outagePage)
  assert.match(await banner(outagePage).innerText(), /unavailable|could not|failed/i,
    'a fresh browser sees a clear error when shared materials could not load')
  outage.state.fail = false
  await loadButton(outagePage).click()
  await waitBanner(outagePage, 'Up to date with website')
  await expectPicture(outagePage, pictureFixtures[2])
  await mode(outagePage, 'Answer key')
  await waitKey(outagePage, '本地草稿之后的网站答案。')
  await outage.context.close()
  assert.equal(cloud.publications, successfulPublications, 'refreshes, failures, and draft replacement never republish')
  assert.deepEqual(browserErrors, [], 'no unexpected browser console or uncaught errors')
  console.log('HSK website sync browser verification passed: delayed cloud loading, blocked IndexedDB, automatic JPEG/key publication, all 50 pictures in a fresh browser, edits during slow uploads, read-only cache stability, focus/visibility/pageshow/online refresh, draft preservation, outage retry, and draft backup before replacement.')
} finally {
  await browser.close()
}
