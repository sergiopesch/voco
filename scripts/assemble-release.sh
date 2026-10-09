#!/usr/bin/env bash
# Build, verify and sign one VOCO release on the maintainer's Linux computer.
#
# Hosted CI tests a release build of every master commit, but it never packages
# the NVIDIA runtime or holds the signing key. This script packages the commit of
# a signed voco.<version> tag once CI has passed for it on master, as a Debian
# package and a Fedora RPM built from the same staged tree, verifies both,
# writes the release records and checksum manifests, and signs the manifests.
# It uploads nothing; it ends by printing the publishing commands.
#
# Usage: bash scripts/assemble-release.sh OUTPUT_DIR
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
REPOSITORY="sergiopesch/voco"
FINGERPRINT="B33C7C6AAEC8C20433A7A837540796453D8E3865"
TAURI_CLI_VERSION="2.12.1"

fail() {
  echo "assemble-release: $*" >&2
  exit 1
}

step() {
  printf '\n==> %s\n' "$*"
}

[[ $# -eq 1 ]] || { echo "Usage: $0 OUTPUT_DIR" >&2; exit 2; }
[[ "$(uname -s)/$(uname -m)" == Linux/x86_64 ]] || fail "Releases are assembled on x86-64 Linux."
for command in git gpg gpgv node npm cargo python3 dpkg dpkg-deb sha256sum base64 realpath readelf \
  desktop-file-validate appstreamcli rpm rpmbuild rpm2cpio cpio; do
  command -v "${command}" >/dev/null 2>&1 || fail "Missing required command: ${command}"
done

cd "${ROOT_DIR}"
umask 022
OUT="$(realpath -m -- "$1")"
case "${OUT}/" in
  "${ROOT_DIR}/"*) fail "Choose an output directory outside the repository." ;;
esac
[[ ! -e "${OUT}" ]] || fail "${OUT} already exists; choose a fresh directory."
[[ -d "$(dirname -- "${OUT}")" ]] || fail "The parent directory of ${OUT} does not exist."

VERSION="$(node -p "require('./package.json').version")"
TAG="voco.${VERSION}"
COMMIT="$(git rev-parse HEAD)"
DEB="voco_${VERSION}_amd64.deb"
RPM="voco-${VERSION}-1.x86_64.rpm"

step "Checking ${TAG} at ${COMMIT}"
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] \
  || fail "Commit or remove local changes first; the release must match ${TAG} exactly."
tag_commit="$(git rev-parse -q --verify "refs/tags/${TAG}^{commit}")" \
  || fail "Create the signed tag first: git tag -s ${TAG} -m \"VOCO ${VERSION}\""
[[ "${tag_commit}" == "${COMMIT}" ]] || fail "${TAG} points at ${tag_commit}, not the checked-out ${COMMIT}."
[[ "$(git cat-file -t "refs/tags/${TAG}")" == tag ]] || fail "${TAG} must be an annotated, signed tag."
tag_status="$(git verify-tag --raw "${TAG}" 2>&1)" || fail "${TAG} does not carry a good signature."
awk -v key="${FINGERPRINT}" '$1 == "[GNUPG:]" && $2 == "VALIDSIG" && ($3 == key || $NF == key) { found = 1 }
  END { exit !found }' <<<"${tag_status}" || fail "${TAG} is not signed by the release key ${FINGERPRINT}."
fingerprints="$(gpg --batch --show-keys --with-colons KEYS | awk -F: '$1 == "fpr" { print $10 }')"
[[ "${fingerprints}" == "${FINGERPRINT}" ]] || fail "KEYS must hold exactly the release key ${FINGERPRINT}."
gpg --batch --list-secret-keys "${FINGERPRINT}" >/dev/null 2>&1 \
  || fail "The release key's secret key is not in this keyring."
npm run --silent verify:versions
grep -Fxq "VOCO_RELEASE_KEY_FINGERPRINT='${FINGERPRINT}'" install || fail "install does not pin the release key."
[[ -f "docs/releases/${VERSION}.md" ]] || fail "Write docs/releases/${VERSION}.md first."
for runtime in runtime/speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf runtime/speech/lib \
  runtime/speech/libbench_nemo_pool.so; do
  [[ -e "${runtime}" ]] || fail "The speech runtime is missing ${runtime}. Run: bash scripts/provision-ci-speech.sh"
