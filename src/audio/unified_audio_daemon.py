#!/usr/bin/env python3
"""
Unified Audio Daemon — Single microphone stream shared by all audio services.

Solves the core problem: clap_detector.py and wake_detector.py each open their
own PyAudio stream, competing for the mic. On some Windows setups, the second
open fails or gets silence. This daemon opens ONE stream and multiplexes:

  ┌──────────────────────────────────────┐
  │           UnifiedAudioDaemon           │
  │  ┌─────────────┐  ┌────────────────┐  │
  │  │  RMS Monitor │  │ Audio Buffer    │  │
  │  │  (100ms avg) │  │ (ring buffer)   │  │
  │  └──────┬──────┘  └───────┬────────┘  │
  │         │                   │           │
  │  ┌──────▼──────┐  ┌───────▼────────┐  │
  │  │ Clap Detector │  │ Wake Word STT  │  │
  │  │ (RMS pattern) │  │ (whisper)      │  │
  │  └──────────────┘  └────────────────┘  │
  └──────────────────────────────────────┘

Protocol (stdout, one JSON per line):
  {"type": "double_clap", "gap_ms": 420, "threshold": 0.0025}
  {"type": "single_clap", "duration_ms": 80, "amplitude": 0.03}
  {"type": "wake_word", "transcript": "hey hermes", "confidence": 1.0}
  {"type": "amplitude", "value": 0.003}
  {"type": "init", "status": "ready", "device": "Microphone (Realtek)"}
  {"type": "error", "message": "mic_open_failed: ..."}
  {"type": "fatal", "message": "..."}

Config via CLI args:
  --clap-sensitivity 0.5    # 0.1=very sensitive, 1.0=less sensitive
  --wake-word "hey hermes"  # phrase to detect
  --wake-enabled            # enable wake word detection
  --clap-enabled            # enable clap detection
  --auto-calibrate          # auto-calibrate clap threshold from ambient noise
"""

import sys
import os
import json
import time
import struct
import math
import signal
import argparse
import threading
import collections
from pathlib import Path

import numpy as np
import pyaudio

# Keep the packaged/source fallback on the same strict detector as the
# preferred repo-level daemon when that file is available.  The old fallback
# accepted any two short loud RMS bursts, which is exactly what lets taps and
# speech plosives activate Echo Mode.
STRICT_CLAP_AVAILABLE = False
try:
    strict_script_dir = Path(__file__).resolve().parents[2] / "scripts"
    if str(strict_script_dir) not in sys.path:
        sys.path.insert(0, str(strict_script_dir))
    from double_clap_detector_v2 import (  # type: ignore
        EventDetector as StrictEventDetector,
        ClapClassifier as StrictClapClassifier,
        DoubleClapTracker as StrictDoubleClapTracker,
        SAMPLE_RATE as STRICT_SAMPLE_RATE,
    )
    STRICT_CLAP_AVAILABLE = True
except Exception as strict_import_error:
    STRICT_SAMPLE_RATE = RATE if "RATE" in globals() else 16000
    StrictEventDetector = None
    StrictClapClassifier = None
    StrictDoubleClapTracker = None
    print(f"[AudioDaemon] Strict clap fallback unavailable: {strict_import_error}", file=sys.stderr)

# ─── Audio Settings ────────────────────────────────────────────────────────
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000
INPUT_BLOCK_TIME = 0.01  # 10ms blocks
INPUT_FRAMES_PER_BLOCK = int(RATE * INPUT_BLOCK_TIME)
SHORT_NORMALIZE = 1.0 / 32768.0

# ─── Clap Settings ─────────────────────────────────────────────────────────
MIN_GAP_MS = 100
MAX_GAP_MS = 1500
MAX_TAP_BLOCKS = int(0.10 / INPUT_BLOCK_TIME)  # Tap must be < 100ms
CLAP_CALIBRATION_BLOCKS = 200  # 2 seconds of ambient baseline
CLAP_CALIBRATION_FACTOR = 3.0  # threshold = max(baseline * 3, floor)
CLAP_FLOOR = 0.0005
CLAP_CEIL = 0.10

