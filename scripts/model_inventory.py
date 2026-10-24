"""Hermes Overlay — Model/Provider inventory bridge.

Invoked by the Electron main process to get real model lists
from hermes_cli.inventory without needing an interactive TTY.

Usage:
    python model_inventory.py

Outputs a JSON object:
    {
      "providers": [
        {"slug": "nvidia", "name": "NVIDIA NIM", "models": [...], "is_current": true, ...},
        ...
      ],
      "model": "stepfun-ai/step-3.5-flash",
      "provider": "nvidia"
    }
"""
import json
import sys
import os

# Ensure hermes agent is on path
hermes_agent_dir = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.join(os.path.expanduser("~"), "AppData", "Local")),
    "hermes",
    "hermes-agent",
)
if os.path.isdir(hermes_agent_dir) and hermes_agent_dir not in sys.path:
    sys.path.insert(0, hermes_agent_dir)

# Also add site-packages from hermes venv
hermes_venv = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.join(os.path.expanduser("~"), "AppData", "Local")),
    "hermes",
    "venv",
)
# Check common venv locations
for sp in [
    os.path.join(hermes_venv, "Lib", "site-packages"),
    os.path.join(hermes_venv, "lib", "python3.12", "site-packages"),
    os.path.join(hermes_venv, "lib", "python3.11", "site-packages"),
    os.path.join(hermes_venv, "lib", "python3.13", "site-packages"),
]:
    if os.path.isdir(sp) and sp not in sys.path:
        sys.path.insert(0, sp)


def main():
    try:
        from hermes_cli.inventory import build_models_payload, load_picker_context

        ctx = load_picker_context()
        payload = build_models_payload(
            ctx,
            include_unconfigured=True,
            picker_hints=True,
            canonical_order=True,
            max_models=200,
        )

        # Serialize: strip non-JSON-serializable fields
        result = {
            "providers": [],
            "model": payload.get("model", ""),
            "provider": payload.get("provider", ""),
        }

        for row in payload.get("providers", []):
            result["providers"].append({
                "slug": row.get("slug", ""),
                "name": row.get("name", ""),
                "models": row.get("models", []),
                "total_models": row.get("total_models", len(row.get("models", []))),
                "is_current": row.get("is_current", False),
                "authenticated": row.get("authenticated", False),
                "auth_type": row.get("auth_type", ""),
                "key_env": row.get("key_env", ""),
                "warning": row.get("warning", ""),
            })

        print(json.dumps(result))

    except Exception as e:
        # Fallback: return error as JSON
        print(json.dumps({"error": str(e), "providers": [], "model": "", "provider": ""}))


if __name__ == "__main__":
    main()
