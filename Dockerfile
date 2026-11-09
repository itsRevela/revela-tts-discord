# syntax=docker/dockerfile:1

# Kokoro-82M v1.0 packaged for sherpa-onnx. Only the English files are kept.
# fp32 model.onnx is used on purpose: on AVX2 CPUs without VNNI the int8 build
# benchmarked about 2x slower (see documentation/research/).
FROM node:24-slim AS model
ARG KOKORO_MODEL=kokoro-multi-lang-v1_0
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl bzip2 \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${KOKORO_MODEL}.tar.bz2" \
    | tar -xj -C /opt \
 && mkdir -p /models/kokoro \
 && cd "/opt/${KOKORO_MODEL}" \
 && mv model.onnx voices.bin tokens.txt lexicon-us-en.txt espeak-ng-data LICENSE /models/kokoro/

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-slim
ENV NODE_ENV=production \
    KOKORO_MODEL_DIR=/models/kokoro \
    DATA_DIR=/data
WORKDIR /app
COPY --from=model /models/kokoro /models/kokoro
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
CMD ["node", "src/main.ts"]
