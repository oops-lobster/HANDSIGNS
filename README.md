# HANDSIGNS

Korean text to sign-language content MVP.

This first version takes Korean text, splits it into searchable terms, calls a backend proxy for the Culture Portal sign-language API, and displays matching sign entries in order.

## Why This Shape

- The Culture Portal API key stays on the server.
- The frontend can translate full sentences by searching each term.
- API parameter names are configurable from `.env` while the exact API contract is finalized.
- No third-party dependencies are required for the MVP.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in `CULTURE_API_BASE_URL` and `CULTURE_API_KEY`.
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