done
[[ "$(cargo tauri --version 2>/dev/null)" == "tauri-cli ${TAURI_CLI_VERSION}" ]] \
  || fail "Install the pinned Tauri CLI: cargo install tauri-cli --version ${TAURI_CLI_VERSION} --locked"

WORK="$(mktemp -d)"
STAGE="$(mktemp -d "$(dirname -- "${OUT}")/.voco-${VERSION}.XXXXXX")"
trap 'rm -rf -- "${WORK}" "${STAGE}"' EXIT
ASSETS="${STAGE}/assets"
mkdir "${ASSETS}"

step "Checking CI for ${COMMIT}"
# The public API needs no token. Only a completed, successful push run on master
# counts, and its Application job must have tested the release build.
python3 - "${REPOSITORY}" "${COMMIT}" "${WORK}/ci.json" <<'EOF_CI'
import json
import sys
import urllib.request
from pathlib import Path

repository, commit, output = sys.argv[1:]


def get(url):
    request = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "voco-assemble-release",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


runs = get(f"https://api.github.com/repos/{repository}/actions/workflows/ci.yml/runs"
           f"?head_sha={commit}&event=push&per_page=20")["workflow_runs"]
runs = [run for run in runs if run["head_sha"] == commit and run["head_branch"] == "master"]
if not runs:
    raise SystemExit(f"No CI run on master for {commit}. Merge to master and wait for CI.")
run = max(runs, key=lambda item: (item["run_number"], item["run_attempt"]))
if (run["status"], run["conclusion"]) != ("completed", "success"):
    raise SystemExit(f"CI for {commit} is {run['status']} ({run['conclusion']}): {run['html_url']}")
jobs = [{"name": job["name"], "conclusion": job["conclusion"]}
        for job in get(f"{run['jobs_url']}?per_page=100")["jobs"]]
if not any(job["name"] == "Application" for job in jobs) or any(
        job["conclusion"] != "success" for job in jobs):
    raise SystemExit(f"CI for {commit} did not pass every job, including Application: {run['html_url']}")
receipt = {"workflow": run["name"], "runId": run["id"], "attempt": run["run_attempt"],
           "event": run["event"], "branch": run["head_branch"], "headSha": commit,
           "conclusion": run["conclusion"], "url": run["html_url"], "jobs": jobs}
Path(output).write_text(json.dumps(receipt, indent=2) + "\n")
print(f"CI passed: {run['html_url']}")
EOF_CI

step "Building the application"
SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)"
export SOURCE_DATE_EPOCH
npm ci
TARGET_DIR="$(cargo metadata --manifest-path apps/desktop/src-tauri/Cargo.toml --format-version 1 --no-deps --locked \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["target_directory"])')"
rm -rf -- "${TARGET_DIR}/release/bundle/deb"
bash scripts/build-desktop.sh
shopt -s nullglob
base_packages=("${TARGET_DIR}/release/bundle/deb/"*"_${VERSION}_amd64.deb")
shopt -u nullglob
[[ "${#base_packages[@]}" -eq 1 ]] || fail "Expected one base package in ${TARGET_DIR}/release/bundle/deb."
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || fail "The build changed tracked files."

step "Packaging the speech runtime"
mv -- "${base_packages[0]}" "${WORK}/base.deb"
python3 scripts/package-nvidia.py "${WORK}/base.deb" "${ASSETS}/${DEB}" --rpm "${ASSETS}/${RPM}"
bash scripts/verify-deb-package.sh "${ASSETS}/${DEB}" "${VERSION}"
# With the .deb as its third argument, the RPM verifier also proves that both
# packages carry the same files and dependencies.
bash scripts/verify-rpm-package.sh "${ASSETS}/${RPM}" "${VERSION}" "${ASSETS}/${DEB}"
ln -- "${ASSETS}/${DEB}" "${ASSETS}/voco_latest_amd64.deb"
ln -- "${ASSETS}/${RPM}" "${ASSETS}/voco_latest_x86_64.rpm"

