import importlib.util
import sys
import unittest

import numpy as np


MODULE_PATH = "scripts/double_clap_detector_v2.py"
SPEC = importlib.util.spec_from_file_location("double_clap_detector_v2", MODULE_PATH)
DETECTOR = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = DETECTOR
SPEC.loader.exec_module(DETECTOR)


class DoubleClapDetectorTests(unittest.TestCase):
    def setUp(self):
        self.rng = np.random.default_rng(42)

    def clap(self):
        n = int(0.08 * DETECTOR.SAMPLE_RATE)
        t = np.arange(n, dtype=np.float32)
        envelope = np.minimum(t / (DETECTOR.SAMPLE_RATE * 0.002), 1.0)
        envelope *= np.exp(-t / (DETECTOR.SAMPLE_RATE * 0.035))
        return (self.rng.normal(size=n) * envelope * 0.25).astype(np.float32)

    def tap(self):
        n = int(0.12 * DETECTOR.SAMPLE_RATE)
        t = np.arange(n, dtype=np.float32) / DETECTOR.SAMPLE_RATE
        return (0.25 * np.sin(2 * np.pi * 240 * t) * np.exp(-t / 0.045)).astype(np.float32)

    def speech(self, duration=0.42):
        n = int(duration * DETECTOR.SAMPLE_RATE)
        t = np.arange(n, dtype=np.float32) / DETECTOR.SAMPLE_RATE
        envelope = np.minimum(t / 0.03, 1.0)
        envelope *= np.minimum((duration - t) / 0.03, 1.0)
        return (
            envelope
            * (0.15 * np.sin(2 * np.pi * 180 * t) + 0.08 * np.sin(2 * np.pi * 360 * t))
        ).astype(np.float32)

    def detect_events(self, audio):
        detector = DETECTOR.EventDetector()
        events = []
        for start in range(0, len(audio), DETECTOR.STREAM_BLOCK):
            block = audio[start:start + DETECTOR.STREAM_BLOCK]
            event = detector.push_block(block, start / DETECTOR.SAMPLE_RATE)
            if event is not None:
                events.append(event)
        return events

    def test_broadband_fast_clap_is_accepted(self):
        features = DETECTOR.extract_features(self.clap())
        self.assertGreaterEqual(DETECTOR.clap_score(features), 0.78)
        self.assertTrue(DETECTOR.is_clap_like(features))

    def test_resonant_tap_is_rejected(self):
        features = DETECTOR.extract_features(self.tap())
        self.assertLess(DETECTOR.clap_score(features), 0.78)
        self.assertFalse(DETECTOR.is_clap_like(features))

    def test_speech_is_rejected(self):
        features = DETECTOR.extract_features(self.speech())
        self.assertFalse(DETECTOR.is_clap_like(features))

    def test_valid_double_clap_triggers_once(self):
        audio = np.concatenate([
            np.zeros(int(0.5 * DETECTOR.SAMPLE_RATE), dtype=np.float32),
            self.clap(),
            np.zeros(int(0.3 * DETECTOR.SAMPLE_RATE), dtype=np.float32),
            self.clap(),
            np.zeros(int(0.5 * DETECTOR.SAMPLE_RATE), dtype=np.float32),
        ])
        events = self.detect_events(audio)
        found = []
        tracker = DETECTOR.DoubleClapTracker(lambda gap, confidence: found.append((gap, confidence)))
        classifier = DETECTOR.ClapClassifier()
        for event in events:
            tracker.register_event(event, classifier)
        self.assertEqual(len(found), 1)
        self.assertGreater(found[0][1], 0.76)

    def test_speech_then_clap_is_locked_out(self):
        audio = np.concatenate([
            np.zeros(int(0.25 * DETECTOR.SAMPLE_RATE), dtype=np.float32),
            self.speech(0.5),
            np.zeros(int(0.35 * DETECTOR.SAMPLE_RATE), dtype=np.float32),
            self.clap(),
            np.zeros(int(0.5 * DETECTOR.SAMPLE_RATE), dtype=np.float32),
        ])
        events = self.detect_events(audio)
        found = []
        tracker = DETECTOR.DoubleClapTracker(lambda gap, confidence: found.append((gap, confidence)))
        classifier = DETECTOR.ClapClassifier()
        for event in events:
            tracker.register_event(event, classifier)
        self.assertEqual(found, [])

    def test_two_taps_do_not_trigger(self):
        audio = np.concatenate([
            np.zeros(int(0.5 * DETECTOR.SAMPLE_RATE), dtype=np.float32),
            self.tap(),
            np.zeros(int(0.3 * DETECTOR.SAMPLE_RATE), dtype=np.float32),
            self.tap(),
            np.zeros(int(0.5 * DETECTOR.SAMPLE_RATE), dtype=np.float32),
        ])
        events = self.detect_events(audio)
        found = []
        tracker = DETECTOR.DoubleClapTracker(lambda gap, confidence: found.append((gap, confidence)))
        classifier = DETECTOR.ClapClassifier()
        for event in events:
            tracker.register_event(event, classifier)
        self.assertEqual(found, [])

    def test_claps_too_close_are_not_a_double_clap(self):
        audio = np.concatenate([
            np.zeros(int(0.5 * DETECTOR.SAMPLE_RATE), dtype=np.float32),
            self.clap(),
            np.zeros(int(0.08 * DETECTOR.SAMPLE_RATE), dtype=np.float32),
            self.clap(),
            np.zeros(int(0.5 * DETECTOR.SAMPLE_RATE), dtype=np.float32),
        ])
        events = self.detect_events(audio)
        found = []
        tracker = DETECTOR.DoubleClapTracker(lambda gap, confidence: found.append((gap, confidence)))
        classifier = DETECTOR.ClapClassifier()
        for event in events:
            tracker.register_event(event, classifier)
        self.assertEqual(found, [])


if __name__ == "__main__":
    unittest.main()
