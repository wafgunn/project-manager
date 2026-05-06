"""
routers/optical.py
──────────────────
Server-side optical data: directory scanning and CSV parsing.

Endpoints
---------
POST /api/optical-scan    Scan a directory for device sub-folders
POST /api/optical-data    Load and return curve data for a single device

Adding a new device type: edit algorithms/__init__.py — this router
never needs to change.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from algorithms import PLUGIN_REGISTRY, Plugin

router = APIRouter()


# ── Internal helpers ──────────────────────────────────────────────────────────

def _candidate_dirs(path: str) -> list[str]:
    """
    Return *path* itself plus every immediate sub-directory.

    This supports two layout styles without requiring changes to individual
    algorithm modules:
      • Flat:     path/device_xxx/
      • Category: path/crossers/device_xxx/
    """
    import os
    dirs = [path]
    try:
        for entry in os.scandir(path):
            if entry.is_dir():
                dirs.append(entry.path)
    except OSError:
        pass
    return dirs


def _scan_ex(path: str) -> list[dict]:
    """
    Scan *path* (+ immediate sub-dirs) and classify every device folder
    against PLUGIN_REGISTRY.  Returns [{key, type}], deduplicated.
    """
    import os
    if not os.path.isdir(path):
        raise FileNotFoundError(f"Directory not found: {path}")

    seen: set[str]   = set()
    ordered: list[dict] = []

    for scan_path in _candidate_dirs(path):
        for plugin in PLUGIN_REGISTRY.values():
            try:
                keys = plugin.module.scan_directory(scan_path)
            except Exception:
                keys = []
            for key in keys:
                tag = f"{plugin.type_label}::{key}"
                if tag not in seen:
                    seen.add(tag)
                    ordered.append({"key": key, "type": plugin.type_label})

    return ordered


def _load_auto(path: str, label: str) -> list[dict]:
    """
    Auto-detect device type by matching folder names against every plugin,
    then delegate to that plugin's load_data().
    """
    import os
    if not os.path.isdir(path):
        raise FileNotFoundError(f"Directory not found: {path}")

    lbl = label.lower()
    for scan_path in _candidate_dirs(path):
        for plugin in PLUGIN_REGISTRY.values():
            try:
                entries = list(os.scandir(scan_path))
            except OSError:
                continue
            for entry in entries:
                if (entry.is_dir()
                        and plugin.detect(entry.name)
                        and lbl in entry.name.lower()):
                    return plugin.module.load_data(scan_path, label)
    return []


# ── Endpoints ─────────────────────────────────────────────────────────────────

class OpticalScanRequest(BaseModel):
    path: str   # absolute server-side directory path


@router.post("/api/optical-scan")
async def api_optical_scan(req: OpticalScanRequest):
    """
    Scan *req.path* for optical device folders.

    Device types are determined by PLUGIN_REGISTRY in algorithms/__init__.py.
    Returns:
      devices — [{key, type}] for every detected device
      keys    — crosser keys only (legacy compatibility field)
    """
    if not req.path:
        raise HTTPException(status_code=400, detail="path is required.")
    try:
        devices = _scan_ex(req.path)
    except FileNotFoundError as exc:
        return JSONResponse({"error": str(exc)}, status_code=200)
    except Exception as exc:
        return JSONResponse({"error": f"Scan error: {exc}"}, status_code=200)

    keys = [d["key"] for d in devices if d["type"] == "crosser"]
    return {"keys": keys, "devices": devices, "count": len(devices)}


class OpticalDataRequest(BaseModel):
    path:      str             # absolute server-side directory path
    label:     str             # device label to match against subfolder names
    data_type: str = "auto"    # plugin type_label, or "auto" to infer


@router.post("/api/optical-data")
async def api_optical_data(req: OpticalDataRequest):
    """
    Load curve data for a single device.

    If data_type is "auto", the type is inferred from subfolder names.
    Otherwise, the named plugin is used directly.
    """
    if not req.path or not req.label:
        raise HTTPException(status_code=400, detail="path and label are required.")

    try:
        if req.data_type == "auto":
            curves = _load_auto(req.path, req.label)
        elif req.data_type in PLUGIN_REGISTRY:
            plugin = PLUGIN_REGISTRY[req.data_type]
            curves = []
            for scan_path in _candidate_dirs(req.path):
                curves = plugin.module.load_data(scan_path, req.label)
                if curves:
                    break
        else:
            curves = _load_auto(req.path, req.label)   # unknown type → fallback
    except FileNotFoundError as exc:
        return JSONResponse({"error": str(exc)}, status_code=200)
    except Exception as exc:
        return JSONResponse({"error": f"Scan error: {exc}"}, status_code=200)

    return {"curves": curves, "count": len(curves)}
