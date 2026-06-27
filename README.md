# HANDSIGNS

Korean text to sign-language content MVP.

This first version takes Korean text, splits it into searchable terms, calls a backend proxy for Culture Portal sign-language APIs, and displays matching sign videos in order.

## Why This Shape

- The Culture Portal API key stays on the server.
- The frontend can translate full sentences by searching each term across multiple sign API sources.
- API parameter names are configurable from `.env` while the exact API contract is finalized.
- No third-party dependencies are required for the MVP.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in `CULTURE_API_KEY` and one or more API URLs.
3. Run:

```bash
npm run dev
```

4. Open `http://localhost:3000`.

## API

### `GET /api/signs/search?q=안녕하세요`

Searches one word or phrase.

### `POST /api/signs/translate`

Body:

```json
{
  "text": "안녕하세요 감사합니다"
}
```

Returns normalized entries for each searched term.

## Culture Portal Sources

Set whichever sources are available in `.env`:

```bash
CULTURE_API_LIFE_URL=
CULTURE_API_SPECIALIZED_URL=
CULTURE_API_CULTURE_URL=
CULTURE_API_INTEGRATED_URL=
CULTURE_API_KEY=
```

The MVP searches all configured sources and prefers entries with video URLs in the playback queue.

## GitHub Pages

`.github/workflows/pages.yml` publishes the static app in `public/` to GitHub Pages.

GitHub Pages cannot keep API keys secret or run the Node proxy. For the deployed Pages app, host `server.js` separately and set:

```js
window.HANDSIGNS_API_BASE_URL = "https://your-api.example.com";
```

in `public/config.js` before deploying that environment. Keep it empty for local same-origin development.
