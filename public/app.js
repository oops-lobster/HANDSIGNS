const form = document.querySelector("#translateForm");
const input = document.querySelector("#textInput");
const speechButton = document.querySelector("#speechButton");
const submitButton = document.querySelector(".submitButton");
const speechStatus = document.querySelector("#speechStatus");
const statusEl = document.querySelector("#status");
const showtimeBar = document.querySelector(".showtimeBar");
const preview = document.querySelector("#preview");
const timeline = document.querySelector("#timeline");
const queueCount = document.querySelector("#queueCount");
const prevButton = document.querySelector("#prevButton");
const playButton = document.querySelector("#playButton");
const nextButton = document.querySelector("#nextButton");
const plannerSource = document.querySelector("#plannerSource");
const plannerTokens = document.querySelector("#plannerTokens");
const feedbackPanel = document.querySelector("#feedbackPanel");
const feedbackForm = document.querySelector("#feedbackForm");
const feedbackInput = document.querySelector("#feedbackInput");
const feedbackStatus = document.querySelector("#feedbackStatus");
const fontScaleButtons = document.querySelectorAll("[data-font-scale]");

const apiBaseUrl = window.HANDSIGNS_API_BASE_URL || (window.location.protocol === "file:" ? "https://handsigns.vercel.app" : "");
const fontScaleStorageKey = "handsigns-font-scale-v2";
const translateTimeoutMs = 120_000;
const videoLoadTimeoutMs = 12_000;
const imageFallbackDurationMs = 1500;
const sourcePriority = {
  life: 0,
  integrated: 1,
  specialized: 2,
  culture: 3
};

let queue = [];
let activeIndex = 0;
let isAutoPlaying = false;
let mediaTimer = null;
let recognition = null;
let isListening = false;
let speechStopTimer = null;
let latestFeedbackContext = null;
const preloadedMediaUrls = new Set();

initFontScaleControls();

function setFontScale(scale) {
  const nextScale = ["small", "base", "large"].includes(scale) ? scale : "base";
  document.body.dataset.fontScale = nextScale;
  fontScaleButtons.forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.fontScale === nextScale));
  });
  try {
    window.localStorage.setItem(fontScaleStorageKey, nextScale);
  } catch (_) {
    // Local storage can be unavailable in private browsing; the live setting still applies.
  }
}

