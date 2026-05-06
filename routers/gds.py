"""
routers/gds.py
──────────────
GDS file upload, device detection, grouping, label management, and export.

Endpoints
---------
POST /api/upload          Upload and parse a .gds file
POST /api/find-designs    Run device-detection algorithm
POST /api/group-devices   Cluster detected devices into arrays
POST /api/set-designs     Overwrite designs from client-side edits
POST /api/update-labels   Persist user-edited array names / device labels
GET  /api/export-gds      Download annotated GDS with bbox layer 999/0
GET  /api/state           Session summary (used on page refresh)
"""

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from algorithms.gds_algorithms import (
    find_designs,
    generate_gds_with_bboxes,
    group_devices,
    parse_gds_python,
)
from state import session

router = APIRouter()


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("/api/upload")
async def upload_gds(file: UploadFile = File(...)):
    """
    Accept a raw GDS-II file, parse it, and return cell/layer metadata.
    Clears any previous session state.
    """
    raw = await file.read()
    try:
        lib = parse_gds_python(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"GDS parse error: {exc}")

    session.clear()
    session["lib"]         = lib
    session["raw"]         = raw
    session["filename"]    = file.filename or "upload.gds"
    session["designs"]     = []
    session["arrays"]      = []
    session["active_cell"] = ""

    # Collect all layer/datatype pairs across the whole library
    layer_set: set[str] = set()
    for cell in lib["cells"].values():
        for b in cell["boundaries"]:
            layer_set.add(f"{b['layer']}/{b['datatype']}")
        for p in cell["paths"]:
            layer_set.add(f"{p['layer']}/{p['datatype']}")
        for t in cell["texts"]:
            layer_set.add(f"{t['layer']}/{t['datatype']}")

    def _layer_key(s: str):
        parts = s.split("/")
        return (int(parts[0]), int(parts[1]))

    return {
        "cells":    list(lib["cells"].keys()),
        "layers":   sorted(layer_set, key=_layer_key),
        "dbunit":   lib["dbunit"],
        "libname":  lib["name"],
        "filename": file.filename,
    }


# ── Find designs ──────────────────────────────────────────────────────────────

class FindDesignsRequest(BaseModel):
    cell:             str
    tolerance_um:     float = 0.1   # grouping buffer radius in µm
    search_layer:     int   = 1     # GDS layer to search for device outlines
    search_datatype:  int   = 0     # GDS datatype to search for device outlines


@router.post("/api/find-designs")
async def api_find_designs(req: FindDesignsRequest):
    """
    Run the device-detection algorithm on the uploaded GDS.
    tolerance_um controls the merge radius for adjacent polygons (default 100 nm).
    search_layer / search_datatype select which GDS layer holds device outlines
    (default 1/0).
    """
    if "lib" not in session:
        raise HTTPException(status_code=400, detail="No GDS file loaded.")

    try:
        result = find_designs(
            session["lib"], req.cell, req.tolerance_um,
            req.search_layer, req.search_datatype,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Algorithm error: {exc}")

    session["designs"]     = result.get("designs", [])
    session["active_cell"] = req.cell
    session["arrays"]      = []   # clear stale grouping
    return result


# ── Group devices ─────────────────────────────────────────────────────────────

@router.post("/api/group-devices")
async def api_group_devices():
    """
    Cluster previously-detected bounding boxes into rectangular device arrays.
    """
    if not session.get("designs"):
        raise HTTPException(
            status_code=400,
            detail="Run Find Designs first (no designs in memory).",
        )

    try:
        result = group_devices(session["designs"], session["lib"]["dbunit"])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Algorithm error: {exc}")

    session["arrays"] = result.get("arrays", [])
    return result


# ── Set designs (client-side merge) ──────────────────────────────────────────

class SetDesignsRequest(BaseModel):
    designs: list   # [{id, x0, y0, x1, y1, x0_um, y0_um, x1_um, y1_um, label, color}]


@router.post("/api/set-designs")
async def api_set_designs(req: SetDesignsRequest):
    """
    Overwrite the server-side designs list (e.g. after a client-side merge).
    Clears existing grouping because it is now stale.
    """
    session["designs"] = req.designs
    session["arrays"]  = []
    return {"ok": True, "count": len(req.designs)}


# ── Update labels ─────────────────────────────────────────────────────────────

class UpdateLabelsRequest(BaseModel):
    arrays: list   # [{id, name, devices: [{design_id, col, row, label}]}]


@router.post("/api/update-labels")
async def api_update_labels(req: UpdateLabelsRequest):
    """
    Persist user-edited array names and device labels.
    Labels exist only in memory — they are NOT written into the GDS file.
    """
    session["arrays"] = req.arrays

    label_map = {
        dev["design_id"]: dev["label"]
        for arr in req.arrays
        for dev in arr.get("devices", [])
    }
    for d in session.get("designs", []):
        d["label"] = label_map.get(d["id"])

    return {"ok": True, "updated": len(label_map)}


# ── Export GDS ────────────────────────────────────────────────────────────────

@router.get("/api/export-gds")
async def api_export_gds(out_layer: int = 1, out_datatype: int = 100):
    """
    Return a modified GDS file with bounding-box rectangles on *out_layer*/*out_datatype*
    for every detected device.  Default output layer is 1/100.  Labels are not embedded.
    """
    if "raw" not in session or not session.get("designs"):
        raise HTTPException(
            status_code=400,
            detail="No GDS or no designs available for export.",
        )

    cell_name = session.get("active_cell", "")
    try:
        gds_bytes = generate_gds_with_bboxes(
            session["raw"], session["designs"], cell_name,
            out_layer, out_datatype,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Export error: {exc}")

    original = session.get("filename", "design.gds")
    stem     = original.rsplit(".", 1)[0] if "." in original else original
    out_name = f"{stem}_designs.gds"

    return Response(
        content=gds_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{out_name}"'},
    )


# ── State summary ─────────────────────────────────────────────────────────────

@router.get("/api/state")
async def api_state():
    """Lightweight session summary used by the frontend on page refresh."""
    return {
        "has_gds":       "lib" in session,
        "filename":      session.get("filename"),
        "active_cell":   session.get("active_cell", ""),
        "designs_count": len(session.get("designs", [])),
        "arrays_count":  len(session.get("arrays", [])),
        "dbunit":        session["lib"]["dbunit"] if "lib" in session else None,
    }
