"""Hermes Clap Detector - Full Diagnostic & Auto-Repair

This script:
1. Tests microphone access
2. Measures ambient noise levels
3. Auto-calibrates threshold
4. Tests clap detection with real-time feedback
5. Validates the full Hermes integration
"""
import pyaudio
import numpy as np
import json
import sys
import os
import time
import subprocess
from pathlib import Path

def print_header(text):
    print("\n" + "=" * 70)
    print(f"  {text}")
    print("=" * 70)

def print_success(text):
    print(f"  ✓ {text}")

def print_error(text):
    print(f"  ✗ {text}")

def print_warning(text):
    print(f"  ⚠ {text}")

def test_pyaudio():
    """Test if PyAudio is installed and working."""
    print_header("STEP 1: PyAudio Installation Check")
    try:
        import pyaudio
        print_success(f"PyAudio installed (version: {pyaudio.get_portaudio_version()})")
        return True
    except ImportError as e:
        print_error(f"PyAudio not installed: {e}")
        print("\n  Fix: Run this in your hermes-agent venv:")
        print("       pip install pyaudio")
        return False

def test_microphone_access():
    """Test if we can access the microphone."""
    print_header("STEP 2: Microphone Access Test")
    try:
        p = pyaudio.PyAudio()
        print_success("PyAudio initialized")
        
        # List available input devices
        print("\n  Available input devices:")
        default_set = False
        for i in range(p.get_device_count()):
            try:
                info = p.get_device_info_by_index(i)
                if info['maxInputChannels'] > 0:
                    is_default = (i == p.get_default_input_device_info()['index'])
                    marker = "→ " if is_default else "  "
                    print(f"    {marker}[{i}] {info['name'][:50]}")
                    if is_default:
                        default_set = True
            except:
                pass
        
        if not default_set:
            print_warning("No default input device set!")
        
        # Try to open stream
        default_info = p.get_default_input_device_info()
        print(f"\n  Default input: {default_info['name'][:50]}")
        
        stream = p.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=16000,
            input=True,
            frames_per_buffer=160,
            input_device_index=default_info['index']
        )
        print_success("Microphone stream opened successfully")
        
        # Test reading
        data = stream.read(160, exception_on_overflow=False)
        if len(data) == 160 * 2:  # 16-bit = 2 bytes per sample
            print_success("Microphone is reading audio data")
        else:
            print_error("Microphone read returned wrong size")
            return False, None, None
        
        stream.stop_stream()
        stream.close()
        p.terminate()
        return True, default_info, p
    except Exception as e:
        print_error(f"Microphone access failed: {e}")
        print("\n  Possible fixes:")
        print("    1. Allow microphone access in Windows Privacy settings")
        print("    2. Check microphone is not muted in Sound Control Panel")
        print("    3. Ensure no other app is using the microphone exclusively")
        return False, None, None

def measure_ambient_and_calibrate(p, device_info):
    """Measure ambient noise and auto-calibrate threshold."""
    print_header("STEP 3: Ambient Noise Measurement & Calibration")
    
    try:
        stream = p.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=16000,
            input=True,
            frames_per_buffer=160,
            input_device_index=device_info['index']
        )
        
        print("  Listening for 3 seconds (please stay quiet)...")
        energies = []
        
        for i in range(300):  # 3 seconds at 100 frames/sec
            data = stream.read(160, exception_on_overflow=False)
            samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            energy = float(np.sqrt(np.mean(samples**2)))
            energies.append(energy)
            
            if i % 50 == 0:
                print(f"    Sample {i//50 + 1}/3: energy = {energy:.6f}")
        
        stream.close()
        
        avg_energy = np.mean(energies)
        max_energy = np.max(energies)
        std_energy = np.std(energies)
        
        print(f"\n  Results:")
        print(f"    Average energy: {avg_energy:.6f}")
        print(f"    Max energy:     {max_energy:.6f}")
        print(f"    Std deviation:  {std_energy:.6f}")
        
        # Calculate optimal threshold
        # Rule: threshold = max(ambient * 5, 0.01) but cap at 0.1
        optimal_threshold = max(avg_energy * 5, 0.01)
        optimal_threshold = min(optimal_threshold, 0.1)
        
        print(f"\n  → Recommended threshold: {optimal_threshold:.4f}")
        
        return optimal_threshold, avg_energy
    except Exception as e:
        print_error(f"Calibration failed: {e}")
        return 0.02, 0.001  # Safe defaults

