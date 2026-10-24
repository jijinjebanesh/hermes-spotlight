"""Hermes Overlay — Set active model/provider.

Invoked by the Electron main process to update the global
Hermes configuration when the user selects a model in the UI.

Usage:
    python set_model.py <provider_slug> <model_string>
"""
import sys
import os
import json

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
for sp in [
    os.path.join(hermes_venv, "Lib", "site-packages"),
    os.path.join(hermes_venv, "lib", "python3.12", "site-packages"),
    os.path.join(hermes_venv, "lib", "python3.11", "site-packages"),
    os.path.join(hermes_venv, "lib", "python3.13", "site-packages"),
]:
    if os.path.isdir(sp) and sp not in sys.path:
        sys.path.insert(0, sp)

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Missing provider or model"}))
        sys.exit(1)

    provider = sys.argv[1]
    model = sys.argv[2]

    try:
        import yaml
        
        # Determine config path
        hermes_home = os.environ.get("HERMES_HOME")
        if not hermes_home:
            hermes_home = os.path.join(os.path.expanduser("~"), ".hermes")
        
        config_path = os.path.join(hermes_home, "config.yaml")
        
        if not os.path.exists(config_path):
            print(json.dumps({"error": f"Config not found at {config_path}"}))
            sys.exit(1)
            
        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f) or {}
            
        config["model"] = model
        
        # Write back config
        with open(config_path, "w", encoding="utf-8") as f:
            yaml.dump(config, f, default_flow_style=False, sort_keys=False)
            
        print(json.dumps({"success": True, "provider": provider, "model": model}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
