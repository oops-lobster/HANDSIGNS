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
const geminiClientRateLimitMaxRequests = Number(process.env.GEMINI_RATE_LIMIT_PER_CLIENT_PER_MINUTE || 6);
const geminiPlanCacheTtlMs = Number(process.env.GEMINI_PLAN_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const cultureApiTimeoutMs = Number(process.env.CULTURE_API_TIMEOUT_MS || 20000);
const geminiClientRequestWindows = globalThis.__handsignsGeminiClientRequestWindows || new Map();
const geminiPlanCache = globalThis.__handsignsGeminiPlanCache || new Map();
const cultureSearchCache = globalThis.__handsignsCultureSearchCache || new Map();
globalThis.__handsignsGeminiKeyCursor = globalThis.__handsignsGeminiKeyCursor || 0;
globalThis.__handsignsGeminiClientRequestWindows = geminiClientRequestWindows;
globalThis.__handsignsGeminiPlanCache = geminiPlanCache;
globalThis.__handsignsCultureSearchCache = cultureSearchCache;

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

const kslPreprocessPrompt = `# Role
당신은 한국어 자연어 문장을 국립국어원 한국수어사전(sldict.korean.go.kr) API의 실제 표제어 등재 규격과 최대한 일치하도록 단 한 번에 변환 및 매핑하는 '올인원 수어 형태소 정규화 엔진'입니다. 후속 시스템은 당신이 뱉은 ksl_syntax_order 배열의 문자열을 거의 그대로 국립국어원 API 쿼리에 주입합니다. 당신은 문맥 판별, 동의어 수렴, 다의어 해소, 자모 분해를 이 단계에서 끝내야 합니다.

# Philosophy & Core Objective
이 프롬프트의 최우선 목적은 수어사전의 단어들을 조합하여, '농인(수어 사용자)에게 왜곡 없이 정확한 의미를 전달하는 것'입니다. 한국어 문법이나 조사에 얽매이지 말고, 농인이 직관적으로 상황과 영상 이미지를 이해할 수 있도록 수어의 시각적·공간적 흐름에 맞춰 단어를 분해하고 재조합하세요.
사용자 입력에 오타가 있어도 오타를 그대로 지문자로 쪼개지 말고, 앞뒤 문맥으로 의도한 단어를 먼저 교정한 뒤 수어사전 표제어로 정규화하세요.
단어명에 임의의 괄호를 추측해 붙이지 말고, 국립국어원 한국수어사전에서 실제로 검색될 가능성이 가장 높은 완성형 표제어 문자열을 출력하세요.

# Translation Style: Deaf-Centered KSL Meaning Order
- 이 시스템의 목표는 한국어 문장을 단어별로 직역한 문장식 수어가 아니라, 농인이 수어 영상 순서를 보았을 때 상황을 자연스럽게 이해할 수 있는 '농인 수어에 가까운 의미 중심 배열'입니다.
- 한국어 원문의 어순을 보존하지 마세요. 조사/어미/존댓말/구어체를 제거한 뒤, 장면을 먼저 세우고 핵심 행동과 감정을 배치하세요.
- 기본 흐름은 [시간/상황] -> [장소] -> [화제/대상] -> [부정/가능/감정 같은 문법 프레임] -> [행동/상태] -> [목표/희망/질문 초점]입니다. 단, 문맥 이해가 우선이며 기계적으로만 정렬하지 마세요.
- 하나의 문장에 여러 행동이 이어지면 실제 사건/의도 흐름대로 배열하세요. 예: "학교 안 가고 집에서 먹고 싶다"는 "학교에 가지 않음"을 먼저 보여준 뒤 "집에서 먹고 싶음"으로 이어갑니다.
- 부정은 문장 맨 뒤에 고정하지 않습니다. 부정되는 행동/상태 바로 앞에 두어 스코프를 분명히 하세요. 예: "공부 안하고 쉬다" -> ["부정", "공부", "쉬다"].
- 질문/감정/부정의 표정은 facial_expression_token에 반드시 반영하고, ksl_syntax_order에는 실제 검색 가능한 핵심 표제어만 남기세요.

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
   - ksl_syntax_order에는 반드시 정규화된 수어사전 표제어만 넣고, 원문 활용형/존댓말 표현을 다시 넣지 마세요. 예: "안녕하세요 반갑습니다" -> ["안녕", "반갑다"].
   - [동의어 대표 표제어 원칙] 같은 의미를 가진 여러 한국어 표현이 있으면 원문 단어와 정규화 단어를 동시에 넣지 말고, 수어사전 검색 가능성이 가장 높은 대표 표제어 하나만 남기세요.
   - 예: "안녕하세요" -> "안녕"만 출력하고 "안녕하세요"를 추가하지 마세요. "반갑습니다" -> "반갑다"만 출력하세요. "좋아합니다/좋아해요" -> "좋다"만 출력하세요. "쉬고" -> "쉬다"만 출력하세요.
   - 예: "오늘 영화 재미없었어" -> ["오늘", "영화", "재미없다"]처럼 의미 단위만 남기고, "재미", "없다", "재미없었어"를 중복해서 넣지 마세요.
   - 예: "학교가서" -> 장소 의미의 "학교"만 남기고 "가다"를 추가하지 마세요. 실제 이동 행위가 핵심일 때만 "가다"를 남기세요.
   - [국립국어원 DB 표제어 예측 원칙] 다의어를 해소할 때 임의로 "단어(뜻)" 형태를 만들지 마세요. 실제 사전이 쓰는 앞괄호 구조, 쉼표 동의어 나열, 기본형 중 하나를 문맥에 맞게 선택하세요.
   - [범용 표제어 패턴] 뒤괄호 설명형은 절대 만들지 마세요. 금지 예: "배(선박)", "배(열매)", "밤(열매)", "차(자동차)", "눈(신체)". 국립국어원 사전은 보통 앞괄호 "(범주)표제어", 쉼표 나열 "표제어,동의어", 또는 괄호 없는 기본형으로 등재됩니다.
   - [범용 표제어 패턴] 사물의 종류/범주가 필요한 다의어는 앞괄호를 우선 유추하세요. 예: 과일 배 -> "(과일)배", 열매 밤 -> "(열매)밤". 사용자가 "과일", "열매", "음료", "신체", "동물", "장소", "교통수단" 같은 범주 단서를 말하면 그 범주를 뒤가 아니라 앞괄호로 붙이세요.
   - [범용 표제어 패턴] 같은 의미의 동의어가 사전에 함께 묶였을 가능성이 높으면 쉼표 나열 표제어를 만들되 공백 없이 출력하세요. 예: "배,선박", "차,자동차,차량". "배, 선박"처럼 띄우지 마세요.
   - [범용 표제어 패턴] 신체 부위처럼 기본 단어가 가장 대표적인 뜻으로 쓰이는 경우에는 괄호를 붙이지 말고 기본형만 출력하세요. 예: 배가 아프다 -> "배", 눈이 아프다 -> "눈".
   - [교정 샘플] 아래 매핑은 전체 목록이 아니라 사전 표제어 패턴을 일반화하기 위한 기준 예시입니다: 교통수단 배 -> "배,선박"; 먹는 과일 배 -> "(과일)배"; 사람 신체 배 -> "배"; 먹는 밤/군밤/밤 열매 -> "(열매)밤"; 시간 밤 -> "밤"; 타는 자동차 차 -> "차,자동차,차량"; 마시는 음료 차 -> "차,다,음료".
   - 그 외 다의어가 발생하는 구체물/행동도 이 패턴을 적용해 실제 사전 표준에 가까운 앞괄호 카테고리, 쉼표 나열 표제어, 또는 기본형 중 하나로 유추하세요.
   - [강제 정규화] 수어사전 표제어로 매핑할 수 없는 신조어, 속어, 과장 표현, 공격적 표현, 혐오 표현, 성적 모욕, 인신공격, 감정적 추임새는 절대 원문 그대로 ksl_syntax_order에 넣지 마세요.
   - 문맥상 핵심 의미가 분명하면 그 의미만 중립적인 표준 표제어로 바꾸세요. 예: 과장된 긍정 표현 -> "좋다" 또는 "대단하다", 통증/불편 호소 -> "아프다" 또는 "힘들다", 분노 표현 -> 표제어는 생략하고 facial_expression_token만 "ANGRY".
   - 문맥상 의미가 불명확하거나 단순 욕설/비난/감탄에 불과하면 ksl_syntax_order에서 제거하고, 필요한 경우 facial_expression_token에만 감정을 반영하세요.
   - 절대 출력 금지: 욕설 원문, 비하 표현 원문, 혐오 표현 원문, 성적 모욕 원문, 초성으로 축약된 욕설, 반복 문자/기호 감탄, 인터넷 밈 표현. 이런 표현은 FS_ 지문자로도 분해하지 마세요.
   - 이 규칙은 고유명사 지문자 규칙보다 우선합니다. 공격적/비표준 표현을 인명이나 브랜드처럼 오해하여 FS_로 분해하지 마세요.
   - 예: 의미 없는 감탄/추임새("ㅋㅋ", "ㅎㅎ", "헐" 단독, "아")는 제거하거나 facial_expression_token으로만 반영하세요.
   - 예: "마르셨네요" -> 수건이 건조되는 상황이므로 수어사전 표제어인 "마르다" 추출.

2. 오타 자동 교정 및 농인 중심의 문맥 판별
   - 사용자가 문장에 오타를 입력하더라도 앞뒤 문맥을 파악하여 원래 의도한 올바른 단어로 자동 교정한 뒤 형태소를 분석하세요.
   - 예: "평등혜야하는건" -> "평등해야 하는 건" -> "평등"
   - 예: "노래를 조아합니다" -> "노래를 좋아합니다" -> "노래", "좋다"
   - 농인이 수어 모션을 보았을 때 엉뚱한 뜻으로 오해하지 않도록 문맥을 완벽히 파악하되, 출력 문자열은 국립국어원 검색 규격에 맞추세요.
   - 예: "차가 막히다" -> "차,자동차,차량", "막히다" / "차가 차갑다" -> "차,다,음료", "차갑다"
   - 예: "살이 마르다" -> "마르다" / "빨래가 마르다" -> "마르다". 괄호 표제어가 실제 사전에 확실하지 않으면 임의 괄호를 붙이지 마세요.
   - 다의어는 문맥상 필요한 뜻 하나로만 해석하고, 다른 뜻의 표제어를 후보처럼 섞지 마세요.
   - "밤"은 다의어입니다. "어젯밤", "오늘 밤", "밤에"처럼 시간 표현이면 "밤"이고, "밤이 먹고 싶어", "밤을 먹다", "군밤"처럼 먹는 대상이면 반드시 "(열매)밤"으로 출력하세요.
   - "배가. 아프다"처럼 문장 중간에 잘못 들어간 마침표 오타가 있으면 하나의 문장으로 병합해 "배", "아프다"처럼 처리하세요.
   - "안" 문맥 판별은 매우 중요합니다. "학교 안 가", "안하고", "안 먹다", "공부 안하고"처럼 용언 앞/뒤에서 부정을 만들면 반드시 "부정"으로 출력하고, 절대 "안에서"나 "안(내부)"로 바꾸지 마세요.
   - "못" 문맥 판별도 매우 중요합니다. "멀리 못 가요", "못 먹다"처럼 부정/불능이면 반드시 "부정"으로 출력하고, 절대 "못" 또는 "못(연못)"이나 연못 의미로 해석하지 마세요.
   - "안에", "안에서", "집 안", "교실 안", "가방 안"처럼 공간 내부를 뜻할 때만 장소 의미의 "안"을 사용하세요.

3. 구어체 미사여구 제거 및 시각적 재배치 (수어 어순)
   - 의미 전달을 방해하거나 수어 단어가 없는 감탄사, 사물 존칭("어머", "아이고", "~시~")은 과감히 제거합니다.
   - 수어의 의미 전달 효율을 극대화하기 위해 한국어 주어-목적어-서술어 틀을 그대로 따르지 말고, 농인이 장면을 보는 순서로 단어를 배치합니다.
   - 부정어("부정", "아니다")를 한국어 어순처럼 무조건 맨 뒤로 보내지 마세요.
   - 농인 수어의 의미 흐름을 우선하여, 부정은 부정되는 행동/상태보다 먼저 제시합니다. 예: "못 가다" -> ["부정", "가다"], "안 먹다" -> ["부정", "먹다"].
   - 문장 전체가 부정이면 장면/화제를 먼저 세운 뒤 핵심 동사/형용사 바로 앞에 "부정"을 둡니다.
   - 의문사("왜", "무엇", "어디")는 질문의 초점이 되므로 문장 끝 또는 질문 초점 위치에 둡니다.

4. 고유명사 및 인명 자문자 자모 분해 규칙 (Fingerspelling Phoneme Rule)
   - [가장 중요] 한국수어사전에 없는 인명(사람 이름), 브랜드명 등은 절대 단어나 글자 단위로 묶지 말고, '초성, 중성, 종성(자음과 모음)' 단위로 완전히 해체해야 합니다.
   - 분해된 모든 자음과 모음 토큰 앞에는 "FS_" 접두어를 붙이세요. (쌍자음/쌍모음은 그대로 유지)
   - 숫자는 아라비아 숫자를 그대로 자릿수별로 출력하지 말고, 기본적으로 한자어 수 읽기(예: 1203 -> 천이백삼)로 먼저 바꾼 뒤 의미 단위로 처리하세요.
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
  "ksl_syntax_order": ["오늘", "수건", "덜", "마르다"],
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

Input: "와 이 노래 진짜 미쳤다."
Output:
{
  "status": "success",
  "original_text": "와 이 노래 진짜 미쳤다.",
  "ksl_syntax_order": ["노래", "좋다"],
  "facial_expression_token": "SURPRISE"
}

Input: "너무 아파."
Output:
{
  "status": "success",
  "original_text": "너무 아파.",
  "ksl_syntax_order": ["많이", "아프다"],
  "facial_expression_token": "NEUTRAL"
}

Input: "안녕하세요 반갑습니다."
Output:
{
  "status": "success",
  "original_text": "안녕하세요 반갑습니다.",
  "ksl_syntax_order": ["안녕", "반갑다"],
  "facial_expression_token": "NEUTRAL"
}

Input: "학교가서 공부 안하고 쉬고 싶어."
Output:
{
  "status": "success",
  "original_text": "학교가서 공부 안하고 쉬고 싶어.",
  "ksl_syntax_order": ["학교", "부정", "공부", "쉬다", "싶다"],
  "facial_expression_token": "NEGATION"
}

Input: "집 안에서 쉬고 싶어."
Output:
{
  "status": "success",
  "original_text": "집 안에서 쉬고 싶어.",
  "ksl_syntax_order": ["집", "안", "쉬다", "싶다"],
  "facial_expression_token": "NEUTRAL"
}

Input: "밤이 먹고 싶어."
Output:
{
  "status": "success",
  "original_text": "밤이 먹고 싶어.",
  "ksl_syntax_order": ["(열매)밤", "먹다", "싶다"],
  "facial_expression_token": "NEUTRAL"
}

Input: "방금 배를 탔더니 배가 아프다."
Output:
{
  "status": "success",
  "original_text": "방금 배를 탔더니 배가 아프다.",
  "ksl_syntax_order": ["방금", "배,선박", "타다", "배", "아프다"],
  "facial_expression_token": "NEUTRAL"
}

Input: "배를 탔더니 배가 아파요."
Output:
{
  "status": "success",
  "original_text": "배를 탔더니 배가 아파요.",
  "ksl_syntax_order": ["배,선박", "타다", "배", "아프다"],
  "facial_expression_token": "NEUTRAL"
}

Input: "바빠서 멀리 못 가요."
Output:
{
  "status": "success",
  "original_text": "바빠서 멀리 못 가요.",
  "ksl_syntax_order": ["멀다", "바쁘다", "부정", "가다"],
  "facial_expression_token": "NEGATION"
}

Input: "학교 안 가고 집에서 과일 배 먹고 싶어."
Output:
{
  "status": "success",
  "original_text": "학교 안 가고 집에서 과일 배 먹고 싶어.",
  "ksl_syntax_order": ["학교", "부정", "가다", "집", "(과일)배", "먹다", "싶다"],
  "facial_expression_token": "NEGATION"
}

Input: "너 왜 그렇게 말랐어? 밥 안 먹었어?"
Output:
{
  "status": "success",
  "original_text": "너 왜 그렇게 말랐어? 밥 안 먹었어?",
  "ksl_syntax_order": ["너", "마르다", "QUESTION_WHY", "밥", "부정", "먹다"],
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
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  });
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

function checkFixedWindowRateLimit(bucket, limit, now = Date.now()) {
  if (limit <= 0) {
    return {
      allowed: false,
      limit,
      retryAfterSeconds: Math.ceil(geminiRateLimitWindowMs / 1000)
    };
  }

  if (!bucket.windowStartedAt || now - bucket.windowStartedAt >= geminiRateLimitWindowMs) {
    bucket.windowStartedAt = now;
    bucket.count = 0;
  }

  if (bucket.count >= limit) {
    const retryAfterMs = geminiRateLimitWindowMs - (now - bucket.windowStartedAt);
    return {
      allowed: false,
      limit,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000))
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    limit,
    retryAfterSeconds: 0
  };
}

function checkGeminiRateLimit(clientKey, now = Date.now()) {
  if (!clientKey) {
    return {
      allowed: true,
      limit: geminiClientRateLimitMaxRequests,
      retryAfterSeconds: 0
    };
  }

  if (clientKey) {
    const clientWindow = geminiClientRequestWindows.get(clientKey) || { windowStartedAt: now, count: 0 };
    const clientLimit = checkFixedWindowRateLimit(clientWindow, geminiClientRateLimitMaxRequests, now);
    geminiClientRequestWindows.set(clientKey, clientWindow);

    for (const [key, value] of geminiClientRequestWindows) {
      if (!value.windowStartedAt || value.windowStartedAt <= now - geminiRateLimitWindowMs * 3) {
        geminiClientRequestWindows.delete(key);
      }
    }

    if (!clientLimit.allowed) return { ...clientLimit, scope: "client" };
  }

  return {
    allowed: true,
    limit: geminiClientRateLimitMaxRequests,
    retryAfterSeconds: 0
  };
}

function getClientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map(value => value.trim())
    .find(Boolean);
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function normalizeSearchText(text) {
  return String(text || "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKslSearchTerm(text) {
  return String(text || "")
    .replace(/[^\p{L}\p{N}\s,()]/gu, " ")
    .replace(/\s*,\s*/g, ",")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

function numberToKorean(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";

  const trimmed = digits.replace(/^0+/, "") || "0";
  if (trimmed === "0") return "영";

  const digitNames = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const smallUnits = ["", "십", "백", "천"];
  const largeUnits = ["", "만", "억", "조", "경"];
  const groups = [];

  for (let end = trimmed.length; end > 0; end -= 4) {
    groups.unshift(trimmed.slice(Math.max(0, end - 4), end));
  }

  return groups.map((group, groupIndex) => {
    const padded = group.padStart(4, "0");
    const body = [...padded].map((char, index) => {
      const digit = Number(char);
      if (!digit) return "";
      const unit = smallUnits[3 - index];
      return `${digit === 1 && unit ? "" : digitNames[digit]}${unit}`;
    }).join("");
    if (!body) return "";
    return `${body}${largeUnits[groups.length - groupIndex - 1] || ""}`;
  }).join("");
}

function replaceNumbersWithKorean(text) {
  // TODO: Add contextual native-Korean number reading for time/count expressions.
  return String(text || "").replace(/\d+/g, match => numberToKorean(match));
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
  const normalized = normalizeKslSearchTerm(term);

  if (!normalized) return [];
  const variants = [normalized];

  if (normalized.includes(",")) {
    normalized.split(",")
      .map(part => part.trim())
      .filter(Boolean)
      .forEach(part => variants.push(part));
  }

  const parentheticalMatch = normalized.match(/^\(([^)]+)\)(.+)$/u);
  if (parentheticalMatch) {
    variants.push(parentheticalMatch[2].trim());
  }

  return variants.filter((variant, index, list) => variant && list.indexOf(variant) === index);
}

function buildSearchTerms(text) {
  const normalized = normalizeSearchText(replaceNumbersWithKorean(text));
  const words = normalized.split(/\s+/).filter(Boolean);
  const terms = [];

  const addWithVariants = (term, type) => {
    dictionaryTermVariants(term).forEach((variant, index) => {
      terms.push({ term: variant, type: index === 0 ? type : `${type}_variant` });
    });
  };

  if (normalized) addWithVariants(normalized, "phrase");
  for (const word of words) {
    const stripped = stripTrailingParticle(word);
    if (stripped && stripped !== word) {
      addWithVariants(stripped, "word");
      continue;
    }
    if (word !== normalized) addWithVariants(word, "word");
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
    terms: buildSearchTerms(replaceNumbersWithKorean(text))
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

function termsFromKslPlan(parsed) {
  const nonLexicalTokens = new Set(["SURPRISE", "QUESTION", "QUESTION_WHY", "NEGATION", "ANGRY", "NEUTRAL"]);
  const order = Array.isArray(parsed?.ksl_syntax_order) ? parsed.ksl_syntax_order : [];
  const orderedTerms = order
    .filter(token => typeof token === "string")
    .map(token => token.trim())
    .filter(Boolean);

  const seen = new Set();
  return orderedTerms.map(token => {
    const isFingerspelling = token.startsWith("FS_");
    const rawTerm = isFingerspelling ? token.slice(3) : replaceNumbersWithKorean(token);
    const term = normalizeKslSearchTerm(rawTerm);
    return {
      term,
      type: isFingerspelling ? "fingerspelling" : "ksl",
      rawToken: token
    };
  }).filter(item => {
    if (!item.term) return false;
    if (nonLexicalTokens.has(item.term)) return false;
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

async function planSignTerms(text, clientKey = "") {
  const apiKeys = getGeminiApiKeys();
  if (!apiKeys.length) return geminiUnavailablePlan(text, "Gemini API key is not configured.", "key_missing");

  const normalized = normalizeSearchText(replaceNumbersWithKorean(text));
  if (!normalized) return fallbackPlan(text);

  try {
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const cacheKey = `${model}:${normalized}`;
    const cachedPlan = getCachedGeminiPlan(cacheKey);
    if (cachedPlan) return cachedPlan;

    const rateLimit = checkGeminiRateLimit(clientKey);
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

        const normalizedTerms = termsFromKslPlan(parsed);
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
        if (reason === "key_invalid") continue;
        if (reason !== "quota_exhausted" && reason !== "unavailable") break;
      }
    }

    throw lastError || new Error("Gemini planning failed.");
  } catch (error) {
    const reason = geminiUnavailableReason(error.message);
    return geminiUnavailablePlan(text, error.message, reason);
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
    signal: AbortSignal.timeout(cultureApiTimeoutMs),
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
  let lastError = null;
  const retryDelays = [0, 300, 800];

  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (retryDelays[attempt]) await wait(retryDelays[attempt]);
    try {
      return await searchOneSource(source, query);
    } catch (error) {
      if (error.status === 401) throw error;
      lastError = error;
    }
  }

  throw lastError || new Error(`${source.name} request failed`);
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
  const collectionDb = String(entry?.raw?.collectionDb || "").replace(/\s+/g, "");
  if (collectionDb.includes("일상생활수어")) return sourcePriority.life;
  if (collectionDb.includes("전문용어수어")) return sourcePriority.specialized;
  if (collectionDb.includes("문화정보수어")) return sourcePriority.culture;
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

function cultureQueryVariants(query) {
  const compact = compactSearchText(query);
  const variants = [query];

  if (String(query || "").includes(",")) {
    String(query)
      .split(",")
      .map(part => part.trim())
      .filter(Boolean)
      .forEach(part => variants.push(part));
  }

  const parentheticalMatch = String(query || "").trim().match(/^\(([^)]+)\)(.+)$/u);
  if (parentheticalMatch) {
    variants.push(parentheticalMatch[2].trim());
  }

  if (isSingleHangulSyllable(query)) variants.push(`${compact},`);
  return variants.filter((variant, index, list) => variant && list.indexOf(variant) === index);
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

  const settled = [];
  const prioritizedSources = [...sources].sort((a, b) => (sourcePriority[a.id] ?? 99) - (sourcePriority[b.id] ?? 99));
  const queryVariants = cultureQueryVariants(query);

  for (const source of prioritizedSources) {
    const sourceEntries = [];
    let lastError = null;

    for (const queryVariant of queryVariants) {
      try {
        const entries = (await searchOneSourceWithRetry(source, queryVariant))
          .map(entry => ({ ...entry, searchedTerm: query }));
        sourceEntries.push(...entries);

        const relevantEntries = filterEntriesForQuery(entries, query);
        if (relevantEntries.length || (!isSingleHangulSyllable(query) && entries.length)) break;
      } catch (error) {
        lastError = error;
        if (error.status === 401) break;
      }
    }

    if (sourceEntries.length) {
      settled.push({ source, entries: sourceEntries, error: null });
      if (filterEntriesForQuery(sourceEntries, query).length || !isSingleHangulSyllable(query)) break;
      continue;
    }

    if (lastError) {
      if (process.env.DEBUG_CULTURE_API === "true") {
        console.warn("Culture API search failed", {
          source: source.id,
          status: lastError.status || null,
          message: lastError.message,
          body: lastError.body || ""
        });
      }
      settled.push({ source, entries: [], error: lastError });
      continue;
    }

    settled.push({ source, entries: [], error: null });
  }
  const authErrors = settled.filter(result => result.error?.status === 401);
  const otherErrors = settled.filter(result => result.error && result.error.status !== 401);
  const cacheKey = compactSearchText(query);
  let entries = sortEntries(filterEntriesForQuery(dedupeEntries(settled.flatMap(result => result.entries)), query), query);
  if (entries.length) {
    cultureSearchCache.set(cacheKey, entries);
  } else if (cultureSearchCache.has(cacheKey)) {
    entries = cultureSearchCache.get(cacheKey);
  }

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
    kslTokens: getKslTokensForFeedback(plan),
    feedback: ""
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

async function searchItemsAcrossCultureApis(searchItems) {
  const concurrency = Math.max(1, Number(process.env.CULTURE_SEARCH_CONCURRENCY || 3));
  const sharedSearches = new Map();
  const results = new Array(searchItems.length);
  let nextIndex = 0;

  const searchForTerm = term => {
    const key = compactSearchText(term);
    if (!sharedSearches.has(key)) sharedSearches.set(key, searchCultureApis(term));
    return sharedSearches.get(key);
  };

  const worker = async () => {
    while (nextIndex < searchItems.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = searchItems[index];
      results[index] = { term: item.term, type: item.type, rawToken: item.rawToken, ...(await searchForTerm(item.term)) };
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, searchItems.length) }, () => worker())
  );

  return results;
}

function hasSearchEntries(results) {
  return results.some(result => result.entries?.length);
}

async function retryMissingSearchResults(results, searchItems) {
  const missingIndexes = results
    .map((result, index) => result.entries?.length ? -1 : index)
    .filter(index => index >= 0);

  if (!missingIndexes.length) return results;

  await wait(900);
  const retryIndexes = missingIndexes.slice(0, 6);
  const retryItems = retryIndexes.map(index => searchItems[index]);
  const retryResults = await searchItemsAcrossCultureApis(retryItems);
  const merged = [...results];

  retryResults.forEach((retryResult, retryIndex) => {
    if (retryResult.entries?.length) {
      merged[retryIndexes[retryIndex]] = retryResult;
    }
  });

  return merged;
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "OPTIONS") {
      return sendJson(res, 200, {});
    }

    if (req.method === "GET" && url.pathname === "/api/media/video") {
      await streamVideo(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/signs/search") {
      const query = url.searchParams.get("q")?.trim();
      if (!query) return sendJson(res, 400, { error: "Missing q query parameter." });
      return sendJson(res, 200, await searchCultureApis(query));
    }

    if (req.method === "POST" && url.pathname === "/api/feedback") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const originalText = normalizeSearchText(String(body.originalText || ""));
      const feedback = String(body.feedback || "").trim();
      const kslTokens = Array.isArray(body.kslTokens)
        ? body.kslTokens.map(token => String(token || "").trim()).filter(Boolean)
        : [];

      if (!originalText) return sendJson(res, 400, { error: "Missing originalText." });
      if (!feedback) return sendJson(res, 400, { error: "Missing feedback." });

      sendFeedbackLog({ originalText, kslTokens, feedback });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/signs/translate") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const originalText = normalizeSearchText(String(body.text || ""));

      const plan = await planSignTerms(originalText, getClientKey(req));
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

      let results = await searchItemsAcrossCultureApis(searchItems);
      if (!hasSearchEntries(results)) {
        await wait(900);
        results = await searchItemsAcrossCultureApis(searchItems);
      }
      results = await retryMissingSearchResults(results, searchItems);

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