def test_clap_detection(p, device_info, threshold, duration=10):
    """Test actual clap detection with visual feedback."""
    print_header(f"STEP 4: Clap Detection Test ({duration}s)")
    print("\n  INSTRUCTIONS:")
    print("    - Clap TWICE sharply within 600ms")
    print("    - Claps should be 150-500ms apart")
    print("    - Watch the energy meter below")
    print("    - Press Ctrl+C to stop early")
    print()
    
    stream = p.open(
        format=pyaudio.paInt16,
        channels=1,
        rate=16000,
        input=True,
        frames_per_buffer=160,
        input_device_index=device_info['index']
    )
    
    clap_times = []
    in_clap = False
    clap_start = None
    MIN_GAP_MS = 100
    MAX_GAP_MS = 600
    
    start_time = time.time()
    frames = 0
    detected_count = 0
    
    try:
        while time.time() - start_time < duration:
            data = stream.read(160, exception_on_overflow=False)
            samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            energy = float(np.sqrt(np.mean(samples**2)))
            now = time.time() * 1000
            frames += 1
            
            # Visual meter (update every 10 frames = 100ms)
            if frames % 10 == 0:
                bar_width = int(min(energy / (threshold * 2), 1.0) * 50)
                bar = "█" * bar_width + "░" * (50 - bar_width)
                status = "⚡" if energy > threshold else "  "
                print(f"\r  [{bar}] {energy:.4f} {status}  ", end="", flush=True)
            
            # Clap detection logic (same as clap_detector.py)
            if energy > threshold and not in_clap:
                in_clap = True
                clap_start = now
            elif energy < 0.01 and in_clap:
                duration_ms = now - clap_start
                if duration_ms < 80:  # Valid clap
                    clap_times = [t for t in clap_times if now - t < MAX_GAP_MS + 100]
                    clap_times.append(now)
                    
                    if len(clap_times) >= 2:
                        gap = clap_times[-1] - clap_times[-2]
                        if MIN_GAP_MS <= gap <= MAX_GAP_MS:
                            detected_count += 1
                            print(f"\n\n  🎉 DOUBLE CLAP DETECTED! (gap: {gap:.0f}ms)")
                            print(f"     Total detections: {detected_count}")
                            clap_times = []
                        else:
                            print(f"\n  👏 Single clap (gap {gap:.0f}ms - too {'fast' if gap < MIN_GAP_MS else 'slow'})")
                    else:
                        print(f"\n  👏 Clap detected")
                
                in_clap = False
        
        print()
        
    except KeyboardInterrupt:
        print("\n\n  Test interrupted by user")
    
    finally:
        stream.close()
    
    print(f"\n  Results: {detected_count} double-claps detected in {frames/100:.1f}s")
    return detected_count > 0

def check_hermes_config():
    """Check if Hermes overlay config has clap wake enabled."""
    print_header("STEP 5: Hermes Configuration Check")
    
    config_path = Path.home() / ".hermes" / "overlay.json"
    
    if not config_path.exists():
        print_warning(f"Config file not found: {config_path}")
        print("  Creating default config...")
        config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(config_path, 'w') as f:
            json.dump({"echoClapWakeEnabled": True}, f, indent=2)
        print_success("Config created with clap wake enabled")
        return True
    
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
        
        clap_enabled = config.get('echoClapWakeEnabled', False)
        
        if clap_enabled:
            print_success("echoClapWakeEnabled: true ✓")
            return True
        else:
            print_warning("echoClapWakeEnabled is false or missing")
            print("  Auto-fixing...")
            config['echoClapWakeEnabled'] = True
            with open(config_path, 'w') as f:
                json.dump(config, f, indent=2)
            print_success("Config updated - clap wake now enabled")
            return True
            
    except Exception as e:
        print_error(f"Failed to read config: {e}")
        return False

