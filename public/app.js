const form = document.querySelector("#translateForm");
const input = document.querySelector("#textInput");
const statusEl = document.querySelector("#status");
const preview = document.querySelector("#preview");
const timeline = document.querySelector("#timeline");

function setStatus(message, tone = "neutral") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function mediaFor(entry) {
  if (entry.videoUrl) {
    return `<video src="${entry.videoUrl}" controls playsinline></video>`;
  }

  if (entry.imageUrl) {
    return `<img src="${entry.imageUrl}" alt="${entry.title} 수어 이미지">`;
  }

  return `<div class="letterFallback">${entry.title.slice(0, 12)}</div>`;
}

function renderEntry(entry, index) {
  return `
    <li class="signCard">
      <button class="cardButton" type="button" data-index="${index}">
        <span class="order">${String(index + 1).padStart(2, "0")}</span>
        <span>
          <strong>${entry.title}</strong>
          <small>${entry.searchedTerm}</small>
        </span>
      </button>
    </li>
  `;
}

function showPreview(entry) {
  preview.innerHTML = `
    <article class="previewContent">
      <div class="mediaFrame">${mediaFor(entry)}</div>
      <div class="details">
        <p class="eyebrow">검색어: ${entry.searchedTerm}</p>
        <h2>${entry.title}</h2>
        <p>${entry.description || "설명 데이터가 없습니다. API 원본 응답을 확인해 매핑 필드를 조정할 수 있습니다."}</p>
      </div>
    </article>
  `;
}

function flattenResults(data) {
  return data.results.flatMap(result => {
    if (result.entries?.length) return result.entries.slice(0, 1);
    return [{
      searchedTerm: result.term,
      title: result.term,
      description: "검색 결과가 없습니다.",
      videoUrl: "",
      imageUrl: ""
    }];
  });
}

form.addEventListener("submit", async event => {
  event.preventDefault();

  const text = input.value.trim();
  if (!text) {
    setStatus("문장을 입력하세요", "warning");
    input.focus();
    return;
  }

  setStatus("검색 중");
  timeline.innerHTML = "";

  try {
    const response = await fetch("/api/signs/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "변환에 실패했습니다.");

    const entries = flattenResults(data);
    timeline.innerHTML = entries.map(renderEntry).join("");
    showPreview(entries[0]);
    setStatus(`${entries.length}개 항목`, "success");

    timeline.querySelectorAll("button").forEach(button => {
      button.addEventListener("click", () => showPreview(entries[Number(button.dataset.index)]));
    });
  } catch (error) {
    setStatus("오류", "danger");
    preview.innerHTML = `<div class="emptyState error"><strong>${error.message}</strong></div>`;
  }
});
