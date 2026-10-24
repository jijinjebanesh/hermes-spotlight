"""
Hermes Clap Detector - Auto-Calibration Mode
Records 30 seconds of audio data, then analyzes to find optimal threshold.
"""
import pyaudio
import struct
import math
import time
import json
import sys
from pathlib import Path

# Initial configuration (will be calibrated)
INITIAL_TAP_THRESHOLD = 0.35
FORMAT = pyaudio.paInt16 
SHORT_NORMALIZE = (1.0/32768.0)
CHANNELS = 1
RATE = 16000
INPUT_BLOCK_TIME = 0.01  # 10ms
INPUT_FRAMES_PER_BLOCK = int(RATE * INPUT_BLOCK_TIME)

# Recording duration
RECORDING_DURATION_SEC = 30
LOG_FILE = Path(__file__).parent / "clap_calibration_log.json"


class AudioRecorder:
    """Records audio data and events for later analysis."""
    
    def __init__(self):
        self.pa = pyaudio.PyAudio()
        self.stream = self.open_mic_stream()
        self.tap_threshold = INITIAL_TAP_THRESHOLD
        
        #Detection state
        self.noisycount = 0
        self.quietcount = 0
        self.MAX_TAP_BLOCKS = int(0.15 / INPUT_BLOCK_TIME)
        
        # Data logs
        self.amplitude_log = []  # (timestamp_ms, amplitude)
        self.events = []  # (timestamp_ms, event_type, data)
        self.start_time = time.time()
        
        # Clap tracking
        self.clap_times = []
        self.pending_tap_start = None
        
    def open_mic_stream(self):
        device_index = None
        for i in range(self.pa.get_device_count()):
            try:
                info = self.pa.get_device_info_by_index(i)
                if info['maxInputChannels'] > 0:
                    name = info['name'].lower()
                    if 'realtek' in name or ('mic' in name and 'default' in name):
                        device_index = i
                        break
            except:
                pass
        
        if device_index is None:
            try:
                device_index = self.pa.get_default_input_device_info()['index']
            except:
                device_index = 0
        
        print(f"Using device {device_index}", file=sys.stderr)
        
        return self.pa.open(
            format=FORMAT,
            channels=CHANNELS,
            rate=RATE,
            input=True,
            input_device_index=device_index,
            frames_per_buffer=INPUT_FRAMES_PER_BLOCK
        )
    
    def get_rms(self, block):
        count = len(block) // 2
        format_str = "%dh" % count
        shorts = struct.unpack(format_str, block)
        
        sum_squares = 0.0
        for sample in shorts:
            n = sample * SHORT_NORMALIZE
            sum_squares += n * n
        
        return math.sqrt(sum_squares / count)
    
    def record_block(self, block):
        """Process one audio block and log data."""
        amplitude = self.get_rms(block)
        now_ms = (time.time() - self.start_time) * 1000
        
        # Log amplitude
        self.amplitude_log.append((now_ms, amplitude))
        
        # Detect events
        if amplitude > self.tap_threshold:
            if self.pending_tap_start is None:
                self.pending_tap_start = now_ms
                self.events.append((now_ms, "tap_start", {"amplitude": amplitude}))
            self.noisycount += 1
            self.quietcount = 0
        else:
            if self.pending_tap_start is not None and self.noisycount > 0:
                # Tap ended
                duration_ms = (now_ms - self.pending_tap_start)
                tap_event = {
                    "start_ms": self.pending_tap_start,
                    "end_ms": now_ms,
                    "duration_ms": duration_ms,
                    "block_count": self.noisycount,
                    "threshold": self.tap_threshold
                }
                
                # Validate tap duration
                if 10 <= duration_ms <= 150:
                    self.events.append((now_ms, "tap_valid", tap_event))
                    self.clap_times.append(now_ms)
                    
                    # Check for double clap
                    if len(self.clap_times) >= 2:
                        gap = self.clap_times[-1] - self.clap_times[-2]
                        if 100 <= gap <= 600:
                            self.events.append((now_ms, "double_clap", {
                                "gap_ms": gap,
                                "clap1": self.clap_times[-2],
                                "clap2": self.clap_times[-1]
                            }))
                            print(f"✓ DOUBLE CLAP DETECTED (gap: {gap:.0f}ms)", file=sys.stderr)
                        else:
                            self.events.append((now_ms, "gap_invalid", {"gap_ms": gap}))
                    else:
                        print(f"✓ Single clap detected ({duration_ms:.0f}ms)", file=sys.stderr)
                else:
                    self.events.append((now_ms, "tap_invalid", tap_event))
                    print(f"⚠️ Invalid tap duration: {duration_ms:.0f}ms", file=sys.stderr)
                
                self.pending_tap_start = None
            
            self.noisycount = 0
            self.quietcount += 1
        
        # Limit memory
        if len(self.amplitude_log) > 100000:  # ~1000 sec
            self.amplitude_log = self.amplitude_log[-50000:]
    
    def run(self, duration_sec):
        """Record for specified duration."""
        print(f"🎤 Recording for {duration_sec} seconds...", file=sys.stderr)
        print(f"📊 Clap now to calibrate threshold!", file=sys.stderr)
        print("", file=sys.stderr)
        
        frame = 0
        try:
            while (time.time() - self.start_time) < duration_sec:
                block = self.stream.read(INPUT_FRAMES_PER_BLOCK, exception_on_overflow=False)
                self.record_block(block)
                
                # Progress indicator every 5 sec
                elapsed = time.time() - self.start_time
                if frame % 500 == 0 and elapsed > 0:
                    print(f"⏱️  {elapsed:.1f}s / {duration_sec}s", file=sys.stderr)
                
                frame += 1
                
        except KeyboardInterrupt:
            print("\n⚠️  Interrupted by user", file=sys.stderr)
        finally:
            self.stop()
    
    def stop(self):
        if hasattr(self, 'stream'):
            self.stream.stop_stream()
            self.stream.close()
        if hasattr(self, 'pa'):
            self.pa.terminate()
    
    def save_log(self, path):
        """Save recorded data to JSON file."""
        # Calculate statistics
        amplitudes = [a for _, a in self.amplitude_log]
        if amplitudes:
            import statistics
            stats = {
                "count": len(amplitudes),
                "min": min(amplitudes),
                "max": max(amplitudes),
                "mean": statistics.mean(amplitudes),
                "median": statistics.median(amplitudes),
                "stdev": statistics.stdev(amplitudes) if len(amplitudes) > 1 else 0,
                "p95": sorted(amplitudes)[int(len(amplitudes) * 0.95)] if amplitudes else 0,
                "p99": sorted(amplitudes)[int(len(amplitudes) * 0.99)] if amplitudes else 0,
            }
        else:
            stats = {}
        
        # Find optimal threshold
        valid_taps = [e[2] for e in self.events if e[1] == "tap_valid"]
        noise_peaks = [a for _, a in self.amplitude_log if a < 0.1]  # Quiet periods
        
        if valid_taps and noise_peaks:
            min_tap_amp = min(t["amplitude"] for t in valid_taps) if valid_taps else 0.35
            max_noise = max(noise_peaks) if noise_peaks else 0.01
            # Optimal threshold is between max noise and min tap
            optimal_threshold = (max_noise * 0.5) + (min_tap_amp * 0.5)
        else:
            optimal_threshold = INITIAL_TAP_THRESHOLD
        
        # Find optimal timing
        if len(self.clap_times) >= 2:
            gaps = [self.clap_times[i] - self.clap_times[i-1] 
                   for i in range(1, len(self.clap_times))]
            avg_gap = sum(gaps) / len(gaps)
            gap_recommendation = {
                "min": min(80, min(gaps) * 0.8),
                "max": max(600, max(gaps) * 1.2),
                "average": avg_gap
            }
        else:
            gap_recommendation = {"min": 100, "max": 600, "average": 300}
        
        data = {
            "recording_duration_sec": RECORDING_DURATION_SEC,
            "sample_rate": RATE,
            "block_size": INPUT_FRAMES_PER_BLOCK,
            "statistics": stats,
            "events": [(t, e, d) for t, e, d in self.events],
            "valid_taps_count": len([e for e in self.events if e[1] == "tap_valid"]),
            "double_claps_count": len([e for e in self.events if e[1] == "double_clap"]),
            "recommendations": {
                "threshold": round(optimal_threshold, 3),
                "current_threshold": INITIAL_TAP_THRESHOLD,
                "min_valid_tap_amplitude": round(min(t["amplitude"] for t in valid_taps), 4) if valid_taps else None,
                "max_noise_amplitude": round(max(noise_peaks), 4) if noise_peaks else None,
                "timing": gap_recommendation,
            }
        }
        
        # Sample amplitude data (every 10th point to save space)
        data["amplitude_samples"] = self.amplitude_log[::10]
        
        with open(path, 'w') as f:
            json.dump(data, f, indent=2)
        
        print(f"\n💾 Log saved to: {path}", file=sys.stderr)
        return data


