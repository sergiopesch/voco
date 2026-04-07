#!/usr/bin/env bash
set -euo pipefail

# VOCO — quick install from pre-built release
# Usage: bash <(curl -s https://raw.githubusercontent.com/sergiopesch/voco/master/install)

VERSION="2026.0.3"
RELEASE_TAG="voco.${VERSION}"
DEB_URL="https://github.com/sergiopesch/voco/releases/download/${RELEASE_TAG}/voco_${VERSION}_amd64.deb"

# ─── Colors ─────────────────────────────────────────────
BOLD='\033[1m'
DIM='\033[2m'
PURPLE='\033[38;2;108;76;245m'
PURPLE_SOFT='\033[38;2;138;114;255m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
WHITE='\033[37m'
NC='\033[0m'

ok()   { printf "  ${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "  ${YELLOW}⚠${NC} %s\n" "$*"; }
err()  { printf "  ${RED}✗${NC} %s\n" "$*"; exit 1; }
dim()  { printf "  ${DIM}%s${NC}\n" "$*"; }

# ─── Spinner ────────────────────────────────────────────
SPINNER_PID=""
spinner_start() {
  local msg="$1"
  (
    local frames=("⣾" "⣽" "⣻" "⢿" "⡿" "⣟" "⣯" "⣷")
    local i=0
    while true; do
      printf "\r    ${PURPLE_SOFT}${frames[$i]}${NC} ${DIM}%s${NC}" "$msg"
      i=$(( (i + 1) % ${#frames[@]} ))
      sleep 0.07
    done
  ) &
  SPINNER_PID=$!
}

spinner_stop() {
  [[ -z "$SPINNER_PID" ]] && return
  kill "$SPINNER_PID" 2>/dev/null; wait "$SPINNER_PID" 2>/dev/null || true
  printf "\r\033[K"
  SPINNER_PID=""
}

run_step() {
  local msg="$1"; shift
  spinner_start "$msg"
  local log; log=$(mktemp)
  if "$@" > "$log" 2>&1; then
    spinner_stop; ok "$msg"; rm -f "$log"
  else
    spinner_stop; err "$msg (see output above)"
    tail -10 "$log" | while IFS= read -r l; do dim "  $l"; done
    rm -f "$log"; exit 1
  fi
}

trap 'spinner_stop' EXIT

SECONDS=0

# ─── Header ─────────────────────────────────────────────
echo
echo -e "  ${PURPLE_SOFT}${BOLD}██╗   ██╗ ██████╗  ██████╗ ██████╗ ${NC}"
echo -e "  ${PURPLE_SOFT}${BOLD}██║   ██║██╔═══██╗██╔════╝██╔═══██╗${NC}"
echo -e "  ${PURPLE_SOFT}${BOLD}██║   ██║██║   ██║██║     ██║   ██║${NC}"
echo -e "  ${PURPLE_SOFT}${BOLD}╚██╗ ██╔╝██║   ██║██║     ██║   ██║${NC}"
echo -e "  ${PURPLE}${BOLD} ╚████╔╝ ╚██████╔╝╚██████╗╚██████╔╝${NC}"
echo -e "  ${PURPLE}${BOLD}  ╚═══╝   ╚═════╝  ╚═════╝ ╚═════╝ ${NC}"
echo
echo -e "  ${DIM}A voice-native interface layer designed for speed and precision${NC}"
echo -e "  ${DIM}────────────────────────────────────────────────────────────${NC}"
echo -e "  ${DIM}v${VERSION}${NC}"
echo

# ─── Checks ─────────────────────────────────────────────
echo -e "  ${BOLD}${PURPLE}[1/3]${NC} ${BOLD}Checks${NC}"

if [[ "$(uname)" != "Linux" ]]; then
  err "VOCO only supports Linux. Detected: $(uname)"
fi

if [[ "$(dpkg --print-architecture 2>/dev/null)" != "amd64" ]]; then
  err "Only amd64 (x86_64) is supported. Detected: $(dpkg --print-architecture 2>/dev/null || uname -m)"
fi

ok "Linux $(uname -r)"
ok "$(dpkg --print-architecture)"

# Check runtime dependencies
if dpkg -s libwebkit2gtk-4.1-0 &>/dev/null; then
  ok "libwebkit2gtk-4.1"
else
  warn "libwebkit2gtk-4.1-0 not installed"
  dim "Run: sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1"
fi

SESSION="${XDG_SESSION_TYPE:-x11}"
if [[ "$SESSION" == "wayland" ]]; then
  command -v ydotool &>/dev/null && ok "ydotool" || warn "Missing: sudo apt install ydotool"
  command -v wl-copy &>/dev/null && ok "wl-clipboard" || warn "Missing: sudo apt install wl-clipboard"
  groups | grep -q '\binput\b' && ok "input group" || warn "Run: sudo usermod -aG input \$USER"
else
  command -v xdotool &>/dev/null && ok "xdotool" || warn "Missing: sudo apt install xdotool"
  command -v xclip &>/dev/null && ok "xclip" || warn "Missing: sudo apt install xclip"
fi

# ─── Download ───────────────────────────────────────────
echo
echo -e "  ${BOLD}${PURPLE}[2/3]${NC} ${BOLD}Download${NC}"

TMPDIR=$(mktemp -d)
DEB_FILE="${TMPDIR}/voco_${VERSION}_amd64.deb"

run_step "Downloading VOCO v${VERSION} (~5 MB)" \
  wget -q -O "$DEB_FILE" "$DEB_URL"

DEB_SIZE=$(du -h "$DEB_FILE" | cut -f1)
dim "Package: voco_${VERSION}_amd64.deb (${DEB_SIZE})"

# ─── Install ────────────────────────────────────────────
echo
echo -e "  ${BOLD}${PURPLE}[3/3]${NC} ${BOLD}Install${NC}"

if sudo dpkg -i "$DEB_FILE" > /dev/null 2>&1; then
  ok "VOCO installed"
else
  # Try to fix missing dependencies
  if sudo apt-get install -f -y -qq > /dev/null 2>&1; then
    ok "VOCO installed (dependencies resolved)"
  else
    err "Installation failed. Try: sudo apt install -f"
  fi
fi

rm -rf "$TMPDIR"

# ─── Onboarding ─────────────────────────────────────────
echo
echo -e "  ${BOLD}${PURPLE}Quick Setup${NC}"
echo
echo -e "  VOCO uses a global hotkey to start and stop listening."
echo -e "  The default is ${BOLD}Alt+D${NC} — press it anywhere to dictate."
echo

HOTKEY="Alt+D"
CONFIG_DIR="${HOME}/.config/voco"
CONFIG_FILE="${CONFIG_DIR}/config.json"

# Only ask if running interactively (not piped without terminal)
if [[ -t 0 ]]; then
  printf "  ${WHITE}${BOLD}▸${NC} Happy with ${BOLD}Alt+D${NC}? [Y/n] "
  read -r ANSWER </dev/tty 2>/dev/null || ANSWER="y"
  ANSWER="${ANSWER:-y}"

  if [[ "$ANSWER" =~ ^[Nn] ]]; then
    echo
    echo -e "  ${DIM}Examples: Ctrl+Shift+V, Super+D, Alt+Shift+R${NC}"
    printf "  ${WHITE}${BOLD}▸${NC} Enter your preferred hotkey: "
    read -r CUSTOM_HOTKEY </dev/tty 2>/dev/null || CUSTOM_HOTKEY=""
    if [[ -n "$CUSTOM_HOTKEY" ]]; then
      HOTKEY="$CUSTOM_HOTKEY"
      ok "Hotkey set to ${BOLD}${HOTKEY}${NC}"
    else
      ok "Keeping default ${BOLD}Alt+D${NC}"
    fi
  else
    ok "Hotkey: ${BOLD}Alt+D${NC}"
  fi
else
  ok "Hotkey: ${BOLD}Alt+D${NC} (default)"
fi

# Save config with chosen hotkey
mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_FILE" << EOF
{
  "hotkey": "${HOTKEY}",
  "selectedMic": null,
  "insertionStrategy": "auto"
}
EOF
dim "Config saved to ${CONFIG_FILE}"

# ─── Done ───────────────────────────────────────────────
ELAPSED=$SECONDS

echo
echo -e "  ${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${GREEN}${BOLD}  Installed in ${ELAPSED}s!${NC}"
echo -e "  ${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo -e "  ${WHITE}${BOLD}▸${NC} Open ${BOLD}VOCO${NC} from your app launcher"
echo -e "  ${WHITE}${BOLD}▸${NC} Or run: ${PURPLE_SOFT}voco${NC}"
echo
echo -e "  ${DIM}First launch downloads the speech model (~142 MB, one-time).${NC}"
echo -e "  ${DIM}Then press ${BOLD}${HOTKEY}${NC}${DIM} to dictate!${NC}"
echo
echo -e "  ${DIM}You can change the hotkey anytime from the system tray icon${NC}"
echo -e "  ${DIM}or edit ${CONFIG_FILE}${NC}"
echo
