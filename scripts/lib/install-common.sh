#!/usr/bin/env bash

voco_escape_json_string() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "${value}"
}

voco_trim() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
}

voco_canonical_hotkey_key() {
  local token="${1:-}"
  local upper
  local LC_ALL=C

  case "${token}" in
    '`') upper="BACKQUOTE" ;;
    "\\") upper="BACKSLASH" ;;
    '[') upper="BRACKETLEFT" ;;
    ']') upper="BRACKETRIGHT" ;;
    ',') upper="COMMA" ;;
    '=') upper="EQUAL" ;;
    '-') upper="MINUS" ;;
    '.') upper="PERIOD" ;;
    "'") upper="QUOTE" ;;
    ';') upper="SEMICOLON" ;;
    '/') upper="SLASH" ;;
    *) upper="${token^^}" ;;
  esac

  if [[ "${upper}" =~ ^KEY([A-Z])$ ]]; then
    printf 'KEY%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "${upper}" =~ ^[A-Z]$ ]]; then
    printf 'KEY%s' "${upper}"
    return 0
  fi
  if [[ "${upper}" =~ ^DIGIT([0-9])$ ]]; then
    printf 'DIGIT%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "${upper}" =~ ^[0-9]$ ]]; then
    printf 'DIGIT%s' "${upper}"
    return 0
  fi
  if [[ "${upper}" =~ ^F([1-9]|1[0-9]|2[0-4])$ ]]; then
    printf '%s' "${upper}"
    return 0
  fi

  case "${upper}" in
    BACKQUOTE|BACKSLASH|BRACKETLEFT|BRACKETRIGHT|COMMA|EQUAL|MINUS|PERIOD|QUOTE|SEMICOLON|SLASH)
      printf '%s' "${upper}"
      ;;
    PAUSE|PAUSEBREAK)
      printf 'PAUSE'
      ;;
    BACKSPACE|CAPSLOCK|ENTER|SPACE|TAB|DELETE|END|HOME|INSERT|PAGEDOWN|PAGEUP|PRINTSCREEN|SCROLLLOCK|NUMLOCK)
      printf '%s' "${upper}"
      ;;
    ARROWDOWN|DOWN)
      printf 'ARROWDOWN'
      ;;
    ARROWLEFT|LEFT)
      printf 'ARROWLEFT'
      ;;
    ARROWRIGHT|RIGHT)
      printf 'ARROWRIGHT'
      ;;
    ARROWUP|UP)
      printf 'ARROWUP'
      ;;
    NUMPAD[0-9])
      printf '%s' "${upper}"
      ;;
    NUM[0-9])
      printf 'NUMPAD%s' "${upper#NUM}"
      ;;
    NUMPADADD|NUMADD|NUMPADPLUS|NUMPLUS)
      printf 'NUMPADADD'
      ;;
    NUMPADDECIMAL|NUMDECIMAL)
      printf 'NUMPADDECIMAL'
      ;;
    NUMPADDIVIDE|NUMDIVIDE)
      printf 'NUMPADDIVIDE'
      ;;
    NUMPADENTER|NUMENTER)
      printf 'NUMPADENTER'
      ;;
    NUMPADEQUAL|NUMEQUAL)
      printf 'NUMPADEQUAL'
      ;;
    NUMPADMULTIPLY|NUMMULTIPLY)
      printf 'NUMPADMULTIPLY'
      ;;
    NUMPADSUBTRACT|NUMSUBTRACT)
      printf 'NUMPADSUBTRACT'
      ;;
    ESCAPE|ESC)
      printf 'ESCAPE'
      ;;
    AUDIOVOLUMEDOWN|VOLUMEDOWN)
      printf 'AUDIOVOLUMEDOWN'
      ;;
    AUDIOVOLUMEUP|VOLUMEUP)
      printf 'AUDIOVOLUMEUP'
      ;;
    AUDIOVOLUMEMUTE|VOLUMEMUTE)
      printf 'AUDIOVOLUMEMUTE'
      ;;
    MEDIAPLAY|MEDIAPAUSE|MEDIAPLAYPAUSE|MEDIASTOP|MEDIATRACKNEXT)
      printf '%s' "${upper}"
      ;;
    MEDIATRACKPREV|MEDIATRACKPREVIOUS)
      printf 'MEDIATRACKPREVIOUS'
      ;;
    *)
      return 1
      ;;
  esac
}

