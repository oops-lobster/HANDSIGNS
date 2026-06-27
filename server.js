import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const rootDir = process.cwd();
const publicDir = join(rootDir, "public");

await loadEnv(join(rootDir, ".env"));

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const defaultSources = [
  {
    id: "life",
    name: "일상생활수어",
    keyEnv: "CULTURE_API_LIFE_KEY",
    env: "CULTURE_API_LIFE_URL",
    defaultUrl: "https://api.kcisa.kr/openapi/service/rest/meta13/getCTE01701"
  },
  {
    id: "specialized",
    name: "전문용어수어",
    keyEnv: "CULTURE_API_SPECIALIZED_KEY",
    env: "CULTURE_API_SPECIALIZED_URL",
    defaultUrl: "https://api.kcisa.kr/openapi/service/rest/meta13/getCTE01702"
  },
  {
    id: "culture",
    name: "문화정보수어",
    keyEnv: "CULTURE_API_CULTURE_KEY",
    env: "CULTURE_API_CULTURE_URL",
    defaultUrl: "https://api.kcisa.kr/openapi/service/rest/meta13/getCTE01703"
  },
  {
    id: "integrated",
    name: "통합 수어",
    keyEnv: "CULTURE_API_INTEGRATED_KEY",
    env: "CULTURE_API_INTEGRATED_URL",
    defaultUrl: "https://api.kcisa.kr/API_CNV_054/request"
  }
];

const kslPreprocessPrompt = `# Role
You are a core NLP pre-processing API for a Sign Language Translation System. Your job is to tokenize Korean text into semantic sign language units, eliminate grammatical particles, adjust the syntax to Korean Sign Language (KSL) grammar, and identify fingerspelling (지문자).

# Output Format Specification
- You MUST respond ONLY with a valid JSON object.
- Do NOT include any markdown code blocks (e.g., \`\`\`json ... \`\`\`), conversational text, or explanations outside the JSON.
- JSON Structure:
{
  "status": "success" | "error",
  "error_message": "null if success, otherwise string",
  "original_text": "string",
  "ksl_tokens": ["string", "string", ...],
  "ksl_syntax_order": ["string", "string", ...],
  "meta": {
    "has_fingerspelling": true | false,
    "is_interrogative": true | false,
    "is_negative": true | false
  }
}

# Core Translation & Tokenization Rules

1. Particle & Ending Elimination (조사 및 어미 제거)
   - Strip all Korean particles (이/가, 을/를, 은/는, 에, 에서, 에게, 로/으로, 와/과 등).
   - Convert all verbs and adjectives to their dictionary/infinitive form (e.g., "먹었다", "먹고", "먹으니" -> "먹다").

2. KSL Syntax Ordering Rules (수어 어순 규칙)
   - Default Order: [Time/When] -> [Place/Where] -> [Subject/Who] -> [Object/What] -> [Verb/Adjective]
   - Negative Sentences: Move negative elements ("안", "못", "않다", "없다") to the absolute end of the sentence, immediately after the main verb. (e.g., "밥 안 먹어" -> ["밥", "먹다", "안"])
   - Interrogative Sentences (Questions): Place interrogative pronouns ("누구", "무엇", "어디", "언제", "왜", "어떻게") at the absolute end of the sentence. (e.g., "이름이 뭐야?" -> ["너", "이름", "무엇"])

3. Fingerspelling (지문자) Detection
   - Identify Proper Nouns (unregistered specific nouns like human names, specific brand names, new technical terms).
   - Wrap each character of a proper noun with "FS_". (e.g., "홍길동" -> "FS_홍", "FS_길", "FS_동")
   - Common nouns like "학교", "사과", "회사" must NOT be fingerspelled.

4. Pronoun Simplification
   - Convert honorifics or complex pronouns to basic KSL pronouns (e.g., "저희", "우리" -> "우리", "당신", "어머님(대칭)" -> "너" 또는 "그녀/그" 맥락 유지).

# Examples (Few-Shot for Deterministic Output)

Input: "김철수는 오늘 학교에 가지 않았습니다."
Output:
{
  "status": "success",
  "error_message": null,
  "original_text": "김철수는 오늘 학교에 가지 않았습니다.",
  "ksl_tokens": ["김철수", "오늘", "학교", "가다", "않다"],
  "ksl_syntax_order": ["오늘", "학교", "FS_김", "FS_철", "FS_수", "가다", "않다"],
  "meta": {
    "has_fingerspelling": true,
    "is_interrogative": false,
    "is_negative": true
  }
}

Input: "너 어제 어디에 있었어?"
Output:
{
  "status": "success",
  "error_message": null,
  "original_text": "너 어제 어디에 있었어?",
  "ksl_tokens": ["너", "어제", "어디", "있다"],
  "ksl_syntax_order": ["어제", "너", "있다", "어디"],
  "meta": {
    "has_fingerspelling": false,
    "is_interrogative": true,
    "is_negative": false
  }
}

# Input Text
Convert the following text strictly adhering to the rules above:`;

