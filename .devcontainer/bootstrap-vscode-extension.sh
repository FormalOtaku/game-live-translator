#!/usr/bin/env bash
# Best-effort installer for Maestro VSCode extension inside devcontainer.
set -u

log() {
  printf '[maestro-vscode-bootstrap] %s\n' "$*"
}

if ! command -v code >/dev/null 2>&1; then
  log "'code' command not found; skip extension bootstrap"
  exit 0
fi

VSIX_PATH="${MAESTRO_VSCODE_EXTENSION_VSIX:-$PWD/.devcontainer/maestro-vscode-extension.vsix}"
EXT_ID="formalotaku.maestro-vscode-extension"

if code --list-extensions 2>/dev/null | tr '[:upper:]' '[:lower:]' | grep -qx "${EXT_ID}"; then
  log "Maestro extension already installed"
  exit 0
fi

if [ -f "$VSIX_PATH" ]; then
  log "installing Maestro extension from VSIX: $VSIX_PATH"
  if code --install-extension "$VSIX_PATH" --force; then
    exit 0
  fi
  log "VSIX install failed; trying extension id"
fi

log "installing Maestro extension by id: $EXT_ID"
if ! code --install-extension "$EXT_ID" --force; then
  log "extension install by id failed (continuing)"
fi
