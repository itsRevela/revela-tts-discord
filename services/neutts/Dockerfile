# syntax=docker/dockerfile:1
# Neuphonic NeuTTS behind a small HTTP server (server.py). The GGUF backbone and
# ONNX codec are gated on Hugging Face; they download on first start using
# HF_TOKEN into the mounted cache, not at build time.

ARG NEUTTS_COMMIT=ac69851f28fc63a487917e7c2e27f0d75c759cba

FROM python:3.12-slim AS build
ARG NEUTTS_COMMIT
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake pkg-config git curl ca-certificates libopenblas-dev \
 && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH PIP_NO_CACHE_DIR=1
# CPU-only PyTorch first, so neutts does not pull the multi-gigabyte CUDA build.
RUN pip install "torch>=2.8" "torchaudio>=2.8" --index-url https://download.pytorch.org/whl/cpu
# llama.cpp compiled for this machine's CPU, with OpenBLAS for prompt processing.
RUN CMAKE_ARGS="-DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS -DGGML_NATIVE=ON" \
    pip install "neutts[llama,onnx] @ git+https://github.com/neuphonic/neutts@${NEUTTS_COMMIT}" \
                "fastapi==0.162.2" "uvicorn==0.54.0"
# neucodec imports torchtune 0.6.1 (its last release), which needs
# torchao.dtypes.nf4tensor; torchao 0.18 removed it, so stay on 0.17.
RUN pip install "torchao==0.17.0"
# The English sample voices (pre-encoded references and transcripts) from the same commit.
RUN mkdir -p /opt/neutts/voices \
 && for voice in dave emily jo paul sophie steven; do \
      for ext in pt txt; do \
        curl -fsSL -o "/opt/neutts/voices/${voice}.${ext}" \
          "https://raw.githubusercontent.com/neuphonic/neutts/${NEUTTS_COMMIT}/samples/${voice}.${ext}"; \
      done; \
    done

FROM python:3.12-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends espeak-ng libopenblas0 libgomp1 libsndfile1 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 1000 neutts \
 && mkdir -p /home/neutts/.cache/huggingface \
 && chmod 755 /home/neutts \
 && chmod -R 1777 /home/neutts/.cache
COPY --from=build /opt/venv /opt/venv
COPY --from=build /opt/neutts /opt/neutts
COPY server.py voice_prep.py text_chunks.py /opt/neutts/
# Compose runs this as Unraid's nobody:users (99:100) so it can write prepared
# voices next to the bot's data; the caches are world-writable for that reason.
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    HOME=/home/neutts \
    XDG_CACHE_HOME=/home/neutts/.cache \
    HF_HOME=/home/neutts/.cache/huggingface \
    NUMBA_CACHE_DIR=/tmp/numba
USER neutts
WORKDIR /opt/neutts
EXPOSE 8880
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8880", "--workers", "1"]
