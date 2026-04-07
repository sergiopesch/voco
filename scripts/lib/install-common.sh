#!/usr/bin/env bash

voco_escape_json_string() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "${value}"
}

voco_write_default_config() {
  local config_file="$1"
  local hotkey="$2"
  local escaped_hotkey

  escaped_hotkey="$(voco_escape_json_string "${hotkey}")"

  cat > "${config_file}" << EOF
{
  "hotkey": "${escaped_hotkey}",
  "selectedMic": null,
  "insertionStrategy": "auto"
}
EOF
}

voco_merge_hotkey_into_existing_config() {
  local config_file="$1"
  local hotkey="$2"

  if command -v python3 >/dev/null 2>&1; then
    if python3 - "${config_file}" "${hotkey}" <<'PY'
import json
import pathlib
import sys

config_path = pathlib.Path(sys.argv[1])
hotkey = sys.argv[2]

data = json.loads(config_path.read_text(encoding="utf-8"))
if not isinstance(data, dict):
    raise SystemExit(1)

data["hotkey"] = hotkey
config_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY
    then
      return 0
    fi
  fi

  if grep -Eq '"hotkey"[[:space:]]*:' "${config_file}"; then
    local escaped_hotkey
    local sed_hotkey
    local tmp_file

    escaped_hotkey="$(voco_escape_json_string "${hotkey}")"
    sed_hotkey="$(printf '%s' "${escaped_hotkey}" | sed 's/[&|]/\\&/g')"
    tmp_file="$(mktemp)"

    if sed -E \
      "0,/\"hotkey\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"/s|\"hotkey\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"|\"hotkey\": \"${sed_hotkey}\"|" \
      "${config_file}" > "${tmp_file}"; then
      mv "${tmp_file}" "${config_file}"
      return 0
    fi

    rm -f "${tmp_file}"
  fi

  return 1
}

voco_run_hotkey_setup() {
  local hotkey="${1:-Alt+D}"
  local config_dir="${HOME}/.config/voco"
  local config_file="${config_dir}/config.json"

  echo
  echo -e "  ${BOLD}${GRAPHITE}Quick Setup${NC}"
  echo
  echo -e "  VOCO uses a global hotkey to start and stop listening."
  echo -e "  The default is ${BOLD}${hotkey}${NC} — press it anywhere to dictate."
  echo

  if [[ -t 0 ]]; then
    printf "  ${WHITE}${BOLD}▸${NC} Happy with ${BOLD}%s${NC}? [Y/n] " "${hotkey}"
    read -r ANSWER </dev/tty 2>/dev/null || ANSWER="y"
    ANSWER="${ANSWER:-y}"

    if [[ "$ANSWER" =~ ^[Nn] ]]; then
      echo
      echo -e "  ${DIM}Examples: Ctrl+Shift+V, Super+D, Alt+Shift+R${NC}"
      printf "  ${WHITE}${BOLD}▸${NC} Enter your preferred hotkey: "
      read -r CUSTOM_HOTKEY </dev/tty 2>/dev/null || CUSTOM_HOTKEY=""
      if [[ -n "$CUSTOM_HOTKEY" ]]; then
        hotkey="$CUSTOM_HOTKEY"
        ok "Hotkey set to ${BOLD}${hotkey}${NC}"
      else
        ok "Keeping default ${BOLD}Alt+D${NC}"
      fi
    else
      ok "Hotkey: ${BOLD}${hotkey}${NC}"
    fi
  else
    ok "Hotkey: ${BOLD}${hotkey}${NC} (default)"
  fi

  mkdir -p "${config_dir}"
  if [[ -f "${config_file}" ]]; then
    if voco_merge_hotkey_into_existing_config "${config_file}" "${hotkey}"; then
      dim "Updated hotkey in existing config at ${config_file}"
    else
      warn "Existing config preserved without overwriting other settings."
      dim "Update the hotkey later from the tray or by editing ${config_file}"
    fi
  else
    voco_write_default_config "${config_file}" "${hotkey}"
    dim "Config saved to ${config_file}"
  fi

  VOCO_SELECTED_HOTKEY="${hotkey}"
  VOCO_CONFIG_FILE="${config_file}"
}
