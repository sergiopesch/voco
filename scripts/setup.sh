#!/usr/bin/env bash
set -euo pipefail

# Voice Dictation — one-command setup for Linux
# Usage: ./scripts/setup.sh

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*"; exit 1; }

echo "Voice Dictation — Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━"
echo

# --- Detect OS ---
if [[ "$(uname)" == "Darwin" ]]; then
  OS="macos"
elif [[ "$(uname)" == "Linux" ]]; then
  OS="linux"
else
  fail "Unsupported OS: $(uname)"
fi

# --- Check Node.js ---
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if (( NODE_VER >= 18 )); then
    info "Node.js $(node -v)"
  else
    fail "Node.js 18+ required (found $(node -v)). Install via https://nodejs.org"
  fi
else
  fail "Node.js not found. Install via https://nodejs.org"
fi

# --- Check Rust ---
if command -v rustc &>/dev/null || command -v "$HOME/.cargo/bin/rustc" &>/dev/null; then
  RUSTC="${HOME}/.cargo/bin/rustc"
  command -v rustc &>/dev/null && RUSTC="rustc"
  info "Rust $($RUSTC --version | awk '{print $2}')"
else
  warn "Rust not found. Installing via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
  info "Rust installed"
fi

# --- Linux system dependencies ---
if [[ "$OS" == "linux" ]]; then
  echo
  echo "Installing system dependencies..."

  if command -v apt &>/dev/null; then
    sudo apt update -qq
    sudo apt install -y -qq \
      pkg-config \
      libglib2.0-dev \
      libsoup-3.0-dev \
      libjavascriptcoregtk-4.1-dev \
      libwebkit2gtk-4.1-dev \
      libayatana-appindicator3-dev \
      2>/dev/null
    info "System libraries installed"
  else
    warn "Not using apt — install these manually:"
    echo "  pkg-config libglib2.0-dev libsoup-3.0-dev"
    echo "  libjavascriptcoregtk-4.1-dev libwebkit2gtk-4.1-dev"
    echo "  libayatana-appindicator3-dev"
  fi

  # Text insertion tools
  SESSION="${XDG_SESSION_TYPE:-x11}"
  if [[ "$SESSION" == "wayland" ]]; then
    if ! command -v ydotool &>/dev/null; then
      warn "ydotool not found — needed for text insertion on Wayland"
      echo "  Install: sudo apt install ydotool"
    else
      info "ydotool found"
    fi
    if ! command -v wl-copy &>/dev/null; then
      warn "wl-copy not found — needed for clipboard fallback"
      echo "  Install: sudo apt install wl-clipboard"
    else
      info "wl-clipboard found"
    fi
  else
    if ! command -v xdotool &>/dev/null; then
      warn "xdotool not found — needed for text insertion on X11"
      echo "  Install: sudo apt install xdotool"
    else
      info "xdotool found"
    fi
    if ! command -v xclip &>/dev/null; then
      warn "xclip not found — needed for clipboard fallback"
      echo "  Install: sudo apt install xclip"
    else
      info "xclip found"
    fi
  fi

  # Input group for evdev hotkey (Wayland)
  if [[ "$SESSION" == "wayland" ]]; then
    if groups | grep -q '\binput\b'; then
      info "User in 'input' group (evdev hotkey)"
    else
      warn "Add yourself to 'input' group for global hotkey on Wayland:"
      echo "  sudo usermod -aG input \$USER && newgrp input"
    fi
  fi
fi

# --- macOS dependencies ---
if [[ "$OS" == "macos" ]]; then
  if ! xcode-select -p &>/dev/null; then
    warn "Installing Xcode command line tools..."
    xcode-select --install
  else
    info "Xcode CLI tools"
  fi
fi

# --- npm install ---
echo
echo "Installing npm dependencies..."
npm install --silent
info "npm dependencies installed"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}Setup complete!${NC}"
echo
echo "Start the app:"
echo "  npm run dev"
echo
echo "On first launch, the app will prompt to download the"
echo "whisper speech model (~142 MB, one-time)."
echo
echo "Then press Alt+D to dictate!"
