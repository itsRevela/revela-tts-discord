# syntax=docker/dockerfile:1
# Each model gets its own stage and ends up in /models/<model id>.

# Kokoro-82M v1.0 packaged for sherpa-onnx, with its English and Mandarin text frontends.
# fp32 model.onnx is used on purpose: on AVX2 CPUs without VNNI the int8 build
# benchmarked about 2x slower (see documentation/research/).
FROM node:24-slim AS kokoro
ARG KOKORO_MODEL=kokoro-multi-lang-v1_0
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl bzip2 \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${KOKORO_MODEL}.tar.bz2" \
    | tar -xj -C /opt \
 && mkdir -p /models/kokoro \
 && cd "/opt/${KOKORO_MODEL}" \
 && mv model.onnx voices.bin tokens.txt lexicon-us-en.txt lexicon-zh.txt dict \
       date-zh.fst phone-zh.fst number-zh.fst espeak-ng-data LICENSE /models/kokoro/

# Kyutai Pocket TTS exported for sherpa-onnx, plus Kyutai's English voice catalog.
# POCKET_VARIANT=int8 builds the smaller, ~35% faster variant instead.
FROM node:24-slim AS pocket
ARG POCKET_VARIANT=fp32
ARG POCKET_RELEASE=2026-01-26
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl bzip2 \
 && rm -rf /var/lib/apt/lists/*
RUN case "$POCKET_VARIANT" in \
      int8) suffix="int8-" ;; \
      fp32) suffix="" ;; \
      *) echo "POCKET_VARIANT must be fp32 or int8" >&2; exit 1 ;; \
    esac \
 && name="sherpa-onnx-pocket-tts-${suffix}${POCKET_RELEASE}" \
 && curl -fsSL "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${name}.tar.bz2" \
    | tar -xj -C /opt \
 && rm -rf "/opt/${name}/test_wavs" \
 && mkdir -p /models \
 && mv "/opt/${name}" /models/pocket
COPY src/tts/models/pocket/voices.ts /build/src/tts/models/pocket/voices.ts
COPY scripts/fetch-pocket-voices.ts /build/scripts/fetch-pocket-voices.ts
RUN node /build/scripts/fetch-pocket-voices.ts /models/pocket

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-slim
ENV NODE_ENV=production \
    MODELS_DIR=/models \
    DATA_DIR=/data
WORKDIR /app
COPY --from=kokoro /models/kokoro /models/kokoro
COPY --from=pocket /models/pocket /models/pocket
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
CMD ["node", "src/main.ts"]