def check_clap_detector_file():
    """Check if clap_detector.py exists and has correct threshold."""
    print_header("STEP 6: Clap Detector Script Check")
    
    script_path = Path(__file__).parent / "clap_detector.py"
    
    if not script_path.exists():
        print_error(f"clap_detector.py not found at {script_path}")
        return False
    
    print_success(f"Found: {script_path}")
    
    # Read and check threshold
    with open(script_path, 'r') as f:
        content = f.read()
    
    import re
    threshold_match = re.search(r'THRESHOLD\s*=\s*([\d.]+)', content)
    
    if threshold_match:
        current_threshold = float(threshold_match.group(1))
        print(f"  Current threshold: {current_threshold}")
        
        if current_threshold > 0.05:
            print_warning("Threshold seems too high (> 0.05)")
            print("  Recommended: 0.02 or lower")
        else:
            print_success("Threshold looks reasonable")
    else:
        print_warning("Could not find THRESHOLD value in script")
    
    return True

def check_clap_detector_process():
    """Check if clap detector is running in Electron."""
    print_header("STEP 7: Clap Detector Process Check")
    
    import subprocess
    try:
        # Check for Python processes running clap_detector.py
        result = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq python.exe"],
            capture_output=True, text=True
        )
        
        python_count = result.stdout.count("python.exe")
        print(f"  Python processes running: {python_count}")
        
        if python_count >= 1:
            print_success("Python processes detected (clap detector may be running)")
        else:
            print_warning("No Python processes found")
            print("  The clap detector starts when Electron launches")
        
        return True
    except Exception as e:
        print_error(f"Process check failed: {e}")
        return False

def main():
    print("\n" + "🔍" * 35)
    print("   HERMES CLAP DETECTOR - FULL DIAGNOSTIC & AUTO-REPAIR")
    print("🔍" * 35)
    
    results = {}
    
    # Step 1: PyAudio
    results['pyaudio'] = test_pyaudio()
    if not results['pyaudio']:
        print("\n❌ Cannot proceed without PyAudio. Please install it and re-run.")
        sys.exit(1)
    
    # Step 2: Microphone
    mic_ok, device_info, p = test_microphone_access()
    results['microphone'] = mic_ok
    if not mic_ok:
        print("\n❌ Microphone access failed. Fix the issues above and re-run.")
        sys.exit(1)
    
    # Step 3: Calibration
    threshold, ambient = measure_ambient_and_calibrate(p, device_info)
    results['threshold'] = threshold
    results['ambient'] = ambient
    
    # Step 4: Clap test
    print("\n  Ready to test clap detection...")
    print("  The test will start in 2 seconds...")
    time.sleep(2)
    
    clap_detected = test_clap_detection(p, device_info, threshold, duration=12)
    results['clap_test'] = clap_detected
    
    p.terminate()
    
    # Step 5: Config
    results['config'] = check_hermes_config()
    
    # Step 6: Script check
    results['script'] = check_clap_detector_file()
    
    # Step 7: Process check
    results['process'] = check_clap_detector_process()
    
    # Final summary
    print_header("DIAGNOSTIC SUMMARY")
    
    checks = [
        ("PyAudio installed", results['pyaudio']),
        ("Microphone working", results['microphone']),
        ("Threshold calibrated", threshold <= 0.05),
        ("Claps detected", results['clap_test']),
        ("Config correct", results['config']),
        ("Script exists", results['script']),
    ]
    
    passed = sum(1 for _, ok in checks if ok)
    total = len(checks)
    
    for name, ok in checks:
        status = "✓" if ok else "✗"
        print(f"  {status} {name}")
    
    print(f"\n  Passed: {passed}/{total}")
    
    if results['clap_test']:
        print("\n✅ SUCCESS! Clap detector is working correctly.")
        print("\n  Next steps:")
        print("    1. Restart Electron: taskkill /IM electron.exe /F")
        print("    2. Start Electron: cd hermes-overlay && npx electron .")
        print("    3. Open overlay (F4) and clap twice to test")
    else:
        print("\n❌ Clap detection test failed.")
        print("\n  Troubleshooting:")
        if not results['microphone']:
            print("    → Fix microphone access first (Windows Privacy settings)")
        elif threshold > 0.05:
            print(f"    → Lower threshold to {threshold:.4f} or 0.02")
        else:
            print("    → Clap louder and closer to the microphone")
            print("    → Ensure claps are 150-500ms apart")
            print("    → Check microphone is not muted")

if __name__ == "__main__":
    main()