"""Build and check VOCO's Fedora package from the staged Debian package tree.

`package-nvidia.py --rpm` stages one tree and builds both packages from it.
This module renders `packaging/rpm/voco.spec.in` for that tree, runs rpmbuild
on a copy of it, and holds the checks `verify-rpm-package.sh` runs: the
reviewed scriptlet, folder ownership, dependencies and payload parity.
"""
import hashlib
import os
from pathlib import Path
import posixpath
import re
import shutil
import stat
import subprocess
import sys
import textwrap

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "packaging/rpm/voco.spec.in"
POST_SCRIPT = ROOT / "packaging/rpm/post.sh"
RELEASE = "1"
ARCH = "x86_64"

# VOCO's own folders, listed recursively, so rpm removes them with the package.
OWNED_TREES = ("usr/lib/voco", "usr/share/voco", "usr/share/doc/voco",
               "usr/share/gnome-shell/extensions/voco-panel@voco.local")
# Shared folders that no VOCO dependency creates on Fedora 44. A folder may have
# several owners, so VOCO owns these too and removal leaves no empty folder.
SHARED_DIRECTORIES = ("etc/chromium", "etc/chromium/native-messaging-hosts", "etc/opt/chrome",
                      "etc/opt/chrome/native-messaging-hosts", "usr/share/gnome-shell",
                      "usr/share/gnome-shell/extensions")
# Folders that filesystem, systemd-udev, hicolor-icon-theme or ibus own on
# Fedora 44. VOCO never owns them.
SYSTEM_DIRECTORIES = (
    "etc", "etc/opt", "usr", "usr/bin", "usr/lib", "usr/libexec", "usr/lib/udev",
    "usr/lib/udev/rules.d", "usr/lib/modules-load.d", "usr/share", "usr/share/applications",
    "usr/share/doc", "usr/share/metainfo", "usr/share/ibus", "usr/share/ibus/component",
    "usr/share/icons", "usr/share/icons/hicolor",
    *(f"usr/share/icons/hicolor/{size}{apps}"
      for size in ("32x32", "128x128", "256x256@2") for apps in ("", "/apps")))
DOC_ROOT = "usr/share/doc/voco"
# License notices stay installed when documentation is skipped (tsflags=nodocs).
LICENSE_ENTRIES = ("copyright", "THIRD-PARTY-NOTICES.txt", "nvidia", "vendor")
# rpm expands macros and globs in file lists, so listed paths stay plain.
SAFE_PATH = re.compile(r"[A-Za-z0-9._@+/-]+")
SPEECH = "usr/lib/voco/speech"
APP_EXECUTABLES = ("usr/bin/voco", "usr/bin/voco-browser-host", "usr/libexec/voco-browser-host")

# Each Debian dependency (tauri.conf.json's, then the three Tauri adds itself)
# and the Fedora 44 package that provides the same files. voco.spec.in requires
# exactly these, in this order, as rpm reports them.
DEBIAN_TO_FEDORA = {
    "libc6 (>= 2.39)": "glibc >= 2.39", "libstdc++6 (>= 13.2.0)": "libstdc++ >= 13.2",
    "libwebkit2gtk-4.1-0": "webkit2gtk4.1", "libgtk-3-0": "gtk3",
    "libayatana-appindicator3-1": "libayatana-appindicator-gtk3", "libpulse0": "pulseaudio-libs",
    "libnotify-bin": "libnotify", "ibus": "ibus", "gir1.2-ibus-1.0": "ibus-libs", "python3": "python3",
    "python3-gi": "python3-gobject", "python3-numpy": "python3-numpy",
    "python3-psutil": "python3-psutil", "libsentencepiece0": "sentencepiece-libs",
    "xclip": "xclip", "xdotool": "xdotool", "wl-clipboard": "wl-clipboard"}
