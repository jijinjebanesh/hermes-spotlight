"""
Microphone Diagnostic - Check why input is so loud
"""
import pyaudio
import numpy as np
import time

print("=" * 70)
print("MICROPHONE DIAGNOSTIC")
print("=" * 70)
print("")

p = pyaudio.PyAudio()

# List all input devices
print("Available input devices:")
print("-" * 70)
for i in range(p.get_device_count()):
    try:
        info = p.get_device_info_by_index(i)
        if info['maxInputChannels'] > 0:
            is_default = " (DEFAULT)" if info['index'] == p.get_default_input_device_info()['index'] else ""
            print(f"  [{i}] {info['name']}{is_default}")
            print(f"      Channels: {info['maxInputChannels']}, Sample Rate: {info['defaultSampleRate']:.0f}Hz")
    except:
        pass

print("")
print("=" * 70)
print("TESTING DEFAULT MICROPHONE")
print("=" * 70)

default_info = p.get_default_input_device_info()
print(f"Device: {default_info['name']}")
print("")

# Test at different sample rates
for rate in [16000, 44100, 48000]:
    print(f"Testing at {rate}Hz...")
    try:
        stream = p.open(format=pyaudio.paInt16, channels=1, rate=rate,
                       input=True, frames_per_buffer=160)
        
        energies = []
        for _ in range(50):  # 0.5 seconds
            data = stream.read(160, exception_on_overflow=False)
            samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            energies.append(float(np.sqrt(np.mean(samples**2))))
        
        stream.close()
        
        avg = np.mean(energies)
        max_e = np.max(energies)
        min_e = np.min(energies)
        
        status = "❌ TOO LOUD" if avg > 0.1 else "⚠️ ELEVATED" if avg > 0.05 else "✓ OK"
        print(f"  {status}: avg={avg:.4f}, min={min_e:.4f}, max={max_e:.4f}")
        
    except Exception as e:
        print(f"  ❌ FAILED: {e}")

print("")
print("=" * 70)
print("RECOMMENDATIONS")
print("=" * 70)
print("")
print("If avg > 0.1 continuously:")
print("  1. Open Windows Sound Settings (right-click speaker icon)")
print("  2. Go to 'Recording' tab")
print("  3. Right-click your microphone → Properties")
print("  4. Go to 'Levels' tab")
print("  5. REDUCE microphone volume (try 50-70%)")
print("  6. DISABLE 'Microphone Boost' if enabled")
print("")
print("If you're not using the correct mic:")
print("  1. In same Recording tab, right-click correct device")
print("  2. Select 'Set as Default Device'")
print("")
print("Expected values when QUIET:")
print("  - Silent room: 0.001 - 0.01")
print("  - Normal talking nearby: 0.05 - 0.2")
print("  - Clapping: 0.3 - 0.8 (brief spike)")
print("  - WHAT YOU'RE SEEING NOW (0.32+): Something is VERY wrong")
print("")

p.terminate()