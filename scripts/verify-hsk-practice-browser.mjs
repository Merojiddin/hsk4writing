import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'

const { chromium } = await import(
  process.env.HSK_PLAYWRIGHT_MODULE || 'playwright'
)
const base = process.env.HSK_BASE_URL || 'http://127.0.0.1:5174'
const out = 'artifacts/hsk'
const blobOrigin =
  'https://practice-verification.private.blob.vercel-storage.com'
const keyMarker = 'KEY_ONLY_PRINT_SENTINEL'
const attemptMarker = 'LEARNER_ONLY_PRINT_SENTINEL'
const errors = []
const cloud = { workbook: null, upload: null, revision: null, publications: 0 }
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })

// All cloud traffic stays inside the verifier, including signed Blob transfers.
async function isolatedContext() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  })
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  )
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === new URL(base).origin && url.pathname === '/api/workbook') {
      if (request.method() === 'GET') {
        return route.fulfill({
          json: {
            revision: cloud.revision,
            downloadUrl: cloud.workbook ? `${blobOrigin}/snapshot.json` : null,
          },
        })
      }
      const body = request.postDataJSON()
      if (body.revision !== cloud.revision)
        return route.fulfill({ status: 409, json: { error: 'conflict' } })
      if (body.action === 'prepare')
        return route.fulfill({
          json: {
            pathname: 'snapshots/practice-verification.json',
            uploadUrl: `${blobOrigin}/upload`,
          },
        })
      assert.equal(body.action, 'publish')
      assert.equal(body.pathname, 'snapshots/practice-verification.json')
      assert.ok(cloud.upload, 'publication follows a snapshot upload')
      cloud.workbook = structuredClone(cloud.upload)
      cloud.publications += 1
      cloud.revision = `practice-revision-${cloud.publications}`
      return route.fulfill({ json: { revision: cloud.revision } })
    }
    if (url.origin === blobOrigin) {
      const headers = {
        'Access-Control-Allow-Origin': new URL(base).origin,
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
      if (request.method() === 'OPTIONS')
        return route.fulfill({ status: 204, headers })
      if (url.pathname === '/upload' && request.method() === 'PUT') {
        cloud.upload = request.postDataJSON()
        return route.fulfill({ status: 200, headers, body: '' })
      }
      assert.equal(url.pathname, '/snapshot.json')
      assert.equal(request.method(), 'GET')
      return route.fulfill({ headers, json: cloud.workbook })
    }
    if (url.origin === new URL(base).origin) return route.continue()
    return route.abort()
  })
  return context
}

const mode = (page, name) =>
  page.locator('.mode-tabs').getByRole('button', { name, exact: true }).click()
const solve = (page) => mode(page, 'Solve exercises')
const keys = (page) => mode(page, 'Answer key')
const choose = (page, id) =>
  page.locator(`.set-grid button[aria-label="Set ${id}"]`).click()
const answer = (page, id) => page.getByTestId(`practice-answer-${id}`)
const key = (page, id) => page.getByTestId(`answer-key-${id}`)
const feedback = (page, id) => page.getByTestId(`practice-feedback-${id}`)
const check = (page) =>
  page.getByRole('button', { name: 'Check answers', exact: true }).first().click()
const saved = (page) =>
  page.locator('.save-status').filter({ hasText: 'Saved on this device' }).waitFor()
