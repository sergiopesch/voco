#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/install-common.sh"
cd "${ROOT_DIR}"

# VOCO — one-command setup
# Usage: ./scripts/setup.sh           (dev mode)
#        ./scripts/setup.sh --install  (build, assemble and verify the complete NVIDIA package, then install it with APT)

# ─── Colors ─────────────────────────────────────────────
BOLD='\033[1m'
DIM='\033[2m'
GRAPHITE='\033[38;2;122;128;138m'
GRAPHITE_SOFT='\033[38;2;199;204;212m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
WHITE='\033[37m'
NC='\033[0m'

ok()   { printf "  ${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "  ${YELLOW}⚠${NC} %s\n" "$*"; }
err()  { printf "  ${RED}✗${NC} %s\n" "$*"; }
dim()  { printf "  ${DIM}%s${NC}\n" "$*"; }

step() {
  STEP_NUM=$((STEP_NUM + 1))
  echo
  printf "  ${BOLD}${GRAPHITE}[%d/%d]${NC} ${BOLD}%s${NC}\n" "$STEP_NUM" "$TOTAL_STEPS" "$1"
}

# ─── Spinner ────────────────────────────────────────────
SPINNER_PID=""
spinner_start() {
  local msg="$1"
  (
    local frames=("⣾" "⣽" "⣻" "⢿" "⡿" "⣟" "⣯" "⣷")
    local i=0
    while true; do
      printf "\r    ${GRAPHITE_SOFT}${frames[$i]}${NC} ${DIM}%s${NC}" "$msg"
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
    spinner_stop
    ok "$msg"
    rm -f "$log"
  else
    local rc=$?
    spinner_stop
    err "$msg"
    echo
    tail -20 "$log" | while IFS= read -r l; do dim "  $l"; done
    rm -f "$log"
    return $rc
  fi
}

trap 'spinner_stop' EXIT

# ─── Args ───────────────────────────────────────────────
INSTALL_MODE=false
[[ "${1:-}" == "--install" ]] && INSTALL_MODE=true

if $INSTALL_MODE; then TOTAL_STEPS=5; else TOTAL_STEPS=3; fi
STEP_NUM=0

# ─── Header ─────────────────────────────────────────────
echo
echo -e "  ${GRAPHITE_SOFT}${BOLD}██╗   ██╗ ██████╗  ██████╗ ██████╗ ${NC}"
echo -e "  ${GRAPHITE_SOFT}${BOLD}██║   ██║██╔═══██╗██╔════╝██╔═══██╗${NC}"
echo -e "  ${GRAPHITE_SOFT}${BOLD}██║   ██║██║   ██║██║     ██║   ██║${NC}"
echo -e "  ${GRAPHITE_SOFT}${BOLD}╚██╗ ██╔╝██║   ██║██║     ██║   ██║${NC}"
echo -e "  ${GRAPHITE}${BOLD} ╚████╔╝ ╚██████╔╝╚██████╗╚██████╔╝${NC}"
echo -e "  ${GRAPHITE}${BOLD}  ╚═══╝   ╚═════╝  ╚═════╝ ╚═════╝ ${NC}"
echo
echo -e "  ${DIM}Your voice, typed. Built for Linux.${NC}"
echo -e "  ${DIM}────────────────────────────────────────────────────────────${NC}"
echo

SECONDS=0

# ─── OS Check ───────────────────────────────────────────
if [[ "$(uname)" != "Linux" ]]; then
  err "VOCO only supports Linux. Detected: $(uname)"
  exit 1
fi

# ─── Step 1: Prerequisites ──────────────────────────────
step "Prerequisites"

if $INSTALL_MODE; then
  # The package must carry the pinned runtime; never download a replacement.
  for runtime_path in runtime/speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf \
    runtime/speech/libbench_nemo_pool.so runtime/speech/lib; do
    if [[ ! -e "$runtime_path" ]]; then
      err "Missing pinned runtime ${runtime_path}; see docs/linux-packaging.md#runtime-provisioning"
      exit 1
    fi
  done
  ok "Pinned speech runtime"
fi

if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if (( NODE_VER >= 24 )); then
    ok "Node.js $(node -v)"
  else
    err "Node.js 24+ required (found $(node -v)); use the LTS version in .nvmrc"
    exit 1
  fi
else
  err "Node.js not found — install via https://nodejs.org"
  exit 1
fi

export PATH="$HOME/.cargo/bin:$PATH"
if command -v rustc &>/dev/null; then
  ok "Rust $(rustc --version | awk '{print $2}')"
else
  err "Rust not found — install it with rustup: https://rustup.rs"
  exit 1
fi

# ─── Step 2: System Dependencies ────────────────────────
step "System dependencies"

APT_PACKAGES=(pkg-config libglib2.0-dev libsoup-3.0-dev
  libjavascriptcoregtk-4.1-dev libwebkit2gtk-4.1-dev
  libayatana-appindicator3-dev libpulse-dev gcc
  ibus gir1.2-ibus-1.0 python3-gi python3-numpy python3-psutil)
# The package verifier needs readelf, desktop-file-validate and appstreamcli.
PACKAGE_TOOLS=(binutils desktop-file-utils appstream)
if $INSTALL_MODE; then APT_PACKAGES+=("${PACKAGE_TOOLS[@]}"); fi

if command -v apt &>/dev/null; then
  run_step "System libraries + build tools (apt)" \
    bash -c 'sudo apt update -qq 2>/dev/null && sudo apt install -y -qq "$@" 2>/dev/null' _ "${APT_PACKAGES[@]}"
else
  warn "Not using apt — install manually: gcc pkg-config libglib2.0-dev libsoup-3.0-dev"
  warn "libjavascriptcoregtk-4.1-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev libpulse-dev"
  warn "For IBus shortcut integration, install IBus, its GI bindings, and system Python 3"
  warn "The speech worker needs system Python 3 with NumPy and psutil"
  if $INSTALL_MODE; then warn "Package assembly also needs: ${PACKAGE_TOOLS[*]}"; fi
fi

if [[ -x /usr/bin/python3 ]] && /usr/bin/python3 -c 'import gi; gi.require_version("IBus", "1.0"); from gi.repository import IBus' 2>/dev/null; then
  ok "IBus shortcut runtime"
else
  warn "IBus shortcut integration unavailable — install ibus gir1.2-ibus-1.0 python3-gi"
fi

SESSION="${XDG_SESSION_TYPE:-x11}"
if [[ "$SESSION" == "wayland" ]]; then
  [[ -w /dev/uinput ]] && ok "/dev/uinput" || dim "Wayland paste keys need /dev/uinput; the VOCO package's udev rule grants it at sign-in"
  command -v wl-copy &>/dev/null && ok "wl-clipboard" || dim "wl-clipboard missing: required on supported wlroots desktops; GNOME uses xclip"
else
  command -v xdotool &>/dev/null && ok "xdotool" || dim "X11 paste helper missing: install xdotool"
  command -v xclip &>/dev/null && ok "xclip" || dim "X11 clipboard helper missing: install xclip"
fi

# ─── Step 3: npm Dependencies ───────────────────────────
step "Node dependencies"

if $INSTALL_MODE; then
  run_step "npm ci" npm ci --silent
else
  run_step "npm install" npm install --silent --prefer-offline
fi

# ─── Steps 4-5: Build & Install ─────────────────────────
if [[ "$INSTALL_MODE" == true ]]; then
  step "Build"

  # The same pin as scripts/assemble-release.sh.
  if ! TAURI_CLI=$(cargo tauri --version 2>/dev/null); then
    run_step "Tauri CLI 2.10.1" cargo install tauri-cli --version "2.10.1" --locked
  elif [[ "$TAURI_CLI" != "tauri-cli 2.10.1" ]]; then
    warn "Found ${TAURI_CLI}; releases use 2.10.1: cargo install tauri-cli --version 2.10.1 --locked"
  fi

  # Remove stale bundle artifacts so install picks the package from this build only.
  rm -rf apps/desktop/src-tauri/target/release/bundle/deb
  rm -rf apps/desktop/src-tauri/target/release/bundle/voco-complete

  # Show live build progress by tailing cargo output
  BUILD_START=$SECONDS
  BUILD_LOG=$(mktemp)

  # The build wrapper builds the frontend, the browser host and the Debian bundle.
  (npm run build 2>&1) > "$BUILD_LOG" &
  BUILD_PID=$!

  # Show animated progress while build runs
  CRATE_COUNT=0
  FRAMES=("⣾" "⣽" "⣻" "⢿" "⡿" "⣟" "⣯" "⣷")
  FRAME_I=0
  LAST_CRATE=""
  while kill -0 "$BUILD_PID" 2>/dev/null; do
    # Count compiled crates so far
    NEW_COUNT=$(grep -c "Compiling\|Checking" "$BUILD_LOG" 2>/dev/null || echo 0)
    NEW_CRATE=$(grep -oP "(?:Compiling|Checking) \K\S+" "$BUILD_LOG" 2>/dev/null | tail -1 || true)
    if [[ "$NEW_COUNT" != "$CRATE_COUNT" ]] || [[ "$NEW_CRATE" != "$LAST_CRATE" ]]; then
      CRATE_COUNT=$NEW_COUNT
      LAST_CRATE=$NEW_CRATE
    fi
    ELAPSED=$((SECONDS - BUILD_START))
    if [[ -n "$LAST_CRATE" ]]; then
      printf "\r    ${GRAPHITE_SOFT}${FRAMES[$FRAME_I]}${NC} ${DIM}Compiling (%d crates, %ds) · %s${NC}    " "$CRATE_COUNT" "$ELAPSED" "$LAST_CRATE"
    else
      printf "\r    ${GRAPHITE_SOFT}${FRAMES[$FRAME_I]}${NC} ${DIM}Starting build...${NC}    "
    fi
    FRAME_I=$(( (FRAME_I + 1) % ${#FRAMES[@]} ))
    sleep 0.15
  done

  printf "\r\033[K"

  # Check if build succeeded
  if wait "$BUILD_PID"; then
    BUILD_ELAPSED=$((SECONDS - BUILD_START))
    ok "Built in ${BUILD_ELAPSED}s (${CRATE_COUNT} crates compiled)"
  else
    err "Build failed"
    echo
    tail -20 "$BUILD_LOG" | while IFS= read -r l; do dim "  $l"; done
    rm -f "$BUILD_LOG"
    exit 1
  fi
  rm -f "$BUILD_LOG"

  # ─── Install ──────────────────────────────────────────
  step "Install"

  EXPECTED_VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
  BASE_DEB=$(find apps/desktop/src-tauri/target/release/bundle/deb -maxdepth 1 -name "*_${EXPECTED_VERSION}_amd64.deb" 2>/dev/null | sort | tail -1)
  if [[ -z "$BASE_DEB" ]]; then
    err "No ${EXPECTED_VERSION} .deb package found"
    exit 1
  fi
  # A base Tauri bundle has no speech runtime; install only the verified complete package.
  DEB="apps/desktop/src-tauri/target/release/bundle/voco-complete/voco_${EXPECTED_VERSION}_amd64.deb"
  run_step "Assemble NVIDIA package" python3 scripts/package-nvidia.py "$BASE_DEB" "$DEB" --debian-version "$EXPECTED_VERSION"
  run_step "Verify package" bash scripts/verify-deb-package.sh "$DEB" "$EXPECTED_VERSION"
  DEB_SIZE=$(du -h "$DEB" | cut -f1)
  printf "    ${DIM}Package: %s (%s)${NC}\n" "$(basename "$DEB")" "$DEB_SIZE"
  if voco_install_deb_package "$DEB" "$EXPECTED_VERSION" "amd64"; then
    ok "VOCO and desktop dependencies installed"
  else
    err "Installation failed: ${VOCO_INSTALL_ERROR}"
    exit 1
  fi

  if ! voco_verify_desktop_input; then
    warn "VOCO is installed, but desktop input setup is incomplete: ${VOCO_INPUT_ERROR}"
    dim "See docs/platform/README.md before dictating."
    exit 2
  fi

  # ─── Done ─────────────────────────────────────────────
  ELAPSED=$SECONDS
  MINS=$((ELAPSED / 60))
  SECS=$((ELAPSED % 60))
  [[ $MINS -gt 0 ]] && TIME_STR="${MINS}m ${SECS}s" || TIME_STR="${SECS}s"

  echo
  echo -e "  ${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  ${GREEN}${BOLD}  Done in ${TIME_STR}!${NC}"
  echo -e "  ${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo
  echo -e "  ${WHITE}${BOLD}▸${NC} Open ${BOLD}VOCO${NC} from your app launcher"
  echo -e "  ${WHITE}${BOLD}▸${NC} Or run: ${GRAPHITE_SOFT}voco${NC}"
  echo
  echo -e "  ${DIM}Speech uses the pinned runtime bundled in the package.${NC}"
  echo -e "  ${DIM}Click where you want the text, then press ${BOLD}Alt+D${NC}${DIM}, or your saved shortcut, to dictate!${NC}"
  echo
  echo -e "  ${DIM}Change the shortcut on the Shortcut page of VOCO's Settings.${NC}"
  echo

else
  # ─── Dev mode done ────────────────────────────────────
  ELAPSED=$SECONDS
  echo
  echo -e "  ${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  ${GREEN}${BOLD}  Ready in ${ELAPSED}s!${NC}"
  echo -e "  ${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo
  echo -e "  ${WHITE}${BOLD}▸${NC} Development:   ${GRAPHITE_SOFT}npm run dev${NC}"
  echo -e "  ${WHITE}${BOLD}▸${NC} Full install:  ${GRAPHITE_SOFT}./scripts/setup.sh --install${NC}"
  echo
  echo -e "  ${DIM}Speech needs the pinned runtime: see docs/linux-packaging.md#runtime-provisioning.${NC}"
  echo -e "  ${DIM}Click where you want the text, then press ${BOLD}Alt+D${NC}${DIM} to dictate.${NC}"
  echo
fi
