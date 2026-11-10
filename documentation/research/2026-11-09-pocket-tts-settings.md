# Pocket TTS inference settings and hallucination reduction (via sherpa-onnx 1.13.8)

Date: 2026-11-09. Method: fetched primary sources (Kyutai repo files on `main` and `v1.0.0`, sherpa-onnx source and docs, GitHub issues). Fetches were summarized by a small model, so exact quotes and line-level claims should be spot-checked before shipping.

## Executive summary

Top recommendations (impact / confidence):

1. **Lower temperature to 0.5-0.6 (try 0.3-0.5 for stock or clean voices).** Impact: high. Confidence: medium.
   - Kyutai's newest code defaults to 0.3 (v1.0.0 defaulted to 0.7). sherpa defaults to 0.7.
   - A user in Kyutai issue #221 reports that 0.3-0.5 reduced inserted and repeated words but did not eliminate them.
   - Our 0.9 is above every vendor default. The extra noise raises the odds of babble and made-up syllables.
   - Fix speaker similarity through the reference audio rather than temperature.
2. **Pass `temperature` inside `extra` and check that it takes effect.** Impact: high. Confidence: medium-high.
   - In the sherpa C++ source, temperature is read with `GetExtraFloat("temperature", 0.7f)`.
   - The HarmonyOS binding's `GetGenerationConfig` has no separate `temperature` field. The node-addon binding was not inspected directly.
   - If we pass temperature as a separate argument, it may be ignored and we would be running at 0.7. Verify with a fixed `seed` and two temperatures.
3. **Use a clean, native-accent reference clip, about 5-10 s, with no noise or music.** Impact: high. Confidence: medium.
   - The model card says the reference's audio quality is reproduced.
   - Issue #221 found that a foreign-accented clone reference made the output drift into the wrong language in 6 of 10 runs, versus 0 of 10 with a native voice.
   - sherpa does not enforce a minimum length. It truncates to `max_reference_audio_len`, which defaults to 10 s. Our belief that only about 1 s is read is not supported by the source (see finding 2.2).
4. **Do text preprocessing ourselves, because sherpa does little.** Impact: high. Confidence: medium-high.
   - Capitalize the first letter.
   - End every chunk with terminal punctuation (".", "?" or "!").
   - Write out digits, symbols and abbreviations as words.
   - Avoid chunks of fewer than about 5 words.
   - Keep sentences short (under about 200 characters, ideally 100-150).
5. **Add an ASR round-trip check and regenerate with a new seed.** Impact: high. Confidence: medium.
   - This is the workaround reported in #221 and by a community project in #226.
   - No Kyutai or sherpa setting eliminates these failures.
6. **numSteps: keep 5 or drop to 2-3. Do not expect step changes to fix hallucinations.** Impact: low. Confidence: low-medium.
   - Kyutai's default is 1 step. The sherpa docs example uses 2 and the Node example uses 5.
   - No source ties step count to hallucination rate.
7. **Lower the `max_frames` extra (default 500) per chunk if runaway babble is the failure.** Impact: low-medium. Confidence: low. This is derived from the code, not from a report.

## 1. Kyutai defaults and guidance

### 1.1 Defaults

| Knob | Kyutai current `main` | Kyutai `v1.0.0` (matches the January export that sherpa ships) |
|---|---|---|
| temperature | 0.3 (`DEFAULT_TEMPERATURE`, config `default_temperature`) | 0.7 |
| sampler / LSD decode steps | 1 (`DEFAULT_SAMPLER_DECODE_STEPS`; `lsd_decode_steps` is deprecated) | 1 |
| EOS threshold | -4.0 | -4.0 |
| noise clamp | None | None |
| frames after EOS | None, so it is guessed from the text | None, so it is guessed from the text |
| max tokens per chunk | 50 (25 with teacher forcing) | 50 |
| CFG | not present in the code | not present in the code |

Sources: `default_parameters.py` on `main` and on `v1.0.0`, `tts_model.py`, and `main.py`.

