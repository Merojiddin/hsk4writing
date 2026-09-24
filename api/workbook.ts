import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  CloudHttpError,
  cleanCloudSnapshots,
  prepareCloudUpload,
  publishCloudUpload,
  readCloudWorkbook,
} from '../server/workbook-cloud.js'

type Request = IncomingMessage & { body?: unknown }
export default async function handler(req: Request, res: ServerResponse) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  const respond = (status: number, body: unknown) => {
    res.statusCode = status
    res.end(JSON.stringify(body))
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID)
    return respond(503, { error: 'not_configured' })
  try {
    if (req.method === 'GET') return respond(200, await readCloudWorkbook())
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      return respond(405, { error: 'method_not_allowed' })
    }
    // Anonymous editing is intentional; reject cross-site browser submissions.
    const origin = req.headers.origin
    if (origin && new URL(origin).host !== req.headers.host)
      return respond(403, { error: 'cross_origin' })
    if (!req.headers['content-type']?.startsWith('application/json'))
      return respond(415, { error: 'invalid_request' })
    if (Number(req.headers['content-length'] ?? 0) > 4096)
      return respond(413, { error: 'invalid_request' })
    const body = (
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    ) as Record<string, unknown> | undefined
    if (!body || typeof body !== 'object')
      return respond(400, { error: 'invalid_request' })
    if (body.action === 'prepare')
      return respond(200, await prepareCloudUpload(body.revision))
    if (body.action === 'publish') {
      const result = await publishCloudUpload(body.pathname, body.revision)
      // Cleanup errors must not turn a committed save into a reported failure.
      await cleanCloudSnapshots().catch(() => undefined)
      return respond(200, result)
    }
    return respond(400, { error: 'invalid_request' })
  } catch (error) {
    if (error instanceof CloudHttpError)
      return respond(error.status, { error: error.code })
    return respond(503, { error: 'cloud_unavailable' })
  }
}
