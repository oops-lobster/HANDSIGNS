const form = document.querySelector("#translateForm");
const input = document.querySelector("#textInput");
const statusEl = document.querySelector("#status");
const preview = document.querySelector("#preview");
const timeline = document.querySelector("#timeline");
const queueCount = document.querySelector("#queueCount");
const prevButton = document.querySelector("#prevButton");
const playButton = document.querySelector("#playButton");
const nextButton = document.querySelector("#nextButton");
const plannerSource = document.querySelector("#plannerSource");
const plannerTokens = document.querySelector("#plannerTokens");

const apiBaseUrl = window.HANDSIGNS_API_BASE_URL || "";
const videoLoadTimeoutMs = 6500;
const imageFallbackDurationMs = 1500;

let queue = [];
let activeIndex = 0;
let isAutoPlaying = false;
let mediaTimer = null;

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(message, tone = "neutral") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function mediaFor(entry, options = {}) {
  const videoUrl = options.rawVideo ? entry.rawVideoUrl : entry.videoUrl;

  if (videoUrl) {
    return `
      <div class="videoShell">
        <video src="${escapeHtml(videoUrl)}" ${entry.imageUrl ? `poster="${escapeHtml(entry.imageUrl)}"` : ""} controls playsinline autoplay muted preload="metadata"></video>
      </div>
    `;
  }

  if (entry.imageUrl) {
    return `<img src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(entry.title)} 수어 이미지">`;
  }

  return `
    <div class="noMedia">
      <strong>${escapeHtml(entry.title.slice(0, 18))}</strong>
      <span>표시할 영상/이미지 URL이 없습니다.</span>
    </div>
  `;
}

function fallbackMediaFor(entry) {
  if (entry.imageUrl) {
    return `
      <div class="fallbackMedia">
        <img src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(entry.title)} 수어 이미지">
        <span>영상 응답이 지연되어 이미지로 표시합니다.</span>
      </div>
    `;
  }

  return `
    <div class="noMedia">
      <strong>${escapeHtml(entry.title.slice(0, 18))}</strong>
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

function renderEntry(entry, index) {
  const selected = index === activeIndex ? "true" : "false";
  return `
    <li class="signCard">
      <button class="cardButton" type="button" data-index="${index}" aria-current="${selected}">
        <span class="order">${String(index + 1).padStart(2, "0")}</span>
        <span class="cardText">
          <strong>${escapeHtml(entry.title)}</strong>
          <small>${escapeHtml(entry.searchedTerm)} · ${escapeHtml(entry.sourceName || "미분류")} · ${entry.videoUrl ? "영상" : entry.imageUrl ? "이미지" : "미디어 없음"}</small>
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
}

function renderPlanner(plan) {
  const source = plan?.source === "gemini" ? "AI 분석" : "기본 분석";
  const kslOrder = Array.isArray(plan?.ksl?.ksl_syntax_order) ? plan.ksl.ksl_syntax_order : [];
  const terms = Array.isArray(plan?.terms) ? plan.terms.map(item => item.term) : [];
  const tokens = kslOrder.length ? kslOrder : terms;

  plannerSource.textContent = source;
  plannerTokens.innerHTML = tokens.length
    ? tokens.map(token => `<span data-kind="${kslOrder.includes(token) ? "ksl" : "term"}">${escapeHtml(token)}</span>`).join("")
    : "<span>문장을 입력하면 표시됩니다.</span>";
}

function showEmptyState(title, message) {
  preview.innerHTML = `
    <div class="emptyState">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

function showPreview(index, options = {}) {
  if (!queue.length) return;

  clearMediaTimer();
  activeIndex = Math.max(0, Math.min(index, queue.length - 1));
  const entry = queue[activeIndex];

  preview.innerHTML = `
    <article class="previewContent">
      <div class="mediaFrame">${mediaFor(entry)}</div>
      <div class="details">
        <div class="metaRow">
          <span class="sourceBadge">${escapeHtml(entry.sourceName || "API")}</span>
          <span>${activeIndex + 1} / ${queue.length}</span>
        </div>
        <h2>${escapeHtml(entry.title)}</h2>
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
  if (phraseMedia.length) return phraseMedia.slice(0, 1);

  return data.results
    .filter(result => result.type !== "phrase")
    .flatMap(result => {
      const entries = bestEntries(result);
      if (entries.length) return entries.slice(0, 1);
      return [];
    });
}

function bestEntries(result) {
  if (!result) return [];

  const mediaScore = entry =>
    Number(Boolean(entry.videoUrl)) * 3 +
    Number(Boolean(entry.imageUrl)) * 2 +
    Number(Boolean(entry.resourceUrl));

  const exactMatches = (result.entries || []).filter(entry =>
    entry.title === result.term || entry.title.replace(/\s+/g, "") === result.term.replace(/\s+/g, "")
  );
  const pool = exactMatches.length ? exactMatches : (result.entries || []);

  return [...pool].sort((a, b) => mediaScore(b) - mediaScore(a));
}

async function translate(text) {
  const response = await fetch(`${apiBaseUrl}/api/signs/translate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "변환에 실패했습니다.");
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
  queue = [];
  activeIndex = 0;
  renderTimeline();
  renderPlanner(null);

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
    setStatus("오류", "danger");
    preview.innerHTML = `
      <div class="emptyState error">
        <strong>${escapeHtml(error.message)}</strong>
        <span>잠시 후 다시 시도하거나 서버 연결 상태를 확인해 주세요.</span>
      </div>
    `;
  }
});
