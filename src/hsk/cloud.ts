import { createWorkbook, toCloudWorkbook, validateWorkbook } from './data'
import type { Workbook } from './data'
export class CloudConflictError extends Error {}
class CloudRequestError extends Error {
  constructor(readonly status: number) { super('cloud_unavailable') }
}

async function request(body?: Record<string, unknown>) {
  const response = await fetch('/api/workbook', {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (response.status === 409) throw new CloudConflictError('conflict')
  if (!response.ok) throw new CloudRequestError(response.status)
  return response.json()
}
export async function fetchCloudWorkbook(cached?: Workbook): Promise<{
  revision: string | null
  workbook: Workbook | null
}> {
  const metadata = await request()
  if (!metadata || typeof metadata !== 'object')
    throw new Error('invalid_cloud_response')
  if (metadata.revision === null && metadata.downloadUrl === null)
    return { revision: null, workbook: null }
  if (
    typeof metadata.revision !== 'string' ||
    !metadata.revision ||
    metadata.revision.length > 128 ||
    typeof metadata.downloadUrl !== 'string'
  )
    throw new Error('invalid_cloud_response')
  const url = new URL(metadata.downloadUrl)
  if (
    url.protocol !== 'https:' ||
    !(
      url.hostname.endsWith('.private.blob.vercel-storage.com') ||
      url.hostname === 'vercel.com'
    )
  )
    throw new Error('invalid_cloud_url')
  if (
    cached?.cloudDirty === false &&
    cached.cloudRevision === metadata.revision
  ) {
    const workbook = toCloudWorkbook(validateWorkbook(cached))
    if (workbook.sets.length === 45)
      return { revision: metadata.revision, workbook }
  }
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(120000),
  })
  if (!response.ok) throw new Error('cloud_unavailable')
  const workbook = toCloudWorkbook(validateWorkbook(await response.json()))
  if (workbook.sets.length !== 45) throw new Error('invalid_cloud_workbook')
  return { revision: metadata.revision, workbook }
}
export async function publishWorkbook(
  workbook: Workbook,
  revision: string | null,
): Promise<string> {
  const snapshot = new Blob(
    [JSON.stringify(toCloudWorkbook(validateWorkbook(workbook)))],
    { type: 'application/json' },
  )
  const preparation = await request({ action: 'prepare', revision })
  const upload = await fetch(preparation.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: snapshot,
    signal: AbortSignal.timeout(180000),
  })
  if (!upload.ok) throw new Error('cloud_upload_failed')
  const publication = {
    action: 'publish',
    pathname: preparation.pathname,
    revision,
  }
  let result
  try {
    result = await request(publication)
  } catch (error) {
    if (error instanceof CloudConflictError ||
        (error instanceof CloudRequestError && error.status < 500)) throw error
    // Retrying this pathname is idempotent if publication succeeded but its reply was lost.
    result = await request(publication)
  }
  if (typeof result.revision !== 'string')
    throw new Error('invalid_cloud_response')
  return result.revision
}

/** Compare supported content and synchronization metadata independently of key order. */
export function sameWorkbook(left: Workbook, right: Workbook): boolean {
  return (
    JSON.stringify(validateWorkbook(left)) ===
    JSON.stringify(validateWorkbook(right))
  )
}

/** A remote refresh may replace a clean cache, but never an unpublished local draft. */
export function reconcileCloudWorkbook(
  local: Workbook | null,
  remote: { revision: string | null; workbook: Workbook | null },
): Workbook {
  if (!local)
    return {
      ...(remote.workbook ?? createWorkbook()),
      cloudRevision: remote.revision,
      cloudDirty: false,
    }
  const pristineContent = sameWorkbook(toCloudWorkbook(local), createWorkbook())
  if (!remote.workbook) {
    // Losing the website copy must not erase materials that still exist locally.
    return {
      ...local,
      cloudRevision: remote.revision,
      cloudDirty: Boolean(local.cloudDirty) || !pristineContent,
    }
  }
  const pristineLegacy =
    local.cloudRevision === undefined &&
    !local.cloudDirty &&
    pristineContent
  if (
    (local.cloudDirty === false && local.cloudRevision !== undefined) ||
    pristineLegacy || sameWorkbook(toCloudWorkbook(local), remote.workbook)
  ) {
    return {
      ...remote.workbook,
      cloudRevision: remote.revision,
      cloudDirty: false,
    }
  }
  return {
    ...local,
    // An older authored draft has no known base. Do not silently make it eligible
    // for automatic publication against a newer shared workbook on the next reload.
    cloudRevision: local.cloudRevision,
    cloudDirty: local.cloudDirty ?? !pristineLegacy,
  }
}
