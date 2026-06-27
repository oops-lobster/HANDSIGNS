const form = document.querySelector("#translateForm");
const input = document.querySelector("#textInput");
const statusEl = document.querySelector("#status");
const preview = document.querySelector("#preview");
const timeline = document.querySelector("#timeline");
const queueCount = document.querySelector("#queueCount");
const prevButton = document.querySelector("#prevButton");
const playButton = document.querySelector("#playButton");
const nextButton = document.querySelector("#nextButton");

const apiBaseUrl = window.HANDSIGNS_API_BASE_URL || "";

let queue = [];
let activeIndex = 0;
let isAutoPlaying = false;

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

function mediaFor(entry) {
  if (entry.videoUrl) {
    return `<video src="${escapeHtml(entry.videoUrl)}" controls playsinline autoplay muted preload="auto"></video>`;
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

function showPreview(index, options = {}) {
  if (!queue.length) return;

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
    video.muted = true;
    video.play().catch(() => {
      setStatus("재생 대기", "warning");
    });
    video.addEventListener("ended", () => {
      if (isAutoPlaying && activeIndex < queue.length - 1) {
        showPreview(activeIndex + 1, { autoplay: true });
      } else if (activeIndex >= queue.length - 1) {
        isAutoPlaying = false;
        setStatus("재생 완료", "success");
      }
    });
  } else if (options.autoplay && isAutoPlaying && activeIndex < queue.length - 1) {
    window.setTimeout(() => showPreview(activeIndex + 1, { autoplay: true }), 1200);
  }

  renderTimeline();
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
      return [{
        searchedTerm: result.term,
        sourceName: "검색 실패",
        title: result.term,
        description: "검색 결과가 없습니다. 수어 전문가에게 대체 표현이나 문장 단위 표현이 필요한지 확인하세요.",
        videoUrl: "",
        imageUrl: ""
      }];
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

  try {
    const data = await translate(text);
    queue = flattenResults(data);
    renderTimeline();
    isAutoPlaying = true;
    showPreview(0, { autoplay: true });

    const hasRealConfig = data.results.some(result => result.configured);
    const videoCount = queue.filter(entry => entry.videoUrl).length;
    const imageCount = queue.filter(entry => entry.imageUrl).length;
    const hasCultureAuthError = data.results.some(result =>
      (result.entries || []).some(entry => String(entry.description || "").includes("401"))
    );

    if (!hasRealConfig) {
      setStatus("API 키 필요", "warning");
    } else if (hasCultureAuthError) {
      setStatus("수어 API 인증 필요", "danger");
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
        <span>GitHub Pages에서 열었다면 별도 백엔드 URL을 public/config.js에 설정해야 합니다.</span>
      </div>
    `;
  }
});
