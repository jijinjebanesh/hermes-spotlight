@echo off
echo ============================================================
echo MICROPHONE BOOST TEST FOR HERMES CLAP DETECTION
echo ============================================================
echo.
echo Your microphone input level is TOO LOW for reliable clap detection.
echo.
echo Current readings show:
echo   - Ambient noise: ~0.002
echo   - Clap energy: ~0.006  (BARELY above threshold of 0.008)
echo.
echo For reliable detection, claps should reach at least 0.02-0.05
echo.
echo FIX OPTIONS:
echo ============================================================
echo.
echo OPTION 1: Increase Microphone Boost in Windows
echo ------------------------------------------------
echo 1. Right-click speaker icon in taskbar
echo 2. Click "Sounds" or "Sound Settings"
echo 3. Go to "Recording" tab
echo 4. Double-click your microphone (Realtek Audio)
echo 5. Go to "Levels" tab
echo 6. Increase "Microphone Boost" to +20dB or +30dB
echo 7. Click OK
echo.
echo OPTION 2: Use Windows Sound Enforcement
echo ------------------------------------------------
python "%~dp0test_clap.py" --live
echo.
echo ============================================================
echo After adjusting microphone settings, restart Hermes Overlay
echo and try clapping twice to wake it up.
echo ============================================================
pause