voco_validate_hotkey() {
  local raw_hotkey="${1:-}"
  local hotkey
  local raw_token
  local token
  local upper
  local canonical_key
  local key=""
  local key_seen=false
  local has_shift=false
  local has_control=false
  local has_alt=false
  local has_super=false
  local -a tokens=()
  local LC_ALL=C

  VOCO_HOTKEY_VALIDATION_ERROR=""
  hotkey="$(voco_trim "${raw_hotkey}")"
  if [[ -z "${hotkey}" ]]; then
    VOCO_HOTKEY_VALIDATION_ERROR="Hotkey cannot be empty."
    return 1
  fi
  if [[ "${hotkey}" == +* || "${hotkey}" == *+ ]]; then
    VOCO_HOTKEY_VALIDATION_ERROR="Hotkey contains an empty key or modifier."
    return 1
  fi

  IFS='+' read -r -a tokens <<< "${hotkey}"
  for raw_token in "${tokens[@]}"; do
    token="$(voco_trim "${raw_token}")"
    if [[ -z "${token}" ]]; then
      VOCO_HOTKEY_VALIDATION_ERROR="Hotkey contains an empty key or modifier."
      return 1
    fi
    if [[ "${key_seen}" == true ]]; then
      VOCO_HOTKEY_VALIDATION_ERROR="Put modifiers first and use exactly one main key."
      return 1
    fi

    upper="${token^^}"
    case "${upper}" in
      OPTION|ALT)
        has_alt=true
        ;;
      CONTROL|CTRL|COMMANDORCONTROL|COMMANDORCTRL|CMDORCTRL|CMDORCONTROL)
        has_control=true
        ;;
      COMMAND|CMD|SUPER)
        has_super=true
        ;;
      SHIFT)
        has_shift=true
        ;;
      *)
        if ! canonical_key="$(voco_canonical_hotkey_key "${token}")"; then
          VOCO_HOTKEY_VALIDATION_ERROR="Unsupported key '${token}'."
          return 1
        fi
        key="${canonical_key}"
        key_seen=true
        ;;
    esac
  done

  if [[ "${key_seen}" != true ]]; then
    VOCO_HOTKEY_VALIDATION_ERROR="Hotkey must include one main key."
    return 1
  fi
  if [[ "${has_alt}" == false && "${has_control}" == false && "${has_super}" == false ]]; then
    VOCO_HOTKEY_VALIDATION_ERROR="Hotkey must include Alt, Control, or Super in addition to the main key."
    return 1
  fi

  return 0
}

voco_read_configured_hotkey() {
  local config_file="$1"

  if command -v python3 >/dev/null 2>&1; then
    python3 - "${config_file}" <<'PY'
import json
import pathlib
import sys

data = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
hotkey = data.get("hotkey") if isinstance(data, dict) else None
if not isinstance(hotkey, str) or not hotkey.strip():
    raise SystemExit(1)
print(hotkey, end="")
PY
    return
  fi

  sed -nE 's/.*"hotkey"[[:space:]]*:[[:space:]]*"([^"\\]*)".*/\1/p' "${config_file}" | head -n 1
}

voco_migrate_legacy_config() {
  local legacy_config_dir="$1"
  local legacy_config_file="$2"
  local config_dir="$3"
  local config_file="$4"
  local current_uid
  local temp_file

  if [[ -e "${config_file}" || -L "${config_file}" ]]; then
    return 1
  fi
  if [[ -L "${legacy_config_dir}" || ! -d "${legacy_config_dir}" || -L "${legacy_config_file}" || ! -f "${legacy_config_file}" ]]; then
    return 1
  fi

  current_uid="$(id -u)" || return 1
  if [[ "$(stat -c '%u' -- "${legacy_config_file}" 2>/dev/null)" != "${current_uid}" ]]; then
    return 1
  fi

  if [[ -L "${config_dir}" || ( -e "${config_dir}" && ! -d "${config_dir}" ) ]]; then
    return 1
  fi
  mkdir -p -m 0700 -- "${config_dir}" || return 1
  if [[ -L "${config_dir}" || ! -d "${config_dir}" || "$(stat -c '%u' -- "${config_dir}" 2>/dev/null)" != "${current_uid}" ]]; then
    return 1
  fi
  chmod 0700 -- "${config_dir}" || return 1

  temp_file="$(mktemp "${config_dir}/.config.json.migrate.XXXXXX")" || return 1
  chmod 0600 -- "${temp_file}" || {
    rm -f -- "${temp_file}"
    return 1
  }
  if ! dd if="${legacy_config_file}" of="${temp_file}" iflag=nofollow oflag=nofollow conv=fsync status=none; then
    rm -f -- "${temp_file}"
    return 1
  fi
  if ! ln -- "${temp_file}" "${config_file}"; then
    rm -f -- "${temp_file}"
    return 1
  fi
  rm -f -- "${temp_file}"

  if [[ -L "${config_file}" || ! -f "${config_file}" || "$(stat -c '%u:%a:%h' -- "${config_file}" 2>/dev/null)" != "${current_uid}:600:1" ]]; then
    return 1
  fi
  return 0
}

