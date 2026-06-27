# HANDSIGNS

HANDSIGNS is an MVP for turning Korean text into a sequence of Korean sign-language video candidates.

The project is designed as an early prototype for expert feedback. It does not claim to be a complete or authoritative sign-language interpreter yet. Instead, it gives sign-language experts, accessibility reviewers, and builders a concrete interface to evaluate matching quality, missing expressions, and the overall translation flow.

## MVP Goal

The first version focuses on:

- Taking a Korean sentence from the user.
- Splitting the sentence into searchable words or phrases.
- Searching multiple Culture Portal sign-language API sources.
- Prioritizing results that include video.
- Displaying selected results in a simple playback queue.
- Making mismatches visible so experts can review and suggest improvements.

This is currently a **text-to-sign-video** prototype, not a camera-based sign recognition system.

## Data Sources

The app is prepared to search these Culture Portal API categories:

- Daily Life Sign Language
- Technical Term Sign Language
- Culture Information Sign Language
- Integrated Sign Language

The exact API endpoints and response fields can be configured through environment variables while the production API contract is finalized.

## Architecture

```text
Browser UI
  - Korean text input
  - Video preview
  - Playback queue
  - Source labels

Node API Proxy
  - Keeps the Culture Portal API key off the frontend
  - Searches each configured sign-language API source
  - Normalizes different API response shapes
  - Returns video-first candidates to the frontend

Culture Portal APIs
  - Daily life signs
  - Technical terms
  - Culture information signs
  - Integrated signs
```

## Local Setup

Requirements:

- Node.js 18 or newer
- A Culture Portal API key

Create a local environment file:

```bash
cp .env.example .env
```

Fill in the API key and whichever API source URLs are available:

```bash
CULTURE_API_KEY=
CULTURE_API_LIFE_URL=
CULTURE_API_SPECIALIZED_URL=
CULTURE_API_CULTURE_URL=
CULTURE_API_INTEGRATED_URL=
```

Then run:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

If no API key or endpoint is configured, the app still runs in preview mode with placeholder entries.

## API Routes

### Search One Term

```http
GET /api/signs/search?q=안녕하세요
```

Returns normalized sign-language candidates for one word or phrase.

### Translate Text

```http
POST /api/signs/translate
Content-Type: application/json
```

Request body:

```json
{
  "text": "안녕하세요 감사합니다"
}
```

Returns searchable terms and normalized sign candidates for each term.

## Deployment Notes

The repository includes a GitHub Pages workflow:

```text
.github/workflows/pages.yml
```

GitHub Pages can host the static frontend in `public/`, but it cannot safely store API keys or run the Node proxy. For a public deployment:

1. Deploy the static frontend with GitHub Pages.
2. Deploy `server.js` separately on a backend host such as Render, Fly.io, Railway, or a serverless platform.
3. Set the frontend API base URL in `public/config.js`:

```js
window.HANDSIGNS_API_BASE_URL = "https://your-api.example.com";
```

For local development, keep the value empty so the frontend calls the same origin.

## Expert Feedback Needed

This MVP is meant to support conversations with sign-language experts. Useful feedback includes:

- Whether word-level matching is acceptable for the target use case.
- Which expressions require phrase-level or sentence-level interpretation.
- Whether selected videos are semantically appropriate.
- Which API source should be preferred for ambiguous terms.
- How to handle missing terms, synonyms, honorifics, spacing, and context.
- What metadata should be shown to users for trust and review.

## Current Limitations

- The app does not perform grammar-aware Korean sentence analysis yet.
- It does not generate new sign-language video.
- It does not recognize sign language from camera input.
- Word-by-word matching may produce unnatural or incorrect sign sequences.
- Actual API field mapping may need adjustment after testing real Culture Portal responses.

## Roadmap

- Validate real Culture Portal API responses and finalize field mapping.
- Add phrase-level search before falling back to word-level search.
- Add expert review notes for each matched sign.
- Add source ranking rules.
- Add a missing-term workflow.
- Add a deployable hosted backend for the GitHub Pages frontend.

## Repository

GitHub: https://github.com/oops-lobster/HANDSIGNS
