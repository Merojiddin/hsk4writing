import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.vite-cloud-verification',
  server: { middlewareMode: true, ws: false },
  appType: 'custom',
})
try {
  const { createWorkbook, toCloudWorkbook, validateWorkbook } =
    await server.ssrLoadModule('/src/hsk/data.ts')
  const { fetchCloudWorkbook, reconcileCloudWorkbook, sameWorkbook, publishWorkbook, CloudConflictError } =
    await server.ssrLoadModule('/src/hsk/cloud.ts')
  const baseline = createWorkbook()
  const newer = structuredClone(baseline)
  newer.sets[0].words[0].words = '新 / 内容'
  const remote = { revision: 'new', workbook: newer }
  assert.deepEqual(toCloudWorkbook(reconcileCloudWorkbook(null, remote)), newer)
  assert.deepEqual(
    toCloudWorkbook(reconcileCloudWorkbook(baseline, remote)),
    newer,
  )
  const dirty = { ...baseline, cloudRevision: 'old', cloudDirty: true }
  const preserved = reconcileCloudWorkbook(dirty, remote)
  assert.equal(preserved.cloudRevision, 'old')
  assert.deepEqual(toCloudWorkbook(preserved), baseline)
  const clean = { ...baseline, cloudRevision: 'old', cloudDirty: false }
  const acknowledged = reconcileCloudWorkbook(
    { ...newer, cloudDirty: true, cloudRevision: 'old' }, remote,
  )
  assert.equal(acknowledged.cloudDirty, false, 'a lost acknowledgement does not leave identical content dirty')
  assert.equal(acknowledged.cloudRevision, 'new')
  assert.deepEqual(
    toCloudWorkbook(reconcileCloudWorkbook(clean, remote)),
    newer,
  )
  const legacy = structuredClone(baseline)
  legacy.sets[0].words[0].words = '本地 / 修改'
  assert.equal(reconcileCloudWorkbook(legacy, remote).cloudDirty, true)
  const restoredLegacy = reconcileCloudWorkbook(legacy, remote)
  assert.equal(restoredLegacy.cloudRevision, undefined, 'a legacy draft has no automatic overwrite permission')
  assert.equal(reconcileCloudWorkbook(validateWorkbook(restoredLegacy), remote).cloudRevision, undefined,
    'reloading a legacy draft still requires an explicit save')
  assert.deepEqual(
    toCloudWorkbook(reconcileCloudWorkbook(legacy, remote)),
    legacy,
  )
  assert.equal(toCloudWorkbook(dirty).cloudRevision, undefined)
  assert.equal(validateWorkbook(dirty).cloudRevision, 'old')
  assert.throws(() => validateWorkbook({ ...baseline, cloudRevision: {} }))

  const uploaded = structuredClone(newer)
  uploaded.sets[0].words[0].answers = ['这是新内容。']
  uploaded.sets[0].pictures[0].image =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZQAAAAASUVORK5CYII='
  uploaded.sets[0].pictures[0].answers = ['她戴着帽子。', '他戴着帽子。']
  const uploadedClean = {
    ...uploaded,
    cloudRevision: 'uploaded',
    cloudDirty: false,
  }
  const reverseKeys = (value) => {
    if (Array.isArray(value)) return value.map(reverseKeys)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]),
    )
  }
  const reordered = reverseKeys(uploadedClean)
  reordered.sets.reverse()
  assert.equal(sameWorkbook(uploadedClean, reordered), true)
  assert.equal(sameWorkbook(uploadedClean, validateWorkbook(uploadedClean)), true)
  assert.equal(
    sameWorkbook(uploadedClean, { ...uploadedClean, cloudDirty: true }),
    false,
  )
  assert.equal(
    sameWorkbook(uploadedClean, { ...uploadedClean, cloudRevision: 'newer' }),
    false,
  )
  const changedImage = structuredClone(uploadedClean)
  changedImage.sets[0].pictures[0].image = ''
  assert.equal(sameWorkbook(uploadedClean, changedImage), false)
  const changedKey = structuredClone(uploadedClean)
  changedKey.sets[0].pictures[0].answers.pop()
  assert.equal(sameWorkbook(uploadedClean, changedKey), false)
  const uploadedRemote = { revision: 'uploaded', workbook: uploaded }
  assert.equal(
    sameWorkbook(reconcileCloudWorkbook(reordered, uploadedRemote), uploadedClean),
    true,
  )
  assert.equal(
    sameWorkbook(reconcileCloudWorkbook(null, uploadedRemote), uploadedClean),
    true,
  )
  assert.equal(
    sameWorkbook(reconcileCloudWorkbook(reverseKeys(baseline), uploadedRemote), uploadedClean),
    true,
  )
  const uploadedDirty = { ...uploadedClean, cloudDirty: true }
  assert.equal(
    sameWorkbook(reconcileCloudWorkbook(uploadedDirty, remote), uploadedDirty),
    true,
  )

  const emptyRemote = { revision: null, workbook: null }
  assert.deepEqual(reconcileCloudWorkbook(null, emptyRemote), {
    ...baseline, cloudRevision: null, cloudDirty: false,
  })
  assert.deepEqual(reconcileCloudWorkbook(clean, emptyRemote), {
    ...baseline, cloudRevision: null, cloudDirty: false,
  })
  for (const local of [uploadedClean, uploadedDirty, uploaded]) {
    const recovered = reconcileCloudWorkbook(local, emptyRemote)
    assert.deepEqual(toCloudWorkbook(recovered), uploaded)
    assert.equal(recovered.cloudRevision, null)
    assert.equal(recovered.cloudDirty, true)
  }
  assert.equal(reconcileCloudWorkbook(dirty, emptyRemote).cloudDirty, true)

  const originalFetch = globalThis.fetch
  const calls = []
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options })
      return Response.json(calls.length === 1 ? {
        revision: 'uploaded',
        downloadUrl: 'https://test.private.blob.vercel-storage.com/snapshot.json',
      } : uploadedClean)
    }
    const downloaded = await fetchCloudWorkbook()
    assert.deepEqual(downloaded, uploadedRemote)
    assert.equal(calls.length, 2)
    for (const { options } of calls) {
      assert.equal(options.cache, 'no-store')
      assert.equal(options.headers.Accept, 'application/json')
    }
    const downloadWithCache = async (cached) => {
      calls.length = 0
      const result = await fetchCloudWorkbook(cached)
      assert.deepEqual(result, uploadedRemote)
      return calls.length
    }
    assert.equal(await downloadWithCache(uploadedClean), 1)
    assert.equal(await downloadWithCache(uploadedDirty), 2)
    assert.equal(await downloadWithCache(uploaded), 2)
    assert.equal(await downloadWithCache({ ...uploadedClean, cloudRevision: 'old' }), 2)
    assert.equal(await downloadWithCache({ ...uploadedClean, cloudRevision: null }), 2)
    assert.equal(await downloadWithCache({ ...uploadedClean, sets: uploadedClean.sets.slice(0, 1) }), 2)
    globalThis.fetch = async () => Response.json({ revision: null, downloadUrl: null })
    assert.deepEqual(await fetchCloudWorkbook(), emptyRemote)
    assert.deepEqual(await fetchCloudWorkbook(uploadedClean), emptyRemote)
    for (const metadata of [
      null,
      { revision: null, downloadUrl: 'https://vercel.com/snapshot.json' },
      { revision: 'uploaded', downloadUrl: null },
      { revision: '', downloadUrl: 'https://vercel.com/snapshot.json' },
      { revision: 'uploaded', downloadUrl: 'http://vercel.com/snapshot.json' },
      { revision: 'uploaded', downloadUrl: 'https://example.com/snapshot.json' },
    ]) {
      globalThis.fetch = async () => Response.json(metadata)
      await assert.rejects(fetchCloudWorkbook(), /invalid_cloud_(response|url)/)
      await assert.rejects(fetchCloudWorkbook(uploadedClean), /invalid_cloud_(response|url)/)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
  try {
    let prepares = 0
    let publications = 0
    const publishedPaths = []
    globalThis.fetch = async (url, options) => {
      if (options.method === 'PUT') return new Response('', { status: 200 })
      const body = JSON.parse(options.body)
      if (body.action === 'prepare') {
        prepares += 1
        return Response.json({ pathname: 'snapshots/lost-ack.json', uploadUrl: 'https://vercel.com/upload' })
      }
      publications += 1
      publishedPaths.push(body.pathname)
      if (publications === 1) throw new TypeError('The publication succeeded but its response was lost')
      return Response.json({ revision: 'acknowledged' })
    }
    assert.equal(await publishWorkbook(newer, 'old'), 'acknowledged')
    assert.equal(prepares, 1)
    assert.deepEqual(publishedPaths, ['snapshots/lost-ack.json', 'snapshots/lost-ack.json'])
    for (const status of [400, 403, 409]) {
      let attempts = 0
      globalThis.fetch = async (url, options) => {
        if (options.method === 'PUT') return new Response('', { status: 200 })
        if (JSON.parse(options.body).action === 'prepare')
          return Response.json({ pathname: 'snapshots/rejected.json', uploadUrl: 'https://vercel.com/upload' })
        attempts += 1
        return Response.json({ error: 'rejected' }, { status })
      }
      if (status === 409) await assert.rejects(publishWorkbook(newer, 'old'), CloudConflictError)
      else await assert.rejects(publishWorkbook(newer, 'old'))
      assert.equal(attempts, 1, `${status} is not retried`)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
  console.log(
    'Cloud reconciliation verified: fresh devices, canonical cache comparison, images and keys, clean refreshes, preserved drafts, empty remote recovery, revision-aware no-store downloads, metadata and backups.',
  )
} finally {
  await server.close()
}
