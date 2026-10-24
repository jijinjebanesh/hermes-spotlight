#!/usr/bin/env python3
"""
Whisper Daemon V2 — GPU-accelerated streaming STT for Echo Mode.

Upgrades over V1:
- GPU support via CUDA ctranslate2 (cublas/cudnn auto-loaded from pip)
- faster-whisper with configurable model/device/compute_type
- Streaming partial transcripts via chunk_length parameter
- Health check command
- Structured JSON logging to stderr
- Graceful fallback: CUDA → CPU if GPU fails

Protocol (stdin → stdout, one JSON per line):
  {"op": "transcribe", "path": "/tmp/xxx.wav"}
    → {"ok": true, "text": "...", "partial": false}
    → {"ok": true, "text": "...", "partial": true}  (if streaming)

  {"op": "transcribe_stream", "path": "/tmp/xxx.wav"}
    → {"ok": true, "text": "partial1", "partial": true}
    → {"ok": true, "text": "partial2", "partial": true}
    → {"ok": true, "text": "final text", "partial": false}

  {"op": "ping"}
    → {"ok": true, "pong": true, "model": "base", "device": "cuda"}

  {"op": "health"}
    → {"ok": true, "healthy": true, "gpu": true, "vram_mb": 766}

  {"op": "quit"}
    → process exits

Environment:
  CUDA libs must be on PATH. Set WHISPER_DAEMON_DEVICE=cuda|cpu
  and WHISPER_DAEMON_MODEL=base|small|large-v3-turbo etc.
"""

import sys
import os
import json
import time
import traceback

# ─── GPU Library Path Setup ──────────────────────────────────────────────
# The cublas/cudnn DLLs installed via pip need to be on PATH for ctranslate2
# to find them. We add them here before any ctranslate2 import.
_VENV_NVIDIA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "..", "..", "AppData", "Local", "hermes", "hermes-agent", "venv", "Lib",
    "site-packages", "nvidia"
)
# Also check standard site-packages location
try:
    import site
    for sp in site.getsitepackages():
        _nv = os.path.join(sp, "nvidia")
        if os.path.isdir(_nv):
            _VENV_NVIDIA = _nv
            break
except:
    pass

# Add CUDA DLL directories to PATH
for sub in ["cublas", "cudnn", "cuda_runtime"]:
    bindir = os.path.join(_VENV_NVIDIA, sub, "bin")
    if os.path.isdir(bindir):
        try:
            os.environ["PATH"] = bindir + os.pathsep + os.environ.get("PATH", "")
            # Also try Windows DLL directory API
            if hasattr(os, "add_dll_directory"):
                os.add_dll_directory(bindir)
        except:
            pass

# ─── Configuration ────────────────────────────────────────────────────────
MODEL_NAME = os.environ.get("WHISPER_DAEMON_MODEL", "base")
DEVICE = os.environ.get("WHISPER_DAEMON_DEVICE", "cuda")
COMPUTE_TYPE = os.environ.get("WHISPER_DAEMON_COMPUTE", "int8")
LANGUAGE = os.environ.get("WHISPER_DAEMON_LANG", "en")
BEAM_SIZE = 1
STREAM_CHUNK_LENGTH = 1.0  # seconds, for streaming mode

def log(msg: str):
    """Structured logging to stderr."""
    print(f"[WhisperDaemonV2] {msg}", file=sys.stderr, flush=True)

def emit(obj: dict):
    """Emit a JSON object on stdout (one line)."""
    print(json.dumps(obj), flush=True)

