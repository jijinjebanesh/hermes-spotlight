#!/usr/bin/env python3
"""Robust, single-microphone double-clap detector.

The detector is deliberately biased toward rejecting false positives.  A
candidate must be a short, broadband, noise-like impulse, two candidates must
have a plausible human interval and similar acoustic fingerprints, and speech
or sustained sound activity locks the detector out temporarily.

This file is also usable without a microphone for deterministic tests:

    python -m unittest discover -s tests -p "test_double_clap_detector.py"

``--auto-calibrate`` means ambient-noise calibration only.  It does not wait
for the user to clap or talk; that behavior made the old integration silently
learn environmental sounds as claps during application startup.
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
import time
from dataclasses import dataclass
from typing import Callable, Optional

import numpy as np


# Audio and segmentation -----------------------------------------------------
SAMPLE_RATE = 44_100
STREAM_BLOCK = 512                         # 11.6 ms
NOISE_WINDOW_SECONDS = 3.0
NOISE_PERCENTILE = 20
MIN_FLOOR = 0.0008
ONSET_MULTIPLIER = 7.0
OFFSET_MULTIPLIER = 2.6
MIN_EVENT_MS = 12
MAX_EVENT_MS = 145
PRE_PAD_SAMPLES = int(0.004 * SAMPLE_RATE)
POST_PAD_SAMPLES = int(0.012 * SAMPLE_RATE)

# Pair validation ------------------------------------------------------------
MIN_GAP_BETWEEN_CLAPS = 0.22
MAX_GAP_BETWEEN_CLAPS = 0.70
REFRACTORY_PERIOD = 0.13
COOLDOWN_SECONDS = 3.0
SPEECH_HOLDOFF_SECONDS = 1.50

# Feature indexes.  The final four values are a normalized spectral profile.
I_DURATION = 0
I_ATTACK = 1
I_CREST = 2
I_ZCR = 3
I_FLATNESS = 4
I_CENTROID = 5
I_HIGH_RATIO = 6
I_VOICING = 7
I_LOW_RATIO = 8
I_SNR = 9
I_PROFILE = 10
FEATURE_COUNT = 14


def rms(x: np.ndarray) -> float:
    if len(x) == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(x.astype(np.float64)))) + 1e-12)


def _spectrum(x: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    if len(x) < 8:
        return np.zeros(1), np.zeros(1)
    window = x * np.hanning(len(x))
    power = np.abs(np.fft.rfft(window)) ** 2
    freqs = np.fft.rfftfreq(len(x), d=1.0 / sr)
    return power + 1e-12, freqs


def zero_crossing_rate(x: np.ndarray) -> float:
    if len(x) < 2:
        return 0.0
    signs = np.signbit(x)
    return float(np.count_nonzero(signs[1:] != signs[:-1]) / (len(x) - 1))


def _voicing_score(x: np.ndarray, sr: int) -> float:
    """Return periodicity in the human voice pitch range (higher = voiced)."""
    if len(x) < 128:
        return 0.0
    centered = (x - np.mean(x)) * np.hanning(len(x))
    corr = np.correlate(centered, centered, mode="full")[len(x) - 1:]
    if corr[0] <= 1e-12:
        return 0.0
    low_lag = max(1, int(sr / 420))
    high_lag = min(len(corr) - 1, int(sr / 75))
    if low_lag >= high_lag:
        return 0.0
    return float(np.clip(np.max(corr[low_lag:high_lag]) / corr[0], 0.0, 1.0))


def extract_features(segment: np.ndarray, sr: int = SAMPLE_RATE,
                     noise_floor: float = MIN_FLOOR) -> np.ndarray:
    """Extract features that distinguish a clap from speech and taps.

    Spectral features use the active part of the event, not the surrounding
    silence.  The old detector included the padding in its measurements,
    making its classifier unstable at block boundaries.
    """
    x = np.asarray(segment, dtype=np.float32)
    if len(x) == 0:
        return np.zeros(FEATURE_COUNT, dtype=np.float64)

    envelope = np.abs(x)
    peak = float(np.max(envelope) + 1e-12)
    active = envelope >= peak * 0.12
    if np.any(active):
        first = int(np.argmax(active))
        last = len(active) - int(np.argmax(active[::-1]))
        active_x = x[first:last]
    else:
        first, last, active_x = 0, len(x), x

    active_envelope = np.abs(active_x)
    active_peak = float(np.max(active_envelope) + 1e-12)
    peak_idx = int(np.argmax(active_envelope))
    below_10 = np.flatnonzero(active_envelope[:peak_idx + 1] <= active_peak * 0.10)
    attack_idx = int(below_10[-1]) if len(below_10) else 0
    duration_ms = (last - first) / sr * 1000.0
    attack_ms = max((peak_idx - attack_idx) / sr * 1000.0, 0.1)

    power, freqs = _spectrum(active_x, sr)
    total = float(np.sum(power)) + 1e-12
    centroid = float(np.sum(freqs * power) / total) / 1000.0
    high_ratio = float(np.sum(power[freqs >= 2_000]) / total)
    low_ratio = float(np.sum(power[freqs < 700]) / total)

    spectral_slice = power[(freqs >= 700) & (freqs <= 16_000)]
    if len(spectral_slice):
        flatness = float(np.exp(np.mean(np.log(spectral_slice))) /
                        (np.mean(spectral_slice) + 1e-12))
    else:
        flatness = 0.0

    band_edges = (700, 1_500, 3_000, 6_000, 12_000)
    band_energy = []
    for low, high in zip(band_edges[:-1], band_edges[1:]):
        band_energy.append(float(np.sum(power[(freqs >= low) & (freqs < high)])))
    band_energy.append(float(np.sum(power[freqs >= band_edges[-1]])))
    band_energy = np.asarray(band_energy, dtype=np.float64)
    band_energy /= float(np.sum(band_energy)) + 1e-12

    # Four broad bands are more stable for pair matching than individual FFT
    # bins.  They intentionally omit sub-700 Hz rumble.
    profile = np.array([
        band_energy[0],
        band_energy[1],
        band_energy[2],
        float(np.sum(band_energy[3:])),
    ], dtype=np.float64)
    profile /= float(np.sum(profile)) + 1e-12

    event_rms = rms(active_x)
    crest = active_peak / max(event_rms, 1e-12)
    snr_db = 20.0 * np.log10(max(event_rms, 1e-12) / max(noise_floor, 1e-12))

    return np.array([
        duration_ms,
        attack_ms,
        crest,
        zero_crossing_rate(active_x),
        flatness,
        centroid,
        high_ratio,
        _voicing_score(active_x, sr),
        low_ratio,
        snr_db,
        *profile,
    ], dtype=np.float64)


def _feature_score(features: np.ndarray, strictness: float = 0.78) -> tuple[float, list[str]]:
    """Score one event.  Reasons are useful during live diagnostics/tests."""
    f = np.asarray(features, dtype=np.float64)
    if len(f) < FEATURE_COUNT:
        return 0.0, ["incomplete_features"]

    duration, attack, crest, zcr = f[:4]
    flatness, centroid, high_ratio, voicing = f[4:8]
    low_ratio, snr_db = f[8:10]
    score = 0.0
    reasons: list[str] = []

    # Hard rejects target the user's two failure modes: speech and dull taps.
    if duration < MIN_EVENT_MS or duration > MAX_EVENT_MS:
        return 0.0, ["duration"]
    if attack > 38.0:
        return 0.0, ["slow_attack"]
    if snr_db < 11.0:
        return 0.0, ["low_snr"]
    if voicing > 0.80 and low_ratio > 0.48:
        return 0.0, ["voiced_low_band"]
    if low_ratio > 0.88:
        return 0.0, ["low_frequency"]

    checks = [
        (12.0 <= duration <= 120.0, 0.12, "duration"),
        (attack <= 22.0, 0.14, "fast_attack"),
        (crest >= 2.2, 0.08, "crest"),
        (zcr >= 0.07, 0.11, "noisy_waveform"),
        (flatness >= 0.16, 0.15, "broadband"),
        (centroid >= 1.35, 0.10, "bright_spectrum"),
        (high_ratio >= 0.28, 0.14, "high_frequency"),
        (voicing <= 0.62, 0.08, "unvoiced"),
        (snr_db >= 15.0, 0.08, "clear_snr"),
    ]
    for passed, weight, name in checks:
        if passed:
            score += weight
        else:
            reasons.append(name)

    return score, reasons


def clap_score(features: np.ndarray, strictness: float = 0.78) -> float:
    """Public normalized single-event score in the range 0..1."""
    score, _ = _feature_score(features, strictness)
    return float(score)


def is_clap_like(features: np.ndarray, strictness: float = 0.78) -> bool:
    return clap_score(features, strictness) >= strictness


@dataclass
class DetectedEvent:
    segment: np.ndarray
    features: np.ndarray
    timestamp: float
    peak: float
    score: float
    speech_locked: bool


class EventDetector:
    """Adaptive event segmenter with a sustained-sound/speech lockout."""

    def __init__(self, sample_rate: int = SAMPLE_RATE,
                 sensitivity: float = 0.6,
                 block_size: int = STREAM_BLOCK):
        self.sample_rate = sample_rate
        self.block_seconds = block_size / sample_rate
        self.sensitivity = float(np.clip(sensitivity, 0.1, 1.0))
        history_len = int(NOISE_WINDOW_SECONDS / self.block_seconds)
        self.floor_history: collections.deque[float] = collections.deque(maxlen=history_len)
        self.floor = MIN_FLOOR
        self.prebuffer: collections.deque[np.ndarray] = collections.deque(maxlen=3)
        self.event_blocks: list[np.ndarray] = []
        self.in_event = False
        self.event_start = 0.0
        self.event_peak = 0.0
        self.total_time = 0.0
        self.quiet_blocks = 0
        self.loud_blocks = 0
        self.voice_blocks = 0
        self.speech_locked_until = 0.0
        self.last_event_time = 0.0

    @property
    def speech_locked(self) -> bool:
        return self.total_time < self.speech_locked_until

    def _block_voice_like(self, block: np.ndarray, level: float) -> bool:
        if level <= max(self.floor * 3.0, 0.002):
            return False
        f = extract_features(block, self.sample_rate, self.floor)
        # Voiced speech and phone audio tend to stay in the voice band.  A
        # second, duration-based guard below catches unvoiced speech.
        return bool(f[I_VOICING] > 0.24 and f[I_LOW_RATIO] > 0.30)

    def _finish_event(self) -> Optional[DetectedEvent]:
        if not self.event_blocks:
            return None
        segment = np.concatenate(self.event_blocks)
        self.event_blocks = []
        active = np.abs(segment)
        active_peak = float(np.max(active) + 1e-12)
        # Use actual active duration for classification; retain padding for
        # spectral stability at the edges.
        features = extract_features(segment, self.sample_rate, self.floor)
        score = clap_score(features)
        event_time = self.total_time
        event = DetectedEvent(
            segment=segment,
            features=features,
            timestamp=event_time,
            peak=active_peak,
            score=score,
            speech_locked=self.speech_locked,
        )
        self.last_event_time = event_time
        return event

    def push_block(self, block: np.ndarray, timestamp: Optional[float] = None) -> Optional[DetectedEvent]:
        block = np.asarray(block, dtype=np.float32).reshape(-1)
        if len(block) == 0:
            return None
        self.total_time = float(timestamp) if timestamp is not None else self.total_time + len(block) / self.sample_rate
        level = rms(block)
        self.floor_history.append(level)
        if len(self.floor_history) >= 8:
            self.floor = max(float(np.percentile(self.floor_history, NOISE_PERCENTILE)), MIN_FLOOR)

        onset_floor = max(self.floor * ONSET_MULTIPLIER, MIN_FLOOR * 4.0)
        offset_floor = max(self.floor * OFFSET_MULTIPLIER, MIN_FLOOR * 2.0)
        voice_like = self._block_voice_like(block, level)

        if level > max(self.floor * 3.0, MIN_FLOOR * 5.0):
            self.loud_blocks += 1
        else:
            self.loud_blocks = 0
        if voice_like:
            self.voice_blocks += 1
        else:
            self.voice_blocks = 0

        # A short impulse never reaches these counts.  Sustained sound is a
        # safe veto for talking, phone conversations, TV, and room noise.
        # A real clap can occupy roughly 70-100 ms at the microphone.  Keep
        # the generic loud-sound guard above that range so it does not veto a
        # valid clap while still catching sustained speech/music/phone audio.
        if self.voice_blocks >= 3 or self.loud_blocks >= 14:
            self.speech_locked_until = self.total_time + SPEECH_HOLDOFF_SECONDS

        if not self.in_event:
            self.prebuffer.append(block.copy())
            if level > onset_floor:
                self.in_event = True
                self.event_start = self.total_time - len(block) / self.sample_rate
                self.event_peak = level
                self.event_blocks = list(self.prebuffer)
                self.quiet_blocks = 0
        else:
            self.event_blocks.append(block.copy())
            self.event_peak = max(self.event_peak, level)
            elapsed_ms = (self.total_time - self.event_start) * 1000.0
            if level < offset_floor:
                self.quiet_blocks += 1
            else:
                self.quiet_blocks = 0

            if self.quiet_blocks >= 2 or elapsed_ms > MAX_EVENT_MS + 35:
                self.in_event = False
                self.quiet_blocks = 0
                event = self._finish_event()
                self.prebuffer.clear()
                return event

        return None


class ClapClassifier:
    """Generic classifier with an optional user calibration constraint."""

    def __init__(self, clap_features: Optional[list[np.ndarray]] = None,
                 strictness: float = 0.78):
        self.strictness = strictness
        self.mean = None
        self.std = None
        self.threshold = None
        if clap_features:
            arr = np.asarray(clap_features, dtype=np.float64)
            self.mean = arr.mean(axis=0)
            self.std = np.maximum(arr.std(axis=0), 0.05 * np.abs(self.mean) + 1e-3)
            distances = self._distance(arr)
            self.threshold = max(float(np.max(distances) * 1.5), 3.5)

    def _distance(self, features: np.ndarray) -> np.ndarray:
        if self.mean is None:
            return np.zeros(len(np.atleast_2d(features)))
        values = np.atleast_2d(features)
        return np.sqrt(np.sum(((values - self.mean) / self.std) ** 2, axis=-1))

    def score(self, features: np.ndarray) -> float:
        base = clap_score(features, self.strictness)
        if base < self.strictness or self.threshold is None:
            return base
        # Calibration only narrows the accepted set; it can never make a
        # speech/tap event pass the generic acoustic checks.
        distance = float(self._distance(features)[0])
        return base if distance <= self.threshold else 0.0

    def is_clap(self, features: np.ndarray) -> bool:
        return self.score(features) >= self.strictness


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    a = np.asarray(a[I_PROFILE:I_PROFILE + 4], dtype=np.float64)
    b = np.asarray(b[I_PROFILE:I_PROFILE + 4], dtype=np.float64)
    denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.dot(a, b) / denominator) if denominator else 0.0


def pair_similarity(first: DetectedEvent, second: DetectedEvent) -> float:
    """Return 0..1 similarity for two candidate clap fingerprints."""
    a, b = first.features, second.features
    amplitude_ratio = min(first.peak, second.peak) / max(first.peak, second.peak, 1e-12)
    duration_similarity = 1.0 - min(abs(a[I_DURATION] - b[I_DURATION]) / 90.0, 1.0)
    spectrum_similarity = np.clip(_cosine_similarity(a, b), 0.0, 1.0)
    shape_similarity = 1.0 - min(
        (abs(a[I_HIGH_RATIO] - b[I_HIGH_RATIO]) +
         abs(a[I_FLATNESS] - b[I_FLATNESS]) +
         abs(a[I_VOICING] - b[I_VOICING])) / 1.2,
        1.0,
    )
    return float(np.clip(
        0.30 * amplitude_ratio +
        0.20 * duration_similarity +
        0.30 * spectrum_similarity +
        0.20 * shape_similarity,
        0.0, 1.0,
    ))


class DoubleClapTracker:
    def __init__(self, on_double_clap: Callable[[float, float], None],
                 strictness: float = 0.78):
        self.on_double_clap = on_double_clap
        self.strictness = strictness
        self.pending: Optional[DetectedEvent] = None
        self.last_event_time = -float("inf")
        self.cooldown_until = -float("inf")

    def register_event(self, event: DetectedEvent, classifier: ClapClassifier) -> bool:
        now = event.timestamp
        if now < self.cooldown_until or now - self.last_event_time < REFRACTORY_PERIOD:
            return False
        self.last_event_time = now

        if event.speech_locked or not classifier.is_clap(event.features):
            return False

        if self.pending is None or now - self.pending.timestamp > MAX_GAP_BETWEEN_CLAPS:
            self.pending = event
            return False

        first = self.pending
        gap = now - first.timestamp
        self.pending = None
        if gap < MIN_GAP_BETWEEN_CLAPS:
            # Treat the newer event as the possible first clap; this prevents
            # a burst of clicks from accidentally creating a pair later.
            self.pending = event
            return False
        if gap > MAX_GAP_BETWEEN_CLAPS:
            self.pending = event
            return False
        if first.speech_locked or event.speech_locked:
            return False

        similarity = pair_similarity(first, event)
        pair_confidence = (
            0.45 * min(first.score, event.score) +
            0.25 * similarity +
            0.30 * (1.0 - abs(gap - 0.38) / 0.38 if gap <= 0.76 else 0.0)
        )
        # Require both similarity and confidence.  The confidence threshold
        # is intentionally high because false activation is more costly than
        # asking the user to clap again.
        if similarity < 0.72 or pair_confidence < 0.76:
            return False

        self.cooldown_until = now + COOLDOWN_SECONDS
        self.on_double_clap(gap, float(pair_confidence))
        return True

    # Compatibility with the original v2 helper and simple unit tests.
    def register_clap(self, now: float):
        return False


def emit(obj: dict):
    print(json.dumps(obj), flush=True)


def read_block(stream) -> np.ndarray:
    block, _ = stream.read(STREAM_BLOCK)
    return np.asarray(block[:, 0], dtype=np.float32)


def run_calibration(stream, detector: EventDetector) -> ClapClassifier:
    """Ambient-only warmup.  It never labels arbitrary sounds as claps."""
    for _ in range(int(2.0 * SAMPLE_RATE / STREAM_BLOCK)):
        read_block(stream)  # EventDetector learns its rolling floor in normal processing.
    return ClapClassifier()


def main():
    parser = argparse.ArgumentParser(description="Strict double-clap detector")
    parser.add_argument("--clap-sensitivity", type=float, default=0.6,
                        help="0.1-1.0; lower is more sensitive")
    parser.add_argument("--clap-enabled", action="store_true")
    parser.add_argument("--auto-calibrate", action="store_true",
                        help="warm up the adaptive ambient floor")
    # Accepted for compatibility with the unified daemon launch command.
    parser.add_argument("--wake-enabled", action="store_true")
    parser.add_argument("--wake-word")
    args, _ = parser.parse_known_args()

    try:
        import sounddevice as sd
    except Exception as exc:
        emit({"type": "fatal", "message": f"sounddevice_import_failed: {exc}"})
        return 1

    sensitivity = float(np.clip(args.clap_sensitivity, 0.1, 1.0))
    # Sensitivity controls only the final strictness modestly.  Even the most
    # sensitive setting retains the hard speech/tap rejects above.
    strictness = 0.74 + 0.10 * sensitivity
    detector = EventDetector(sensitivity=sensitivity)
    classifier = ClapClassifier(strictness=strictness)

    def on_double_clap(gap: float, confidence: float):
        emit({
            "type": "double_clap",
            "gap_ms": round(gap * 1000.0, 1),
            "confidence": round(confidence, 3),
            "message": "Double clap detected",
        })

    tracker = DoubleClapTracker(on_double_clap, strictness=strictness)
    emit({"type": "init", "name": "Strict Double-Clap Detector", "sample_rate": SAMPLE_RATE})

    try:
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            blocksize=STREAM_BLOCK,
            dtype="float32",
        ) as stream:
            emit({"type": "ready", "mode": "strict", "speech_holdoff_ms": int(SPEECH_HOLDOFF_SECONDS * 1000)})
            while True:
                event = detector.push_block(read_block(stream), time.monotonic())
                if event is not None:
                    if classifier.is_clap(event.features):
                        emit({
                            "type": "single_clap",
                            "duration_ms": round(float(event.features[I_DURATION]), 1),
                            "score": round(classifier.score(event.features), 3),
                        })
                        tracker.register_event(event, classifier)
                if int(detector.total_time * 10) % 50 == 0:
                    emit({"type": "amplitude", "value": round(rms(detector.event_blocks[-1]) if detector.event_blocks else 0.0, 6)})
    except KeyboardInterrupt:
        return 0
    except Exception as exc:
        emit({"type": "fatal", "message": str(exc)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
