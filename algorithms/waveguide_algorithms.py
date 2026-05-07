"""
algorithms/waveguide_algorithms.py
────────────────────────────────────
Waveguide centreline-length measurement between grating couplers.

PRIMARY ALGORITHM  (requires Shapely ≥ 1.6)
────────────────────────────────────────────
For each (from-grating, to-grating) pair:

  1.  Collect all layer-wg_layer/wg_datatype shapes inside the device bbox.

  2.  Convert each shape to a Shapely geometry buffered by 5 nm (to bridge
      GDS integer-rounding gaps at polygon edges):
        • boundary  →  Polygon(pts).buffer(ε)
        • path      →  LineString(pts).buffer(wg_width/2 + ε)

  3.  shapely.ops.unary_union → a MultiPolygon whose individual polygons are
      the physically disconnected waveguide segments / loops on the chip.

  4.  Keep only components that intersect BOTH the from-grating bbox AND the
      to-grating bbox.  Pick the component with the LARGEST total area:
        • A direct bus waveguide between two gratings occupies
          ~wg_width × pitch ≈ 0.5 µm × 127 µm ≈ 64 µm²
        • A loopback waveguide occupies ~0.5 µm × 1000+ µm ≈ 500+ µm²
      → The loopback is always selected, never the short bus.

  5.  Assign each original shape to the chosen component (intersection test).
      Compute true centreline length:
        • boundary  →  shoelace_area(pts) / wg_width
                       (exact for any uniform-width strip: rectangles, arcs,
                        Euler bends; independent of curvature)
        • path      →  Σ |segment_i|
                       (centreline vertices are explicit in GDS path elements)

FALLBACK  (pure Python, no Shapely)
─────────────────────────────────────
  Union-find on shape bboxes (expanded by 5 nm + half wg-width for paths)
  to build connected components.  Same "pick largest touching both gratings"
  heuristic and area/width length formula.

PUBLIC API
──────────
  measure_waveguide_lengths(
      lib, cell_name, devices_to_measure, all_gratings,
      from_label, to_labels,
      wg_layer=1, wg_datatype=0,
      grating_layer=2, grating_datatype=6,
      comp_layer=68, comp_datatype=0,
      wg_width_um=0.5
  ) -> dict
"""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Optional

from .gds_algorithms import _flatten

# Physical adjacency tolerance – just enough to absorb GDS integer rounding.
_ADJ_PHYS_NM = 5.0


# ═══════════════════════════════════════════════════════════════════════════════
# GEOMETRY PRIMITIVES
# ═══════════════════════════════════════════════════════════════════════════════

def _bb(pts) -> tuple:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def _bb_overlaps(a, b, pad: float = 0.0) -> bool:
    return not (
        a[2] + pad < b[0] or b[2] + pad < a[0] or
        a[3] + pad < b[1] or b[3] + pad < a[1]
    )


def _poly_area(pts) -> float:
    """Shoelace formula – always positive."""
    n = len(pts)
    s = 0.0
    for i in range(n):
        j = (i + 1) % n
        s += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]
    return abs(s) * 0.5


def _path_poly_length(pts) -> float:
    """Sum of segment lengths for a polyline (GDS path centreline)."""
    t = 0.0
    for i in range(len(pts) - 1):
        dx = pts[i + 1][0] - pts[i][0]
        dy = pts[i + 1][1] - pts[i][1]
        t += math.sqrt(dx * dx + dy * dy)
    return t


def _dist(a, b) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def _gc(g) -> tuple:
    """Grating bounding-box centre."""
    return ((g['x0'] + g['x1']) * 0.5, (g['y0'] + g['y1']) * 0.5)


# ═══════════════════════════════════════════════════════════════════════════════
# SHAPE COLLECTION
# ═══════════════════════════════════════════════════════════════════════════════

def _collect_shapes(all_shapes, layer: int, datatype: int,
                    dev_bb: tuple, pad: float = 0.0) -> list:
    """
    Return boundary/path shapes on the given layer whose bbox overlaps
    dev_bb ± pad.  Each returned dict gets a pre-computed 'bbox' key.
    """
    exp = (dev_bb[0] - pad, dev_bb[1] - pad,
           dev_bb[2] + pad, dev_bb[3] + pad)
    out = []
    for s in all_shapes:
        if s['layer'] != layer or s['datatype'] != datatype:
            continue
        if s['type'] not in ('boundary', 'path'):
            continue
        sb = _bb(s['pts'])
        if _bb_overlaps(sb, exp):
            out.append({**s, 'bbox': sb})
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# TRUE CENTRELINE LENGTH FOR ONE SHAPE
# ═══════════════════════════════════════════════════════════════════════════════