def analyze_log(path):
    """Analyze the calibration log and print recommendations."""
    if not path.exists():
        print(f"❌ Log file not found: {path}")
        return
    
    with open(path, 'r') as f:
        data = json.load(f)
    
    print("\n" + "=" * 70)
    print("📊 CLAP DETECTION CALIBRATION RESULTS")
    print("=" * 70)
    
    stats = data.get("statistics", {})
    print(f"\n📈 Amplitude Statistics:")
    print(f"   Samples: {stats.get('count', 0)}")
    print(f"   Min: {stats.get('min', 0):.4f}")
    print(f"   Max: {stats.get('max', 0):.4f}")
    print(f"   Mean: {stats.get('mean', 0):.4f}")
    print(f"   P95: {stats.get('p95', 0):.4f}")
    print(f"   P99: {stats.get('p99', 0):.4f}")
    
    print(f"\n🎯 Events Detected:")
    print(f"   Valid taps: {data.get('valid_taps_count', 0)}")
    print(f"   Double claps: {data.get('double_claps_count', 0)}")
    
    rec = data.get("recommendations", {})
    print(f"\n⚙️  RECOMMENDED SETTINGS:")
    print(f"   Threshold: {rec.get('threshold', 0.35):.3f} (was {rec.get('current_threshold', 0.35):.3f})")
    print(f"   Min tap amplitude: {rec.get('min_valid_tap_amplitude', 'N/A')}")
    print(f"   Max noise amplitude: {rec.get('max_noise_amplitude', 'N/A')}")
    
    timing = rec.get("timing", {})
    if timing:
        print(f"\n⏱️  Timing Recommendations:")
        print(f"   Min gap: {timing.get('min', 100):.0f}ms")
        print(f"   Max gap: {timing.get('max', 600):.0f}ms")
        print(f"   Your average: {timing.get('average', 300):.0f}ms")
    
    # Generate patch instructions
    print(f"\n🔧 TO APPLY RECOMMENDATIONS:")
    print(f"   1. Open: src/audio/clap_detector.py")
    print(f"   2. Change: INITIAL_TAP_THRESHOLD = {rec.get('threshold', 0.35):.3f}")
    print(f"   3. (Optional) Adjust MIN_GAP_MS and MAX_GAP_MS based on your timing")
    print(f"   4. Rebuild: npm run build")
    print(f"   5. Restart Electron")
    
    print("\n" + "=" * 70)
    
    return data


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "analyze":
        analyze_log(LOG_FILE)
    else:
        # Recording mode
        recorder = AudioRecorder()
        recorder.run(RECORDING_DURATION_SEC)
        recorder.save_log(LOG_FILE)
        
        print(f"\n✅ Recording complete!")
        print(f"   Run 'python {sys.argv[0]} analyze' to see recommendations")