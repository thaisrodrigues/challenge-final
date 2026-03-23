// ---------------------------------------------------------------------------
// Detection & normalisation layer for streamed job / course payloads.
//
// The backend streams NDJSON chunks.  Structured data (jobs, courses) arrives
// inside FUNCTION_RETURN chunks whose `content` is a JSON-encoded string.
//
// Detection uses three layers (highest → lowest confidence):
//   1. Function-name context  – the FUNCTION_RETURN `function_name` field
//      directly tells us the payload type.
//   2. Exact shape matching   – structural checks on the parsed objects.
//   3. Weighted field scoring  – safety-net heuristic for unknown shapes.
// ---------------------------------------------------------------------------

/* ── Normalised output types ─────────────────────────────────────────────── */

export interface NormalizedJob {
  title: string
  company: string
  location: string
  companyLogo: string
  fitScore: string
  url: string
  skills: string[]
}

export interface NormalizedCourse {
  title: string
  provider: string
  level: string
  image: string
  rating: string
  price: string
  url: string
}

export type DetectionResult =
  | { kind: 'jobs'; items: NormalizedJob[] }
  | { kind: 'courses'; items: NormalizedCourse[] }
  | null

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function str(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

function pickFirst(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = str(obj[k])
    if (v) return v
  }
  return ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function safeJsonParse(value: unknown): unknown | null {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/* ── Normalisation functions ─────────────────────────────────────────────── */

function normalizeSkills(raw: Record<string, unknown>): string[] {
  const candidates = [
    raw.skills,
    raw.required_skills,
    raw.tags,
    raw.keywords,
    raw.competencies,
  ]
  for (const c of candidates) {
    if (Array.isArray(c)) {
      return c.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    }
    if (typeof c === 'string' && c.trim()) {
      return c.split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  return []
}

export function normalizeJob(raw: Record<string, unknown>): NormalizedJob {
  return {
    title: pickFirst(raw, 'title', 'job_title', 'jobTitle', 'position', 'role', 'name'),
    company: pickFirst(raw, 'company', 'company_name', 'companyName', 'employer', 'organization'),
    location: pickFirst(raw, 'location', 'city', 'place', 'area', 'region'),
    companyLogo: pickFirst(raw, 'companyLogo', 'company_logo', 'logo', 'image', 'icon'),
    fitScore: pickFirst(raw, 'fit_score', 'fitScore', 'score', 'match_score', 'matchScore'),
    url: pickFirst(raw, 'url', 'link', 'apply_url', 'applyUrl', 'job_url', 'jobUrl'),
    skills: normalizeSkills(raw),
  }
}

export function normalizeCourse(raw: Record<string, unknown>): NormalizedCourse {
  return {
    title: pickFirst(raw, 'title', 'course_title', 'courseTitle', 'name'),
    provider: pickFirst(raw, 'provider', 'platform', 'source', 'institution', 'vendor') || 'Udemy',
    level: pickFirst(raw, 'level', 'difficulty', 'skill_level', 'skillLevel', 'instructional_level'),
    image: pickFirst(raw, 'image_240x135', 'image', 'thumbnail', 'cover', 'picture', 'img'),
    rating: pickFirst(raw, 'rating', 'stars', 'score', 'review_score'),
    price: pickFirst(raw, 'price', 'cost', 'fee', 'amount'),
    url: pickFirst(raw, 'url', 'link', 'course_url', 'courseUrl'),
  }
}

/* ── Layer 1: Function-name context ──────────────────────────────────────── */

const JOB_FUNCTION_NAMES = new Set([
  'get_top_jobs',
  'search_jobs',
  'find_jobs',
  'get_jobs',
  'job_search',
])

const COURSE_FUNCTION_NAMES = new Set([
  'get_udemy_courses',
  'search_courses',
  'find_courses',
  'get_courses',
  'course_search',
])

function classifyByFunctionName(name: string): 'jobs' | 'courses' | null {
  const lower = name.toLowerCase()
  if (JOB_FUNCTION_NAMES.has(lower)) return 'jobs'
  if (COURSE_FUNCTION_NAMES.has(lower)) return 'courses'
  if (lower.includes('job')) return 'jobs'
  if (lower.includes('course')) return 'courses'
  return null
}

/* ── Layer 2: Exact structural matching ──────────────────────────────────── */

function hasJobShape(obj: Record<string, unknown>): boolean {
  return 'title' in obj && 'company' in obj && ('location' in obj || 'url' in obj)
}

function hasCourseShape(obj: Record<string, unknown>): boolean {
  return (
    'title' in obj &&
    ('course_id' in obj || 'level' in obj || 'rating' in obj) &&
    !('company' in obj)
  )
}

/* ── Layer 3: Weighted scoring (safety-net) ──────────────────────────────── */

function scoreAsJob(keys: Set<string>): number {
  let s = 0
  if (keys.has('company') || keys.has('company_name') || keys.has('companyname')) s += 2
  if (keys.has('fit_score') || keys.has('fitscore')) s += 2
  if (keys.has('company_logo') || keys.has('companylogo')) s += 2
  if (keys.has('employment_type')) s += 2
  if (keys.has('title') || keys.has('job_title') || keys.has('jobtitle')) s += 1
  if (keys.has('location') || keys.has('city')) s += 1
  if (keys.has('skills') || keys.has('required_skills')) s += 1
  if (keys.has('posting_date')) s += 1
  return s
}

function scoreAsCourse(keys: Set<string>): number {
  let s = 0
  if (keys.has('course_id') || keys.has('courseid')) s += 2
  if (keys.has('instructional_level')) s += 2
  if (keys.has('image_240x135')) s += 2
  if (keys.has('provider') || keys.has('platform')) s += 2
  if (keys.has('level') || keys.has('difficulty')) s += 1
  if (keys.has('rating') || keys.has('stars')) s += 1
  if (keys.has('price') || keys.has('cost')) s += 1
  if (keys.has('title') || keys.has('course_title')) s += 1
  return s
}

const SCORE_THRESHOLD = 3

function classifyByScoring(obj: Record<string, unknown>): 'jobs' | 'courses' | null {
  const keys = new Set(Object.keys(obj).map((k) => k.toLowerCase()))
  const jobScore = scoreAsJob(keys)
  const courseScore = scoreAsCourse(keys)

  if (jobScore >= SCORE_THRESHOLD && jobScore > courseScore) return 'jobs'
  if (courseScore >= SCORE_THRESHOLD && courseScore > jobScore) return 'courses'
  return null
}

/* ── Unwrap helpers (handle nested wrappers) ─────────────────────────────── */

function unwrapItemsArray(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data

  const record = asRecord(data)
  if (!record) return null

  const arrayKeys = ['results', 'items', 'data', 'jobs', 'courses', 'records', 'list']
  for (const key of arrayKeys) {
    const val = record[key]
    if (Array.isArray(val)) return val
  }

  for (const val of Object.values(record)) {
    if (Array.isArray(val) && val.length > 0 && asRecord(val[0])) {
      return val
    }
  }

  return null
}

/* ── Main detection entry point ──────────────────────────────────────────── */

/**
 * Given a FUNCTION_RETURN chunk, attempts to detect and normalise
 * job or course data. Returns `null` if nothing is detected.
 *
 * @param functionName  The `function_name` from FUNCTION_RETURN (or tracked
 *                      from the preceding FUNCTION_CALL).
 * @param content       The raw `content` field from the chunk — may be a
 *                      JSON string, an array, or an object.
 */
export function detectAndNormalize(
  functionName: string | undefined | null,
  content: unknown,
): DetectionResult {
  const parsed = safeJsonParse(content)
  if (parsed == null) return null

  const items = unwrapItemsArray(parsed)

  // Layer 1: function-name context
  if (functionName) {
    const kind = classifyByFunctionName(functionName)
    if (kind && items && items.length > 0) {
      return kind === 'jobs'
        ? { kind: 'jobs', items: items.map((it) => normalizeJob(asRecord(it) ?? {})) }
        : { kind: 'courses', items: items.map((it) => normalizeCourse(asRecord(it) ?? {})) }
    }
    if (kind && items && items.length === 0) {
      return null
    }
  }

  if (!items || items.length === 0) return null

  const first = asRecord(items[0])
  if (!first) return null

  // Layer 2: exact shape matching
  if (hasJobShape(first)) {
    return { kind: 'jobs', items: items.map((it) => normalizeJob(asRecord(it) ?? {})) }
  }
  if (hasCourseShape(first)) {
    return { kind: 'courses', items: items.map((it) => normalizeCourse(asRecord(it) ?? {})) }
  }

  // Layer 3: weighted scoring
  const kind = classifyByScoring(first)
  if (kind === 'jobs') {
    return { kind: 'jobs', items: items.map((it) => normalizeJob(asRecord(it) ?? {})) }
  }
  if (kind === 'courses') {
    return { kind: 'courses', items: items.map((it) => normalizeCourse(asRecord(it) ?? {})) }
  }

  return null
}

/**
 * Classify a function name so the caller can decide whether to even
 * attempt detection on the corresponding FUNCTION_RETURN.
 */
export function isCardFunction(name: string): boolean {
  return classifyByFunctionName(name) !== null
}
