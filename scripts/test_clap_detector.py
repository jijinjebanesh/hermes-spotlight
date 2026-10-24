"""Clap Detector Diagnostic Script

Tests microphone input and clap detection with real-time feedback.
Run this to verify the clap detector is working before using it with Hermes.
"""
import pyaudio
import numpy as np
import json
import sys
import time

def test_microphone():
    """Test if microphone is accessible and getting input."""
    print("=" * 60)
    print("STEP 1: Testing Microphone Access")
    print("=" * 60)
    
    try:
        p = pyaudio.PyAudio()
        print(f"✓ PyAudio initialized (version: {pyaudio.get_portaudio_version()})")
        
        # Get default input device
        default_info = p.get_default_input_device_info()
        print(f"✓ Default input device: {default_info['name']}")
        print(f"  - Max input channels: {default_info['maxInputChannels']}")
        print(f"  - Default sample rate: {default_info['defaultSampleRate']}")
        
        # Try to open stream
        stream = p.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=16000,
            input=True,
            frames_per_buffer=160
        )
        print(f"✓ Stream opened successfully (16kHz, mono, 10ms frames)")
        
        return p, stream
    except Exception as e:
        print(f"✗ FAILED: {e}")
        print("\nTroubleshooting:")
        print("  1. Check if microphone is connected and not muted")
        print("  2. Select correct input device in Windows Sound settings")
        print("  3. Ensure no other app is独占 using the microphone")
        sys.exit(1)

def measure_ambient_noise(stream, duration_sec=3):
    """Measure ambient noise level to calibrate threshold."""
    print("\n" + "=" * 60)
    print("STEP 2: Measuring Ambient Noise")
    print("=" * 60)
    print(f"Listening for {duration_sec} seconds... please stay quiet")
    
    energies = []
    frames = int(16000 / 160) * duration_sec  # 100 frames per second
    
    for i in range(frames):
        try:
            data = stream.read(160, exception_on_overflow=False)
            samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            energy = float(np.sqrt(np.mean(samples**2)))
            energies.append(energy)
            
            if i % 50 == 0:
                print(f"  Reading {i//50 + 1}/{duration_sec}s: energy={energy:.6f}")
        except Exception as e:
            print(f"✗ Read error: {e}")
            return None
    
    avg_energy = np.mean(energies)
    max_energy = np.max(energies)
    min_energy = np.min(energies)
    
    print(f"\n✓ Ambient noise measured:")
    print(f"  - Average: {avg_energy:.6f}")
    print(f"  - Min: {min_energy:.6f}")
    print(f"  - Max: {max_energy:.6f}")
    
    # Recommended threshold: 3x ambient noise, but at least 0.02
    recommended_threshold = max(0.02, avg_energy * 3)
    print(f"\n→ Recommended threshold: {recommended_threshold:.4f}")
    print(f"  (current setting: 0.05)")
    
    if recommended_threshold > 0.1:
        print(f"  ⚠ WARNING: Ambient noise is high! Try a quieter environment.")
    
    return avg_energy, recommended_threshold

def test_clap_detection(stream, threshold, duration_sec=10):
    """Test actual clap detection."""
    print("\n" + "=" * 60)
    print("STEP 3: Testing Clap Detection")
    print("=" * 60)
    print(f"Threshold: {threshold}")
    print(f"Listening for {duration_sec} seconds...")
    print("→ Clap TWICE (within 600ms) to test detection")
    print("")
    
    clap_times = []
    in_clap = False
    clap_start = None
    
    MIN_GAP_MS = 100
    MAX_GAP_MS = 600
    
    start_time = time.time()
    frames_processed = 0
    claps_detected = 0
    
    while time.time() - start_time < duration_sec:
        try:
            data = stream.read(160, exception_on_overflow=False)
            samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            energy = float(np.sqrt(np.mean(samples**2)))
            now = time.time() * 1000  # ms
            
            frames_processed += 1
            
            # Visual indicator (every 20 frames = 200ms)
            if frames_processed % 20 == 0:
                bar_len = int(min(energy / 0.5, 1) * 40)
                bar = "█" * bar_len + "░" * (40 - bar_len)
                status = "⚡ CLAP!" if energy > threshold else "  "
                print(f"\r[{bar}] {energy:.4f} {status}  ", end="", flush=True)
            
            if energy > threshold and not in_clap:
                in_clap = True
                clap_start = now
            elif energy < 0.01 and in_clap:
                duration = now - clap_start
                if duration < 80:  # Valid clap duration
                    clap_times = [t for t in clap_times if now - t < MAX_GAP_MS + 100]
                    clap_times.append(now)
                    
                    if len(clap_times) >= 2:
                        gap = clap_times[-1] - clap_times[-2]
                        if MIN_GAP_MS <= gap <= MAX_GAP_MS:
                            claps_detected += 1
                            print(f"\n\n🎉 DOUBLE CLAP DETECTED! (gap: {gap:.0f}ms)")
                            print(f"   Total double-claps: {claps_detected}")
                            clap_times = []
                    else:
                        print(f"\n👏 Single clap detected")
                
                in_clap = False
                
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"\n✗ Error: {e}")
            break
    
    print(f"\n\n{'=' * 60}")
    print("RESULTS")
    print("=" * 60)
    print(f"Frames processed: {frames_processed}")
    print(f"Double claps detected: {claps_detected}")
    
    if claps_detected > 0:
        print("\n✅ SUCCESS! Clap detector is working correctly.")
        print("\nNext steps:")
        print("  1. The Hermes overlay should now respond to double claps")
        print("  2. Make sure 'echoClapWakeEnabled: true' is in overlay.json")
        print("  3. Restart Electron to load the updated clap detector")
    else:
        print("\n❌ NO DOUBLE CLAPS DETECTED")
        print("\nPossible issues:")
        print("  1. Threshold too high - lower it in clap_detector.py")
        print("  2. Claps not loud enough - clap harder or closer to mic")
        print("  3. Gap between claps wrong - try 200-400ms between claps")
        print("  4. Microphone not picking up sound - check input device")

def main():
    print("\n🔍 HERMES CLAP DETECTOR DIAGNOSTIC")
    print("=" * 60)
    
    # Step 1: Test microphone
    p, stream = test_microphone()
    
    try:
        # Step 2: Measure ambient noise
        ambient_result = measure_ambient_noise(stream, duration_sec=2)
        
        if ambient_result:
            avg_energy, recommended = ambient_result
            # Use the recommended threshold for testing
            test_threshold = max(0.02, avg_energy * 3)
            if test_threshold > 0.1:
                print(f"\n⚠ Using higher threshold due to noisy environment")
                test_threshold = 0.1
        else:
            test_threshold = 0.05
        
        # Step 3: Test clap detection
        test_clap_detection(stream, test_threshold, duration_sec=8)
        
    finally:
        # Cleanup
        stream.stop_stream()
        stream.close()
        p.terminate()
        print("\n✓ Cleanup complete")

if __name__ == "__main__":
    main()