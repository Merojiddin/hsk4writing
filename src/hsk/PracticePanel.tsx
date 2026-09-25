import { useMemo, useRef, useState } from 'react'
import { BookOpen, CheckCircle2, ImagePlus, RotateCcw } from 'lucide-react'
import {
  MAX_ACCEPTED_ANSWERS,
  MAX_ANSWER_LENGTH,
} from './data'
import type { PictureQuestion, WordQuestion, WorksheetSet } from './data'
import type { en } from './locales/en'
import {
  checkAnswer,
  loadPractice,
  normalizeAnswer,
  questionSignature,
  savePracticeAttempt,
} from './practice'
import type { PracticeAttempts } from './practice'
import './practice.css'

type Copy = Record<keyof typeof en, string>
type Question = WordQuestion | PictureQuestion
type CheckResult = ReturnType<typeof checkAnswer>
type QuestionCheck = { answer: string; signature: string; result: CheckResult }
type SetCheck = { setId: number; questions: Record<string, QuestionCheck> }

const numbered = (value: number) => String(value).padStart(2, '0')
const ownValue = <T,>(values: Record<string, T>, id: string): T | undefined =>
  Object.hasOwn(values, id) ? values[id] : undefined
const hasKey = (question: Question) =>
  question.answers?.some((answer) => normalizeAnswer(answer)) ?? false
const answerLabel = (copy: Copy, part: number, index: number, label: string) =>
  `${part === 1 ? copy.partOne : copy.partTwo} · ${copy.questionLabel} ${index + 1} · ${label}`

function QuestionPrompt({
  question,
  index,
  copy,
}: {
  question: Question
  index: number
  copy: Copy
}) {
  if ('words' in question) {
    return question.words.trim() ? (
      <p className="practice-word-prompt chinese" lang="zh-CN">
        {question.words}
      </p>
    ) : (
      <p className="practice-missing">{copy.practiceMissingPrompt}</p>
    )
  }
  return (
    <div className="practice-picture-prompt">
      <div className={`practice-picture ${question.image ? 'has-image' : ''}`}>
        {question.image ? (
          <img
            src={question.image}
            alt={question.alt || `${copy.imagePlaceholder} ${index + 1}`}
          />
        ) : (
          <div className="practice-missing-picture">
            <ImagePlus size={25} strokeWidth={1.5} aria-hidden="true" />
            <span>{copy.practiceMissingImage}</span>
          </div>
        )}
      </div>
      <div>
        <span className="practice-field-title">{copy.keyword}</span>
        {question.word.trim() ? (
          <p className="practice-keyword chinese" lang="zh-CN">
            {question.word}
          </p>
        ) : (
          <p className="practice-missing">{copy.practiceMissingKeyword}</p>
        )}
      </div>
    </div>
  )
}

function resultText(result: CheckResult, copy: Copy) {
  switch (result) {
    case 'correct':
      return copy.practiceCorrect
    case 'incorrect':
      return copy.practiceIncorrect
    case 'different':
      return copy.practiceReview
    case 'unanswered':
      return copy.practiceUnanswered
    case 'no-key':
      return copy.practiceNoKey
  }
}

