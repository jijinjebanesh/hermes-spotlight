# Hermes Agent CLI

Voice features for Hermes Overlay Echo Mode.

## Installation

```bash
# Recommended: create a virtual environment first
python -m venv .venv
.venv\Scripts\activate  # Windows
# or: source .venv/bin/activate  # Linux/Mac

# Install dependencies
pip install -r requirements.txt
```

**Note:** If you encounter Python environment issues (SRE module mismatch), try:
1. Delete the `.venv` folder and recreate it
2. Or use: `uv venv && uv pip install -r requirements.txt`

## Usage

### Transcribe Audio
```bash
python cli.py --transcribe path/to/audio.wav
```
Outputs transcript to stdout.

### Synthesize Speech
```bash
python cli.py --tts "Hello, this is Hermes speaking."
```
Outputs binary audio (MP3) to stdout.buffer.

### With Custom Voice (edge-tts)
```bash
python cli.py --tts "Hello" --voice en-US-AriaNeural
```

Available voices: Run `edge-tts --list-voices` to see all options.

### With Custom Whisper Model
```bash
python cli.py --transcribe audio.wav --model large
```
Models: tiny, base, small, medium, large (larger = more accurate but slower)

## Integration

The CLI is designed to be called from the Electron main process:

```typescript
// Transcribe
const transcript = spawn('python', ['cli.py', '--transcribe', tmpFile])
  .stdout.toString();

// TTS
const audioBuffer = spawn('python', ['cli.py', '--tts', text])
  .stdout;  // Binary data
```

## Dependencies

- **openai-whisper**: Automatic speech recognition
- **edge-tts**: Microsoft Edge TTS (free, no API key)
- **pyaudio**: Audio I/O (for clap detector)

## Fallback Behavior

If edge-tts is not installed, the CLI generates a simple 440Hz sine wave tone as a fallback for testing.