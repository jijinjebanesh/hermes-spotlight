"""Restore Hermes tool events for the overlay's quiet stream-json process.

Hermes' stream-json emitter installs ``tool_progress_callback`` after the CLI's
quiet setup. In the affected Hermes release, the executor also gates that
callback on ``quiet_mode`` and ``tool_progress_mode``, so no tool_use event is
ever written. Keep normal quiet behavior for every other Hermes invocation.
"""

import builtins
import os
import sys


def _is_overlay_stream_json() -> bool:
    if os.environ.get("HERMES_OVERLAY") != "1":
        return False
    args = sys.argv
    return any(
        (arg == "--format" and index + 1 < len(args) and args[index + 1] == "stream-json")
        or arg == "--format=stream-json"
        for index, arg in enumerate(args)
    )


if _is_overlay_stream_json():
    try:
        from agent import tool_executor

        _original_progress_enabled = tool_executor._tool_progress_enabled

        def _overlay_progress_enabled(agent):
            # The JSON emitter attaches the callback after quiet setup. Treat that
            # callback as the progress consumer without enabling CLI progress mode.
            return _original_progress_enabled(agent) or bool(
                getattr(agent, "tool_progress_callback", None)
            )

        tool_executor._tool_progress_enabled = _overlay_progress_enabled

        # Tool execution has a few human-readable print calls behind the progress
        # gate. Keep stdout exclusively JSONL; the Electron bridge ignores stderr.
        _original_print = builtins.print

        def _print_to_stderr(*args, **kwargs):
            if kwargs.get("file") is None:
                kwargs["file"] = sys.stderr
            return _original_print(*args, **kwargs)

        builtins.print = _print_to_stderr
    except Exception:
        # Other Hermes releases may not have this internal gate. Their own stream
        # events remain usable, and a compatibility shim failure must not block chat.
        pass
