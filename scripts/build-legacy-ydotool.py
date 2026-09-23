#!/usr/bin/env python3
"""Build VOCO's private legacy daemon from verified vendored source; never run it."""
import argparse
import hashlib
import json
import lzma
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / 'vendor/ydotool-legacy'


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def checked(argv, *, cwd=None, env=None, timeout=60):
    result = subprocess.run(argv, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'Command failed ({result.returncode}): {argv}\n{result.stdout}')
    return result.stdout


def verify_source(vendor, index=None, archives=None, keyring=None):
    manifest = json.loads((vendor / 'SOURCE.json').read_text())
    if manifest['format_version'] != 1:
        raise ValueError('Unsupported source manifest')
    for relative, expected in manifest['files'].items():
        path = vendor / relative
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(vendor.resolve()):
            raise ValueError('Unsafe or missing vendor input: ' + relative)
        if sha(path) != expected:
            raise ValueError('Vendor input hash mismatch: ' + relative)
    # Reject newly introduced source/patch files that escape the review manifest.
    actual = {str(p.relative_to(vendor)) for directory in ('upstream', 'patches', 'notices', 'provenance')
              for p in (vendor / directory).rglob('*') if p.is_file()}
    if actual != set(manifest['files']):
        raise ValueError('Unexpected vendor input inventory')
    authentication = {'vendored_inputs_verified': True, 'archive_chain_reverified': False}
    if index is not None:
        if archives is None or keyring is None:
            raise ValueError('Index verification requires --source-archives and --keyring')
        auth = manifest['authentication']
        release = vendor / auth['inrelease']
        status = checked(['gpgv', '--status-fd', '1', '--keyring', str(keyring), str(release)])
        if '[GNUPG:] VALIDSIG ' + auth['signing_key_fingerprint'] + ' ' not in status:
            raise ValueError('Unexpected archive signing key')
        if sha(release) != auth['inrelease_sha256'] or sha(index) != auth['sources_index_sha256']:
            raise ValueError('Archive authentication hash mismatch')
        if index.stat().st_size != auth['sources_index_bytes']:
            raise ValueError('Source index size mismatch')
        # InRelease whitespace varies; match the exact SHA256, extent and path.
        if not re.search(r'^ ' + auth['sources_index_sha256'] + r'\s+' + str(auth['sources_index_bytes']) +
                         r' universe/source/Sources.xz$', release.read_text(), re.M):
            raise ValueError('Index is not covered by signed release')
        text = lzma.decompress(index.read_bytes()).decode()
        for package in manifest['packages']:
            stanzas = [s for s in text.split('\n\n') if s.startswith('Package: ' + package['name'] + '\n')]
            if len(stanzas) != 1:
                raise ValueError('Source package index ambiguity')
            stanza = stanzas[0]
            expected = f" {package['archive_sha256']} {package['archive_bytes']} {package['archive']}"
            if expected not in stanza.split('Checksums-Sha256:\n', 1)[1].split('Checksums-Sha512:', 1)[0].splitlines():
                raise ValueError('Archive is not authenticated by index')
            candidates = list(archives.rglob(package['archive']))
            if len(candidates) != 1 or sha(candidates[0]) != package['archive_sha256']:
                raise ValueError('Missing or changed upstream archive: ' + package['archive'])
            if candidates[0].stat().st_size != package['archive_bytes']:
                raise ValueError('Archive size mismatch')
            with tarfile.open(candidates[0]) as archive:
                for member, expected_sha in package['members'].items():
                    data = archive.extractfile(member).read()
                    if hashlib.sha256(data).hexdigest() != expected_sha or data != (vendor / 'upstream' / member).read_bytes():
                        raise ValueError('Vendored member differs from archive: ' + member)
        authentication['archive_chain_reverified'] = True
    return manifest, authentication


