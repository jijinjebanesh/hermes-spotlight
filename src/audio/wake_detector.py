"""
Native Wake Word Detector — Hermes Overlay
==========================================

Continuously monitors the microphone via Voice Activity Detection (VAD) and
runs the local faster-whisper AI on speech segments to detect the configured
wake phrase (default: "hey hermes").

Design goals:
- Privacy-first: all audio stays local; nothing is sent to the network.
- CPU-friendly: adaptive VAD threshold + cooldown prevents Whisper from running
  on ambient noise or back-to-back speech bursts.
- Reliable: graceful SIGTERM/SIGINT cleanup, model load retry, auto-recovery
  from transient audio errors, and unbounded-buffer protection.

Communication protocol (stdout):
- Emits a single JSON object per line: {"type":"wake_word","transcript":...}
- All diagnostics go to stderr (mixed with stdout JSON is forbidden).

Exit codes:
- 0: clean shutdown via signal
- 1: fatal unrecoverable error
"""

import sys
import json
import time
import struct
import math
import signal
import argparse
import threading

import numpy as np
import pyaudio
from faster_whisper import WhisperModel


# ─── Audio settings ────────────────────────────────────────────────────────
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000
INPUT_BLOCK_TIME = 0.05  # 50ms blocks
INPUT_FRAMES_PER_BLOCK = int(RATE * INPUT_BLOCK_TIME)

SHORT_NORMALIZE = (1.0 / 32768.0)

# ─── VAD settings ──────────────────────────────────────────────────────────
INITIAL_VAD_THRESHOLD = 0.015
SPEECH_START_BLOCKS = 3    # ~150ms of continuous voice to trigger speech
SPEECH_END_BLOCKS = 15     # ~750ms of silence to end speech
MAX_SPEECH_BLOCKS = 100    # 5s hard cap before forcing evaluation (20/sec)
MIN_EVAL_COOLDOWN = 0.4    # Min seconds between Whisper evaluations
ADAPTIVE_FLOOR = 0.005     # VAD threshold never drops below this

# ─── Whisper settings ───────────────────────────────────────────────────────
WHISPER_BEAM_SIZE = 1
WHISPER_LANGUAGE = "en"

# ─── Misc ───────────────────────────────────────────────────────────────────
MODEL_NAME = "tiny.en"
MODEL_DEVICE = "cpu"
MODEL_COMPUTE_TYPE = "int8"