voco_verify_installed_package() {
  local expected_version="$1"
  local expected_architecture="$2"
  local package_record
  local installed_status
  local installed_version
  local installed_architecture
  local unexpected_field

  VOCO_INSTALL_ERROR=""
  if ! package_record="$(LC_ALL=C dpkg-query -W -f='${Status}\t${Version}\t${Architecture}\n' voco 2>/dev/null)"; then
    VOCO_INSTALL_ERROR="Package 'voco' is not installed after the package operation."
    return 1
  fi

  IFS=$'\t' read -r installed_status installed_version installed_architecture unexpected_field <<< "${package_record}"
  if [[ -n "${unexpected_field}" || -z "${installed_status}" || -z "${installed_version}" || -z "${installed_architecture}" ]]; then
    VOCO_INSTALL_ERROR="Package manager returned an incomplete VOCO installation record."
    return 1
  fi
  if [[ "${installed_status}" != "install ok installed" ]]; then
    VOCO_INSTALL_ERROR="Package 'voco' is not fully installed (status: ${installed_status})."
    return 1
  fi
  if [[ "${installed_version}" != "${expected_version}" ]]; then
    VOCO_INSTALL_ERROR="Installed VOCO version is ${installed_version}; expected ${expected_version}."
    return 1
  fi
  if [[ "${installed_architecture}" != "${expected_architecture}" ]]; then
    VOCO_INSTALL_ERROR="Installed VOCO architecture is ${installed_architecture}; expected ${expected_architecture}."
    return 1
  fi

  return 0
}

voco_install_deb_package() {
  local deb_file="$1"
  local expected_version="$2"
  local expected_architecture="$3"
  local -a packages

  VOCO_INSTALL_ERROR=""
  deb_file="$(realpath -- "${deb_file}")" || return 1
  packages=("${deb_file}")
  # These are optional in package metadata so X11-only distributions can install.
  # Wayland needs both, even when APT recommendations are disabled by the owner.
  if [[ "${XDG_SESSION_TYPE:-x11}" == wayland ]]; then
    packages+=(ydotool ydotoold)
    # APT downloaded and checked these in parallel with VOCO. Supplying the local
    # archives lets the final dependency transaction reuse them without root cache writes.
    if [[ -n "${4:-}" ]]; then
      local helper_deb
      for helper_deb in "$4"/ydotool_*.deb "$4"/ydotoold_*.deb; do
        [[ -f "$helper_deb" && ! -L "$helper_deb" ]] && packages+=("$helper_deb")
      done
    fi
  fi
  local -a install_command=(sudo apt-get install -y --)
  if declare -F voco_run_apt >/dev/null; then install_command=(voco_run_apt); fi
  if ! "${install_command[@]}" "${packages[@]}"; then
    VOCO_INSTALL_ERROR="APT could not install VOCO and its desktop dependencies. Resolve the error above, then run the installer again."
    return 1
  fi
  voco_verify_installed_package "${expected_version}" "${expected_architecture}"
}

voco_verify_desktop_input() {
  VOCO_INPUT_ERROR=""
  if ! VOCO_INPUT_ERROR="$(/usr/bin/voco --check-desktop-input 2>&1)"; then
    return 1
  fi
}

voco_wayland_device_access() {
  [[ -c /dev/uinput && -w /dev/uinput ]]
}

voco_start_wayland_service() {
  [[ "${XDG_SESSION_TYPE:-x11}" == wayland ]] || return 0
  # Reuse a working service, including a distribution/admin-managed daemon.
  voco_verify_desktop_input && return 0
  if ! voco_wayland_device_access; then
    VOCO_INPUT_ERROR="This login cannot access /dev/uinput. Complete the Wayland device-permission setup before starting the input service."
    return 1
  fi
  if pgrep -x ydotoold >/dev/null 2>&1; then
    VOCO_INPUT_ERROR="An existing ydotoold is running but is unavailable to this login. Check its socket permissions; VOCO will not replace that service."
    return 1
  fi
  if ! systemctl --user enable --now voco-ydotoold.service; then
    VOCO_INPUT_ERROR="Could not start the VOCO input service. Check: systemctl --user status voco-ydotoold.service"
    return 1
  fi
  local attempt
  for attempt in {1..10}; do
    if voco_verify_desktop_input; then return 0; fi
    sleep 0.2
  done
  return 1
}