TAURI_IMPLIED_DEPENDS = ("libwebkit2gtk-4.1-0", "libgtk-3-0", "libayatana-appindicator3-1")
FEDORA_REQUIRES = tuple(DEBIAN_TO_FEDORA.values())
# What the private speech runtime needs from the system, and the explicit
# requirement that brings it on Fedora (libstdc++ requires libgcc).
SPEECH_SYSTEM_LIBRARIES = {
    "libc.so.6": "glibc >= 2.39", "libm.so.6": "glibc >= 2.39",
    "ld-linux-x86-64.so.2": "glibc >= 2.39", "libstdc++.so.6": "libstdc++ >= 13.2",
    "libgcc_s.so.1": "libstdc++ >= 13.2", "libsentencepiece.so.0": "sentencepiece-libs"}
# The newest symbol versions Ubuntu 24.04's glibc 2.39 and GCC 13 runtime
# provide. A payload needing more would raise the declared floors.
SYMBOL_VERSION_CEILINGS = {"GLIBC": (2, 39), "GLIBCXX": (3, 4, 32), "CXXABI": (1, 3, 14)}
SCRIPTLETS = ("PRETRANS", "PREIN", "POSTIN", "PREUN", "POSTUN", "POSTTRANS", "VERIFYSCRIPT")
SCRIPTLET_SEPARATOR = "\n@VOCO-SCRIPTLET@\n"


def package_name(version, release=RELEASE):
    return f"voco-{version}-{release}.{ARCH}.rpm"


def validate_version(version):
    """rpm versions cannot hold a hyphen; the Debian +suffix is allowed."""
    if not re.fullmatch(r"[0-9][0-9A-Za-z.+~^]*", version):
        raise ValueError(f"Not a valid RPM version: {version}")
    return version


def _inside(relative, tree):
    return relative == tree or relative.startswith(tree + "/")


def _spec_path(relative):
    if not SAFE_PATH.fullmatch(relative) or "//" in relative or relative.endswith("/"):
        raise ValueError(f"Path cannot be listed in the RPM file list: /{relative}")
    return "/" + relative


def _entries(root):
    """Every path below root, without following links."""
    for parent, directories, files in os.walk(root):
        for name in sorted(directories + files):
            yield Path(parent) / name


def file_list(payload):
    """The %files lines for a staged payload. An unreviewed folder stops the build."""
    lines = []
    for path in _entries(payload):
        relative = path.relative_to(payload).as_posix()
        if relative.split("/")[0] == "DEBIAN" or any(_inside(relative, tree) for tree in OWNED_TREES):
            continue
        mode = path.lstat().st_mode
        if stat.S_ISDIR(mode):
            if relative in SHARED_DIRECTORIES:
                lines.append((relative, "%dir " + _spec_path(relative)))
            elif relative not in SYSTEM_DIRECTORIES:
                raise ValueError(f"Unreviewed folder in the payload: /{relative}")
        elif stat.S_ISREG(mode) or stat.S_ISLNK(mode):
            lines.append((relative, _spec_path(relative)))
        else:
            raise ValueError(f"Unsupported payload object: /{relative}")
    for tree in OWNED_TREES:
        root = payload / tree
        if root.is_symlink() or not root.is_dir():
            raise ValueError(f"The payload is missing VOCO's folder /{tree}")
        if tree != DOC_ROOT:
            lines.append((tree, _spec_path(tree)))
            continue
        lines.append((tree, "%dir " + _spec_path(tree)))
        children = sorted(child.name for child in root.iterdir())
        missing = sorted(set(LICENSE_ENTRIES) - set(children))
        if missing:
            raise ValueError(f"License notices are missing from /{tree}: {missing}")
        for name in children:
            directive = "%license" if name in LICENSE_ENTRIES else "%doc"
            lines.append((f"{tree}/{name}", f"{directive} {_spec_path(tree + '/' + name)}"))
    return [line for _, line in sorted(lines)]


