"""
routers/waveguides.py
─────────────────────
Waveguide centreline-length measurement between grating couplers.

Endpoints
---------
POST /api/measure-waveguides   Trace waveguide paths and return lengths
"""

from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from algorithms.waveguide_algorithms import measure_waveguide_lengths
from state import session

router = APIRouter()


class WaveguideRequest(BaseModel):
    # Which gratings to measure between
    from_label:   str             = "G1"
    to_labels:    Optional[list]  = None     # None = all other gratings on device

    # Layer settings
    wg_layer:       int   = 1
    wg_datatype:    int   = 0
    grating_layer:  int   = 2
    grating_datatype: int = 6
    comp_layer:     int   = 68
    comp_datatype:  int   = 0
    wg_width_um:    float = 0.5

    # Device selection: list of device IDs to measure
    # (frontend sends one device, group, or type subset)
    device_ids: list = []

    # Frontend-supplied state (fallback when session is empty, e.g. after .gdspm open)
    designs:     list = []
    gratings:    list = []
    active_cell: str  = ""


@router.post("/api/measure-waveguides")
async def api_measure_waveguides(req: WaveguideRequest):
    """
    Trace waveguide centreline lengths between grating couplers.

    Accepts frontend-supplied designs and gratings so the endpoint works
    after a .gdspm open where the backend session may be empty.
    """
    if "lib" not in session:
        raise HTTPException(status_code=400, detail="No GDS file loaded.")

    # ── Resolve session data, falling back to frontend-supplied lists ─────────
    designs  = session.get("designs")  or req.designs
    gratings = session.get("gratings") or req.gratings

    if not designs:
        raise HTTPException(
            status_code=400,
            detail="No devices found. Run Find Devices first.",
        )
    if not gratings:
        raise HTTPException(
            status_code=400,
            detail="No gratings found. Run Find Optical Gratings first.",
        )

    # Persist to session if we used client-supplied data
    if not session.get("designs") and req.designs:
        session["designs"] = req.designs
    if not session.get("gratings") and req.gratings:
        session["gratings"] = req.gratings

    # ── Resolve cell name ─────────────────────────────────────────────────────
    cell_name = (
        req.active_cell
        or session.get("active_cell", "")
        or (list(session["lib"]["cells"].keys()) or [""])[-1]
    )
    if cell_name:
        session["active_cell"] = cell_name

    # ── Select which devices to measure ───────────────────────────────────────
    if req.device_ids:
        id_set = set(req.device_ids)
        devices_to_measure = [d for d in designs if d["id"] in id_set]
    else:
        devices_to_measure = designs   # measure all if none specified

    if not devices_to_measure:
        raise HTTPException(status_code=400, detail="No matching devices found.")

    # ── Run algorithm ─────────────────────────────────────────────────────────
    try:
        result = measure_waveguide_lengths(
            lib              = session["lib"],
            cell_name        = cell_name,
            devices_to_measure = devices_to_measure,
            all_gratings     = gratings,
            from_label       = req.from_label,
            to_labels        = req.to_labels,
            wg_layer         = req.wg_layer,
            wg_datatype      = req.wg_datatype,
            grating_layer    = req.grating_layer,
            grating_datatype = req.grating_datatype,
            comp_layer       = req.comp_layer,
            comp_datatype    = req.comp_datatype,
            wg_width_um      = req.wg_width_um,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Waveguide measurement error: {exc}")

    # Persist results in session
    session["wg_lengths"] = result.get("results", [])

    return result
