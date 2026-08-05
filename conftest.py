"""Ensures the project root is importable so ``import reporting_exports`` works
when running the test suite from a clean environment."""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
