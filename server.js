import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";

const rootDir = process.cwd();
const publicDir = join(rootDir, "public");

await loadEnv(join(rootDir, ".env"));

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const geminiRateLimitWindowMs = 60_000;
const geminiRateLimitMaxRequests = Number(process.env.GEMINI_RATE_LIMIT_PER_MINUTE || 15);
const geminiPlanCacheTtlMs = Number(process.env.GEMINI_PLAN_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const geminiRequestWindow = globalThis.__handsignsGeminiRequestWindow || [];
const geminiPlanCache = globalThis.__handsignsGeminiPlanCache || new Map();
globalThis.__handsignsGeminiKeyCursor = globalThis.__handsignsGeminiKeyCursor || 0;
globalThis.__handsignsGeminiRequestWindow = geminiRequestWindow;
globalThis.__handsignsGeminiPlanCache = geminiPlanCache;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4"
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
    id: "integrated",
    name: "통합 수어",
    keyEnv: "CULTURE_API_INTEGRATED_KEY",
    env: "CULTURE_API_INTEGRATED_URL",
    defaultUrl: "https://api.kcisa.kr/API_CNV_054/request"
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
  }
];

const sourcePriority = {
  life: 0,
  integrated: 1,
  specialized: 2,
  culture: 3
};

const blockedKslTerms = new Set([
  "씨발",
  "시발",
  "ㅅㅂ",
  "존나",
  "개새끼",
  "병신",
  "좆",
  "ㅈ같다",
  "좆같다"
]);

