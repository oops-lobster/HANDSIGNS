# HANDSIGNS

HANDSIGNS is an MVP for turning Korean text into a sequence of Korean Sign Language dictionary video candidates.

The project is designed as an early prototype for expert feedback. It does not claim to be a complete or authoritative sign-language interpreter yet. Instead, it gives sign-language experts, accessibility reviewers, and builders a concrete interface to evaluate matching quality, missing expressions, and the overall translation flow.

## Live Demo

Production app: [https://handsigns.vercel.app](https://handsigns.vercel.app)

## MVP Goal

The first version focuses on:

- Taking a Korean sentence from the user.
- Using Gemini to parse the sentence into meaning-centered KSL dictionary tokens.
- Searching sign-language data connected to the National Institute of Korean Language KSL Dictionary.
- Prioritizing results that include playable video URLs.
- Automatically playing the resulting sign sequence.
- Making mismatches visible so experts can review and suggest improvements.

This is currently a **text-to-sign-video** prototype, not a camera-based sign recognition system.

## Data Sources

The app is prepared to search these public sign-language API categories:

- Daily Life Sign Language
- Technical Term Sign Language
- Culture Information Sign Language
- Integrated Sign Language

The returned media is normalized against the National Institute of Korean Language Korean Sign Language Dictionary (`sldict.korean.go.kr`). Dictionary media URLs are upgraded to HTTPS before reaching the browser.

## Architecture

```text
Browser UI
  - Korean text input
  - Video preview
  - Playback queue
  - Source labels

Node API Proxy
  - Uses Gemini as a semantic KSL parser
  - Keeps Gemini off the frontend
  - Searches each configured sign-language API source
  - Normalizes different API response shapes
  - Returns video-first candidates to the frontend

Public Sign API Sources
  - Daily life signs
  - Technical terms
  - Culture information signs
  - Integrated signs
```

## Local Setup

Requirements:

- Node.js 18 or newer
- A Gemini API key
- Public sign API service keys

Create a local environment file:

```bash
cp .env.example .env
```

Fill in the API keys:

```bash
GEMINI_API_KEY=
GEMINI_API_KEYS=
CULTURE_API_INTEGRATED_KEY=
CULTURE_API_LIFE_KEY=
CULTURE_API_SPECIALIZED_KEY=
CULTURE_API_CULTURE_KEY=
FEEDBACK_LOG_WEBHOOK_URL=
```

API endpoint defaults are already included in `server.js`, but they can be overridden in `.env` if needed.

Then run:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

If `GEMINI_API_KEY` / `GEMINI_API_KEYS` is missing, invalid, or quota-limited, the app stops translation and returns an unavailable state instead of falling back to basic splitting. This keeps the MVP from showing misleading sign results when semantic parsing is unavailable. If sign API keys are missing, the app runs in preview mode without real media.

`GEMINI_API_KEYS` can contain multiple Gemini keys separated by commas. The server rotates through them and falls back to the next key when a key is quota-limited or invalid. `GEMINI_API_KEY` is still supported for single-key setups.

Set `FEEDBACK_LOG_WEBHOOK_URL` to a Google Apps Script Web App URL to save each successful translation as a lightweight feedback row. The app sends only the original text and the parsed KSL tokens.

Gemini calls are protected in two ways:

- Repeated requests for the same normalized sentence are served from an in-memory plan cache.
- New Gemini planning calls are limited to 15 requests per minute per running server instance. When the limit is reached, the app shows a temporary rate-limit message before spending more tokens.

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

Returns the Gemini semantic KSL plan or fallback search plan plus normalized sign candidates for each term. If the Gemini-planned terms return no results, the server and frontend both retry with the original sentence as a direct dictionary search.

## Vercel Deployment

This project is configured for Vercel with `vercel.json`. Vercel serves the frontend and the Node API from the same deployment URL, so `public/config.js` can keep:

```js
window.HANDSIGNS_API_BASE_URL = "";
```

Create a Vercel project from the GitHub repository or deploy with the Vercel CLI, then add these Production environment variables:

```bash
GEMINI_API_KEY=
GEMINI_API_KEYS=
CULTURE_API_INTEGRATED_KEY=
CULTURE_API_LIFE_KEY=
CULTURE_API_SPECIALIZED_KEY=
CULTURE_API_CULTURE_KEY=
FEEDBACK_LOG_WEBHOOK_URL=
```

Vercel should use the default install command and the `vercel-build` script. The app runs through `server.js`, which exports a Vercel-compatible handler and still supports local development with `npm run dev`.

General users do not need `.env` files or API keys. They open the deployed Vercel URL, and the backend is the only place that talks to Gemini and the public sign APIs.

The sign API service keys are public-service keys for this MVP and can be stored as non-sensitive Vercel variables. The Gemini key must remain private because it can incur quota/cost and should only live in local or hosted backend environment variables.

`.vercelignore` excludes local `.env` files and Vercel project metadata from CLI deployments.

## Expert Feedback Needed

This MVP is meant to support conversations with sign-language experts. Useful feedback includes:

- Whether word-level matching is acceptable for the target use case.
- Which expressions require phrase-level or sentence-level interpretation.
- Whether selected videos are semantically appropriate.
- Which API source should be preferred for ambiguous terms.
- How to handle missing terms, synonyms, honorifics, facial expressions, spacing, and context.
- What metadata should be shown to users for trust and review.

## Current Limitations

- Gemini parsing depends on API quota and availability.
- It does not generate new sign-language video.
- It does not recognize sign language from camera input.
- Word-by-word matching may produce unnatural or incorrect sign sequences.
- Browser autoplay policies may require muted playback for fully automatic sequence playback.
- API field mapping may need adjustment if upstream public API response shapes change.

## Roadmap

- Improve semantic token validation against the KSL dictionary.
- Add stronger phrase-level matching before falling back to word-level search.
- Add expert review notes for each matched sign.
- Add source ranking rules.
- Add a missing-term workflow.
- Add a reviewer workflow for sign-language experts and Deaf users.

## Repository

GitHub: https://github.com/oops-lobster/HANDSIGNS