def _shape_length(s: dict, wg_width_dbu: float) -> float:
    """
    Centreline length contribution of a single GDS shape.

    • path element    → explicit centreline waypoints; sum segment lengths.
    • boundary polygon → area / wg_width  (exact for any uniform-width strip,
                         regardless of curvature; see design notes at top).
    """
    if s['type'] == 'path':
        return _path_poly_length(s['pts'])
    return _poly_area(s['pts']) / max(wg_width_dbu, 1.0)


# ═══════════════════════════════════════════════════════════════════════════════
# EXTRACT POLYGON LIST FROM SHAPELY GEOMETRY
# ═══════════════════════════════════════════════════════════════════════════════

def _shapely_polygons(geom) -> list:
    """Return a flat list of all Polygon objects inside any Shapely geometry."""
    if geom.is_empty:
        return []
    t = geom.geom_type
    if t == 'Polygon':
        return [geom]
    if t in ('MultiPolygon', 'GeometryCollection'):
        result = []
        for g in geom.geoms:
            result.extend(_shapely_polygons(g))
        return result
    return []


# ═══════════════════════════════════════════════════════════════════════════════
# CONNECTED-COMPONENT MEASUREMENT  —  Shapely (primary)
# ═══════════════════════════════════════════════════════════════════════════════