def control_description(control):
    """Summary and description from the staged Debian control file."""
    fields, current = {}, None
    for line in control.read_text().splitlines():
        if line[:1] in (" ", "\t") and current:
            fields[current] += "\n" + line[1:]
        elif ":" in line:
            current, value = line.split(":", 1)
            fields[current] = value.strip()
    summary, _, body = fields["Description"].partition("\n")
    paragraphs = " ".join("\n" if line.strip() == "." else line.strip()
                          for line in body.splitlines()).split("\n")
    description = "\n\n".join(textwrap.fill(paragraph.strip(), 79) for paragraph in paragraphs
                              if paragraph.strip())
    if not summary or not description:
        raise ValueError("The staged control file has no description")
    return summary, description


def render_spec(payload, version, summary, description, release=RELEASE):
    post = POST_SCRIPT.read_text().rstrip("\n")
    if "%" in post:
        raise ValueError("The reviewed scriptlet must not contain rpm macros")
    values = {"VERSION": validate_version(version), "RELEASE": release,
              # A literal % would start a macro; the summary is one line.
              "SUMMARY": summary.replace("%", "%%").replace("\n", " "),
              "DESCRIPTION": description.replace("%", "%%"), "POST": post,
              "FILES": "\n".join(file_list(payload))}
    return re.sub(r"@(VERSION|RELEASE|SUMMARY|DESCRIPTION|POST|FILES)@",
                  lambda match: values[match[1]], TEMPLATE.read_text())


def build_rpm(stage, work, version, release=RELEASE):
    """Build the package from a copy of the staged tree; rpmbuild deletes its buildroot."""
    work.mkdir()
    buildroot = work / "buildroot"
    shutil.copytree(stage, buildroot, symlinks=True,
                    ignore=lambda directory, names: {"DEBIAN"} if Path(directory) == stage else set())
    summary, description = control_description(stage / "DEBIAN/control")
    spec = work / "voco.spec"
    spec.write_text(render_spec(buildroot, version, summary, description, release))
    output = work / "out"
    command = ["rpmbuild", "-bb", "--quiet", "--target", f"{ARCH}-linux", "--buildroot", str(buildroot)]
    for name in ("top", "build", "tmp"):
        (work / name).mkdir()
    for macro, value in (("_topdir", work / "top"), ("_builddir", work / "build"),
                         ("_tmppath", work / "tmp"), ("_rpmdir", output),
                         ("_build_name_fmt", "%%{NAME}-%%{VERSION}-%%{RELEASE}.%%{ARCH}.rpm")):
        command += ["--define", f"{macro} {value}"]
    # A personal ~/.rpmmacros or ~/.rpmrc must not change the package.
    subprocess.run(command + [str(spec)], check=True, env={**os.environ, "HOME": str(work)})
    built = output / package_name(version, release)
    produced = sorted(path for path in output.rglob("*") if path.is_file())
    if produced != [built]:
        raise ValueError(f"rpmbuild produced {produced}, not {built.name}")
    return built


def _query(package, query_format):
    return subprocess.run(["rpm", "-qp", "--qf", query_format, str(package)], check=True,
                          capture_output=True, text=True).stdout


def verify_scriptlets(package):
    """The package runs only the reviewed post-install scriptlet."""
    query = SCRIPTLET_SEPARATOR.join(f"%{{{tag}PROG}}\t%{{{tag}}}" for tag in SCRIPTLETS)
    actual = dict(zip(SCRIPTLETS, _query(package, query).split(SCRIPTLET_SEPARATOR)))
    expected = {tag: "(none)\t(none)" for tag in SCRIPTLETS}
    expected["POSTIN"] = "/bin/sh\t" + POST_SCRIPT.read_text().rstrip("\n")
    if actual != expected:
        changed = sorted(tag for tag in SCRIPTLETS if actual.get(tag) != expected[tag])
        raise ValueError(f"RPM scriptlets differ from packaging/rpm/post.sh: {changed}")
    for option in ("--triggers", "--filetriggers"):
        listed = subprocess.run(["rpm", "-qp", option, str(package)], check=True,
                                capture_output=True, text=True).stdout
        if listed.strip():
            raise ValueError(f"The RPM declares unreviewed {option.lstrip('-')}")
    # rpm 4.19 and later also know pre- and post-uninstall transaction scriptlets.
    scripts = subprocess.run(["rpm", "-qp", "--scripts", str(package)], check=True,
                             capture_output=True, text=True).stdout
    if scripts.count("scriptlet (using") != 1:
        raise ValueError("The RPM declares a scriptlet other than post-install")


