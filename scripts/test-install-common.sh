#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/install-common.sh"

fail() {
  printf 'Installer helper test failed: %s\n' "$*" >&2
  exit 1
}

TEST_ROOT="$(mktemp -d)"
cleanup() {
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

MOCK_BIN="${TEST_ROOT}/mock-package-bin"
MOCK_PACKAGE_STATE="${TEST_ROOT}/mock-voco-package-state"
MOCK_PACKAGE_LOG="${TEST_ROOT}/mock-package.log"
MOCK_DEB="${TEST_ROOT}/voco-test.deb"
ORIGINAL_PATH="${PATH}"
mkdir -p "${MOCK_BIN}"
: > "${MOCK_DEB}"

cat > "${MOCK_BIN}/sudo" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'sudo\t%s\n' "$*" >> "${MOCK_PACKAGE_LOG:?}"
exec "$@"
SH

# The installer never runs dpkg itself; this only records an attempt.
cat > "${MOCK_BIN}/dpkg" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'dpkg\t%s\n' "$*" >> "${MOCK_PACKAGE_LOG:?}"
exit 64
SH

cat > "${MOCK_BIN}/apt-get" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'apt-get\t%s\n' "$*" >> "${MOCK_PACKAGE_LOG:?}"
if [[ "${MOCK_APT_EXIT:-0}" != "0" ]]; then
  exit "${MOCK_APT_EXIT}"
fi
case "${MOCK_APT_OUTCOME:-installed}" in
  installed)
    printf 'install ok installed\t%s\t%s\n' \
      "${MOCK_EXPECTED_VERSION:?}" "${MOCK_EXPECTED_ARCHITECTURE:?}" > "${MOCK_PACKAGE_STATE:?}"
    ;;
  removed)
    rm -f -- "${MOCK_PACKAGE_STATE:?}"
    ;;
  wrong-version)
    printf 'install ok installed\t2026.0.20\t%s\n' \
      "${MOCK_EXPECTED_ARCHITECTURE:?}" > "${MOCK_PACKAGE_STATE:?}"
    ;;
  wrong-architecture)
    printf 'install ok installed\t%s\tarm64\n' \
      "${MOCK_EXPECTED_VERSION:?}" > "${MOCK_PACKAGE_STATE:?}"
    ;;
  unpacked)
    printf 'install ok unpacked\t%s\t%s\n' \
      "${MOCK_EXPECTED_VERSION:?}" "${MOCK_EXPECTED_ARCHITECTURE:?}" > "${MOCK_PACKAGE_STATE:?}"
    ;;
  *)
    exit 65
    ;;
esac
SH

cat > "${MOCK_BIN}/dpkg-query" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'dpkg-query\t%s\n' "$*" >> "${MOCK_PACKAGE_LOG:?}"
[[ -f "${MOCK_PACKAGE_STATE:?}" ]] || exit 1
cat -- "${MOCK_PACKAGE_STATE}"
SH

chmod 0700 "${MOCK_BIN}/sudo" "${MOCK_BIN}/dpkg" "${MOCK_BIN}/apt-get" "${MOCK_BIN}/dpkg-query"
export PATH="${MOCK_BIN}:${ORIGINAL_PATH}"
export MOCK_PACKAGE_STATE MOCK_PACKAGE_LOG
export MOCK_EXPECTED_VERSION="2026.0.21"
export MOCK_EXPECTED_ARCHITECTURE="amd64"

reset_mock_package_case() {
  rm -f -- "${MOCK_PACKAGE_STATE}" "${MOCK_PACKAGE_LOG}"
  export MOCK_APT_EXIT=0
  export MOCK_APT_OUTCOME=installed
}

# APT receives only the local package, in both sessions: VOCO pastes through its
# own virtual keyboard, so no session needs an extra input package.
for session in x11 wayland; do
  reset_mock_package_case
  export XDG_SESSION_TYPE="$session"
  voco_install_deb_package "${MOCK_DEB}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}" ||
    fail "APT install was rejected: ${VOCO_INSTALL_ERROR}"
  grep -Eq "install -y -- ${MOCK_DEB}\$" "${MOCK_PACKAGE_LOG}" ||
    fail "installer did not ask APT to resolve exactly the local package"
  if grep -q '^dpkg\s' "${MOCK_PACKAGE_LOG}"; then
    fail "installer bypassed APT dependency resolution"
  fi
done

for outcome in removed wrong-version wrong-architecture unpacked; do
  reset_mock_package_case
  export MOCK_APT_OUTCOME="$outcome"
  if voco_install_deb_package "${MOCK_DEB}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}"; then
    fail "APT result $outcome was incorrectly accepted"
  fi
  [[ -n "$VOCO_INSTALL_ERROR" ]] || fail "Missing package verification error"
