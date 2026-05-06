# GDS Device Finder — Modular Edition

A photonics fabrication project manager: upload a GDS-II layout, auto-detect devices, correlate SEM images and optical measurement data.

---

## Quick start

```bash
cd projectmanager_v0.1a
python -m uvicorn app:app --reload --port 8000
# → open http://localhost:8000
```

---

## Repository layout

```
projectmanager_v0.1a/
│
├── app.py                     ← Thin bootstrap: mounts static files, wires routers
├── state.py                   ← Shared in-memory session dict
│
├── routers/                   ← One file per feature area (FastAPI APIRouter)
│   ├── gds.py                 ← GDS upload, device detection, export
│   ├── optical.py             ← Optical data scan and CSV load
│   ├── sem.py                 ← SEM directory scan and image serve
│   └── project.py             ← .gdspm project save / open
│
├── algorithms/                ← Optical device plugin registry
│   └── __init__.py            ← PLUGIN_REGISTRY dict — add new device types here
│
├── *_algorithms.py            ← One file per device type (plugin contract below)
│   ├── crosser_algorithms.py
│   ├── mrr_algorithms.py
│   ├── intc1to10_algorithms.py
│   └── loopback_algorithms.py
│
└── static/
    ├── index.html             ← Thin HTML shell (~440 lines, no inline JS/CSS)
    ├── css/
    │   └── app.css            ← All application styles
    └── js/                    ← One file per frontend concern
        ├── gds-parser.js      ← Client-side GDS-II binary parser (pure fn)
        ├── state.js           ← All global state variables
        ├── canvas.js          ← Canvas setup + world↔screen transforms
        ├── renderer.js        ← GDS draw, device map, overlays
        ├── panels.js          ← Cell list and layer list sidebars
        ├── gds-io.js          ← File upload, find-devices, backend sync
        ├── devices-panel.js   ← Device/group panel (right sidebar)
        ├── export.js          ← GDS export helper
        ├── navigation.js      ← Tab and sub-tab switching
        ├── interaction.js     ← Mouse / touch / resize handlers
        ├── modal.js           ← Modal dialogs + global keyboard shortcuts
        ├── sem.js             ← SEM image viewer (sub-tab 2)
        ├── project.js         ← Project file save / open
        ├── optical.js         ← Optical chart, CSV parsing, readout (sub-tabs 3 & 4)
        └── device-viewer.js   ← Device viewer core + app init() ← load LAST
```

---

## How to add a new backend feature

### New API endpoint

1. Create `routers/my_feature.py`:

```python
from fastapi import APIRouter
from state import session          # access shared session state
router = APIRouter()

@router.get("/api/my-endpoint")
async def my_endpoint():
    return {"ok": True}
```

2. Add two lines to `app.py`:

```python
from routers import my_feature           # one import
app.include_router(my_feature.router, tags=["My Feature"])  # one line
```

That's the entire change to `app.py`.

---

### New optical device type (plugin pattern)

Each optical device type is a **plugin** — a Python module with two functions:

```python
# algorithms/my_device.py

def scan_directory(path: str) -> list[str]:
    """Return sorted list of device keys found in path."""
    ...

def load_data(path: str, label: str) -> list[dict]:
    """Return curve dicts: [{label, wl, il, color, dash, lw}]."""
    ...
```

Then register it in `algorithms/__init__.py`:

```python
from algorithms import my_device

PLUGIN_REGISTRY["my_device"] = Plugin(
    type_label = "my_device",
    detect     = lambda folder_name: "my_keyword" in folder_name.lower(),
    module     = my_device,
)
```

The router, the scan endpoint, and the load endpoint pick it up automatically.
Nothing else changes.

---

## How to add a new frontend feature

### New JS module

1. Create `static/js/my-feature.js`. Add a header comment explaining what it owns and what it depends on:

```js
/*
 * my-feature.js — What this file is responsible for
 *
 * Depends on: state.js, canvas.js   (list what you read/call from other files)
 */

function myFeatureInit() { ... }
function myFeatureRender() { ... }
```

2. Add a `<script>` tag in `index.html` in the right load-order position (after your deps, before anything that calls your functions):

```html
<script src="/static/js/my-feature.js"></script>
```

### Adding a new sub-tab to the Device Viewer

The Device Viewer (Tab 3) currently has four sub-tabs. To add a fifth:

1. Add a button in `index.html` inside `#dv-header`:
   ```html
   <button class="dv-stab" id="dv-st5" onclick="setDvSubTab(5)">🔬 My Tab</button>
   ```

2. Add a sub-page div:
   ```html
   <div class="dv-subpage" id="dv-sub5"> ... </div>
   ```

3. In `device-viewer.js`, extend `setDvSubTab(n)` to handle `n === 5`.

4. Add your logic in a new `static/js/my-tab.js` file and load it before `device-viewer.js`.

---

## JavaScript load order

Scripts share the global scope (no ES module bundler required). Load order matters because later scripts can call functions defined in earlier ones.

```
gds-parser.js        ← no dependencies
state.js             ← no dependencies
canvas.js            ← state
renderer.js          ← state, canvas
panels.js            ← state
gds-io.js            ← state, canvas, renderer, panels
devices-panel.js     ← state, renderer, gds-io
export.js            ← state
navigation.js        ← state, renderer  (cross-refs device-viewer at event time)
interaction.js       ← state, canvas, renderer, navigation
modal.js             ← state
sem.js               ← state, navigation
project.js           ← state
optical.js           ← state, navigation
device-viewer.js     ← LAST: IIFE calls initCanvases, setupMouse,
                              _initSemPreviewHandlers, _initProjectHandlers,
                              redraw1, redraw2
```

> **Rule:** The IIFE in `device-viewer.js` runs at load time and calls functions
> from every other module.  Always keep `device-viewer.js` last.

---

## Key design decisions

### Why not ES modules (`import`/`export`)?

The app runs without a build step (no webpack/vite/esbuild). ES modules require
either a bundler or careful management of circular imports.  The current approach
— separate script files sharing the global scope — gives the same readability
benefits with zero tooling.  Migrating to ES modules is a future option once the
module boundaries are stable.

### Why a shared global `state.js`?

All frontend state (devices, groups, canvas refs, optical data) lives in one file.
This makes it easy to find any variable and avoids passing large state objects as
parameters.  The trade-off is implicit coupling — if you add state, add it to
`state.js` with a comment.

### Why `state.py` on the backend?

Same reason: the shared dict `session` is the single source of truth for the
server-side session.  Any router can read or write it without importing from
another router.

### The plugin pattern

Both the backend (`algorithms/__init__.py`) and the frontend (`optical.js`
→ `LOOPBACK_MTYPE_MAP` / `keyTypes` dict) follow the same plugin pattern:
a registry maps a type key to a set of behaviours.  Adding a new device type
means adding one entry to each registry — no existing code changes.

---

## Running tests (future)

No automated tests exist yet.  Suggested test files to add:

```
tests/
├── test_gds_algorithms.py     # parse + find_designs round-trip
├── test_optical_algorithms.py # CSV parse for each device type
├── test_routers.py            # FastAPI TestClient smoke tests
└── test_plugins.py            # verify PLUGIN_REGISTRY completeness
```

---

## Requirements

```
fastapi
uvicorn[standard]
pydantic
```

See `requirements.txt` for pinned versions.
