"""Test and repair clap detection with real-time feedback."""
import pyaudio
import numpy as np
import json
import sys
import time
import os
import subprocess
import threading

RATE = 16000
CHUNK = 160
DEFAULT_THRESHOLD = 0.05

def rms(data):
    samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
    return float(np.sqrt(np.mean(samples**2)))

def test_microphone():
    """Test if microphone is working and measure ambient noise vs clap levels."""
    print("=" * 60)
    print("CLAP DETECTOR DIAGNOSTIC TEST")
    print("=" * 60)
    
    try:
        p = pyaudio.PyAudio()
        print(f"✓ PyAudio initialized")
        print(f"  Device count: {p.get_device_count()}")
        
        # Get default input device
        try:
            info = p.get_default_input_device_info()
            print(f"✓ Default input: {info['name']}")
            print(f"  Max input channels: {info['maxInputChannels']}")
        except Exception as e:
            print(f"✗ No default input device: {e}")
            return False
        
        stream = p.open(format=pyaudio.paInt16, channels=1, rate=RATE, 
                       input=True, frames_per_buffer=CHUNK)
        print(f"✓ Microphone stream opened at {RATE}Hz")
        
    except Exception as e:
        print(f"✗ Failed to initialize audio: {e}")
        return False
    
    # Measure ambient noise for 2 seconds
    print("\n📊 Measuring ambient noise (3 seconds)...")
    ambient_readings = []
    for i in range(30):  # 30 * 100ms = 3 seconds
        try:
            data = stream.read(CHUNK, exception_on_overflow=False)
            energy = rms(data)
            ambient_readings.append(energy)
            if i % 10 == 0:
                print(f"  Ambient: {energy:.6f}")
        except Exception as e:
            print(f"✗ Read error: {e}")
            stream.close()
            p.terminate()
            return False
    
    ambient_avg = sum(ambient_readings) / len(ambient_readings)
    ambient_max = max(ambient_readings)
    print(f"\n📈 Ambient noise stats:")
    print(f"  Average: {ambient_avg:.6f}")
    print(f"  Max: {ambient_max:.6f}")
    
    # Now ask user to clap
    print("\n👏 Please clap 3-5 times in the next 5 seconds...")
    clap_readings = []
    start_time = time.time()
    max_clap_energy = 0
    
    while time.time() - start_time < 5:
        try:
            data = stream.read(CHUNK, exception_on_overflow=False)
            energy = rms(data)
            clap_readings.append(energy)
            if energy > max_clap_energy:
                max_clap_energy = energy
            if energy > ambient_max * 2:
                print(f"  🔴 Detected spike: {energy:.6f}")
        except:
            pass
    
    print(f"\n📈 Clap detection stats:")
    print(f"  Max energy detected: {max_clap_energy:.6f}")
    
    stream.close()
    p.terminate()
    
    # Calculate recommended threshold
    if max_clap_energy > ambient_avg * 2:
        recommended_threshold = (ambient_max + max_clap_energy) / 2
        print(f"\n✅ RECOMMENDATIONS:")
        print(f"  Current threshold in clap_detector.py: {DEFAULT_THRESHOLD}")
        print(f"  Recommended threshold: {recommended_threshold:.4f}")
        print(f"  (Midpoint between ambient max {ambient_max:.4f} and clap max {max_clap_energy:.4f})")
        
        if max_clap_energy < 0.03:
            print(f"\n⚠️  WARNING: Clap energy is very low ({max_clap_energy:.4f})")
            print(f"  - Make sure microphone is not muted")
            print(f"  - Check Windows Sound settings -> Recording -> Properties -> Levels")
            print(f"  - Try clapping louder or closer to the mic")
            return False
        else:
            print(f"\n✅ Microphone is working correctly!")
            return True
    else:
        print(f"\n❌ No claps detected above ambient noise")
        print(f"  Ambient max: {ambient_max:.6f}")
        print(f"  Max during test: {max_clap_energy:.6f}")
        print(f"\n⚠️  POSSIBLE ISSUES:")
        print(f"  1. Microphone might be muted or too low volume")
        print(f"  2. Wrong microphone selected (check Windows Sound settings)")
        print(f"  3. Clapping too softly")
        return False

