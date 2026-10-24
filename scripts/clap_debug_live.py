"""Clap Detector with Live Debug Output"""
import pyaudio
import numpy as np
import sys
import time
import json
import os

sys.stderr = open(os.devnull, 'w')

RATE = 16000
CHUNK = 160
THRESHOLD = 0.02
MIN_GAP_MS = 100
MAX_GAP_MS = 600

p = pyaudio.PyAudio()
stream = p.open(format=pyaudio.paInt16, channels=1, rate=RATE,
                input=True, frames_per_buffer=CHUNK)

clap_times = []
in_clap = False
clap_start = None
last_debug = 0

print(json.dumps({"status": "started", "threshold": THRESHOLD}), flush=True)

while True:
    try:
        data = stream.read(CHUNK, exception_on_overflow=False)
        energy = float(np.sqrt(np.mean(np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0**2)))
        now = time.time() * 1000
        
        # Debug output every second
        if now - last_debug > 1000:
            print(json.dumps({"debug": "energy", "value": energy, "threshold": THRESHOLD, "exceeded": energy > THRESHOLD}), flush=True)
            last_debug = now
        
        if energy > THRESHOLD and not in_clap:
            in_clap = True
            clap_start = now
            print(json.dumps({"event": "clap_start", "energy": energy}), flush=True)
        elif energy < 0.01 and in_clap:
            duration = now - clap_start
            if duration < 80:
                clap_times = [t for t in clap_times if now - t < MAX_GAP_MS + 100]
                clap_times.append(now)
                print(json.dumps({"event": "clap_end", "duration": duration, "count": len(clap_times)}), flush=True)
                
                if len(clap_times) >= 2:
                    gap = clap_times[-1] - clap_times[-2]
                    if MIN_GAP_MS <= gap <= MAX_GAP_MS:
                        print(json.dumps({"event": "double_clap", "gap": gap}), flush=True)
                        clap_times = []
                    else:
                        print(json.dumps({"event": "invalid_gap", "gap": gap, "valid_range": f"{MIN_GAP_MS}-{MAX_GAP_MS}"}), flush=True)
            in_clap = False
            
    except KeyboardInterrupt:
        break
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
        break

stream.close()
p.terminate()
print(json.dumps({"status": "stopped"}), flush=True)