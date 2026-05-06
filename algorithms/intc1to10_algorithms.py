"""
intc1to10_algorithms.py
───────────────────────
Optical analysis for 1×10 integrated circuit (intc1to10) devices.

Folder convention  (## = two-digit device index, e.g. intc00):
  <prefix>_in8out6_2       → reference (CH2 only, averaged across all CSV files)
  <prefix>_in7out123_234   → grating 1/CH2, grating 2/CH3, grating 3/CH4
  <prefix>_in7out453_234   → grating 4/CH2, grating 5/CH3, grating 3/CH4
  <prefix>_in7out91011_234 → grating 9/CH2, grating 10/CH3, grating 11/CH4
  <prefix>_in7out121311_234→ grating 12/CH2, grating 13/CH3, grating 11/CH4

Physical output port mapping (o1 = optical input, not measured):
  o2  ← grating 9     o3  ← grating 10    o4  ← grating 11
  o5  ← grating 12    o6  ← grating 13
  o7  ← grating 1     o8  ← grating 2     o9  ← grating 3
  o10 ← grating 4     o11 ← grating 5

Duplicate ports (o4 from grating 11 and o9 from grating 3) each appear in
two measurement folders — all contributing IL arrays are averaged together.

Activation rule: any subfolder whose name contains "intc1to10"
(case-insensitive) and has at least one LossData*.csv file.
"""

from __future__ import annotations

import os
import re
from collections import defaultdict
from glob import glob
from typing import Optional

# ── Channel-to-port mapping per measurement type ──────────────────────────────
# mtype → [(channel, port_label, description)]
MTYPE_CHANNELS: dict[str, list[tuple[str, str, str]]] = {
    'in7out123_234': [
        ('CH2', 'o7',  'grating 1'),
        ('CH3', 'o8',  'grating 2'),
        ('CH4', 'o9',  'grating 3'),
    ],
    'in7out453_234': [
        ('CH2', 'o10', 'grating 4'),
        ('CH3', 'o11', 'grating 5'),
        ('CH4', 'o9',  'grating 3'),   # averaged with in7out123 CH4
    ],
    'in7out91011_234': [
        ('CH2', 'o2',  'grating 9'),
        ('CH3', 'o3',  'grating 10'),
        ('CH4', 'o4',  'grating 11'),
    ],
    'in7out121311_234': [
        ('CH2', 'o5',  'grating 12'),
        ('CH3', 'o6',  'grating 13'),
        ('CH4', 'o4',  'grating 11'),  # averaged with in7out91011 CH4
    ],
    'in8out6_2': [
        ('CH2', 'Ref', 'reference out6'),
    ],
}