def inspect(binary, output):
    sections = {}
    for name, flags in [('header', '-hW'), ('program', '-lW'), ('dynamic', '-dW'),
                        ('versions', '-VW'), ('symbols', '-Ws'), ('notes', '-nW')]:
        sections[name] = checked(['readelf', flags, str(binary)])
        (output / ('elf-' + name + '.txt')).write_text(sections[name])
    dynamic, program = sections['dynamic'], sections['program']
    needed = re.findall(r'\(NEEDED\).*\[([^]]+)\]', dynamic)
    if needed != ['libstdc++.so.6', 'libgcc_s.so.1', 'libc.so.6']:
        raise ValueError('Unexpected runtime dependency closure: ' + repr(needed))
    floors = {}
    for name, maximum in [('GLIBC', (2, 34)), ('GLIBCXX', (3, 4, 29)), ('CXXABI', (1, 3, 9))]:
        versions = {tuple(map(int, s.split('.'))) for s in re.findall(r'\b' + name + r'_(\d+(?:\.\d+)*)\b', sections['versions'])}
        if not versions or max(versions) > maximum:
            raise ValueError('Runtime ABI floor exceeded for ' + name)
        floors[name] = '.'.join(map(str, max(versions)))
    stack = next(line for line in program.splitlines() if 'GNU_STACK' in line)
    hardening = {'pie': bool(re.search(r'Type:\s+DYN', sections['header'])) and 'PIE' in dynamic,
                 'full_relro': 'GNU_RELRO' in program and 'BIND_NOW' in dynamic,
                 'non_executable_stack': bool(re.search(r'\sRW\s', stack)) and 'RWE' not in stack,
                 'stack_canary': '__stack_chk_fail' in sections['symbols'],
                 'no_rpath': not re.search(r'\((?:RPATH|RUNPATH)\)', dynamic),
                 'no_text_relocations': 'TEXTREL' not in dynamic}
    if not all(hardening.values()):
        raise ValueError('ELF hardening validation failed')
    return {'needed': needed, 'abi_floors': floors, 'hardening': hardening,
            'interpreter': re.search(r'Requesting program interpreter: ([^]]+)', program)[1]}


