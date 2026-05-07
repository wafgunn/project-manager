# Photonic Chip Project Manager

We all know how to use Python to read, manipulate, plot and compare lab data. The problem is that after a day of measurements you end up with 90 separate Matplotlib windows, a 36-subplot figure you're squinting at, and a folder of CSVs that made sense at 11pm but not at 9am the next morning. When you're trying to work out how a chip is performing across devices, ports, wavelengths, and SEM conditions simultaneously, that workflow falls apart fast.

This tool is a web-based project manager and data comparer for photonic integrated circuits. Rather than scripting each analysis from scratch, you load your GDS layout, point the app at your SEM and optical data directories, and use the browser interface to correlate device geometry with measured performance. Devices are automatically detected from the layout, grouped, and linked to their corresponding measurement data. SEM images, optical spectra, waveguide length measurements, chip loss corrections, and analysis state are all stored together in a single `.gdspm` project file that you can save and reload at any point.

The intent is not to replace Python — it's to give you a persistent, visual workspace where you can efficiently appraise chip performance without rebuilding your analysis every session.

---

## What the app does

- **GDS viewer** — Upload a GDS-II binary, browse cells and layers, pan/zoom the layout
- **Device detection** — Auto-find devices by grating coupler geometry; group them by type and label
- **SEM viewer** — Scan a directory of SEM images, align and overlay them on the GDS layout with rotation and nm/px calibration
- **Optical spectra** — Load optical CSV data, plot insertion loss, subtract reference curves, apply chip loss correction relative to waveguide path lengths
- **Waveguide measurements** — Measure path lengths between grating pairs in the GDS; used by the chip loss correction
- **Project save / open** — Persist all state (GDS binary, device groups, SEM settings, optical settings, measurements) to a portable `.gdspm` JSON file

---

## Quick start

```bash
cd projectmanager_v0.1a
pip install -r requirements.txt
python -m uvicorn app:app --reload --port 8000
# open http://localhost:8000
```

Set the project file path in the top bar (e.g. `/path/to/myproject.gdspm`), upload your GDS, and save. On future sessions, paste the same path and click Open.

---

## Repository layout

```
projectmanager_v0.1a/
│
├── app.py                      ← Thin bootstrap: mounts static files, wires routers
├── state.py                    ← Shared in-memory session dict
│
├── routers/                    ← One file per feature area (FastAPI APIRouter)
│   ├── gds.py                  ← GDS upload, device detection, export
│   ├── optical.py              ← Optical data scan and CSV load
│   ├── sem.py                  ← SEM directory scan and image serve
│   └── project.py              ← .gdspm project save / open
│
├── algorithms/                 ← Optical device plugin registry
│   └── __init__.py             ← PLUGIN_REGISTRY dict — add new device types here
│
├── *_algorithms.py             ← One file per device type (plugin contract below)
│   ├── crosser_algorithms.py
│   ├── mrr_algorithms.py
│   ├── intc1to10_algorithms.py
│   └── loopback_algorithms.py
│
└── static/
    ├── index.html              ← HTML shell — layout, toolbars, sub-tabs
    ├── css/
    │   └── app.css             ← All application styles
    └── js/                     ← One file per frontend concern
        ├── gds-parser.js       ← Client-side GDS-II binary parser (pure fn)
        ├── state.js            ← All global state variables
        ├── canvas.js           ← Canvas setup + world↔screen transforms
        ├── renderer.js         ← GDS draw, device map, overlays
        ├── panels.js           ← Cell list and layer list sidebars
        ├── gds-io.js           ← File upload, find-devices, backend sync
        ├── devices-panel.js    ← Device/group panel (right sidebar)
        ├── export.js           ← GDS export helper
        ├── navigation.js       ← Tab and sub-tab switching
        ├── interaction.js      ← Mouse / touch / resize handlers
        ├── modal.js            ← Modal dialogs + global keyboard shortcuts
        ├── sem.js              ← SEM image viewer (sub-tab 2)
        ├── project.js          ← Project file save / open
        ├── optical.js          ← Optical chart, CSV parsing, readout (sub-tabs 3 & 4)
        ├── gratings.js         ← Grating coupler finder
        ├── waveguides.js       ← Waveguide length measurements
        └── device-viewer.js    ← Device viewer core + app init() ← load LAST
```

### JavaScript load order

Scripts share the global scope — no bundler required. Load order matters because later scripts call functions from earlier ones.

```
gds-parser.js        ← no dependencies
state.js             ← no dependencies
canvas.js            ← state
renderer.js          ← state, canvas
panels.js            ← state
gds-io.js            ← state, canvas, renderer, panels
devices-panel.js     ← state, renderer, gds-io
export.js            ← state
navigation.js        ← state, renderer
interaction.js       ← state, canvas, renderer, navigation
modal.js             ← state
sem.js               ← state, navigation
project.js           ← state
optical.js           ← state, navigation
gratings.js          ← state
waveguides.js        ← state, optical
device-viewer.js     ← LAST: calls init functions from all other modules
```

`device-viewer.js` runs an IIFE at load time that calls into every other module. Keep it last.

---

## Removing a feature block

