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
- The app should expose or document its target signing style.
- Playback needs a smoother experience, not only correct token matching.

### Follow-up Tasks

- [ ] Strengthen the prompt rule for "안" as negation vs inside.
- [ ] Add regression examples for:
  - "학교가서 공부 안하고 쉬고 싶어"
  - "밥 안 먹었어"
  - "집 안에서 쉬고 싶어"
- [ ] Decide and document MVP signing style: 농식수어 vs 문장식 수어.
- [ ] Explore smoother playback:
  - reduced gap between clips
  - clearer subtitle/caption bridge
  - optional manual step mode
  - possible transition screen between signs
- [ ] Ask follow-up questions to the reviewer about preferred target style and acceptable video sequencing.

### Current Decision

Do not treat this as a simple API-ranking bug. This is a semantic parsing and product-direction issue. Prioritize prompt and UX changes before adding more data sources.
