import providedContent from './provided-content.json' with { type: 'json' }

export type WordQuestion = { id: string; words: string }
export type PictureQuestion = {
  id: string
  word: string
  image: string
  alt: string
}
export type WorksheetSet = {
  id: number
  words: WordQuestion[]
  pictures: PictureQuestion[]
}
export type Workbook = {
  version: 1
  providedContentRevision?: 1
  cloudRevision?: string | null
  cloudDirty?: boolean
  sets: WorksheetSet[]
}

/** Keep device synchronization metadata out of published snapshots and portable backups. */
export function toCloudWorkbook(workbook: Workbook): Workbook {
  const { cloudRevision: _revision, cloudDirty: _dirty, ...content } = workbook
  return content
}

export const MAX_TOTAL_IMAGE_CHARS = 90 * 1024 * 1024

export class WorkbookSizeError extends Error {
  constructor() {
    super('The workbook contains more than 90 MiB of embedded image data.')
    this.name = 'WorkbookSizeError'
  }
}

export class WorkbookConflictError extends Error {
  constructor() {
    super(
      'Another page saved a newer workbook. Export your changes and reload before saving again.',
    )
    this.name = 'WorkbookConflictError'
  }
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_IMAGE_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 40
const DATABASE_NAME = 'hsk-writing-workbook'
const STORE_NAME = 'workbooks'
const WORKBOOK_KEY = 'current'
const LEGACY_REVISION = 'legacy-unversioned-workbook'

let expectedRevision: string | null = null
let hasConflict = false
let storageQueue: Promise<void> = Promise.resolve()

function enqueueStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation)
  storageQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

/** Counts embedded data URL characters, including their MIME prefixes. */
export function imageDataSize(workbook: Workbook): number {
  return workbook.sets.reduce(
    (total, set) =>
      total +
      set.pictures.reduce((sum, question) => sum + question.image.length, 0),
    0,
  )
}

const SAMPLE_WORDS = [
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
const SAMPLE_KEYWORDS = ['戴', '激动', '迷路', '盒子', '俩']

export function createWorkbook(count = 45): Workbook {
  if (!Number.isInteger(count) || count < 1 || count > 45) {
    throw new Error('A workbook must contain between 1 and 45 sets.')
  }
  return {
    version: 1,
    providedContentRevision: 1,
    sets: Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      words: Array.from({ length: 10 }, (_, question) => ({
        id: `w${index + 1}-${question + 1}`,
        words: providedContent.sets[index].words[question] ?? '',
      })),
      pictures: Array.from({ length: 5 }, (_, question) => ({
        id: `p${index + 1}-${question + 1}`,
        word: providedContent.sets[index].keywords[question] ?? '',
        image: '',
        alt: '',
      })),
    })),
  }
}

/** Upgrade the original blank template once, retaining authored text and uploaded images. */
export function restoreWorkbook(saved: Workbook): Workbook {
  const merged = mergeWorkbook(createWorkbook(), saved)
  if (saved.providedContentRevision === 1) return merged
  const defaults = createWorkbook()
  return {
    ...merged,
    providedContentRevision: 1,
    sets: merged.sets.map((set) => {
      const source = defaults.sets[set.id - 1]
      const untouchedSample =
        set.id === 1 &&
        set.words.every((q, i) => q.words === SAMPLE_WORDS[i]) &&
        set.pictures.every((q) => !q.image)
      return {
        ...set,
        words: set.words.map((q, i) => ({
          ...q,
          words:
            untouchedSample || !q.words.trim()
              ? source.words[i].words
              : q.words,
        })),
        pictures: set.pictures.map((q, i) => ({
          ...q,
          word:
            !q.word.trim() || (untouchedSample && q.word === SAMPLE_KEYWORDS[i])
              ? source.pictures[i].word
              : q.word,
        })),
      }
    }),
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a workbook object.')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`Expected text no longer than ${maxLength} characters.`)
  }
  return value
}

function imageData(value: unknown): string {
  const image = text(value, MAX_IMAGE_LENGTH)
  if (image === '') return image
  const match =
    /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]*={0,2})$/.exec(
      image,
    )
  if (!match || !match[2] || match[2].length % 4 !== 0) {
    throw new Error('Images must be embedded PNG, JPEG, WebP, or GIF data.')
  }
  const padding = match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0
  if ((match[2].length / 4) * 3 - padding > MAX_IMAGE_BYTES) {
    throw new Error('Each image must be at most 4 MB.')
  }
  return image
}

