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
INITIAL_TAP_THRESHOLD = 0.015  # Default, overridable via --sensitivity
FORMAT = pyaudio.paInt16 
SHORT_NORMALIZE = (1.0/32768.0)
CHANNELS = 1  # Mono
RATE = 16000  # Lower sample rate for faster processing
INPUT_BLOCK_TIME = 0.01  # 10ms blocks
INPUT_FRAMES_PER_BLOCK = int(RATE * INPUT_BLOCK_TIME)

# Adaptive threshold controls
OVERSENSITIVE = 15.0 / INPUT_BLOCK_TIME      # Increase threshold after 15 noisy blocks/sec
UNDERSENSITIVE = 120.0 / INPUT_BLOCK_TIME    # Decrease threshold after 120 quiet blocks/sec
MAX_TAP_BLOCKS = 0.10 / INPUT_BLOCK_TIME     # Tap must be < 100ms

# Double clap timing - CALIBRATED FOR 1500ms MAX INTERVAL
MIN_GAP_MS = 100
MAX_GAP_MS = 1500  # Increased from 600ms to 1500ms as requested

def parse_sensitivity():
    """Parse --sensitivity argument from command line.
    Maps UI slider 0.1-1.0 to threshold: lower = more sensitive.
    e.g. 0.1 -> 0.01 (very sensitive), 1.0 -> 0.1 (less sensitive)."""
    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == '--sensitivity' and i + 1 < len(args):
            try:
                val = float(args[i + 1])
                val = max(0.05, min(1.0, val))  # clamp
                return val / 10.0  # 0.1 -> 0.01, 1.0 -> 0.1
            except ValueError:
                pass
    return INITIAL_TAP_THRESHOLD  # default

class ClapDetector:
    def __init__(self):
        self.pa = pyaudio.PyAudio()
        self.stream = self.open_mic_stream()
        self.tap_threshold = parse_sensitivity()  # from --sensitivity CLI arg
        self.noisycount = MAX_TAP_BLOCKS + 1  # Start in "listening" state
        self.quietcount = 0 
        self.errorcount = 0
        
        # Double clap tracking
        self.clap_times = []
        self.last_tap_time = None
        
        # Frame counter for debug output
        self.frame = 0
        self.last_amplitude = 0.0
        
    def open_mic_stream(self, device_index=None):
        """Open microphone stream - prefers default device for reliability."""
        # If explicit device requested, try it first
        if device_index is not None:
            try:
                devinfo = self.pa.get_device_info_by_index(device_index)
                print(f"Opening explicit device {device_index}: {devinfo['name']}", file=sys.stderr)
                return self.pa.open(
                    format=FORMAT,
                    channels=min(CHANNELS, devinfo['maxInputChannels']),
                    rate=RATE,
                    input=True,
                    input_device_index=device_index,
                    frames_per_buffer=INPUT_FRAMES_PER_BLOCK
                )
            except Exception as e:
                print(f"Failed to open explicit device {device_index}: {e}", file=sys.stderr)
                # Fall through to default
        
        # DEFAULT STRATEGY: Always try default input device first
        # This is more reliable than auto-selection which can pick wrong device
        try:
            default_info = self.pa.get_default_input_device_info()
            print(f"Using default input device: {default_info['name']}", file=sys.stderr)
            
            stream = self.pa.open(
                format=FORMAT,
                channels=min(CHANNELS, default_info['maxInputChannels']),
                rate=RATE,
                input=True,
                input_device_index=default_info['index'],
                frames_per_buffer=INPUT_FRAMES_PER_BLOCK
            )
            print(f"✓ Successfully opened stream", file=sys.stderr)
            return stream
        except Exception as first_error:
            print(f"Default device failed: {first_error}", file=sys.stderr)
            print(f"Trying fallback device selection...", file=sys.stderr)
            
            # Fallback: Try to find any working input device
            for i in range(self.pa.get_device_count()):
                try:
                    devinfo = self.pa.get_device_info_by_index(i)
                    if devinfo['maxInputChannels'] > 0:
                        stream = self.pa.open(
                            format=FORMAT,
                            channels=min(CHANNELS, devinfo['maxInputChannels']),
                            rate=RATE,
                            input=True,
                            input_device_index=i,
                            frames_per_buffer=INPUT_FRAMES_PER_BLOCK
                        )
                        print(f"✓ Fallback success: device {i} ({devinfo['name']})", file=sys.stderr)
                        return stream
                except:
                    pass
            
            # All attempts failed
            raise IOError(
                f"Could not open any microphone input. Default failed: {first_error}. "
                f"Check Windows audio permissions and device availability."
            )
    
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
        self.last_amplitude = amplitude
        
        # Update frame counter
        self.frame += 1
        
        # DEBUG: Output amplitude on first 100 frames to diagnose mic
        if self.frame < 100 and self.frame % 10 == 0:
            print(json.dumps({"debug_amplitude": amplitude, "frame": self.frame}), flush=True)
        
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
        try:
            while True:
                self.listen()
                
                # Output status every 50 frames (~500ms)
                if self.frame % 50 == 0:
                    status = {
                        "frame": self.frame,
                        "amplitude": round(self.last_amplitude, 4),  # Use the amplitude from the last block
                        "threshold": round(self.tap_threshold, 3),
                        "noisycount": self.noisycount,
                        "quietcount": self.quietcount,
                        "pending_claps": len(self.clap_times)
                    }
                    # Don't spam - only output on events or every 100 frames
                    if self.frame % 100 == 0:
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
    threshold = parse_sensitivity()
    print(json.dumps({"init": "Hermes Clap Detector (clapDetection-based)", "threshold": threshold}), flush=True)
    detector = ClapDetector()
    detector.run()