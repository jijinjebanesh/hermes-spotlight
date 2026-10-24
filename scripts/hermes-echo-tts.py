"""Synthesize one Echo response and write only audio bytes to stdout."""

import json
import os
import sys
import tempfile
import uuid
import asyncio


def stream_edge_tts(payload: dict) -> int:
    """Write Edge Neural MP3 frames as soon as the service returns them."""
    import edge_tts

    text = str(payload.get("text") or "").strip()
    voice = str(payload.get("voice") or "en-US-AriaNeural").strip()
    if not text:
        raise ValueError("Text is required for speech synthesis.")
    rate = str(payload.get("rate") or "+0%")

    async def stream() -> None:
        communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
        async for message in communicate.stream():
            if message.get("type") == "audio" and message.get("data"):
                sys.stdout.buffer.write(message["data"])
                sys.stdout.buffer.flush()

    asyncio.run(stream())
    return 0


def _write_audio_chunks(chunks) -> None:
    for chunk in chunks:
        if chunk:
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()


def stream_hermes_tts(payload: dict) -> int:
    """Stream audio from the active Hermes Edge or ElevenLabs TTS provider."""
    agent_dir = os.getcwd()
    if agent_dir not in sys.path:
        sys.path.insert(0, agent_dir)

    import tools.tts_tool as tts_tool

    text = str(payload.get("text") or "").strip()
    voice = str(payload.get("voice") or "").strip()
    selected_provider = str(payload.get("provider") or "").strip().lower()
    use_hermes_defaults = selected_provider in {"", "hermes"}
    selected_provider = "" if use_hermes_defaults else selected_provider
    if not text:
        raise ValueError("Text is required for speech synthesis.")

    configured_load = tts_tool._load_tts_config

    def echo_tts_config():
        config = dict(configured_load())
        provider = {"edge-tts": "edge"}.get(selected_provider, selected_provider)
        if provider:
            config["provider"] = provider
        if voice and not use_hermes_defaults:
            provider = config.get("provider", "edge")
            provider_key = {"edge": "voice", "openai": "voice", "elevenlabs": "voice_id", "qwen3": "voice"}.get(provider, "voice")
            provider_options = dict(config.get(provider) or {})
            provider_options[provider_key] = voice
            config[provider] = provider_options
        return config

    tts_tool._load_tts_config = echo_tts_config
    config = echo_tts_config()
    resolved_provider = str(config.get("provider") or "edge").lower()
    if resolved_provider == "edge":
        edge_config = config.get("edge") or {}
        return stream_edge_tts({
            "text": text,
            "voice": voice or edge_config.get("voice") or "en-US-AriaNeural",
            "rate": f"{round((float(edge_config.get('speed', config.get('speed', 1.0))) - 1.0) * 100):+d}%",
        })
    if resolved_provider == "elevenlabs":
        import tools.tts_tool_providers as providers

        el_config = config.get("elevenlabs") or {}
        api_key = providers._require_key("ELEVENLABS_API_KEY", "elevenlabs", "Configure ElevenLabs in Hermes TTS settings.")
        client = tts_tool._import_elevenlabs()(
            api_key=api_key,
            **providers._elevenlabs_environment_kwargs(el_config),
        )
        audio = client.text_to_speech.convert(
            text=text,
            voice_id=el_config.get("voice_id", providers.DEFAULT_ELEVENLABS_VOICE_ID),
            model_id=el_config.get("model_id", providers.DEFAULT_ELEVENLABS_MODEL_ID),
            output_format="mp3_44100_128",
        )
        _write_audio_chunks(audio)
        return 0

    # Preserve provider compatibility. Providers without a streaming endpoint
    # still use Hermes' normal synthesis path and return one completed clip.
    output_path = os.path.join(tempfile.gettempdir(), f"hermes_echo_{uuid.uuid4().hex}.mp3")
    response = json.loads(tts_tool.text_to_speech_tool(
        text=text, output_path=output_path, provider=selected_provider or None,
    ))
    if not response.get("success"):
        raise RuntimeError(str(response.get("error") or "Speech synthesis failed."))
    audio_path = response.get("file_path")
    if not audio_path or not os.path.isfile(audio_path):
        raise RuntimeError("Hermes TTS did not produce an audio file.")
    with open(audio_path, "rb") as audio_file:
        _write_audio_chunks(iter(lambda: audio_file.read(16 * 1024), b""))
    return 0


def main() -> int:
    payload = json.loads(sys.stdin.read() or "{}")
    if "--stream" in sys.argv[1:]:
        if str(payload.get("provider") or "") == "edge-tts":
            return stream_edge_tts(payload)
        return stream_hermes_tts(payload)

    agent_dir = os.getcwd()
    if agent_dir not in sys.path:
        sys.path.insert(0, agent_dir)

    text = str(payload.get("text") or "").strip()
    voice = str(payload.get("voice") or "").strip()
    selected_provider = str(payload.get("provider") or "").strip().lower()
    use_hermes_defaults = selected_provider in {"", "hermes"}
    if use_hermes_defaults:
        selected_provider = ""
    if not text:
        raise ValueError("Text is required for speech synthesis.")

    import tools.tts_tool as tts_tool

    # Echo's voice picker is local to this app. Apply its choice to an in-memory
    # copy of Hermes' TTS config for this subprocess only; never rewrite the
    # user's shared Hermes config file.
    configured_load = tts_tool._load_tts_config

    def echo_tts_config():
        config = dict(configured_load())
        provider = {"edge-tts": "edge"}.get(selected_provider, selected_provider)
        if provider:
            config["provider"] = provider
        if voice and not use_hermes_defaults:
            provider = config.get("provider", "edge")
            provider_key = {
                "edge": "voice",
                "openai": "voice",
                "elevenlabs": "voice_id",
                "qwen3": "voice",
            }.get(provider, "voice")
            provider_options = dict(config.get(provider) or {})
            provider_options[provider_key] = voice
            config[provider] = provider_options
        return config

    tts_tool._load_tts_config = echo_tts_config
    output_path = os.path.join(tempfile.gettempdir(), f"hermes_echo_{uuid.uuid4().hex}.mp3")
    try:
        try:
            response = json.loads(
                tts_tool.text_to_speech_tool(text=text, output_path=output_path, provider=selected_provider or None)
            )
        except (TypeError, ValueError) as error:
            raise RuntimeError("Hermes returned an invalid TTS result.") from error

        if not response.get("success"):
            raise RuntimeError(str(response.get("error") or "Speech synthesis failed."))

        audio_path = response.get("file_path")
        if not audio_path or not os.path.isfile(audio_path) or os.path.getsize(audio_path) == 0:
            raise RuntimeError("Hermes TTS did not produce an audio file.")

        with open(audio_path, "rb") as audio_file:
            sys.stdout.buffer.write(audio_file.read())
            sys.stdout.buffer.flush()
        return 0
    finally:
        generated_paths = set(response.get("file_paths", []) if "response" in locals() else [])
        if "response" in locals() and response.get("file_path"):
            generated_paths.add(response["file_path"])
        for audio_path in generated_paths:
            try:
                if os.path.abspath(audio_path) != os.path.abspath(output_path):
                    os.remove(audio_path)
            except OSError:
                pass
        try:
            os.remove(output_path)
        except OSError:
            pass


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        raise SystemExit(1)
