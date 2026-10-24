"""
Hermes Clap Detector Verifier - Based on clapDetection repo
Tests the same detection logic as the actual clap_detector.py
"""
import pyaudio
import struct
import math
import time
import sys

# Configuration - MUST MATCH clap_detector.py
INITIAL_TAP_THRESHOLD = 0.18  # CALIBRATED for Jijin's mic
FORMAT = pyaudio.paInt16 
SHORT_NORMALIZE = (1.0/32768.0)
CHANNELS = 1
RATE = 16000
INPUT_BLOCK_TIME = 0.01  # 10ms
INPUT_FRAMES_PER_BLOCK = int(RATE * INPUT_BLOCK_TIME)

# Detection parameters
MAX_TAP_BLOCKS = int(0.15 / INPUT_BLOCK_TIME)  # 150ms max
MIN_GAP_MS = 100
MAX_GAP_MS = 1000

try:
    import tkinter as tk
    HAS_GUI = True
except ImportError:
    HAS_GUI = False


class ClapDetector:
    """Same detection logic as clap_detector.py for accurate testing."""
    
    def __init__(self):
        self.tap_threshold = INITIAL_TAP_THRESHOLD
        self.noisycount = MAX_TAP_BLOCKS + 1  # Start listening
        self.quietcount = 0
        self.clap_times = []
        
        # For GUI display
        self.current_amplitude = 0.0
        self.status_message = "Listening... (clap twice within 600ms)"
        self.amplitude_history = []
        
    def get_rms(self, block):
        """Calculate RMS amplitude - same as clap_detector.py"""
        count = len(block) // 2
        format_str = "%dh" % count
        shorts = struct.unpack(format_str, block)
        
        sum_squares = 0.0
        for sample in shorts:
            n = sample * SHORT_NORMALIZE
            sum_squares += n * n
        
        return math.sqrt(sum_squares / count)
    
    def process_block(self, block):
        """Process one audio block - same logic as clap_detector.py"""
        amplitude = self.get_rms(block)
        self.current_amplitude = amplitude
        self.amplitude_history.append(amplitude)
        if len(self.amplitude_history) > 100:
            self.amplitude_history.pop(0)
        
        if amplitude > self.tap_threshold:
            # Above threshold
            self.quietcount = 0
            self.noisycount += 1
            
        else:
            # Below threshold
            if 1 <= self.noisycount <= MAX_TAP_BLOCKS:
                # Tap ended - validate and record
                duration_ms = self.noisycount * INPUT_BLOCK_TIME * 1000
                if 10 <= duration_ms <= 150:
                    now = time.time() * 1000
                    self.clap_times = [t for t in self.clap_times if now - t < MAX_GAP_MS + 100]
                    self.clap_times.append(now)
                    
                    if len(self.clap_times) >= 2:
                        gap = self.clap_times[-1] - self.clap_times[-2]
                        if MIN_GAP_MS <= gap <= MAX_GAP_MS:
                            self.status_message = f"🎉 DOUBLE CLAP! (gap: {gap:.0f}ms)"
                            self.clap_times = []
                        elif gap < MIN_GAP_MS:
                            self.status_message = f"⚠️ Too fast ({gap:.0f}ms)"
                        else:
                            self.status_message = f"⚠️ Too slow ({gap:.0f}ms)"
                    else:
                        self.status_message = f"✓ Clap detected ({duration_ms:.0f}ms)"
                else:
                    self.status_message = f"⚠️ Noise ({duration_ms:.0f}ms)"
            
            self.noisycount = 0
            self.quietcount += 1
        
        return amplitude


