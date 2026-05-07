"""
algorithms/grating_algorithms.py
─────────────────────────────────
Optical grating coupler finder.

Locates grating-coupler bounding boxes within device footprints and
simultaneously expands each device bbox to include grating-layer polygons
that slightly protrude outside the original search-layer boundary.

Public API:
  find_optical_gratings(lib, cell_name, designs,
                        grating_layer=2, grating_datatype=6,
                        device_layer=1, device_datatype=0,
                        tolerance_um=1.0, fibre_pitch_um=None) -> dict

Returns:
  {
    gratings:         [{id, device_id, label, x0,y0,x1,y1, x0_um,...}],
    expanded_designs: [{...all original design fields with updated bbox...}],
    count:            int,
    message:          str,
  }
"""

from __future__ import annotations
from collections import defaultdict
from .gds_algorithms import _flatten, _bbox, _UF


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

def find_optical_gratings(
    lib: dict,
    cell_name: str,
    designs: list,
    grating_layer: int   = 2,
    grating_datatype: int = 6,
    device_layer: int    = 1,
    device_datatype: int = 0,
    tolerance_um: float  = 1.0,
    fibre_pitch_um: float | None = None,
) -> dict:
    """
    For every device bounding box:

    1.  Collect all grating_layer/grating_datatype polygons whose bbox
        overlaps the device bbox (± tolerance_um on each side).
    2.  Keep only those that also share a bbox-overlap with at least one
        device_layer/device_datatype polygon in the same region — this
        filters out stray grating-layer structures elsewhere on the chip.
    3.  Expand the device bbox to enclose any qualifying grating polygon
        that sticks slightly outside the original boundary.
    4.  Cluster the qualifying polygons by proximity (tolerance_um) using
        union-find, then compute a tight bbox per cluster.
    5.  Sort clusters right → left (descending x-centre); label G1 … G16.

    The fibre_pitch_um parameter is stored in the response for reference
    but does not currently gate which gratings are kept.
    """
    if not designs:
        return {
            'gratings': [], 'expanded_designs': [],
            'count': 0, 'message': 'No devices to search.',
        }

    cell = lib['cells'].get(cell_name)
    if cell is None:
        return {
            'gratings': [], 'expanded_designs': list(designs),
            'count': 0, 'message': f'Cell {cell_name!r} not found.',
        }

    dbunit   = lib['dbunit']
    tol_dbu  = max(tolerance_um, 0.0) * 1e-6 / dbunit

    # ── Flatten the cell once ────────────────────────────────────────────────
    all_shapes = _flatten(cell, lib['cells'])

    grating_shapes = [
        s for s in all_shapes
        if s['type'] == 'boundary'
        and s['layer'] == grating_layer
        and s['datatype'] == grating_datatype
    ]
    device_shapes = [
        s for s in all_shapes
        if s['type'] == 'boundary'
        and s['layer'] == device_layer
        and s['datatype'] == device_datatype
    ]

    if not grating_shapes:
        return {
            'gratings': [], 'expanded_designs': list(designs),
            'count': 0,
            'message': (
                f'No layer {grating_layer}/{grating_datatype} polygons found.'
            ),
        }

    g_bboxes = [_bbox(s['pts']) for s in grating_shapes]
    d_bboxes = [_bbox(s['pts']) for s in device_shapes]

    # ── AABB helpers ─────────────────────────────────────────────────────────

    def _overlaps(a, b, pad: float = 0.0) -> bool:
        return not (
            a[2] + pad < b[0] or b[2] < a[0] - pad or
            a[3] + pad < b[1] or b[3] < a[1] - pad
        )

    # ── Process each device ──────────────────────────────────────────────────
    all_gratings:   list[dict] = []
    expanded_designs: list[dict] = []
    grating_id = 0

    for dev in designs:
        dev_bb = (dev['x0'], dev['y0'], dev['x1'], dev['y1'])

        # Step 1 — grating polys touching device bbox (with tolerance)
        cand = [i for i, gb in enumerate(g_bboxes) if _overlaps(dev_bb, gb, tol_dbu)]

        # Step 2 — keep only those that also overlap a device-layer poly
        local_d = [db for db in d_bboxes if _overlaps(dev_bb, db)]
        qual = [i for i in cand if any(_overlaps(g_bboxes[i], db) for db in local_d)]

        # Step 3 — expand device bbox to include qualifying grating polys
        if qual:
            xs = [dev['x0'], dev['x1']]
            ys = [dev['y0'], dev['y1']]
            for i in qual:
                gb = g_bboxes[i]
                xs += [gb[0], gb[2]]
                ys += [gb[1], gb[3]]
            new_bb = (min(xs), min(ys), max(xs), max(ys))
        else:
            new_bb = dev_bb

        expanded_designs.append({
            **dev,
            'x0':    float(new_bb[0]), 'y0': float(new_bb[1]),
            'x1':    float(new_bb[2]), 'y1': float(new_bb[3]),
            'x0_um': float(new_bb[0]) * dbunit * 1e6,
            'y0_um': float(new_bb[1]) * dbunit * 1e6,
            'x1_um': float(new_bb[2]) * dbunit * 1e6,
            'y1_um': float(new_bb[3]) * dbunit * 1e6,
        })

        if not qual:
            continue

        # Step 4 — cluster qualifying polys by proximity (union-find)
        n  = len(qual)
        uf = _UF(n)
        for ii in range(n):
            bi = g_bboxes[qual[ii]]
            for jj in range(ii + 1, n):
                bj = g_bboxes[qual[jj]]
                if _overlaps(bi, bj, tol_dbu):
                    uf.union(ii, jj)

        clusters: dict[int, list[int]] = defaultdict(list)
        for ii in range(n):
            clusters[uf.find(ii)].append(qual[ii])

        # Compute per-cluster bbox
        cluster_bbs: list[tuple] = []
        for idx_list in clusters.values():
            xs2: list[float] = []
            ys2: list[float] = []
            for gi in idx_list:
                gb = g_bboxes[gi]
                xs2 += [gb[0], gb[2]]
                ys2 += [gb[1], gb[3]]
            cluster_bbs.append((min(xs2), min(ys2), max(xs2), max(ys2)))

        # Step 5 — sort right → left, label G1 … G16
        cluster_bbs.sort(key=lambda b: -(b[0] + b[2]) / 2)

        for rank, cb in enumerate(cluster_bbs[:16]):
            all_gratings.append({
                'id':        grating_id,
                'device_id': dev['id'],
                'label':     f'G{rank + 1}',
                'x0':    float(cb[0]), 'y0': float(cb[1]),
                'x1':    float(cb[2]), 'y1': float(cb[3]),
                'x0_um': float(cb[0]) * dbunit * 1e6,
                'y0_um': float(cb[1]) * dbunit * 1e6,
                'x1_um': float(cb[2]) * dbunit * 1e6,
                'y1_um': float(cb[3]) * dbunit * 1e6,
            })
            grating_id += 1

    n_dev_with = sum(1 for d in designs if any(
        g['device_id'] == d['id'] for g in all_gratings
    ))
    msg = (
        f'Found {grating_id} grating coupler{"s" if grating_id != 1 else ""} '
        f'across {n_dev_with} / {len(designs)} device{"s" if len(designs) != 1 else ""}.'
    )

    return {
        'gratings':         all_gratings,
        'expanded_designs': expanded_designs,
        'count':            grating_id,
        'message':          msg,
    }
