#!/usr/bin/env python3
"""Exercise real APT prompts and conffile preservation in a disposable container."""
import argparse
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]
PREFIX=(ROOT/'install').read_text().split('# ─── Header',1)[0]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-container-package-changes',action='store_true')
    args=parser.parse_args()
    if not args.allow_container_package_changes or not Path('/.dockerenv').exists():
        raise SystemExit('This check installs a fixture package. Run only in an explicitly approved disposable container.')
    spec=importlib.util.spec_from_file_location('fixture',ROOT/'scripts/test-install-performance.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    package='voco-installer-fixture'
    config=Path('/etc/voco-installer-fixture.conf')
    probe=subprocess.run(['dpkg-query','-W',package],capture_output=True)
    if probe.returncode==0 or config.exists():
        raise SystemExit('Existing fixture state must be inspected, not overwritten.')
    with tempfile.TemporaryDirectory(prefix='voco-apt-integration-') as folder:
        root=Path(folder)
        root.chmod(0o755)
        try:
            for version in (1,2):
                stage=root/f'package-{version}'
                (stage/'DEBIAN').mkdir(parents=True)
                (stage/'etc').mkdir()
                (stage/'DEBIAN/control').write_text(f'Package: {package}\nVersion: {version}\nArchitecture: all\nMaintainer: VOCO fixture\nDescription: disposable installer integration check\n')
                (stage/'DEBIAN/conffiles').write_text(str(config)+'\n')
                (stage/'etc'/config.name).write_text(f'distribution-version={version}\n')
                if version==1:
                    hook=stage/'DEBIAN/postinst'
                    hook.write_text('#!/bin/sh\nprintf "Fixture confirmation (type yes): "\nread -r answer\n[ "$answer" = yes ] || exit 70\nprintf "\\nFixture confirmed\\n"\n')
                    hook.chmod(0o755)
                deb=root/f'fixture-{version}.deb'
                subprocess.run(['dpkg-deb','--root-owner-group','--build',str(stage),str(deb)],check=True,stdout=subprocess.DEVNULL)
                env={**os.environ,'TERM':'xterm-256color','TMPDIR':str(root),'XDG_CURRENT_DESKTOP':''}
                env.pop('NO_COLOR',None)
                body='\nVOCO_DOWNLOAD_DIR=$(mktemp -d)\nvoco_run_apt "$1"\n'
                reply=(b'Fixture confirmation (type yes): ',b'yes\n') if version==1 else (b'[default=N] ?',b'N\n')
                code,output=module.terminal(['bash','-c',PREFIX+body,'fixture',str(deb)],env,reply=reply,timeout=30)
                print(output.decode(errors='replace'),flush=True)
                if code:
                    raise SystemExit(f'APT fixture {version} failed: {code}')
                if version==1:
                    subprocess.run(['sudo','sh','-c','printf "owner setting\\n" > /etc/voco-installer-fixture.conf'],check=True)
                else:
                    assert config.read_text()=='owner setting\n'
                print(f'PASS real APT {"maintainer prompt" if version==1 else "conffile prompt and owner setting preservation"}',flush=True)
        finally:
            subprocess.run(['sudo','apt-get','purge','-y','-qq',package],check=True)


if __name__=='__main__':
    main()