def header_files(package):
    listing = _query(package, "[%{FILEMODES:perms}\t%{FILEUSERNAME}\t%{FILEGROUPNAME}"
                              "\t%{FILEFLAGS:fflags}\t%{FILENAMES}\n]")
    entries = {}
    for line in listing.splitlines():
        perms, user, group, flags, name = line.split("\t")
        entries[name] = (perms, user, group, flags)
    return entries


def verify_files(package):
    """Root-owned plain modes, the reviewed folder ownership and license marking."""
    entries = header_files(package)
    for name, (perms, user, group, flags) in entries.items():
        relative = name[1:]
        if (user, group) != ("root", "root"):
            raise ValueError(f"Not owned by root: {name}")
        if perms not in ("drwxr-xr-x", "-rw-r--r--", "-rwxr-xr-x", "lrwxrwxrwx"):
            raise ValueError(f"Unexpected mode {perms} for {name}")
        parent = posixpath.dirname(name)
        if parent[1:] not in SYSTEM_DIRECTORIES and parent not in entries:
            raise ValueError(f"Removal would leave the unowned folder {parent}")
        if perms.startswith("d"):
            if not (relative in SHARED_DIRECTORIES or any(_inside(relative, t) for t in OWNED_TREES)):
                raise ValueError(f"The RPM owns a folder it shares with the system: {name}")
            continue
        license_file = any(_inside(relative, f"{DOC_ROOT}/{entry}") for entry in LICENSE_ENTRIES)
        expected = "dl" if license_file else "d" if _inside(relative, DOC_ROOT) else ""
        if flags != expected:
            raise ValueError(f"Unexpected file flags {flags!r} for {name}; expected {expected!r}")
    for directory in SHARED_DIRECTORIES + OWNED_TREES:
        if entries.get("/" + directory, ("",))[0] != "drwxr-xr-x":
            raise ValueError(f"The RPM does not own /{directory}")
    return len(entries)


def _elf_dynamic(path):
    output = subprocess.run(["readelf", "-dW", str(path)], check=True, capture_output=True,
                            text=True).stdout
    needed = re.findall(r"\(NEEDED\)\s+Shared library: \[([^\]]+)\]", output)
    soname = re.findall(r"\(SONAME\)\s+Library soname: \[([^\]]+)\]", output)
    return needed, soname


def _is_elf(path):
    with path.open("rb") as stream:
        return stream.read(4) == b"\x7fELF"


