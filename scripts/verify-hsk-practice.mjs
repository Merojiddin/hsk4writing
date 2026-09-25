import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.vite-practice-verification',
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
})

function memoryStorage() {
  const values = new Map()
  return {
    get length() { return values.size },
    key(index) { return [...values.keys()][index] ?? null },
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
    removeItem(key) { values.delete(key) },
  }
}

try {
  const {
    createWorkbook, validateWorkbook, restoreWorkbook, mergeWorkbook,
    toCloudWorkbook, MAX_ANSWER_LENGTH, MAX_ACCEPTED_ANSWERS,
  } = await server.ssrLoadModule('/src/hsk/data.ts')
  const {
    normalizeAnswer, checkAnswer, questionSignature, loadPractice,
    savePracticeAttempt, clearPracticeAttempts, PRACTICE_STORAGE_PREFIX,
  } = await server.ssrLoadModule('/src/hsk/practice.ts')

  const legacy = createWorkbook()
  assert.deepEqual(validateWorkbook(legacy), legacy)
  assert.equal('answers' in validateWorkbook(legacy).sets[0].words[0], false)
  assert.equal('answers' in validateWorkbook(legacy).sets[0].pictures[0], false)

  const keyed = structuredClone(legacy)
  keyed.sets[0].words[0].answers = ['你拒绝房东的理由是什么？', '房东拒绝你的理由是什么？']
  keyed.sets[0].pictures[0].answers = ['他戴着眼镜。', '她戴着眼镜。']
  assert.deepEqual(validateWorkbook(JSON.parse(JSON.stringify(keyed))), keyed)
  assert.deepEqual(restoreWorkbook(keyed), keyed)
  assert.deepEqual(toCloudWorkbook({ ...keyed, cloudDirty: true, cloudRevision: 'latest' }), keyed)
  assert.deepEqual(mergeWorkbook(legacy, { version: 1, sets: [keyed.sets[0]] }), keyed)
  const validated = validateWorkbook(keyed)
  validated.sets[0].words[0].answers.push('Another answer')
  assert.equal(keyed.sets[0].words[0].answers.length, 2, 'validation copies answer arrays')

  for (const kind of ['words', 'pictures']) {
    for (const answers of [null, '句子', {}, [1], [null], [['句子']], Array(11).fill('句子'), ['字'.repeat(301)]]) {
      const invalid = structuredClone(legacy)
      invalid.sets[0][kind][0].answers = answers
      assert.throws(() => validateWorkbook(invalid), `reject malformed ${kind} answer key`)
    }
    const boundary = structuredClone(legacy)
    boundary.sets[0][kind][0].answers = Array(MAX_ACCEPTED_ANSWERS).fill('字'.repeat(MAX_ANSWER_LENGTH))
    assert.deepEqual(validateWorkbook(boundary), boundary)
    boundary.sets[0][kind][0].answers = ['', '   ', '，。']
    assert.deepEqual(validateWorkbook(boundary), boundary, 'permit unfinished multiline answer key editing')
  }

  const word = keyed.sets[0].words[0]
  const picture = keyed.sets[0].pictures[0]
  assert.equal(normalizeAnswer('「房东，拒绝」　你的理由是什么？！\n'), '房东拒绝你的理由是什么')
  assert.equal(normalizeAnswer('ＡＢＣ１２３，。'), 'ABC123')
  assert.equal(checkAnswer(word, '房东 拒绝 你的 理由 是 什么。'), 'correct')
  assert.equal(checkAnswer(word, '你拒绝房东的理由是什么'), 'correct', 'all supplied variants accepted')
  assert.equal(checkAnswer(word, '理由是什么你的房东拒绝'), 'incorrect', 'word order is preserved')
  assert.equal(checkAnswer(word, '房東拒絕你的理由是什麼'), 'incorrect', 'no semantic or script conversion')
  assert.equal(checkAnswer(picture, '她戴着眼镜！'), 'correct')
  assert.equal(checkAnswer(picture, '他戴着帽子。'), 'different', 'picture mismatch is not a grammar verdict')
  assert.equal(checkAnswer(word, ''), 'unanswered')
  assert.equal(checkAnswer(word, '， 。\n ！？'), 'unanswered')
  assert.equal(checkAnswer(legacy.sets[0].words[0], '我的回答'), 'no-key')
  assert.equal(checkAnswer({ ...word, answers: ['', '，。', '\n'] }, '我的回答'), 'no-key')
  assert.equal(checkAnswer({ ...word, answers: ['，。'] }, '，。'), 'unanswered', 'punctuation cannot falsely match')

  const signature = questionSignature(word)
  assert.match(signature, /^v1-[a-f0-9]{16}$/)
  assert.equal(signature, questionSignature(structuredClone(word)))
  assert.notEqual(signature, questionSignature({ ...word, words: `${word.words}/改` }))
  assert.notEqual(signature, questionSignature({ ...word, answers: ['不同答案'] }))
  assert.notEqual(questionSignature(picture), questionSignature({ ...picture, image: 'new image bytes' }))
  assert.notEqual(questionSignature(picture), questionSignature({ ...picture, word: '新' }))
  assert.notEqual(questionSignature(picture), questionSignature({ ...picture, alt: 'New description' }))
  assert.notEqual(
    questionSignature({ id: 'w', words: 'a', answers: ['bc'] }),
    questionSignature({ id: 'w', words: 'ab', answers: ['c'] }),
    'signature includes field boundaries',
  )
  assert.equal(questionSignature({ ...picture, image: 'a'.repeat(5_000_000) }).length, 19)

  const storage = memoryStorage()
  const attempt = { answer: '房东拒绝你的理由是什么', signature }
  assert.deepEqual(loadPractice(storage), { attempts: {}, storageError: false })
  assert.equal(savePracticeAttempt(word.id, attempt, storage), true)
  assert.equal(savePracticeAttempt(picture.id, { answer: '她戴着眼镜', signature: questionSignature(picture) }, storage), true)
  const staleTab = loadPractice(storage).attempts
  assert.equal(savePracticeAttempt(picture.id, { answer: '他戴着眼镜', signature: questionSignature(picture) }, storage), true)
  assert.equal(savePracticeAttempt(word.id, { ...staleTab[word.id], answer: 'Updated in older tab' }, storage), true)
  assert.equal(loadPractice(storage).attempts[picture.id].answer, '他戴着眼镜', 'unrelated stale-tab answers are not rewritten')
  assert.equal(loadPractice(storage).attempts[word.id].answer, 'Updated in older tab')
  assert.notEqual(loadPractice(storage).attempts[word.id].signature, questionSignature({ ...word, answers: ['changed'] }), 'edits can identify stale saved answers')
  assert.equal('attempts' in validateWorkbook({ ...keyed, attempts: staleTab }), false)
  assert.equal(JSON.stringify(toCloudWorkbook(keyed)).includes('Updated in older tab'), false)

  storage.setItem('hsk-unrelated-setting', 'retained')
  assert.equal(clearPracticeAttempts([word.id], storage), true)
  assert.equal(loadPractice(storage).attempts[word.id], undefined)
  assert.equal(loadPractice(storage).attempts[picture.id].answer, '他戴着眼镜')
  assert.equal(storage.getItem('hsk-unrelated-setting'), 'retained')

  const invalidValues = [
    '{', 'null', '[]',
    JSON.stringify({ version: 2, ...attempt }),
    JSON.stringify({ version: 1, answer: 1, signature }),
    JSON.stringify({ version: 1, answer: '字'.repeat(301), signature }),
    JSON.stringify({ version: 1, answer: '句子', signature: 'bad signature' }),
    ' '.repeat(2001),
  ]
  for (const invalid of invalidValues) {
    storage.setItem(`${PRACTICE_STORAGE_PREFIX}bad`, invalid)
    const loaded = loadPractice(storage)
    assert.equal(loaded.storageError, true)
    assert.equal(loaded.attempts.bad, undefined)
    assert.equal(loaded.attempts[picture.id].answer, '他戴着眼镜', 'corruption preserves other valid answers')
  }
  storage.removeItem(`${PRACTICE_STORAGE_PREFIX}bad`)
  assert.equal(savePracticeAttempt('__proto__', attempt, storage), true)
  assert.equal(Object.hasOwn(loadPractice(storage).attempts, '__proto__'), true)
  assert.equal(Object.getPrototypeOf(loadPractice(storage).attempts), Object.prototype)
  assert.equal(savePracticeAttempt('../invalid', attempt, storage), false)
  assert.equal(savePracticeAttempt(123, attempt, storage), false)
  assert.equal(savePracticeAttempt(word.id, { ...attempt, answer: '字'.repeat(301) }, storage), false)
  assert.equal(savePracticeAttempt(word.id, { ...attempt, signature: 'invalid' }, storage), false)
  assert.equal(clearPracticeAttempts(['../invalid'], storage), false)
  assert.equal(clearPracticeAttempts([123], storage), false)

  const unavailable = {
    get length() { throw new Error('Storage blocked') },
    key() { throw new Error('Storage blocked') },
    getItem() { throw new Error('Storage blocked') },
    setItem() { throw new Error('Quota exceeded') },
    removeItem() { throw new Error('Storage blocked') },
  }
  assert.deepEqual(loadPractice(unavailable), { attempts: {}, storageError: true })
  assert.equal(savePracticeAttempt(word.id, attempt, unavailable), false)
  assert.equal(clearPracticeAttempts([word.id], unavailable), false)
  assert.equal(loadPractice({}).storageError, true, 'an unavailable storage implementation is handled')

  console.log('HSK practice verified: compatible answer keys, strict validation, normalized exact checks, picture feedback, stale signatures, private per-question storage, cross-tab preservation, and storage failures.')
} finally {
  await server.close()
}
