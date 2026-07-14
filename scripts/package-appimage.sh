#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPIMAGE_DIR="${ROOT_DIR}/apps/desktop/src-tauri/target/release/bundle/appimage"
APPDIR_PATH="${APPIMAGE_DIR}/VOCO.AppDir"
APPIMAGE_VERSION="${VOCO_APPIMAGE_VERSION:-$(node -p "require('${ROOT_DIR}/apps/desktop/package.json').version")}"
OUTPUT_PATH="${APPIMAGE_DIR}/VOCO-${APPIMAGE_VERSION}-x86_64.AppImage"
APPIMAGETOOL_PATH="${VOCO_APPIMAGETOOL_PATH:-}"
APPIMAGETOOL_SHA256="${VOCO_APPIMAGETOOL_SHA256:-}"

if [[ ! -d "${APPDIR_PATH}" ]]; then
  echo "VOCO AppDir not found at ${APPDIR_PATH}" >&2
  exit 1
fi

if [[ -z "${APPIMAGETOOL_PATH}" || -z "${APPIMAGETOOL_SHA256}" ]]; then
  echo "Set VOCO_APPIMAGETOOL_PATH and VOCO_APPIMAGETOOL_SHA256 to a pinned appimagetool binary." >&2
  exit 1
fi
if [[ ! -x "${APPIMAGETOOL_PATH}" ]]; then
  echo "Pinned appimagetool is not executable: ${APPIMAGETOOL_PATH}" >&2
  exit 1
fi
if [[ ! "${APPIMAGETOOL_SHA256}" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "VOCO_APPIMAGETOOL_SHA256 must be a 64-character SHA-256 digest." >&2
  exit 1
fi
ACTUAL_APPIMAGETOOL_SHA256="$(sha256sum "${APPIMAGETOOL_PATH}" | awk '{print $1}')"
if [[ "${ACTUAL_APPIMAGETOOL_SHA256,,}" != "${APPIMAGETOOL_SHA256,,}" ]]; then
  echo "Pinned appimagetool checksum mismatch." >&2
  exit 1
fi

# appimagetool resolves the icon from the desktop file's Icon= entry, which Tauri
# currently emits as `voco` while the generated file is `VOCO.png`.
if [[ -f "${APPDIR_PATH}/VOCO.png" && ! -e "${APPDIR_PATH}/voco.png" ]]; then
  cp "${APPDIR_PATH}/VOCO.png" "${APPDIR_PATH}/voco.png"
fi

if [[ -f "${APPDIR_PATH}/.DirIcon" && ! -e "${APPDIR_PATH}/voco.png" ]]; then
  cp "${APPDIR_PATH}/.DirIcon" "${APPDIR_PATH}/voco.png"
fi

# Keep the AppDir's installed metadata aligned with the canonical application ID.
rm -f "${APPDIR_PATH}/usr/share/metainfo/VOCO.appdata.xml"
rm -f "${APPDIR_PATH}/usr/share/metainfo/com.sergiopesch.voco.metainfo.xml"
install -Dm644 \
  "${ROOT_DIR}/packaging/flatpak/com.sergiopesch.voco.metainfo.xml" \
  "${APPDIR_PATH}/usr/share/metainfo/com.sergiopesch.voco.appdata.xml"
if [[ -f "${APPDIR_PATH}/usr/share/applications/VOCO.desktop" ]]; then
  install -Dm644 \
    "${APPDIR_PATH}/usr/share/applications/VOCO.desktop" \
    "${APPDIR_PATH}/usr/share/applications/com.sergiopesch.voco.desktop"
fi
rm -f \
  "${APPDIR_PATH}/VOCO.desktop" \
  "${APPDIR_PATH}/com.sergiopesch.voco.desktop" \
  "${APPDIR_PATH}/usr/share/applications/VOCO.desktop"
ln -s \
  "usr/share/applications/com.sergiopesch.voco.desktop" \
  "${APPDIR_PATH}/com.sergiopesch.voco.desktop"

(
  cd "${APPIMAGE_DIR}"
  APPIMAGE_EXTRACT_AND_RUN=1 ARCH=x86_64 "${APPIMAGETOOL_PATH}" "VOCO.AppDir" "$(basename "${OUTPUT_PATH}")"
)

echo "${OUTPUT_PATH}"