def check_clap_detector_file():
    """Check if clap_detector.py exists and has correct threshold."""
    # Try multiple possible locations
    possible_paths = [
        os.path.join(os.path.dirname(__file__), 'clap_detector.py'),
        os.path.join(os.path.dirname(__file__), '..', 'src', 'audio', 'clap_detector.py'),
        r'C:\Users\jijin\hermes-overlay\src\audio\clap_detector.py',
    ]
    
    script_path = None
    for p in possible_paths:
        if os.path.exists(p):
            script_path = p
            break
    
    print(f"\n📄 Checking clap_detector.py...")
    if script_path:
        print(f"  Path: {script_path}")
    else:
        print(f"  ✗ File not found in any expected location!")
        return False
    
    with open(script_path, 'r') as f:
        content = f.read()
    
    if 'THRESHOLD = 0.05' in content:
        print(f"  ✓ Threshold is set to 0.05 (correct)")
        return True
    elif 'THRESHOLD = 0.35' in content:
        print(f"  ✗ Threshold is still 0.35 (WRONG - needs to be 0.05)")
        return False
    else:
        # Try to find any threshold value
        import re
        match = re.search(r'THRESHOLD\s*=\s*([0-9.]+)', content)
        if match:
            val = float(match.group(1))
            print(f"  ⚠ Threshold is {val} (recommended: 0.05)")
            return val < 0.1
        print(f"  ⚠ Could not find THRESHOLD value")
        return True

def check_config():
    """Check if echoClapWakeEnabled is set in overlay config."""
    config_path = os.path.join(os.path.expanduser('~'), '.hermes', 'overlay.json')
    print(f"\n📄 Checking overlay config...")
    print(f"  Path: {config_path}")
    
    if not os.path.exists(config_path):
        print(f"  ✗ Config not found!")
        return False
    
    with open(config_path, 'r') as f:
        config = json.load(f)
    
    if config.get('echoClapWakeEnabled') == True:
        print(f"  ✓ echoClapWakeEnabled is TRUE")
        return True
    else:
        print(f"  ✗ echoClapWakeEnabled is {config.get('echoClapWakeEnabled')} (should be true)")
        print(f"  💡 Run: python repair_clap.py --enable-clap")
        return False

def check_process_running():
    """Check if clap_detector.py is currently running."""
    print(f"\n🔍 Checking for running clap detector process...")
    try:
        result = subprocess.run(['tasklist'], capture_output=True, text=True)
        if 'clap_detector' in result.stdout.lower():
            print(f"  ✓ Clap detector is running")
            return True
        else:
            print(f"  ✗ Clap detector is NOT running")
            print(f"  💡 It should start automatically when Hermes Overlay launches")
            return False
    except:
        print(f"  ⚠ Could not check processes")
        return False

def repair_threshold():
    """Repair the threshold value in clap_detector.py."""
    script_path = os.path.join(os.path.dirname(__file__), 'clap_detector.py')
    print(f"\n🔧 Repairing threshold in clap_detector.py...")
    
    if not os.path.exists(script_path):
        print(f"  ✗ File not found: {script_path}")
        return False
    
    with open(script_path, 'r') as f:
        content = f.read()
    
    import re
    if 'THRESHOLD = 0.35' in content:
        new_content = content.replace('THRESHOLD = 0.35', 'THRESHOLD = 0.05')
        with open(script_path, 'w') as f:
            f.write(new_content)
        print(f"  ✅ Fixed threshold: 0.35 → 0.05")
        return True
    else:
        print(f"  ℹ️  Threshold already changed or different value")
        return True

