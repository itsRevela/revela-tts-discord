# syntax=docker/dockerfile:1
# Kyutai's official Pocket TTS (pocket-tts) behind a small HTTP server (server.py).
# Model weights download on first start into the mounted cache. Voice cloning
# needs the gated kyutai/pocket-tts weights: accept their terms on Hugging Face
# and set HF_TOKEN.

FROM python:3.12-slim AS build
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH PIP_NO_CACHE_DIR=1
# CPU-only PyTorch first, so pocket-tts does not pull the multi-gigabyte CUDA build.
RUN pip install "torch>=2.8" --index-url https://download.pytorch.org/whl/cpu
# soundfile lets pocket-tts read recordings that are not 16-bit WAV (24-bit, float, FLAC).
RUN pip install "pocket-tts==4.0.1" "soundfile==0.13.1" "fastapi==0.162.2" "uvicorn==0.54.0"

FROM python:3.12-slim
RUN useradd --create-home --uid 1000 pocket \
 && mkdir -p /home/pocket/.cache \
 && chmod 755 /home/pocket \
 && chmod -R 1777 /home/pocket/.cache
COPY --from=build /opt/venv /opt/venv
COPY *.py /opt/pocket/
# Compose runs this as Unraid's nobody:users (99:100); the cache is world-writable for that reason.
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    HOME=/home/pocket \
    XDG_CACHE_HOME=/home/pocket/.cache \
    HF_HOME=/home/pocket/.cache/huggingface
USER pocket
WORKDIR /opt/pocket
EXPOSE 8880
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8880", "--workers", "1"]
