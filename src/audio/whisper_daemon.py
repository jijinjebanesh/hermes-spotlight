#!/usr/bin/env python3
"""
Whisper Daemon — Persistent STT process for Echo Mode.
Loads the Whisper model once at startup and transcribes files on demand
via stdin JSON commands. Eliminates 1-2s model-load latency per call.

Protocol (stdin → stdout):
  {"op": "transcribe", "path": "/tmp/hermes_echo_xxx.webm"}
  → {"ok": true, "text": "transcribed text"}  or  {"ok": false, "error": "..."}

  {"op": "ping"}
  → {"ok": true, "ping": true}

  {"op": "quit"}
  → process exits
"""
import sys
import json
import os
import traceback

MODEL_NAME = "base"  # whisper model size: tiny (39M), base (74M), small (244M)

def main():
    try:
        import whisper
    except ImportError:
        print(json.dumps({"ok": False, "error": "whisper not installed. Run: pip install openai-whisper"}), flush=True)
        sys.exit(1)

    # Load model once
    print(json.dumps({"init": "loading", "model": MODEL_NAME}), flush=True)
    model = whisper.load_model(MODEL_NAME)
    print(json.dumps({"init": "ready", "model": MODEL_NAME}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({"ok": False, "error": "invalid json"}), flush=True)
            continue

        op = msg.get("op", "")

        if op == "ping":
            print(json.dumps({"ok": True, "ping": True}), flush=True)

        elif op == "transcribe":
            path = msg.get("path", "")
            if not path or not os.path.exists(path):
                print(json.dumps({"ok": False, "error": f"file not found: {path}"}), flush=True)
                continue
            try:
                result = model.transcribe(path)
                text = result.get("text", "").strip()
                print(json.dumps({"ok": True, "text": text}), flush=True)
            except Exception as e:
                print(json.dumps({"ok": False, "error": str(e)}), flush=True)

        elif op == "quit":
            print(json.dumps({"ok": True, "quit": True}), flush=True)
            break

        else:
            print(json.dumps({"ok": False, "error": f"unknown op: {op}"}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(e)}), flush=True)
        sys.exit(1)