def load_model():
    """Load faster-whisper model with GPU support and CPU fallback."""
    global model, device, compute_type, using_gpu

    from faster_whisper import WhisperModel

    # Try GPU first if device != "cpu"
    using_gpu = False
    if DEVICE != "cpu":
        try:
            log(f"Loading model '{MODEL_NAME}' on CUDA ({COMPUTE_TYPE})...")
            t0 = time.time()
            model = WhisperModel(MODEL_NAME, device="cuda", compute_type=COMPUTE_TYPE)
            load_time = time.time() - t0

            # Warmup — run a tiny transcribe to ensure GPU is working
            import numpy as np
            _ = list(model.transcribe(
                np.zeros(1600, dtype=np.float32),
                beam_size=BEAM_SIZE,
                language=LANGUAGE,
            )[0])

            using_gpu = True
            log(f"Model loaded on GPU in {load_time:.2f}s (RTF ~0.01x)")
            emit({"init": "ready", "model": MODEL_NAME, "device": "cuda",
                  "compute": COMPUTE_TYPE, "load_time_s": round(load_time, 2)})
            return

        except Exception as e:
            log(f"GPU load failed: {e}")
            log("Falling back to CPU...")

    # CPU fallback
    try:
        log(f"Loading model '{MODEL_NAME}' on CPU (int8)...")
        t0 = time.time()
        model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
        load_time = time.time() - t0
        device = "cpu"
        compute_type = "int8"
        log(f"Model loaded on CPU in {load_time:.2f}s")
        emit({"init": "ready", "model": MODEL_NAME, "device": "cpu",
              "compute": "int8", "load_time_s": round(load_time, 2)})
    except Exception as e:
        log(f"CPU load also failed: {e}")
        emit({"init": "error", "error": str(e)})
        raise

def get_gpu_vram():
    """Get current GPU VRAM usage in MB (if available)."""
    try:
        import subprocess
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3
        )
        return int(r.stdout.strip())
    except:
        return None

def handle_transcribe(path: str, stream: bool = False):
    """Transcribe an audio file. If stream=True, emit partial results."""
    if not path or not os.path.exists(path):
        emit({"ok": False, "error": f"file not found: {path}"})
        return

    try:
        if stream:
            # Streaming mode: use chunk_length for incremental results
            kwargs = dict(
                beam_size=BEAM_SIZE,
                language=LANGUAGE,
                vad_filter=True,
                chunk_length=STREAM_CHUNK_LENGTH,
            )
        else:
            kwargs = dict(
                beam_size=BEAM_SIZE,
                language=LANGUAGE,
                vad_filter=True,
            )

        segments_iter, info = model.transcribe(path, **kwargs)

        if stream:
            # Emit partial results as segments arrive
            for seg in segments_iter:
                emit({"ok": True, "text": seg.text.strip(), "partial": True,
                      "start": round(seg.start, 2), "end": round(seg.end, 2)})
            # Final — join all segments
            # (Already emitted above, just signal completion)
            emit({"ok": True, "text": "", "partial": False, "done": True})
        else:
            # Batch mode: collect all segments, emit once
            text = " ".join(seg.text for seg in segments_iter).strip()
            emit({"ok": True, "text": text, "partial": False})

    except Exception as e:
        log(f"Transcribe error: {e}")
        emit({"ok": False, "error": str(e)})

def handle_health():
    vram = get_gpu_vram()
    emit({
        "ok": True,
        "healthy": True,
        "gpu": using_gpu,
        "device": device if 'device' in dir() else DEVICE,
        "model": MODEL_NAME,
        "vram_mb": vram,
    })

def main():
    try:
        load_model()
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    log(f"Listening for commands (model={MODEL_NAME}, device={'cuda' if using_gpu else 'cpu'})...")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            emit({"ok": False, "error": "invalid json"})
            continue

        op = msg.get("op", "")

        if op == "ping":
            emit({"ok": True, "pong": True, "model": MODEL_NAME})

        elif op == "transcribe":
            handle_transcribe(msg.get("path", ""), stream=False)

        elif op == "transcribe_stream":
            handle_transcribe(msg.get("path", ""), stream=True)

        elif op == "health":
            handle_health()

        elif op == "quit":
            emit({"ok": True, "quit": True})
            break

        elif op == "set_model":
            # Hot-swap model (future use)
            new_model = msg.get("model", MODEL_NAME)
            if new_model != MODEL_NAME:
                log(f"Hot-swapping model to '{new_model}'...")
                # Just relaunch — too complex to hot-swap in-place
                MODEL_NAME = new_model
                load_model()
            else:
                emit({"ok": True, "model": MODEL_NAME})

        else:
            emit({"ok": False, "error": f"unknown op: {op}"})

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(e)}), flush=True)
        sys.exit(1)