function initFontScaleControls() {
  let savedScale = "base";
  try {
    savedScale = window.localStorage.getItem(fontScaleStorageKey) || "base";
  } catch (_) {
    savedScale = "base";
  }
  setFontScale(savedScale);
  fontScaleButtons.forEach(button => {
    button.addEventListener("click", () => setFontScale(button.dataset.fontScale));
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isFingerspellingToken(value) {
  return String(value || "").trim().startsWith("FS_");
}

function displayToken(value) {
  const token = String(value || "").trim();
  return isFingerspellingToken(token) ? token.slice(3) : token;
}

function tokenKind(value, fallback = "term") {
  return isFingerspellingToken(value) ? "fingerspelling" : fallback;
}

function displayEntryTitle(entry) {
  return displayToken(entry?.displayTerm || entry?.title || "");
}

function displaySearchTerm(entry) {
  return displayToken(entry?.displaySearchedTerm || entry?.searchedTerm || "");
}

function normalizeSearchText(value) {
  return String(value || "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSearchText(value) {
  return normalizeSearchText(value).replace(/\s+/g, "");
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

function relevanceScore(entry, term) {
  const normalizedTerm = compactSearchText(term);
  const title = compactSearchText(entry.title);
  const parts = titleParts(entry.title);
  if (!normalizedTerm || !title) return 0;
  if (title === normalizedTerm) return 100;
  if (parts.includes(normalizedTerm)) return 90;
  if (title.startsWith(normalizedTerm)) return 70;
  if (title.includes(normalizedTerm)) return 45;
  if (parts.some(part => normalizedTerm.includes(part))) return 25;
  return 0;
}

function statusStageFor(message, tone) {
  const normalized = String(message || "");
  if (
    tone === "success" ||
    normalized.includes("영상") ||
    normalized.includes("이미지") ||
    normalized.includes("재생") ||
    normalized.includes("미디어")
  ) {
    return "play";
  }
  if (
    tone === "warning" ||
    tone === "danger" ||
    normalized.includes("검색") ||
    normalized.includes("분석") ||
    normalized.includes("변환") ||
    normalized.includes("소모") ||
    normalized.includes("사용 불가") ||
    normalized.includes("결과")
  ) {
    return "search";
  }
  return "idle";
}

function setStatus(message, tone = "neutral") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
  if (showtimeBar) showtimeBar.dataset.stage = statusStageFor(message, tone);
}

function mediaFor(entry, options = {}) {
  const videoUrl = options.rawVideo ? entry.rawVideoUrl : entry.videoUrl;

  if (videoUrl) {
    return `
      <div class="videoShell">
        <video src="${escapeHtml(videoUrl)}" ${entry.imageUrl ? `poster="${escapeHtml(entry.imageUrl)}"` : ""} controls playsinline autoplay muted preload="auto"></video>
      </div>
    `;
  }

  if (entry.imageUrl) {
    return `<img src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(displayEntryTitle(entry))} 수어 이미지">`;
  }

  return `
    <div class="noMedia">
      <strong>${escapeHtml(displayEntryTitle(entry).slice(0, 18))}</strong>
      <span>표시할 영상/이미지 URL이 없습니다.</span>
    </div>
  `;
}

function fallbackMediaFor(entry) {
  if (entry.imageUrl) {
    return `
      <div class="fallbackMedia">
        <img src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(displayEntryTitle(entry))} 수어 이미지">
        <span>영상 응답이 지연되어 이미지로 표시합니다.</span>
      </div>
    `;
  }

  return `
    <div class="noMedia">
      <strong>${escapeHtml(displayEntryTitle(entry).slice(0, 18))}</strong>
      <span>영상 응답이 지연되어 다음 표현으로 넘어갑니다.</span>
    </div>
  `;
}

function clearMediaTimer() {
  if (mediaTimer) {
    window.clearTimeout(mediaTimer);
    mediaTimer = null;
  }
}

function hasRawVideoRetry(entry) {
  return Boolean(entry.rawVideoUrl && entry.rawVideoUrl !== entry.videoUrl);
}

function preloadMediaUrl(url, type) {
  if (!url || preloadedMediaUrls.has(url)) return;
  preloadedMediaUrls.add(url);

  if (type === "video") {
    const video = document.createElement("video");
    video.src = url;
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.load();
    return;
  }

  const image = new Image();
  image.src = url;
}

function preloadUpcomingMedia(index) {
  const upcoming = queue.slice(index + 1, index + 3);
  upcoming.forEach(entry => {
    preloadMediaUrl(entry.videoUrl, "video");
    if (entry.rawVideoUrl !== entry.videoUrl) preloadMediaUrl(entry.rawVideoUrl, "video");
    preloadMediaUrl(entry.imageUrl, "image");
  });
}

function renderEntry(entry, index) {
  const selected = index === activeIndex ? "true" : "false";
  const kind = tokenKind(entry.rawSearchedTerm || entry.searchedTerm, entry.searchType || "term");
  const kindLabel = kind === "fingerspelling" ? `<span class="fingerLabel">지문자</span>` : "";
  return `
    <li class="signCard">
      <button class="cardButton" type="button" data-index="${index}" aria-current="${selected}">
        <span class="order">${String(index + 1).padStart(2, "0")}</span>
        <span class="cardText">
          <strong>${kindLabel}${escapeHtml(displayEntryTitle(entry))}</strong>
          <small>${escapeHtml(displaySearchTerm(entry))} · ${escapeHtml(entry.sourceName || "미분류")} · ${entry.videoUrl ? "영상" : entry.imageUrl ? "이미지" : "미디어 없음"}</small>
        </span>
      </button>
    </li>
  `;
}

function renderTimeline() {
  timeline.innerHTML = queue.map(renderEntry).join("");
  queueCount.textContent = `${queue.length}개`;
  timeline.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      isAutoPlaying = false;
      showPreview(Number(button.dataset.index));
    });
  });

  const activeButton = timeline.querySelector('[aria-current="true"]');
  keepActiveTimelineItemVisible(activeButton);
}

