import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { JobCell, CourseCell } from './cells'
import {
  detectAndNormalize,
  type NormalizedJob,
  type NormalizedCourse,
  type DetectionResult,
} from './normalizers'

type MessageType =
  | 'USER'
  | 'ASSISTANT'
  | 'ASSISSTANT'
  | 'CHATBOT'
  | 'FUNCTION_CALL'
  | 'FUNCTION_RETURN'
  | 'ERROR'

interface ChatMessage {
  id: string
  type: MessageType
  content: string
  jobs?: NormalizedJob[]
  courses?: NormalizedCourse[]
}

interface SessionInfoChunk {
  type: 'SESSION_INFO'
  session_id?: string
}

interface StreamChunk {
  type?: string
  content?: string
  fragment?: boolean | string
  i?: number
  end_of_content?: boolean
  message?: string
  messages?: Array<{ type?: string; content?: string }>
  function_name?: string
  fncalls?: Array<{
    function_name?: string
    function_arguments?: string
    _action_label?: string
  }>
}

const DEFAULT_CHAT_MODEL = { type: 'google', model: 'gemini-2.5-flash' }
const DEFAULT_SUGG_MODEL = { type: 'fireworks', model: 'mixtral-8x22b-instruct' }

function messageTypeFromChunk(chunk: StreamChunk): MessageType | null {
  if (chunk.type === 'USER') return 'USER'
  if (chunk.type === 'ASSISTANT') return 'ASSISTANT'
  if (chunk.type === 'ASSISSTANT') return 'ASSISSTANT'
  if (chunk.type === 'CHATBOT') return 'CHATBOT'
  if (chunk.type === 'FUNCTION_CALL') return 'FUNCTION_CALL'
  if (chunk.type === 'FUNCTION_RETURN') return 'FUNCTION_RETURN'
  if (chunk.type === 'ERROR') return 'ERROR'
  return null
}

function isSessionInfoChunk(value: unknown): value is SessionInfoChunk {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: string }).type === 'SESSION_INFO'
  )
}

function safeParseJson(line: string): unknown | null {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function extractAssistantText(value: unknown): string | null {
  const record = asRecord(value)
  if (!record) return null

  if (record.type === 'USER') return null

  if (typeof record.content === 'string' && record.content.trim()) {
    return record.content
  }
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message
  }

  if (Array.isArray(record.messages)) {
    for (let i = record.messages.length - 1; i >= 0; i -= 1) {
      const msg = record.messages[i]
      if (!msg || typeof msg !== 'object') continue
      const msgRecord = msg as Record<string, unknown>
      const type = msgRecord.type
      const content = msgRecord.content
      if (
        (type === 'ASSISTANT' || type === 'ASSISSTANT' || type === 'CHATBOT') &&
        typeof content === 'string' &&
        content.trim()
      ) {
        return content
      }
    }
  }

  return null
}

function extractErrorText(value: unknown): string {
  const record = asRecord(value)
  if (!record) return 'Backend error'

  const direct =
    (typeof record.content === 'string' && record.content) ||
    (typeof record.message === 'string' && record.message) ||
    (typeof record.error === 'string' && record.error) ||
    (typeof record.detail === 'string' && record.detail)

  if (direct) return direct

  if (record.error && typeof record.error === 'object') {
    try {
      return JSON.stringify(record.error)
    } catch {
      return 'Backend error'
    }
  }

  try {
    return JSON.stringify(record)
  } catch {
    return 'Backend error'
  }
}

/**
 * Remove markdown table blocks from assistant text.  Keeps all prose
 * before and after the table (intro sentence, follow-up question, etc.).
 * A markdown table is a contiguous run of lines that start with `|`.
 */