voco_write_default_config() {
  local config_file="$1"
  local hotkey="$2"
  local escaped_hotkey

  escaped_hotkey="$(voco_escape_json_string "${hotkey}")"

  (umask 077; cat > "${config_file}") << EOF
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
  local existing_hotkey=""
  local existing_hotkey_valid=false
  local config_exists=false
  local config_path_safe=true
  local legacy_config_dir="${HOME}/.config/voice"
  local legacy_config_file="${legacy_config_dir}/config.json"
  local legacy_config_present=false
  local legacy_config_migrated=false
  local legacy_config_skipped=false

  if [[ -L "${config_dir}" || -L "${config_file}" || ( -e "${config_file}" && ! -f "${config_file}" ) ]]; then
    config_exists=true
    config_path_safe=false
  else
    if [[ ! -e "${config_file}" ]]; then
      if [[ -L "${legacy_config_dir}" ]]; then
        legacy_config_present=true
      elif [[ -d "${legacy_config_dir}" ]]; then
        if [[ -L "${legacy_config_file}" || -e "${legacy_config_file}" ]]; then
          legacy_config_present=true
        fi
      elif [[ -e "${legacy_config_dir}" ]]; then
        legacy_config_present=true
      fi

      if [[ "${legacy_config_present}" == true ]]; then
        if voco_migrate_legacy_config "${legacy_config_dir}" "${legacy_config_file}" "${config_dir}" "${config_file}"; then
          legacy_config_migrated=true
        else
          legacy_config_skipped=true
        fi
      fi
    fi

    if [[ -f "${config_file}" ]]; then
      config_exists=true
      if existing_hotkey="$(voco_read_configured_hotkey "${config_file}" 2>/dev/null)" && voco_validate_hotkey "${existing_hotkey}"; then
        existing_hotkey="$(voco_trim "${existing_hotkey}")"
        hotkey="${existing_hotkey}"
        existing_hotkey_valid=true
      fi
    fi
  fi

  if [[ "${config_path_safe}" != true ]]; then
    echo
    warn "Existing VOCO config path is a symlink or is not a regular file; it was preserved without modification."
    VOCO_SELECTED_HOTKEY="${hotkey}"
    VOCO_CONFIG_FILE="${config_file}"
    return 0
  fi

  if [[ "${legacy_config_migrated}" == true ]]; then
    echo
    dim "Legacy Voice settings migrated to ${config_file}"
  elif [[ "${legacy_config_skipped}" == true ]]; then
    echo
    warn "Legacy Voice config is a symlink, is not a regular user-owned file, or could not be copied; it was preserved without modification."
  fi

  if [[ "${config_exists}" == true ]]; then
    if [[ "${existing_hotkey_valid}" == true ]]; then
      ok "Shortcut: ${hotkey} (existing settings kept)"
    else
      warn "Existing config preserved; VOCO will validate its hotkey on launch."
    fi
    VOCO_SELECTED_HOTKEY="${hotkey}"
    VOCO_CONFIG_FILE="${config_file}"
    return 0
  else
    ok "Shortcut: ${hotkey}"
  fi

  mkdir -p -m 0700 "${config_dir}"
  chmod 0700 "${config_dir}"
  if [[ -f "${config_file}" ]]; then
    if [[ "${existing_hotkey_valid}" == true && "${hotkey}" == "${existing_hotkey}" ]]; then
      dim "Existing config preserved at ${config_file}"
    elif voco_merge_hotkey_into_existing_config "${config_file}" "${hotkey}"; then
      dim "Updated hotkey in existing config at ${config_file}"
    else
      warn "Existing config preserved without overwriting other settings."
      dim "Update the hotkey later from the tray or by editing ${config_file}"
    fi
  else
    voco_write_default_config "${config_file}" "${hotkey}"
  fi
  chmod 0600 "${config_file}"

  VOCO_SELECTED_HOTKEY="${hotkey}"
  VOCO_CONFIG_FILE="${config_file}"
}
