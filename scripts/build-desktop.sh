#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/desktop"
APPIMAGE_DIR="${APP_DIR}/src-tauri/target/release/bundle/appimage"
APPDIR_PATH="${APPIMAGE_DIR}/VOCO.AppDir"
APPIMAGE_PATH="${APPIMAGE_DIR}/VOCO_0.1.0_amd64.AppImage"
LOG_PATH="$(mktemp)"

cleanup() {
  rm -f "${LOG_PATH}"
}
trap cleanup EXIT

cd "${APP_DIR}"

set +e
cargo tauri build 2>&1 | tee "${LOG_PATH}"
BUILD_EXIT=${PIPESTATUS[0]}
set -e

if [[ ${BUILD_EXIT} -eq 0 ]]; then
  exit 0
fi

if grep -q "failed to run linuxdeploy" "${LOG_PATH}" && [[ -d "${APPDIR_PATH}" ]]; then
  echo "linuxdeploy failed; using scripts/package-appimage.sh fallback"
  bash "${ROOT_DIR}/scripts/package-appimage.sh"
  exit 0
fi

exit ${BUILD_EXIT}
