"""
mrr_algorithms.py
─────────────────
Optical analysis for MRR (Micro-Ring Resonator) devices.

Folder convention:
  <label>_in1out4_23  → reference line, CH2
  <label>_in2out3_23  → device data,    CH3

Example subfolder names:
  dose280uC_MRRs_bias8nm_circle03_in1out4_23
  dose280uC_MRRs_bias8nm_circle03_in2out3_23

Activation rule: any subfolder that contains "mrr" (case-insensitive)
anywhere in its name and contains at least one LossData*.csv file is
handled by this module.
"""

from __future__ import annotations

import os
import re
from glob import glob
from typing import Optional

# ── Curve style definitions ───────────────────────────────────────────────────
CURVE_DEFS = [
    # label       mtype           ch     color      dash   lw
    ("MRR T",     "in2out3_23",   "CH3", "#3fb950", [],    1.5),
    ("MRR Ref",   "in1out4_23",   "CH2", "#c9d1d9", [],    1.0),
]


def _is_mrr_folder(name: str) -> bool:
    """Return True only when the folder name contains the literal string 'mrrs' (e.g. 'MRRs')."""
    return "mrrs" in name.lower()


def _detect_mtype(dir_name: str) -> str:
    dl = dir_name.lower()
    if "in1out4" in dl:
        return "in1out4_23"
    if "in2out3" in dl:
        return "in2out3_23"
    return "unknown"


# ── CSV parser ────────────────────────────────────────────────────────────────

def _parse_csv(path: str) -> Optional[dict]:
    """
    Parse a single LossData*.csv file.
    Returns {wl, CH2, CH3, CH4} or None on failure.
    """
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
    except OSError:
        return None

    data_start = None
    for i, line in enumerate(lines):
        if "--DATA START--" in line:
            data_start = i
            break
    if data_start is None:
        return None

    hi = data_start + 1
    while hi < len(lines) and lines[hi].strip() == "":
        hi += 1
    if hi >= len(lines):
        return None

    header = re.split(r"[\t,;]+", lines[hi].strip())
    header = [h.replace("\ufeff", "").strip() for h in header]

    wl_idx = ch2_idx = ch3_idx = ch4_idx = -1
    for idx, h in enumerate(header):
        if re.search(r"wavelength", h, re.I):
            wl_idx = idx
        elif re.search(r"CH4", h, re.I):
            ch4_idx = idx
        elif re.search(r"CH3", h, re.I):
            ch3_idx = idx
        elif re.search(r"CH2", h, re.I):
            ch2_idx = idx

    if wl_idx < 0:
        return None

    wl, ch2, ch3, ch4 = [], [], [], []
    for line in lines[hi + 1:]:
        row = line.strip()
        if not row:
            continue
        cols = re.split(r"[\t,;]+", row)
        try:
            w = float(cols[wl_idx])
        except (ValueError, IndexError):
            continue
        wl.append(w)
        def _safe(i):
            try:
                return float(cols[i]) if i >= 0 else 0.0
            except (ValueError, IndexError):
                return 0.0
        ch2.append(_safe(ch2_idx))
        ch3.append(_safe(ch3_idx))
        ch4.append(_safe(ch4_idx))

    if not wl:
        return None
    return {"wl": wl, "CH2": ch2, "CH3": ch3, "CH4": ch4}


# ── Public API ────────────────────────────────────────────────────────────────

def scan_directory(path: str) -> list[str]:
    """
    Scan *path* for MRR device subdirectories (any folder WITH "mrr" anywhere
    in its name that contains at least one LossData*.csv file).

    Returns a sorted, deduplicated list of device keys (mtype suffix stripped).
    """
    if not os.path.isdir(path):
        raise FileNotFoundError(f"Directory not found: {path}")

    keys: list[str] = []
    for entry in sorted(os.scandir(path), key=lambda e: e.name):
        if not entry.is_dir():
            continue
        if not _is_mrr_folder(entry.name):
            continue
        if not glob(os.path.join(entry.path, "LossData*.csv")):
            continue
        key = re.sub(r"_(in\d+out\d+_?\d*)$", "", entry.name, flags=re.IGNORECASE)
        if key not in keys:
            keys.append(key)
    return keys


def load_data(path: str, label: str) -> list[dict]:
    """
    Scan *path* for MRR subfolders whose name contains *label*
    (case-insensitive) and also contains "mrr".  Parses all
    LossData*.csv files and returns curve dicts for the JS chart.

    Each curve dict: {label, wl, il, color, dash, lw}
    """
    if not os.path.isdir(path):
        raise FileNotFoundError(f"Directory not found: {path}")

    lbl = label.lower()
    curves: list[dict] = []

    for entry in sorted(os.scandir(path), key=lambda e: e.name):
        if not entry.is_dir():
            continue
        if not _is_mrr_folder(entry.name):
            continue
        if lbl not in entry.name.lower():
            continue

        mtype = _detect_mtype(entry.name)
        csv_files = glob(os.path.join(entry.path, "LossData*.csv"))

        for csv_path in sorted(csv_files):
            parsed = _parse_csv(csv_path)
            if parsed is None:
                continue
            for lbl_str, mt, ch, color, dash, lw in CURVE_DEFS:
                if mt != mtype:
                    continue
                il = parsed.get(ch, [])
                if not il:
                    continue
                curves.append({
                    "label": lbl_str,
                    "wl":    parsed["wl"],
                    "il":    il,
                    "color": color,
                    "dash":  dash,
                    "lw":    lw,
                })

    return curves