Notes on these defaults:

- **Frames after EOS in v1.0.0:** if the text has 4 or fewer words the guess is 3, otherwise 1, and then 2 is added (so 5 or 3).
- **Frames after EOS on `main`:** a model-recommended value from the config is used, and otherwise the guess applies.
- **Minimum frames before EOS:** EOS is ignored before step 6 (`_MIN_FRAMES_BEFORE_EOS = 6`, `main`).
- **CLI flags:** the `generate` command has `--temperature`, `--sampler-decode-steps`, `--eos-threshold`, `--frames-after-eos` and `--noise-clamp`.
- **Meaning of the temperature numbers:** the 0.3 default on `main` belongs to newer models than the January bundle that sherpa ships. Kyutai's 0.7 for the v1 model matches sherpa's 0.7 default.

### 1.2 Text handling in Kyutai (`v1.0.0` `prepare_text_prompt`)

- Strip whitespace.
- Replace newlines with spaces and collapse double spaces.
- Capitalize the first character.
- Append "." if the last character is alphanumeric.
- If the text has fewer than 5 words, prepend 8 spaces (short-input padding).
- `split_into_best_sentences` groups sentences up to 50 tokens per chunk.

On `main` these are options: `pad_with_spaces_for_short_inputs=False`, `append_terminal_punctuation=True`, `capitalize_first_letter=True`, `remove_semicolons=False`, `replace_characters`.

### 1.3 Reference audio

- The README and model card say to clean the sample first because its quality is reproduced.
- Unsupported features: pauses and silence markers.
- The card claims the model handles "infinitely long text", but this is done by chunking at 50 tokens or fewer.
- Not found: a recommended reference length, a hallucination section, or any blog or paper tuning guidance. The model card has no hallucination section.

## 2. What sherpa-onnx exposes

Source: `sherpa-onnx/csrc/offline-tts-pocket-impl.h` on `master`.

### 2.1 Knobs and names

| Knob | Where | Default | Notes |
|---|---|---|---|
| `num_steps` | `GenerationConfig.numSteps` field | 5 | Flow-matching steps, with `dt = 1/num_steps`. |
| `temperature` | `extra.temperature` | 0.7 | Noise std is `sqrt(temperature)`. 0.9 gives about 0.95, 0.7 gives about 0.84, 0.5 gives about 0.71, and 0.3 gives about 0.55. |
| `seed` | `extra.seed` | -1 (random) | Use a fixed seed to reproduce and compare. |
| `max_frames` | `extra.max_frames` | 500 | Per-sentence cap. |
| `frames_after_eos` | `extra.frames_after_eos` | 3 | Fixed, not guessed from the text. |
| `chunk_size` | `extra.chunk_size` | 15 | Decoder chunking only, not a text knob. |
| `max_reference_audio_len` | `extra.max_reference_audio_len` | 10 (seconds) | Truncates the reference. The Node example sets 12. |
| `max_char_in_sentence` | `extra.max_char_in_sentence` | 200 | Splits long sentences. |
| `min_char_in_sentence` | `extra.min_char_in_sentence` | 30 | Merges short sentences. |
| `silence_scale` | `GenerationConfig.silenceScale` | not checked | Read from the field, not from `extra`. |

### 2.2 Fixed behaviors

- **EOS threshold:** hardcoded at logit greater than -4 (`p_logit[0] > -4`). It cannot be changed through config. It matches Kyutai's default.
- **EOS at step 0:** the stop check is `eos_step > 0`, so an EOS at step 0 never stops generation. The result is a run to `max_frames` (500 frames). This is a plausible cause of long babble on very short inputs. This is our inference from the code and is unconfirmed by any report.
- **Noise clamp and CFG:** neither exists in sherpa.
- **Text preparation:** sherpa does not capitalize, add terminal punctuation, or pad short text (confirmed in the fetched source). It does apply optional text-normalization FSTs and splits by punctuation. This is a difference from Kyutai's reference pipeline, which the January model was likely trained and tested with. We must do this ourselves.
- **Reference length:** the cap is 10 s by default and there is no minimum. The reference is resampled to 24 kHz and the voice embedding is cached by audio hash. The claim that the export reads only about 1 s was not found in the source. If we measured that, our own wrapper or file may be trimming it. Check what we actually pass.
- **Passing options from Node:**
  - The Node/Harmony `GetGenerationConfig` parses `numSteps`, `referenceAudio` and `extra` (an object serialized to JSON).
  - A separate `temperature` field was not seen. The official Node example passes only `extra: {max_reference_audio_len, seed}`.
  - The C++ header documents `extra` as a string map. The Node examples pass numbers. Whether numbers convert correctly was not verified.
