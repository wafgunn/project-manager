"""
algorithms/__init__.py
──────────────────────
Central plugin registry for optical device algorithms.

HOW TO ADD A NEW DEVICE TYPE
─────────────────────────────
1.  Create  algorithms/my_device.py  with these two functions:

        def scan_directory(path: str) -> list[str]:
            \"\"\"Return sorted list of device keys found in *path*.\"\"\"
            ...

        def load_data(path: str, label: str) -> list[dict]:
            \"\"\"Return list of curve dicts: {label, wl, il, color, dash, lw}.\"\"\"
            ...

2.  Add an entry to PLUGIN_REGISTRY below:

        from algorithms import my_device   # or: from . import my_device
        PLUGIN_REGISTRY["my_device"] = Plugin(
            type_label = "my_device",
            detect     = lambda folder_name: "my_keyword" in folder_name.lower(),
            module     = my_device,
        )

That's it — routers/optical.py calls only this module.

Detection priority: dict insertion order (Python 3.7+).
The first matching plugin wins for a given folder name.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

# ── Import algorithm modules (relative — all live in this package) ────────────
from . import mrr_algorithms
from . import crosser_algorithms
from . import intc1to10_algorithms
from . import loopback_algorithms


# ── Plugin descriptor ─────────────────────────────────────────────────────────

@dataclass
class Plugin:
    type_label: str                      # e.g. "mrr", "crosser"
    detect:     Callable[[str], bool]    # detect(folder_name) -> bool
    module:     object                   # has scan_directory() and load_data()


# ── Registry (ordered — first match wins) ────────────────────────────────────

PLUGIN_REGISTRY: dict[str, Plugin] = {
    "mrr": Plugin(
        type_label = "mrr",
        detect     = lambda name: "mrrs" in name.lower(),
        module     = mrr_algorithms,
    ),
    "crosser": Plugin(
        type_label = "crosser",
        detect     = lambda name: "crossers" in name.lower(),
        module     = crosser_algorithms,
    ),
    "intc1to10": Plugin(
        type_label = "intc1to10",
        detect     = lambda name: "intc1to10" in name.lower(),
        module     = intc1to10_algorithms,
    ),
    "loopback": Plugin(
        type_label = "loopback",
        detect     = lambda name: "loopbacks" in name.lower(),
        module     = loopback_algorithms,
    ),
}