# ─── Wake Word Settings ────────────────────────────────────────────────────
SPEECH_START_BLOCKS = 3    # ~30ms of continuous voice to trigger speech
SPEECH_END_BLOCKS = 15     # ~150ms of silence to end speech
MAX_SPEECH_BLOCKS = 100    # 5s hard cap
MIN_EVAL_COOLDOWN = 0.4   # Min seconds between Whisper evaluations
VAD_CALIBRATION_BLOCKS = 200  # 2s ambient baseline for VAD
VAD_CALIBRATION_FACTOR = 2.5

# ─── Whisper Settings ──────────────────────────────────────────────────────
WHISPER_MODEL = "tiny.en"
WHISPER_DEVICE = "cpu"
WHISPER_COMPUTE = "int8"

# ─── Output Helpers ─────────────────────────────────────────────────────────
def emit(obj: dict):
    """Emit a JSON object on stdout (one line)."""
    print(json.dumps(obj), flush=True)

def log(msg: str):
    """Log to stderr (doesn't interfere with stdout JSON protocol)."""
    print(f"[AudioDaemon] {msg}", file=sys.stderr, flush=True)

# ─── RMS Calculation ──────────────────────────────────────────────────────
def get_rms(block: bytes) -> float:
    """Vectorized RMS using numpy — fast."""
    if not block:
        return 0.0
    try:
        samples = np.frombuffer(block, dtype=np.int16).astype(np.float32) * SHORT_NORMALIZE
    except ValueError:
        return 0.0
    if samples.size == 0:
        return 0.0
    return float(math.sqrt(float(np.mean(np.square(samples)))))