const kslPreprocessPrompt = `# Role
당신은 일반 한국어 문장을 국립국어원 한국수어사전(sldict.korean.go.kr)에 등록된 표준 단어들의 조합으로 변환하는 '최첨단 수어 의미 번역 및 토큰화 API'입니다. 후속 시스템은 문맥 파악 능력이 전혀 없으므로, 당신이 이 단계에서 완벽한 독해와 자모 분해를 끝내야 합니다.

# Philosophy & Core Objective
이 프롬프트의 최우선 목적은 수어사전의 단어들을 조합하여, '농인(수어 사용자)에게 왜곡 없이 정확한 의미를 전달하는 것'입니다. 한국어 문법이나 조사에 얽매이지 말고, 농인이 직관적으로 상황과 영상 이미지를 이해할 수 있도록 수어의 시각적·공간적 흐름에 맞춰 단어를 분해하고 재조합하세요.
사용자 입력에 오타가 있어도 오타를 그대로 지문자로 쪼개지 말고, 앞뒤 문맥으로 의도한 단어를 먼저 교정한 뒤 수어사전 표제어로 정규화하세요.

# Output Format Specification
- Respond ONLY with a valid JSON object. Do NOT include markdown code blocks or any additional conversational text.
{
  "status": "success",
  "original_text": "string",
  "ksl_syntax_order": ["string", "string", ...],
  "facial_expression_token": "SURPRISE" | "QUESTION" | "QUESTION_WHY" | "NEGATION" | "ANGRY" | "NEUTRAL"
}

# Core Translation & Tokenization Rules

1. 수어사전 표준 표제어 기반 분해 (Exact Dictionary Matching)
   - 출력되는 모든 단어는 한국수어사전에 존재하는 표준어 형태여야 뒤쪽 시스템에서 모션 매핑이 가능합니다.
   - 한국어의 복잡한 문장 표현(어미, 접사)을 수어사전에 존재하는 가장 직관적인 핵심 개념 단어(기본형)로 환원하세요.
   - 조사와 문법적 어미는 전면 제거하고, 명사 원형과 용언의 가장 단순한 기본형만 남기세요.
   - 파생어 및 구어체 표현은 사전에 존재할 확률이 높은 원초적 단어로 치환하세요. 예: "노래하다" -> "노래", "좋아하다/조아하다" -> "좋다".
   - 수어사전에 없을 가능성이 높은 신조어, 속어, 과장 표현, 비속어는 그대로 출력하지 마세요. 문맥상 의미가 분명하면 사전에 있을 법한 중립 표제어로 순화하고, 의미가 불명확하면 과감히 제거하세요.
   - 예: "개쩐다", "쩐다", "미쳤다(감탄)" -> "대단하다" 또는 "놀라다" 또는 "좋다" 중 문맥에 맞는 단어.
   - 욕설/비속어("씨발", "시발", "ㅅㅂ", "존나" 등)는 의미를 해치지 않는 선에서 제거하세요. 문장의 핵심 감정만 SURPRISE, ANGRY 등 facial_expression_token에 반영하고, 대체할 표준 표제어가 없으면 ksl_syntax_order에 넣지 마세요.
   - 예: 의미 없는 감탄/추임새("ㅋㅋ", "ㅎㅎ", "헐" 단독, "아")는 제거하거나 facial_expression_token으로만 반영하세요.
   - 예: "마르셨네요" -> 수건이 건조되는 상황이므로 수어사전 표제어인 "마르다(건조)" 추출.

2. 오타 자동 교정 및 농인 중심의 문맥 판별
   - 사용자가 문장에 오타를 입력하더라도 앞뒤 문맥을 파악하여 원래 의도한 올바른 단어로 자동 교정한 뒤 형태소를 분석하세요.
   - 예: "평등혜야하는건" -> "평등해야 하는 건" -> "평등"
   - 예: "노래를 조아합니다" -> "노래를 좋아합니다" -> "노래", "좋다"
   - 농인이 수어 모션을 보았을 때 엉뚱한 뜻으로 오해하지 않도록 문맥을 완벽히 파악하여 괄호 안에 의미 구분을 명시하세요.
   - 예: "차가 막히다" -> "차(자동차)", "막히다(정체)" / "차가 차갑다" -> "차(음료)", "차갑다"
   - 예: "살이 마르다" -> "마르다(체격)" / "빨래가 마르다" -> "마르다(건조)"

3. 구어체 미사여구 제거 및 시각적 재배치 (수어 어순)
   - 의미 전달을 방해하거나 수어 단어가 없는 감탄사, 사물 존칭("어머", "아이고", "~시~")은 과감히 제거합니다.
   - 수어의 의미 전달 효율을 극대화하기 위해 [시간] -> [장소] -> [주어] -> [목적어] -> [동사/형용사] 순으로 단어를 배치합니다.
   - 부정어("안", "못", "아니다")와 의문사("왜", "무엇", "어디")는 농인이 결론을 확실히 인지할 수 있도록 항상 문장의 맨 뒤로 보냅니다.

4. 고유명사 및 인명 자문자 자모 분해 규칙 (Fingerspelling Phoneme Rule)
   - [가장 중요] 한국수어사전에 없는 인명(사람 이름), 브랜드명 등은 절대 단어나 글자 단위로 묶지 말고, '초성, 중성, 종성(자음과 모음)' 단위로 완전히 해체해야 합니다.
   - 분해된 모든 자음과 모음 토큰 앞에는 "FS_" 접두어를 붙이세요. (쌍자음/쌍모음은 그대로 유지)
   - 예시 (전민성):
     - '전' -> ㅈ, ㅓ, ㄴ -> "FS_ㅈ", "FS_ㅓ", "FS_ㄴ"
     - '민' -> ㅁ, ㅣ, ㄴ -> "FS_ㅁ", "FS_ㅣ", "FS_ㄴ"
     - '성' -> ㅅ, ㅓ, ㅇ -> "FS_ㅅ", "FS_ㅓ", "FS_ㅇ"

5. Non-Manual Signals (비수지 신호/표정 토큰화)
   - 문맥에서 느껴지는 핵심 감정이나 의문/부정 등의 어조를 파악하여 facial_expression_token 필드에 상수로 출력하세요.

# Examples for Contextual Sign Language Delivery

Input: "어머 오늘 수건이 덜 마르셨네요!"
Output:
{
  "status": "success",
  "original_text": "어머 오늘 수건이 덜 마르셨네요!",
  "ksl_syntax_order": ["오늘", "수건", "덜", "마르다(건조)"],
  "facial_expression_token": "SURPRISE"
}

Input: "내 이름은 전민성입니다."
Output:
{
  "status": "success",
  "original_text": "내 이름은 전민성입니다.",
  "ksl_syntax_order": ["나", "이름", "FS_ㅈ", "FS_ㅓ", "FS_ㄴ", "FS_ㅁ", "FS_ㅣ", "FS_ㄴ", "FS_ㅅ", "FS_ㅓ", "FS_ㅇ"],
  "facial_expression_token": "NEUTRAL"
}

Input: "나는 노래를 조아합니다."
Output:
{
  "status": "success",
  "original_text": "나는 노래를 조아합니다.",
  "ksl_syntax_order": ["나", "노래", "좋다"],
  "facial_expression_token": "NEUTRAL"
}

Input: "교육기술의 혜택이 평등혜야하는건 아니야."
Output:
{
  "status": "success",
  "original_text": "교육기술의 혜택이 평등혜야하는건 아니야.",
  "ksl_syntax_order": ["교육", "기술", "혜택", "평등", "아니다"],
  "facial_expression_token": "NEGATION"
}

Input: "와 이 노래 개쩐다."
Output:
{
  "status": "success",
  "original_text": "와 이 노래 개쩐다.",
  "ksl_syntax_order": ["노래", "좋다"],
  "facial_expression_token": "SURPRISE"
}

Input: "씨발 너무 아파."
Output:
{
  "status": "success",
  "original_text": "씨발 너무 아파.",
  "ksl_syntax_order": ["많이", "아프다"],
  "facial_expression_token": "ANGRY"
}

Input: "너 왜 그렇게 말랐어? 밥 안 먹었어?"
Output:
{
  "status": "success",
  "original_text": "너 왜 그렇게 말랐어? 밥 안 먹었어?",
  "ksl_syntax_order": ["너", "마르다(체격)", "QUESTION_WHY", "밥", "먹다", "안"],
  "facial_expression_token": "QUESTION"
}

# Input Text
Analyze and parse the following text strictly adhering to the rules above:`;

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