def _measure_shapely(
    wg_shapes:     list,
    from_g:        dict,
    to_g:          dict,
    comp_shapes:   list,
    wg_width_dbu:  float,
    dbunit:        float,
) -> tuple:
    """
    Returns (length_dbu, comp_info | None, error_str | None).

    Core idea
    ─────────
    Buffer every layer-1/0 polygon / path by ε = 5 nm to close GDS
    integer-rounding gaps, then take the unary union.  The result is a
    MultiPolygon whose individual polygons are physically disconnected
    waveguide segments.  The LARGEST polygon that touches both the
    from-grating and the to-grating bbox is the true waveguide path
    (loopback >> direct bus by area).
    """
    from shapely.geometry import Polygon as SP, LineString as SL
    from shapely.geometry import box as sbox
    from shapely.ops import unary_union

    eps = (_ADJ_PHYS_NM * 1e-9) / dbunit

    # ── Build buffered geometry for each shape ────────────────────────────────
    geom_of: list = []      # parallel to wg_shapes; None on failure
    for s in wg_shapes:
        try:
            if s['type'] == 'boundary':
                g = SP(s['pts'])
                if not g.is_valid:
                    g = g.buffer(0)        # repair self-intersections
                geom_of.append(g.buffer(eps))
            else:                          # path — treat centreline as strip
                pts = s['pts']
                if len(pts) >= 2:
                    geom_of.append(SL(pts).buffer(wg_width_dbu / 2.0 + eps))
                else:
                    geom_of.append(SP([(pts[0][0], pts[0][1])] * 3).buffer(eps))
        except Exception:
            geom_of.append(None)

    valid = [(g, i) for i, g in enumerate(geom_of)
             if g is not None and not g.is_empty]
    if not valid:
        return None, None, 'No valid waveguide geometries.', []

    # ── Union → disconnected connected components ─────────────────────────────
    merged = unary_union([g for g, _ in valid])
    if merged.is_empty:
        return None, None, 'Empty union – no waveguide shapes in device area.', []

    components = _shapely_polygons(merged)

    # ── Grating bboxes padded by half wg-width ────────────────────────────────
    pad = wg_width_dbu * 0.5
    from_box = sbox(from_g['x0'] - pad, from_g['y0'] - pad,
                    from_g['x1'] + pad, from_g['y1'] + pad)
    to_box   = sbox(to_g['x0']   - pad, to_g['y0']   - pad,
                    to_g['x1']   + pad, to_g['y1']   + pad)

    # ── Candidate components: touch BOTH gratings ─────────────────────────────
    candidates = [c for c in components
                  if c.intersects(from_box) and c.intersects(to_box)]

    if not candidates:
        return None, None, (
            f'No continuous waveguide path between '
            f'{from_g["label"]} and {to_g["label"]}.'
        ), []

    # ── Pick LARGEST (area heuristic: loopback >> direct bus) ─────────────────
    best = max(candidates, key=lambda c: c.area)

    # ── Detect 68/0 component shapes that physically intersect `best` ─────────
    # Use Shapely geometry intersection (not bbox overlap) to avoid false
    # positives from neighbouring devices whose comp bbox extends nearby.
    from_center = _gc(from_g)
    to_center   = _gc(to_g)

    comp_info = None
    for cs in comp_shapes:
        try:
            cg = SP(cs['pts'])
            if not cg.is_valid:
                cg = cg.buffer(0)
            # 50 nm buffer to catch comps that just touch the waveguide edge
            if not cg.buffer(eps * 10).intersects(best):
                continue
        except Exception:
            continue
        cb = cs.get('bbox') or _bb(cs['pts'])
        cx = (cb[0] + cb[2]) * 0.5
        cy = (cb[1] + cb[3]) * 0.5
        comp_info = {
            'center_um':    [cx * dbunit * 1e6, cy * dbunit * 1e6],
            'dist_from_um': 0.0,   # filled below from path arc length
            'dist_to_um':   0.0,   # filled below from path arc length
            'bbox_dbu':     [cb[0], cb[1], cb[2], cb[3]],
        }
        break   # first confirmed component is sufficient

    # ── Trace centreline path ─────────────────────────────────────────────────
    # The measured length is the arc length of the traced path:
    #   Σ √(Δx² + Δy²)  for consecutive points, in DBU units
    # then × dbunit × 1e6  →  µm.
    # This is ground-truth: the path physically follows the waveguide geometry.
    fallback_line = [
        [from_center[0] * dbunit * 1e6, from_center[1] * dbunit * 1e6],
        [to_center[0]   * dbunit * 1e6, to_center[1]   * dbunit * 1e6],
    ]
    try:
        if comp_info:
            # Two half-paths meet at the component centre:
            #   half1 : from_g → waveguide → comp centre
            #   half2 : to_g   → waveguide → comp centre
            #   full  : half1  + reversed(half2)[1:]   (skip duplicate centre pt)
            cb_dbu = comp_info['bbox_dbu']
            cc_dbu = (
                comp_info['center_um'][0] * 1e-6 / dbunit,
                comp_info['center_um'][1] * 1e-6 / dbunit,
            )
            half1    = _trace_half(best, from_g, cb_dbu, cc_dbu, wg_width_dbu)
            half2    = _trace_half(best, to_g,   cb_dbu, cc_dbu, wg_width_dbu)
            path_dbu = half1 + list(reversed(half2))[1:]
            # Distances from each grating to the component, from actual arc lengths
            comp_info['dist_from_um'] = _path_poly_length(half1) * dbunit * 1e6
            comp_info['dist_to_um']   = _path_poly_length(half2) * dbunit * 1e6
        else:
            # Loopback: single trace from from_g all the way to to_g
            path_dbu = _trace_centreline(best, from_g, to_g, wg_width_dbu)

    except Exception as exc:
        return None, None, f'Path tracing failed: {exc}', fallback_line

    # ── Length = arc length of traced path in DBU, then → µm ─────────────────
    total_length = _path_poly_length(path_dbu)   # DBU units

    if total_length <= 0.0:
        return None, None, 'Zero-length traced path.', fallback_line

    path_um = [[p[0] * dbunit * 1e6, p[1] * dbunit * 1e6] for p in path_dbu]
    return total_length, comp_info, None, path_um


# ═══════════════════════════════════════════════════════════════════════════════
# CONNECTED-COMPONENT MEASUREMENT  —  pure-Python union-find (fallback)
# ═══════════════════════════════════════════════════════════════════════════════

def _uf_find(parent: list, i: int) -> int:
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i


def _uf_union(parent: list, rank: list, i: int, j: int) -> None:
    ri, rj = _uf_find(parent, i), _uf_find(parent, j)
    if ri == rj:
        return
    if rank[ri] < rank[rj]:
        ri, rj = rj, ri
    parent[rj] = ri
    if rank[ri] == rank[rj]:
        rank[ri] += 1