function keepActiveTimelineItemVisible(activeButton) {
  if (!activeButton) return;

  const timelineTop = timeline.scrollTop;
  const timelineBottom = timelineTop + timeline.clientHeight;
  const itemTop = activeButton.offsetTop;
  const itemBottom = itemTop + activeButton.offsetHeight;
  const padding = 16;

  if (itemTop >= timelineTop + padding && itemBottom <= timelineBottom - padding) return;

  const nextScrollTop = itemTop - (timeline.clientHeight - activeButton.offsetHeight) / 2;
  timeline.scrollTo({
    top: Math.max(0, nextScrollTop),
    behavior: "smooth"
  });
}

function renderPlanner(plan) {
  const source = plan?.source === "gemini" ? "AI 분석" : "기본 분석";
  const kslOrder = Array.isArray(plan?.ksl?.ksl_syntax_order) ? plan.ksl.ksl_syntax_order : [];
  const terms = Array.isArray(plan?.terms) ? plan.terms.map(item => item.term) : [];
  const tokens = kslOrder.length ? kslOrder : terms;

  plannerSource.textContent = source;
  plannerTokens.innerHTML = tokens.length
    ? tokens.map(token => {
      const kind = tokenKind(token, kslOrder.includes(token) ? "ksl" : "term");
      const label = kind === "fingerspelling" ? `<small>지문자</small>` : "";
      return `<span data-kind="${kind}">${label}${escapeHtml(displayToken(token))}</span>`;
    }).join("")
    : "<span>문장을 입력하면 표시됩니다.</span>";
}

function getPlannerTokens(plan) {
  const kslOrder = Array.isArray(plan?.ksl?.ksl_syntax_order) ? plan.ksl.ksl_syntax_order : [];
  if (kslOrder.length) return kslOrder;
  return Array.isArray(plan?.terms) ? plan.terms.map(item => item.term).filter(Boolean) : [];
}

function resetFeedbackPanel() {
  latestFeedbackContext = null;
  if (feedbackPanel) feedbackPanel.dataset.visible = "false";
  if (feedbackInput) feedbackInput.value = "";
  if (feedbackStatus) feedbackStatus.textContent = "대기";
}

function showFeedbackPanel(originalText, plan) {
  latestFeedbackContext = {
    originalText,
    kslTokens: getPlannerTokens(plan).map(displayToken)
  };
  if (feedbackPanel) feedbackPanel.dataset.visible = "true";
  if (feedbackInput) feedbackInput.value = "";
  if (feedbackStatus) feedbackStatus.textContent = "대기";
}

