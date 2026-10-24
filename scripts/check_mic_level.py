"""Microphone Level Checker - Shows if mic is working properly"""
import pyaudio
import numpy as np
import sys

print("=" * 70)
print("MICROPHONE LEVEL CHECKER")
print("=" * 70)
print("\nThis will show your microphone input level in real-time.")
print("Speak or clap - you should see values ABOVE 0.01 for normal sounds.")
print("Press Ctrl+C to stop.\n")

p = pyaudio.PyAudio()
default_info = p.get_default_input_device_info()
print(f"Using: {default_info['name']}\n")

stream = p.open(format=pyaudio.paInt16, channels=1, rate=16000,
                input=True, frames_per_buffer=160)

try:
    frame = 0
    max_seen = 0
    
    while True:
        data = stream.read(160, exception_on_overflow=False)
        samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
        energy = float(np.sqrt(np.mean(samples**2)))
        
        if energy > max_seen:
            max_seen = energy
        
        frame += 1
        if frame % 10 == 0:  # Update 10 times per second
            # Visual bar
            bar_width = int(min(energy / 0.1, 1.0) * 50)
            bar = "█" * bar_width + "░" * (50 - bar_width)
            
            # Status
            if energy > 0.05:
                status = "LOUD"
            elif energy > 0.01:
                status = "OK"
            elif energy > 0.001:
                status = "QUIET"
            else:
                status = "SILENT?"
            
            print(f"\r[{bar}] {energy:.6f} - {status} (max: {max_seen:.6f})  ", end="", flush=True)
            
except KeyboardInterrupt:
    print("\n\n" + "=" * 70)
    print("RESULTS")
    print("=" * 70)
    print(f"Max energy seen: {max_seen:.6f}")
    
    if max_seen < 0.001:
        print("\n⚠ WARNING: Microphone appears to be SILENT or MUTED!")
        print("\nFIXES:")
        print("  1. Open Windows Sound Settings (right-click speaker icon)")
        print("  2. Go to 'Input' or 'Recording' tab")
        print("  3. Select your microphone")
        print("  4. Click 'Properties' → 'Levels' tab")
        print("  5. Increase microphone volume to 80-100%")
        print("  6. Make sure it's not muted")
        print("  7. Check Windows Privacy → Microphone → Allow apps to access")
    elif max_seen < 0.01:
        print("\n⚠ Microphone is very quiet.")
        print("  Increase input volume in Windows Sound settings.")
    else:
        print(f"\n✓ Microphone is working (max: {max_seen:.4f})")
        print(f"  Recommended threshold: {max(0.02, max_seen * 2):.4f}")
    
    stream.close()
    p.terminate()