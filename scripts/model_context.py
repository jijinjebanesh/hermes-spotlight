"""Resolve the active model's effective Hermes context window.

This deliberately delegates to Hermes' own provider-aware resolver instead of
duplicating a model table in the overlay. The result can therefore differ by
provider, endpoint, configured override, or live model metadata.
"""

import json
import os
import sys


def _setup_path():
    local_app_data = os.environ.get(
        "LOCALAPPDATA", os.path.join(os.path.expanduser("~"), "AppData", "Local")
    )
    hermes_agent_dir = os.path.join(local_app_data, "hermes", "hermes-agent")
    if os.path.isdir(hermes_agent_dir) and hermes_agent_dir not in sys.path:
        sys.path.insert(0, hermes_agent_dir)

    hermes_venv = os.path.join(local_app_data, "hermes", "venv")
    for site_packages in (
        os.path.join(hermes_venv, "Lib", "site-packages"),
        os.path.join(hermes_venv, "lib", "python3.12", "site-packages"),
        os.path.join(hermes_venv, "lib", "python3.11", "site-packages"),
        os.path.join(hermes_venv, "lib", "python3.13", "site-packages"),
    ):
        if os.path.isdir(site_packages) and site_packages not in sys.path:
            sys.path.insert(0, site_packages)


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: model_context.py <provider> <model>"}))
        return 1

    provider = sys.argv[1].strip()
    model = sys.argv[2].strip()
    _setup_path()

    try:
        from hermes_cli.config import get_compatible_custom_providers, load_config
        from hermes_cli.runtime_provider import resolve_runtime_provider
        from agent.model_metadata import get_model_context_length

        config = load_config() or {}
        model_config = config.get("model") if isinstance(config.get("model"), dict) else {}
        custom_providers = get_compatible_custom_providers(config)

        runtime = resolve_runtime_provider(requested=provider, target_model=model)
        configured_model = str(model_config.get("default") or "").strip()
        configured_provider = str(model_config.get("provider") or "").strip()
        raw_override = model_config.get("context_length")
        config_context_length = None
        if (
            configured_model.lower() == model.lower()
            and configured_provider.lower() == provider.lower()
            and isinstance(raw_override, int)
            and raw_override > 0
        ):
            config_context_length = raw_override

        context_length = get_model_context_length(
            model,
            base_url=runtime.get("base_url", "") or "",
            api_key=runtime.get("api_key", "") or "",
            config_context_length=config_context_length,
            provider=runtime.get("provider", provider) or provider,
            custom_providers=custom_providers,
        )

        print(json.dumps({
            "provider": provider,
            "model": model,
            "contextLength": int(context_length or 0),
        }))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc), "provider": provider, "model": model}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
