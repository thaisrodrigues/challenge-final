# Chat Challenge

Minimal Vite + React coding challenge extracted from the main repo chat flow.

## Challenge Brief
Build a more reliable chat-card rendering layer for streamed job/course results.

The app currently:
- Shows one chat page
- Streams from:
  - `POST /chats/new`
  - `PUT /chats/:sessionId/send`
- Has a `debugMode` toggle that shows internal LLM events
- Includes desktop-style Job/Course card components in the codebase, but they are not wired into chat rendering yet

The rendering is intentionally inconsistent/incomplete.
You will need to find the best way to detect job/course data, normalize it, and use it to display the relevant card UI.”

## Candidate Task
Make job/course cards consistent across response shapes and missing fields.

Required addition:
- Be able to detect when a response contains jobs or courses.
- Use the included desktop Job/Course card files to render the jobs/courses in chat when they are returned.
- JobCards don't currently disoplay skills, add a `skills` list to each Job card.

Notes:
- You cannot control the model prompt.
- The fix should rely on robust client-side parsing and using available info.

## Setup
Install and run:
   - `npm install`
   - `npm run dev`

## Evaluation Focus
- Detection logic quality:
  - How reliably jobs/courses are detected from streamed events
  - How correctly the UI decides when to render cards vs plain assistant text
- Data mapping consistency:
  - How well available fields are normalized across variable payload shapes
  - How consistently mapped data is applied to desktop Job/Course cards
- Robustness and maintainability of parsing/mapping code