def gui_mode():
    """GUI visualization matching clap_detector.py logic."""
    detector = ClapDetector()
    
    root = tk.Tk()
    root.title("Hermes Clap Detector (clapDetection-based)")
    root.geometry("900x500")
    root.configure(bg='#1a1a2e')
    
    # Title
    title = tk.Label(root, text="🎤 HERMES CLAP DETECTOR", 
                     font=('Arial', 24, 'bold'), fg='#ffffff', bg='#1a1a2e')
    title.pack(pady=10)
    
    # Subtitle with thresholds
    subtitle = tk.Label(root, 
                       text=f"Threshold: {INITIAL_TAP_THRESHOLD} | Valid duration: 10-150ms | Gap: 100-600ms",
                       font=('Arial', 12), fg='#888888', bg='#1a1a2e')
    subtitle.pack(pady=5)
    
    # Status message (large)
    status_var = tk.StringVar(value=detector.status_message)
    status_label = tk.Label(root, textvariable=status_var,
                           font=('Arial', 18, 'bold'), fg='#00ff88', bg='#1a1a2e',
                           wraplength=850, justify='center')
    status_label.pack(pady=20)
    
    # Amplitude meter canvas
    canvas = tk.Canvas(root, width=800, height=250, bg='#16213e', highlightthickness=0)
    canvas.pack(pady=10)
    
    # Threshold line
    threshold_y = 200
    canvas.create_line(50, threshold_y, 750, threshold_y, 
                       fill='#ff4444', width=3, dash=(15, 8))
    canvas.create_text(760, threshold_y - 10, text=f"Threshold: {INITIAL_TAP_THRESHOLD}", 
                       fill='#ff4444', font=('Arial', 11, 'bold'), anchor='nw')
    
    # Current amplitude bar
    amp_bar = canvas.create_rectangle(50, 220, 50, 220, fill='#00a8ff', outline='')
    
    # Amplitude history line
    history_line = canvas.create_line(50, 200, 750, 200, fill='#00ff88', width=2)
    
    # Stats panel
    stats_frame = tk.Frame(root, bg='#1a1a2e')
    stats_frame.pack(pady=10)
    
    amp_var = tk.StringVar(value="Amplitude: 0.0000")
    tk.Label(stats_frame, textvariable=amp_var, font=('Consolas', 12), 
             fg='#00ffff', bg='#1a1a2e').grid(row=0, column=0, padx=20)
    
    state_var = tk.StringVar(value="State: Listening")
    tk.Label(stats_frame, textvariable=state_var, font=('Consolas', 12), 
             fg='#ff8800', bg='#1a1a2e').grid(row=0, column=1, padx=20)
    
    duration_var = tk.StringVar(value="Duration: 0ms")
    tk.Label(stats_frame, textvariable=duration_var, font=('Consolas', 12), 
             fg='#ffff00', bg='#1a1a2e').grid(row=0, column=2, padx=20)
    
    # Instructions
    instructions = tk.Label(root, 
                           text="👏 Clap twice (100-600ms apart) to test\n" +
                                "💡 Real claps should exceed 0.35 amplitude",
                           font=('Arial', 11), fg='#666666', bg='#1a1a2e',
                           justify='center')
    instructions.pack(pady=10)
    
    def update_display():
        """Update GUI with current values."""
        amplitude = detector.current_amplitude
        status_var.set(detector.status_message)
        
        # Update amplitude bar (scale so 0.5 = full height)
        bar_height = min(amplitude * 400, 200)
        canvas.coords(amp_bar, 50, 220, 750, 220 - bar_height)
        
        # Update history line
        history_points = []
        for i, amp in enumerate(detector.amplitude_history[-100:]):
            x = 50 + (i * 7)
            y = 220 - min(amp * 400, 200)
            history_points.extend([x, y])
        if len(history_points) >= 2:
            canvas.coords(history_line, history_points)
        
        # Update stats
        amp_var.set(f"Amplitude: {amplitude:.4f}")
        
        if amplitude > INITIAL_TAP_THRESHOLD:
            state_var.set("State: ⚡ ABOVE THRESHOLD")
        elif detector.noisycount > 0:
            state_var.set(f"State: Recovering ({detector.noisycount} blocks)")
        else:
            state_var.set("State: ✓ Listening")
        
        if detector.noisycount > 0:
            dur = detector.noisycount * INPUT_BLOCK_TIME * 1000
            duration_var.set(f"Duration: {dur:.0f}ms")
        else:
            duration_var.set("Duration: --")
        
        root.after(30, update_display)
    
    def init_audio():
        """Initialize microphone in background thread."""
        try:
            p = pyaudio.PyAudio()
            
            # Find microphone device
            device_index = None
            for i in range(p.get_device_count()):
                try:
                    info = p.get_device_info_by_index(i)
                    if info['maxInputChannels'] > 0:
                        name = info['name'].lower()
                        if 'realtek' in name or ('mic' in name and 'default' in name):
                            device_index = i
                            break
                except:
                    pass
            
            if device_index is None:
                try:
                    device_index = p.get_default_input_device_info()['index']
                except:
                    device_index = 0
            
            stream = p.open(
                format=FORMAT,
                channels=CHANNELS,
                rate=RATE,
                input=True,
                input_device_index=device_index,
                frames_per_buffer=INPUT_FRAMES_PER_BLOCK
            )
            
            def read_loop():
                while detector.noisycount >= 0:  # Always true, use as running flag
                    try:
                        block = stream.read(INPUT_FRAMES_PER_BLOCK, exception_on_overflow=False)
                        detector.process_block(block)
                    except:
                        break
                stream.close()
                p.terminate()
            
            import threading
            t = threading.Thread(target=read_loop, daemon=True)
            t.start()
            
        except Exception as e:
            status_var.set(f"❌ Audio Error: {e}")
    
    # Start
    root.after(100, update_display)
    root.after(300, init_audio)
    
    def on_close():
        detector.noisycount = -1  # Stop reading loop
        root.destroy()
    
    root.protocol("WM_DELETE_WINDOW", on_close)
    
    print("Starting GUI...")
    print(f"Threshold: {INITIAL_TAP_THRESHOLD}")
    print("Clap twice within 600ms to test\n")
    
    try:
        root.mainloop()
    except Exception as e:
        print(f"GUI error: {e}")
        print("\nFalling back to console mode...\n")
        console_mode()