const open = async (page) => {
  await page.goto(`${base}/`)
  await answer(page, 'w1-1').waitFor()
  await page
    .getByRole('button', { name: 'Save to website', exact: true })
    .waitFor()
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find(
      (element) => element.textContent.trim() === 'Save to website',
    )
    return button && !button.disabled
  })
  await saved(page)
}
const expectFeedback = async (page, id, expected) => {
  await feedback(page, id).waitFor()
  assert.ok(
    (await feedback(page, id).innerText()).includes(expected),
    `${id} feedback includes ${expected}`,
  )
}
const expectNoResults = async (page) => {
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="practice-feedback-"]').length === 0,
  )
}
const backup = async (page) => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Back up workbook', exact: true }).click(),
  ])
  return JSON.parse(await readFile(await download.path(), 'utf8'))
}
const uploadJson = async (page, workbook) => {
  await page
    .locator('input[type=file][accept="application/json,.json"]')
    .setInputFiles({
      name: 'practice-fixture.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(workbook)),
    })
  await page
    .getByRole('status')
    .filter({ hasText: 'Content imported. Other sets have been kept.' })
    .waitFor()
  await saved(page)
}
async function noOverflow(page, label) {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${label} has no horizontal overflow`,
  )
}

try {
  const context = await isolatedContext()
  const page = await context.newPage()
  await open(page)
  assert.equal(
    await page.getByRole('button', { name: 'Solve exercises', exact: true }).getAttribute('aria-pressed'),
    'true',
    'workbook opens ready to solve',
  )
  assert.equal(await page.locator('[data-testid^="practice-answer-"]').count(), 15)

  await keys(page)
  const authored = {
    'w1-1': ['我每天学习汉语。', '我每天都学习汉语。'],
    'w1-2': ['今天天气很好。'],
    'w1-4': ['她正在看书。'],
    'w1-10': [keyMarker],
    'p1-1': ['他戴着一顶帽子。', '他戴了一顶帽子。'],
    'p1-2': ['她很激动。'],
    'p1-4': ['桌子上有一个盒子。'],
  }
  for (const [id, variants] of Object.entries(authored))
    await key(page, id).fill(variants.join('\n'))
  await saved(page)
  await page.screenshot({ path: `${out}/practice-answer-key.png`, fullPage: true })
  await choose(page, 2)
  assert.equal(await key(page, 'w2-1').inputValue(), '', 'keys belong to their set')
  await choose(page, 1)
  assert.equal(await key(page, 'w1-1').inputValue(), authored['w1-1'].join('\n'))

  await solve(page)
  const attempts = {
    'w1-1': '我 每天 都学习汉语！',
    'w1-2': '今天下雨了。',
    'w1-3': '这里还没有参考答案。',
    'w1-10': attemptMarker,
    'p1-1': '他戴了一顶帽子。',
    'p1-2': '她激动得说不出话来。',
    'p1-3': '他在城市里迷路了。',
  }
  for (const [id, text] of Object.entries(attempts)) await answer(page, id).fill(text)
  await check(page)
  await expectFeedback(page, 'w1-1', 'Matches answer key')
  await page.getByRole('button', { name: 'Continue practicing', exact: true }).click()
  await expectNoResults(page)
  assert.equal(await answer(page, 'w1-1').inputValue(), attempts['w1-1'], 'continuing practice preserves entered answers')
  await check(page)
  await expectFeedback(page, 'w1-2', 'Does not match answer key')
  await expectFeedback(page, 'w1-3', 'No answer key — not graded')
  await expectFeedback(page, 'w1-4', 'Unanswered')
  await expectFeedback(page, 'p1-1', 'Matches answer key')
  await expectFeedback(page, 'p1-2', 'Review with answer key')
  await expectFeedback(page, 'p1-3', 'No answer key — not graded')
  await expectFeedback(page, 'p1-4', 'Unanswered')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${out}/practice-desktop-viewport.png` })
  await page.screenshot({ path: `${out}/practice-desktop.png`, fullPage: true })

  await page.pdf({
    path: `${out}/practice-blank-worksheet.pdf`,
    preferCSSPageSize: true,
    printBackground: true,
  })
  const pdfInfo = execFileSync('pdfinfo', [`${out}/practice-blank-worksheet.pdf`], {
    encoding: 'utf8',
  })
  assert.match(pdfInfo, /^Pages:\s+2$/m, 'solving still prints exactly two pages')
  assert.match(pdfInfo, /Page size:.*\(A4\)/, 'practice printing uses A4 paper')
  const dimensions = pdfInfo.match(/Page size:\s+([\d.]+) x ([\d.]+)/)
  assert.ok(Number(dimensions[1]) < Number(dimensions[2]), 'print pages are portrait')
  const pdfText = execFileSync(
    'pdftotext',
    [`${out}/practice-blank-worksheet.pdf`, '-'],
    { encoding: 'utf8' },
  )
  for (const privateText of [keyMarker, attemptMarker, 'Check answers', 'Matches answer key'])
    assert.equal(pdfText.includes(privateText), false, `print excludes ${privateText}`)
  await page.emulateMedia({ media: 'print' })
  assert.equal(await page.locator('.app-shell').isVisible(), false)
  assert.equal(await page.locator('.print-deck .word-questions li').count(), 10)
  assert.equal(await page.locator('.print-deck .picture-question').count(), 5)
  assert.equal(await page.locator('.print-deck input, .print-deck textarea').count(), 0)
  await page.emulateMedia({ media: 'screen' })

  await choose(page, 2)
  assert.equal(await answer(page, 'w2-1').inputValue(), '', 'new set has no learner answers')
  await answer(page, 'w2-1').fill('第二套的练习答案。')
  await choose(page, 1)
  assert.equal(await answer(page, 'w1-1').inputValue(), attempts['w1-1'])
  await mode(page, 'Worksheet preview')
  await solve(page)
  assert.equal(await answer(page, 'p1-2').inputValue(), attempts['p1-2'])
  await page.reload()
  await answer(page, 'w1-1').waitFor()
  assert.equal(await answer(page, 'w1-1').inputValue(), attempts['w1-1'], 'learner answer survives reload')
  await keys(page)
  assert.equal(await key(page, 'p1-1').inputValue(), authored['p1-1'].join('\n'), 'accepted variants survive reload')
  await solve(page)
  await check(page)
  await answer(page, 'w1-1').fill('我每天都学习中文。')
  await expectNoResults(page)
  await check(page)
  await expectFeedback(page, 'w1-1', 'Does not match answer key')
  await keys(page)
  authored['w1-1'].push('我每天都学习中文。')
  await key(page, 'w1-1').fill(authored['w1-1'].join('\n'))
  await saved(page)
  await solve(page)
  await expectNoResults(page)
  assert.equal(await answer(page, 'w1-2').inputValue(), attempts['w1-2'], 'key changes retain learner work')
  await check(page)
  await expectFeedback(page, 'w1-1', 'Matches answer key')

  const exported = await backup(page)
  assert.equal(exported.version, 1, 'backups retain the compatible workbook version')
  assert.equal(exported.sets.length, 45)
  for (const [id, variants] of Object.entries(authored)) {
    const question = [...exported.sets[0].words, ...exported.sets[0].pictures].find((item) => item.id === id)
    assert.deepEqual(question.answers, variants, `${id} accepted variants included in backup`)
  }
  assert.equal(JSON.stringify(exported).includes(attemptMarker), false, 'backups exclude learner answers')
  await page.getByRole('button', { name: 'Save to website', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Saved to the website.' }).waitFor()
  await saved(page)
  assert.equal(cloud.publications, 1)
  assert.deepEqual(cloud.workbook.sets[0].words[0].answers, authored['w1-1'])
  assert.equal(JSON.stringify(cloud.workbook).includes(attemptMarker), false, 'website snapshots exclude learner answers')

  const freshContext = await isolatedContext()
  const freshPage = await freshContext.newPage()
  await open(freshPage)
  assert.equal(await answer(freshPage, 'w1-1').inputValue(), '', 'another browser does not receive learner answers')
  await keys(freshPage)
  assert.equal(await key(freshPage, 'w1-1').inputValue(), authored['w1-1'].join('\n'), 'another browser receives published keys')
  assert.equal(await key(freshPage, 'p1-1').inputValue(), authored['p1-1'].join('\n'))
  await freshContext.close()

  await keys(page)
  await key(page, 'w1-1').fill('临时答案。')
  await saved(page)
  await uploadJson(page, exported)
  assert.equal(await key(page, 'w1-1').inputValue(), authored['w1-1'].join('\n'), 'import restores answer variants')
  const legacy = { version: 1, sets: [structuredClone(exported.sets[1])] }
  for (const question of [...legacy.sets[0].words, ...legacy.sets[0].pictures])
    delete question.answers
  await uploadJson(page, legacy)
  assert.equal(await key(page, 'w2-1').inputValue(), '', 'old backups without answers still import')
  await solve(page)
  assert.equal(await answer(page, 'w2-1').inputValue(), '第二套的练习答案。', 'import preserves separate practice data')
  await choose(page, 1)
  assert.equal(await answer(page, 'w1-10').inputValue(), attemptMarker)

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await solve(page)
    await check(page)
    await noOverflow(page, `practice at ${width}px`)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${out}/practice-mobile-top-${width}.png` })
    await answer(page, 'w1-1').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${out}/practice-mobile-answer-${width}.png` })
    await page.screenshot({ path: `${out}/practice-mobile-${width}.png`, fullPage: true })
    await keys(page)
    await noOverflow(page, `answer key at ${width}px`)
    await page.screenshot({ path: `${out}/practice-key-mobile-${width}.png`, fullPage: true })
  }
  await solve(page)
  await check(page)
  await page.locator('select').nth(1).selectOption('vi')
  assert.equal(await page.locator('html').getAttribute('lang'), 'vi')
  assert.equal(await page.getByRole('button', { name: 'Check answers', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Kiểm tra bài làm', exact: true }).count(), 2)
  await expectFeedback(page, 'w1-1', 'Khớp với đáp án')
  await expectFeedback(page, 'w1-2', 'Chưa khớp với đáp án')
  await expectFeedback(page, 'p1-2', 'Đối chiếu với đáp án')
  await page.screenshot({ path: `${out}/practice-vietnamese.png`, fullPage: true })

  const edgeContext = await isolatedContext()
  const firstTab = await edgeContext.newPage()
  await open(firstTab)
  await answer(firstTab, 'w1-2').fill('先保存的答案。')
  const staleTab = await edgeContext.newPage()
  await open(staleTab)
  assert.equal(await answer(staleTab, 'w1-2').inputValue(), '先保存的答案。')
  await answer(firstTab, 'w1-2').fill('另一个标签页的新答案。')
  await answer(staleTab, 'w1-1').fill('我每天学习汉语。')
  await check(staleTab)
  assert.equal(
    await firstTab.evaluate(() => JSON.parse(localStorage.getItem('hsk-writing-practice-v1:w1-2')).answer),
    '另一个标签页的新答案。',
    'checking a stale tab never overwrites another tab’s newer answer',
  )
  await staleTab.close()

  await firstTab.evaluate(() => {
    window.originalPracticeSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('hsk-writing-practice-v1:')) throw new Error('Simulated quota failure')
      return window.originalPracticeSetItem.call(this, key, value)
    }
  })
  await answer(firstTab, 'w1-1').fill('尚未保存的练习答案。')
  const storageWarning = firstTab.getByRole('alert').filter({ hasText: 'Your answers could not be saved' })
  await storageWarning.waitFor()
  await choose(firstTab, 2)
  await check(firstTab)
  assert.equal(await storageWarning.isVisible(), true, 'checking another set keeps the unsaved-answer warning')
  await keys(firstTab)
  await solve(firstTab)
  await choose(firstTab, 1)
  assert.equal(await answer(firstTab, 'w1-1').inputValue(), '尚未保存的练习答案。')
  await firstTab.evaluate(() => { Storage.prototype.setItem = window.originalPracticeSetItem })
  await check(firstTab)
  assert.equal(await storageWarning.count(), 0, 'successful retry clears the pending-write warning')
  assert.equal(
    await firstTab.evaluate(() => JSON.parse(localStorage.getItem('hsk-writing-practice-v1:w1-1')).answer),
    '尚未保存的练习答案。',
  )

  const reserved = { version: 1, sets: [structuredClone(exported.sets[44])] }
  // The other tab may have refreshed the workbook cache; start editing from its latest revision.
  await firstTab.reload()
  await answer(firstTab, 'w1-1').waitFor()
  await saved(firstTab)
  const reservedIds = ['constructor', 'toString', '__proto__']
  reservedIds.forEach((id, index) => {
    reserved.sets[0].words[index].id = id
    reserved.sets[0].words[index].answers = ['我每天学习汉语。']
  })
  await uploadJson(firstTab, reserved)
  await solve(firstTab)
  for (const id of reservedIds) await answer(firstTab, id).fill('我每天学习汉语。')
  await check(firstTab)
  for (const id of reservedIds) await expectFeedback(firstTab, id, 'Matches answer key')
  await keys(firstTab)
  for (const id of reservedIds) await key(firstTab, id).fill('我每天都学习汉语。')
  await saved(firstTab)
  const reservedBackup = await backup(firstTab)
  reservedIds.forEach((id, index) => {
    assert.equal(reservedBackup.sets[44].words[index].id, id)
    assert.deepEqual(reservedBackup.sets[44].words[index].answers, ['我每天都学习汉语。'])
  })
  await firstTab.reload()
  await choose(firstTab, 45)
  for (const id of reservedIds)
    assert.equal(await answer(firstTab, id).inputValue(), '我每天学习汉语。', 'valid imported IDs survive reload')
  await edgeContext.close()
  assert.deepEqual(errors, [], 'no uncaught browser errors')
  console.log(
    'HSK practice browser verification passed: key variants, grading states, invalidation, separate learner persistence, compatible imports/backups, mocked website sharing, Vietnamese, 390/320px layouts, and two blank A4 print pages.',
  )
} finally {
  await browser.close()
}
