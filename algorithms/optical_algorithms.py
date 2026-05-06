"""
optical_algorithms.py
─────────────────────
Central router for all optical device analysis.

app.py calls only this module.  To add a new device type:
  1. Create a new <type>_algorithms.py with:
       scan_directory(path) -> list[str]   (device keys)
       load_data(path, label) -> list[dict] (curve dicts)
  2. Add a detection function and an entry in DEVICE_MODULES below.
  3. That's it — app.py never needs to change.

Detection priority (first match wins):
  • "mrrs"       anywhere in subfolder name  →  mrr_algorithms
  • "crossers"   anywhere in subfolder name  →  crosser_algorithms
  • "intc1to10"  anywhere in subfolder name  →  intc1to10_algorithms
  • "loopbacks"  anywhere in subfolder name  →  loopback_algorithms

Parent-folder support:
  The scan and load functions accept either:
    • A flat folder whose immediate children are device subfolders, OR
    • A parent folder whose immediate children are category folders
      (e.g. "mrrs/", "crossers/", "intc1to10/"), each of which then
      contains the device subfolders.
  Both layouts are searched automatically — results are deduplicated.
"""

from __future__ import annotations

import os

import crosser_algorithms
import intc1to10_algorithms
import loopback_algorithms
import mrr_algorithms

# ── Device module registry ────────────────────────────────────────────────────
# Each entry: (type_label, detect_fn, module)
# detect_fn(folder_name: str) -> bool
# First matching entry wins.

def _is_mrr(name: str) -> bool:
    return "mrrs" in name.lower()

def _is_crosser(name: str) -> bool:
    return "crossers" in name.lower()

def _is_intc1to10(name: str) -> bool:
    return "intc1to10" in name.lower()

def _is_loopback(name: str) -> bool:
    return "loopbacks" in name.lower()

DEVICE_MODULES = [
    ("mrr",        _is_mrr,        mrr_algorithms),
    ("crosser",    _is_crosser,    crosser_algorithms),
    ("intc1to10",  _is_intc1to10,  intc1to10_algorithms),
    ("loopback",   _is_loopback,   loopback_algorithms),
]


# ── Internal helpers ──────────────────────────────────────────────────────────

def _candidate_dirs(path: str) -> list[str]:
    """
    Return *path* itself plus every immediate subdirectory of *path*.

    This lets callers treat both flat layouts (device folders directly in path)
    and one-level-deep category layouts (path/mrrs/device_xxx/, etc.) without
    any change to the individual algorithm modules.
    """
    dirs = [path]
    try:
        for entry in os.scandir(path):
            if entry.is_dir():
                dirs.append(entry.path)
    except OSError:
        pass
    return dirs


# ── Public API (called by app.py) ─────────────────────────────────────────────

def scan_optical_directory_ex(path: str) -> list[dict]:
    """
    Scan *path* (and its immediate subdirectories) for device folders.
    Each folder is classified by the first matching rule in DEVICE_MODULES.

    Supports both flat and category-subfolder layouts:
      path/device_xxx/          ← flat
      path/mrrs/device_xxx/     ← category subfolder

    Returns a deduplicated list of {key: str, type: str}.
    """
    if not os.path.isdir(path):
        raise FileNotFoundError(f"Directory not found: {path}")

    seen: set[str] = set()
    ordered: list[dict] = []

    for scan_path in _candidate_dirs(path):
        for type_label, _detect_fn, module in DEVICE_MODULES:
            try:
                keys = module.scan_directory(scan_path)
            except Exception:
                keys = []
            for key in keys:
                tag = f"{type_label}::{key}"
                if tag not in seen:
                    seen.add(tag)
                    ordered.append({"key": key, "type": type_label})

    return ordered


def scan_optical_directory(path: str) -> list[str]:
    """Legacy API — crosser keys only.  Kept for any old call sites."""
    return [d["key"] for d in scan_optical_directory_ex(path)
            if d["type"] == "crosser"]


def load_optical_data_auto(path: str, label: str) -> list[dict]:
    """
    Auto-detect device type by scanning *path* and its immediate subdirectories
    for a folder that:
      (a) contains *label* as a case-insensitive substring, AND
      (b) is matched by one of the DEVICE_MODULES detectors.

    The first qualifying match wins.  Falls back to [] if nothing matches.
    """
    if not os.path.isdir(path):
        raise FileNotFoundError(f"Directory not found: {path}")

    lbl = label.lower()
    for scan_path in _candidate_dirs(path):
        for type_label, detect_fn, module in DEVICE_MODULES:
            try:
                entries = list(os.scandir(scan_path))
            except OSError:
                continue
            for entry in entries:
                if (entry.is_dir()
                        and detect_fn(entry.name)
                        and lbl in entry.name.lower()):
                    return module.load_data(scan_path, label)
    return []


def load_optical_data(path: str, label: str, data_type: str = "auto") -> list[dict]:
    """
    Dispatch to the correct module's load_data() based on *data_type*.
    When data_type is "auto" (the default), the type is inferred from
    subfolder names across path and its immediate subdirectories.
    Falls back to load_optical_data_auto() for unrecognised types.
    """
    if data_type == "auto":
        return load_optical_data_auto(path, label)
    for type_label, _detect_fn, module in DEVICE_MODULES:
        if data_type == type_label:
            # Try path itself first, then one level of subdirectories
            for scan_path in _candidate_dirs(path):
                curves = module.load_data(scan_path, label)
                if curves:
                    return curves
            return []
    # Unknown type — fall back to auto-detect
    return load_optical_data_auto(path, label)