Each frontend feature is isolated in its own JS file and its own section of `index.html`. The backend mirrors this — each feature area is a separate router. This means any block can be removed without touching unrelated code.

**To remove a frontend feature (e.g. the SEM viewer):**

1. Delete or comment out the `<script src="/static/js/sem.js"></script>` tag in `index.html`
2. Remove the corresponding sub-tab button and `<div class="dv-subpage">` block from `index.html`
3. In `device-viewer.js`, remove the `_initSemPreviewHandlers()` call from the init IIFE and any `if(dvSubTab===2)` branch in `setDvSubTab`
4. Remove `semServerPath`, `_semRotAngle`, `_semNmPerPx` etc. from `state.js` and the corresponding save/restore blocks in `project.js`

Nothing outside `sem.js` calls into it at load time — the coupling is one-way (sem.js reads from state.js, not the reverse). The same pattern holds for `optical.js`, `gratings.js`, and `waveguides.js`.

**To remove a backend feature (e.g. the SEM router):**

1. Delete `routers/sem.py`
2. Remove the two lines that import and register it in `app.py`

The remaining routers are unaffected — they don't reference each other.

**Save / open state:** If you remove a feature, also clean up its keys from `saveProject()` and `_applyProject()` in `project.js`. Leftover keys in a saved `.gdspm` are silently ignored on open, so old project files remain loadable.

---

## Adding a new feature

### New frontend module

1. Create `static/js/my-feature.js` with a header comment stating what it owns and what it reads from other files:

```js
/*
 * my-feature.js — Short description of responsibility
 *
 * Depends on: state.js, optical.js
 */

function myFeatureInit() { ... }
function myFeatureRender() { ... }
```

2. Add a `<script>` tag in `index.html` after your dependencies, before `device-viewer.js`:

```html
<script src="/static/js/my-feature.js"></script>
```

3. If the feature has persistent state, declare the variables in `state.js` with a comment, and add save/restore keys to `project.js`.

### New sub-tab in the Device Viewer

The Device Viewer (Tab 3) uses numbered sub-tabs. To add one:

1. Add a button in `index.html` inside `#dv-header`:
   ```html
   <button class="dv-stab" id="dv-st5" onclick="setDvSubTab(5)">🔬 My Tab</button>
   ```

2. Add the sub-page div:
   ```html
   <div class="dv-subpage" id="dv-sub5"> ... content ... </div>
   ```

3. In `device-viewer.js`, extend `setDvSubTab(n)` — add `5` to the loop range and add an `if(n===5)` handler for any render calls your tab needs.

4. Put all tab logic in `my-feature.js` and load it before `device-viewer.js`.

### New backend router

1. Create `routers/my_feature.py`:

```python
from fastapi import APIRouter
from state import session
router = APIRouter()

@router.post("/api/my-endpoint")
async def my_endpoint(body: dict):
    return {"ok": True}
```

2. Add two lines to `app.py`:

```python
from routers import my_feature
app.include_router(my_feature.router, tags=["My Feature"])
```

That is the only change to `app.py`.

### New optical device type (plugin pattern)

Each optical device type is a Python plugin with two functions:

```python
# algorithms/my_device_algorithms.py

def scan_directory(path: str) -> list[str]:
    """Return sorted list of device keys found in path."""
    ...

def load_data(path: str, label: str) -> list[dict]:
    """Return list of curve dicts: [{label, wl, il, color, dash, lw}]."""
    ...
```

Register it in `algorithms/__init__.py`:

```python
from algorithms import my_device_algorithms

PLUGIN_REGISTRY["my_device"] = Plugin(
    type_label = "my_device",
    detect     = lambda folder_name: "my_keyword" in folder_name.lower(),
    module     = my_device_algorithms,
)
```

On the frontend, add your curve definitions to `optical.js` following the same pattern as `OPT_CURVE_DEFS` or `INTC1TO10_MTYPE_MAP` — a dict that maps a file-path-detected mtype to labelled channel assignments. The router, scan endpoint, and load endpoint all pick up new plugins automatically.

---

## A note on file conventions and agentic AI

Most of the file naming conventions, grating numbering schemes, CSV column formats, and device-type detection heuristics in this codebase are specific to one lab's measurement setup. They almost certainly won't match yours.

The value of the modular layout is that you don't have to understand the whole codebase to change one part of it. Each JS file has a clear header describing what it owns and what it depends on. Each router handles one feature. Each algorithm file handles one device type. These boundaries are designed to be legible to an agentic AI coding assistant.

The recommended workflow for adapting the tool is: describe your measurement setup, file conventions, or analysis requirements to an AI coding assistant, point it at the relevant module (e.g. `crosser_algorithms.py`, `optical.js`, `waveguides.js`), and ask it to modify or extend that module. Because the modules are isolated, the assistant can make targeted changes without needing to reason about the whole application. New device types, custom corrections, different CSV formats, and additional viewer panels can all be added this way — one module at a time, tested incrementally, without destabilising the rest of the tool.

---

## Requirements

```
fastapi
uvicorn[standard]
pydantic
```

See `requirements.txt` for pinned versions.