async function loadEnv(path) {
  try {
    const envFile = await readFile(path, "utf8");
    for (const line of envFile.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed
        .slice(separatorIndex + 1)
        .trim()
        .replace(/^["']|["']$/g, "");

      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // .env is optional so the preview mode can run immediately.
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function normalizeSearchText(text) {
  return String(text || "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchTerms(text) {
  const normalized = normalizeSearchText(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  const terms = [];

  if (normalized) terms.push({ term: normalized, type: "phrase" });
  for (const word of words) {
    if (word !== normalized) terms.push({ term: word, type: "word" });
  }

  const seen = new Set();
  return terms.filter(item => {
    if (seen.has(item.term)) return false;
    seen.add(item.term);
    return true;
  });
}

function fallbackPlan(text) {
  return {
    source: "fallback",
    terms: buildSearchTerms(text)
  };
}

function termsFromKslPlan(parsed, originalText) {
  const order = Array.isArray(parsed?.ksl_syntax_order) ? parsed.ksl_syntax_order : [];
  const tokens = Array.isArray(parsed?.ksl_tokens) ? parsed.ksl_tokens : [];
  const orderedTerms = order
    .filter(token => typeof token === "string")
    .map(token => token.trim())
    .filter(Boolean);
  const lexicalTerms = tokens
    .filter(token => typeof token === "string")
    .map(token => token.trim())
    .filter(Boolean);
  const apiSearchTerms = orderedTerms
    .filter(token => !token.startsWith("FS_"))
    .map(token => normalizeSearchText(token))
    .filter(Boolean);

  const merged = [
    ...apiSearchTerms.map(term => ({ term, type: "ksl" })),
    ...lexicalTerms.map(term => ({ term: normalizeSearchText(term), type: "word" })),
    ...buildSearchTerms(originalText)
  ];

  const seen = new Set();
  return merged.filter(item => {
    if (!item.term || seen.has(item.term)) return false;
    seen.add(item.term);
    return true;
  }).slice(0, 12);
}

function extractJson(text) {
  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function planSignTerms(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallbackPlan(text);

  const normalized = normalizeSearchText(text);
  if (!normalized) return fallbackPlan(text);

  try {
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: kslPreprocessPrompt
          }]
        },
        contents: [{
          role: "user",
          parts: [{
            text: normalized
          }]
        }],
        generationConfig: {
          temperature: 0.1
        }
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`Gemini planning failed with ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
    }

    const outputText = payload.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("\n");
    const parsed = extractJson(outputText);
    if (parsed?.status === "error") {
      throw new Error(parsed.error_message || "Gemini returned an error status.");
    }

    const normalizedTerms = termsFromKslPlan(parsed, text);
    if (!normalizedTerms.length) return fallbackPlan(text);

    return {
      source: "gemini",
      model,
      ksl: parsed,
      terms: normalizedTerms
    };
  } catch (error) {
    return {
      ...fallbackPlan(text),
      error: error.message
    };
  }
}

function getFirstValue(item, keys) {
  for (const key of keys) {
    if (item && item[key] !== undefined && item[key] !== null && String(item[key]).trim()) {
      return String(item[key]).trim();
    }
  }
  return "";
}

function collectEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const candidates = [
    payload.items,
    payload.item,
    payload.data,
    payload.result,
    payload.results,
    payload.response?.body?.items?.item,
    payload.response?.body?.items,
    payload.response?.body
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") {
      const nested = Object.values(candidate).find(value => Array.isArray(value));
      if (nested) return nested;
    }
  }

  const firstArray = Object.values(payload).find(value => Array.isArray(value));
  return firstArray || [];
}

function getConfiguredSources() {
  const legacyUrl = process.env.CULTURE_API_BASE_URL;
  return defaultSources
    .map(source => ({
      ...source,
      url: process.env[source.env] || (source.id === "integrated" ? legacyUrl : "") || source.defaultUrl
    }))
    .filter(source => source.url);
}

function decodeXml(value) {
  return String(value || "")
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();
}

function parseXmlItems(text) {
  const items = [];
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let itemMatch;

  while ((itemMatch = itemPattern.exec(text))) {
    const item = {};
    const fieldPattern = /<([A-Za-z0-9_.:-]+)\b[^>]*>([\s\S]*?)<\/\1>/g;
    let fieldMatch;

    while ((fieldMatch = fieldPattern.exec(itemMatch[1]))) {
      const key = fieldMatch[1].replace(/^.*:/, "");
      const value = decodeXml(fieldMatch[2].replace(/<[^>]+>/g, ""));
      if (value) item[key] = value;
    }

    if (Object.keys(item).length) items.push(item);
  }

  return items;
}

function parseApiPayload(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return collectEntries(JSON.parse(trimmed));
  }

  return parseXmlItems(trimmed);
}

function firstCsvUrl(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .find(Boolean) || "";
}

function isVideoUrl(value) {
  return /\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(value || "");
}

function isImageUrl(value) {
  return /\.(png|jpe?g|gif|webp|bmp)(\?|#|$)/i.test(value || "");
}

function normalizeEntry(entry, searchedTerm, source) {
  const resourceUrl = getFirstValue(entry, ["url", "resourceUrl", "referenceUrl", "identifier"]);
  const mediaUrl = getFirstValue(entry, ["subDescription"]);
  const explicitVideoUrl = getFirstValue(entry, ["videoUrl", "vodUrl", "movieUrl", "mp4Url", "signVideoUrl", "signVideo", "video", "mvurl", "fileUrl"]);
  const explicitImageUrl = getFirstValue(entry, ["imageUrl", "imgUrl", "thumbnail", "thumbUrl", "signImageUrl", "image", "imageObject", "posterUrl", "referenceIdentifier"]);
  const signImageUrl = firstCsvUrl(getFirstValue(entry, ["signImages"]));
  const imageUrl = explicitImageUrl || signImageUrl || (isImageUrl(mediaUrl) ? mediaUrl : "") || (isImageUrl(resourceUrl) ? resourceUrl : "");
  const videoUrl = explicitVideoUrl || (isVideoUrl(mediaUrl) ? mediaUrl : "") || (isVideoUrl(resourceUrl) ? resourceUrl : "");

  return {
    searchedTerm,
    sourceId: source.id,
    sourceName: source.name,
    title: getFirstValue(entry, ["title", "word", "name", "signWord", "korName", "term", "subject", "krwd"]) || searchedTerm,
    description: getFirstValue(entry, ["signDescription", "description", "desc", "contents", "content", "meaning", "explanation", "sense", "dc", "subDescription"]),
    videoUrl,
    imageUrl,
    resourceUrl,
    hasMedia: Boolean(videoUrl || imageUrl),
    raw: entry
  };
}

function makePreviewEntries(query) {
  return defaultSources.map(source => ({
    searchedTerm: query,
    sourceId: source.id,
    sourceName: source.name,
    title: query,
    description: `${source.name} API 키가 아직 설정되지 않았습니다. .env에 CULTURE_API_KEY를 입력하면 실제 문화포털 검색 결과가 표시됩니다.`,
    videoUrl: "",
    imageUrl: "",
    resourceUrl: "",
    hasMedia: false,
    raw: {}
  }));
}

function getSourceApiKey(source) {
  return process.env[source.keyEnv] || process.env.CULTURE_API_KEY || "";
}

async function searchOneSource(source, query) {
  const url = new URL(source.url);
  const apiKey = getSourceApiKey(source);
  if (apiKey) {
    url.searchParams.set(process.env.CULTURE_API_KEY_PARAM || "serviceKey", apiKey);
  }
  url.searchParams.set(process.env.CULTURE_API_QUERY_PARAM || "keyword", query);

  const pageSizeParam = process.env.CULTURE_API_PAGE_SIZE_PARAM || "numOfRows";
  const pageSize = process.env.CULTURE_API_PAGE_SIZE || "5";
  if (pageSizeParam && pageSize) url.searchParams.set(pageSizeParam, pageSize);

  const pageParam = process.env.CULTURE_API_PAGE_PARAM || "pageNo";
  const page = process.env.CULTURE_API_PAGE || "1";
  if (pageParam && page) url.searchParams.set(pageParam, page);

  if (source.id === "integrated" && !url.searchParams.has("collectionDb")) {
    url.searchParams.set("collectionDb", "");
  }

  const formatParam = process.env.CULTURE_API_FORMAT_PARAM || "format";
  const format = process.env.CULTURE_API_FORMAT || "";
  if (formatParam && format) url.searchParams.set(formatParam, format);

  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/xml;q=0.9, */*;q=0.8"
    }
  });

  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`${source.name} request failed with ${response.status}`);
    error.status = response.status;
    error.sourceName = source.name;
    error.body = text.slice(0, 300);
    throw error;
  }

  try {
    return parseApiPayload(text).map(entry => normalizeEntry(entry, query, source));
  } catch (error) {
    throw new Error(`${source.name} response could not be parsed: ${error.message}`);
  }
}

function dedupeEntries(entries) {
  const seen = new Set();
  return entries.filter(entry => {
    const key = [entry.sourceId, entry.title, entry.videoUrl, entry.imageUrl].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchCultureApis(query) {
  const sources = getConfiguredSources();

  if (!sources.length) {
    return {
      configured: false,
      entries: makePreviewEntries(query)
    };
  }

  const settled = await Promise.all(
    sources.map(source => searchOneSource(source, query)
      .then(entries => ({ source, entries, error: null }))
      .catch(error => ({ source, entries: [], error })))
  );
  const authErrors = settled.filter(result => result.error?.status === 401);
  const otherErrors = settled.filter(result => result.error && result.error.status !== 401);
  const entries = dedupeEntries(settled.flatMap(result => result.entries));

  return {
    configured: true,
    usesApiKey: sources.some(source => Boolean(getSourceApiKey(source))),
    authRequired: authErrors.length === sources.length,
    warnings: [
      ...(authErrors.length ? ["Culture Portal API serviceKey is required."] : []),
      ...otherErrors.map(result => `${result.source.name} search is temporarily unavailable.`)
    ],
    sources: sources.map(({ id, name }) => ({ id, name })),
    entries
  };
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/api/signs/search") {
      const query = url.searchParams.get("q")?.trim();
      if (!query) return sendJson(res, 400, { error: "Missing q query parameter." });
      return sendJson(res, 200, await searchCultureApis(query));
    }

    if (req.method === "POST" && url.pathname === "/api/signs/translate") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const plan = await planSignTerms(String(body.text || ""));
      const searchItems = plan.terms;
      const terms = searchItems.map(item => item.term);
      if (!terms.length) return sendJson(res, 400, { error: "Missing text." });

      const results = [];
      for (const item of searchItems) {
        results.push({ term: item.term, type: item.type, ...(await searchCultureApis(item.term)) });
      }

      return sendJson(res, 200, { terms, planner: plan, results });
    }

    return sendJson(res, 404, { error: "API route not found." });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

async function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(content);
  } catch {
    const fallback = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, {
      "content-type": mimeTypes[".html"],
      "cache-control": "no-store"
    });
    res.end(fallback);
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }

  await serveStatic(req, res, url);
}).listen(port, host, () => {
  console.log(`HANDSIGNS is running at http://${host}:${port}`);
});