step "Running the packaged speech worker"
dpkg-deb -x "${ASSETS}/${DEB}" "${WORK}/package"
cp runtime/speech/test_worker_protocol.py "${WORK}/package/usr/lib/voco/speech/"
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 "${WORK}/package/usr/lib/voco/speech/test_worker_protocol.py" \
  --output-dir "${WORK}/worker"

step "Writing the source archive, companion and records"
git archive --format=tar.gz --prefix="voco-${VERSION}/" --output="${ASSETS}/voco_${VERSION}_source.tar.gz" "${TAG}"
python3 scripts/package-gnome-panel.py "${ASSETS}/voco-panel@voco.local.shell-extension.zip"
cp install KEYS "${ASSETS}/"
python3 - "${ASSETS}" "${WORK}" "${VERSION}" "${TAG}" "${COMMIT}" "${FINGERPRINT}" "${REPOSITORY}" <<'EOF_RECORDS'
import hashlib
import json
import platform
import subprocess
import sys
import time
from pathlib import Path

assets, work = Path(sys.argv[1]), Path(sys.argv[2])
version, tag, commit, fingerprint, repository = sys.argv[3:]
package = work / "package"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def output(*command):
    return subprocess.check_output(command, text=True).strip().splitlines()[0]


deb = assets / f"voco_{version}_amd64.deb"
rpm = assets / f"voco-{version}-1.x86_64.rpm"
common = {
    "version": version,
    "repository": f"https://github.com/{repository}",
    "releaseTag": tag,
    "releaseCommit": commit,
    "packageSha256": digest(deb),
    "rpmPackageSha256": digest(rpm),
    "publisherKeyFingerprint": fingerprint,
}
payload = ["usr/bin/voco", "usr/libexec/voco-browser-host", "usr/lib/udev/rules.d/70-voco-uinput.rules",
           "usr/lib/voco/speech/MANIFEST.json",
           "usr/share/gnome-shell/extensions/voco-panel@voco.local/extension.js",
           "usr/share/gnome-shell/extensions/voco-panel@voco.local/metadata.json"]
provenance = {
    **common,
    "sourceTree": output("git", "rev-parse", "HEAD^{tree}"),
    "sourceArchiveSha256": digest(assets / f"voco_{version}_source.tar.gz"),
    "installerSha256": digest(assets / "install"),
    "packageBytes": deb.stat().st_size,
    "rpmPackageBytes": rpm.stat().st_size,
    # Both packages carry these exact files; the RPM verifier checked that.
    "payloadSha256": {path: digest(package / path) for path in payload},
    "buildEnvironment": {
        "os": platform.freedesktop_os_release()["PRETTY_NAME"],
        "node": output("node", "--version"),
        "npm": output("npm", "--version"),
        "rust": output("rustc", "--version"),
        "tauriCli": output("cargo", "tauri", "--version"),
        "dpkg": output("dpkg-deb", "--version"),
        "rpmbuild": output("rpmbuild", "--version"),
    },
    "assembledOn": time.strftime("%Y-%m-%d", time.gmtime()),
}
worker = json.loads((work / "worker/worker-protocol-results.json").read_text())
if not worker or not all(check["passed"] for check in worker):
    raise SystemExit("The packaged speech worker failed its protocol checks")
validation = {
    **common,
    "hostedCI": json.loads((work / "ci.json").read_text()),
    "localChecks": {
        "signedTag": "passed",
        "versionConsistency": "passed",
        "packageVerifier": "passed",
        "rpmPackageVerifier": "passed",
        "packagedWorkerProtocol": {"outcome": "passed", "checks": len(worker)},
    },
    "limits": [
        "Hosted CI tested a release build of this commit with synthetic audio in private X11, "
        "Wayland, GNOME and Chromium sessions. The packaged executables were rebuilt from the "
        "same commit on the maintainer's computer, so they are not byte-identical to the ones CI ran.",
        "Physical microphones, default PipeWire setups, other desktops and compositors, and "
        "applications beyond the tested fields are not covered.",
        "The RPM was checked on the Ubuntu build computer with rpm and against the Debian package's "
        "files; installing it with dnf on Fedora is not part of this record.",
        "Installation from the published release happens after signing and is not part of this record.",
    ],
}
for name, record in (("provenance", provenance), ("validation", validation)):
    (assets / f"voco_{version}_{name}.json").write_text(json.dumps(record, indent=2) + "\n")
