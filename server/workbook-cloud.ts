import { randomUUID } from 'node:crypto'
import {
  get,
  put,
  list,
  del,
  issueSignedToken,
  presignUrl,
  BlobPreconditionFailedError,
} from '@vercel/blob'
import { toCloudWorkbook, validateWorkbook } from '../src/hsk/data.js'

const POINTER = 'published/current.json'
const LIMIT = 100 * 1024 * 1024
const WINDOW = 15 * 60 * 1000
const snapshotPattern = /^snapshots\/[a-f0-9-]{36}\.json$/
type Publication = { pathname: string; savedAt: string; previous?: string }
export class CloudHttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code)
  }
}

async function currentPublication() {
  const result = await get(POINTER, { access: 'private', useCache: false })
  if (!result) return null
  if (!result.stream) throw new Error('Missing publication stream')
  const value = (await new Response(result.stream).json()) as Publication
  if (!snapshotPattern.test(value.pathname))
    throw new Error('Invalid publication pointer')
  return { ...value, revision: result.blob.etag }
}

function expectedRevision(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !value || value.length > 128)
    throw new CloudHttpError(400, 'invalid_request')
  return value
}

export async function readCloudWorkbook() {
  const current = await currentPublication()
  if (!current) return { revision: null, downloadUrl: null }
  const token = await issueSignedToken({
    pathname: current.pathname,
    operations: ['get'],
    validUntil: Date.now() + WINDOW,
  })
  const { presignedUrl } = await presignUrl(token, {
    pathname: current.pathname,
    operation: 'get',
    access: 'private',
    useCache: false,
  })
  return {
    revision: current.revision,
    savedAt: current.savedAt,
    downloadUrl: presignedUrl,
  }
}

export async function prepareCloudUpload(revision: unknown) {
  const expected = expectedRevision(revision)
  const current = await currentPublication()
  if ((current?.revision ?? null) !== expected)
    throw new CloudHttpError(409, 'conflict')
  const pathname = `snapshots/${randomUUID()}.json`
  const constraints = {
    pathname,
    operations: ['put'] as ['put'],
    validUntil: Date.now() + WINDOW,
    maximumSizeInBytes: LIMIT,
    allowedContentTypes: ['application/json'],
  }
  const token = await issueSignedToken(constraints)
  const { presignedUrl } = await presignUrl(token, {
    ...constraints,
    operation: 'put',
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: false,
  })
  return { pathname, uploadUrl: presignedUrl }
}

export async function publishCloudUpload(path: unknown, revision: unknown) {
  const expected = expectedRevision(revision)
  if (typeof path !== 'string' || !snapshotPattern.test(path))
    throw new CloudHttpError(400, 'invalid_request')
  const current = await currentPublication()
  // A lost HTTP response can be retried without making a second revision.
  if (current?.pathname === path)
    return { revision: current.revision, savedAt: current.savedAt }
  if ((current?.revision ?? null) !== expected)
    throw new CloudHttpError(409, 'conflict')
  const snapshot = await get(path, { access: 'private', useCache: false })
  if (
    !snapshot?.stream ||
    snapshot.blob.size > LIMIT ||
    Date.now() - snapshot.blob.uploadedAt.getTime() > WINDOW
  )
    throw new CloudHttpError(400, 'invalid_snapshot')
  let workbook
  try {
    const bytes = await new Response(snapshot.stream).arrayBuffer()
    if (!bytes.byteLength || bytes.byteLength > LIMIT)
      throw new Error('Invalid size')
    workbook = toCloudWorkbook(
      validateWorkbook(JSON.parse(new TextDecoder().decode(bytes))),
    )
    if (workbook.sets.length !== 45) throw new Error('Expected all sets')
    // JSON snapshots cannot smuggle URLs, SVG, or invalid image signatures.
    for (const set of workbook.sets)
      for (const picture of set.pictures) {
        if (!picture.image) continue
        const [prefix, encoded] = picture.image.split(',')
        const bytes = Buffer.from(encoded, 'base64')
        const valid = prefix.includes('/png;')
          ? bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : prefix.includes('/jpeg;')
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : prefix.includes('/gif;')
              ? ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())
              : bytes.subarray(0, 4).toString() === 'RIFF' &&
                bytes.subarray(8, 12).toString() === 'WEBP'
        if (!valid) throw new Error('Invalid image')
      }
  } catch {
    throw new CloudHttpError(400, 'invalid_snapshot')
  }
  const savedAt = new Date().toISOString()
  try {
    const result = await put(
      POINTER,
      JSON.stringify({
        pathname: path,
        savedAt,
        ...(current ? { previous: current.pathname } : {}),
      }),
      {
        access: 'private',
        addRandomSuffix: false,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
        ...(current
          ? { allowOverwrite: true, ifMatch: current.revision }
          : { allowOverwrite: false }),
      },
    )
    return { revision: result.etag, savedAt }
  } catch (error) {
    if (
      error instanceof BlobPreconditionFailedError ||
      (!current && (await currentPublication()))
    )
      throw new CloudHttpError(409, 'conflict')
    throw error
  }
}

/** Keep the current and preceding save; expire unused snapshots after one hour. */
export async function cleanCloudSnapshots() {
  const [current, files] = await Promise.all([
    currentPublication(),
    list({ prefix: 'snapshots/', limit: 1000 }),
  ])
  if (!current) return
  const expired = files.blobs.filter(
    (file) =>
      file.pathname !== current.pathname &&
      file.pathname !== current.previous &&
      Date.now() - file.uploadedAt.getTime() > 60 * 60 * 1000,
  )
  if (expired.length) await del(expired.map((file) => file.url))
}