def enable_clap_in_config():
    """Enable echoClapWakeEnabled in overlay config."""
    config_path = os.path.join(os.path.expanduser('~'), '.hermes', 'overlay.json')
    print(f"\n🔧 Enabling clap wake in config...")
    
    if not os.path.exists(config_path):
        print(f"  ✗ Config not found: {config_path}")
        return False
    
    with open(config_path, 'r') as f:
        config = json.load(f)
    
    config['echoClapWakeEnabled'] = True
    
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)
    
    print(f"  ✅ Enabled echoClapWakeEnabled in overlay.json")
    print(f"  💡 Restart Hermes Overlay for changes to take effect")
    return True

def live_test():
    """Live test of clap detection with current settings."""
    print("\n" + "=" * 60)
    print("LIVE CLAP DETECTION TEST")
    print("=" * 60)
    print("Listening for claps... (press Ctrl+C to stop)")
    print("Clap twice within 600ms to trigger detection\n")
    
    try:
        p = pyaudio.PyAudio()
        stream = p.open(format=pyaudio.paInt16, channels=1, rate=RATE,
                       input=True, frames_per_buffer=CHUNK)
    except Exception as e:
        print(f"✗ Failed to open stream: {e}")
        return
    
    clap_times = []
    in_clap = False
    clap_start = None
    THRESHOLD = DEFAULT_THRESHOLD
    
    try:
        while True:
            data = stream.read(CHUNK, exception_on_overflow=False)
            energy = rms(data)
            now = time.time() * 1000  # ms
            
            if energy > THRESHOLD and not in_clap:
                in_clap = True
                clap_start = now
                print(f"🔴 Sound detected: {energy:.4f}")
            elif energy < 0.01 and in_clap:
                duration = now - clap_start
                if duration < 80:  # Valid clap (< 80ms)
                    clap_times = [t for t in clap_times if now - t < 600 + 100]
                    clap_times.append(now)
                    print(f"✓ Clap registered! ({duration:.0f}ms)")
                    
                    if len(clap_times) >= 2:
                        gap = clap_times[-1] - clap_times[-2]
                        print(f"  Gap between claps: {gap:.0f}ms")
                        if 100 <= gap <= 600:
                            print(f"\n🎉 DOUBLE CLAP DETECTED! ({gap:.0f}ms gap)\n")
                            clap_times = []
                        else:
                            print(f"  ⚠ Gap too {'short' if gap < 100 else 'long'} (need 100-600ms)\n")
                in_clap = False
    except KeyboardInterrupt:
        print("\n\nTest stopped by user")
    finally:
        stream.close()
        p.terminate()

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == '--repair':
            repair_threshold()
            enable_clap_in_config()
        elif sys.argv[1] == '--enable-clap':
            enable_clap_in_config()
        elif sys.argv[1] == '--live':
            live_test()
        else:
            print("Usage: python repair_clap.py [--repair|--enable-clap|--live]")
    else:
        # Full diagnostic
        print("\n🔍 Running full diagnostic...\n")
        
        mic_ok = test_microphone()
        file_ok = check_clap_detector_file()
        config_ok = check_config()
        process_ok = check_process_running()
        
        print("\n" + "=" * 60)
        print("DIAGNOSTIC SUMMARY")
        print("=" * 60)
        print(f"Microphone:        {'✅ WORKING' if mic_ok else '❌ ISSUES'}")
        print(f"Clap detector file: {'✅ OK' if file_ok else '❌ NEEDS FIX'}")
        print(f"Config enabled:     {'✅ YES' if config_ok else '❌ NO'}")
        print(f"Process running:    {'✅ YES' if process_ok else '❌ NO'}")
        
        if not file_ok or not config_ok:
            print("\n💡 To automatically fix issues, run:")
            print("   python repair_clap.py --repair")
            print("\nThen restart Hermes Overlay and test with:")
            print("   python repair_clap.py --live")
        
        if mic_ok and file_ok and config_ok:
            print("\n✅ All checks passed! Try clapping twice to wake Hermes.")
            print("   If still not working, run: python repair_clap.py --live")