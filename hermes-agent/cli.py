#!/usr/bin/env python3
"""
Hermes Agent CLI — Voice Features
==================================
Supports --transcribe and --tts flags for Echo Mode integration.

Usage:
    python cli.py --transcribe <audio_file.wav>
    python cli.py --tts "Text to synthesize"
"""

import argparse
import sys
import os

def transcribe_audio(file_path: str) -> str:
    """Transcribe audio file using Whisper."""
    try:
        import whisper
    except ImportError:
        print("Error: whisper not installed. Run: pip install openai-whisper", file=sys.stderr)
        sys.exit(1)
    
    if not os.path.exists(file_path):
        print(f"Error: File not found: {file_path}", file=sys.stderr)
        sys.exit(1)
    
    try:
        # Load base model for speed (can be configured)
        model = whisper.load_model("base")
        result = model.transcribe(file_path)
        transcript = result.get("text", "").strip()
        return transcript
    except Exception as e:
        print(f"Error transcribing: {e}", file=sys.stderr)
        sys.exit(1)


def synthesize_speech(text: str, voice: str = "en-US-AriaNeural", provider: str = "edge-tts") -> None:
    """Synthesize speech and write binary audio to stdout.buffer.
    
    Uses edge-tts as the default provider (free, no API key required).
    Falls back to a simple beep if edge-tts is not available.
    """
    if provider == "qwen3":
        try:
            import urllib.request
            import json
            api_key = os.getenv("DASHSCOPE_API_KEY", os.getenv("OPENAI_API_KEY"))
            if not api_key:
                print("Error: DASHSCOPE_API_KEY environment variable not set.", file=sys.stderr)
                sys.exit(1)
            
            url = "https://dashscope.aliyuncs.com/compatible-mode/v1/audio/speech"
            
            if not voice or voice == "en-US-AriaNeural":
                voice = "longxiaochun"
                
            data = {
                "model": "cosyvoice-v1",
                "input": text,
                "voice": voice,
                "response_format": "mp3"
            }
            
            req = urllib.request.Request(
                url, 
                data=json.dumps(data).encode('utf-8'),
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                }
            )
            with urllib.request.urlopen(req) as response:
                sys.stdout.buffer.write(response.read())
                sys.stdout.buffer.flush()
            return
        except Exception as e:
            print(f"Error in Qwen3 TTS synthesis: {e}", file=sys.stderr)
            sys.exit(1)

    # Default edge-tts fallback
    try:
        import asyncio
        import edge_tts
        import io
        
        async def generate_audio(text: str, voice_name: str) -> bytes:
            """Generate TTS audio using edge-tts."""
            communicate = edge_tts.Communicate(text, voice_name)
            
            audio_data = io.BytesIO()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_data.write(chunk["data"])
            
            return audio_data.getvalue()
        
        # Run the async generation
        audio_bytes = asyncio.run(generate_audio(text, voice))
        
        # Write binary audio to stdout.buffer
        sys.stdout.buffer.write(audio_bytes)
        sys.stdout.buffer.flush()
        
    except ImportError:
        # Fallback: generate a simple beep using standard library
        # This is for testing when edge-tts is not installed
        try:
            # Generate a minimal WAV file with silence (for testing)
            import wave
            import struct
            
            sample_rate = 24000
            duration = 0.5  # seconds
            frequency = 440  # Hz (A4 note)
            
            num_samples = int(sample_rate * duration)
            
            # Generate sine wave
            samples = []
            for i in range(num_samples):
                value = int(32767.0 * 0.5 * __import__('math').sin(2 * __import__('math').pi * frequency * i / sample_rate))
                samples.append(struct.pack('<h', max(-32768, min(32767, value))))
            
            # Write to stdout.buffer
            wave_file = io.BytesIO()
            with wave.open(wave_file, 'wb') as wav:
                wav.setnchannels(1)  # Mono
                wav.setsampwidth(2)  # 16-bit
                wav.setframerate(sample_rate)
                wav.writeframes(b''.join(samples))
            
            sys.stdout.buffer.write(wave_file.getvalue())
            sys.stdout.buffer.flush()
            
        except Exception as e:
            print(f"Error generating TTS: {e}", file=sys.stderr)
            sys.exit(1)
    
    except Exception as e:
        print(f"Error in TTS synthesis: {e}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Hermes Agent CLI — Voice Features",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    parser.add_argument(
        '--transcribe',
        metavar='FILE',
        help='Transcribe an audio file (WAV, MP3, etc.) and print transcript to stdout'
    )
    
    parser.add_argument(
        '--tts',
        metavar='TEXT',
        help='Synthesize text to speech and write binary audio to stdout.buffer'
    )
    
    parser.add_argument(
        '--voice',
        default='en-US-AriaNeural',
        help='TTS voice to use (default: en-US-AriaNeural)'
    )
    
    parser.add_argument(
        '--provider',
        default='edge-tts',
        help='TTS provider to use (default: edge-tts)'
    )
    
    parser.add_argument(
        '--model',
        default='base',
        help='Whisper model to use for transcription (default: base)'
    )
    
    args = parser.parse_args()
    
    # Handle --transcribe
    if args.transcribe:
        transcript = transcribe_audio(args.transcribe)
        print(transcript)
        sys.exit(0)
    
    # Handle --tts
    if args.tts:
        synthesize_speech(args.tts, args.voice, args.provider)
        sys.exit(0)
    
    # No valid flag provided
    parser.print_help()
    sys.exit(1)


if __name__ == '__main__':
    main()