EOF_RECORDS

step "Writing and signing the checksum manifests"
(
  cd "${ASSETS}"
  sha256sum "${DEB}" > "voco_${VERSION}_debian_checksums.txt"
  sha256sum voco_latest_amd64.deb > voco_latest_checksums.txt
  sha256sum "${RPM}" > "voco_${VERSION}_rpm_checksums.txt"
  sha256sum voco_latest_x86_64.rpm > voco_latest_rpm_checksums.txt
  sha256sum "voco_${VERSION}_source.tar.gz" > "voco_${VERSION}_source_checksums.txt"
  sha256sum install KEYS voco-panel@voco.local.shell-extension.zip "${DEB}" voco_latest_amd64.deb \
    "${RPM}" voco_latest_x86_64.rpm \
    "voco_${VERSION}_source.tar.gz" "voco_${VERSION}_provenance.json" "voco_${VERSION}_validation.json" \
    "voco_${VERSION}_debian_checksums.txt" voco_latest_checksums.txt \
    "voco_${VERSION}_rpm_checksums.txt" voco_latest_rpm_checksums.txt "voco_${VERSION}_source_checksums.txt" \
    > "voco_${VERSION}_checksums.txt"
  cp "voco_${VERSION}_checksums.txt" voco_checksums.txt
)
MANIFESTS=("voco_${VERSION}_checksums.txt" voco_checksums.txt "voco_${VERSION}_debian_checksums.txt"
  voco_latest_checksums.txt "voco_${VERSION}_rpm_checksums.txt" voco_latest_rpm_checksums.txt
  "voco_${VERSION}_source_checksums.txt")
GPG_KEY_FINGERPRINT="${FINGERPRINT}" bash scripts/sign-release-checksums.sh "${MANIFESTS[@]/#/${ASSETS}/}"
for manifest in "${MANIFESTS[@]}"; do
  bash scripts/verify-release.sh --keys KEYS "${ASSETS}/${manifest}" >/dev/null \
    || fail "${manifest} did not verify against KEYS."
done
# Repeat the installer's own check, with the key embedded in install.
sed -n "s/^VOCO_RELEASE_KEY_BASE64='\([^']*\)'$/\1/p" install | base64 --decode > "${WORK}/installer-key.gpg"
installer_status="$(gpgv --status-fd 1 --keyring "${WORK}/installer-key.gpg" \
  "${ASSETS}/voco_checksums.txt.asc" "${ASSETS}/voco_checksums.txt" 2>/dev/null)" \
  || fail "The installer's embedded key does not verify voco_checksums.txt."
[[ "${installer_status}" == *"[GNUPG:] VALIDSIG ${FINGERPRINT} "* ]] \
  || fail "The installer would reject the signer of voco_checksums.txt."
bash scripts/render-release-body.sh "${VERSION}" "${TAG}" > "${STAGE}/release-notes.md"

[[ ! -e "${OUT}" ]] || fail "${OUT} appeared during assembly; the release is not moved there."
chmod 755 "${STAGE}"
mv -T -- "${STAGE}" "${OUT}"

cat <<EOF_NEXT

VOCO ${VERSION} is assembled and signed in ${OUT}. Nothing has been uploaded.
Package SHA-256: $(sha256sum "${OUT}/assets/${DEB}" | cut -d' ' -f1)
RPM SHA-256:     $(sha256sum "${OUT}/assets/${RPM}" | cut -d' ' -f1)

1. Try the package on this computer:
     sudo apt install ${OUT}/assets/${DEB}
   and the RPM on a Fedora 44 computer:
     sudo dnf install ./${RPM}
2. Push the tag and create a draft release:
     git push origin ${TAG}
     gh release create ${TAG} --draft --verify-tag --title "VOCO ${VERSION}" \\
       --notes-file ${OUT}/release-notes.md ${OUT}/assets/*
3. Check the draft's files and notes, then publish it.
EOF_NEXT