def verify_requires(package, extracted):
    """Explicit Fedora requirements cover the private runtime; the app binaries
    keep their generated soname requirements; nothing private leaks out."""
    requires = set(subprocess.run(["rpm", "-qp", "--requires", str(package)], check=True,
                                  capture_output=True, text=True).stdout.splitlines())
    provides = subprocess.run(["rpm", "-qp", "--provides", str(package)], check=True,
                              capture_output=True, text=True).stdout.splitlines()
    missing = [name for name in FEDORA_REQUIRES if name not in requires]
    if missing:
        raise ValueError(f"The RPM is missing Fedora requirements: {missing}")
    if [line for line in provides if ".so" in line or "/usr/lib/voco" in line]:
        raise ValueError("The RPM provides private libraries to the system")
    speech = extracted / SPEECH
    elves = [path for path in _entries(speech) if path.is_file() and not path.is_symlink()
             and _is_elf(path)]
    dynamic = {path: _elf_dynamic(path) for path in elves}
    private = {path.name for path in _entries(speech)}
    for _, soname in dynamic.values():
        private.update(soname)
    for requirement in requires:
        if requirement.split("(")[0] in private or "/usr/lib/voco" in requirement:
            raise ValueError(f"The RPM requires a private library: {requirement}")
    for path, (needed, _) in dynamic.items():
        for library in needed:
            if library not in private and SPEECH_SYSTEM_LIBRARIES.get(library) not in requires:
                raise ValueError(f"No reviewed requirement provides {library} for {path.name}")
    for relative in APP_EXECUTABLES:
        for library in _elf_dynamic(extracted / relative)[0]:
            if f"{library}()(64bit)" not in requires:
                raise ValueError(f"The RPM lost the generated requirement for {library}")
    for path in elves + [extracted / relative for relative in APP_EXECUTABLES]:
        versions = subprocess.run(["readelf", "-VW", str(path)], check=True, capture_output=True,
                                  text=True).stdout
        for family, number in re.findall(r"Name: (GLIBC|GLIBCXX|CXXABI)_([0-9.]+)", versions):
            if tuple(map(int, number.split("."))) > SYMBOL_VERSION_CEILINGS[family]:
                raise ValueError(f"{path.name} needs {family}_{number}, above the declared floors")
    return len(requires)


def _digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def payload_inventory(root):
    """Every file and link with its mode, digest or target; folders are implied."""
    inventory = {}
    for path in _entries(root):
        relative = path.relative_to(root).as_posix()
        info = path.lstat()
        if relative.split("/")[0] == "DEBIAN" or stat.S_ISDIR(info.st_mode):
            continue
        if stat.S_ISLNK(info.st_mode):
            inventory[relative] = ("link", os.readlink(path))
        else:
            inventory[relative] = ("file", oct(stat.S_IMODE(info.st_mode)), _digest(path))
    return inventory


def verify_same_payload(deb_root, rpm_root):
    """The Debian and Fedora packages carry the same staged files."""
    deb, rpm = payload_inventory(deb_root), payload_inventory(rpm_root)
    if deb != rpm:
        differing = sorted(name for name in deb.keys() | rpm.keys() if deb.get(name) != rpm.get(name))
        raise ValueError(f"The RPM and Debian payloads differ: {differing[:10]}")
    return len(rpm)


def verify_same_dependencies(depends, requires):
    """Every dependency of the Debian package is required under its Fedora name."""
    declared = [item.strip() for item in depends.split(",") if item.strip()]
    unmapped = [item for item in declared if item not in DEBIAN_TO_FEDORA]
    if unmapped:
        raise ValueError(f"Debian dependencies without a reviewed Fedora name: {unmapped}")
    missing = [DEBIAN_TO_FEDORA[item] for item in declared if DEBIAN_TO_FEDORA[item] not in requires]
    if missing:
        raise ValueError(f"The RPM lacks the Fedora names of Debian dependencies: {missing}")
    return len(declared)


def _lines(*command):
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout.splitlines()


if __name__ == "__main__":
    action, *arguments = sys.argv[1:]
    if action == "verify-package" and len(arguments) == 2:
        package, extracted = Path(arguments[0]), Path(arguments[1])
        verify_scriptlets(package)
        print(f"{verify_files(package)} packaged paths and {verify_requires(package, extracted)} "
              "requirements match the reviewed RPM policy.")
    elif action == "same-package" and len(arguments) == 4:
        deb, rpm, deb_root, rpm_root = map(Path, arguments)
        dependencies = verify_same_dependencies(
            "\n".join(_lines("dpkg-deb", "-f", str(deb), "Depends")), set(_lines("rpm", "-qp", "--requires", str(rpm))))
        print(f"{verify_same_payload(deb_root, rpm_root)} files and links and {dependencies} "
              "dependencies match in both packages.")
    else:
        raise SystemExit("usage: rpm_package.py verify-package PACKAGE.rpm EXTRACTED_ROOT | "
                         "same-package PACKAGE.deb PACKAGE.rpm DEB_ROOT RPM_ROOT")
