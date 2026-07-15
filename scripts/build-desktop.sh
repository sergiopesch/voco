#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/desktop"

cd "${APP_DIR}"
cargo tauri build --features custom-protocol --bundles deb -- --locked
