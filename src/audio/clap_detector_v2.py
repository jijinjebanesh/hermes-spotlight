"""
Hermes Clap Detector - Based on TzurSoffer/clapDetection
Uses adaptive threshold with tap duration detection.
"""
import pyaudio
import struct
import math
import time
import json
import sys

# Configuration from reference implementation
INITIAL_TAP_THRESHOLD = 0.35  # Must exceed this for tap (matches your observation)
FORMAT = pyaudio.paInt16 
SHORT_NORMALIZE = (1.0/32768.0)
CHANNELS = 1  # Mono
RATE = 16000  # Lower sample rate for faster processing
INPUT_BLOCK_TIME = 0.01  # 10ms blocks
INPUT_FRAMES_PER_BLOCK = int(RATE * INPUT_BLOCK_TIME)

# Adaptive threshold controls
OVERSENSITIVE = 15.0 / INPUT_BLOCK_TIME      # Increase threshold after 15 noisy blocks/sec
UNDERSENSITIVE = 120.0 / INPUT_BLOCK_TIME    # Decrease threshold after 120 quiet blocks/sec
MAX_TAP_BLOCKS = 0.15 / INPUT_BLOCK_TIME     # Tap must be < 150ms

# Double clap timing
MIN_GAP_MS = 100
MAX_GAP_MS = 600

class ClapDetector:
    def __init__(self):
        self.pa = pyaudio.PyAudio()
        self.stream = self.open_mic_stream()
        self.tap_threshold = INITIAL_TAP_THRESHOLD
        self.noisycount = MAX_TAP_BLOCKS + 1  # Start in "listening" state
        self.quietcount = 0 
        self.errorcount = 0
        
        # Double clap tracking
        self.clap_times = []
        self.last_tap_time = None
        
    def open_mic_stream(self):
        """Open microphone stream with auto device selection."""
        device_index = None
        
        # Try to find microphone device
        for i in range(self.pa.get_device_count()):
            try:
                devinfo = self.pa.get_device_info_by_index(i)
                if devinfo['maxInputChannels'] > 0:
                    name_lower = devinfo['name'].lower()
                    # Prefer Realtek or default mic
                    if 'realtek' in name_lower or ('mic' in name_lower and 'default' in name_lower):
                        device_index = i
                        print(f"Using device {i}: {devinfo['name']}", file=sys.stderr)
                        break
            except:
                pass
        
        # Fall back to default
        if device_index is None:
            try:
                default = self.pa.get_default_input_device_info()
                device_index = default['index']
                print(f"Using default device {device_index}: {default['name']}", file=sys.stderr)
            except:
                device_index = 0
        
        stream = self.pa.open(
            format=FORMAT,
            channels=CHANNELS,
            rate=RATE,
            input=True,
            input_device_index=device_index,
            frames_per_buffer=INPUT_FRAMES_PER_BLOCK
        )
        
        return stream
    
    def get_rms(self, block):
        """Calculate RMS amplitude from audio block."""
        count = len(block) // 2
        format_str = "%dh" % count
        shorts = struct.unpack(format_str, block)
        
        sum_squares = 0.0
        for sample in shorts:
            n = sample * SHORT_NORMALIZE
            sum_squares += n * n
        
        return math.sqrt(sum_squares / count)
    
    def tap_detected(self, amplitude, duration_blocks):
        """Handle a detected tap/clap."""
        now = time.time() * 1000  # ms
        duration_ms = duration_blocks * INPUT_BLOCK_TIME * 1000
        
        # Filter out invalid durations (too short = click, too long = noise)
        if 10 <= duration_ms <= 150:
            # Valid tap
            self.clap_times = [t for t in self.clap_times if now - t < MAX_GAP_MS + 100]
            self.clap_times.append(now)
            
            if len(self.clap_times) >= 2:
                gap = self.clap_times[-1] - self.clap_times[-2]
                if MIN_GAP_MS <= gap <= MAX_GAP_MS:
                    # DOUBLE CLAP!
                    result = {
                        "type": "double_clap",
                        "gap_ms": round(gap, 1),
                        "threshold": round(self.tap_threshold, 3)
                    }
                    print(json.dumps(result), flush=True)
                    self.clap_times = []  # Reset
                    return
                elif gap < MIN_GAP_MS:
                    msg = f"Too fast ({gap:.0f}ms)"
                else:
                    msg = f"Too slow ({gap:.0f}ms)"
            else:
                msg = f"Single clap (duration: {duration_ms:.0f}ms)"
            
            result = {
                "type": "single_clap",
                "message": msg,
                "duration_ms": round(duration_ms, 1),
                "amplitude": round(amplitude, 3),
                "threshold": round(self.tap_threshold, 3)
            }
            print(json.dumps(result), flush=True)
    
    def listen(self):
        """Process one audio block."""
        try:
            block = self.stream.read(INPUT_FRAMES_PER_BLOCK, exception_on_overflow=False)
        except Exception as e:
            self.errorcount += 1
            if self.errorcount < 5:  # Don't spam errors
                print(json.dumps({"error": str(e)}), flush=True)
            self.noisycount = 1
            return
        
        amplitude = self.get_rms(block)
        
        if amplitude > self.tap_threshold:
            # Noisy block - above threshold
            self.quietcount = 0
            self.noisycount += 1
            
            # If consistently noisy, raise threshold (adaptive)
            if self.noisycount > OVERSENSITIVE:
                self.tap_threshold = min(0.9, self.tap_threshold * 1.05)
                self.noisycount = OVERSENSITIVE
            
        else:
            # Quiet block - below threshold
            if 1 <= self.noisycount <= MAX_TAP_BLOCKS:
                # Was noisy, now quiet = potential tap ended
                self.tap_detected(amplitude, self.noisycount)
            
            self.noisycount = 0
            self.quietcount += 1
            
            # If consistently quiet, lower threshold (adaptive)
            if self.quietcount > UNDERSENSITIVE:
                self.tap_threshold = max(0.1, self.tap_threshold * 0.95)
                self.quietcount = UNDERSENSITIVE
    
    def run(self):
        """Main loop - output JSON status for each block."""
        frame = 0
        try:
            while True:
                self.listen()
                frame += 1
                
                # Output status every 10 frames (~100ms)
                if frame % 10 == 0:
                    status = {
                        "frame": frame,
                        "amplitude": round(self.get_rms(self.stream.read(INPUT_FRAMES_PER_BLOCK, exception_on_overflow=False)) if hasattr(self, 'stream') else 0, 4),
                        "threshold": round(self.tap_threshold, 3),
                        "noisycount": self.noisycount,
                        "quietcount": self.quietcount,
                        "pending_claps": len(self.clap_times)
                    }
                    # Don't spam - only output on events or every 50 frames
                    if frame % 50 == 0:
                        print(json.dumps({"status": status}), flush=True)
                        
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()
    
    def stop(self):
        """Clean up resources."""
        if hasattr(self, 'stream'):
            self.stream.stop_stream()
            self.stream.close()
        if hasattr(self, 'pa'):
            self.pa.terminate()

if __name__ == "__main__":
    print(json.dumps({"init": "Hermes Clap Detector (clapDetection-based)", "threshold": INITIAL_TAP_THRESHOLD}), flush=True)
    detector = ClapDetector()
    detector.run()