# Display order for output ports
PORT_ORDER = ['Ref', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8', 'o9', 'o10', 'o11']

# Visual style per port: (color, dash, linewidth)
# 10 clearly distinct hues — no two ports share a similar colour family.
PORT_STYLE: dict[str, tuple[str, list[int], float]] = {
    'Ref': ('#8b949e', [],  1.0),   # neutral grey
    'o2':  ('#388bfd', [],  1.2),   # blue
    'o3':  ('#3fb950', [],  1.2),   # green
    'o4':  ('#ffa657', [],  1.2),   # orange
    'o5':  ('#ff7b72', [],  1.2),   # red
    'o6':  ('#d2a8ff', [],  1.2),   # lavender
    'o7':  ('#2dd4bf', [],  1.2),   # teal
    'o8':  ('#e3b341', [],  1.2),   # amber
    'o9':  ('#f778ba', [],  1.2),   # pink
    'o10': ('#818cf8', [],  1.2),   # indigo
    'o11': ('#fb923c', [],  1.2),   # apricot
}


# ── Internal helpers ──────────────────────────────────────────────────────────

def _is_intc1to10_folder(name: str) -> bool:
    return 'intc1to10' in name.lower()


def _detect_mtype(dir_name: str) -> str:
    """Map a folder name to its measurement type key."""
    dl = dir_name.lower()
    if 'in8out6'    in dl: return 'in8out6_2'
    if 'in7out123'  in dl: return 'in7out123_234'
    if 'in7out453'  in dl: return 'in7out453_234'
    if 'in7out91011'   in dl: return 'in7out91011_234'
    if 'in7out121311'  in dl: return 'in7out121311_234'
    return 'unknown'


def _parse_csv(path: str) -> Optional[dict]:
    """
    Parse a single LossData*.csv (SANTEC TSL format).
    Returns {wl, CH2, CH3, CH4} or None on failure.
    """
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
    except OSError:
        return None

    # Find --DATA START-- marker
    data_start = None
    for i, line in enumerate(lines):
        if '--DATA START--' in line:
            data_start = i
            break
    if data_start is None:
        return None

    # Skip blank lines after marker
    hi = data_start + 1
    while hi < len(lines) and lines[hi].strip() == '':
        hi += 1
    if hi >= len(lines):
        return None

    # Parse header row
    header = re.split(r'[\t,;]+', lines[hi].strip())
    header = [h.replace('\ufeff', '').strip() for h in header]

    wl_idx = ch2_idx = ch3_idx = ch4_idx = -1
    for idx, h in enumerate(header):
        if re.search(r'wavelength', h, re.I):
            wl_idx = idx
        elif re.search(r'CH4', h, re.I):
            ch4_idx = idx
        elif re.search(r'CH3', h, re.I):
            ch3_idx = idx
        elif re.search(r'CH2', h, re.I):
            ch2_idx = idx

    if wl_idx < 0:
        return None

    wl, ch2, ch3, ch4 = [], [], [], []
    for line in lines[hi + 1:]:
        row = line.strip()
        if not row:
            continue
        cols = re.split(r'[\t,;]+', row)
        try:
            w = float(cols[wl_idx])
        except (ValueError, IndexError):
            continue
        wl.append(w)

        def _safe(i: int) -> float:
            try:
                return float(cols[i]) if i >= 0 else 0.0
            except (ValueError, IndexError):
                return 0.0

        ch2.append(_safe(ch2_idx))
        ch3.append(_safe(ch3_idx))
        ch4.append(_safe(ch4_idx))

    if not wl:
        return None
    return {'wl': wl, 'CH2': ch2, 'CH3': ch3, 'CH4': ch4}


def _average_il(il_lists: list[list[float]]) -> list[float]:
    """Element-wise average of multiple same-length IL arrays."""
    if not il_lists:
        return []
    n = len(il_lists)
    length = len(il_lists[0])
    return [sum(arr[i] for arr in il_lists) / n for i in range(length)]


# ── Public API ────────────────────────────────────────────────────────────────

def scan_directory(path: str) -> list[str]:
    """
    Scan *path* for intc1to10 device subdirectories.
    Returns a sorted, deduplicated list of device keys (mtype suffix stripped).
    """
    if not os.path.isdir(path):
        raise FileNotFoundError(f'Directory not found: {path}')

    keys: list[str] = []
    for entry in sorted(os.scandir(path), key=lambda e: e.name):
        if not entry.is_dir():
            continue
        if not _is_intc1to10_folder(entry.name):
            continue
        if not glob(os.path.join(entry.path, 'LossData*.csv')):
            continue
        # Strip trailing mtype suffix to get the device key
        key = re.sub(r'_(in\d+out[\d]+_\d+)$', '', entry.name, flags=re.IGNORECASE)
        if key not in keys:
            keys.append(key)
    return keys


def load_data(path: str, label: str) -> list[dict]:
    """
    Scan *path* for intc1to10 subfolders whose name contains *label*
    (case-insensitive).

    For each matching subfolder:
      - Identifies the measurement type from the folder name.
      - Parses all LossData*.csv files inside it.
      - Maps each channel to its physical output port (o2–o11 / Ref).
      - Accumulates multiple IL arrays per port (same port may appear in
        multiple folders or files) and returns their element-wise average.

    Returns a list of curve dicts: {label, wl, il, color, dash, lw}.
    """
    if not os.path.isdir(path):
        raise FileNotFoundError(f'Directory not found: {path}')

    lbl = label.lower()

    # port → list of IL arrays (same wavelength grid assumed)
    port_il: dict[str, list[list[float]]] = defaultdict(list)
    port_wl: dict[str, list[float]] = {}   # first wl grid seen per port

    for entry in sorted(os.scandir(path), key=lambda e: e.name):
        if not entry.is_dir():
            continue
        if not _is_intc1to10_folder(entry.name):
            continue
        if lbl not in entry.name.lower():
            continue

        mtype = _detect_mtype(entry.name)
        if mtype == 'unknown':
            continue

        mappings = MTYPE_CHANNELS.get(mtype, [])
        if not mappings:
            continue

        for csv_path in sorted(glob(os.path.join(entry.path, 'LossData*.csv'))):
            parsed = _parse_csv(csv_path)
            if parsed is None:
                continue
            for (ch, port, _desc) in mappings:
                il = parsed.get(ch, [])
                if not il:
                    continue
                port_il[port].append(il)
                if port not in port_wl:
                    port_wl[port] = parsed['wl']

    if not port_wl:
        return []

    # Build curves in canonical port order
    curves: list[dict] = []
    for port in PORT_ORDER:
        if port not in port_wl:
            continue
        il_avg = _average_il(port_il[port])
        if not il_avg:
            continue
        color, dash, lw = PORT_STYLE.get(port, ('#c9d1d9', [], 1.0))
        curves.append({
            'label': port,
            'wl':    port_wl[port],
            'il':    il_avg,
            'color': color,
            'dash':  dash,
            'lw':    lw,
        })

    return curves
