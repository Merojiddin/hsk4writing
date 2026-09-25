import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.vite-content-verification',
  server: { middlewareMode: true, ws: false },
  appType: 'custom',
})
try {
  const { createWorkbook, restoreWorkbook, validateWorkbook, mergeWorkbook } =
    await server.ssrLoadModule('/src/hsk/data.ts')
  const workbook = createWorkbook()
  assert.equal(workbook.sets.length, 45)
  assert.equal(
    workbook.sets.flatMap((s) => s.words).filter((q) => q.words).length,
    440,
  )
  assert.equal(
    workbook.sets.flatMap((s) => s.pictures).filter((q) => q.word).length,
    215,
  )
  assert.equal(
    workbook.sets.flatMap((s) => s.pictures).filter((q) => q.image).length,
    0,
  )
  assert.equal(
    workbook.sets[11].words.every((q) => !q.words),
    true,
  )
  assert.equal(
    workbook.sets[11].pictures.every((q) => !q.word),
    true,
  )
  assert.equal(
    workbook.sets[27].pictures.every((q) => !q.word),
    true,
  )
  assert.equal(workbook.sets[0].words[0].words, '理由/房东拒绝/你的/是什么')
  assert.equal(workbook.sets[42].words[6].words, '那个/她的话/让/感动了/小伙子')
  assert.deepEqual(
    workbook.sets[42].pictures.map((q) => q.word),
    ['抬', '眼镜', '害羞', '脱', '勺子'],
  )
  assert.deepEqual(
    workbook.sets[44].pictures.map((q) => q.word),
    ['戴', '激动', '迷路', '盒子', '俩'],
  )
  assert.deepEqual(validateWorkbook(workbook), workbook)

  const legacy = structuredClone(workbook)
  delete legacy.providedContentRevision
  for (const set of legacy.sets) {
    for (const q of set.words) q.words = ''
    for (const q of set.pictures) q.word = ''
  }
  const oldSample = [
    '是谁 / 厨房的 / 打破的 / 窗户 / 究竟',
    '出发还 / 吗 / 来得及 / 你现在',
    '她害羞 / 转了 / 把脸 / 过去 / 地',
    '出现在 / 你 / 生命里 / 感谢 / 我的',
    '眼镜 / 一段时间 / 流行过 / 这种',
    '优秀的 / 被 / 表扬 / 人 / 值得',
    '那个 / 他的话 / 让 / 感动了 / 小伙子',
    '我的 / 这双袜子 / 送给 / 父亲',
    '意见和看法 / 都 / 自己的 / 谈了 / 大家',
    '沙发上 / 把 / 别 / 扔在 / 毛巾',
  ]
  legacy.sets[0].words.forEach((q, i) => {
    q.words = oldSample[i]
  })
  legacy.sets[0].pictures.forEach((q, i) => {
    q.word = ['戴', '激动', '迷路', '盒子', '俩'][i]
  })
  legacy.sets[1].words[0].words = '我的 / 自定义 / 句子'
  legacy.sets[1].pictures[0] = {
    ...legacy.sets[1].pictures[0],
    word: '自定义',
    image: 'data:image/png;base64,YQ==',
    alt: 'Preserve existing image bytes',
  }
  const restored = restoreWorkbook(legacy)
  assert.deepEqual(
    restored.sets[0],
    workbook.sets[0],
    'replace the original untouched sample with actual Set 1',
  )
  assert.equal(restored.sets[1].words[0].words, '我的 / 自定义 / 句子')
  assert.deepEqual(restored.sets[1].pictures[0], legacy.sets[1].pictures[0])
  assert.equal(restored.sets[1].words[1].words, workbook.sets[1].words[1].words)
  assert.equal(
    legacy.providedContentRevision,
    undefined,
    'migration does not mutate saved input',
  )
  assert.equal(restored.providedContentRevision, 1)
  restored.sets[2].words[0].words = ''
  restored.sets[2].pictures[0].word = ''
  assert.deepEqual(
    restoreWorkbook(restored),
    restored,
    'intentional later deletions survive reload',
  )
  assert.equal(
    mergeWorkbook(restored, { version: 1, sets: [restored.sets[4]] })
      .providedContentRevision,
    1,
  )
  console.log(
    'HSK content verified: 440 exact word groups, 215 keywords, missing sets/parts, correct Set 43/45 mapping, and non-destructive one-time migration.',
  )
} finally {
  await server.close()
}
