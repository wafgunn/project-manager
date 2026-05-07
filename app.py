"""
app.py
──────
Application entry-point and static-file mount.

Run:
    uvicorn app:app --reload --port 8000

This file is intentionally minimal — all business logic lives in routers/.
To add a new feature area, create routers/my_feature.py and include its
router below.  No other file needs to change.
"""

import os

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from routers import gds, optical, sem, project, gratings, waveguides

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title       = "GDS Device Finder",
    description = "Modular GDS/optical/SEM analysis platform",
    version     = "2.0.0",
)

# ── Static files ──────────────────────────────────────────────────────────────

_STATIC = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=_STATIC), name="static")


@app.get("/")
async def index():
    return FileResponse(os.path.join(_STATIC, "index.html"))


# ── Feature routers ───────────────────────────────────────────────────────────
# Each router owns one feature area.  Order matters for /docs display only.

app.include_router(gds.router,      tags=["GDS"])
app.include_router(optical.router,  tags=["Optical"])
app.include_router(sem.router,      tags=["SEM"])
app.include_router(project.router,  tags=["Project"])
app.include_router(gratings.router,   tags=["Gratings"])
app.include_router(waveguides.router, tags=["Waveguides"])


# ── Dev server ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
