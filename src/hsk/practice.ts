import { MAX_ANSWER_LENGTH } from './data'
import type { PictureQuestion, WordQuestion } from './data'

type PracticeQuestion = WordQuestion | PictureQuestion
export type AnswerResult =
  | 'correct'
  | 'incorrect'
  | 'different'
  | 'unanswered'
  | 'no-key'
export type PracticeAttempt = { answer: string; signature: string }
export type PracticeAttempts = Record<string, PracticeAttempt>
type PracticeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

export const PRACTICE_STORAGE_PREFIX = 'hsk-writing-practice-v1:'
const VALID_QUESTION_ID = /^[a-zA-Z0-9_-]{1,80}$/
const VALID_SIGNATURE = /^v1-[a-f0-9]{16}$/
const MAX_STORED_ATTEMPT_CHARS = 2000

/** Exact comparison after width/compatibility, whitespace and punctuation normalization. */
export function normalizeAnswer(answer: string): string {
  return answer.normalize('NFKC').replace(/[\s\p{P}]/gu, '')
}

/** Picture prompts can have valid sentences beyond the supplied answer key. */
export function checkAnswer(question: PracticeQuestion, answer: string): AnswerResult {
  const normalized = normalizeAnswer(answer)
  if (!normalized) return 'unanswered'
  const accepted = (question.answers ?? []).map(normalizeAnswer).filter(Boolean)
  if (accepted.length === 0) return 'no-key'
  if (accepted.includes(normalized)) return 'correct'
  return 'words' in question ? 'incorrect' : 'different'
}

/** A compact change marker; this is not an authentication or security hash. */
export function questionSignature(question: PracticeQuestion): string {
  const parts = 'words' in question
    ? ['word', question.words, ...(question.answers ?? [])]
    : ['picture', question.word, question.image, question.alt, ...(question.answers ?? [])]
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  const update = (value: number) => {
    first = Math.imul(first ^ value, 0x01000193)
    second = Math.imul(second ^ value, 0x85ebca6b)
  }
  for (const part of parts) {
    // Length separators distinguish field boundaries without copying embedded pictures.
    for (const character of `${part.length}:`) update(character.charCodeAt(0))
    for (let index = 0; index < part.length; index++) update(part.charCodeAt(index))
  }
  return `v1-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

function validateAttempt(value: unknown): PracticeAttempt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid saved practice answer.')
  }
  const attempt = value as Record<string, unknown>
  if (
    typeof attempt.answer !== 'string' ||
    attempt.answer.length > MAX_ANSWER_LENGTH ||
    typeof attempt.signature !== 'string' ||
    !VALID_SIGNATURE.test(attempt.signature)
  ) {
    throw new Error('Invalid saved practice answer.')
  }
  return { answer: attempt.answer, signature: attempt.signature }
}

/** Learner answers use separate per-question browser keys, never the workbook payload. */
export function loadPractice(storage?: PracticeStorage): {
  attempts: PracticeAttempts
  storageError: boolean
} {
  const entries: [string, PracticeAttempt][] = []
  let storageError = false
  try {
    const target = storage ?? globalThis.localStorage
    if (!Number.isInteger(target.length) || target.length < 0) {
      throw new Error('Browser practice storage is unavailable.')
    }
    for (let index = 0; index < target.length; index++) {
      const key = target.key(index)
      if (!key?.startsWith(PRACTICE_STORAGE_PREFIX)) continue
      try {
        const id = key.slice(PRACTICE_STORAGE_PREFIX.length)
        if (!VALID_QUESTION_ID.test(id)) throw new Error('Invalid saved question ID.')
        const raw = target.getItem(key)
        if (!raw || raw.length > MAX_STORED_ATTEMPT_CHARS) {
          throw new Error('Invalid saved practice answer.')
        }
        const value: unknown = JSON.parse(raw)
        if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) {
          throw new Error('Unsupported saved practice version.')
        }
        entries.push([id, validateAttempt(value)])
      } catch {
        // Retain all other valid attempts if one record was corrupted or hand-edited.
        storageError = true
      }
    }
  } catch {
    storageError = true
  }
  return { attempts: Object.fromEntries(entries), storageError }
}

/** Writes only the edited question, preserving unrelated answers from another tab. */
export function savePracticeAttempt(
  questionId: string,
  attempt: PracticeAttempt,
  storage?: PracticeStorage,
): boolean {
  try {
    if (typeof questionId !== 'string' || !VALID_QUESTION_ID.test(questionId)) {
      throw new Error('Invalid question ID.')
    }
    const validated = validateAttempt(attempt)
    const target = storage ?? globalThis.localStorage
    target.setItem(
      `${PRACTICE_STORAGE_PREFIX}${questionId}`,
      JSON.stringify({ version: 1, ...validated }),
    )
    return true
  } catch {
    return false
  }
}

export function clearPracticeAttempts(questionIds: string[], storage?: PracticeStorage): boolean {
  try {
    if (!questionIds.every((id) => typeof id === 'string' && VALID_QUESTION_ID.test(id))) return false
    const target = storage ?? globalThis.localStorage
    for (const id of questionIds) target.removeItem(`${PRACTICE_STORAGE_PREFIX}${id}`)
    return true
  } catch {
    return false
  }
}
