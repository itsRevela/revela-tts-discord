# TTS model selection for a self-hosted Discord TTS bot (Node.js, Unraid, Ryzen 5 5500 / GTX 960 2 GB)

Date: 2026-11-09. Hardware (confirmed): Ryzen 5 5500 (Zen 3, 6C/12T, AVX2+FMA, no AVX-512), 31 GB RAM, GTX 960 2 GB (sm_52), NVIDIA driver 580.82.09, Unraid 7.1.4, Docker nvidia runtime. Node.js bot, English only, cloning possibly later, personal use. Target: 5-40 word messages, first audio well under 1 s.

## Executive summary

1. **kitten-tts-2: no.** Despite the name it is a ~1.7B-parameter speech language model, not the tiny Kitten models. Its docs call the Python package "for demo only, and not optimized for speed". The only published speeds are GPU: 2.05 s median for a 61-character sentence on an RTX 3060 with vLLM, 6 s with PyTorch. CPU real time depends on a beta C++ fork with no published numbers. Python-only, revocable non-OSI weights license, needs ~6 GB RAM on CPU or ~8 GB VRAM. (Confidence high.)
2. **Breeze TTS 2: no.** It is BreezeBlue's 3B model (released 2026-08-25; not MediaTek's Breeze/BreezyVoice, which is a different project). Strong leaderboard results, but official inference needs a CUDA GPU with 12-24 GB, weights are non-commercial, and there is no CPU or Node path. Even the community 4-bit GGUF (2.4 GB file, about 3.4 GB VRAM) cannot fit in 2 GB, and its published speeds (2-3.5x real time on an RTX 3060/3080) are far slower than a small CPU model. (Confidence high.)
3. **The CPU is the real target.** The Ryzen 5 5500 is close to the Ryzen 7 5700X (also Zen 3) that Picovoice benchmarked, so small ONNX models (Kokoro, Pocket, Supertonic) should be faster than real time. The GTX 960 adds little: PyTorch dropped Maxwell from CUDA 12.8+ wheels, CUDA 13 libraries need sm_75+, and 2 GB VRAM only fits the same small models that already run on CPU.
4. **Pick (Node-first, CPU): Kokoro-82M via `sherpa-onnx-node`** (or `kokoro-js`). **Runner-up: Pocket TTS**, also via sherpa-onnx-node: true streaming and the cloning upgrade path. **Speed option: Supertonic-3 5-step.** No GPU pick.
5. **Surprises.** Chatterbox/Turbo was retired Aug 2026; Supertonic's open repo was archived Sep 2026; original Piper archived Oct 2025. sherpa-onnx's Node addon covers Kokoro, Pocket (with cloning), Supertonic and Kitten nano v0.1, so a pure-Node stack is realistic. The two big new names (Kitten 2, Breeze 2) both target GPUs far beyond this server.

## 1. The two named options, side by side

Vendor claims unless marked independent.

