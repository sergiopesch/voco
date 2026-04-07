#!/usr/bin/env bash

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
  cat > "${config_file}" << EOF
{
  "hotkey": "${hotkey}",
  "selectedMic": null,
  "insertionStrategy": "auto"
}
EOF
  dim "Config saved to ${config_file}"

  VOCO_SELECTED_HOTKEY="${hotkey}"
  VOCO_CONFIG_FILE="${config_file}"
}
