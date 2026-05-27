#!/usr/bin/env bash
# Bootstrap codex/maestro/claude tools inside devcontainer (best-effort).
set -u

log() {
  printf '[maestro-bootstrap] %s\n' "$*"
}

prepend_path() {
  local candidate="$1"
  if [ -z "$candidate" ]; then
    return 0
  fi
  case ":$PATH:" in
    *":$candidate:"*) ;;
    *) PATH="$candidate:$PATH" ;;
  esac
}

NPM_PREFIX="$(npm config get prefix 2>/dev/null || true)"
TOOL_ROOT="${MAESTRO_TOOL_ROOT:-$PWD/.maestro/tools}"
TOOL_BIN="$TOOL_ROOT/bin"
AUTH_ROOT="${MAESTRO_AUTH_ROOT:-$PWD/.maestro/auth}"
CODEX_AUTH_HOME="${CODEX_HOME:-$AUTH_ROOT/codex}"

prepend_path "$TOOL_BIN"
prepend_path "$TOOL_ROOT/node_modules/.bin"
prepend_path "$HOME/.local/bin"
prepend_path "$NPM_PREFIX/bin"
export PATH

ensure_tool_root() {
  mkdir -p "$TOOL_ROOT"
}

ensure_persistent_dir() {
  local source_path="$1"
  local target_path="$2"

  mkdir -p "$(dirname "$target_path")"
  mkdir -p "$target_path"

  if [ -L "$source_path" ]; then
    local current_link
    current_link="$(readlink "$source_path" 2>/dev/null || true)"
    if [ "$current_link" = "$target_path" ]; then
      return 0
    fi
    rm -f "$source_path" || true
  fi

  if [ -d "$source_path" ] && [ ! -L "$source_path" ]; then
    if [ -z "$(ls -A "$target_path" 2>/dev/null)" ]; then
      cp -a "$source_path"/. "$target_path"/ 2>/dev/null || true
    fi
    rm -rf "$source_path" || true
  elif [ -e "$source_path" ] && [ ! -L "$source_path" ]; then
    rm -f "$source_path" || true
  fi

  mkdir -p "$(dirname "$source_path")"
  ln -sfn "$target_path" "$source_path"
}

ensure_auth_persistence() {
  mkdir -p "$AUTH_ROOT"
  ensure_persistent_dir "$HOME/.codex" "$CODEX_AUTH_HOME"
  ensure_persistent_dir "$HOME/.claude" "$AUTH_ROOT/claude"
  ensure_persistent_dir "$HOME/.config/claude" "$AUTH_ROOT/config/claude"
  export CODEX_HOME="$CODEX_AUTH_HOME"
}

cleanup_broken_package_layout() {
  local package_dir="$1"
  if [ -z "$package_dir" ]; then
    return 0
  fi

  local global_target="$TOOL_ROOT/lib/node_modules/$package_dir"
  local local_target="$TOOL_ROOT/node_modules/$package_dir"

  if [ -e "$global_target" ] && [ ! -d "$global_target" ]; then
    log "cleaning broken package path: $global_target"
    rm -f "$global_target" || true
  fi
  if [ -e "$local_target" ] && [ ! -d "$local_target" ]; then
    log "cleaning broken package path: $local_target"
    rm -f "$local_target" || true
  fi

  rm -rf "$TOOL_ROOT/lib/node_modules/.$package_dir"-* 2>/dev/null || true
  rm -rf "$TOOL_ROOT/node_modules/.$package_dir"-* 2>/dev/null || true
}

tool_help_works() {
  local candidate="$1"
  if [ ! -x "$candidate" ]; then
    return 1
  fi
  "$candidate" --help >/dev/null 2>&1
}

install_npm_tool() {
  local tool_name="$1"
  local package_name="$2"
  local package_dir="${3:-}"

  if tool_help_works "$TOOL_BIN/$tool_name"; then
    log "$tool_name already installed in $TOOL_BIN"
    return 0
  fi
  if command -v "$tool_name" >/dev/null 2>&1 && "$tool_name" --help >/dev/null 2>&1; then
    log "$tool_name already installed"
    return 0
  fi

  cleanup_broken_package_layout "$package_dir"

  log "installing $package_name into $TOOL_ROOT (global-prefix mode)"
  if npm install --prefix "$TOOL_ROOT" --global --no-audit --no-fund "$package_name"; then
    hash -r 2>/dev/null || true
    return 0
  fi

  cleanup_broken_package_layout "$package_dir"
  log "global-prefix install failed; retrying $package_name in local-prefix mode"
  if npm install --prefix "$TOOL_ROOT" --no-audit --no-fund "$package_name"; then
    hash -r 2>/dev/null || true
    return 0
  fi

  log "failed to install $package_name in both global/local prefix modes"
  return 1
}

