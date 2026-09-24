import { createWorkbook, toCloudWorkbook, validateWorkbook } from './data'
import type { Workbook } from './data'
export class CloudConflictError extends Error {}

async function request(body?: Record<string, unknown>) {
  const response = await fetch('/api/workbook', {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
    ...(body
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  })
  if (response.status === 409) throw new CloudConflictError('conflict')
  if (!response.ok) throw new Error('cloud_unavailable')
  return response.json()
}
export async function fetchCloudWorkbook(): Promise<{
  revision: string | null
  workbook: Workbook | null
}> {
  const metadata = await request()
  if (metadata.revision === null && metadata.downloadUrl === null)
    return { revision: null, workbook: null }
  if (
    typeof metadata.revision !== 'string' ||
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
  const response = await fetch(url, {
    cache: 'no-store',
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
  const result = await request({
    action: 'publish',
    pathname: preparation.pathname,
    revision,
  })
  if (typeof result.revision !== 'string')
    throw new Error('invalid_cloud_response')
  return result.revision
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
  const pristineLegacy =
    local.cloudRevision === undefined &&
    !local.cloudDirty &&
    JSON.stringify(toCloudWorkbook(local)) === JSON.stringify(createWorkbook())
  if (
    ((local.cloudDirty === false && local.cloudRevision !== undefined) ||
      pristineLegacy) &&
    remote.workbook
  ) {
    return {
      ...remote.workbook,
      cloudRevision: remote.revision,
      cloudDirty: false,
    }
  }
  return {
    ...local,
    cloudRevision:
      local.cloudRevision !== undefined ? local.cloudRevision : remote.revision,
    cloudDirty: local.cloudDirty ?? !pristineLegacy,
  }
}