/** Validate and copy only supported fields, including partial imports of numbered sets. */
export function validateWorkbook(value: unknown): Workbook {
  const workbook = record(value)
  if (
    workbook.cloudRevision !== undefined &&
    workbook.cloudRevision !== null &&
    (typeof workbook.cloudRevision !== 'string' ||
      workbook.cloudRevision.length > 128)
  )
    throw new Error('Invalid cloud revision.')
  if (
    workbook.cloudDirty !== undefined &&
    typeof workbook.cloudDirty !== 'boolean'
  )
    throw new Error('Invalid cloud draft state.')
  if (
    workbook.providedContentRevision !== undefined &&
    workbook.providedContentRevision !== 1
  ) {
    throw new Error('Unsupported supplied content revision.')
  }
  if (
    workbook.version !== 1 ||
    !Array.isArray(workbook.sets) ||
    workbook.sets.length < 1 ||
    workbook.sets.length > 45
  ) {
    throw new Error('Expected a version 1 workbook with 1 to 45 sets.')
  }
  const setIds = new Set<number>()
  const questionIds = new Set<string>()
  let totalImageChars = 0
  const questionId = (value: unknown) => {
    const id = text(value, 80)
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || questionIds.has(id)) {
      throw new Error('Every question must have a unique alphanumeric ID.')
    }
    questionIds.add(id)
    return id
  }
  const sets = workbook.sets.map((value): WorksheetSet => {
    const set = record(value)
    if (
      typeof set.id !== 'number' ||
      !Number.isInteger(set.id) ||
      set.id < 1 ||
      set.id > 45 ||
      setIds.has(set.id)
    ) {
      throw new Error('Set numbers must be unique integers between 1 and 45.')
    }
    setIds.add(set.id)
    if (
      !Array.isArray(set.words) ||
      set.words.length !== 10 ||
      !Array.isArray(set.pictures) ||
      set.pictures.length !== 5
    ) {
      throw new Error(
        'Each set must contain 10 word questions and 5 picture questions.',
      )
    }
    return {
      id: set.id,
      words: set.words.map((value) => {
        const question = record(value)
        return { id: questionId(question.id), words: text(question.words, 100) }
      }),
      pictures: set.pictures.map((value) => {
        const question = record(value)
        const image = imageData(question.image)
        totalImageChars += image.length
        if (totalImageChars > MAX_TOTAL_IMAGE_CHARS)
          throw new WorkbookSizeError()
        return {
          id: questionId(question.id),
          word: text(question.word, 12),
          image,
          alt: text(question.alt, 200),
        }
      }),
    }
  })
  return {
    version: 1,
    ...(workbook.cloudRevision !== undefined
      ? { cloudRevision: workbook.cloudRevision as string | null }
      : {}),
    ...(workbook.cloudDirty !== undefined
      ? { cloudDirty: workbook.cloudDirty as boolean }
      : {}),
    ...(workbook.providedContentRevision === 1
      ? { providedContentRevision: 1 as const }
      : {}),
    sets: sets.sort((a, b) => a.id - b.id),
  }
}

/** Import replaces matching numbered sets while retaining all other existing sets. */
export function mergeWorkbook(
  existing: Workbook,
  incoming: Workbook,
): Workbook {
  const sets = new Map(
    validateWorkbook(existing).sets.map((set) => [set.id, set]),
  )
  for (const set of validateWorkbook(incoming).sets) sets.set(set.id, set)
  return validateWorkbook({
    version: 1,
    cloudRevision:
      existing.cloudRevision !== undefined
        ? existing.cloudRevision
        : incoming.cloudRevision,
    cloudDirty:
      existing.cloudDirty !== undefined
        ? existing.cloudDirty
        : incoming.cloudDirty,
    providedContentRevision:
      existing.providedContentRevision ?? incoming.providedContentRevision,
    sets: Array.from(sets.values()),
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Browser storage is unavailable.'))
      return
    }
    let settled = false
    const request = indexedDB.open(DATABASE_NAME, 1)
    const fail = (error: Error | DOMException) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    }
    const timeout = setTimeout(
      () => fail(new Error('Opening browser storage timed out.')),
      5000,
    )
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME))
        request.result.createObjectStore(STORE_NAME)
    }
    request.onerror = () =>
      fail(request.error ?? new Error('Could not open browser storage.'))
    request.onblocked = () =>
      fail(new Error('Browser storage is blocked by another open page.'))
    request.onsuccess = () => {
      if (settled) {
        request.result.close()
        return
      }
      settled = true
      clearTimeout(timeout)
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

function storedWorkbook(value: unknown): {
  revision: string | null
  workbook: unknown | null
} {
  if (value === undefined) return { revision: null, workbook: null }
  const stored = record(value)
  if (stored.version === 1)
    return { revision: LEGACY_REVISION, workbook: stored }
  if (
    typeof stored.revision !== 'string' ||
    stored.revision.length < 1 ||
    stored.revision.length > 100 ||
    !stored.workbook
  ) {
    throw new Error('The saved workbook has an invalid storage envelope.')
  }
  return { revision: stored.revision, workbook: stored.workbook }
}

async function readWorkbook(): Promise<Workbook | null> {
  if (hasConflict) throw new WorkbookConflictError()
  const database = await openDatabase()
  try {
    return await new Promise<Workbook | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(WORKBOOK_KEY)
      transaction.oncomplete = () => {
        try {
          const stored = storedWorkbook(request.result)
          const workbook =
            stored.workbook === null ? null : validateWorkbook(stored.workbook)
          expectedRevision = stored.revision
          resolve(workbook)
        } catch (error) {
          reject(error)
        }
      }
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Could not load the workbook.'))
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Could not load the workbook.'))
    })
  } finally {
    database.close()
  }
}

export function loadWorkbook(): Promise<Workbook | null> {
  return enqueueStorage(readWorkbook)
}

async function writeWorkbook(workbook: Workbook): Promise<void> {
  if (hasConflict) throw new WorkbookConflictError()
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const nextRevision = crypto.randomUUID()
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      let failure: unknown
      transaction.oncomplete = () => {
        expectedRevision = nextRevision
        resolve()
      }
      transaction.onabort = () =>
        reject(
          failure ??
            transaction.error ??
            new Error('Could not save the workbook.'),
        )
      transaction.onerror = () => {
        failure ??=
          transaction.error ?? new Error('Could not save the workbook.')
      }
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(WORKBOOK_KEY)
      request.onsuccess = () => {
        try {
          if (storedWorkbook(request.result).revision !== expectedRevision) {
            hasConflict = true
            throw new WorkbookConflictError()
          }
          store.put({ revision: nextRevision, workbook }, WORKBOOK_KEY)
        } catch (error) {
          failure = error
          transaction.abort()
        }
      }
    })
  } finally {
    database.close()
  }
}

export async function saveWorkbook(workbook: Workbook): Promise<void> {
  const validated = validateWorkbook(workbook)
  return enqueueStorage(() => writeWorkbook(validated))
}
