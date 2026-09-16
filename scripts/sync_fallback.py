#!/usr/bin/env python3
"""Regenerate the inline fallback copy of conferences.json inside index.html.

Equivalent to `python3 scripts/validate.py --fix`.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate  # noqa: E402

if __name__ == "__main__":
    sys.exit(validate.main(["--fix"] + sys.argv[1:]))
