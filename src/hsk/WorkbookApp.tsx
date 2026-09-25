import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  CloudUpload,
  ChevronDown,
  Circle,
  FileText,
  ImagePlus,
  Languages,
  LayoutTemplate,
  LoaderCircle,
  Pencil,
  Printer,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react'
import {
  createWorkbook,
  imageDataSize,
  loadWorkbook,
  MAX_TOTAL_IMAGE_CHARS,
  mergeWorkbook,
  restoreWorkbook,
  toCloudWorkbook,
  saveWorkbook,
  validateWorkbook,
  WorkbookConflictError,
} from './data'
import type { PictureQuestion, Workbook, WorksheetSet } from './data'
import { en } from './locales/en'
import { vi } from './locales/vi'
import { AnswerKeyEditor, PracticePanel } from './PracticePanel'
import { normalizeAnswer } from './practice'
import { readExerciseImage } from './images'
import {
  CloudConflictError,
  fetchCloudWorkbook,
  publishWorkbook,
  reconcileCloudWorkbook,
} from './cloud'

type Copy = { [K in keyof typeof en]: string }
type Language = 'en' | 'vi'
const numbered = (n: number) => String(n).padStart(2, '0')
const wordCount = (set: WorksheetSet) =>
  set.words.filter((q) => q.words.trim()).length
const pictureCount = (set: WorksheetSet) =>
  set.pictures.filter((q) => q.word.trim() && q.image).length

