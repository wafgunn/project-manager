"""
routers/gratings.py
───────────────────
Optical grating coupler detection.

Endpoints
---------
POST /api/find-gratings   Detect grating couplers within device bounding boxes
                          and return expanded device bboxes.
"""

from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from algorithms.grating_algorithms import find_optical_gratings
from state import session

router = APIRouter()


class FindGratingsRequest(BaseModel):
    grating_layer:    int            = 2
    grating_datatype: int            = 6
    device_layer:     int            = 1
    device_datatype:  int            = 0
    tolerance_um:     float          = 1.0
    fibre_pitch_um:   Optional[float] = None
    # Frontend sends its devices array so the endpoint works after a .gdspm
    # open (where the backend session has no designs yet).
    designs:          list           = []
    # Frontend always knows the active cell; session["active_cell"] is reset
    # to "" by /api/upload so we prefer the client value.
    active_cell:      str            = ""


@router.post("/api/find-gratings")
async def api_find_gratings(req: FindGratingsRequest):
    """
    Detect optical grating couplers within device bounding boxes.

    Accepts an optional `designs` list from the frontend so the endpoint
    works correctly after a .gdspm project open (the backend session may not
    hold designs yet because they were restored client-side from JSON, not by
    re-running find-designs).  Falls back to session designs when present.

    Returns:
      • gratings:         list of grating bbox dicts
      • expanded_designs: device bboxes expanded to fully include any grating
                          polygons that protruded beyond the original boundary
      • count, message
    """
    if "lib" not in session:
        raise HTTPException(status_code=400, detail="No GDS file loaded.")

    # Prefer session designs (already have server-side expansions); fall back
    # to the frontend-supplied list (populated after a .gdspm open).
    designs = session.get("designs") or req.designs
    if not designs:
        raise HTTPException(
            status_code=400,
            detail="No devices found. Run Find Devices first.",
        )

    # If we used the client-supplied list, write it into session so any bbox
    # expansions from this call persist for subsequent operations.
    if not session.get("designs") and req.designs:
        session["designs"] = req.designs

    # Resolve cell name: prefer client value, then session, then last cell in lib.
    cell_name = (
        req.active_cell
        or session.get("active_cell", "")
        or (list(session["lib"]["cells"].keys()) or [""])[-1]
    )
    # Also persist so downstream endpoints stay consistent.
    if cell_name:
        session["active_cell"] = cell_name

    try:
        result = find_optical_gratings(
            session["lib"],
            cell_name,
            designs,
            grating_layer=req.grating_layer,
            grating_datatype=req.grating_datatype,
            device_layer=req.device_layer,
            device_datatype=req.device_datatype,
            tolerance_um=req.tolerance_um,
            fibre_pitch_um=req.fibre_pitch_um,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Grating detection error: {exc}")

    # Persist gratings in session
    session["gratings"] = result.get("gratings", [])

    # Update session designs with expanded bboxes (preserve labels / color hints)
    expanded_map = {d["id"]: d for d in result.get("expanded_designs", [])}
    _bbox_keys = ("x0", "y0", "x1", "y1", "x0_um", "y0_um", "x1_um", "y1_um")
    for d in session["designs"]:
        exp = expanded_map.get(d["id"])
        if exp:
            for k in _bbox_keys:
                d[k] = exp[k]

    return result