function showEmptyState(title, message) {
  preview.innerHTML = `
    <div class="emptyState">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

function setSpeechState(message, active = false) {
  if (speechStatus) speechStatus.textContent = message;
  if (speechButton) {
    const label = speechButton.querySelector(".speechButtonLabel");
    if (label) label.textContent = active ? "입력 종료" : "음성 입력";
    speechButton.dataset.active = active ? "true" : "false";
    speechButton.setAttribute("aria-label", active ? "음성 입력 종료" : "음성 입력 시작");
  }
}

function clearSpeechStopTimer() {
  if (speechStopTimer) {
    window.clearTimeout(speechStopTimer);
    speechStopTimer = null;
  }
}

function finishSpeechRecognition(message, statusMessage = "준비됨", tone = "neutral") {
  isListening = false;
  clearSpeechStopTimer();
  setSpeechState(message, false);
  setStatus(statusMessage, tone);
}

function appendRecognizedText(text) {
  const normalized = text.trim();
  if (!normalized) return;

  input.value = normalized;
  input.focus();
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!speechButton || !speechStatus) return;

  if (!SpeechRecognition) {
    speechButton.disabled = true;
    speechStatus.textContent = "이 브라우저는 음성 입력을 지원하지 않습니다.";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "ko-KR";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 3;

  recognition.addEventListener("start", () => {
    clearSpeechStopTimer();
    isListening = true;
    setStatus("듣는 중", "warning");
    setSpeechState("듣는 중입니다. 다시 누르면 입력이 끝납니다.", true);
  });

  recognition.addEventListener("result", event => {
    const transcript = Array.from(event.results)
      .map(result => result[0]?.transcript || "")
      .join("")
      .trim();

    if (transcript) {
      input.value = transcript;
      speechStatus.textContent = transcript;
    }

    const hasFinalResult = Array.from(event.results).some(result => result.isFinal);
    if (hasFinalResult && transcript) {
      appendRecognizedText(transcript);
    }
  });

  recognition.addEventListener("error", event => {
    const message = event.error === "not-allowed"
      ? "마이크 권한이 필요합니다."
      : "음성을 인식하지 못했습니다. 다시 시도해 주세요.";
    finishSpeechRecognition(message, "음성 실패", "warning");
  });

  recognition.addEventListener("end", () => {
    const hasText = Boolean(input.value.trim());
    finishSpeechRecognition(
      hasText ? "문장을 확인한 뒤 수어 변환을 눌러주세요." : "음성 입력이 끝났습니다.",
      hasText ? "확인 필요" : "준비됨",
      hasText ? "warning" : "neutral"
    );
  });

  speechButton.addEventListener("click", () => {
    if (!recognition) return;

    if (isListening) {
      recognition.stop();
      finishSpeechRecognition("음성 입력을 멈췄습니다. 문장을 확인한 뒤 수어 변환을 눌러주세요.", "확인 필요", "warning");
      speechStopTimer = window.setTimeout(() => {
        if (!isListening) setSpeechState(input.value.trim() ? "문장을 확인한 뒤 수어 변환을 눌러주세요." : "음성 입력이 끝났습니다.");
      }, 800);
      return;
    }

    try {
      recognition.start();
    } catch {
      finishSpeechRecognition("음성 입력을 다시 시도해 주세요.", "준비됨");
    }
  });
}

setupSpeechRecognition();

function showPreview(index, options = {}) {
  if (!queue.length) return;

  clearMediaTimer();
  activeIndex = Math.max(0, Math.min(index, queue.length - 1));
  const entry = queue[activeIndex];
  preloadUpcomingMedia(activeIndex);

  preview.innerHTML = `
    <article class="previewContent">
      <div class="mediaFrame">${mediaFor(entry)}</div>
      <div class="details">
        <div class="metaRow">
          <span class="sourceBadge">${escapeHtml(entry.sourceName || "API")}</span>
          <span>${activeIndex + 1} / ${queue.length}</span>
        </div>
        <h2>${escapeHtml(displayEntryTitle(entry))}</h2>
        <p>${escapeHtml(entry.description || "설명 데이터가 없습니다. 전문가 피드백에서 이 매칭이 적절한지 확인합니다.")}</p>
        ${entry.resourceUrl ? `<a class="resourceLink" href="${escapeHtml(entry.resourceUrl)}" target="_blank" rel="noreferrer">원본 자료 열기</a>` : ""}
      </div>
    </article>
  `;

  const video = preview.querySelector("video");
  if (video) {
    wireVideo(video, entry, preview.querySelector(".mediaFrame"), { allowRawRetry: true });
  } else if (options.autoplay && isAutoPlaying && activeIndex < queue.length - 1) {
    window.setTimeout(() => showPreview(activeIndex + 1, { autoplay: true }), 1200);
  }

  renderTimeline();
}

function wireVideo(video, entry, mediaFrame, options = {}) {
  let isSettled = false;

  const markReady = () => {
    isSettled = true;
    clearMediaTimer();
  };

  const moveToNext = () => {
    if (isAutoPlaying && activeIndex < queue.length - 1) {
      window.setTimeout(() => showPreview(activeIndex + 1, { autoplay: true }), imageFallbackDurationMs);
    } else if (isAutoPlaying) {
      isAutoPlaying = false;
    }
  };

  const fallbackFromVideo = () => {
    if (isSettled) return;
    isSettled = true;
    clearMediaTimer();

    if (options.allowRawRetry && hasRawVideoRetry(entry) && mediaFrame) {
      mediaFrame.innerHTML = mediaFor(entry, { rawVideo: true });
      const rawVideo = mediaFrame.querySelector("video");
      if (rawVideo) {
        setStatus("영상 재시도", "warning");
        wireVideo(rawVideo, entry, mediaFrame, { allowRawRetry: false });
        return;
      }
    }

    if (mediaFrame) mediaFrame.innerHTML = fallbackMediaFor(entry);
    setStatus("이미지 표시", "warning");
    moveToNext();
  };

  mediaTimer = window.setTimeout(fallbackFromVideo, videoLoadTimeoutMs);

  video.addEventListener("loadeddata", markReady, { once: true });
  video.addEventListener("canplay", markReady, { once: true });
  video.addEventListener("playing", markReady, { once: true });
  video.addEventListener("error", fallbackFromVideo, { once: true });

  video.muted = true;
  video.play().catch(() => {
    setStatus("재생 대기", "warning");
  });
  video.addEventListener("ended", () => {
    clearMediaTimer();
    if (isAutoPlaying && activeIndex < queue.length - 1) {
      showPreview(activeIndex + 1, { autoplay: true });
    } else if (activeIndex >= queue.length - 1) {
      isAutoPlaying = false;
      setStatus("재생 완료", "success");
    }
  });
}

function flattenResults(data) {
  const phraseResult = data.results.find(result => result.type === "phrase");
  const phraseMedia = bestEntries(phraseResult).filter(entry => entry.videoUrl);
  if (phraseMedia.length) return phraseMedia.slice(0, 1).map(entry => decorateEntry(entry, phraseResult));

  return data.results
    .filter(result => result.type !== "phrase")
    .flatMap(result => {
      const entries = bestEntries(result);
      if (entries.length) return entries.slice(0, 1).map(entry => decorateEntry(entry, result));
      return [];
    });
}

function decorateEntry(entry, result) {
  return {
    ...entry,
    searchType: result?.type || entry.searchType,
    rawSearchedTerm: result?.rawToken || entry.rawSearchedTerm || entry.searchedTerm,
    displaySearchedTerm: displayToken(result?.rawToken || entry.searchedTerm),
    displayTerm: displayToken(result?.rawToken || entry.title)
  };
}

function bestEntries(result) {
  if (!result) return [];

  const exactMatches = (result.entries || []).filter(entry =>
    compactSearchText(entry.title) === compactSearchText(result.term) ||
    titleParts(entry.title).includes(compactSearchText(result.term))
  );
  const pool = exactMatches.length ? exactMatches : (result.entries || []);

  return [...pool].sort((a, b) =>
    sourceRank(a) - sourceRank(b) ||
    relevanceScore(b, result.term) - relevanceScore(a, result.term) ||
    mediaScore(b) - mediaScore(a) ||
    String(a.title || "").localeCompare(String(b.title || ""), "ko")
  );
}

async function translate(text) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), translateTimeoutMs);

  const response = await fetch(`${apiBaseUrl}/api/signs/translate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: controller.signal
  }).catch(error => {
    if (error.name === "AbortError") {
      const timeoutError = new Error("검색 시간이 길어져 변환을 멈췄습니다.");
      timeoutError.reason = "search_timeout";
      throw timeoutError;
    }
    throw error;
  });

  try {
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || "변환에 실패했습니다.");
      error.reason = data.reason;
      error.retryAfterSeconds = data.retryAfterSeconds;
      throw error;
    }
    return data;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function submitFeedback(feedback) {
  const response = await fetch(`${apiBaseUrl}/api/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...latestFeedbackContext,
      feedback
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "피드백 저장에 실패했습니다.");
  }
  return data;
}

prevButton.addEventListener("click", () => {
  isAutoPlaying = false;
  showPreview(activeIndex - 1);
});
playButton.addEventListener("click", () => {
  isAutoPlaying = true;
  showPreview(activeIndex, { autoplay: true });
});
nextButton.addEventListener("click", () => {
  isAutoPlaying = false;
  showPreview(activeIndex + 1);
});

form.addEventListener("submit", async event => {
  event.preventDefault();

  const text = input.value.trim();
  if (!text) {
    setStatus("문장을 입력하세요", "warning");
    input.focus();
    return;
  }

  setStatus("검색 중");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "분석 중";
  }
  queue = [];
  activeIndex = 0;
  renderTimeline();
  renderPlanner(null);
  resetFeedbackPanel();

  try {
    const data = await translate(text);
    renderPlanner(data.planner);
    queue = flattenResults(data);

    renderTimeline();

    const hasRealConfig = data.results.some(result => result.configured);
    const videoCount = queue.filter(entry => entry.videoUrl).length;
    const imageCount = queue.filter(entry => entry.imageUrl).length;
    const needsCultureKey = data.results.some(result => result.authRequired);

    if (!queue.length) {
      isAutoPlaying = false;
      if (needsCultureKey) {
        showEmptyState("수어 영상을 연결할 준비를 하고 있습니다.", "문화포털 serviceKey를 서버에 설정하면 분석된 수어 순서대로 영상이 자동 재생됩니다.");
        setStatus("설정 필요", "warning");
      } else {
        showEmptyState("아직 연결된 수어 영상이 없습니다.", "다른 표현으로 다시 입력하거나 전문가 피드백을 통해 누락 표현을 보완할 수 있습니다.");
        setStatus("결과 없음", "warning");
      }
      return;
    }

    showFeedbackPanel(text, data.planner);
    isAutoPlaying = true;
    showPreview(0, { autoplay: true });

    if (!hasRealConfig) {
      setStatus("설정 필요", "warning");
    } else if (needsCultureKey) {
      setStatus("설정 필요", "warning");
    } else if (videoCount) {
      setStatus(`${videoCount}개 영상`, "success");
    } else if (imageCount) {
      setStatus(`${imageCount}개 이미지`, "warning");
    } else {
      setStatus("미디어 없음", "warning");
    }
  } catch (error) {
    const quotaExhausted = error.reason === "quota_exhausted";
    const rateLimited = error.reason === "rate_limited";
    const searchTimeout = error.reason === "search_timeout";
    isAutoPlaying = false;
    if (rateLimited) {
      const retryAfter = Number(error.retryAfterSeconds || 60);
      setStatus("잠시 대기", "warning");
      showEmptyState("잠깐 쉬었다가 다시 이어갈게요.", `많은 요청이 한꺼번에 들어와 분석을 잠시 멈췄습니다. 약 ${retryAfter}초 뒤 다시 시도할 수 있습니다.`);
    } else if (searchTimeout) {
      setStatus("검색 실패", "warning");
      showEmptyState("검색 시간이 너무 길어졌습니다.", "수어 API 응답이 지연되어 변환을 멈췄습니다. 잠시 후 다시 시도해 주세요.");
    } else if (quotaExhausted) {
      setStatus("사용 불가", "warning");
      showEmptyState("오늘 준비된 분석량을 모두 사용했습니다.", "잠시 뒤 다시 시도하거나 운영자가 새 사용량을 반영하면 이어서 사용할 수 있습니다.");
    } else {
      setStatus("오류", "danger");
      preview.innerHTML = `
        <div class="emptyState error">
          <strong>${escapeHtml(error.message)}</strong>
          <span>잠시 후 다시 시도하거나 서버 연결 상태를 확인해 주세요.</span>
        </div>
      `;
    }
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "수어 변환";
    }
  }
});

if (feedbackForm) {
  feedbackForm.addEventListener("submit", async event => {
    event.preventDefault();
    const feedback = feedbackInput?.value.trim() || "";

    if (!latestFeedbackContext) {
      if (feedbackStatus) feedbackStatus.textContent = "결과 없음";
      return;
    }

    if (!feedback) {
      if (feedbackStatus) feedbackStatus.textContent = "메모 필요";
      feedbackInput?.focus();
      return;
    }

    const button = feedbackForm.querySelector("button");
    if (button) button.disabled = true;
    if (feedbackStatus) feedbackStatus.textContent = "저장 중";

    try {
      await submitFeedback(feedback);
      if (feedbackStatus) feedbackStatus.textContent = "저장됨";
      if (feedbackInput) feedbackInput.value = "";
    } catch {
      if (feedbackStatus) feedbackStatus.textContent = "실패";
    } finally {
      if (button) button.disabled = false;
    }
  });
}