class UnifiedAudioDaemon:
    """Single mic stream feeding clap detection + wake word detection."""

    def __init__(self, args):
        self.args = args
        self.pa = pyaudio.PyAudio()
        self.stream = None
        self.running = True
        self.shutdown = False

        # ─── Clap state ───
        self.clap_enabled = args.clap_enabled
        self.tap_threshold = args.clap_sensitivity / 10.0  # 0.5 → 0.05
        self.noisycount = MAX_TAP_BLOCKS + 1
        self.quietcount = 0
        self.errorcount = 0
        self.clap_times = []
        self.frame = 0
        self.last_amplitude = 0.0
        self.calibration_sum = 0.0
        self.calibration_count = 0
        self.calibrated = not args.auto_calibrate  # skip calibration if not requested
        self.over_sensitive = int(15.0 / INPUT_BLOCK_TIME)
        self.under_sensitive = int(120.0 / INPUT_BLOCK_TIME)
        # Transient / spectral checks to reduce false positives
        self.transient_sum = 0.0
        self.transient_count = 0
        self.hf_cutoff = 2000.0  # Hz — high-frequency band start for clap energy
        self.transient_threshold = 0.08  # avg transient score required to accept a tap
        self.transient_min_hf_frac = 0.18  # minimum HF fraction to consider

        # Use the strict event/pair detector in source checkouts and packaged
        # layouts that retain scripts/.  The legacy fields above remain as a
        # compatibility fallback for installations missing that module.
        self.strict_clap = None
        self.strict_classifier = None
        self.strict_tracker = None
        if STRICT_CLAP_AVAILABLE:
            strictness = 0.74 + 0.10 * float(np.clip(args.clap_sensitivity, 0.1, 1.0))
            self.strict_clap = StrictEventDetector(
                sample_rate=RATE,
                sensitivity=args.clap_sensitivity,
                block_size=INPUT_FRAMES_PER_BLOCK,
            )
            self.strict_classifier = StrictClapClassifier(strictness=strictness)
            self.strict_tracker = StrictDoubleClapTracker(
                self._on_strict_double_clap,
                strictness=strictness,
            )

        # ─── Wake word state ───
        self.wake_enabled = args.wake_enabled
        self.wake_model = None
        self.target_phrase = self._normalize(args.wake_word or "hey hermes")
        self.is_speaking = False
        self.noisy_count = 0
        self.quiet_count = 0
        self.audio_buffer = []
        self.last_eval_time = 0.0
        self.vad_threshold = 0.015
        self.vad_cal_sum = 0.0
        self.vad_cal_count = 0
        self.vad_calibrated = False

        # Signal handlers
        signal.signal(signal.SIGINT, self._handle_signal)
        try:
            signal.signal(signal.SIGTERM, self._handle_signal)
        except (ValueError, AttributeError):
            pass

    def _on_strict_double_clap(self, gap: float, confidence: float):
        emit({
            "type": "double_clap",
            "gap_ms": round(gap * 1000.0, 1),
            "confidence": round(confidence, 3),
            "message": "Double clap detected",
        })

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
        if target in transcript_clean:
            return True
        if target == "heyhermes":
            return any(v in transcript_clean for v in (
                "hayhermes", "hehermes", "hihermes", "heyhermo", "heyharmes",
            ))
        return False

    def _hf_fraction(self, block: bytes) -> float:
        """Return fraction of signal energy above `self.hf_cutoff` Hz.
        Uses an FFT-based estimate; returns 0.0 on failure.
        """
        try:
            samples = np.frombuffer(block, dtype=np.int16).astype(np.float32) * SHORT_NORMALIZE
            if samples.size == 0:
                return 0.0
            # Compute real FFT and power
            spec = np.fft.rfft(samples)
            power = np.abs(spec) ** 2
            freqs = np.fft.rfftfreq(samples.size, d=1.0 / RATE)
            total = float(np.sum(power))
            if total <= 0.0:
                return 0.0
            hf_mask = freqs >= self.hf_cutoff
            hf_energy = float(np.sum(power[hf_mask]))
            return hf_energy / total
        except Exception:
            return 0.0

    def open_mic_stream(self):
        """Open microphone — use default device, fall back to enumeration."""
        device_index = None

        # Try regular default device first (not WASAPI)
        try:
            default = self.pa.get_default_input_device_info()
            device_index = default['index']
            log(f"Default device {device_index}: {default['name']}")
            log(f"  maxInputChannels={default.get('maxInputChannels')}, "
                f"rates=[{default.get('defaultSampleRate')}]")
        except Exception as e:
            log(f"No default device: {e}")

        if device_index is None:
            emit({"type": "fatal", "message": "No microphone device found"})
            raise IOError("No microphone device found")

        try:
            stream = self.pa.open(
                format=FORMAT,
                channels=CHANNELS,
                rate=RATE,
                input=True,
                input_device_index=device_index,
                frames_per_buffer=INPUT_FRAMES_PER_BLOCK,
            )
            dev = self.pa.get_device_info_by_index(device_index)
            emit({"type": "init", "status": "ready",
                  "device": dev["name"], "device_index": device_index})
            log(f"Stream opened on {dev['name']} @ {RATE}Hz")
            return stream
        except Exception as e:
            emit({"type": "fatal", "message": f"mic_open_failed: {e}"})
            raise

    def _load_wake_model(self):
        """Load Whisper model for wake word detection."""
        if not self.wake_enabled:
            return
        try:
            from faster_whisper import WhisperModel
            log(f"Loading whisper model '{WHISPER_MODEL}' for wake word...")
            self.wake_model = WhisperModel(
                WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE
            )
            log("Wake word model loaded.")
        except Exception as e:
            log(f"Wake model load failed: {e}")
            emit({"type": "error", "message": f"wake_model_load_failed: {e}"})
            self.wake_enabled = False

    def _calibrate_clap(self, rms: float):
        """Auto-calibrate clap threshold from ambient noise."""
        if self.calibrated:
            return
        # Only calibrate on quiet samples
        if rms < 0.02:
            self.calibration_sum += rms
            self.calibration_count += 1
            if self.calibration_count >= CLAP_CALIBRATION_BLOCKS:
                avg = self.calibration_sum / self.calibration_count
                calibrated = max(avg * CLAP_CALIBRATION_FACTOR, CLAP_FLOOR)
                self.tap_threshold = min(calibrated, CLAP_CEIL)
                self.calibrated = True
                log(f"Clap threshold calibrated: ambient={avg:.6f} → threshold={self.tap_threshold:.6f}")
                emit({"type": "calibrated", "component": "clap", "threshold": self.tap_threshold})

    def _calibrate_vad(self, rms: float):
        """Auto-calibrate VAD threshold from ambient noise."""
        if self.vad_calibrated:
            return
        if rms < 0.02:
            self.vad_cal_sum += rms
            self.vad_cal_count += 1
            if self.vad_cal_count >= VAD_CALIBRATION_BLOCKS:
                avg = self.vad_cal_sum / self.vad_cal_count
                self.vad_threshold = max(avg * VAD_CALIBRATION_FACTOR, 0.005)
                self.vad_threshold = min(self.vad_threshold, 0.1)
                self.vad_calibrated = True
                log(f"VAD threshold calibrated: ambient={avg:.6f} → threshold={self.vad_threshold:.6f}")

    def _process_clap(self, amplitude: float, block: bytes):
        """Process one audio block for clap detection."""
        if not self.clap_enabled:
            return

        if self.strict_clap is not None:
            samples = np.frombuffer(block, dtype=np.int16).astype(np.float32) * SHORT_NORMALIZE
            event = self.strict_clap.push_block(samples, time.monotonic())
            if event is not None and self.strict_classifier.is_clap(event.features):
                emit({
                    "type": "single_clap",
                    "duration_ms": round(float(event.features[0]), 1),
                    "score": round(self.strict_classifier.score(event.features), 3),
                })
                self.strict_tracker.register_event(event, self.strict_classifier)
            return

        # Calibrate if needed
        if not self.calibrated:
            self._calibrate_clap(amplitude)

        if amplitude > self.tap_threshold:
            # Compute a simple transient / high-frequency metric to distinguish
            # sharp claps from voiced speech (speech has more low-frequency energy)
            hf_frac = self._hf_fraction(block)
            amp_ratio = amplitude / max(self.tap_threshold, 1e-12)
            transient_metric = hf_frac * amp_ratio
            self.transient_sum += transient_metric
            self.transient_count += 1

            self.quietcount = 0
            self.noisycount += 1
            if self.noisycount > self.over_sensitive:
                self.tap_threshold = min(CLAP_CEIL, self.tap_threshold * 1.05)
                self.noisycount = self.over_sensitive
        else:
            if 1 <= self.noisycount <= MAX_TAP_BLOCKS:
                # Check transient metric before accepting as tap
                avg_transient = (
                    self.transient_sum / max(1, self.transient_count)
                )
                # reset accumulators for next event window
                self.transient_sum = 0.0
                self.transient_count = 0

                if avg_transient >= self.transient_threshold:
                    self._tap_detected(amplitude, self.noisycount)
                else:
                    # Suppress: likely speech or slow noise
                    pass

            # reset noisy counters and adapt
            self.noisycount = 0
            self.quietcount += 1
            if self.quietcount > self.under_sensitive:
                self.tap_threshold = max(CLAP_FLOOR, self.tap_threshold * 0.95)
                self.quietcount = self.under_sensitive

            # also ensure transient accumulators cleared when quiet
            self.transient_sum = 0.0
            self.transient_count = 0


    def _tap_detected(self, amplitude: float, duration_blocks: int):
        """Handle a detected tap/clap."""
        now = time.time() * 1000
        duration_ms = duration_blocks * INPUT_BLOCK_TIME * 1000
        if 10 <= duration_ms <= 150:
            self.clap_times = [t for t in self.clap_times if now - t < MAX_GAP_MS + 100]
            self.clap_times.append(now)

            if len(self.clap_times) >= 2:
                gap = self.clap_times[-1] - self.clap_times[-2]
                if MIN_GAP_MS <= gap <= MAX_GAP_MS:
                    emit({
                        "type": "double_clap",
                        "gap_ms": round(gap, 1),
                        "threshold": round(self.tap_threshold, 6)
                    })
                    self.clap_times = []
                    return
            emit({
                "type": "single_clap",
                "duration_ms": round(duration_ms, 1),
                "amplitude": round(amplitude, 6),
                "threshold": round(self.tap_threshold, 6)
            })

    def _process_wake(self, amplitude: float, block: bytes):
        """Process one audio block for wake word detection."""
        if not self.wake_enabled or not self.wake_model:
            return

        if not self.vad_calibrated:
            self._calibrate_vad(amplitude)

        if amplitude > self.vad_threshold:
            self.noisy_count += 1
            self.quiet_count = 0
        else:
            self.quiet_count += 1
            self.noisy_count = 0

        if not self.is_speaking:
            if self.noisy_count >= SPEECH_START_BLOCKS:
                self.is_speaking = True
                self.audio_buffer.append(block)
                self.audio_buffer = [b for b in self.audio_buffer if len(b) > 0]
        else:
            self.audio_buffer.append(block)
            if self.quiet_count >= SPEECH_END_BLOCKS or len(self.audio_buffer) >= MAX_SPEECH_BLOCKS:
                self.is_speaking = False
                self._evaluate_wake()

    def _evaluate_wake(self):
        """Run Whisper on buffered audio to check for wake word."""
        if not self.audio_buffer or not self.wake_model:
            return

        now = time.monotonic()
        if now - self.last_eval_time < MIN_EVAL_COOLDOWN:
            self.audio_buffer = []
            return
        self.last_eval_time = now

        try:
            raw = b"".join(self.audio_buffer)
            audio_np = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

            segments, _info = self.wake_model.transcribe(
                audio_np, beam_size=1, language="en", vad_filter=True
            )
            transcript = " ".join(seg.text for seg in segments).strip()
            transcript_clean = self._normalize(transcript)

            if transcript_clean:
                log(f"Heard: '{transcript}' → '{transcript_clean}'")

            if self._matches_target(transcript_clean):
                emit({
                    "type": "wake_word",
                    "confidence": 1.0,
                    "transcript": transcript[:200]
                })
        except Exception as e:
            log(f"Wake evaluate error: {e}")
        finally:
            self.audio_buffer = []

    def _handle_signal(self, signum, frame):
        log(f"Signal {signum} received")
        self.running = False
        self.shutdown = True

    def run(self):
        """Main loop — read audio blocks and feed all detectors."""
        self._load_wake_model()
        self.stream = self.open_mic_stream()

        consecutive_errors = 0
        MAX_ERRORS = 20

        log("Listening...")
        while not self.shutdown:
            try:
                block = self.stream.read(
                    INPUT_FRAMES_PER_BLOCK, exception_on_overflow=False
                )
                consecutive_errors = 0
            except IOError as e:
                consecutive_errors += 1
                log(f"Audio error ({consecutive_errors}/{MAX_ERRORS}): {e}")
                if consecutive_errors >= MAX_ERRORS:
                    emit({"type": "fatal", "message": f"persistent_mic_errors: {e}"})
                    break
                time.sleep(0.05)
                continue
            except Exception as e:
                consecutive_errors += 1
                log(f"Stream error ({consecutive_errors}/{MAX_ERRORS}): {e}")
                if consecutive_errors >= MAX_ERRORS:
                    emit({"type": "fatal", "message": f"stream_fatal: {e}"})
                    break
                time.sleep(0.1)
                continue

            amplitude = get_rms(block)
            self.last_amplitude = amplitude
            self.frame += 1

            # Feed both detectors from the SAME block
            self._process_clap(amplitude, block)
            self._process_wake(amplitude, block)

            # Emit amplitude every 50 frames (~500ms) for UI feedback
            if self.frame % 50 == 0:
                emit({"type": "amplitude", "value": round(amplitude, 6)})

        # Cleanup
        log("Shutting down...")
        try:
            if self.stream:
                self.stream.stop_stream()
                self.stream.close()
        except:
            pass
        try:
            self.pa.terminate()
        except:
            pass
        log("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Unified Audio Daemon")
    parser.add_argument("--clap-sensitivity", type=float, default=0.5,
                        help="Clap sensitivity 0.1-1.0 (lower=more sensitive)")
    parser.add_argument("--wake-word", type=str, default="hey hermes",
                        help="Wake word phrase to detect")
    parser.add_argument("--wake-enabled", action="store_true",
                        help="Enable wake word detection")
    parser.add_argument("--clap-enabled", action="store_true",
                        help="Enable clap detection")
    parser.add_argument("--auto-calibrate", action="store_true",
                        help="Auto-calibrate thresholds from ambient noise")
    args = parser.parse_args()

    # Default: enable clap, disable wake (unless explicitly requested)
    if not args.clap_enabled and not args.wake_enabled:
        args.clap_enabled = True  # default to clap if nothing specified

    daemon = UnifiedAudioDaemon(args)
    try:
        daemon.run()
    except Exception as e:
        emit({"type": "fatal", "message": str(e)})
        sys.exit(1)
    sys.exit(0)
