# Solution Walkthrough

**Live Demo:** [https://path-pilot-challenge-final.vercel.app/](https://path-pilot-challenge-final.vercel.app/)

## Implementation Summary

This solution builds a real-time chat interface that streams NDJSON responses from PathPilot's API, automatically detects whether the streamed payload contains job listings or course recommendations, normalizes the inconsistent field shapes into a uniform structure, and renders them as interactive card components inline with the conversation. The UI was styled to match PathPilot's actual brand identity, extracted programmatically using the Firecrawl API.

The implementation is split across four files: `normalizers.ts` handles all detection and normalization logic in isolation, `cells.tsx` defines the `JobCell` and `CourseCell` presentational components, `App.tsx` orchestrates the NDJSON stream parsing and wires detected data into the React rendering loop, and `styles.css` provides the visual layer including responsive breakpoints, skill tags, and typing animations.

![Initial empty state of the chat interface](https://ef9r8nohindxnq5x.public.blob.vercel-storage.com/chat-image.png)
![chat interface](https://ef9r8nohindxnq5x.public.blob.vercel-storage.com/job-course-query.png)
![chat interface](https://ef9r8nohindxnq5x.public.blob.vercel-storage.com/two-courses.png)
![chat interface](https://ef9r8nohindxnq5x.public.blob.vercel-storage.com/basic-job-search-image.png)
![chat interface](https://ef9r8nohindxnq5x.public.blob.vercel-storage.com/basic-course-search.png)


## Files Changed

| File | What changed |
|------|-------------|
| `pathpilot-design-guide.json` | **New file.** Brand kit extracted from `pathpilot.ai` via Firecrawl's scrape API with the `branding` format. Contains colors, fonts, typography, component styles, logo URL, and brand personality metadata. |
| `src/normalizers.ts` | **New file.** 3 layer detection engine (function-name context → structural shape matching → weighted field scoring), normalization functions with multi-key fallback (`pickFirst`), nested structure unwrapping, and TypeScript type definitions for `NormalizedJob`, `NormalizedCourse`, and `DetectionResult`. |
| `src/cells.tsx` | Added `skills?: string[]` prop to `JobCell` with pill-tag rendering, graceful fallback defaults ("Untitled", "Unknown", "n/a") for both `JobCell` and `CourseCell`, and a letter-placeholder `Logo` component for missing images. |
| `src/App.tsx` | Extended `ChatMessage` type with optional `jobs`/`courses` arrays, wired `detectAndNormalize()` into `processParsedChunk()` for `FUNCTION_RETURN` handling, built `JobCards`/`CourseCards` wrapper components with expand/collapse, added `stripMarkdownTables()` to remove redundant LLM-generated tables, auto-scroll with near-bottom detection, typing indicator with bounce animation, and debug event counter. |
| `src/styles.css` | Skill tag pill styles (`#f1f5f9` background, subtle border), card-in-chat layout with heading counts, expand/collapse toggle button, typing indicator keyframe animation, responsive single-column breakpoint at 640px, and PathPilot brand colors throughout. |

---

## Phase 0: Brand Identity Extraction with Firecrawl

Before building the UI, I used the [Firecrawl API](https://firecrawl.dev) to programmatically scrape PathPilot's live website (`pathpilot.ai`) and extract its brand kit. Firecrawl's `scrape` endpoint with the `"branding"` format returns structured data about a site's visual identity colors, fonts, typography scales, component styles, logo URLs, and brand personality.

The response was saved as `pathpilot-design-guide.json` and used as the source of truth for styling decisions:

| Brand token | Extracted value | How it was used |
|-------------|----------------|-----------------|
| Primary color | `#6F6C90` | Muted text, secondary labels |
| Accent / text color | `#170F49` | Top bar background, headings, user message bubbles |
| Background | `#FFFFFF` | Page and card backgrounds |
| Font family | Varela / Varela Round | Body text and headings |
| Border radius | `8px` base, `12px` buttons | Card corners, input fields, buttons |
| Logo | `pathpilot-logo.svg` | Top bar brand mark |
| Brand personality | Modern, medium energy, career-focused professionals | Informed the clean, professional card layout |

This ensured the chat interface feels native to PathPilot's existing product rather than a disconnected prototype.

---

## Known Issue: "Can not create bot title proposal" Error

The backend occasionally returns a `KeyError('content')` error when generating a chat session title. This is a server-side issue, not a client bug. If you encounter it, refresh the page and try again.

![Backend error screenshot](https://ef9r8nohindxnq5x.public.blob.vercel-storage.com/backend-error.png)

---

## Phase 1: API Observation

Before writing any detection code, I sent 9 distinct queries to the live API and recorded the full NDJSON stream for each. This was the most important phase it determined whether detection would work reliably, because the challenge states that payload shapes are intentionally inconsistent and we cannot control the model prompt.



### Function names discovered

| Function name | Returns | Renders cards? |
|---------------|---------|----------------|
| `get_top_jobs` | Array of job objects | Yes, JobCell |
| `get_udemy_courses` | Array of course objects | Yes, CourseCell |
| `get_resume` | Single object (name, resume text, etc.) | No |
| `get_candidate_job_search_criteria` | Single object (search preferences) | No |

Key findings:
- `skills` is already an array of strings (no parsing needed)
- `fit_score` is often `null` (no score available)
- `company_logo` is often an empty string (needs fallback to a letter placeholder)
- 20 items per response



---

## Phase 2: Detection Architecture

Detection uses three layers in `normalizers.ts`, tried in order from highest to lowest confidence. If a higher confidence layer produces a result, lower layers are skipped entirely.

### Layer 1: Function-name context (highest confidence)

Every `FUNCTION_RETURN` chunk carries a `function_name` field. This directly tells us the data type:
- `get_top_jobs` → jobs
- `get_udemy_courses` → courses
- anything else -> not card data

As a safety net for function names we haven't observed, the code also checks whether the name contains "job" or "course" as a substring. The preceding `FUNCTION_CALL` chunk's `fncalls[].function_name` is tracked as fallback context, but in practice every `FUNCTION_RETURN` carries its own `function_name`.

This layer alone handles 100% of the observed API responses.

### Layer 2: Structural shape matching (medium confidence)

If Layer 1 doesn't match (e.g., `function_name` is missing or unrecognized), we check the structure of the first object in the payload:

- **Job shape**: has `title` AND `company` AND (`location` OR `url`)
- **Course shape**: has `title` AND (`course_id` OR `level` OR `rating`) AND does NOT have `company`

The `!company` guard prevents courses from being misclassified when the data happens to have a title and a level-like field alongside a company field.

### Layer 3: Weighted field scoring (safety net)

If Layers 1 and 2 don't match, we score each candidate object by its field names against known signals:

**Job scoring** (threshold: 3 points):
- Strong signals (2 pts each): `company`, `fit_score`, `company_logo`, `employment_type`
- Medium signals (1 pt each): `title`, `location`, `skills`, `posting_date`

**Course scoring** (threshold: 3 points):
- Strong signals (2 pts each): `course_id`, `instructional_level`, `image_240x135`, `provider`
- Medium signals (1 pt each): `level`, `rating`, `price`, `title`

The type with the higher score wins, as long as it meets the threshold. This layer exists purely as a safety net and has not been needed with any observed API response.

---

## Phase 3: Normalization

### Field mapping strategy

Each field uses a `pickFirst(obj, ...keys)` helper that tries multiple field names in priority order, returning the first non-empty match. The primary key comes from the observed API data; additional keys are common aliases as a safety net for schema drift.

**Job field mapping:**

| Target prop | Tried keys (in order) |
|-------------|----------------------|
| `title` | `title`, `job_title`, `jobTitle`, `position`, `role`, `name` |
| `company` | `company`, `company_name`, `companyName`, `employer`, `organization` |
| `location` | `location`, `city`, `place`, `area`, `region` |
| `companyLogo` | `companyLogo`, `company_logo`, `logo`, `image`, `icon` |
| `fitScore` | `fit_score`, `fitScore`, `score`, `match_score`, `matchScore` |
| `url` | `url`, `link`, `apply_url`, `applyUrl`, `job_url`, `jobUrl` |
| `skills` | `skills`, `required_skills`, `tags`, `keywords`, `competencies` |

**Course field mapping:**

| Target prop | Tried keys (in order) |
|-------------|----------------------|
| `title` | `title`, `course_title`, `courseTitle`, `name` |
| `provider` | `provider`, `platform`, `source`, `institution`, `vendor` (default: `"Udemy"`) |
| `level` | `level`, `difficulty`, `skill_level`, `skillLevel`, `instructional_level` |
| `image` | `image_240x135`, `image`, `thumbnail`, `cover`, `picture`, `img` |
| `rating` | `rating`, `stars`, `score`, `review_score` |
| `price` | `price`, `cost`, `fee`, `amount` |
| `url` | `url`, `link`, `course_url`, `courseUrl` |

### Skills normalization

Skills can arrive in multiple formats. The normalizer handles:
- **Array of strings** (observed in API): used directly
- **Comma-separated string**: split and trimmed
- Checks multiple field names: `skills`, `required_skills`, `tags`, `keywords`, `competencies`

### Graceful fallbacks

Every field that might be empty shows a sensible default in the UI rather than blank space or `undefined`:
- Title: "Untitled"
- Company: "Unknown"
- Location: "Not specified"
- Provider: "Unknown"
- Level: "Not specified"
- Fit Score: "n/a"
- Rating/Price: "n/a / n/a"
- Logo: letter placeholder (first character of company/title name, displayed in a colored circle)

---

## Phase 4: Rendering Integration

### How cards enter the message list

When `processParsedChunk()` in `App.tsx` receives a `FUNCTION_RETURN` chunk, the following pipeline runs:

1. It reads `function_name` from the chunk (or falls back to the tracked name from the preceding `FUNCTION_CALL`)
2. Passes the function name and raw content to `detectAndNormalize()` from `normalizers.ts`
3. If detection returns jobs or courses, the normalized items are accumulated into a pending buffer
4. When the assistant's streamed text finishes (signaled by `end_of_content`), the pending cards are flushed into a `ChatMessage` alongside the conversational text
5. The raw JSON is also stored as a `FUNCTION_RETURN` debug message (hidden when debugMode is off)

This means cards appear inline in the natural chat flow, right alongside the assistant's prose. Raw payloads remain accessible via the Debug toggle in the top bar.

### Rendering decision tree

In the JSX rendering loop, each message is routed to the appropriate visual treatment:
- **Has `jobs` or `courses` arrays** → render `JobCards` / `CourseCards` components with the prose text above them
- **`FUNCTION_CALL` or `FUNCTION_RETURN` type** → render as debug output (monospace, muted) — only visible when Debug is on
- **`USER` type** → render as plain text in a dark bubble, right-aligned
- **Everything else** → render as markdown via ReactMarkdown with GFM support

### The assistant text that follows cards

After the `FUNCTION_RETURN`, the LLM streams its natural language response as `ASSISTANT` fragments. This text typically includes a markdown table with the same data the cards already display, plus conversational prose ("Here are some jobs..." and "Would you like to refine...").

To avoid showing the same information twice, the assistant text is passed through `stripMarkdownTables()` when cards were rendered in the same response. This function removes contiguous lines that start with `|` (the markdown table rows) while preserving all surrounding prose. A `cardsRenderedInResponse` flag tracks whether cards appeared during the current stream, so the table stripping only activates when cards are already visible.

---

## Phase 5: UI Additions

### Job cards with skill tags

The `JobCell` component renders each job as a horizontal row showing the company logo (or a letter placeholder when the logo URL is empty), title, company name, location, fit score, and a "View" link. Below the main row, skill tags are displayed as pill-shaped badges spanning the full width of the card. This gives recruiters and job seekers an immediate signal about the technical requirements without clicking through.

### Course cards

The `CourseCell` component follows the same horizontal layout but shows the course thumbnail, title, provider (defaulting to "Udemy"), difficulty level, and a combined rating/price field. 

### Combined job + course queries

When a user asks for both jobs and courses in a single message (e.g., "search for React developer jobs and also recommend React courses"), the API triggers multiple `FUNCTION_CALL`/`FUNCTION_RETURN` pairs. The system accumulates all detected card groups and renders them in order jobs first, then courses 

### Expand/collapse for large result sets

Both `JobCards` and `CourseCards` initially show only 3 items with a "Show all N jobs/courses" button at the bottom. Clicking it expands the full list; clicking "Show less" collapses it back. This keeps the chat readable when 20 job results come back at once, while still giving full access to the data:


### Auto-scroll

A `chatEndRef` div sits at the bottom of the chat container. A `useEffect` triggers `scrollIntoView({ behavior: 'smooth' })` whenever `messages` or `liveAssistantText` change, but only if the user is already near the bottom of the scroll area. This prevents the view from jumping if the user has scrolled up to review earlier results.

### Typing indicator

When `isStreaming` is true but no live text has arrived yet, three animated bouncing dots appear in an assistant-styled bubble. This covers the perceptible gap between sending a message and receiving the first streamed chunk, giving the user immediate feedback that the system is working.

### Responsive layout

On screens below 640px, the desktop grid layout collapses to a single column so cards remain readable on mobile. The card fields stack vertically, and the skill tags wrap naturally.

---