function checkGeminiRateLimit(now = Date.now()) {
  if (geminiRateLimitMaxRequests <= 0) {
    return {
      allowed: false,
      limit: geminiRateLimitMaxRequests,
      retryAfterSeconds: Math.ceil(geminiRateLimitWindowMs / 1000)
    };
  }

  while (geminiRequestWindow.length && geminiRequestWindow[0] <= now - geminiRateLimitWindowMs) {
    geminiRequestWindow.shift();
  }

  if (geminiRequestWindow.length >= geminiRateLimitMaxRequests) {
    const retryAfterMs = geminiRateLimitWindowMs - (now - geminiRequestWindow[0]);
    return {
      allowed: false,
      limit: geminiRateLimitMaxRequests,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000))
    };
  }

  geminiRequestWindow.push(now);
  return {
    allowed: true,
    limit: geminiRateLimitMaxRequests,
    retryAfterSeconds: 0
  };
}

function normalizeSearchText(text) {
  return String(text || "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingParticle(word) {
  const particles = [
    "으로부터", "에서부터", "에게서", "으로써", "으로서",
    "부터", "까지", "에게", "에서", "으로", "처럼", "보다", "하고",
    "은", "는", "이", "가", "을", "를", "에", "의", "도", "만", "와", "과", "로", "랑"
  ];

  for (const particle of particles) {
    if (!word.endsWith(particle) || word.length <= particle.length) continue;
    const stem = word.slice(0, -particle.length);
    if (stem.length >= 1) return stem;
  }

  return word;
}

function dictionaryTermVariants(term) {
  const normalized = normalizeSearchText(term);
  const variants = [];

  const add = value => {
    const normalizedValue = normalizeSearchText(value);
    if (normalizedValue && !variants.includes(normalizedValue)) variants.push(normalizedValue);
  };

  if (normalized === "좋아하다" || normalized === "조아하다") {
    add("좋다");
  }

  const slangMap = new Map([
    ["개쩐다", "좋다"],
    ["쩐다", "좋다"],
    ["개좋다", "좋다"],
    ["짱좋다", "좋다"],
    ["미쳤다", "대단하다"],
    ["대박", "대단하다"]
  ]);
  if (slangMap.has(normalized)) {
    add(slangMap.get(normalized));
  }

  if (normalized.endsWith("좋아하다") || normalized.endsWith("조아하다")) {
    add("좋다");
  }

  if (normalized.endsWith("하다") && normalized.length > 2) {
    const stem = normalized.slice(0, -2);
    if (stem === "좋아" || stem === "조아") {
      add("좋다");
    } else {
      add(stem);
    }
  }

  add(normalized);
  return variants;
}

function buildSearchTerms(text) {
  const normalized = normalizeSearchText(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  const terms = [];

  if (normalized) terms.push({ term: normalized, type: "phrase" });
  for (const word of words) {
    const stripped = stripTrailingParticle(word);
    if (stripped && stripped !== word) {
      terms.push({ term: stripped, type: "word" });
      continue;
    }
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

function geminiUnavailablePlan(text, message, reason = "unavailable", extra = {}) {
  return {
    source: "gemini_unavailable",
    reason,
    terms: [],
    originalText: normalizeSearchText(text),
    error: message,
    ...extra
  };
}

function getCachedGeminiPlan(cacheKey) {
  const cached = geminiPlanCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > geminiPlanCacheTtlMs) {
    geminiPlanCache.delete(cacheKey);
    return null;
  }
  return {
    ...cached.plan,
    cached: true
  };
}

function setCachedGeminiPlan(cacheKey, plan) {
  geminiPlanCache.set(cacheKey, {
    createdAt: Date.now(),
    plan
  });
}

function getGeminiApiKeys() {
  const keys = [
    ...String(process.env.GEMINI_API_KEYS || "").split(/[\s,]+/),
    process.env.GEMINI_API_KEY
  ]
    .map(key => String(key || "").trim())
    .filter(Boolean);

  return [...new Set(keys)];
}

function getRotatedGeminiApiKeys(keys) {
  if (!keys.length) return [];
  const start = globalThis.__handsignsGeminiKeyCursor % keys.length;
  globalThis.__handsignsGeminiKeyCursor = (globalThis.__handsignsGeminiKeyCursor + 1) % keys.length;
  return [...keys.slice(start), ...keys.slice(0, start)];
}

function geminiUnavailableReason(message) {
  const normalized = String(message || "").toLowerCase();
  if (normalized.includes("429") || normalized.includes("quota") || normalized.includes("rate-limit") || normalized.includes("rate limit")) {
    return "quota_exhausted";
  }
  if (normalized.includes("api key") || normalized.includes("permission") || normalized.includes("unauthenticated")) {
    return "key_invalid";
  }
  return "unavailable";
}

function termsFromKslPlan(parsed, originalText) {
  const nonLexicalTokens = new Set(["SURPRISE", "QUESTION", "QUESTION_WHY", "NEGATION", "ANGRY", "NEUTRAL"]);
  const order = Array.isArray(parsed?.ksl_syntax_order) ? parsed.ksl_syntax_order : [];
  const orderedTerms = order
    .filter(token => typeof token === "string")
    .map(token => token.trim())
    .filter(Boolean);
  const apiSearchTerms = orderedTerms
    .map(token => token.startsWith("FS_") ? token.slice(3) : token)
    .filter(token => !nonLexicalTokens.has(token))
    .map(token => normalizeSearchText(token))
    .filter(token => !blockedKslTerms.has(token))
    .filter(Boolean);
  const kslSearchItems = apiSearchTerms.flatMap(term => {
    const terms = dictionaryTermVariants(term);
    return terms.flatMap((variant, index) => {
      const parts = variant.split(/\s+/).filter(part => part && part !== variant);
      return [
        { term: variant, type: index === 0 ? "ksl" : "ksl_variant" },
        ...parts.map(part => ({ term: part, type: "ksl_part" }))
      ];
    });
  });

  const merged = kslSearchItems;

  const seen = new Set();
  return merged.filter(item => {
    if (!item.term) return false;
    if (item.type === "ksl" || item.type === "ksl_part" || item.type === "ksl_variant") {
      seen.add(item.term);
      return true;
    }
    if (seen.has(item.term)) return false;
    seen.add(item.term);
    return true;
  }).slice(0, 32);
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
  const apiKeys = getGeminiApiKeys();
  if (!apiKeys.length) return geminiUnavailablePlan(text, "Gemini API key is not configured.", "key_missing");

  const normalized = normalizeSearchText(text);
  if (!normalized) return fallbackPlan(text);

  try {
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const cacheKey = `${model}:${normalized}`;
    const cachedPlan = getCachedGeminiPlan(cacheKey);
    if (cachedPlan) return cachedPlan;

    const rateLimit = checkGeminiRateLimit();
    if (!rateLimit.allowed) {
      return geminiUnavailablePlan(
        text,
        `Gemini local rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds} seconds.`,
        "rate_limited",
        rateLimit
      );
    }

    let lastError = null;
    for (const apiKey of getRotatedGeminiApiKeys(apiKeys)) {
      try {
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
        if (!normalizedTerms.length) {
          throw new Error("Gemini did not return searchable KSL tokens.");
        }

        const plan = {
          source: "gemini",
          model,
          ksl: parsed,
          terms: normalizedTerms
        };
        setCachedGeminiPlan(cacheKey, plan);
        return plan;
      } catch (error) {
        lastError = error;
        const reason = geminiUnavailableReason(error.message);
        if (reason !== "quota_exhausted" && reason !== "key_invalid") break;
      }
    }

    throw lastError || new Error("Gemini planning failed.");
  } catch (error) {
    return geminiUnavailablePlan(text, error.message, geminiUnavailableReason(error.message));
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

function upgradeSldictUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(value);
    if (url.protocol === "http:" && url.hostname === "sldict.korean.go.kr") {
      url.protocol = "https:";
      return url.href;
    }
    return value;
  } catch {
    return value;
  }
}

function mediaUrlForClient(value) {
  if (!value) return "";

  try {
    const url = new URL(upgradeSldictUrl(value));
    if (!["http:", "https:"].includes(url.protocol)) return value;

    if (url.hostname === "sldict.korean.go.kr") {
      return url.href;
    }

    return `/api/media/video?url=${encodeURIComponent(url.href)}`;
  } catch {
    return value;
  }
}

function normalizeEntry(entry, searchedTerm, source) {
  const resourceUrl = getFirstValue(entry, ["url", "resourceUrl", "referenceUrl", "identifier"]);
  const mediaUrl = getFirstValue(entry, ["subDescription"]);
  const explicitVideoUrl = getFirstValue(entry, ["videoUrl", "vodUrl", "movieUrl", "mp4Url", "signVideoUrl", "signVideo", "video", "mvurl", "fileUrl"]);
  const explicitImageUrl = getFirstValue(entry, ["imageUrl", "imgUrl", "thumbnail", "thumbUrl", "signImageUrl", "image", "imageObject", "posterUrl", "referenceIdentifier"]);
  const signImageUrl = firstCsvUrl(getFirstValue(entry, ["signImages"]));
  const imageUrl = upgradeSldictUrl(explicitImageUrl || signImageUrl || (isImageUrl(mediaUrl) ? mediaUrl : "") || (isImageUrl(resourceUrl) ? resourceUrl : ""));
  const rawVideoUrl = upgradeSldictUrl(explicitVideoUrl || (isVideoUrl(mediaUrl) ? mediaUrl : "") || (isVideoUrl(resourceUrl) ? resourceUrl : ""));

  return {
    searchedTerm,
    sourceId: source.id,
    sourceName: source.name,
    title: getFirstValue(entry, ["title", "word", "name", "signWord", "korName", "term", "subject", "krwd"]) || searchedTerm,
    description: getFirstValue(entry, ["signDescription", "description", "desc", "contents", "content", "meaning", "explanation", "sense", "dc", "subDescription"]),
    videoUrl: mediaUrlForClient(rawVideoUrl),
    rawVideoUrl,
    imageUrl,
    resourceUrl,
    hasMedia: Boolean(rawVideoUrl || imageUrl),
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
  const requestedPageSize = Number(process.env.CULTURE_API_PAGE_SIZE || "20");
  const pageSize = String(Math.max(Number.isFinite(requestedPageSize) ? requestedPageSize : 20, 20));
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

function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function searchOneSourceWithRetry(source, query) {
  try {
    return await searchOneSource(source, query);
  } catch (firstError) {
    if (firstError.status === 401) throw firstError;
    await wait(250);
    return searchOneSource(source, query);
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

function compactSearchText(text) {
  return normalizeSearchText(text).replace(/\s+/g, "");
}

function sourceRank(entry) {
  return sourcePriority[entry?.sourceId] ?? 99;
}

function mediaScore(entry) {
  return Number(Boolean(entry.videoUrl)) * 3 +
    Number(Boolean(entry.imageUrl)) * 2 +
    Number(Boolean(entry.resourceUrl));
}

function titleParts(title) {
  return String(title || "")
    .split(/[,/|·ㆍ]/)
    .map(part => compactSearchText(part))
    .filter(Boolean);
}

function relevanceScore(entry, query) {
  const term = compactSearchText(query);
  const title = compactSearchText(entry.title);
  const parts = titleParts(entry.title);
  if (!term || !title) return 0;
  if (title === term) return 100;
  if (parts.includes(term)) return 90;
  if (title.startsWith(term)) return 70;
  if (title.includes(term)) return 45;
  if (parts.some(part => term.includes(part))) return 25;
  return 0;
}

function isSingleHangulSyllable(query) {
  return /^[가-힣]$/.test(compactSearchText(query));
}

function filterEntriesForQuery(entries, query) {
  if (!isSingleHangulSyllable(query)) return entries;
  const term = compactSearchText(query);
  return entries.filter(entry =>
    compactSearchText(entry.title) === term || titleParts(entry.title).includes(term)
  );
}

function sortEntries(entries, query) {
  return [...entries].sort((a, b) =>
    sourceRank(a) - sourceRank(b) ||
    relevanceScore(b, query) - relevanceScore(a, query) ||
    mediaScore(b) - mediaScore(a) ||
    String(a.title || "").localeCompare(String(b.title || ""), "ko")
  );
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
    sources.map(source => searchOneSourceWithRetry(source, query)
      .then(entries => ({ source, entries, error: null }))
      .catch(error => ({ source, entries: [], error })))
  );
  const authErrors = settled.filter(result => result.error?.status === 401);
  const otherErrors = settled.filter(result => result.error && result.error.status !== 401);
  const entries = sortEntries(filterEntriesForQuery(dedupeEntries(settled.flatMap(result => result.entries)), query), query);

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

function getKslTokensForFeedback(plan) {
  const kslOrder = Array.isArray(plan?.ksl?.ksl_syntax_order) ? plan.ksl.ksl_syntax_order : [];
  if (kslOrder.length) return kslOrder;
  return Array.isArray(plan?.terms) ? plan.terms.map(item => item.term).filter(Boolean) : [];
}

function buildFeedbackLogPayload(originalText, plan) {
  return {
    originalText,
    kslTokens: getKslTokensForFeedback(plan)
  };
}

function sendFeedbackLog(payload) {
  const webhookUrl = process.env.FEEDBACK_LOG_WEBHOOK_URL;
  if (!webhookUrl) return;

  fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(async response => {
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.includes("application/json")) {
        throw new Error(`Feedback log webhook returned ${response.status || "non-json"}`);
      }
    })
    .catch(error => {
      console.warn("Feedback log webhook failed", error.message);
    });
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/api/media/video") {
      await streamVideo(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/signs/search") {
      const query = url.searchParams.get("q")?.trim();
      if (!query) return sendJson(res, 400, { error: "Missing q query parameter." });
      return sendJson(res, 200, await searchCultureApis(query));
    }

    if (req.method === "POST" && url.pathname === "/api/signs/translate") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const originalText = normalizeSearchText(String(body.text || ""));
      const plan = await planSignTerms(originalText);
      if (plan.source === "gemini_unavailable") {
        const isQuotaExhausted = plan.reason === "quota_exhausted";
        const isRateLimited = plan.reason === "rate_limited";
        return sendJson(res, isQuotaExhausted || isRateLimited ? 429 : 503, {
          error: isRateLimited
            ? `요청이 너무 많습니다. ${plan.retryAfterSeconds || 60}초 뒤 다시 시도해 주세요.`
            : isQuotaExhausted
              ? "Gemini 사용량이 모두 소진되어 지금은 수어 변환을 진행할 수 없습니다."
              : "Gemini 분석을 사용할 수 없어 수어 변환을 진행할 수 없습니다.",
          reason: plan.reason,
          detail: plan.error,
          retryAfterSeconds: plan.retryAfterSeconds,
          planner: plan
        });
      }
      const searchItems = plan.terms;
      const terms = searchItems.map(item => item.term);
      if (!terms.length) return sendJson(res, 400, { error: "Missing text." });

      const results = [];
      for (const item of searchItems) {
        results.push({ term: item.term, type: item.type, ...(await searchCultureApis(item.term)) });
      }

      const hasEntries = results.some(result => result.entries?.length);
      if (!hasEntries && originalText && !terms.includes(originalText)) {
        results.push({ term: originalText, type: "direct", ...(await searchCultureApis(originalText)) });
        terms.push(originalText);
      } else if (!hasEntries && originalText) {
        const fallback = await searchCultureApis(originalText);
        const originalResult = results.find(result => result.term === originalText);
        if (originalResult && fallback.entries?.length) {
          originalResult.entries = fallback.entries;
          originalResult.warnings = fallback.warnings;
        }
      }

      sendFeedbackLog(buildFeedbackLogPayload(originalText, plan));

      return sendJson(res, 200, { terms, planner: plan, results });
    }

    return sendJson(res, 404, { error: "API route not found." });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

async function streamVideo(req, res, url) {
  const target = url.searchParams.get("url");
  if (!target) {
    sendJson(res, 400, { error: "Missing media url." });
    return;
  }

  let mediaUrl;
  try {
    mediaUrl = new URL(target);
  } catch {
    sendJson(res, 400, { error: "Invalid media url." });
    return;
  }

  if (!["http:", "https:"].includes(mediaUrl.protocol)) {
    sendJson(res, 400, { error: "Unsupported media url." });
    return;
  }

  const headers = {
    accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
    "user-agent": "HANDSIGNS-MVP/1.0"
  };

  if (req.headers.range) {
    headers.range = req.headers.range;
  }

  const response = await fetch(mediaUrl, { headers });

  if (!response.ok && response.status !== 206) {
    sendJson(res, response.status, { error: `Video request failed with ${response.status}.` });
    return;
  }

  const responseHeaders = {
    "content-type": response.headers.get("content-type") || "video/mp4",
    "cache-control": "public, max-age=3600",
    "accept-ranges": response.headers.get("accept-ranges") || "bytes"
  };

  for (const header of ["content-length", "content-range"]) {
    const value = response.headers.get(header);
    if (value) responseHeaders[header] = value;
  }

  res.writeHead(response.status, responseHeaders);

  if (!response.body) {
    res.end();
    return;
  }

  const stream = Readable.fromWeb(response.body);
  stream.on("error", () => {
    if (!res.destroyed) res.destroy();
  });
  stream.pipe(res);
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

export default async function handler(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }

  await serveStatic(req, res, url);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(handler).listen(port, host, () => {
    console.log(`HANDSIGNS is running at http://${host}:${port}`);
  });
}
