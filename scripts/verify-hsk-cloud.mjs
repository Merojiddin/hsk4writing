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
  const { reconcileCloudWorkbook } =
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
  assert.deepEqual(
    toCloudWorkbook(reconcileCloudWorkbook(clean, remote)),
    newer,
  )
  const legacy = structuredClone(baseline)
  legacy.sets[0].words[0].words = '本地 / 修改'
  assert.equal(reconcileCloudWorkbook(legacy, remote).cloudDirty, true)
  assert.deepEqual(
    toCloudWorkbook(reconcileCloudWorkbook(legacy, remote)),
    legacy,
  )
  assert.equal(toCloudWorkbook(dirty).cloudRevision, undefined)
  assert.equal(validateWorkbook(dirty).cloudRevision, 'old')
  assert.throws(() => validateWorkbook({ ...baseline, cloudRevision: {} }))
  console.log(
    'Cloud reconciliation verified: fresh devices, clean refreshes, unpublished drafts, legacy edits, metadata and backups.',
  )
} finally {
  await server.close()
}
