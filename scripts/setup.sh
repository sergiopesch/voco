#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/install-common.sh"

# VOCO — one-command setup
# Usage: ./scripts/setup.sh           (dev mode)
#        ./scripts/setup.sh --install  (build + install as desktop app)

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
echo -e "  ${DIM}Voice-native interface layer. Built for Linux.${NC}"
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

if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if (( NODE_VER >= 20 )); then
    ok "Node.js $(node -v)"
  else
    err "Node.js 20+ required (found $(node -v))"
    exit 1
  fi
else
  err "Node.js not found — install via https://nodejs.org"
  exit 1
fi

if command -v rustc &>/dev/null || [[ -f "$HOME/.cargo/bin/rustc" ]]; then
  RUSTC="${HOME}/.cargo/bin/rustc"
  command -v rustc &>/dev/null && RUSTC="rustc"
  ok "Rust $($RUSTC --version | awk '{print $2}')"
else
  run_step "Installing Rust via rustup" \
    bash -c 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y'
  source "$HOME/.cargo/env"
fi

# ─── Step 2: System Dependencies ────────────────────────
step "System dependencies"

if command -v apt &>/dev/null; then
  run_step "System libraries + build tools (apt)" \
    bash -c 'sudo apt update -qq 2>/dev/null && sudo apt install -y -qq \
      pkg-config libglib2.0-dev libsoup-3.0-dev \
      libjavascriptcoregtk-4.1-dev libwebkit2gtk-4.1-dev \
      libayatana-appindicator3-dev clang mold 2>/dev/null'
else
  warn "Not using apt — install manually: pkg-config libglib2.0-dev libsoup-3.0-dev"
  warn "libjavascriptcoregtk-4.1-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev"
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

# ─── Step 3: npm Dependencies ───────────────────────────
step "Node dependencies"

run_step "npm install" npm install --silent --prefer-offline

# ─── Steps 4-5: Build & Install ─────────────────────────
if [[ "$INSTALL_MODE" == true ]]; then
  export PATH="$HOME/.cargo/bin:$PATH"

  step "Build"

  # Remove stale bundle artifacts so install picks the package from this build only.
  rm -rf apps/desktop/src-tauri/target/release/bundle/deb
  rm -rf apps/desktop/src-tauri/target/release/bundle/appimage

  # Maximize parallelism
  export CMAKE_BUILD_PARALLEL_LEVEL=$(nproc)
  export CARGO_BUILD_JOBS=$(nproc)

  # Use mold linker if available (much faster linking)
  if command -v mold &>/dev/null && command -v clang &>/dev/null; then
    mkdir -p apps/desktop/src-tauri/.cargo
    cat > apps/desktop/src-tauri/.cargo/config.toml <<'TOML'
[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=mold"]
TOML
    ok "mold linker enabled"
  fi

  # Show live build progress by tailing cargo output
  BUILD_START=$SECONDS
  BUILD_LOG=$(mktemp)

  # Local install only needs the Debian bundle. AppImage packaging is handled separately.
  (cd apps/desktop && cargo tauri build --bundles deb 2>&1) > "$BUILD_LOG" &
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

  DEB=$(find apps/desktop/src-tauri/target/release/bundle/deb -maxdepth 1 \( -name "voco_*.deb" -o -name "VOCO_*.deb" \) 2>/dev/null | sort | tail -1)
  if [[ -n "$DEB" ]]; then
    DEB_SIZE=$(du -h "$DEB" | cut -f1)
    printf "    ${DIM}Package: %s (%s)${NC}\n" "$(basename "$DEB")" "$DEB_SIZE"
    if sudo dpkg -i "$DEB" > /dev/null 2>&1; then
      ok "VOCO installed"
    else
      err "dpkg install failed"
      exit 1
    fi
  else
    err "No .deb package found"
    exit 1
  fi

  voco_run_hotkey_setup "Alt+D"
  HOTKEY="${VOCO_SELECTED_HOTKEY}"
  CONFIG_FILE="${VOCO_CONFIG_FILE}"

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
  echo -e "  ${DIM}First launch downloads the speech model (~142 MB, one-time).${NC}"
  echo -e "  ${DIM}Then press ${BOLD}${HOTKEY}${NC}${DIM} to dictate!${NC}"
  echo
  echo -e "  ${DIM}You can change the hotkey anytime from the system tray icon${NC}"
  echo -e "  ${DIM}or edit ${CONFIG_FILE}${NC}"
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
  echo -e "  ${DIM}First launch downloads the speech model (~142 MB, one-time).${NC}"
  echo -e "  ${DIM}Then press ${BOLD}Alt+D${NC}${DIM} to dictate!${NC}"
  echo
fi
