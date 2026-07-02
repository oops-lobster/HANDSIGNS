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

## 2026-07-01 · KSL Education Feedback

Source: Anonymized elementary KSL education professional  
Context: Review after opening and checking the Sonmalgwan prototype.

Privacy note: Do not store the reviewer's name, school, contact details, or other personally identifying information in this repository.

### What Worked

- The reviewer recognized the value of turning an idea about Korean-to-sign video support into a concrete prototype.
- The project can be useful as a vocabulary and Korean-language support tool for young students or early learners.
- The current prototype gives reviewers a visible interface for discussing what works and what fails.

### Issues Found

1. Korean and KSL are fundamentally different languages

   Product implication:

   - Korean words cannot be fully replaced one-to-one with sign dictionary entries.
   - The Korean Sign Language dictionary has far fewer directly searchable entries than everyday Korean vocabulary.
   - A sign dictionary video sequence should not be described as complete interpretation.

2. Abstract Korean expressions are difficult to represent through dictionary lookup

   Product implication:

   - Figurative, abstract, or nuanced expressions may not have a direct dictionary sign.
   - The MVP should prefer concrete, intuitive, visually clear words.

3. Homophone and context ambiguity remain a core risk

   Example input:

   ```text
   구름 위로 올라가요
   ```

   Observed issue:

   ```text
   구름 + 위(장기 의미)
   ```

   Problem:

   - The intended meaning is spatial "above/up", not the body organ.
   - In the current KSL dictionary search format, this should be routed to the headword-like query `위다,(나이)한 살 위` rather than the body-organ sense.
   - This is a 동음이의어 resolution problem, not a UI-only issue.

### Product Interpretation

- Position Sonmalgwan as an MVP for basic expressions, vocabulary learning, and feedback collection rather than a full KSL interpreter.
- Make the limitation explicit: dictionary-video composition cannot fully express natural KSL grammar, facial expression, space, and nuance.
- Strengthen context disambiguation for homophones before API search.
- Keep collecting expert review cases as regression tests.

### Follow-up Tasks

- [x] Add a prompt rule for spatial/directional "위" to use `위다,(나이)한 살 위` instead of the body-organ sense.
- [x] Update public copy to explain that the MVP does not replace natural KSL interpretation.
- [ ] Add more regression cases for homophones:
  - "구름 위로 올라가요"
  - "책상 위에 있어요"
  - "위가 아파요"
- [ ] Explore a safer result-selection layer for same-title or same-query senses when the API returns multiple meanings.

### Current Decision

Treat this feedback as product-scope guidance. Sonmalgwan should be honest about its limits and emphasize learning, review, and communication support instead of claiming full translation quality.

## 2026-07-02 · Korean Sign Language Interpreter Association Feedback

Source: Korean Sign Language interpreter association feedback  
Context: Review note about phrase-level dictionary matching and decomposition policy.

Privacy note: Store only the institution-level source and the technical issue. Do not store personal names or contact details.

### Issue Found

Phrase-level expressions can be more accurate than decomposed tokens.

Example input:

```text
비가 내리다
```

Observed issue:

```text
비 + 내리다,하차
```

Problem:

- The verb "내리다" has multiple dictionary senses.
- When decomposed into `비` + `내리다`, the app can select the "get off / 하차" sign.
- The dictionary has a phrase-level entry:

```text
비,강우,비가 내리다
```

### Product Interpretation

- Prefer a matching phrase-level dictionary entry when it exists and matches the sentence meaning.
- Fall back to decomposed tokens only when no phrase-level entry is found.
- This should be a general policy, not a one-word exception for rain.

### Follow-up Tasks

- [x] Add phrase candidates before decomposed Gemini tokens.
- [x] Update frontend phrase selection so any phrase candidate with media can override decomposed tokens.
- [ ] Add regression cases:
  - "비가 내리다"
  - "눈이 내리다"
  - "버스에서 내리다"

### Current Decision

Use the policy "larger exact meaning unit first, decomposed tokens second." This reduces homonym errors such as weather "내리다" being interpreted as vehicle disembarkation.

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
Status: reflected  
Note: Gemini tokenization itself is correct. The result-selection layer now prioritizes the everyday/culture sign sense over the specialized religious sense for this case. Keep this as a regression case for semantic ranking rather than a hardcoded word exception.

### 2026-07-01 16:02

Input: 바빠서 멀리 못 가요  
Observed tokens: 바쁘다 / 멀다 / 가다 / 못  
Feedback: "못"이 negative "cannot"이 아니라 pond-related sign result로 재생됨.  
Status: reflected  
Note: Prompt rules now normalize both negative "안" and negative "못" to the dictionary-search token "부정". Avoid adding source-code word exceptions unless a broader ranking rule is designed.
