# HANDSIGNS Feedback Log

This file keeps expert and user feedback for Sonmalgwan. Each note should preserve the original concern, the product interpretation, and the follow-up decision.

## 2026-07-01 · KSL Expert Feedback

Source: Anonymized KSL education professional  
Context: Short hands-on review after trying Sonmalgwan a few times.

Privacy note: Do not store the reviewer's name, school, contact details, or other personally identifying information in this repository.

### What Worked

- Simple sentences are converted reasonably well.
- Sentences where each word has one clear meaning seem to produce usable sign video sequences.
- The reviewer appreciated the interest in Korean Sign Language and Deaf users.

### Issues Found

1. Homonym and context ambiguity

   Example input:

   ```text
   학교가서 공부 안하고 쉬고 싶어
   ```

   Observed output:

   ```text
   나 + 학교 + 공부 + 안에서 + 쉬고 + 싶어
   ```

   Problem:

   - Korean "안" can mean "inside" or "not".
   - In this sentence, "안하고" means negation, not "inside".
   - The app selected the wrong sign concept.

2. Korean Sign Language grammar needs clearer direction

   The reviewer noted that Korean and KSL have different sentence structures.

   Important product question:

   - Should Sonmalgwan aim for 농식수어-style output?
   - Or should it aim for 문장식 수어-style output?

   This decision changes how aggressively the app should reorder or transform Korean sentences.

3. Video playback is hard to follow

   The app currently plays short sign videos one after another.

   Problem:

   - Video starts, stops, starts, stops.
   - This makes the sequence harder to watch.
   - Comprehension may drop because the rhythm feels interrupted.

### Product Interpretation

- Gemini prompt parsing must handle negation more strictly.
- "안" should be resolved by context before search:
  - "안에", "안에서", "집 안" -> inside/location
  - "안 하다", "안하고", "안 먹다" -> negation
- Synonyms and inflected Korean expressions should converge to one searchable dictionary headword, not duplicate original and normalized forms.
- Homonyms must be resolved before API search:
  - "밤이 먹고 싶어" -> chestnut/food
  - "오늘 밤" -> night/time
- The app should target a Deaf-centered meaning order rather than Korean word-for-word signed order.
- Playback needs a smoother experience, not only correct token matching.

### Follow-up Tasks

- [x] Strengthen the prompt rule for "안" as negation vs inside.
- [x] Add synonym normalization rules so original forms and dictionary headwords are not both emitted.
- [x] Add homonym examples for food/time context such as "밤".
- [x] Add regression examples for:
  - "학교가서 공부 안하고 쉬고 싶어"
  - "밥 안 먹었어"
  - "집 안에서 쉬고 싶어"
- [x] Preload upcoming media to reduce gaps between short sign videos.
- [x] Decide and document MVP signing style: prioritize Deaf-centered meaning order close to natural KSL viewing flow.
- [ ] Explore smoother playback:
  - reduced gap between clips (first pass: preload next videos)
  - clearer subtitle/caption bridge
  - optional manual step mode
  - possible transition screen between signs
- [ ] Ask follow-up questions to the reviewer about preferred target style and acceptable video sequencing.

### Current Decision

Do not treat this as a simple API-ranking bug. This is a semantic parsing and product-direction issue. Prioritize prompt and UX changes before adding more data sources.

## Anonymous Spreadsheet Feedback

Use this section for short text feedback copied from the public feedback sheet. Keep entries anonymous. Do not include names, email addresses, schools, phone numbers, or other personal details.

Format:

```text
YYYY-MM-DD HH:mm
Input: ...
Observed tokens: ...
Feedback: ...
Status: open | reflected | needs-review
Note: ...
```

### 2026-06-30 23:32

Input: 오늘 영화 재미없었어  
Observed tokens: 오늘 / 영화 / 재미없다  
Feedback: "영화"가 기독교 의미의 단어로 재생되어 수정이 필요해 보임.  
Status: needs-review  
Note: Gemini tokenization itself is correct. This looks like an API result-selection/ranking issue where the same query can return a religious sense instead of the movie sense. Do not solve this with a single hardcoded word exception; use it as a regression case for semantic ranking.

### 2026-07-01 16:02

Input: 바빠서 멀리 못 가요  
Observed tokens: 바쁘다 / 멀다 / 가다 / 못  
Feedback: "못"이 negative "cannot"이 아니라 pond-related sign result로 재생됨.  
Status: reflected  
Note: Prompt rules now normalize both negative "안" and negative "못" to the dictionary-search token "부정". Avoid adding source-code word exceptions unless a broader ranking rule is designed.