done
reset_mock_package_case
export MOCK_APT_EXIT=100
if voco_install_deb_package "${MOCK_DEB}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}"; then
  fail "Failed APT installation was accepted"
fi
[[ "$VOCO_INSTALL_ERROR" == *APT* ]] || fail "APT failure returned an unclear error"
cat > "${MOCK_BIN}/voco" <<'SH'
#!/usr/bin/env bash
[[ "$*" == --check-desktop-input ]] || exit 64
if [[ "${MOCK_INPUT_READY}" != true ]]; then echo "VOCO can't open /dev/uinput. Sign out and back in once." >&2; exit 1; fi
echo "Desktop input is ready."
SH
chmod 0700 "${MOCK_BIN}/voco"
# Shadow only the packaged command; a PATH-installed legacy VOCO must never run.
/usr/bin/voco() { "${MOCK_BIN}/voco" "$@"; }
voco() { fail "Readiness used a PATH VOCO instead of the verified package"; }
export MOCK_INPUT_READY=false
if voco_verify_desktop_input; then fail "Installer accepted incomplete desktop setup"; fi
[[ "$VOCO_INPUT_ERROR" == *'/dev/uinput'* ]] || fail "Lost the actionable input error"
export MOCK_INPUT_READY=true
voco_verify_desktop_input || fail "Installer rejected ready desktop input"

# Fedora: DNF installs the local RPM; rpm reports what is installed.
MOCK_RPM="${TEST_ROOT}/voco-test.rpm"
: > "${MOCK_RPM}"
cat > "${MOCK_BIN}/dnf" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'dnf\t%s\n' "$*" >> "${MOCK_PACKAGE_LOG:?}"
if [[ "${MOCK_DNF_EXIT:-0}" != "0" ]]; then
  exit "${MOCK_DNF_EXIT}"
fi
case "${MOCK_DNF_OUTCOME:-installed}" in
  installed) printf '%s\t%s\n' "${MOCK_EXPECTED_VERSION:?}" "${MOCK_EXPECTED_ARCHITECTURE:?}" > "${MOCK_PACKAGE_STATE:?}" ;;
  removed) rm -f -- "${MOCK_PACKAGE_STATE:?}" ;;
  wrong-version) printf '2026.0.20-1\t%s\n' "${MOCK_EXPECTED_ARCHITECTURE:?}" > "${MOCK_PACKAGE_STATE:?}" ;;
  wrong-architecture) printf '%s\taarch64\n' "${MOCK_EXPECTED_VERSION:?}" > "${MOCK_PACKAGE_STATE:?}" ;;
  two-installed)
    printf '%s\t%s\n2026.0.20-1\t%s\n' "${MOCK_EXPECTED_VERSION:?}" "${MOCK_EXPECTED_ARCHITECTURE:?}" \
      "${MOCK_EXPECTED_ARCHITECTURE:?}" > "${MOCK_PACKAGE_STATE:?}"
    ;;
  *) exit 65 ;;
esac
SH
cat > "${MOCK_BIN}/rpm" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'rpm\t%s\n' "$*" >> "${MOCK_PACKAGE_LOG:?}"
# The installer must ask for VERSION-RELEASE and the architecture of voco only.
[[ "$*" == "-q --queryformat %{VERSION}-%{RELEASE}\t%{ARCH}\n voco" ]] || exit 64
if [[ ! -f "${MOCK_PACKAGE_STATE:?}" ]]; then
  echo "package voco is not installed"
  exit 1
fi
cat -- "${MOCK_PACKAGE_STATE}"
SH
chmod 0700 "${MOCK_BIN}/dnf" "${MOCK_BIN}/rpm"
export MOCK_EXPECTED_VERSION="2026.0.21-1"
export MOCK_EXPECTED_ARCHITECTURE="x86_64"

reset_mock_rpm_case() {
  rm -f -- "${MOCK_PACKAGE_STATE}" "${MOCK_PACKAGE_LOG}"
  export MOCK_DNF_EXIT=0
  export MOCK_DNF_OUTCOME=installed
}

reset_mock_rpm_case
voco_install_rpm_package "${MOCK_RPM}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}" ||
  fail "DNF install was rejected: ${VOCO_INSTALL_ERROR}"
grep -Fxq $'dnf\tinstall -y -- '"${MOCK_RPM}" "${MOCK_PACKAGE_LOG}" ||
  fail "installer did not ask DNF to resolve exactly the local RPM"
if grep -Eq $'^rpm\t(-i|-U|--install|--upgrade)' "${MOCK_PACKAGE_LOG}"; then
  fail "installer bypassed DNF dependency resolution"
fi
for outcome in removed wrong-version wrong-architecture two-installed; do
  reset_mock_rpm_case
  export MOCK_DNF_OUTCOME="$outcome"
  if voco_install_rpm_package "${MOCK_RPM}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}"; then
    fail "DNF result $outcome was incorrectly accepted"
  fi
  [[ -n "$VOCO_INSTALL_ERROR" ]] || fail "Missing RPM verification error"
