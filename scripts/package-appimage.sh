#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPIMAGE_DIR="${ROOT_DIR}/apps/desktop/src-tauri/target/release/bundle/appimage"
APPDIR_PATH="${APPIMAGE_DIR}/VOCO.AppDir"
APPIMAGE_VERSION="${VOCO_APPIMAGE_VERSION:-$(node -p "require('${ROOT_DIR}/apps/desktop/package.json').version")}"
OUTPUT_PATH="${APPIMAGE_DIR}/VOCO-${APPIMAGE_VERSION}-x86_64.AppImage"
APPIMAGETOOL_PATH="${ROOT_DIR}/.tmp/appimagetool-x86_64.AppImage"

if [[ ! -d "${APPDIR_PATH}" ]]; then
  echo "VOCO AppDir not found at ${APPDIR_PATH}" >&2
  exit 1
fi

mkdir -p "${ROOT_DIR}/.tmp"

if [[ ! -x "${APPIMAGETOOL_PATH}" ]]; then
  wget -q \
    https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage \
    -O "${APPIMAGETOOL_PATH}"
  chmod +x "${APPIMAGETOOL_PATH}"
fi

# appimagetool resolves the icon from the desktop file's Icon= entry, which Tauri
# currently emits as `voco` while the generated file is `VOCO.png`.
if [[ -f "${APPDIR_PATH}/VOCO.png" && ! -e "${APPDIR_PATH}/voco.png" ]]; then
  cp "${APPDIR_PATH}/VOCO.png" "${APPDIR_PATH}/voco.png"
fi

if [[ -f "${APPDIR_PATH}/.DirIcon" && ! -e "${APPDIR_PATH}/voco.png" ]]; then
  cp "${APPDIR_PATH}/.DirIcon" "${APPDIR_PATH}/voco.png"
fi

(
  cd "${APPIMAGE_DIR}"
  APPIMAGE_EXTRACT_AND_RUN=1 ARCH=x86_64 "${APPIMAGETOOL_PATH}" "VOCO.AppDir" "$(basename "${OUTPUT_PATH}")"
)

echo "${OUTPUT_PATH}"