def _measure_ufind(
    wg_shapes:     list,
    from_g:        dict,
    to_g:          dict,
    comp_shapes:   list,
    wg_width_dbu:  float,
    dbunit:        float,
) -> tuple:
    """
    Returns (length_dbu, comp_info | None, error_str | None).

    Pure-Python fallback using union-find on expanded bboxes:
    • boundary shapes: expand bbox by ε (5 nm)
    • path shapes:     expand bbox by wg_width/2 + ε  (centreline bbox is narrow)

    Same "pick largest component touching both gratings" heuristic.
    """
    eps = (_ADJ_PHYS_NM * 1e-9) / dbunit
    n   = len(wg_shapes)
    if n == 0:
        return None, None, 'No waveguide shapes.', []

    # Expanded bboxes for connectivity detection
    def _ebb(s):
        bb    = s['bbox']
        extra = (wg_width_dbu / 2.0 + eps) if s['type'] == 'path' else eps
        return (bb[0] - extra, bb[1] - extra,
                bb[2] + extra, bb[3] + extra)

    ebbs   = [_ebb(s) for s in wg_shapes]
    parent = list(range(n))
    rank   = [0] * n

    for i in range(n):
        for j in range(i + 1, n):
            if _bb_overlaps(ebbs[i], ebbs[j]):
                _uf_union(parent, rank, i, j)

    # Group indices by component root
    comp_map: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        comp_map[_uf_find(parent, i)].append(i)

    # Grating bboxes (padded)
    pad      = wg_width_dbu * 0.5
    from_bb  = (from_g['x0'] - pad, from_g['y0'] - pad,
                from_g['x1'] + pad, from_g['y1'] + pad)
    to_bb    = (to_g['x0']   - pad, to_g['y0']   - pad,
                to_g['x1']   + pad, to_g['y1']   + pad)

    def _touches(idxs, gbb):
        return any(_bb_overlaps(wg_shapes[k]['bbox'], gbb) for k in idxs)

    # Find the largest component touching both gratings
    best_area: float = -1.0
    best_idxs: list  = []

    for idxs in comp_map.values():
        if not _touches(idxs, from_bb):
            continue
        if not _touches(idxs, to_bb):
            continue
        # Equivalent area = boundary area + path_length × wg_width
        area = sum(
            (_poly_area(wg_shapes[k]['pts'])
             if wg_shapes[k]['type'] == 'boundary'
             else _path_poly_length(wg_shapes[k]['pts']) * wg_width_dbu)
            for k in idxs
        )
        if area > best_area:
            best_area  = area
            best_idxs  = idxs

    if not best_idxs:
        return None, None, (
            f'No continuous waveguide path between '
            f'{from_g["label"]} and {to_g["label"]}.'
        ), []

    total_length  = sum(_shape_length(wg_shapes[k], wg_width_dbu)
                        for k in best_idxs)
    member_bboxes = [wg_shapes[k]['bbox'] for k in best_idxs]

    from_center = _gc(from_g)
    to_center   = _gc(to_g)
    comp_info   = _find_comp_info(
        comp_shapes, member_bboxes, total_length, dbunit,
        from_center, to_center,
    )

    # Straight-line fallback path (no Shapely tracing available)
    path_um = [
        [from_center[0] * dbunit * 1e6, from_center[1] * dbunit * 1e6],
        [to_center[0]   * dbunit * 1e6, to_center[1]   * dbunit * 1e6],
    ]

    return total_length, comp_info, None, path_um


# ═══════════════════════════════════════════════════════════════════════════════
# CENTRELINE TRACING  (Shapely only — used for path visualisation)
# ═══════════════════════════════════════════════════════════════════════════════

def _inter_midpoint(inter, candidate: tuple) -> Optional[tuple]:
    """
    Given a Shapely intersection result (line ∩ polygon) return the (x, y)
    midpoint of the segment closest to *candidate*.
    """
    cx, cy = candidate

    if inter.geom_type == 'LineString':
        coords = list(inter.coords)
        x = sum(c[0] for c in coords) / len(coords)
        y = sum(c[1] for c in coords) / len(coords)
        return (x, y)

    if inter.geom_type == 'MultiLineString':
        best_m, best_d = None, float('inf')
        for seg in inter.geoms:
            coords = list(seg.coords)
            mx = sum(c[0] for c in coords) / len(coords)
            my = sum(c[1] for c in coords) / len(coords)
            d = (mx - cx) ** 2 + (my - cy) ** 2
            if d < best_d:
                best_d = d
                best_m = (mx, my)
        return best_m

    if inter.geom_type == 'Point':
        return (inter.x, inter.y)

    return None