done
reset_mock_rpm_case
export MOCK_DNF_EXIT=1
if voco_install_rpm_package "${MOCK_RPM}" "${MOCK_EXPECTED_VERSION}" "${MOCK_EXPECTED_ARCHITECTURE}"; then
  fail "Failed DNF installation was accepted"
fi
[[ "$VOCO_INSTALL_ERROR" == *DNF* ]] || fail "DNF failure returned an unclear error"

# The package manager decides the format; APT wins where both exist.
DETECT_BIN="${TEST_ROOT}/detect-bin"
mkdir -p "${DETECT_BIN}"
detect_with() {
  rm -f -- "${DETECT_BIN}"/*
  local tool
  for tool in "$@"; do ln -s "${MOCK_BIN}/sudo" "${DETECT_BIN}/${tool}"; done
  hash -r
  PATH="${DETECT_BIN}" voco_detect_package_manager
}
detect_with apt-get dpkg-query && [[ "${VOCO_PACKAGE_MANAGER}" == apt ]] || fail "APT system not detected"
detect_with dnf rpm && [[ "${VOCO_PACKAGE_MANAGER}" == dnf ]] || fail "DNF system not detected"
detect_with apt-get dpkg-query dnf rpm && [[ "${VOCO_PACKAGE_MANAGER}" == apt ]] ||
  fail "A system with both package managers must keep APT"
for tools in "" "apt-get" "dnf" "dpkg-query rpm"; do
  if detect_with ${tools}; then fail "Incomplete package tools '${tools}' were accepted"; fi
  [[ -z "${VOCO_PACKAGE_MANAGER}" ]] || fail "Detection left a package manager for '${tools}'"
done
export PATH="${ORIGINAL_PATH}"

# Platform floors refuse only a glibc version or processor flag list that was
# read and falls short; anything unreadable is left to the package manager.
PLATFORM_BIN="${TEST_ROOT}/platform-bin"
mkdir -p "${PLATFORM_BIN}"
cat > "${PLATFORM_BIN}/getconf" <<'SH'
#!/usr/bin/env bash
[[ "$*" == GNU_LIBC_VERSION && -n "${MOCK_GLIBC}" ]] || exit 1
printf '%s\n' "${MOCK_GLIBC}"
SH
chmod 0700 "${PLATFORM_BIN}/getconf"
printf 'processor\t: 0\nflags\t\t: fpu sse2 avx avx2 fma f16c bmi2\n\nprocessor\t: 1\nflags\t\t: fpu sse2 avx avx2 fma f16c bmi2\n' \
  > "${TEST_ROOT}/cpuinfo"
printf 'flags\t\t: fpu sse2 avx avx2 fma4 f16c\n' > "${TEST_ROOT}/cpuinfo-fma4"
printf 'flags\t\t: fpu sse2 avx fma\n' > "${TEST_ROOT}/cpuinfo-old"
printf 'processor\t: 0\n' > "${TEST_ROOT}/cpuinfo-no-flags"
platform_floors() {
  hash -r
  MOCK_GLIBC="$1" PATH="${PLATFORM_BIN}:${ORIGINAL_PATH}" voco_check_platform_floors "${2:-${TEST_ROOT}/cpuinfo}"
}
for glibc in 'glibc 2.39' 'glibc 2.43' 'glibc 2.43.9000' 'glibc 3.0' '' 'musl libc' 'glibc stable'; do
  platform_floors "${glibc}" || fail "Platform check refused '${glibc}': ${VOCO_PLATFORM_ERROR}"
done
if platform_floors 'glibc 2.36'; then fail "glibc 2.36 was accepted"; fi
[[ "${VOCO_PLATFORM_ERROR}" == *'glibc 2.39 or later'*'glibc 2.36.' ]] || fail "Old glibc returned an unclear error"
if platform_floors 'glibc 2.39' "${TEST_ROOT}/cpuinfo-fma4"; then fail "FMA4 was taken for FMA"; fi
[[ "${VOCO_PLATFORM_ERROR}" == *'lacks FMA.'* ]] || fail "Missing FMA returned an unclear error"
if platform_floors 'glibc 2.39' "${TEST_ROOT}/cpuinfo-old"; then fail "A processor without AVX2 or F16C was accepted"; fi
[[ "${VOCO_PLATFORM_ERROR}" == *'lacks AVX2, F16C.'* ]] || fail "Missing flags were not all named"
for cpuinfo in "${TEST_ROOT}/missing-cpuinfo" "${TEST_ROOT}/cpuinfo-no-flags"; do
  platform_floors 'glibc 2.39' "${cpuinfo}" || fail "Unreadable processor flags blocked the install"
done
echo "Installer helper behavior is valid."