def console_mode():
    """Console-based visualization."""
    print("=" * 70)
    print("HERMES CLAP DETECTOR - CONSOLE MODE")
    print("=" * 70)
    print(f"Threshold: {INITIAL_TAP_THRESHOLD}")
    print(f"Valid clap duration: 10-150ms")
    print(f"Double clap gap: {MIN_GAP_MS}-{MAX_GAP_MS}ms")
    print("=" * 70)
    print("\nClap TWICE to test detection.\n")
    
    detector = ClapDetector()
    
    try:
        p = pyaudio.PyAudio()
        stream = p.open(
            format=FORMAT,
            channels=CHANNELS,
            rate=RATE,
            input=True,
            frames_per_buffer=INPUT_FRAMES_PER_BLOCK
        )
        
        print("Listening...\n")
        
        frame = 0
        while True:
            block = stream.read(INPUT_FRAMES_PER_BLOCK, exception_on_overflow=False)
            detector.process_block(block)
            
            # Display every 10 frames (~100ms)
            if frame % 10 == 0:
                amp = detector.current_amplitude
                bar_len = int(min(amp * 100, 50))
                bar = "█" * bar_len + "░" * (50 - bar_len)
                indicator = "⚡" if amp > INITIAL_TAP_THRESHOLD else "  "
                
                msg = detector.status_message[:50]
                print(f"\r[{bar}] {amp:.4f} {indicator}  {msg:<50}", end="", flush=True)
            
            frame += 1
            
    except KeyboardInterrupt:
        print("\n\nStopped.")
    except Exception as e:
        print(f"\nError: {e}")
    finally:
        try:
            stream.close()
            p.terminate()
        except:
            pass


if __name__ == "__main__":
    print("Hermes Clap Detector Verifier")
    print("Based on: github.com/TzurSoffer/clapDetection")
    print("=" * 70)
    print()
    
    if HAS_GUI:
        if len(sys.argv) > 1 and sys.argv[1] == '-c':
            console_mode()
        else:
            gui_mode()
    else:
        print("GUI not available. Use console mode.")
        console_mode()