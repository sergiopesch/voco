#!/usr/bin/env python3
"""Build pinned NeMo/GGML CPU libraries in fresh directories; weights are separate.

Ubuntu 24.04 dependencies: git cmake build-essential libsentencepiece-dev binutils.
Use --source with an existing pinned upstream Git checkout for offline builds.
Failed build directories are retained for diagnosis. Use an isolated build environment.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PIN = ROOT / 'runtime/NATIVE-SOURCE.json'
REAL_LIBRARIES = ('libggml.so.0.12.0', 'libggml-base.so.0.12.0',
                  'libggml-cpu.so.0.12.0', 'libnemo_speech_asr.so',
                  'libnemo_speech_asr_c.so.1')
LINKS = {'libnemo_speech_asr_c.so': 'libnemo_speech_asr_c.so.1'}
for _name in ('ggml', 'ggml-base', 'ggml-cpu'):
    LINKS[f'lib{_name}.so'] = f'lib{_name}.so.0'
    LINKS[f'lib{_name}.so.0'] = f'lib{_name}.so.0.12.0'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(*args, cwd=None):
    subprocess.run([str(a) for a in args], cwd=cwd, check=True)


def output(*args, cwd=None):
    return subprocess.check_output([str(a) for a in args], cwd=cwd, text=True).strip()


def fresh(path):
    if path.exists() or path.is_symlink():
        raise ValueError(f'Refusing existing directory: {path}')


def checkout(pin, destination, local=None):
    # Fetching exact objects copies only committed source, never local dirty files.
    run('git', 'init', '--quiet', destination)
    run('git', '-C', destination, 'fetch', '--quiet', '--depth=1',
        local or pin['url'], pin['commit'])
    run('git', '-C', destination, 'checkout', '--quiet', '--detach', 'FETCH_HEAD')
    if output('git', '-C', destination, 'rev-parse', 'HEAD') != pin['commit']:
        raise ValueError('Source commit does not match the pinned revision')


def apply_patches(source, identity):
    for patch in identity['patches']:
        path = ROOT / 'runtime' / patch['path']
        if digest(path) != patch['sha256']:
            raise ValueError(f'Patch checksum mismatch: {patch["path"]}')
        run('git', 'apply', '--check', path, cwd=source)
        run('git', 'apply', path, cwd=source)
    # Exact resulting files also reject shifted or partially applicable patches.
    for name, expected in identity['patched_files'].items():
        if digest(source / name) != expected:
            raise ValueError(f'Patched source checksum mismatch: {name}')


def compiler_flags(work):
    # __FILE__ remains in assertion strings even after stripping debug symbols.
    return ' '.join(['-march=x86-64', '-mtune=generic'] + [
        f'-{kind}-prefix-map={work}=/usr/src/voco/native'
        for kind in ('ffile', 'fdebug', 'fmacro')])


def cmake_arguments(source, build, work):
    flags = compiler_flags(work)
    options = {
        'CMAKE_BUILD_TYPE': 'Release', 'CMAKE_C_FLAGS': flags, 'CMAKE_CXX_FLAGS': flags,
        'CMAKE_BUILD_RPATH_USE_ORIGIN': 'ON', 'CMAKE_BUILD_WITH_INSTALL_RPATH': 'ON',
        'CMAKE_INSTALL_RPATH': '$ORIGIN', 'CMAKE_INSTALL_RPATH_USE_LINK_PATH': 'OFF',
        'CMAKE_INSTALL_LIBDIR': 'lib',
        # Preserve the existing dynamic distro dependency, not an incidental .a.
        'SENTENCEPIECE_STATIC_LIB:FILEPATH': '',
        'NEMO_SPEECH_BUILD_ASR': 'ON', 'GGML_CPU_REPACK': 'ON',
        'GGML_SSE42': 'ON', 'GGML_AVX': 'ON', 'GGML_AVX2': 'ON',
        'GGML_FMA': 'ON', 'GGML_F16C': 'ON', 'GGML_BMI2': 'ON',
    }
    for key in ('NEMO_SPEECH_BUILD_DIAR', 'NEMO_SPEECH_BUILD_TTS',
                'NEMO_SPEECH_BUILD_NMT', 'NEMO_SPEECH_BUILD_MIC_CAPTURE',
                'NEMO_SPEECH_GGML_PATCHED', 'GGML_NATIVE', 'GGML_OPENMP',
                'GGML_BACKEND_DL', 'GGML_CPU_ALL_VARIANTS', 'GGML_AVX_VNNI',
                'GGML_AVX512', 'GGML_AVX512_VBMI', 'GGML_AVX512_VNNI',
                'GGML_AVX512_BF16', 'GGML_AMX_TILE', 'GGML_AMX_INT8',
                'GGML_AMX_BF16', 'GGML_CUDA', 'GGML_BLAS', 'GGML_CCACHE'):
        options[key] = 'OFF'
    return ['cmake', '-S', str(source), '-B', str(build), '-G', 'Unix Makefiles',
            *[f'-D{key}={value}' for key, value in options.items()]]


def stage_libraries(build, stage):
    destination = stage / 'lib'
    destination.mkdir(parents=True)
    for name in REAL_LIBRARIES:
        original = build / 'bin' / name
        if original.is_symlink() or not original.is_file():
            raise ValueError(f'Missing regular native library: {name}')
        shutil.copy2(original, destination / name)
    for name, target in LINKS.items():
        (destination / name).symlink_to(target)


def audit_libraries(stage, work):
    """Reject leaked host paths and unexpected loader paths before publishing output."""
    # All compiled inputs are copied into work. ROOT is not a compiled-input
    # path and may be /src, a substring of the intentional /usr/src remapping.
    for library in [stage / 'libbench_nemo_pool.so',
                    *[stage / 'lib' / name for name in REAL_LIBRARIES]]:
        content = library.read_bytes()
        if any(value in content for value in
               (b'/home/', b'/Users/', str(work).encode())):
            raise ValueError(f'Private build path remains in {library.name}')
        dynamic = output('readelf', '-d', library)
        paths = [line for line in dynamic.splitlines() if 'RPATH' in line or 'RUNPATH' in line]
        # Upstream adds ../lib to the install path; in our flat lib/ payload
        # that resolves to the same directory. No build-host path is allowed.
        allowed = {'$ORIGIN/lib'} if library.parent == stage else {'$ORIGIN', '$ORIGIN/../lib'}
        entries = [entry for line in paths for group in re.findall(r'\[([^]]*)\]', line)
                   for entry in group.split(':')]
        if not entries or any(entry not in allowed for entry in entries):
            raise ValueError(f'Unexpected loader path in {library.name}')


def build(args):
    work, destination = args.work_dir.absolute(), args.output.absolute()
    fresh(work)
    fresh(destination)
    if destination == work or work in destination.parents:
        raise ValueError('Output must be outside the temporary build directory')
    if any(c.isspace() for c in str(work)):
        raise ValueError('Build directory must not contain whitespace (compiler flag boundary)')
    identity = json.loads(PIN.read_text())
    for tool in ('git', 'cmake', 'make', 'cc', 'c++', 'readelf'):
        if not shutil.which(tool):
            raise ValueError(f'Missing build dependency: {tool}')
    work.mkdir(parents=True)
    source, native_build, stage = work / 'source', work / 'build', work / 'payload'
    checkout(identity['upstream'], source, args.source)
    checkout(identity['ggml'], source / 'ggml', args.source / 'ggml' if args.source else None)
    apply_patches(source, identity)
    # Keep a neutral, local copy of the app bridge so includes and diagnostics
    # cannot retain the app checkout's private path.
    bridge = work / 'nemo_bridge.cpp'
    shutil.copy2(ROOT / 'runtime/speech/nemo_bridge.cpp', bridge)
    arguments = cmake_arguments(source, native_build, work)
    run(*arguments)
    run('cmake', '--build', native_build, '--parallel', args.jobs,
        '--target', 'nemo_speech_asr_c')
    stage_libraries(native_build, stage)
    run('c++', '-shared', '-fPIC', '-O2', *compiler_flags(work).split(), bridge,
        '-I', source / 'include', '-L', native_build / 'bin', '-lnemo_speech_asr_c',
        '-Wl,-rpath,$ORIGIN/lib', '-o', stage / 'libbench_nemo_pool.so')
    cpu_check = work / 'cpu_check.c'
    shutil.copy2(ROOT / 'runtime/speech/cpu_check.c', cpu_check)
    run('cc', '-O2', *compiler_flags(work).split(), cpu_check,
        '-o', stage / 'voco-cpu-check')
    audit_libraries(stage, work)
    if any(value in (stage / 'voco-cpu-check').read_bytes()
           for value in (b'/home/', b'/Users/', str(work).encode())):
        raise ValueError('Private build path remains in CPU guard')
    notices = stage / 'notices'
    notices.mkdir()
    for name in ('LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'):
        shutil.copy2(source / name, notices / name)
    shutil.copy2(source / 'ggml/LICENSE', notices / 'GGML-LICENSE')
    shutil.copy2(PIN, notices / PIN.name)
    shutil.copytree(ROOT / 'runtime/patches', notices / 'patches')
    receipt = {
        'schema': 1, 'source': identity, 'bridge_sha256': digest(bridge),
        'cpu_check_sha256': digest(cpu_check),
        'compiler': output('c++', '--version').splitlines()[0],
        'cmake': output('cmake', '--version').splitlines()[0],
        'cmake_arguments': [arg.replace(str(work), '/build') for arg in arguments],
        'files': {str(p.relative_to(stage)): digest(p) for p in sorted(stage.rglob('*'))
                  if p.is_file() and not p.is_symlink()},
        'symlinks': {f'lib/{name}': target for name, target in sorted(LINKS.items())},
    }
    (stage / 'BUILD-IDENTITY.json').write_text(json.dumps(receipt, indent=2) + '\n')
    destination.parent.mkdir(parents=True, exist_ok=True)
    # mkdir reserves a fresh destination; copy only after every build audit passes.
    destination.mkdir()
    shutil.copytree(stage, destination, dirs_exist_ok=True, symlinks=True)
    print(json.dumps({'output': str(destination), 'files': len(receipt['files'])}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--work-dir', required=True, type=Path)
    parser.add_argument('--source', type=Path, help='Local upstream Git checkout with pinned ggml')
    parser.add_argument('--jobs', type=int, default=4)
    args = parser.parse_args()
    if platform.system() != 'Linux' or platform.machine() not in ('x86_64', 'amd64'):
        parser.error('This builder targets x86_64 Linux')
    if not 1 <= args.jobs <= 32:
        parser.error('--jobs must be between 1 and 32')
    try:
        build(args)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Native build failed: {error}\n')


if __name__ == '__main__':
    main()
