#!/usr/bin/env python3
"""Reject identifiable home paths and common credential formats in unpacked releases.

This content check supplements manifest review and secret scanning; it is not proof
that every kind of sensitive information is absent. Never print matched values.
"""
import argparse
import json
import mmap
from pathlib import Path
import re

PATTERNS = {
    'personal-home-path': re.compile(rb'(?<![A-Za-z0-9_./])/(?:home|Users)/[A-Za-z0-9_.-]+/'),
    'private-key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
    'github-token': re.compile(rb'(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,})'),
    'aws-access-key': re.compile(rb'(?<![A-Z0-9])AKIA[A-Z0-9]{16}(?![A-Z0-9])'),
}


def inspect(root):
    checked, findings = 0, []
    for path in sorted(root.rglob('*')):
        if path.is_symlink() or not path.is_file():
            continue  # Link containment is checked by the package verifier.
        checked += 1
        if not path.stat().st_size:
            continue
        with path.open('rb') as stream, mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as data:
            categories = [name for name, pattern in PATTERNS.items() if pattern.search(data)]
        if categories:
            findings.append({'file': str(path.relative_to(root)), 'categories': categories})
    return {'checked_files': checked, 'findings': findings}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    if args.directory.is_symlink() or not args.directory.is_dir():
        parser.error('Expected a regular unpacked release directory')
    result = inspect(args.directory)
    print(json.dumps(result))
    raise SystemExit(bool(result['findings']))
