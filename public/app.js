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
    return `<video src="${escapeHtml(entry.videoUrl)}" controls playsinline autoplay muted></video>`;
  }

  if (entry.imageUrl) {
    return `<img src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(entry.title)} 수어 이미지">`;
  }

  return `<div class="letterFallback">${escapeHtml(entry.title.slice(0, 12))}</div>`;
}

function renderEntry(entry, index) {
  const selected = index === activeIndex ? "true" : "false";
  return `
    <li class="signCard">
      <button class="cardButton" type="button" data-index="${index}" aria-current="${selected}">
        <span class="order">${String(index + 1).padStart(2, "0")}</span>
        <span class="cardText">
          <strong>${escapeHtml(entry.title)}</strong>
          <small>${escapeHtml(entry.searchedTerm)} · ${escapeHtml(entry.sourceName || "미분류")}</small>
        </span>
      </button>
    </li>
  `;
}

function renderTimeline() {
  timeline.innerHTML = queue.map(renderEntry).join("");
  queueCount.textContent = `${queue.length}개`;
  timeline.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => showPreview(Number(button.dataset.index)));
  });
}

function showPreview(index) {
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
      </div>
    </article>
  `;

  const video = preview.querySelector("video");
  if (video) {
    video.muted = false;
    video.play().catch(() => {
      setStatus("재생 대기", "warning");
    });
    video.addEventListener("ended", () => showPreview(activeIndex + 1));
  }

  renderTimeline();
}

function flattenResults(data) {
  return data.results.flatMap(result => {
    const videoFirst = [...(result.entries || [])].sort((a, b) => Number(Boolean(b.videoUrl)) - Number(Boolean(a.videoUrl)));
    if (videoFirst.length) return videoFirst.slice(0, 2);
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

prevButton.addEventListener("click", () => showPreview(activeIndex - 1));
playButton.addEventListener("click", () => showPreview(activeIndex));
nextButton.addEventListener("click", () => showPreview(activeIndex + 1));

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
    showPreview(0);
    setStatus(`${queue.length}개 영상 후보`, "success");
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
