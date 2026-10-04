#!/usr/bin/env bash

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
  local -a install_command=(sudo apt-get install -y --)
  if declare -F voco_run_apt >/dev/null; then install_command=(voco_run_apt); fi
  if ! "${install_command[@]}" "${packages[@]}"; then
    VOCO_INSTALL_ERROR="APT could not install VOCO and its desktop dependencies. Resolve the error above, then run the installer again."
    return 1
  fi
  voco_verify_installed_package "${expected_version}" "${expected_architecture}"
}

voco_detect_package_manager() {
  # Ubuntu and Debian install the .deb with APT, Fedora the RPM with DNF. A
  # system with both tools keeps APT, as before.
  VOCO_PACKAGE_MANAGER=""
  if command -v apt-get >/dev/null 2>&1 && command -v dpkg-query >/dev/null 2>&1; then
    VOCO_PACKAGE_MANAGER="apt"
  elif command -v dnf >/dev/null 2>&1 && command -v rpm >/dev/null 2>&1; then
    VOCO_PACKAGE_MANAGER="dnf"
  else
    return 1
  fi
}

voco_verify_installed_rpm() {
  local expected_version="$1"
  local expected_architecture="$2"
  local package_record
  local installed_version
  local installed_architecture
  local unexpected_field

  VOCO_INSTALL_ERROR=""
  # rpm records only completed installations; expected_version is VERSION-RELEASE.
  if ! package_record="$(LC_ALL=C rpm -q --queryformat '%{VERSION}-%{RELEASE}\t%{ARCH}\n' voco 2>/dev/null)"; then
    VOCO_INSTALL_ERROR="Package 'voco' is not installed after the package operation."
    return 1
  fi
  if [[ "${package_record}" == *$'\n'* ]]; then
    VOCO_INSTALL_ERROR="More than one VOCO package is installed. Remove the extra ones with DNF, then run the installer again."
    return 1
  fi

  IFS=$'\t' read -r installed_version installed_architecture unexpected_field <<< "${package_record}"
  if [[ -n "${unexpected_field}" || -z "${installed_version}" || -z "${installed_architecture}" ]]; then
    VOCO_INSTALL_ERROR="Package manager returned an incomplete VOCO installation record."
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

voco_install_rpm_package() {
  local rpm_file="$1"
  local expected_version="$2"
  local expected_architecture="$3"

  VOCO_INSTALL_ERROR=""
  rpm_file="$(realpath -- "${rpm_file}")" || return 1
  local -a install_command=(sudo dnf install -y --)
  if declare -F voco_run_dnf >/dev/null; then install_command=(voco_run_dnf); fi
  if ! "${install_command[@]}" "${rpm_file}"; then
    VOCO_INSTALL_ERROR="DNF could not install VOCO and its desktop dependencies. Resolve the error above, then run the installer again."
    return 1
  fi
  voco_verify_installed_rpm "${expected_version}" "${expected_architecture}"
}

voco_verify_desktop_input() {
  VOCO_INPUT_ERROR=""
  if ! VOCO_INPUT_ERROR="$(/usr/bin/voco --check-desktop-input 2>&1)"; then
    return 1
  fi
}