export function PracticePanel({ set, copy }: { set: WorksheetSet; copy: Copy }) {
  const [initial] = useState(loadPractice)
  const [attempts, setAttempts] = useState<PracticeAttempts>(initial.attempts)
  const [storageError, setStorageError] = useState(initial.storageError)
  const pendingWrites = useRef<PracticeAttempts>(Object.create(null))
  const [checked, setChecked] = useState<SetCheck | null>(null)
  const questions = useMemo(
    () =>
      [...set.words, ...set.pictures].map((question) => ({
        question,
        signature: questionSignature(question),
      })),
    [set],
  )
  const signatures = Object.fromEntries(
    questions.map(({ question, signature }) => [question.id, signature]),
  )
  const keyed = questions.filter(({ question }) => hasKey(question)).length
  const currentCheck =
    checked?.setId === set.id &&
    questions.every(({ question, signature }) => {
      const result = checked.questions[question.id]
      return (
        result?.signature === signature &&
        result.answer === (ownValue(attempts, question.id)?.answer ?? '')
      )
    })
      ? checked
      : null
  const stale =
    !currentCheck &&
    (checked?.setId === set.id ||
      questions.some(({ question, signature }) => {
        const attempt = ownValue(attempts, question.id)
        return attempt?.answer.trim() && attempt.signature !== signature
      }))
  const incomplete =
    set.words.some((question) => !question.words.trim()) ||
    set.pictures.some((question) => !question.word.trim() || !question.image)

  function enterAnswer(question: Question, answer: string) {
    const attempt = { answer, signature: signatures[question.id] }
    setAttempts((previous) => ({ ...previous, [question.id]: attempt }))
    if (savePracticeAttempt(question.id, attempt)) {
      delete pendingWrites.current[question.id]
    } else {
      pendingWrites.current[question.id] = attempt
    }
    setStorageError(initial.storageError || Object.keys(pendingWrites.current).length > 0)
  }

  function checkSet() {
    const results: Record<string, QuestionCheck> = Object.create(null)
    const next = { ...attempts }
    for (const { question, signature } of questions) {
      const attempt = ownValue(attempts, question.id)
      const answer = attempt?.answer ?? ''
      results[question.id] = {
        answer,
        signature,
        result: checkAnswer(question, answer),
      }
      if (attempt) {
        // Checking acknowledges the current prompt in memory. Only explicit input
        // edits may write storage, so a stale tab cannot overwrite another answer.
        next[question.id] = { answer, signature }
        if (pendingWrites.current[question.id]) {
          if (savePracticeAttempt(question.id, next[question.id])) {
            delete pendingWrites.current[question.id]
          } else {
            pendingWrites.current[question.id] = next[question.id]
          }
        }
      }
    }
    setAttempts(next)
    setStorageError(initial.storageError || Object.keys(pendingWrites.current).length > 0)
    setChecked({ setId: set.id, questions: results })
  }

  const resultCounts = currentCheck
    ? Object.values(currentCheck.questions).reduce(
        (counts, { result }) => ({ ...counts, [result]: counts[result] + 1 }),
        { correct: 0, incorrect: 0, different: 0, unanswered: 0, 'no-key': 0 },
      )
    : null

  return (
    <div className="practice-panel">
      <header className="practice-intro">
        <div className="practice-intro-title">
          <BookOpen size={22} aria-hidden="true" />
          <h3>{copy.practiceTitle}</h3>
        </div>
        <p>{copy.practiceHelp}</p>
        <p className="practice-small">{copy.practicePrivate}</p>
        <span className="practice-coverage">
          {copy.answerKeyCoverage}: <strong>{keyed} / 15</strong>
        </span>
      </header>
      {storageError && (
        <p className="practice-notice error" role="alert">
          {copy.practiceStorageError}
        </p>
      )}
      {incomplete && (
        <p className="practice-notice">{copy.practiceMissingContentHelp}</p>
      )}
      <p className="practice-comparison-help">{copy.practiceComparisonHelp}</p>
      <div className="practice-actions">
        <button className="button primary" type="button" onClick={checkSet}>
          <CheckCircle2 size={18} aria-hidden="true" />
          {copy.checkAnswers}
        </button>
        {currentCheck && (
          <button
            className="button secondary"
            type="button"
            onClick={() => setChecked(null)}
          >
            <RotateCcw size={17} aria-hidden="true" />
            {copy.retryAnswers}
          </button>
        )}
      </div>
      {stale && (
        <p className="practice-notice" role="status">
          {copy.practiceResultsStale}
        </p>
      )}
      {resultCounts && (
        <section className="practice-summary" aria-live="polite" aria-atomic="true">
          <h4>{copy.practiceCheckSummary}</h4>
          <dl>
            <div>
              <dt>{copy.practiceMatched}</dt>
              <dd>{resultCounts.correct} / {keyed}</dd>
            </div>
            <div>
              <dt>{copy.practiceNeedsCorrection}</dt>
              <dd>{resultCounts.incorrect}</dd>
            </div>
            <div>
              <dt>{copy.practiceNeedsReview}</dt>
              <dd>{resultCounts.different}</dd>
            </div>
            <div>
              <dt>{copy.practiceNoKeyCount}</dt>
              <dd>{questions.length - keyed}</dd>
            </div>
            <div>
              <dt>{copy.practiceBlankCount}</dt>
              <dd>{resultCounts.unanswered}</dd>
            </div>
          </dl>
        </section>
      )}
      {([1, 2] as const).map((part) => (
        <section className="practice-section" key={part}>
          <header className="practice-section-heading">
            <span className="part-number">{numbered(part)}</span>
            <div>
              <h3>{part === 1 ? copy.wordOrder : copy.pictureSentences}</h3>
              <p>{part === 1 ? copy.wordOrderDescription : copy.pictureDescription}</p>
            </div>
          </header>
          {(part === 1 ? set.words : set.pictures).map((question, index) => {
            const result = currentCheck?.questions[question.id]?.result
            const answerId = `practice-answer-${question.id}`
            const feedbackId = `practice-feedback-${question.id}`
            return (
              <article
                className={`practice-question${result ? ` result-${result}` : ''}`}
                data-question-id={question.id}
                key={question.id}
              >
                <div className="practice-question-heading">
                  <h4>{copy.questionLabel} {numbered(index + 1)}</h4>
                  {!hasKey(question) && (
                    <span className="practice-key-status">{copy.practiceNoKey}</span>
                  )}
                </div>
                <QuestionPrompt question={question} index={index} copy={copy} />
                <label className="practice-answer-field" htmlFor={answerId}>
                  <span>{copy.yourAnswer}</span>
                  <textarea
                    id={answerId}
                    data-testid={answerId}
                    aria-label={answerLabel(copy, part, index, copy.yourAnswer)}
                    aria-describedby={result ? feedbackId : undefined}
                    className="chinese"
                    lang="zh-CN"
                    rows={2}
                    maxLength={MAX_ANSWER_LENGTH}
                    placeholder={copy.answerPlaceholder}
                    value={ownValue(attempts, question.id)?.answer ?? ''}
                    onChange={(event) => enterAnswer(question, event.target.value)}
                  />
                  <span className="practice-field-hint">{copy.practiceAnswerLimit}</span>
                </label>
                {result && (
                  <div
                    className={`practice-feedback ${result}`}
                    id={feedbackId}
                    data-testid={feedbackId}
                  >
                    <strong>{resultText(result, copy)}</strong>
                    {hasKey(question) && (
                      <div className="practice-supplied-answers">
                        <span>{copy.practiceKeyShown}</span>
                        <ul lang="zh-CN" className="chinese">
                          {question.answers?.filter(normalizeAnswer).map((answer, answerIndex) => (
                            <li key={answerIndex}>{answer}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </section>
      ))}
      <div className="practice-actions practice-bottom-actions">
        <button className="button primary" type="button" onClick={checkSet}>
          <CheckCircle2 size={18} aria-hidden="true" />
          {copy.checkAnswers}
        </button>
      </div>
    </div>
  )
}

type KeyDraft = { raw: string; savedAnswers: string[] | undefined; error: boolean }

export function AnswerKeyEditor({
  set,
  copy,
  update,
}: {
  set: WorksheetSet
  copy: Copy
  update: (patch: (current: WorksheetSet) => WorksheetSet) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, KeyDraft>>({})
  const keyed = [...set.words, ...set.pictures].filter(hasKey).length

  function updateAnswers(question: Question, part: 1 | 2, raw: string) {
    const answers = raw.split(/\r?\n/).map((answer) => answer.trim()).filter(Boolean)
    const error =
      answers.length > MAX_ACCEPTED_ANSWERS ||
      answers.some((answer) => answer.length > MAX_ANSWER_LENGTH)
    setDrafts((previous) => ({
      ...previous,
      [question.id]: {
        raw,
        savedAnswers: error ? question.answers : answers,
        error,
      },
    }))
    if (error) return
    update((current) =>
      part === 1
        ? {
            ...current,
            words: current.words.map((item) =>
              item.id === question.id ? { ...item, answers } : item,
            ),
          }
        : {
            ...current,
            pictures: current.pictures.map((item) =>
              item.id === question.id ? { ...item, answers } : item,
            ),
          },
    )
  }

  return (
    <div className="answer-key-editor practice-panel">
      <header className="practice-intro">
        <div className="practice-intro-title">
          <BookOpen size={22} aria-hidden="true" />
          <h3>{copy.answerKey}</h3>
        </div>
        <p>{copy.answerKeyHelp}</p>
        <p className="practice-small">{copy.answerKeySaveHelp}</p>
        <span className="practice-coverage">
          {copy.answerKeyCoverage}: <strong>{keyed} / 15</strong>
        </span>
      </header>
      <p className="practice-comparison-help">{copy.answerKeyLimit}</p>
      {([1, 2] as const).map((part) => (
        <section className="practice-section" key={part}>
          <header className="practice-section-heading">
            <span className="part-number">{numbered(part)}</span>
            <h3>{part === 1 ? copy.wordOrder : copy.pictureSentences}</h3>
          </header>
          {(part === 1 ? set.words : set.pictures).map((question, index) => {
            const savedDraft = ownValue(drafts, question.id)
            const draft = savedDraft?.savedAnswers === question.answers ? savedDraft : null
            const inputId = `answer-key-${question.id}`
            const errorId = `answer-key-error-${question.id}`
            return (
              <article className="practice-question" data-question-id={question.id} key={question.id}>
                <div className="practice-question-heading">
                  <h4>{copy.questionLabel} {numbered(index + 1)}</h4>
                </div>
                <QuestionPrompt question={question} index={index} copy={copy} />
                <label className="practice-answer-field" htmlFor={inputId}>
                  <span>{copy.acceptedAnswers}</span>
                  <textarea
                    id={inputId}
                    data-testid={inputId}
                    aria-label={answerLabel(copy, part, index, copy.acceptedAnswers)}
                    aria-invalid={draft?.error || undefined}
                    aria-describedby={draft?.error ? errorId : undefined}
                    className="chinese"
                    lang="zh-CN"
                    rows={3}
                    placeholder={copy.acceptedAnswersPlaceholder}
                    value={draft?.raw ?? question.answers?.join('\n') ?? ''}
                    onChange={(event) => updateAnswers(question, part, event.target.value)}
                  />
                </label>
                {draft?.error && (
                  <p className="practice-field-error" id={errorId} role="alert">
                    {copy.practiceKeyLimitError}
                  </p>
                )}
              </article>
            )
          })}
        </section>
      ))}
    </div>
  )
}
