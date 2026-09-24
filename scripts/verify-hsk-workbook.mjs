import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const { chromium } = await import(
  process.env.HSK_PLAYWRIGHT_MODULE || 'playwright'
)
const base = process.env.HSK_BASE_URL || 'http://127.0.0.1:5174'
const out = 'artifacts/hsk'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
})
const page = await context.newPage()
const errors = []
context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)))
page.on('pageerror', (e) => errors.push(e.message))
const saved = (p) =>
  p
    .locator('.save-status')
    .filter({ hasText: 'Saved on this device' })
    .waitFor()
const open = async (p) => {
  await p.goto(`${base}/`)
  await p.locator('.worksheet-page').first().waitFor()
}
const edit = (p) => p.locator('.mode-tabs button').nth(1).click()
const preview = (p) => p.locator('.mode-tabs button').nth(0).click()
const choose = (p, id) =>
  p.locator(`.set-grid button[aria-label="Set ${id}"]`).click()
const uploadJson = async (p, data) => {
  await p
    .locator('input[type=file][accept="application/json,.json"]')
    .setInputFiles({
      name: 'fixture.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(data)),
    })
}
const backup = async (p) => {
  const [download] = await Promise.all([
    p.waitForEvent('download'),
    p.getByRole('button', { name: 'Back up workbook', exact: true }).click(),
  ])
  return JSON.parse(await readFile(await download.path(), 'utf8'))
}
const pdfPages = (path) =>
  Number(
    execFileSync('pdfinfo', [path], { encoding: 'utf8' }).match(
      /^Pages:\s+(\d+)/m,
    )?.[1],
  )