- **Official docs:** k2-fsa.github.io/sherpa/onnx/tts/pocket.html does not mention temperature or `extra` keys. The doc example uses `--num-steps=2`.

## 3. Reported hallucination causes and fixes

No sherpa-onnx issue about Pocket hallucination was found. Searching surfaced only #3755, a feature request: newer Kyutai exports (French, distilled v2) are not supported, and the current implementation works only with the January English bundle. The Kyutai issues below involve newer models than the January one, so applicability to our model is uncertain.

| Issue | Finding | Applies to us |
|---|---|---|
| Kyutai #347 | Final phrase repeated ("an hour an hour"). The maintainer says the `english_2026-09` model was trained on data that only weakly taught it when to stop. `eos_threshold`, `temp` and rewording did not fix it. A comma helped partially. The fix was a retrained model, `english_2026-09_2`. A user still saw repeats with it (5 of 10 seeds on one text). | Probably not, because we use the older January model. It shows that end-of-text repetition is a model issue that knobs do not fix. |
| Kyutai #221 | Intermittent inserted or repeated words with exported voice profiles. A foreign-accent reference made the output drift into the wrong language. Lowering temp to 0.3-0.5 helped partially. The reporter used ASR round-trip checking and regenerated bad takes. No maintainer response. The issue is open. | Yes, for the reference-accent, temperature and ASR points. |
| Kyutai #410 | Spanish digits come out as invented words. Writing the numbers out fixes it. | Yes (digits). |
| Kyutai #216 | Number articulation issues (title only). | Yes (digits). |
| Kyutai #348 | Model is fragile with unpunctuated data (fine-tuning, title only). | Weak support for always punctuating. |
| Kyutai #226 | Community project with pause, speed and temperature markup plus a pipeline that detects and regenerates hallucinated or truncated segments, optionally with ASR cross-checking. | The pipeline idea applies. |

Secondary sources, not reviewed in depth:

- A Talemate guide says a lower Pocket temperature gives more consistent output.
- A third-party skill page suggests 0.5-1.0 (unverified).
- A React Native wrapper suggests reference clips of 3-10 s (not from sherpa).

## 4. Detailed recommendations

