"""
routers/project.py
──────────────────
Project file save / open (.gdspm format).

The .gdspm file is plain JSON written to a user-chosen server-side path.
Relative paths stored inside it are resolved against the project file's
own directory when the file is opened, so the project folder is portable.

Endpoints
---------
POST /api/project/save   Write a .gdspm file
POST /api/project/open   Read and resolve a .gdspm file
"""

import json
import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter()


class ProjectSaveRequest(BaseModel):
    path:  str    # absolute path for the .gdspm file
    state: dict   # full project state object from the frontend


@router.post("/api/project/save")
async def api_project_save(req: ProjectSaveRequest):
    """Serialise *req.state* as JSON and write it to *req.path*."""
    real = os.path.realpath(req.path)
    os.makedirs(os.path.dirname(real), exist_ok=True)
    with open(real, "w", encoding="utf-8") as f:
        json.dump(req.state, f)
    return {"ok": True, "path": real}


class ProjectOpenRequest(BaseModel):
    path: str   # absolute path to an existing .gdspm file


@router.post("/api/project/open")
async def api_project_open(req: ProjectOpenRequest):
    """
    Read and return a .gdspm file.

    Relative SEM / optical paths stored in the file are resolved to absolute
    paths using the project file's directory as the base, making the project
    folder relocatable.
    """
    real = os.path.realpath(req.path)
    if not os.path.isfile(real):
        return JSONResponse({"error": f"File not found: {real}"}, status_code=200)

    with open(real, "r", encoding="utf-8") as f:
        data = json.load(f)

    base = os.path.dirname(real)
    for key in ("semServerPath", "optServerPath"):
        val = data.get(key, "")
        if val and not os.path.isabs(val):
            data[key] = os.path.normpath(os.path.join(base, val))

    data["_projectDir"] = base
    return data