function Sheet({
  set,
  part,
  copy,
  language,
}: {
  set: WorksheetSet
  part: 1 | 2
  copy: Copy
  language: Language
}) {
  return (
    <article
      className={`worksheet-page part-${part}`}
      lang={language}
      aria-label={`${copy.set} ${set.id}, ${copy.page} ${part}`}
    >
      <header className="sheet-header">
        <div>
          <span className="sheet-eyebrow">HSK 4 · 书写练习</span>
          <h2>{copy.writingPractice}</h2>
        </div>
        <div className="sheet-set">
          <span>{copy.set}</span>
          <strong>{numbered(set.id)}</strong>
        </div>
      </header>
      <div className="student-fields">
        <span>
          {copy.name}
          <i />
        </span>
        <span>
          {copy.className}
          <i />
        </span>
        <span>
          {copy.date}
          <i />
        </span>
      </div>
      <div className="section-heading">
        <span className="part-number">0{part}</span>
        <div>
          <h3>{part === 1 ? copy.wordOrder : copy.pictureSentences}</h3>
          <p>
            {part === 1 ? copy.wordOrderDescription : copy.pictureDescription}
          </p>
        </div>
        <span className="section-chinese" lang="zh-CN">
          {part === 1 ? '完成句子' : '看图造句'}
        </span>
      </div>
      {part === 1 ? (
        <ol className="word-questions">
          {set.words.map((question, i) => (
            <li key={question.id}>
              <div className="question-prompt">
                <span className="question-number">{numbered(i + 1)}</span>
                <span
                  className={`chinese words ${question.words.length > 85 ? 'long' : question.words.length > 30 ? 'medium' : ''}`}
                  lang="zh-CN"
                >
                  {question.words || <span className="blank-word" />}
                </span>
              </div>
              <div className="answer-line">
                <span>→</span>
                <i />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="picture-questions">
          {set.pictures.map((question, i) => (
            <div className="picture-question" key={question.id}>
              <div className="picture-label">
                <span className="question-number">{numbered(i + 1)}</span>
                <span className="chinese" lang="zh-CN">
                  {question.word || '　'}
                </span>
              </div>
              <div
                className={`picture-box ${question.image ? 'has-image' : ''}`}
              >
                {question.image ? (
                  <img
                    src={question.image}
                    alt={question.alt || `${copy.imagePlaceholder} ${i + 1}`}
                  />
                ) : (
                  <div className="picture-placeholder">
                    <ImagePlus size={25} strokeWidth={1} />
                    <span>
                      {copy.imagePlaceholder} {numbered(i + 1)}
                    </span>
                  </div>
                )}
              </div>
              <div className="picture-answer">
                <i />
                <i />
              </div>
            </div>
          ))}
        </div>
      )}
      <footer className="sheet-footer">
        <span>HSK 4 · {copy.workbook}</span>
        <span>
          {copy.set} {numbered(set.id)}
          <b>·</b>
          {part} / 2
        </span>
      </footer>
    </article>
  )
}

function Preview({
  set,
  copy,
  language,
}: {
  set: WorksheetSet
  copy: Copy
  language: Language
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const target = ref.current
    if (!target) return
    const observer = new ResizeObserver(([entry]) =>
      setScale(Math.min(1, entry.contentRect.width / ((210 * 96) / 25.4))),
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [])
  return (
    <div className="preview-stack" ref={ref}>
      {([1, 2] as const).map((part) => (
        <section className="preview-section" key={part}>
          <div className="page-caption">
            <span>
              {copy.page} {part}
              <b>·</b>
              {part === 1 ? copy.pageOne : copy.pageTwo}
            </span>
            <span>A4</span>
          </div>
          <div
            className="page-frame"
            style={{ width: `${210 * scale}mm`, height: `${297 * scale}mm` }}
          >
            <div
              style={{
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
            >
              <Sheet set={set} part={part} copy={copy} language={language} />
            </div>
          </div>
        </section>
      ))}
    </div>
  )
}

function Editor({
  set,
  update,
  copy,
  onError,
}: {
  set: WorksheetSet
  update: (patch: (current: WorksheetSet) => WorksheetSet) => void
  copy: Copy
  onError: (message: string) => void
}) {
  const updatePicture = (index: number, patch: Partial<PictureQuestion>) =>
    update((current) => ({
      ...current,
      pictures: current.pictures.map((p, i) =>
        i === index ? { ...p, ...patch } : p,
      ),
    }))
  async function readImage(file: File | undefined, index: number) {
    if (!file) return
    try {
      const data = await readExerciseImage(file)
      updatePicture(index, { image: data })
    } catch {
      onError(copy.imageError)
    }
  }
  return (
    <div className="editor">
      <div className="editor-intro">
        <Pencil size={18} />
        <p>{copy.editingHelp}</p>
      </div>
      <section className="editor-section">
        <div className="editor-heading">
          <span className="part-number">01</span>
          <h3>{copy.wordOrder}</h3>
          <span>10 {copy.questions}</span>
        </div>
        {set.words.map((question, index) => (
          <label className="word-input-row" key={question.id}>
            <span>{numbered(index + 1)}</span>
            <input
              lang="zh-CN"
              className="chinese"
              value={question.words}
              placeholder={copy.wordPlaceholder}
              maxLength={100}
              onChange={(e) => {
                const words = e.target.value
                update((current) => ({
                  ...current,
                  words: current.words.map((q, i) =>
                    i === index ? { ...q, words } : q,
                  ),
                }))
              }}
            />
          </label>
        ))}
      </section>
      <section className="editor-section">
        <div className="editor-heading">
          <span className="part-number">02</span>
          <h3>{copy.pictureSentences}</h3>
          <span>5 {copy.picturePrompts}</span>
        </div>
        <div className="picture-editor-grid">
          {set.pictures.map((question, index) => (
            <div className="picture-editor-card" key={question.id}>
              <div className="picture-editor-title">
                <span>{numbered(index + 1)}</span>
                {question.image && (
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`${copy.removeImage} ${index + 1}`}
                    onClick={() => updatePicture(index, { image: '' })}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <label
                className={`image-upload ${question.image ? 'filled' : ''}`}
              >
                {question.image ? (
                  <img
                    src={question.image}
                    alt={
                      question.alt || `${copy.imagePlaceholder} ${index + 1}`
                    }
                  />
                ) : (
                  <ImagePlus size={26} strokeWidth={1.4} />
                )}
                <span>
                  {question.image ? copy.replaceImage : copy.uploadImage}
                </span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/jpg,image/png,image/webp,image/gif"
                  aria-label={`${copy.uploadImage} ${index + 1}`}
                  onChange={(e) => {
                    void readImage(e.target.files?.[0], index)
                    e.target.value = ''
                  }}
                />
              </label>
              <label className="field-label">
                {copy.keyword}
                <input
                  className="chinese"
                  lang="zh-CN"
                  maxLength={12}
                  value={question.word}
                  placeholder={copy.promptPlaceholder}
                  onChange={(e) =>
                    updatePicture(index, { word: e.target.value })
                  }
                />
              </label>
              <label className="field-label">
                {copy.imageDescription}
                <input
                  maxLength={200}
                  value={question.alt}
                  placeholder={copy.imageDescriptionPlaceholder}
                  onChange={(e) =>
                    updatePicture(index, { alt: e.target.value })
                  }
                />
              </label>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export function WorkbookApp() {
  const [workbook, setWorkbook] = useState<Workbook>(() => createWorkbook())
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [active, setActive] = useState(1)
  const [language, setLanguage] = useState<Language>('en')
  const [mode, setMode] = useState<'solve' | 'answers' | 'preview' | 'edit'>('solve')
  const [scope, setScope] = useState<'current' | 'all'>('current')
  const [saveStatus, setSaveStatus] = useState<
    'saved' | 'saving' | 'saveError' | 'conflictError'
  >('saved')
  const [message, setMessage] = useState('')
  const [printing, setPrinting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [cloudState, setCloudState] = useState<
    'loading' | 'ready' | 'saving' | 'error' | 'conflict'
  >('loading')
  const inputRef = useRef<HTMLInputElement>(null)
  const printedRef = useRef<HTMLDivElement>(null)
  const revision = useRef(0)
  const workbookRef = useRef(workbook)
  const copy: Copy = language === 'vi' ? vi : en
  const selected = workbook.sets.find((s) => s.id === active)!
  const keyedQuestions = [...selected.words, ...selected.pictures].filter(
    (question) => question.answers?.some((answer) => normalizeAnswer(answer)),
  ).length
  const ready = wordCount(selected) + pictureCount(selected)
  const completedSets = workbook.sets.filter(
    (s) => wordCount(s) + pictureCount(s) === 15,
  ).length
  useEffect(() => {
    let cancelled = false
    loadWorkbook()
      .then((saved) => {
        if (!cancelled) {
          if (saved) {
            const restored = restoreWorkbook(saved)
            workbookRef.current = restored
            setWorkbook(restored)
            if (saved.providedContentRevision !== 1) {
              revision.current += 1
              setSaveStatus('saving')
            }
          }
          setLoaded(true)
          void fetchCloudWorkbook()
            .then((remote) => {
              if (cancelled) return
              const local =
                saved || revision.current > 0 ? workbookRef.current : null
              const next = reconcileCloudWorkbook(local, remote)
              if (
                JSON.stringify(next) !== JSON.stringify(workbookRef.current)
              ) {
                workbookRef.current = next
                revision.current += 1
                setSaveStatus('saving')
                setWorkbook(next)
              }
              setCloudState('ready')
            })
            .catch(() => {
              if (!cancelled) setCloudState('error')
            })
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])
  useEffect(() => {
    if (!loaded || revision.current === 0) return
    const current = revision.current
    const timer = window.setTimeout(() => {
      saveWorkbook(workbook)
        .then(() => {
          if (revision.current === current) setSaveStatus('saved')
        })
        .catch((error) => {
          if (revision.current === current)
            setSaveStatus(
              error instanceof WorkbookConflictError
                ? 'conflictError'
                : 'saveError',
            )
        })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [workbook, loaded])
  useEffect(() => {
    if (saveStatus === 'saved') return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveStatus])

  function storeLocalWorkbook(next: Workbook) {
    if (imageDataSize(next) > MAX_TOTAL_IMAGE_CHARS) {
      setMessage(copy.workbookSizeError)
      return
    }
    if (workbookRef.current === next) return
    workbookRef.current = next
    revision.current += 1
    setSaveStatus('saving')
    setWorkbook(next)
  }
  function updateWorkbook(patch: (current: Workbook) => Workbook) {
    storeLocalWorkbook({ ...patch(workbookRef.current), cloudDirty: true })
  }
  async function saveToWebsite() {
    const snapshot = workbookRef.current
    const capturedRevision = revision.current
    if (snapshot.cloudRevision === undefined || cloudState !== 'ready') return
    setCloudState('saving')
    try {
      const cloudRevision = await publishWorkbook(
        snapshot,
        snapshot.cloudRevision,
      )
      storeLocalWorkbook({
        ...workbookRef.current,
        cloudRevision,
        cloudDirty: revision.current !== capturedRevision,
      })
      setCloudState('ready')
      setMessage(copy.cloudSaveSuccess)
    } catch (error) {
      setCloudState(error instanceof CloudConflictError ? 'conflict' : 'ready')
      setMessage(
        error instanceof CloudConflictError
          ? copy.cloudConflict
          : copy.cloudSaveError,
      )
    }
  }
  async function loadWebsiteCopy() {
    const capturedRevision = revision.current
    setCloudState('loading')
    try {
      const remote = await fetchCloudWorkbook()
      // A fresh download preserves a local draft before the user explicitly replaces it.
      if (workbookRef.current.cloudDirty) exportWorkbook()
      if (revision.current !== capturedRevision) {
        setCloudState('ready')
        setMessage(copy.cloudLoadChanged)
        return
      }
      storeLocalWorkbook({
        ...(remote.workbook ?? workbookRef.current),
        cloudRevision: remote.revision,
        cloudDirty: !remote.workbook && Boolean(workbookRef.current.cloudDirty),
      })
      setCloudState('ready')
      setMessage(copy.cloudLoadSuccess)
    } catch {
      setCloudState('error')
      setMessage(copy.cloudSaveError)
    }
  }
  function updateSet(patch: (current: WorksheetSet) => WorksheetSet) {
    const id = active
    updateWorkbook((current) => ({
      ...current,
      sets: current.sets.map((s) => (s.id === id ? patch(s) : s)),
    }))
  }
  function selectSet(id: number) {
    setActive(id)
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function exportWorkbook() {
    const url = URL.createObjectURL(
      new Blob(
        [JSON.stringify(toCloudWorkbook(workbookRef.current), null, 2)],
        {
          type: 'application/json',
        },
      ),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'hsk-4-writing-workbook.json'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage(copy.exportSuccess)
  }
  async function importWorkbook(file: File | undefined) {
    if (!file) return
    if (file.size > 100 * 1024 * 1024) {
      setMessage(copy.fileTooLarge)
      return
    }
    setImporting(true)
    try {
      const incoming = validateWorkbook(JSON.parse(await file.text()))
      await Promise.all(
        incoming.sets.flatMap((set) =>
          set.pictures
            .filter((p) => p.image)
            .map(async (p) => {
              const img = new Image()
              img.src = p.image
              await img.decode()
            }),
        ),
      )
      // Check cross-set IDs before scheduling the state update, so invalid imports never reach React render.
      mergeWorkbook(workbookRef.current, incoming)
      updateWorkbook((current) => mergeWorkbook(current, incoming))
      setActive(incoming.sets[0].id)
      setMessage(copy.importSuccess)
    } catch {
      setMessage(copy.importError)
    } finally {
      setImporting(false)
    }
  }
  async function printWorkbook() {
    setPrinting(true)
    try {
      await document.fonts.ready
      await Promise.all(
        Array.from(printedRef.current?.querySelectorAll('img') ?? []).map(
          (img) => img.decode(),
        ),
      )
      window.print()
    } catch {
      setMessage(copy.printImageError)
    } finally {
      setPrinting(false)
    }
  }

  if (!loaded)
    return (
      <main className="loading-screen">
        <div className="brand-icon">文</div>
        {loadFailed ? (
          <p role="alert">{copy.loadError}</p>
        ) : (
          <>
            <LoaderCircle className="spin" size={20} />
            <p>{copy.loading}</p>
          </>
        )}
      </main>
    )

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <a className="brand" href="/">
            <span className="brand-icon">文</span>
            <span>
              <strong>{copy.brand}</strong>
              <small>{copy.brandCategory}</small>
            </span>
          </a>
          <div className="sidebar-book">
            <BookOpen size={18} />
            <span>{copy.workbook}</span>
            <span className="level-badge">4</span>
          </div>
          <details className="set-navigation" open>
            <summary>
              {copy.sets}
              <span>
                45 <ChevronDown size={14} />
              </span>
            </summary>
            <nav className="set-grid" aria-label={copy.sets}>
              {workbook.sets.map((set) => (
                <button
                  key={set.id}
                  className={`set-button ${active === set.id ? 'active' : ''} ${wordCount(set) + pictureCount(set) === 15 ? 'complete' : ''}`}
                  aria-current={active === set.id ? 'page' : undefined}
                  aria-label={`${copy.set} ${set.id}`}
                  onClick={() => selectSet(set.id)}
                >
                  {numbered(set.id)}
                  {wordCount(set) + pictureCount(set) === 15 && <span />}
                </button>
              ))}
            </nav>
          </details>
          <div className="collection-progress">
            <div>
              <span>{copy.ready}</span>
              <strong>{completedSets} / 45</strong>
            </div>
            <progress value={completedSets} max={45} />
          </div>
          <div className="sidebar-bottom">
            <span className="tiny-flower">✳</span>
            <p>{copy.brandSubtitle}</p>
            <span>{copy.storageLocal}</span>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <BookOpen size={15} />
              <span>{copy.workbook}</span>
              <span>/</span>
              <strong>HSK 4</strong>
            </div>
            <button className="text-button" onClick={exportWorkbook}>
              <ArrowDownToLine size={16} />
              <span>{copy.exportData}</span>
            </button>
          </header>
          <main className="workspace">
            <div className="workspace-heading">
              <div>
                <div className="eyebrow">HSK 4 · 书写</div>
                <h1>
                  {copy.writingPractice}
                  <span className="title-dot">.</span>
                </h1>
                <p>{copy.intro}</p>
              </div>
              <button
                className="button primary print-button"
                disabled={printing}
                onClick={() => void printWorkbook()}
              >
                {printing ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Printer size={17} />
                )}
                {copy.print}
              </button>
            </div>
            <div className="workbook-toolbar">
              <div className="set-title">
                <span className="set-title-icon">
                  <FileText size={20} strokeWidth={1.5} />
                </span>
                <div>
                  <h2>
                    {copy.set} {numbered(active)}
                    <span>/ 45</span>
                  </h2>
                  <span
                    className={`status-label ${ready === 15 ? 'ready' : ''}`}
                  >
                    <i />
                    {ready === 15
                      ? copy.ready
                      : ready
                        ? copy.draft
                        : copy.empty}
                  </span>
                </div>
              </div>
              <div className="mode-tabs" aria-label={copy.content}>
                <button
                  className={mode === 'solve' ? 'selected' : ''}
                  aria-pressed={mode === 'solve'}
                  onClick={() => setMode('solve')}
                >
                  <Pencil size={15} />
                  {copy.solve}
                </button>
                <button
                  className={mode === 'answers' ? 'selected' : ''}
                  aria-pressed={mode === 'answers'}
                  onClick={() => setMode('answers')}
                >
                  <CheckCircle2 size={15} />
                  {copy.answerKey}
                </button>
                <button
                  className={mode === 'preview' ? 'selected' : ''}
                  aria-pressed={mode === 'preview'}
                  onClick={() => setMode('preview')}
                >
                  <LayoutTemplate size={15} />
                  {copy.preview}
                </button>
                <button
                  className={mode === 'edit' ? 'selected' : ''}
                  aria-pressed={mode === 'edit'}
                  onClick={() => setMode('edit')}
                >
                  <Pencil size={15} />
                  {copy.edit}
                </button>
              </div>
            </div>
            {message && (
              <div className="notice" role="status">
                <span>{message}</span>
                <button
                  className="icon-button"
                  aria-label={copy.close}
                  onClick={() => setMessage('')}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <p className="sample-note">{copy.providedContentNote}</p>
            <div
              className={`workspace-body ${mode === 'solve' || mode === 'answers' ? 'practice-layout' : ''}`}
            >
              <div className="content-column">
                <div hidden={mode !== 'solve'}>
                  <PracticePanel set={selected} copy={copy} />
                </div>
                {mode === 'solve' ? null : mode === 'answers' ? (
                  <AnswerKeyEditor
                    key={active}
                    set={selected}
                    copy={copy}
                    update={updateSet}
                  />
                ) : mode === 'preview' ? (
                  <Preview set={selected} copy={copy} language={language} />
                ) : (
                  <Editor
                    key={active}
                    set={selected}
                    update={updateSet}
                    copy={copy}
                    onError={setMessage}
                  />
                )}
                <div className="set-pagination">
                  <button
                    className="text-button"
                    disabled={active === 1}
                    onClick={() => selectSet(active - 1)}
                  >
                    <ArrowLeft size={16} />
                    {copy.previous}
                  </button>
                  <span>{numbered(active)} / 45</span>
                  <button
                    className="text-button"
                    disabled={active === 45}
                    onClick={() => selectSet(active + 1)}
                  >
                    {copy.next}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
              <aside className="inspector">
                <section className="inspector-card cloud-card">
                  <h3>
                    <CloudUpload size={16} />
                    {copy.cloudTitle}
                  </h3>
                  <button
                    className="button primary"
                    disabled={cloudState !== 'ready'}
                    onClick={() => void saveToWebsite()}
                  >
                    {cloudState === 'saving' ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <CloudUpload size={15} />
                    )}
                    {cloudState === 'saving'
                      ? copy.cloudSaving
                      : copy.cloudSave}
                  </button>
                  <p role="status">
                    {cloudState === 'error'
                      ? copy.cloudUnavailable
                      : cloudState === 'conflict'
                        ? copy.cloudConflict
                        : cloudState === 'loading'
                          ? copy.cloudLoading
                          : workbook.cloudDirty
                            ? copy.cloudUnsaved
                            : copy.cloudSynced}
                  </p>
                  <button
                    className="text-button"
                    disabled={
                      cloudState === 'saving' || cloudState === 'loading'
                    }
                    onClick={() => void loadWebsiteCopy()}
                  >
                    {copy.cloudLoad}
                  </button>
                  <small>{copy.cloudSharedNotice}</small>
                </section>
                <section className="inspector-card">
                  <h3>
                    <SlidersHorizontal size={16} />
                    {copy.printSettings}
                  </h3>
                  <label className="field-label">
                    {copy.printScope}
                    <select
                      value={scope}
                      onChange={(e) =>
                        setScope(e.target.value as 'current' | 'all')
                      }
                    >
                      <option value="current">{copy.currentSet}</option>
                      <option value="all">{copy.allSets}</option>
                    </select>
                  </label>
                  <label className="field-label">
                    {copy.language}
                    <span className="select-icon">
                      <Languages size={15} />
                      <select
                        value={language}
                        onChange={(e) =>
                          setLanguage(e.target.value as Language)
                        }
                      >
                        <option value="en">English</option>
                        <option value="vi">Tiếng Việt</option>
                      </select>
                    </span>
                  </label>
                  <div className="paper-info">
                    <span className="paper-icon">A4</span>
                    <div>
                      <strong>{copy.a4}</strong>
                      <span>
                        {scope === 'all' ? '90' : '2'} {copy.pages} · 210 × 297
                        mm
                      </span>
                    </div>
                  </div>
                  <p className="clean-note">
                    <Check size={14} />
                    {copy.cleanBackground}
                  </p>
                </section>
                <section className="inspector-card content-card">
                  <h3>{copy.content}</h3>
                  <div className="content-stat">
                    <span>
                      <FileText size={16} />
                      {copy.wordsCount}
                    </span>
                    <strong>
                      {wordCount(selected)}
                      <small>/10</small>
                    </strong>
                  </div>
                  <div className="content-stat">
                    <span>
                      <ImagePlus size={16} />
                      {copy.picturesCount}
                    </span>
                    <strong>
                      {pictureCount(selected)}
                      <small>/5</small>
                    </strong>
                  </div>
                  <div className="content-divider" />
                  <button
                    className="text-button answer-key-link"
                    onClick={() => setMode('answers')}
                  >
                    <CheckCircle2 size={16} />
                    {copy.answerKey} · {keyedQuestions}/15
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => inputRef.current?.click()}
                    disabled={importing}
                  >
                    <Upload size={15} />
                    {importing ? copy.importing : copy.importData}
                  </button>
                  <input
                    ref={inputRef}
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(e) => {
                      void importWorkbook(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </section>
                <div className="help-card">
                  <span className="help-icon">✳</span>
                  <h3>{copy.nextStep}</h3>
                  <p>{copy.nextStepDescription}</p>
                  <button
                    className="text-button"
                    onClick={() => setMode('answers')}
                  >
                    {copy.answerKey}
                    <ArrowRight size={14} />
                  </button>
                </div>
                <div
                  className={`save-status ${saveStatus.endsWith('Error') ? 'error' : ''}`}
                  role="status"
                >
                  {saveStatus === 'saved' ? (
                    <CheckCircle2 size={14} />
                  ) : saveStatus === 'saving' ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Circle size={14} />
                  )}
                  <span>{copy[saveStatus]}</span>
                </div>
                <p className="print-hint">{copy.printTip}</p>
                {ready < 15 && (
                  <p className="print-hint">{copy.blankWarning}</p>
                )}
              </aside>
            </div>
          </main>
        </div>
      </div>
      <div className="print-deck" ref={printedRef}>
        {(scope === 'all' ? workbook.sets : [selected]).flatMap((set) =>
          ([1, 2] as const).map((part) => (
            <Sheet
              key={`${set.id}-${part}`}
              set={set}
              part={part}
              copy={copy}
              language={language}
            />
          )),
        )}
      </div>
    </>
  )
}