class WakeDetector:
    def __init__(self, target_phrase="hey hermes"):
        # Normalize target phrase for fuzzy matching (lowercase, strip punct/space)
        self.target_phrase = self._normalize(target_phrase)
        print(f"[WakeDetector] Target phrase (normalized): '{self.target_phrase}'", file=sys.stderr)

        # Lazy WhisperModel load — wrapped so a load failure surfaces cleanly.
        self.model = None
        self._load_model_with_retry()

        # PyAudio init — do not open stream yet (open in run() so model loading
        # errors do not leave an orphaned PyAudio device handle).
        self.pa = pyaudio.PyAudio()
        self.stream = None

        # VAD state — adaptive threshold (self-calibrates upward in noisy rooms)
        self.vad_threshold = INITIAL_VAD_THRESHOLD
        self._calibration_samples = 0
        self._calibration_sum = 0.0
        self._calibration_max_blocks = 40  # 2 seconds of ambient baseline

        # Speech state machine
        self.is_speaking = False
        self.noisy_count = 0
        self.quiet_count = 0
        self.audio_buffer = []

        # Cooldown — avoid hammering Whisper on back-to-back noise bursts
        self._last_eval_time = 0.0

        # Shutdown flag — set by signal handler, checked in main loop
        self._shutdown = False

    # ─── Model loading ──────────────────────────────────────────────────────
    def _load_model_with_retry(self, attempts: int = 3, delay: float = 2.0):
        last_err = None
        for i in range(attempts):
            try:
                print(f"[WakeDetector] Loading local whisper model '{MODEL_NAME}' "
                      f"(attempt {i+1}/{attempts})...", file=sys.stderr)
                self.model = WhisperModel(
                    MODEL_NAME, device=MODEL_DEVICE, compute_type=MODEL_COMPUTE_TYPE
                )
                print("[WakeDetector] Model loaded successfully.", file=sys.stderr)
                return
            except Exception as e:
                last_err = e
                print(f"[WakeDetector] Model load attempt {i+1} failed: {e}", file=sys.stderr)
                time.sleep(delay)
        # If we reach here, model load failed entirely — fatal.
        self._emit_error(f"model_load_failed: {last_err}")
        raise RuntimeError(f"Could not load Whisper model after {attempts} attempts: {last_err}")

    # ─── Phrase normalization & matching ───────────────────────────────────
    @staticmethod
    def _normalize(text: str) -> str:
        return (
            text.lower()
            .replace(" ", "")
            .replace(",", "")
            .replace(".", "")
            .replace("!", "")
            .replace("?", "")
            .replace("'", "")
        )

    def _matches_target(self, transcript_clean: str) -> bool:
        target = self.target_phrase
        if not target:
            return False
        # Exact substring match (most common case)
        if target in transcript_clean:
            return True
        # Loose phonetic variants ONLY when target is the default "heyhermes"
        # — avoids accidental triggers for custom phrases while tolerating
        # misrecognitions of the default phrase.
        if target == "heyhermes":
            return any(v in transcript_clean for v in (
                "hayhermes", "hehermes", "hihermes", "heyhermo", "heyharmes",
            ))
        return False

    # ─── Microphone ─────────────────────────────────────────────────────────
    def open_mic_stream(self):
        """Open microphone stream with auto device selection, prioritizing WASAPI."""
        device_index = None

        # 1. Prefer the WASAPI default input device (loopback-safe shared mode)
        try:
            wasapi_info = self.pa.get_host_api_info_by_type(pyaudio.paWASAPI)
            if wasapi_info:
                device_index = wasapi_info.get('defaultInputDevice')
                if device_index is not None:
                    dev = self.pa.get_device_info_by_index(device_index)
                    print(f"[WakeDetector] WASAPI default device {device_index}: {dev['name']}",
                          file=sys.stderr)
        except Exception as e:
            print(f"[WakeDetector] WASAPI probe failed: {e}", file=sys.stderr)

        # 2. Manual search for a plausible input device
        if device_index is None:
            for i in range(self.pa.get_device_count()):
                try:
                    devinfo = self.pa.get_device_info_by_index(i)
                    if devinfo['maxInputChannels'] > 0:
                        name_lower = devinfo['name'].lower()
                        if 'realtek' in name_lower or 'mic' in name_lower \
                                or 'microphone' in name_lower:
                            device_index = i
                            print(f"[WakeDetector] Fallback device {i}: {devinfo['name']}",
                                  file=sys.stderr)
                            break
                except Exception:
                    pass

        # 3. Ultimate fallback — PyAudio's default input
        if device_index is None:
            try:
                default = self.pa.get_default_input_device_info()
                device_index = default['index']
                print(f"[WakeDetector] Default device {device_index}: {default['name']}",
                      file=sys.stderr)
            except Exception:
                device_index = 0
                print("[WakeDetector] No default device found; using index 0.", file=sys.stderr)

        try:
            stream = self.pa.open(
                format=FORMAT,
                channels=CHANNELS,
                rate=RATE,
                input=True,
                input_device_index=device_index,
                frames_per_buffer=INPUT_FRAMES_PER_BLOCK,
            )
        except Exception as e:
            self._emit_error(f"mic_open_failed: {e}")
            raise
        return stream

    # ─── Signal handlers ────────────────────────────────────────────────────
    def _setup_signal_handlers(self):
        # SIGINT (Ctrl-C) and SIGTERM (Electron kill) → graceful exit.
        # On Windows only SIGINT works reliably; SIGTERM uses TerminateProcess
        # which bypasses Python — but we still register it for Linux/macOS parity.
        try:
            signal.signal(signal.SIGINT, self._handle_signal)
        except (ValueError, AttributeError):
            pass
        try:
            signal.signal(signal.SIGTERM, self._handle_signal)
        except (ValueError, AttributeError):
            pass

    def _handle_signal(self, signum, frame):
        print(f"[WakeDetector] Received signal {signum}, shutting down...", file=sys.stderr)
        self._shutdown = True

    # ─── Cleanup ────────────────────────────────────────────────────────────
    def _cleanup(self):
        """Release audio resources. Safe to call multiple times."""
        try:
            if self.stream is not None:
                if not self.stream.is_stopped():
                    self.stream.stop_stream()
                self.stream.close()
                self.stream = None
        except Exception as e:
            print(f"[WakeDetector] stream cleanup warning: {e}", file=sys.stderr)
        try:
            if self.pa is not None:
                self.pa.terminate()
        except Exception as e:
            print(f"[WakeDetector] PyAudio terminate warning: {e}", file=sys.stderr)

    # ─── Output ─────────────────────────────────────────────────────────────
    @staticmethod
    def _emit_error(message: str):
        """Emit an error message as JSON on stdout so Electron can react."""
        try:
            print(json.dumps({"type": "error", "message": message}), flush=True)
        except Exception:
            pass

    # ─── DSP ─────────────────────────────────────────────────────────────────
    @staticmethod
    def get_rms(block: bytes) -> float:
        """Vectorized RMS using numpy — ~50x faster than per-sample Python loop."""
        if not block:
            return 0.0
        try:
            samples = np.frombuffer(block, dtype=np.int16).astype(np.float32) * SHORT_NORMALIZE
        except ValueError:
            return 0.0
        if samples.size == 0:
            return 0.0
        return float(math.sqrt(float(np.mean(np.square(samples)))))

    # ─── VAD update ──────────────────────────────────────────────────────────
    def _update_vad_threshold(self, amplitude: float):
        """
        Light adaptive calibration: during the early period we track ambient
        baseline and set the threshold to baseline * 2.5 (min ADAPTIVE_FLOOR).
        After calibration completes, threshold stays static to avoid drift mid-speech.
        """
        if self._calibration_samples >= self._calibration_max_blocks:
            return
        # Only calibrate on quiet samples (likely ambient noise, not speech)
        if amplitude < INITIAL_VAD_THRESHOLD * 4:
            self._calibration_sum += amplitude
            self._calibration_samples += 1
            if self._calibration_samples >= self._calibration_max_blocks:
                avg = self._calibration_sum / self._calibration_samples
                calibrated = max(avg * 2.5, ADAPTIVE_FLOOR)
                # Take the max so we never LOWER safety below the configured default
                self.vad_threshold = max(self.vad_threshold, min(calibrated, 0.1))
                print(f"[WakeDetector] VAD calibrated: avg={avg:.4f} → threshold={self.vad_threshold:.4f}",
                      file=sys.stderr)

    # ─── Whisper evaluation ──────────────────────────────────────────────────
    def evaluate_audio(self):
        if not self.audio_buffer:
            return

        # Cooldown — avoid back-to-back Whisper runs caused by fragmented utterances
        now = time.monotonic()
        if now - self._last_eval_time < MIN_EVAL_COOLDOWN:
            self.audio_buffer = []
            return
        self._last_eval_time = now

        try:
            raw_bytes = b"".join(self.audio_buffer)
            audio_np = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0

            segments, _info = self.model.transcribe(
                audio_np, beam_size=WHISPER_BEAM_SIZE,
                language=WHISPER_LANGUAGE, vad_filter=True,
            )
            transcript = " ".join(seg.text for seg in segments).strip()

            transcript_clean = self._normalize(transcript)
            if transcript_clean:
                print(f"[WakeDetector] Heard: '{transcript}' -> Clean: '{transcript_clean}'",
                      file=sys.stderr)

            if self._matches_target(transcript_clean):
                result = {
                    "type": "wake_word",
                    "confidence": 1.0,
                    "transcript": transcript[:200],
                }
                print(json.dumps(result), flush=True)
        except Exception as e:
            # Log + continue: a single bad chunk shouldn't kill the daemon.
            print(f"[WakeDetector] Evaluate error (continuing): {e}", file=sys.stderr)
            self._emit_error(f"evaluate_failed: {e}")
        finally:
            self.audio_buffer = []

    # ─── Main loop ───────────────────────────────────────────────────────────
    def run(self):
        print("[WakeDetector] Listening for wake word...", file=sys.stderr)
        self._setup_signal_handlers()

        # Open the mic stream AFTER signal handlers so SIGINT during mic open
        # still shuts us down cleanly.
        if self.stream is None:
            self.stream = self.open_mic_stream()

        consecutive_mic_errors = 0
        MAX_CONSECUTIVE_ERRORS = 20  # after this many errors, give up

        while not self._shutdown:
            try:
                block = self.stream.read(INPUT_FRAMES_PER_BLOCK, exception_on_overflow=False)
                consecutive_mic_errors = 0
            except IOError as e:
                consecutive_mic_errors += 1
                print(f"[WakeDetector] Audio buffer error ({consecutive_mic_errors}/{MAX_CONSECUTIVE_ERRORS}): {e}",
                      file=sys.stderr)
                if consecutive_mic_errors >= MAX_CONSECUTIVE_ERRORS:
                    self._emit_error(f"mic_persistent_errors: {e}")
                    break
                # Brief back-off to avoid CPU spin on a broken device
                time.sleep(0.05)
                continue
            except Exception as e:
                # Mic unplugged, device invalidated, etc.
                consecutive_mic_errors += 1
                print(f"[WakeDetector] Stream read error ({consecutive_mic_errors}/{MAX_CONSECUTIVE_ERRORS}): {e}",
                      file=sys.stderr)
                if consecutive_mic_errors >= MAX_CONSECUTIVE_ERRORS:
                    self._emit_error(f"stream_fatal: {e}")
                    break
                time.sleep(0.1)
                continue

            amplitude = self.get_rms(block)
            self._update_vad_threshold(amplitude)

            if amplitude > self.vad_threshold:
                self.noisy_count += 1
                self.quiet_count = 0
            else:
                self.quiet_count += 1
                self.noisy_count = 0

            # State transitions
            if not self.is_speaking:
                if self.noisy_count >= SPEECH_START_BLOCKS:
                    self.is_speaking = True
                    self.audio_buffer.append(block)
            else:
                self.audio_buffer.append(block)
                if self.quiet_count >= SPEECH_END_BLOCKS \
                        or len(self.audio_buffer) >= MAX_SPEECH_BLOCKS:
                    self.is_speaking = False
                    self.evaluate_audio()

        # Clean exit path
        print("[WakeDetector] Shutting down cleanly.", file=sys.stderr)
        self._cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Native Wake Word Detector")
    parser.add_argument("--phrase", type=str, default="hey hermes",
                        help="Target wake phrase")
    args = parser.parse_args()

    try:
        detector = WakeDetector(target_phrase=args.phrase)
        detector.run()
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(f"[WakeDetector] Fatal error: {e}", file=sys.stderr)
        # Final attempt to surface the error to Electron before dying
        try:
            print(json.dumps({"type": "fatal", "message": str(e)}), flush=True)
        except Exception:
            pass
        sys.exit(1)
    sys.exit(0)
