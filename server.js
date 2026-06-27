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
    env: "CULTURE_API_LIFE_URL",
    defaultUrl: "https://api.kcisa.kr/openapi/service/rest/meta13/getCTE01701"
  },
  {
    id: "specialized",
    name: "전문용어수어",
    env: "CULTURE_API_SPECIALIZED_URL",
    defaultUrl: "https://api.kcisa.kr/openapi/service/rest/meta13/getCTE01702"
  },
  {
    id: "culture",
    name: "문화정보수어",
    env: "CULTURE_API_CULTURE_URL",
    defaultUrl: "https://api.kcisa.kr/openapi/service/rest/meta13/getCTE01703"
  },
  {
    id: "integrated",
    name: "통합 수어",
    env: "CULTURE_API_INTEGRATED_URL",
    defaultUrl: "https://api.kcisa.kr/API_CNV_054/request"
  }
];

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
            text: [
              "You prepare Korean input for Korean Sign Language dictionary/API search.",
              "Return only compact JSON.",
              "Prefer common sign dictionary headwords and short phrases.",
              "Keep basic daily expressions such as 안녕하세요 and 반갑습니다 intact.",
              "Do not translate to English.",
              "Do not explain."
            ].join(" ")
          }]
        },
        contents: [{
          role: "user",
          parts: [{
            text: `Convert this Korean sentence into ordered Korean sign-language dictionary search terms.

Sentence: ${normalized}

Return this exact JSON shape:
{"terms":[{"term":"안녕하세요 반갑습니다","type":"phrase"},{"term":"안녕하세요","type":"word"},{"term":"반갑습니다","type":"word"}]}

Rules:
- The first term should be the full phrase when useful.
- Include each core daily sign expression separately after the phrase.
- Remove particles/endings only when that helps dictionary lookup.
- Maximum 8 terms.`
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
    const terms = Array.isArray(parsed?.terms) ? parsed.terms : [];
    const normalizedTerms = terms
      .map(item => ({
        term: normalizeSearchText(item.term),
        type: item.type === "phrase" ? "phrase" : "word"
      }))
      .filter(item => item.term);

    if (!normalizedTerms.length) return fallbackPlan(text);

    const fallbackTerms = fallbackPlan(text).terms;
    const merged = [...normalizedTerms, ...fallbackTerms];
    const seen = new Set();

    return {
      source: "gemini",
      model,
      terms: merged.filter(item => {
        if (seen.has(item.term)) return false;
        seen.add(item.term);
        return true;
      }).slice(0, 10)
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
  const explicitVideoUrl = getFirstValue(entry, ["videoUrl", "vodUrl", "movieUrl", "mp4Url", "signVideoUrl", "signVideo", "video", "mvurl", "fileUrl"]);
  const explicitImageUrl = getFirstValue(entry, ["imageUrl", "imgUrl", "thumbnail", "thumbUrl", "signImageUrl", "image", "posterUrl", "referenceIdentifier"]);
  const signImageUrl = firstCsvUrl(getFirstValue(entry, ["signImages"]));
  const imageUrl = explicitImageUrl || signImageUrl || (isImageUrl(resourceUrl) ? resourceUrl : "");
  const videoUrl = explicitVideoUrl || (isVideoUrl(resourceUrl) ? resourceUrl : "");

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

async function searchOneSource(source, query, apiKey) {
  const url = new URL(source.url);
  if (apiKey) {
    url.searchParams.set(process.env.CULTURE_API_KEY_PARAM || "serviceKey", apiKey);
  }
  url.searchParams.set(process.env.CULTURE_API_QUERY_PARAM || "keyword", query);

  const pageSizeParam = process.env.CULTURE_API_PAGE_SIZE_PARAM || "numOfRows";
  const pageSize = process.env.CULTURE_API_PAGE_SIZE || "5";
  if (pageSizeParam && pageSize) url.searchParams.set(pageSizeParam, pageSize);

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
    throw new Error(`${source.name} request failed with ${response.status}: ${text.slice(0, 300)}`);
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
  const apiKey = process.env.CULTURE_API_KEY;

  if (!sources.length || !apiKey) {
    return {
      configured: false,
      entries: makePreviewEntries(query)
    };
  }

  return {
    configured: true,
    sources: sources.map(({ id, name }) => ({ id, name })),
    entries: dedupeEntries((await Promise.all(
      sources.map(source => searchOneSource(source, query, apiKey).catch(error => [{
        searchedTerm: query,
        sourceId: source.id,
        sourceName: source.name,
        title: query,
        description: error.message,
        videoUrl: "",
        imageUrl: "",
        resourceUrl: "",
        hasMedia: false,
        raw: { error: error.message }
      }]))
    )).flat())
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
