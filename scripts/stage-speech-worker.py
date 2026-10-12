#!/usr/bin/env python3
"""Copy the speech worker into a directory as packages ship it.

Every other test starts the worker from the checkout, where each file is
present, so CI runs the worker protocol test from this copy too. Hosted CI
never packages or signs anything; this only copies the worker's files.
"""
import argparse
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("package_nvidia", Path(__file__).with_name("package-nvidia.py"))
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)

parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument("directory", type=Path, help="where the worker goes; it must not exist yet")
package.stage_worker(parser.parse_args().directory)
