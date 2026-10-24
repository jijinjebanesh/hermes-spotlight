"""Continuous Clap Detector - Run this and clap to test"""
import pyaudio
import numpy as np
import time

print("=" * 60)
print("CONTINUOUS CLAP DETECTOR")
print("=" * 60)
print("Clap TWICE (within 600ms) to see detection")
print("Press Ctrl+C to stop")
print("")

p = pyaudio.PyAudio()
stream = p.open(format=pyaudio.paInt16, channels=1, rate=16000, 
               input=True, frames_per_buffer=160)

THRESHOLD = 0.02
clap_times = []
in_clap = False
clap_start = None

try:
    while True:
        data = stream.read(160, exception_on_overflow=False)
        samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
        energy = float(np.sqrt(np.mean(samples**2)))
        now = time.time() * 1000
        
        # Visual meter
        bar_len = int(min(energy / 0.05, 1) * 50)
        bar = "█" * bar_len + "░" * (50 - bar_len)
        status = ""
        
        if energy > THRESHOLD and not in_clap:
            in_clap = True
            clap_start = now
            status = " 👏 CLAP!"
        elif energy < 0.01 and in_clap:
            duration = now - clap_start
            if duration < 80:
                clap_times = [t for t in clap_times if now - t < 700]
                clap_times.append(now)
                if len(clap_times) >= 2:
                    gap = clap_times[-1] - clap_times[-2]
                    if 100 <= gap <= 600:
                        status = f" 🎉 DOUBLE CLAP! (gap: {gap:.0f}ms)"
                        clap_times = []
                    else:
                        status = f" ⚠️ Wrong timing ({gap:.0f}ms)"
            in_clap = False
        
        if status or int(now) % 500 == 0:
            print(f"\r[{bar}] {energy:.4f}{status}  ", flush=True)

except KeyboardInterrupt:
    print("\n\nStopped by user")
finally:
    stream.close()
    p.terminate()