ensure_local_bin_tool() {
  local tool_name="$1"
  local primary="$TOOL_BIN/$tool_name"
  local secondary="$TOOL_ROOT/node_modules/.bin/$tool_name"
  local command_path=""

  if [ -x "$primary" ]; then
    command_path="$primary"
  elif [ -x "$secondary" ]; then
    command_path="$secondary"
  else
    command_path="$(command -v "$tool_name" 2>/dev/null || true)"
  fi

  mkdir -p "$HOME/.local/bin" "$TOOL_BIN"
  if [ -n "$command_path" ]; then
    if [ "$command_path" != "$HOME/.local/bin/$tool_name" ]; then
      ln -sfn "$command_path" "$HOME/.local/bin/$tool_name"
    fi
    if [ "$command_path" != "$TOOL_BIN/$tool_name" ]; then
      ln -sfn "$command_path" "$TOOL_BIN/$tool_name"
    fi
    return 0
  fi
  if [ -n "$NPM_PREFIX" ] && [ -x "$NPM_PREFIX/bin/$tool_name" ]; then
    ln -sfn "$NPM_PREFIX/bin/$tool_name" "$HOME/.local/bin/$tool_name"
    ln -sfn "$NPM_PREFIX/bin/$tool_name" "$TOOL_BIN/$tool_name"
  fi
}

ensure_tool_alias() {
  local target_name="$1"
  local source_name="$2"
  local source_path=""

  if [ -x "$TOOL_BIN/$source_name" ]; then
    source_path="$TOOL_BIN/$source_name"
  elif [ -x "$TOOL_ROOT/node_modules/.bin/$source_name" ]; then
    source_path="$TOOL_ROOT/node_modules/.bin/$source_name"
  else
    source_path="$(command -v "$source_name" 2>/dev/null || true)"
  fi

  if [ -z "$source_path" ] || [ ! -x "$source_path" ]; then
    return 0
  fi

  mkdir -p "$TOOL_BIN" "$HOME/.local/bin"
  ln -sfn "$source_path" "$TOOL_BIN/$target_name"
  ln -sfn "$source_path" "$HOME/.local/bin/$target_name"
}

ensure_tool_root
ensure_auth_persistence

install_npm_tool codex "@openai/codex"
install_npm_tool maestro "git+https://github.com/FormalOtaku/maestro-vnext.git" "maestro-mcp-server"

ensure_local_bin_tool codex
ensure_local_bin_tool maestro
ensure_local_bin_tool maestro-mcp

if ! command -v claude >/dev/null 2>&1; then
  if command -v curl >/dev/null 2>&1; then
    log "installing claude code (best-effort)"
    if curl -fsSL https://claude.ai/install.sh | bash; then
      hash -r 2>/dev/null || true
    else
      log "claude installer failed (continuing)"
    fi
  else
    log "curl not found; skip claude install"
  fi
fi

if ! command -v claude >/dev/null 2>&1; then
  install_npm_tool claude "@anthropic-ai/claude-code" "claude-code" || true
fi
if ! command -v claude >/dev/null 2>&1; then
  install_npm_tool claude "@anthropic-ai/claude" "claude" || true
fi

ensure_tool_alias claude claude-code
ensure_local_bin_tool claude
ensure_local_bin_tool codex
ensure_local_bin_tool maestro
ensure_local_bin_tool maestro-mcp

if ! command -v maestro >/dev/null 2>&1 && [ -x "$HOME/.local/bin/maestro" ]; then
  log "maestro found only via ~/.local/bin; refreshing PATH"
  prepend_path "$HOME/.local/bin"
  export PATH
fi

if command -v maestro >/dev/null 2>&1; then
  if ! maestro doctor --repo "$PWD" --fix --install-deps; then
    log "maestro doctor failed (continuing)"
  fi
else
  log "maestro command missing; run install manually"
fi
