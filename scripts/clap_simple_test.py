"""Simple Clap Detector Test - No GUI, Minimal Dependencies"""
import sys
import time
import json

def test_basic():
    print("=" * 60)
    print("HERMES CLAP DETECTOR - SIMPLE TEST")
    print("=" * 60)
    
    # Test 1: Can we import pyaudio?
    print("\n[1/4] Testing PyAudio import...")
    try:
        import pyaudio
        print("  ✓ PyAudio imported successfully")
    except ImportError as e:
        print(f"  ✗ PyAudio not installed: {e}")
        print("\n  FIX: Run: pip install pyaudio")
        return False
    
    # Test 2: Can we initialize PyAudio?
    print("\n[2/4] Initializing PyAudio...")
    try:
        p = pyaudio.PyAudio()
        print("  ✓ PyAudio initialized")
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        print("\n  FIX: Reinstall PortAudio or check audio drivers")
        return False
    
    # Test 3: Can we access the microphone?
    print("\n[3/4] Testing microphone access...")
    try:
        default_info = p.get_default_input_device_info()
        print(f"  ✓ Default input: {default_info['name'][:40]}")
        
        stream = p.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=16000,
            input=True,
            frames_per_buffer=160
        )
        print("  ✓ Stream opened")
        
        # Read a few frames to test
        print("  Testing audio capture (3 seconds)...")
        max_energy = 0
        for i in range(300):
            data = stream.read(160, exception_on_overflow=False)
            import numpy as np
            samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            energy = float(np.sqrt(np.mean(samples**2)))
            if energy > max_energy:
                max_energy = energy
            if i % 50 == 0:
                print(f"    Energy: {energy:.6f}")
        
        print(f"  ✓ Max energy captured: {max_energy:.6f}")
        stream.close()
        p.terminate()
        
    except Exception as e:
        print(f"  ✗ Microphone test failed: {e}")
        print("\n  FIX:")
        print("    - Check Windows Microphone Privacy settings")
        print("    - Ensure mic is not muted")
        print("    - Close other apps using the mic")
        return False
    
    # Test 4: Check threshold in clap_detector.py
    print("\n[4/4] Checking clap_detector.py threshold...")
    import os
    script_path = os.path.join(os.path.dirname(__file__), 'clap_detector.py')
    
    if not os.path.exists(script_path):
        print(f"  ✗ Script not found: {script_path}")
        return False
    
    with open(script_path, 'r') as f:
        content = f.read()
    
    import re
    match = re.search(r'THRESHOLD\s*=\s*([\d.]+)', content)
    if match:
        threshold = float(match.group(1))
        print(f"  Current threshold: {threshold}")
        
        if threshold > 0.05:
            print(f"  ⚠ WARNING: Threshold too high!")
            print(f"  Recommended: 0.02 (your ambient is ~{max_energy*2:.4f})")
        else:
            print("  ✓ Threshold looks good")
    else:
        print("  ⚠ Could not find threshold value")
    
    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Max energy detected: {max_energy:.6f}")
    print(f"  Current threshold: {threshold if match else 'unknown'}")
    print(f"  Recommended threshold: {max(max_energy * 5, 0.02):.4f}")
    
    if max_energy < 0.005:
        print("\n✅ Microphone is working (very quiet environment)")
        print("   Set threshold to 0.02 for best results")
    elif max_energy < 0.02:
        print("\n✅ Microphone is working (normal environment)")
        print(f"   Set threshold to {max(max_energy * 5, 0.02):.4f}")
    else:
        print("\n⚠ Environment is noisy")
        print(f"   Set threshold to {max(max_energy * 5, 0.05):.4f}")
    
    print("\nNEXT STEPS:")
    print("  1. Update threshold in src/audio/clap_detector.py if needed")
    print("  2. Ensure 'echoClapWakeEnabled: true' in .hermes/overlay.json")
    print("  3. Restart Electron: npx electron .")
    print("  4. Clap twice to test")
    
    return True

if __name__ == "__main__":
    try:
        success = test_basic()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\nTest interrupted")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)