async function pdf(p, name, count) {
  await p.pdf({
    path: `${out}/${name}.pdf`,
    preferCSSPageSize: true,
    printBackground: true,
  })
  assert.equal(
    pdfPages(`${out}/${name}.pdf`),
    count,
    `${name} physical page count`,
  )
  const info = execFileSync('pdfinfo', [`${out}/${name}.pdf`], {
    encoding: 'utf8',
  })
  assert.match(info, /Page size:.*\(A4\)/, 'A4 page dimensions')
}
try {
  await open(page)
  assert.equal(await page.locator('.set-grid button').count(), 45)
  assert.equal(
    await page.locator('.preview-stack .word-questions li').count(),
    10,
  )
  assert.equal(
    await page.locator('.preview-stack .picture-question').count(),
    5,
  )
  await page.screenshot({ path: `${out}/desktop.png`, fullPage: true })
  await pdf(page, 'sample-english', 2)
  await page.locator('select').nth(1).selectOption('vi')
  await pdf(page, 'sample-vietnamese', 2)
  await page.locator('select').nth(0).selectOption('all')
  await pdf(page, 'all-45-sets', 90)
  await page.locator('select').nth(0).selectOption('current')
  await page.locator('select').nth(1).selectOption('en')
  await page.evaluate(() => {
    window.printCalls = 0
    window.print = () => window.printCalls++
  })
  await page
    .getByRole('button', { name: 'Print / Save PDF', exact: true })
    .click()
  assert.equal(
    await page.evaluate(() => window.printCalls),
    1,
    'Print control invokes print',
  )

  await choose(page, 2)
  await edit(page)
  await page
    .locator('.word-input-row input')
    .first()
    .fill('今天 / 很 / 天气 / 好')
  await page
    .locator('.picture-editor-card')
    .first()
    .locator('input')
    .nth(1)
    .fill('戴')
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 400
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#f2eee2'
    ctx.fillRect(0, 0, 600, 400)
    ctx.fillStyle = '#783d42'
    ctx.fillRect(200, 80, 200, 240)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page
    .locator('.image-upload input')
    .first()
    .setInputFiles({
      name: 'fixture.png',
      mimeType: 'image/png',
      buffer: Buffer.from(image, 'base64'),
    })
  await page.locator('.image-upload img').waitFor()
  await saved(page)
  await page.reload()
  await choose(page, 2)
  await edit(page)
  assert.equal(
    await page.locator('.word-input-row input').first().inputValue(),
    '今天 / 很 / 天气 / 好',
  )
  assert.equal(
    await page.locator('.image-upload img').count(),
    1,
    'uploaded photo survives reload',
  )
  const data = await backup(page)
  assert.equal(data.sets.length, 45)
  const partial = structuredClone(data)
  partial.sets = [partial.sets[2]]
  partial.sets[0].words[0].words = '每天 / 我 / 学习 / 汉语'
  await uploadJson(page, partial)
  await saved(page)
  await choose(page, 2)
  assert.equal(
    await page.locator('.word-input-row input').first().inputValue(),
    '今天 / 很 / 天气 / 好',
    'partial imports preserve other sets',
  )
  await choose(page, 3)
  assert.equal(
    await page.locator('.word-input-row input').first().inputValue(),
    '每天 / 我 / 学习 / 汉语',
  )
  const bad = structuredClone(partial)
  bad.sets[0].pictures[0].image = 'data:image/png;base64,YQ=='
  await uploadJson(page, bad)
  await page
    .getByRole('status')
    .filter({ hasText: 'This file could not be imported' })
    .waitFor()
  assert.equal(
    await page.locator('.image-upload img').count(),
    0,
    'broken imported images do not replace data',
  )

  const long = structuredClone(partial)
  for (const q of long.sets[0].words) q.words = '学习汉语'.repeat(25)
  for (const p of long.sets[0].pictures) p.word = '学习汉语'.repeat(3)
  await uploadJson(page, long)
  await saved(page)
  await preview(page)
  await pdf(page, 'long-prompts', 2)
  await page.emulateMedia({ media: 'print' })
  const overlaps = await page
    .locator('.print-deck .worksheet-page')
    .evaluateAll((sheets) =>
      sheets.flatMap((sheet) => {
        const footer = sheet
          .querySelector('.sheet-footer')
          .getBoundingClientRect()
        return [
          ...sheet.querySelectorAll('.word-questions li,.picture-question'),
        ]
          .filter((q) => q.getBoundingClientRect().bottom > footer.top)
          .map(() => true)
      }),
    )
  assert.equal(overlaps.length, 0, 'maximum text lengths do not overlap footer')
  assert.equal(
    await page
      .locator('.print-deck .worksheet-page')
      .evaluateAll((sheets) =>
        sheets.some(
          (sheet) =>
            sheet.scrollHeight > sheet.clientHeight + 1 ||
            sheet.scrollWidth > sheet.clientWidth + 1,
        ),
      ),
    false,
    'all content including the footer fits inside the physical page',
  )
  await page.emulateMedia({ media: 'screen' })

  const other = await context.newPage()
  await open(other)
  await choose(page, 2)
  await edit(page)
  await page.locator('.word-input-row input').nth(1).fill('甲 / 保存')
  await saved(page)
  await choose(other, 4)
  await edit(other)
  await other.locator('.word-input-row input').first().fill('乙 / 冲突')
  await other
    .locator('.save-status')
    .filter({ hasText: 'This workbook changed in another tab' })
    .waitFor()
  const inspection = await context.newPage()
  await open(inspection)
  await choose(inspection, 2)
  await edit(inspection)
  assert.equal(
    await inspection.locator('.word-input-row input').nth(1).inputValue(),
    '甲 / 保存',
    'stale tab cannot overwrite newer saved data',
  )
  await choose(inspection, 4)
  assert.equal(
    await inspection.locator('.word-input-row input').first().inputValue(),
    data.sets[3].words[0].words,
    'conflicting tab changes stay unsaved',
  )
  other.on('dialog', (d) => d.accept())
  await other.reload()
  await choose(other, 4)
  await edit(other)
  await other.locator('.word-input-row input').first().fill('重新 / 保存')
  await saved(other)
  await other.close()
  await inspection.close()

  await choose(page, 1)
  await preview(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${out}/mobile.png`, fullPage: true })
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    'no mobile horizontal overflow',
  )
  await edit(page)
  await page.screenshot({ path: `${out}/mobile-editor.png`, fullPage: true })
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    'no editor horizontal overflow',
  )
  assert.deepEqual(errors, [], 'no uncaught browser errors')
  console.log(
    'HSK verification passed: editing, upload, reload, partial import, backup, malformed image rejection, locales, print button, 2/90 A4 pages, long prompts, mobile layout, and cross-tab conflict protection.',
  )
} finally {
  await browser.close()
}
