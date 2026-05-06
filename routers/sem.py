"""
routers/sem.py
──────────────
SEM image directory scanning and file serving.

Endpoints
---------
POST /api/sem-scan     List .bmp files in a server-side directory
GET  /api/sem-image    Serve a single BMP by absolute path
"""

import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()


class SemScanRequest(BaseModel):
    path: str   # absolute server-side directory path


@router.post("/api/sem-scan")
async def api_sem_scan(req: SemScanRequest):
    """List all .bmp files in *req.path*."""
    d = os.path.realpath(req.path)
    if not os.path.isdir(d):
        return JSONResponse({"error": f"Directory not found: {d}"}, status_code=200)
    files = sorted(f for f in os.listdir(d) if f.lower().endswith(".bmp"))
    return {"files": files, "dir": d}


@router.get("/api/sem-image")
async def api_sem_image(path: str):
    """Serve a single BMP file by its absolute server-side path."""
    real = os.path.realpath(path)
    if not os.path.isfile(real):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(real, media_type="image/bmp")