function stripMarkdownTables(text: string): string {
  const lines = text.split('\n')
  const filtered = lines.filter((line) => !line.trimStart().startsWith('|'))
  return filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function getChallengeToken(): string | null {
  const token = import.meta.env.VITE_CHALLENGE_TOKEN as string | undefined
  if (token && token.trim()) return token.trim()
  return null
}

/* ── Card rendering helpers ──────────────────────────────────────────────── */

const INITIAL_VISIBLE = 3

function JobCards({ jobs }: { jobs: NormalizedJob[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? jobs : jobs.slice(0, INITIAL_VISIBLE)
  const hasMore = jobs.length > INITIAL_VISIBLE

  return (
    <div className="msg-cards">
      <p className="msg-cards-heading">Jobs ({jobs.length})</p>
      {visible.map((job, i) => (
        <JobCell
          key={`${job.url || ''}-${i}`}
          title={job.title}
          company={job.company}
          location={job.location}
          companyLogo={job.companyLogo || undefined}
          fitScore={job.fitScore || undefined}
          url={job.url || undefined}
          skills={job.skills}
        />
      ))}
      {hasMore ? (
        <button
          type="button"
          className="cards-toggle"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded
            ? 'Show less'
            : `Show all ${jobs.length} jobs`}
        </button>
      ) : null}
    </div>
  )
}

function CourseCards({ courses }: { courses: NormalizedCourse[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? courses : courses.slice(0, INITIAL_VISIBLE)
  const hasMore = courses.length > INITIAL_VISIBLE

  return (
    <div className="msg-cards">
      <p className="msg-cards-heading">Courses ({courses.length})</p>
      {visible.map((course, i) => (
        <CourseCell
          key={`${course.url || ''}-${i}`}
          title={course.title}
          provider={course.provider}
          level={course.level}
          image={course.image || undefined}
          rating={course.rating || undefined}
          price={course.price || undefined}
          url={course.url || undefined}
        />
      ))}
      {hasMore ? (
        <button
          type="button"
          className="cards-toggle"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded
            ? 'Show less'
            : `Show all ${courses.length} courses`}
        </button>
      ) : null}
    </div>
  )
}

/* ── App component ───────────────────────────────────────────────────────── */

export default function App() {
  const [debugMode, setDebugMode] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [liveAssistantText, setLiveAssistantText] = useState('')
  const [liveCards, setLiveCards] = useState<{ jobs: NormalizedJob[]; courses: NormalizedCourse[] }>({ jobs: [], courses: [] })
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const chatRef = useRef<HTMLDivElement | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const cardsInStreamRef = useRef(false)
  const isNearBottomRef = useRef(true)

  const handleChatScroll = useCallback(() => {
    const el = chatRef.current
    if (!el) return
    const threshold = 120
    isNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }, [])

  useEffect(() => {
    if (isNearBottomRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, liveAssistantText])

  const hiddenDebugCount = useMemo(
    () =>
      messages.filter(
        (msg) =>
          msg.type === 'FUNCTION_CALL' || msg.type === 'FUNCTION_RETURN',
      ).length,
    [messages],
  )

  const visibleMessages = useMemo(
    () =>
      messages.filter((msg) => {
        if (msg.type === 'FUNCTION_CALL' || msg.type === 'FUNCTION_RETURN') {
          return debugMode
        }
        return true
      }),
    [debugMode, messages],
  )

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    if (!input.trim() || isStreaming) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      type: 'USER',
      content: input.trim(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setError(null)
    setIsStreaming(true)
    cardsInStreamRef.current = false

    const requestMessage = userMessage.content
    const controller = new AbortController()
    abortRef.current = controller

    // Track the most recent function name from FUNCTION_CALL chunks
    // so we can use it as context when processing FUNCTION_RETURN.
    let lastFunctionName: string | null = null
    let cardsRenderedInResponse = false

    try {
      const apiUrl = import.meta.env.VITE_API_URL as string | undefined
      if (!apiUrl) {
        throw new Error('Missing VITE_API_URL in env')
      }

      const isNewChat = !sessionId
      const url = isNewChat
        ? `${apiUrl}/chats/new`
        : `${apiUrl}/chats/${sessionId}/send`

      const challengeToken = getChallengeToken()

      const response = await fetch(url, {
        method: isNewChat ? 'POST' : 'PUT',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
          ...(challengeToken ? { 'challenge-token': challengeToken } : {}),
        },
        body: JSON.stringify({
          message: requestMessage,
          memory: false,
          noFunctions: false,
          chatModel: DEFAULT_CHAT_MODEL.model,
          chatModelType: DEFAULT_CHAT_MODEL.type,
          suggModel: DEFAULT_SUGG_MODEL.model,
          suggModelType: DEFAULT_SUGG_MODEL.type,
        }),
      })

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No stream reader available')
      }

      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      let streamedAssistantText = ''

      // Accumulate detected cards so they can be attached to the
      // assistant text that follows, keeping text above cards.
      let pendingJobs: NormalizedJob[] = []
      let pendingCourses: NormalizedCourse[] = []

      const appendAssistantChunk = (textChunk: string) => {
        console.log('[challenge][stream][append-chunk]', textChunk)
        streamedAssistantText += textChunk
        setLiveAssistantText(streamedAssistantText)
      }

      const flushPendingCards = (textContent: string) => {
        const cleaned = cardsRenderedInResponse
          ? stripMarkdownTables(textContent)
          : textContent

        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          type: 'ASSISTANT',
          content: cleaned.trim(),
        }
        if (pendingJobs.length > 0) msg.jobs = [...pendingJobs]
        if (pendingCourses.length > 0) msg.courses = [...pendingCourses]

        if (msg.content || msg.jobs || msg.courses) {
          setMessages((prev) => [...prev, msg])
        }

        pendingJobs = []
        pendingCourses = []
      }

      const appendAssistantMessage = (textValue: string) => {
        if (pendingJobs.length > 0 || pendingCourses.length > 0) {
          flushPendingCards(textValue)
          return
        }
        const cleaned = cardsRenderedInResponse
          ? stripMarkdownTables(textValue)
          : textValue
        if (!cleaned.trim()) return
        console.log('[challenge][stream][append-message]', cleaned)
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: 'ASSISTANT',
            content: cleaned,
          },
        ])
      }

      const flushLiveAssistantText = () => {
        if (streamedAssistantText.trim()) {
          appendAssistantMessage(streamedAssistantText)
        } else if (pendingJobs.length > 0 || pendingCourses.length > 0) {
          flushPendingCards('')
        }
        streamedAssistantText = ''
        setLiveAssistantText('')
      }

      const accumulateCards = (result: DetectionResult) => {
        if (!result) return
        if (result.kind === 'jobs') {
          pendingJobs.push(...(result.items as NormalizedJob[]))
        } else {
          pendingCourses.push(...(result.items as NormalizedCourse[]))
        }
        setLiveCards({ jobs: [...pendingJobs], courses: [...pendingCourses] })
      }

      const processParsedChunk = (parsed: unknown) => {
        if (isSessionInfoChunk(parsed)) {
          if (parsed.session_id) {
            setSessionId(parsed.session_id)
          }
          flushLiveAssistantText()
          return
        }

        const parsedRecord = asRecord(parsed)
        if (!parsedRecord) return

        if (typeof parsedRecord.sessionId === 'string' && parsedRecord.sessionId) {
          setSessionId(parsedRecord.sessionId)
        }

        const chunk = parsedRecord as StreamChunk
        const type = messageTypeFromChunk(chunk)
        const chunkContent = typeof chunk.content === 'string' ? chunk.content : null

        if ((chunk.fragment === true || chunk.fragment === 'true') && chunkContent) {
          appendAssistantChunk(chunkContent)
          return
        }

        if (chunk.end_of_content === true) {
          flushLiveAssistantText()
          return
        }

        if (type === 'FUNCTION_CALL') {
          // Track function names for context-based detection on FUNCTION_RETURN
          if (chunk.fncalls && chunk.fncalls.length > 0) {
            const names = chunk.fncalls
              .map((fc) => fc.function_name)
              .filter((n): n is string => !!n)
            if (names.length > 0) {
              lastFunctionName = names[names.length - 1]
            }
          }
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              type,
              content: JSON.stringify(chunk),
            },
          ])
          return
        }

        if (type === 'FUNCTION_RETURN') {
          // Use function_name from the chunk itself, or fall back to tracked context
          const fnName = chunk.function_name || lastFunctionName
          const result = detectAndNormalize(fnName, chunk.content)

          if (result && result.items.length > 0) {
            accumulateCards(result)
            cardsRenderedInResponse = true
            cardsInStreamRef.current = true
          }

          // Always store the raw debug message too
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              type,
              content: JSON.stringify(chunk),
            },
          ])
          return
        }

        const isAssistantType =
          type === 'ASSISTANT' || type === 'ASSISSTANT' || type === 'CHATBOT'
        const hasFragmentFlag =
          chunk.fragment === true || chunk.fragment === 'true'
        const likelyChunkedAssistant =
          hasFragmentFlag || typeof chunk.i === 'number'

        if (isAssistantType && chunkContent !== null) {
          if (likelyChunkedAssistant) {
            appendAssistantChunk(chunkContent)
          } else {
            appendAssistantMessage(chunkContent)
          }
          return
        }

        if (type === 'ERROR') {
          const errorText = extractErrorText(parsedRecord)
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              type: 'ERROR',
              content: errorText,
            },
          ])
          setError(errorText)
          return
        }

        const fallbackAssistantText = extractAssistantText(parsedRecord)
        if (fallbackAssistantText) {
          appendAssistantMessage(fallbackAssistantText)
        }
      }

      const parseLine = (rawLine: string) => {
        const line = rawLine.trim()
        if (!line) return

        console.log('[challenge][stream][raw-line]', line)

        const normalized = line.startsWith('data:')
          ? line.slice(5).trim()
          : line
        if (!normalized) return

        const parsed = safeParseJson(normalized)
        if (!parsed) {
          console.log('[challenge][stream][parse-failed]', normalized)
          return
        }
        console.log('[challenge][stream][parsed-chunk]', parsed)
        processParsedChunk(parsed)
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          const finalRaw = decoder.decode()
          if (finalRaw) buffer += finalRaw
          if (buffer.trim()) {
            parseLine(buffer)
          }
          flushLiveAssistantText()
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const rawLine of lines) {
          parseLine(rawLine)
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message)
      }
    } finally {
      setIsStreaming(false)
      setLiveAssistantText('')
      setLiveCards({ jobs: [], courses: [] })
      abortRef.current = null
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-brand">
          <img
            className="topbar-logo"
            src="https://pathpilot.ai/pathpilot-logo.svg"
            alt="PathPilot home"
          />
          <h1 className="topbar-title">Chat</h1>
        </div>
        <div className="topbar-right">
          <label className="toggle">
            <span>Debug</span>
            <input
              type="checkbox"
              checked={debugMode}
              onChange={(event) => setDebugMode(event.target.checked)}
            />
          </label>
        </div>
      </div>

      <div className="meta">
        Session: {sessionId || 'new'}
        {!debugMode && hiddenDebugCount > 0
          ? ` · ${hiddenDebugCount} debug event(s) hidden`
          : null}
      </div>

      <div className="chat" ref={chatRef} onScroll={handleChatScroll}>
        {visibleMessages.length === 0 && !isStreaming ? (
          <div className="empty-state">
            <div className="empty-state-icon">💬</div>
            <p className="empty-state-text">
              Ask about jobs, courses, or career advice to get started.
            </p>
          </div>
        ) : null}

        {visibleMessages.map((message) => {
          const hasCards =
            (message.jobs && message.jobs.length > 0) ||
            (message.courses && message.courses.length > 0)

          if (hasCards) {
            return (
              <div key={message.id}>
                {message.content ? (
                  <div className="msg assistant">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                ) : null}
                {message.jobs && message.jobs.length > 0 ? (
                  <JobCards jobs={message.jobs} />
                ) : null}
                {message.courses && message.courses.length > 0 ? (
                  <CourseCards courses={message.courses} />
                ) : null}
              </div>
            )
          }

          if (message.type === 'FUNCTION_CALL' || message.type === 'FUNCTION_RETURN') {
            return (
              <div key={message.id} className="msg debug">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              </div>
            )
          }

          if (message.type === 'USER') {
            return (
              <div key={message.id} className="msg user">
                {message.content}
              </div>
            )
          }

          return (
            <div key={message.id} className="msg assistant">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          )
        })}

        {!liveAssistantText && liveCards.jobs.length > 0 ? (
          <JobCards jobs={liveCards.jobs} />
        ) : null}
        {!liveAssistantText && liveCards.courses.length > 0 ? (
          <CourseCards courses={liveCards.courses} />
        ) : null}
        {liveAssistantText ? (
          <>
            <div className="msg assistant">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {cardsInStreamRef.current
                  ? stripMarkdownTables(liveAssistantText)
                  : liveAssistantText}
              </ReactMarkdown>
            </div>
            {liveCards.jobs.length > 0 ? (
              <JobCards jobs={liveCards.jobs} />
            ) : null}
            {liveCards.courses.length > 0 ? (
              <CourseCards courses={liveCards.courses} />
            ) : null}
          </>
        ) : null}

        {isStreaming && !liveAssistantText ? (
          <div className="msg assistant typing-indicator">
            <span /><span /><span />
          </div>
        ) : null}
        <div ref={chatEndRef} />
      </div>

      {error ? <div className="error">{error}</div> : null}

      <form className="composer" onSubmit={sendMessage}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              if (input.trim() && !isStreaming) {
                sendMessage(event as unknown as FormEvent)
              }
            }
          }}
          placeholder="Ask about jobs, courses, or career advice..."
          disabled={isStreaming}
          rows={1}
        />
        <button type="submit" disabled={isStreaming || !input.trim()}>
          {isStreaming ? (
            'Sending...'
          ) : (
            <>
              Send
              <svg className="send-icon" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.94 5.34a1 1 0 0 1 1.09-.18l12 5.5a1 1 0 0 1 0 1.82l-12 5.5A1 1 0 0 1 2.6 16.6L4.8 11 2.6 5.56a1 1 0 0 1 .34-.22Z" />
              </svg>
            </>
          )}
        </button>
      </form>
    </div>
  )
}