def _trace_centreline(
    best,           # Shapely polygon (chosen connected component, DBU)
    from_g: dict,
    to_g:   dict,
    wg_width_dbu: float,
    max_pts: int = 800,
) -> list:
    """
    Trace the waveguide centreline through *best* from the from-grating to the
    to-grating.  Returns a list of (x_dbu, y_dbu) tuples.

    Phase 1 — exit grating coupler
        Scan upward (horizontal slices at increasing y) from the grating centre
        until the intersection width narrows to ≈ wg_width.  This is where the
        broad grating taper hands off to the single-mode waveguide.

    Phase 2 — march-and-slice centreline
        At each step: advance by *step* in the current direction, take a
        perpendicular cross-section, find the midpoint of the nearest
        intersection.  Update direction toward that midpoint (80% new / 20%
        old weighting for smooth tracking around bends).
    """
    from shapely.geometry import LineString

    gfx, gfy = _gc(from_g)
    gtx, gty = _gc(to_g)

    step = max(wg_width_dbu * 2.0, 50.0)    # march step ≈ 1 µm

    # Simplify polygon for faster intersection tests (tolerance = 10% wg_width)
    try:
        simple = best.simplify(wg_width_dbu * 0.1, preserve_topology=True)
        if simple.is_empty:
            simple = best
    except Exception:
        simple = best

    # ── Phase 1: exit grating coupler (scan upward) ───────────────────────────
    scan_margin = max(abs(from_g['x1'] - from_g['x0']),
                      abs(from_g['y1'] - from_g['y0'])) * 3
    entry_pt    = None
    entry_dir   = (0.0, 1.0)    # assume waveguide exits upward

    y = gfy
    for _ in range(4000):
        y += step * 0.5
        # Horizontal slice at this y
        hline = LineString([(gfx - scan_margin, y), (gfx + scan_margin, y)])
        try:
            inter = simple.intersection(hline)
        except Exception:
            break
        if inter.is_empty:
            break
        mid = _inter_midpoint(inter, (gfx, y))
        if mid is None:
            continue
        # Width of intersection at this y
        if inter.geom_type == 'LineString':
            coords = list(inter.coords)
            w = abs(coords[-1][0] - coords[0][0]) if len(coords) >= 2 else 0.0
        elif inter.geom_type == 'MultiLineString':
            segs  = list(inter.geoms)
            # closest segment to grating centre
            seg   = min(segs, key=lambda s:
                        abs(((list(s.coords)[0][0] + list(s.coords)[-1][0]) / 2) - gfx))
            coords = list(seg.coords)
            w = abs(coords[-1][0] - coords[0][0]) if len(coords) >= 2 else wg_width_dbu * 2
        else:
            w = wg_width_dbu * 2

        # Narrow enough to be the waveguide (not the grating coupler)?
        if w <= wg_width_dbu * 1.6:
            entry_pt = mid
            break

    if entry_pt is None:
        # Fallback: just above the grating top
        entry_pt = (gfx, max(from_g['y0'], from_g['y1']) + step)

    # ── Phase 2: march-and-slice ──────────────────────────────────────────────
    to_pad = wg_width_dbu * 1.5
    to_bb  = (min(to_g['x0'], to_g['x1']) - to_pad,
              min(to_g['y0'], to_g['y1']) - to_pad,
              max(to_g['x0'], to_g['x1']) + to_pad,
              max(to_g['y0'], to_g['y1']) + to_pad)

    direction  = entry_dir
    current    = entry_pt
    raw_pts    = [(gfx, gfy), entry_pt]
    slice_half = wg_width_dbu * 6        # half-length of perpendicular slice

    for _ in range(20000):
        # Advance
        nx = current[0] + step * direction[0]
        ny = current[1] + step * direction[1]

        # Perpendicular slice
        px, py = -direction[1], direction[0]
        sline = LineString([
            (nx - slice_half * px, ny - slice_half * py),
            (nx + slice_half * px, ny + slice_half * py),
        ])
        try:
            inter = simple.intersection(sline)
        except Exception:
            break
        if inter.is_empty:
            break

        mid = _inter_midpoint(inter, (nx, ny))
        if mid is None:
            break

        # Update direction (80% new, 20% old for smooth bend tracking)
        dx, dy = mid[0] - current[0], mid[1] - current[1]
        mag    = math.sqrt(dx * dx + dy * dy)
        if mag > 1.0:
            nd = (dx / mag, dy / mag)
            bx = direction[0] * 0.2 + nd[0] * 0.8
            by = direction[1] * 0.2 + nd[1] * 0.8
            bm = math.sqrt(bx * bx + by * by)
            if bm > 0:
                direction = (bx / bm, by / bm)

        raw_pts.append(mid)
        current = mid

        # Reached to-grating?
        if to_bb[0] <= mid[0] <= to_bb[2] and to_bb[1] <= mid[1] <= to_bb[3]:
            break

    raw_pts.append((gtx, gty))

    # ── Decimate to max_pts ───────────────────────────────────────────────────
    n = len(raw_pts)
    if n > max_pts:
        step_dec = max(1, n // max_pts)
        kept = raw_pts[::step_dec]
        if kept[-1] != raw_pts[-1]:
            kept.append(raw_pts[-1])
        return kept
    return raw_pts


# ───────────────────────────────────────────────────────────────────────────────
# _trace_half  — trace from one grating to the shared component centre
# ───────────────────────────────────────────────────────────────────────────────

def _trace_half(
    best,                       # Shapely polygon (connected component, DBU)
    grating:       dict,
    stop_bbox_dbu: tuple,       # (x0, y0, x1, y1) of the 68/0 component in DBU
    stop_pt_dbu:   tuple,       # (x, y) component centre — last point appended
    wg_width_dbu:  float,
    max_pts:       int = 400,
) -> list:
    """
    Trace a half-path from *grating* along the waveguide until it enters the
    68/0 component bbox, then snap to *stop_pt_dbu* (the component centre).

    Identical Phase 1 / Phase 2 logic to _trace_centreline, except termination
    checks *stop_bbox_dbu* (padded by wg_width) rather than the to-grating bbox.
    """
    from shapely.geometry import LineString

    gx, gy = _gc(grating)
    step = max(wg_width_dbu * 2.0, 50.0)

    try:
        simple = best.simplify(wg_width_dbu * 0.1, preserve_topology=True)
        if simple.is_empty:
            simple = best
    except Exception:
        simple = best

    # ── Phase 1: exit grating coupler (upward scan) ───────────────────────────
    scan_margin = max(abs(grating['x1'] - grating['x0']),
                      abs(grating['y1'] - grating['y0'])) * 3
    entry_pt = None

    y = gy
    for _ in range(4000):
        y += step * 0.5
        hline = LineString([(gx - scan_margin, y), (gx + scan_margin, y)])
        try:
            inter = simple.intersection(hline)
        except Exception:
            break
        if inter.is_empty:
            break
        mid = _inter_midpoint(inter, (gx, y))
        if mid is None:
            continue
        if inter.geom_type == 'LineString':
            coords = list(inter.coords)
            w = abs(coords[-1][0] - coords[0][0]) if len(coords) >= 2 else 0.0
        elif inter.geom_type == 'MultiLineString':
            segs = list(inter.geoms)
            seg  = min(segs, key=lambda s:
                       abs(((list(s.coords)[0][0] + list(s.coords)[-1][0]) / 2) - gx))
            coords = list(seg.coords)
            w = abs(coords[-1][0] - coords[0][0]) if len(coords) >= 2 else wg_width_dbu * 2
        else:
            w = wg_width_dbu * 2
        if w <= wg_width_dbu * 1.6:
            entry_pt = mid
            break

    if entry_pt is None:
        entry_pt = (gx, max(grating['y0'], grating['y1']) + step)

    # ── Phase 2: march toward component bbox ──────────────────────────────────
    # Stop when marching position enters the component bbox (padded by 2× wg_width
    # so we halt just outside the component edge rather than overshooting).
    pad = wg_width_dbu * 2.0
    sx0 = stop_bbox_dbu[0] - pad
    sy0 = stop_bbox_dbu[1] - pad
    sx1 = stop_bbox_dbu[2] + pad
    sy1 = stop_bbox_dbu[3] + pad

    direction  = (0.0, 1.0)
    current    = entry_pt
    raw_pts    = [(gx, gy), entry_pt]
    slice_half = wg_width_dbu * 6

    for _ in range(20000):
        nx = current[0] + step * direction[0]
        ny = current[1] + step * direction[1]

        px, py = -direction[1], direction[0]
        sline = LineString([
            (nx - slice_half * px, ny - slice_half * py),
            (nx + slice_half * px, ny + slice_half * py),
        ])
        try:
            inter = simple.intersection(sline)
        except Exception:
            break
        if inter.is_empty:
            break

        mid = _inter_midpoint(inter, (nx, ny))
        if mid is None:
            break

        # Direction update (80% new / 20% old)
        dx, dy = mid[0] - current[0], mid[1] - current[1]
        mag    = math.sqrt(dx * dx + dy * dy)
        if mag > 1.0:
            nd = (dx / mag, dy / mag)
            bx = direction[0] * 0.2 + nd[0] * 0.8
            by = direction[1] * 0.2 + nd[1] * 0.8
            bm = math.sqrt(bx * bx + by * by)
            if bm > 0:
                direction = (bx / bm, by / bm)

        raw_pts.append(mid)
        current = mid

        # Reached the component bbox?
        if sx0 <= mid[0] <= sx1 and sy0 <= mid[1] <= sy1:
            break

    # Always end at the exact component centre
    raw_pts.append(stop_pt_dbu)

    # ── Decimate ──────────────────────────────────────────────────────────────
    n = len(raw_pts)
    if n > max_pts:
        step_dec = max(1, n // max_pts)
        kept = raw_pts[::step_dec]
        if kept[-1] != raw_pts[-1]:
            kept.append(raw_pts[-1])
        return kept
    return raw_pts


# ═══════════════════════════════════════════════════════════════════════════════
# COMPONENT (68/0) DETECTION  (used by pure-Python fallback)
# ═══════════════════════════════════════════════════════════════════════════════

def _find_comp_info(
    comp_shapes:    list,
    member_bboxes:  list,
    total_len_dbu:  float,
    dbunit:         float,
    from_center:    tuple,
    to_center:      tuple,
) -> Optional[dict]:
    """
    Return comp_info for the first layer-68/0 shape that overlaps the chosen
    waveguide component (identified by member_bboxes).

    dist_from / dist_to are estimated by projecting the component centre onto
    the from→to Euclidean axis and scaling by total path length.  This is
    approximate (±20%) but adequate for display; exact BFS is not needed here.
    """
    for cs in comp_shapes:
        cb = cs.get('bbox') or _bb(cs['pts'])
        if not any(_bb_overlaps(mb, cb) for mb in member_bboxes):
            continue

        # Component centre (DBU)
        cx = (cb[0] + cb[2]) * 0.5
        cy = (cb[1] + cb[3]) * 0.5

        # Fraction along from→to axis
        total_euc = _dist(from_center, to_center)
        if total_euc > 0.0:
            # Project comp centre onto the from→to vector
            dx = to_center[0] - from_center[0]
            dy = to_center[1] - from_center[1]
            frac = ((cx - from_center[0]) * dx + (cy - from_center[1]) * dy) / (total_euc ** 2)
            frac = max(0.0, min(1.0, frac))
        else:
            frac = 0.5

        total_um   = total_len_dbu * dbunit * 1e6
        dist_from  = frac * total_um
        dist_to    = max(0.0, total_um - dist_from)

        return {
            'center_um':    [cx * dbunit * 1e6, cy * dbunit * 1e6],
            'dist_from_um': dist_from,
            'dist_to_um':   dist_to,
            'bbox_dbu':     list(cb),   # (x0, y0, x1, y1) in DBU for path tracing
        }

    return None


# ═══════════════════════════════════════════════════════════════════════════════
# SINGLE-DEVICE MEASUREMENT
# ═══════════════════════════════════════════════════════════════════════════════

def _measure_pair(
    wg_shapes:    list,
    from_g:       dict,
    to_g:         dict,
    comp_shapes:  list,
    wg_width_dbu: float,
    dbunit:       float,
) -> tuple:
    """
    Attempt Shapely measurement; fall back to union-find on any error.
    Returns (length_dbu, comp_info, error_str, path_pts_um).
    """
    try:
        import shapely  # noqa: F401
        return _measure_shapely(wg_shapes, from_g, to_g,
                                comp_shapes, wg_width_dbu, dbunit)
    except ImportError:
        pass
    except Exception:
        pass

    # Pure-Python fallback
    try:
        return _measure_ufind(wg_shapes, from_g, to_g,
                              comp_shapes, wg_width_dbu, dbunit)
    except Exception as exc:
        fc = _gc(from_g)
        tc = _gc(to_g)
        path_um = [[fc[0] * dbunit * 1e6, fc[1] * dbunit * 1e6],
                   [tc[0] * dbunit * 1e6, tc[1] * dbunit * 1e6]]
        return None, None, str(exc), path_um


def _measure_device(
    lib:          dict,
    device:       dict,
    dev_gratings: list,
    from_label:   str,
    to_labels:    Optional[list],
    wg_layer:     int,
    wg_datatype:  int,
    comp_layer:   int,
    comp_datatype:int,
    wg_width_dbu: float,
    all_shapes:   list,
) -> list:
    """Return a list of result dicts for one device."""
    dbunit    = lib['dbunit']
    dev_label = device.get('label', str(device['id']))
    dev_bb    = (device['x0'], device['y0'], device['x1'], device['y1'])
    pad_bb    = wg_width_dbu * 2.0

    from_g = next((g for g in dev_gratings if g['label'] == from_label), None)
    if from_g is None:
        return [_err(device, from_label, '?',
                     f'{from_label} not found on device.')]

    to_gs = (
        [g for g in dev_gratings if g['label'] != from_label]
        if to_labels is None
        else [g for g in dev_gratings if g['label'] in to_labels]
    )
    if not to_gs:
        return [_err(device, from_label, '?', 'No target gratings found.')]

    wg_shapes   = _collect_shapes(all_shapes, wg_layer,   wg_datatype,
                                  dev_bb, pad_bb)
    comp_shapes = _collect_shapes(all_shapes, comp_layer, comp_datatype,
                                  dev_bb, pad_bb)

    if not wg_shapes:
        msg = f'No layer {wg_layer}/{wg_datatype} shapes within device bbox.'
        return [_err(device, from_label, tg['label'], msg) for tg in to_gs]

    results = []
    for tg in to_gs:
        port_from = f'{dev_label}__{from_label}'
        port_to   = f'{dev_label}__{tg["label"]}'

        length_dbu, comp_info, err, path_um = _measure_pair(
            wg_shapes, from_g, tg,
            comp_shapes, wg_width_dbu, dbunit,
        )

        if err or length_dbu is None:
            results.append(_err(device, from_label, tg['label'],
                                err or 'Measurement failed.',
                                port_from, port_to))
            continue

        results.append({
            'device_id':    device['id'],
            'device_label': dev_label,
            'from':         from_label,
            'to':           tg['label'],
            'length_um':    round(length_dbu * dbunit * 1e6, 4),
            'discontinuity': False,
            'is_loopback':  comp_info is None,
            'comp_info':    comp_info,
            'path_pts_um':  path_um or [],
            'port_from':    port_from,
            'port_to':      port_to,
            'error':        None,
        })

    return results


def _err(device, from_lbl, to_lbl, msg, port_from=None, port_to=None):
    lbl = device.get('label', str(device['id']))
    return {
        'device_id':    device['id'],
        'device_label': lbl,
        'from':         from_lbl,
        'to':           to_lbl,
        'length_um':    None,
        'discontinuity': True,
        'is_loopback':  False,
        'comp_info':    None,
        'path_pts_um':  [],
        'port_from':    port_from or f'{lbl}__{from_lbl}',
        'port_to':      port_to   or f'{lbl}__{to_lbl}',
        'error':        msg,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

def measure_waveguide_lengths(
    lib:                dict,
    cell_name:          str,
    devices_to_measure: list,
    all_gratings:       list,
    from_label:         str,
    to_labels:          Optional[list],
    wg_layer:           int   = 1,
    wg_datatype:        int   = 0,
    grating_layer:      int   = 2,
    grating_datatype:   int   = 6,
    comp_layer:         int   = 68,
    comp_datatype:      int   = 0,
    wg_width_um:        float = 0.5,
) -> dict:
    if not devices_to_measure:
        return {'results': [], 'message': 'No devices specified.'}
    if not all_gratings:
        return {'results': [], 'message':
                'No gratings found. Run Find Optical Gratings first.'}

    # Resolve cell name
    cell = lib['cells'].get(cell_name)
    if cell is None:
        keys      = list(lib['cells'].keys())
        cell_name = keys[-1] if keys else ''
        cell      = lib['cells'].get(cell_name)
    if cell is None:
        return {'results': [], 'message': 'Cell not found in library.'}

    dbunit       = lib['dbunit']
    wg_width_dbu = max(wg_width_um, 1e-4) * 1e-6 / dbunit

    # Flatten once; shared across all devices in this call
    all_shapes = _flatten(cell, lib['cells'])

    all_results: list = []
    for dev in devices_to_measure:
        dev_gratings = [g for g in all_gratings if g['device_id'] == dev['id']]
        if not dev_gratings:
            continue
        all_results.extend(
            _measure_device(
                lib, dev, dev_gratings,
                from_label, to_labels,
                wg_layer, wg_datatype,
                comp_layer, comp_datatype,
                wg_width_dbu, all_shapes,
            )
        )

    n_ok   = sum(1 for r in all_results if not r['discontinuity'])
    n_disc = len(all_results) - n_ok
    n_loop = sum(1 for r in all_results
                 if r.get('is_loopback') and not r['discontinuity'])

    parts = [f'Measured {n_ok} path(s)']
    if n_loop:
        parts.append(f'{n_loop} loopback(s)')
    if n_disc:
        parts.append(f'{n_disc} discontinuous')
    msg = ', '.join(parts) + f' across {len(devices_to_measure)} device(s).'

    return {'results': all_results, 'message': msg}