def build(vendor, output, source, authentication):
    output.mkdir(parents=True, exist_ok=False)
    env = {**os.environ, 'LC_ALL': 'C', 'TZ': 'UTC', 'SOURCE_DATE_EPOCH': str(source['source_date_epoch'])}
    compiler = shlex.split(env.get('CXX', 'g++'))
    if not compiler or checked(compiler + ['-dumpmachine'], env=env).strip() != 'x86_64-linux-gnu':
        raise ValueError('The qualified helper requires an x86_64 GNU/Linux compiler')
    tree = output / 'source'
    shutil.copytree(vendor / 'upstream', tree)
    ydotool, uinput = tree / 'ydotool-0.1.8', tree / 'libuInputPlus-0.1.4'
    commands, logs = [], []
    def run(argv, cwd=output):
        commands.append(argv)
        text = checked(argv, cwd=cwd, env=env)
        logs.append(text)
        (output / 'build.log').write_text('\n'.join(logs))
        save(output / 'commands.json', commands)
        return text
    for relative in source['patches']:
        run(['patch', '--batch', '--forward', '--fuzz=0', '-p1', '-i', str(vendor / relative)], cwd=ydotool)
    include = output / 'include/uInputPlus'
    include.mkdir(parents=True)
    for header in uinput.glob('*.hpp'):
        shutil.copyfile(header, include / header.name)
    sources = [ydotool / 'Daemon/ydotoold.cpp', ydotool / 'Library/Instance.cpp',
               uinput / 'uInput.cpp', uinput / 'uInputSetup.cpp', uinput / 'uInputResource.cpp']
    flags = ['-std=c++14', '-O2', '-g', '-fPIE', '-fstack-protector-strong', '-fstack-clash-protection',
             '-fcf-protection=full', '-D_FORTIFY_SOURCE=3', '-Wformat', '-Werror=format-security',
             '-Wdate-time', '-fno-omit-frame-pointer', '-mno-omit-leaf-frame-pointer',
             '-ffunction-sections', '-fdata-sections', '-pthread',
             f'-ffile-prefix-map={output}=/usr/src/voco-ydotoold',
             f'-fdebug-prefix-map={output}=/usr/src/voco-ydotoold', '-I', str(include.parent)]
    probe = output / 'fortify.cpp'
    probe.write_text('#include <features.h>\n#if __USE_FORTIFY_LEVEL != 3\n#error fortify mismatch\n#endif\n')
    run(compiler + ['-O2', '-D_FORTIFY_SOURCE=3', '-E', '-P', str(probe)])
    objects = []
    for i, path in enumerate(sources):
        obj = output / f'{i}.o'
        run(compiler + flags + ['-MD', '-MF', str(output / f'{i}.d'), '-c', str(path), '-o', str(obj)])
        objects.append(str(obj))
    binary = output / 'ydotoold'
    run(compiler + ['-pie', '-pthread', '-Wl,-z,relro,-z,now,-z,noexecstack',
                    '-Wl,--as-needed,--gc-sections,--build-id=sha1',
                    '-Wl,-Map,' + str(output / 'link.map'), *objects, '-o', str(binary)])
    shutil.copyfile(binary, output / 'ydotoold.unstripped')
    run(['strip', '--strip-unneeded', str(binary)])
    elf = inspect(binary, output)
    elf['hardening']['fortify_level'] = 3
    # Ship exact vendor/source/build receipts with the notice bundle. This also
    # preserves the full minimal source closure without bundling system runtimes.
    shutil.copytree(vendor, output / 'notices')
    shutil.copyfile(Path(__file__), output / 'notices/build-legacy-ydotool.py')
    dependencies = set()
    for path in output.glob('*.d'):
        dependencies.update(shlex.split(path.read_text().replace('\\\n', ' ').split(':', 1)[1]))
    dependency_hashes = {p: sha(Path(p)) for p in sorted(dependencies) if Path(p).is_file()}
    save(output / 'compiler-inputs.json', dependency_hashes)
    compiler_version = run(compiler + ['--version']).splitlines()[0]
    # Raw local receipts remain alongside the binary. Distributed receipts use
    # stable source paths so packaging neither reveals the builder's home nor
    # changes solely because a fresh build used a different output directory.
    def distributed(value):
        if isinstance(value, str):
            for local, canonical in [(output, '/usr/src/voco-ydotoold'),
                                     (vendor, '/usr/src/voco/vendor/ydotool-legacy'),
                                     (ROOT, '/usr/src/voco')]:
                value = value.replace(str(local), canonical)
            return value
        if isinstance(value, list):
            return [distributed(item) for item in value]
        if isinstance(value, dict):
            return {distributed(key): distributed(item) for key, item in value.items()}
        return value
    save(output / 'notices/commands.json', distributed(commands))
    save(output / 'notices/compiler-inputs.json', distributed(dependency_hashes))
    (output / 'notices/build.log').write_text(distributed((output / 'build.log').read_text()))
    manifest = {'format_version': 1, 'binary_sha256': sha(binary), 'binary_bytes': binary.stat().st_size,
        'unstripped_sha256': sha(output / 'ydotoold.unstripped'), 'elf': elf,
        'source_provenance': {'manifest_sha256': sha(vendor / 'SOURCE.json'),
            'packages': [{key: p[key] for key in ('name', 'version', 'archive_sha256', 'archive_url')} for p in source['packages']],
            'authentication': authentication},
        'patches': [{'path': p, 'sha256': sha(vendor / p)} for p in source['patches']],
        'build': {'source_date_epoch': source['source_date_epoch'], 'compiler': compiler_version,
            'flags': distributed(flags), 'script_sha256': sha(Path(__file__)),
            'compiler_inputs_sha256': sha(output / 'notices/compiler-inputs.json')},
        'notices': {str(p.relative_to(output / 'notices')): sha(p)
                    for p in sorted((output / 'notices').rglob('*')) if p.is_file()}}
    save(output / 'manifest.json', manifest)
    print(json.dumps({'binary': str(binary), 'binary_sha256': manifest['binary_sha256'], 'manifest': str(output / 'manifest.json')}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='New output directory, never overwritten')
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--source-index', type=Path, help='Optional saved Sources.xz for full archive authentication')
    parser.add_argument('--source-archives', type=Path, help='Directory containing authenticated original archives')
    parser.add_argument('--keyring', type=Path, default=Path('/usr/share/keyrings/ubuntu-archive-keyring.gpg'))
    args = parser.parse_args()
    source, authentication = verify_source(VENDOR, args.source_index, args.source_archives, args.keyring)
    if args.verify_only:
        print(json.dumps(authentication))
    elif args.output:
        build(VENDOR.resolve(), args.output.resolve(), source, authentication)
    else:
        parser.error('--output is required unless --verify-only is selected')


if __name__ == '__main__':
    main()