| # | Action | Impact | Confidence |
|---|---|---|---|
| 1 | Set temperature to 0.5 and A/B at 0.3, 0.5 and 0.7 with a fixed seed. Use ASR error rate as the metric. | High | Medium |
| 2 | Put `temperature` in `extra`. Test that changing it changes the output at a fixed seed. | High | Medium-high |
| 3 | Use a 5-10 s clean, native-accent, mono, single-speaker reference with no music or reverb, trimmed of leading silence. Set `max_reference_audio_len` explicitly (10-12). Confirm what length we actually pass. | High | Medium |
| 4 | Preprocess each chunk. Capitalize the first letter. End with ".", "?" or "!". Expand digits, symbols, abbreviations and URLs. Replace semicolons, em-dashes and ellipses with commas or periods (the `remove_semicolons` option on Kyutai's `main` suggests semicolons are problematic, but no report was found). Strip emoji and markup. | High | Medium-high for punctuation, digits and capitalization. Low for the specific characters. |
| 5 | Chunk to about 100-150 characters (under the sherpa 200 default; Kyutai uses 50 tokens or fewer). Merge fragments under about 5 words with a neighbor, since Kyutai pads short inputs. Our `maxNumSentences: 1` is fine. | Medium | Medium |
| 6 | Cap `max_frames` (for example about 12.5 frames/s x expected seconds x 1.5). The 12.5 Hz frame rate is an assumption from Mimi, not confirmed in the fetched sources. | Low-medium | Low |
| 7 | Add an ASR round-trip check with a bounded retry (2-3 attempts with new seeds, a slightly lower temperature on retry). | High | Medium |
| 8 | Keep `numSteps` at 5 or lower it to 2-3 for speed. Treat it as a speed and quality knob, not a hallucination fix. | Low | Low-medium |
| 9 | Optionally test `frames_after_eos` at 3 versus 5 for truncated word endings. | Low | Low |

## 5. Caveats and gaps

- sherpa ships the January 2026 English bundle (`sherpa-onnx-pocket-tts-int8-2026-01-26`, int8 models). Kyutai `main` documents newer models and a different default temperature (0.3). Apply the `main` numbers only as a loose guide.
- No source gives an evidence-based temperature or step sweep for the January model. All numeric suggestions above are starting points to test, not vendor guarantees.
- No Kyutai blog or paper tuning guidance was located.
- The user-reported "reads about the first 1 s of the reference" was not corroborated.
- GitHub issue lists were read from first pages only and may be incomplete.
- sherpa's `SplitByPunctuation`, `MergeShortSentences` and `SplitLongSentence` were not read, so their exact behavior is unknown.
- Whether sherpa-onnx adds a seed-less default that makes runs non-reproducible is as noted in 2.1 (seed -1 means random).

## Sources

All accessed 2026-11-09. File contents are from the default branch at access time unless a tag is noted.

- https://github.com/kyutai-labs/pocket-tts (README, current)
- https://huggingface.co/kyutai/pocket-tts (model card, current)
- https://raw.githubusercontent.com/kyutai-labs/pocket-tts/main/pocket_tts/default_parameters.py (main)
- https://raw.githubusercontent.com/kyutai-labs/pocket-tts/main/pocket_tts/models/tts_model.py (main)
- https://raw.githubusercontent.com/kyutai-labs/pocket-tts/main/pocket_tts/main.py (main)
- https://raw.githubusercontent.com/kyutai-labs/pocket-tts/v1.0.0/pocket_tts/default_parameters.py (tag v1.0.0, early 2026)
- https://raw.githubusercontent.com/kyutai-labs/pocket-tts/v1.0.0/pocket_tts/models/tts_model.py (tag v1.0.0)
- https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/sherpa-onnx/csrc/offline-tts-pocket-impl.h (master)
- https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/harmony-os/SherpaOnnxHar/sherpa_onnx/src/main/cpp/non-streaming-tts.cc (master; Harmony binding, not the Node addon)
- https://k2-fsa.github.io/sherpa/onnx/tts/pocket.html (docs)
- https://k2-fsa.github.io/sherpa/onnx/javascript-api/examples/tts_pocket.html (docs, Node example)
- https://k2-fsa.github.io/sherpa/onnx/c-api/html/structsherpa__onnx_1_1cxx_1_1GenerationConfig.html (docs)
- https://github.com/kyutai-labs/pocket-tts/issues/347 (issue, Oct 2026)
- https://github.com/kyutai-labs/pocket-tts/issues/221 (issue, Jul 2026 comment)
- https://github.com/kyutai-labs/pocket-tts/issues/226 (issue, community project)
- https://github.com/kyutai-labs/pocket-tts/issues (listing for #410, #216, #348; titles only)
- https://github.com/k2-fsa/sherpa-onnx/issues?q=pocket (listing, #3755; titles only)
- https://vegu-ai.github.io/talemate/user-guide/agents/voice/pocket-tts/ (third party, undated)
- https://www.mintlify.com/xdcobra/react-native-sherpa-onnx/api/tts/configuration (third party wrapper, undated, unverified)