| Item | kitten-tts-2 | Breeze TTS 2 |
|---|---|---|
| Publisher / URL | Stellon Labs, https://huggingface.co/KittenML/kitten-tts-2 | BreezeBlue (RESONIA, INC.), https://huggingface.co/BreezeBlue/Breeze-TTS-2 , code `breezeblue-ai/breeze-tts` |
| Release | ~2026-09-30 HF, PyPI 0.9.4 ~2026-10-06 (secondary) | 2026-08-25 weights and PyTorch code (model card) |
| Size / architecture | ~1.7B; Qwen3-style LM over text plus S3 codec tokens. Weights 954 MB packed, 469 MB emb4, 3.47 GB bf16 | 3B; audio tokenizer based on Qwen3-TTS, backbone plus depth decoder. F32/BF16 |
| Runtime | Python 3.10+, PyTorch; beta C++ llama.cpp fork; vLLM on NVIDIA (driver 580+, ~8 GB VRAM) | Python 3.10+, PyTorch, Linux, CUDA GPU required; Docker targets H100 (sm90), A100 via build flag. Community Breeze-TTS-2.cpp (ggml, Vulkan, Apache-2.0 code), community MLX/ComfyUI/int4 ports |
| Speed | RTX 3060 vLLM 2.05 s for 61 chars; PyTorch 6 s; A100 ~0.78 s per audio second. No CPU numbers (vendor docs via andrew.ooo review, which did not run it) | H100, warmed fast path: under 40 ms first audio, RTF 0.32 (model card; other pages cite 127-134 ms p50 or under 25 ms, so figures conflict). Community GGUF on Vulkan, one stream: RTX 3060 about 2.0x (q8_0) to 2.4x (q4_k) real time; RTX 3080 about 3.2-3.5x. No CPU numbers anywhere. Artificial Analysis: ~45 chars/s vs Fish S2 Pro 102. |
| Memory | CPU ~6 GB RAM; GPU ~8 GB | Eager 7.7 GiB VRAM (12 GB GPU minimum), fast path 14.4 GiB (24 GB GPU). GGUF: file size plus ~1 GB (q4_k 2.4 GB -> ~3.4 GB) |
| Fits GTX 960 2 GB / sm_52? | No | No: official path needs 7.7+ GiB and a modern CUDA build; even smallest GGUF exceeds 2 GB, and Vulkan on Maxwell at ~2x real time on a 3060 would be slower here |
| Ryzen 5 5500 estimate | Not real time via the Python package (own docs: demo only). C++ fork unmeasured. Do not expect sub-second | No supported CPU path; community GGUF "falls back to CPU" with no figures. A 3B model on 6 Zen 3 cores would most likely be well below real time (my inference, not measured) |
| Streaming | Chunk-level only; short messages are one chunk | Yes (single-concurrency streaming API, 24 kHz mono PCM) |
| Quality evidence | None independent (no Arena entry, no listening test) | Mixed: Artificial Analysis (independent) says it leads open-weight models on its Speech Arena by 90 Elo over Fish S2 Pro (reported as 1,215 Elo on BreezeBlue's page and 1,002 on a different board; the figures conflict). Leaderboard of the whole field, so strong, but it only ranks voices, not CPU feasibility |
| Languages | 16-20 (English-tuned normalizer) | English and Chinese per model card (aggregator pages claim 50 languages; conflict, unverified) |
| Cloning | Yes, 5-30 s | Yes, clean reference plus exact transcript; also voice design from a text prompt and direction tags |
| Sample rate | 24 kHz | 24 kHz |
| License | Code Apache-2.0; weights Stellon community license (revocable, attribution, commercial cap) | Code and tokenizer Apache-2.0; weights, derivatives and self-hosted outputs under BreezeBlue Research and Non-Commercial License; commercial needs RESONIA authorization. Fine for personal use, but stricter than Kitten 2 on outputs |
| Node path | None (Python sidecar) | None official; community C++ server has HTTP/WebSocket, so a Node client is possible, GPU only |
| Maturity | 97 open issues, 51 PRs; normalizer bugs | Young (about 2.5 months); HF discussions open; ~860k downloads reported for the GGUF repo (secondary) |

**Verdict.** Neither is suitable for this server. Kitten 2 is the less bad of the two for hardware (it can run on CPU in principle), but both are Python/CUDA-first LM TTS aimed at 8-24 GB GPUs and neither gives sub-second first audio on a 2 GB Maxwell card or a Ryzen 5 5500. Breeze TTS 2 is the better-sounding and better-evidenced model on the leaderboard and worth revisiting if the server ever gets a 12 GB+ RTX card; at that point it would be a Python or C++ sidecar, non-commercial only.

The legacy Kitten 0.8 nano (ONNX, Apache-2.0) is a different product; Picovoice (vendor-biased) measured ~10.5 s to first audio and its quality is below Kokoro's. Not recommended.

## 2. Hardware viability

### GTX 960 (2 GB, sm_52)

| Question | Finding | Source quality |
|---|---|---|
| Driver | 580 is the last branch supporting Maxwell. You are on 580.82.09, fine; do not move to 590+. "CUDA 13.0 reported" is the driver's maximum; it still runs CUDA 12.x containers. | NVIDIA schedule via press (secondary) |
| PyTorch | Maxwell/Pascal removed from CUDA 12.8/12.9 wheels; CUDA 12.6 is the last build with Maxwell and cu126 wheels stop at PyTorch 2.15. Only an old pinned cu126 PyTorch works. | PyTorch dev-discuss (primary) |
| CUDA 13 | Minimum sm_75; Maxwell unsupported. | Secondary table plus PyTorch notice |
| ONNX Runtime | v1.27+ PyPI GPU wheels use CUDA 13.0 (no Maxwell); 1.21-1.26 use CUDA 12.8. Whether they ship sm_52 kernels is **unverified**. sherpa-onnx Node docs show only `provider: 'cpu'`. | ORT docs; gap |

**What fits in 2 GB VRAM** (my estimates from parameter counts, not measured):

- Fits: Kokoro-82M (~0.3 GB weights), Pocket TTS (100M), Supertonic-3 (99M), Piper/VITS voices. All already run faster than real time on your CPU.
- Does not fit: kitten-tts-2 (3.5 GB bf16, ~8 GB for vLLM), Breeze TTS 2 (7.7 GiB eager, 2.4 GB smallest GGUF plus ~1 GB), Qwen3-TTS 0.6B/1.7B (needs FP16/FlashAttention Maxwell lacks), Chatterbox Turbo (retired), Orpheus 3B, Dia 1.6B (4.4 GB), Fish S2 Pro 5B, F5-TTS.

**Conclusion:** run on CPU. The only GPU route is a Python sidecar (e.g. Kokoro-FastAPI GPU image, CUDA 12.6 per its README; not verified on sm_52). Its published ~300 ms first token is on a 4060 Ti, a different class; for you the gain over a 6-core Zen 3 is small.

### Ryzen 5 5500 latency sizing

Closest published data: Picovoice on a Ryzen 7 5700X (Zen 3, 8C), 2026-07-14, updated 2026-08-18; vendor-biased (it sells Orca). The 5500 has 6 cores and a slightly lower boost clock, so expect roughly 10% lower per-core speed and ~25% lower multi-thread throughput. Independent anchor: heyneo on a 4-core Xeon 8272CL (2026-07-06).

| Model | Picovoice 5700X: FTTS / core-hour ratio | heyneo 4-core Xeon RTF | Estimated Ryzen 5 5500 (inference, not measured) |
|---|---|---|---|
| Kokoro-82M | 3,658 ms / 1.28x | 0.64 (ONNX) | RTF ~0.3-0.5 with 6 threads. 20 words (~7 s audio) ~2-3.5 s whole; first sentence chunk ~0.7-1.3 s |
| Pocket TTS | 1,713 ms / 0.37x | 0.71; repo: 2.3-2.5x RT on 4 vCPU x86, ~200 ms first chunk (vendor) | RTF ~0.3-0.4; streaming, first audio ~0.3-0.8 s |
| Supertonic | 2,612 ms (v2) / 0.52x | 0.24 (5-step); 0.50 s tiny text | RTF ~0.15-0.25; 20 words ~1-1.8 s, 5 words ~0.4 s; not streamed |
| Piper | 1,720 ms / 0.35x | n/a | Fastest, lower quality |

Picovoice's numbers are much slower than heyneo's tiny-text numbers, so first audio for Kokoro is plausibly 0.5-1.5 s; sentence-level streaming is the main lever. **Estimates only. Benchmark on the box.** With 12 threads, give TTS 4-6 intra-op threads and keep the rest for the bot and Opus encoding.

## 3. Shortlist comparison (CPU)

UTMOS is predicted MOS and can over-rate clean robotic output.

| Model | Quality | Streaming | Cloning | License | Node path | Phonemizer | Sample rate |
|---|---|---|---|---|---|---|---|
| **Kokoro-82M** (54 voices) | Best small model: UTMOS 4.44; Arena 1478 (listed retired) | Sentence/chunk | No | Apache-2.0 | `sherpa-onnx-node`; `kokoro-js` (q8/q4) | espeak-ng data bundled in sherpa archives; kokoro-js has a JS phonemizer | 24 kHz |
| **Pocket TTS** (100M, 26 voices, EN/FR/DE/PT/IT/ES) | UTMOS 4.10 | True streaming | Yes, ~5 s WAV (gated cloning weights) | Code MIT, weights CC-BY-4.0 | `sherpa-onnx-node` (cloning example); official Python server | None noted | Not stated on card |
| **Supertonic-3** (99M) | UTMOS 4.32 at 5 steps (2-step 1.53, unusable) | No | No | Code MIT, model OpenRAIL-M; upstream archived Sep 2026 | `sherpa-onnx-node`; official Node example | None | Not verified |
| Piper | Dated | Yes | No | Engine GPL-3.0, per-voice licenses; original repo archived Oct 2025 | sherpa-onnx VITS | espeak-ng | ~22 kHz (unverified) |
| Kitten nano 0.8 | Lower | No | No | Apache-2.0 | sherpa-onnx-node (nano v0.1 fp16) | espeak-ng data bundled | 24 kHz |

Excluded: Chatterbox/Turbo (retired Aug 2026; 48 s latency on CPU per Picovoice), Qwen3-TTS (CUDA only in practice; Apache-2.0; revisit with a bigger card), Orpheus, Dia, Fish S2 Pro (research license), F5-TTS (CC-BY-NC weights), Coqui XTTS-v2 (defunct; from prior knowledge, not re-verified), Soprano (Picovoice: 1.7 s FTTS, 4.1x core-hour; repo fetch timed out).

## 4. Recommendations

| # | Recommendation | Impact | Confidence |
|---|---|---|---|
| 1 | Do not use kitten-tts-2 or Breeze TTS 2 on this server. | High | High |
| 2 | Run on CPU; skip the GTX 960; keep driver at 580.x. | High | Medium-high |
| 3 | **Kokoro-82M via `sherpa-onnx-node`**, int8, sentence-split and stream chunks to the Opus encoder. Expect ~0.7-1.3 s to first audio (estimate). | High | Medium |
| 4 | **Pocket TTS** as runner-up and cloning path (CC-BY attribution, gated cloning weights). Prefer it if first-audio latency matters more than the last bit of naturalness. | Medium | Medium |
| 5 | Supertonic-3 5-step if Kokoro is too slow (archived upstream, OpenRAIL-M). Never 2-step. | Medium | Medium |
| 6 | Put engines behind a text-in / PCM-out interface; sherpa-onnx-node exposes all three via `OfflineTts`, so a bake-off is cheap. | Medium | High |

## 5. Discord and Node notes

- Discord wants 48 kHz stereo Opus; candidates output ~22-24 kHz mono, so resample and duplicate channels. Cheap.
- Node-native: Kokoro, Pocket, Supertonic, Piper, Kitten nano. Python/CUDA sidecar only: kitten-tts-2, Breeze TTS 2, Qwen3-TTS, Orpheus, Dia, F5, Chatterbox.
- espeak-ng data ships inside sherpa tarballs for Kokoro/Piper/Kitten (espeak-ng is GPL; relevant if redistributing). Supertonic and Pocket need no espeak per their sherpa configs.
- Docker: `node:*-slim` plus `sherpa-onnx-node` and mounted models; no CUDA layers. Pin `sherpa-onnx-node` (seen at 1.12.19); model filenames changed in 2026.

## 6. Gaps

- No independent Node latency numbers for sherpa-onnx-node or kokoro-js; Ryzen estimates are extrapolated.
- Breeze: the official model card says English and Chinese, aggregators say 50 languages; latency and Elo figures differ between pages. No CPU numbers exist for either Breeze or Kitten 2. The name "Breeze TTS 2" resolved unambiguously to BreezeBlue's release; I did not find any link to MediaTek's Breeze/BreezyVoice.
- TTS Arena not fetched live; Elo values from the yaps.ai roundup. sherpa-onnx GitHub and Soprano fetches timed out.

## Sources

- KittenML/kitten-tts-2 card, https://huggingface.co/KittenML/kitten-tts-2 (2026-11-09; vendor); README https://github.com/KittenML/KittenTTS
- andrew.ooo review, https://andrew.ooo/posts/kittentts-review-cpu-text-to-speech-voice-cloning/ (2026-10-19; secondary); Better Stack, https://betterstack.com/community/guides/ai/kitten-tts-2.md
- Breeze TTS 2 card, https://huggingface.co/BreezeBlue/Breeze-TTS-2 (2026-11-09; vendor); GGUF port, https://huggingface.co/HoppouAI/Breeze-TTS-2.cpp (community); MindStudio, https://www.mindstudio.ai/blog/breeze-tts-2-open-weight-model (secondary); Artificial Analysis post, https://x.com/ArtificialAnlys/status/2092399623839326550 (independent leaderboard, via search snippet); BreezeBlue, https://breezeblue.ai/breeze-tts-2 (vendor)
- heyneo benchmark, https://heyneo.com/blog/kokoro-supertonic-inflect-nano-pocket-tts-cpu-benchmark (2026-07-06; independent)
- Picovoice, https://picovoice.ai/blog/on-device-tts/ (2026-07-14, upd. 2026-08-18; vendor-biased)
- Yaps roundup, https://www.yaps.ai/blog/best-local-tts-models (2026-10-10)
- Pocket TTS, https://github.com/kyutai-labs/pocket-tts ; https://huggingface.co/kyutai/pocket-tts
- Chatterbox (retired), https://github.com/resemble-ai/chatterbox
- Kokoro-FastAPI, https://github.com/remsky/Kokoro-FastAPI ; Kokoro, https://github.com/hexgrad/kokoro
- Qwen3-TTS, https://github.com/QwenLM/Qwen3-TTS
- Supertonic archive, https://huggingface.co/supertone-archive/supertonic
- sherpa-onnx Node examples: https://csukuangfj.github.io/sherpa/onnx/javascript-api/examples/tts_kitten.html ; https://csukuangfj.github.io/sherpa/onnx/javascript-api/examples/tts_supertonic.html ; https://k2-fsa.github.io/sherpa/onnx/javascript-api/examples/tts_pocket.html ; https://csukuangfj.github.io/sherpa/onnx/javascript-api/examples/tts_kokoro_zh_en.html
- kokoro-js README, https://app.unpkg.com/kokoro-js@1.2.1/files/README.md
- PyTorch Maxwell removal, https://dev-discuss.pytorch.org/t/cuda-toolkit-version-and-architecture-support-update-maxwell-and-pascal-architecture-support-removed-in-cuda-12-8-and-12-9-builds/3128 ; cu126 end, https://dev-discuss.pytorch.org/t/notice-cuda-12-6-wheels-will-no-longer-be-published-from-pytorch-2-15-drops-maxwell-pascal-volta/3432
- ONNX Runtime CUDA EP, https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html
- NVIDIA 580 last Maxwell branch, https://www.tomshardware.com/pc-components/gpu-drivers/nvidia-to-axe-maxwell-pascal-and-volta-gpus-with-end-of-driver-support-580-series-drivers-will-be-the-last-to-support-gtx-900-and-1000-cards (secondary)
