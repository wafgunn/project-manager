"""
GDS Device Finder — Backend Algorithms

Public API:
  parse_gds_python(data: bytes) -> dict
  find_designs(lib, cell_name, tolerance_um=0.1, search_layer=1, search_datatype=0) -> dict
  group_devices(designs: list, dbunit: float) -> dict
  generate_gds_with_bboxes(raw, designs, cell_name, out_layer=1, out_datatype=100) -> bytes
"""

import struct
from collections import defaultdict

# ─── Optional Shapely (used for precise polygon intersection) ────────────────
try:
    from shapely.geometry import Polygon as _ShapelyPoly, LineString as _LS, Point as _Pt
    from shapely.ops import unary_union as _unary_union
    from shapely.strtree import STRtree as _STRtree
    _HAS_SHAPELY = True
except ImportError:
    _HAS_SHAPELY = False


# ═══════════════════════════════════════════════════════════════════════════════
# IBM FLOAT READER
# ═══════════════════════════════════════════════════════════════════════════════

def _ibm_float(data: bytes, offset: int) -> float:
    """IBM 360 64-bit hexadecimal float used in GDS UNITS record."""
    if offset + 8 > len(data):
        return 0.0
    b = data[offset: offset + 8]
    sign = -1 if (b[0] & 0x80) else 1
    exp = (b[0] & 0x7F) - 64
    mant = 0
    for i in range(1, 8):
        mant = mant * 256 + b[i]
    mant /= 256 ** 7
    return sign * mant * (16 ** exp) if mant else 0.0


# ═══════════════════════════════════════════════════════════════════════════════
# GDS-II BINARY PARSER
# ═══════════════════════════════════════════════════════════════════════════════

def parse_gds_python(data: bytes) -> dict:
    """
    Parse GDS-II binary into a dict mirroring the JS parser output:
      {name, dbunit, units, cells: {name: {name, boundaries, paths, texts, refs}}}
    Handles: BOUNDARY, PATH, TEXT, SREF, AREF.
    """
    lib = {
        'name': 'unknown',
        'dbunit': 1e-9,
        'units': [0.001, 1e-9],
        'cells': {},
    }
    pos = 0
    current_cell = None
    current_el = None
    n = len(data)

    while pos + 4 <= n:
        length = struct.unpack_from('>H', data, pos)[0]
        if length < 4 or pos + length > n:
            pos += max(length, 4)
            continue

        rec_type = data[pos + 2]
        dt_byte  = data[pos + 3]
        key      = (rec_type << 8) | dt_byte
        ds       = pos + 4          # data start
        dl       = length - 4       # data length
        pos     += length

        # ── Library header ───────────────────────────────────────────────────
        if key == 0x0206:    # LIBNAME
            lib['name'] = _gds_str(data, ds, dl)

        elif key == 0x0305:  # UNITS
            if dl >= 16:
                lib['units']  = [_ibm_float(data, ds), _ibm_float(data, ds + 8)]
                lib['dbunit'] = lib['units'][1]

        # ── Cell (structure) ─────────────────────────────────────────────────
        elif key == 0x0502:  # BGNSTR
            current_cell = {
                'name': f'cell_{len(lib["cells"])}',
                'boundaries': [], 'paths': [], 'texts': [], 'refs': [],
            }

        elif key == 0x0606:  # STRNAME
            if current_cell is not None:
                current_cell['name'] = _gds_str(data, ds, dl)
                lib['cells'][current_cell['name']] = current_cell

        elif key == 0x0700:  # ENDSTR
            current_cell = None

        # ── Element starts ───────────────────────────────────────────────────
        elif key == 0x0800:  # BOUNDARY
            current_el = {'type': 'boundary', 'layer': 0, 'datatype': 0, 'xy': []}

        elif key == 0x0900:  # PATH
            current_el = {'type': 'path', 'layer': 0, 'datatype': 0, 'width': 0, 'xy': []}

        elif key == 0x0C00:  # TEXT
            current_el = {'type': 'text', 'layer': 0, 'datatype': 0, 'xy': [], 'string': ''}

        elif key == 0x0A00:  # SREF
            current_el = {'type': 'sref', 'sname': '', 'xy': [], 'mag': 1.0, 'angle': 0.0}

        elif key == 0x0B00:  # AREF
            current_el = {'type': 'aref', 'sname': '', 'xy': [],
                          'cols': 1, 'rows': 1}

        # ── Element attributes ───────────────────────────────────────────────
        elif key == 0x0D02 and current_el is not None:  # LAYER
            current_el['layer'] = struct.unpack_from('>h', data, ds)[0]

        elif key == 0x0E02 and current_el is not None:  # DATATYPE
            current_el['datatype'] = struct.unpack_from('>h', data, ds)[0]

        elif key == 0x1602 and current_el is not None:  # TEXTTYPE (for TEXT elements)
            current_el['datatype'] = struct.unpack_from('>h', data, ds)[0]

        elif key == 0x0F03 and current_el is not None:  # WIDTH
            if dl >= 4:
                current_el['width'] = struct.unpack_from('>i', data, ds)[0]

        elif key == 0x1003 and current_el is not None:  # XY
            pts = []
            for i in range(0, dl - 7, 8):
                x = struct.unpack_from('>i', data, ds + i)[0]
                y = struct.unpack_from('>i', data, ds + i + 4)[0]
                pts.append((x, y))
            current_el['xy'] = pts

        elif key == 0x1206 and current_el is not None:  # SNAME
            current_el['sname'] = _gds_str(data, ds, dl)

        elif key == 0x1302 and current_el is not None:  # COLROW (AREF)
            if dl >= 4:
                current_el['cols'] = struct.unpack_from('>H', data, ds)[0]
                current_el['rows'] = struct.unpack_from('>H', data, ds + 2)[0]

        elif key == 0x1906 and current_el is not None:  # STRING
            current_el['string'] = _gds_str(data, ds, dl)

        # ── Element end ──────────────────────────────────────────────────────
        elif key == 0x1100:  # ENDEL
            if current_el is not None and current_cell is not None:
                t = current_el['type']
                if   t == 'boundary': current_cell['boundaries'].append(current_el)
                elif t == 'path':     current_cell['paths'].append(current_el)
                elif t == 'text':     current_cell['texts'].append(current_el)
                elif t in ('sref', 'aref'): current_cell['refs'].append(current_el)
            current_el = None

    return lib


def _gds_str(data: bytes, start: int, length: int) -> str:
    raw = data[start: start + length]
    return raw.rstrip(b'\x00').decode('latin-1').strip()


# ═══════════════════════════════════════════════════════════════════════════════
# CELL FLATTENER
# ═══════════════════════════════════════════════════════════════════════════════

def _flatten(cell: dict, cells: dict, tx: int = 0, ty: int = 0,
             visited: frozenset = frozenset()) -> list:
    """Recursively flatten a cell (with SREFs/AREFs) into a list of shape dicts."""
    if cell['name'] in visited:
        return []
    visited = visited | {cell['name']}
    shapes = []

    for b in cell['boundaries']:
        if len(b['xy']) >= 3:
            shapes.append({
                'type': 'boundary',
                'layer': b['layer'], 'datatype': b['datatype'],
                'pts': tuple((x + tx, y + ty) for x, y in b['xy']),
            })

    for p in cell['paths']:
        if len(p['xy']) >= 2:
            shapes.append({
                'type': 'path',
                'layer': p['layer'], 'datatype': p['datatype'],
                'pts': tuple((x + tx, y + ty) for x, y in p['xy']),
                'width': p.get('width', 0),
            })

    for t in cell['texts']:
        if t['xy']:
            x, y = t['xy'][0]
            shapes.append({
                'type': 'text',
                'layer': t['layer'], 'datatype': t['datatype'],
                'x': x + tx, 'y': y + ty,
                'string': t.get('string', ''),
            })

    for r in cell['refs']:
        sub = cells.get(r['sname'])
        if sub is None:
            continue

        if r['type'] == 'sref' and r['xy']:
            ox, oy = r['xy'][0]
            shapes.extend(_flatten(sub, cells, tx + ox, ty + oy, visited))

        elif r['type'] == 'aref' and len(r['xy']) >= 3:
            ox, oy   = r['xy'][0]
            cols     = max(r.get('cols', 1), 1)
            rows     = max(r.get('rows', 1), 1)
            col_dx   = (r['xy'][1][0] - ox) / cols
            col_dy   = (r['xy'][1][1] - oy) / cols
            row_dx   = (r['xy'][2][0] - ox) / rows
            row_dy   = (r['xy'][2][1] - oy) / rows
            for ci in range(cols):
                for ri in range(rows):
                    ax = int(round(tx + ox + ci * col_dx + ri * row_dx))
                    ay = int(round(ty + oy + ci * col_dy + ri * row_dy))
                    shapes.extend(_flatten(sub, cells, ax, ay, visited))

    return shapes


def _bbox(pts) -> tuple:
    """Return (minx, miny, maxx, maxy) for a sequence of (x,y) points."""
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


# ═══════════════════════════════════════════════════════════════════════════════
# UNION-FIND
# ═══════════════════════════════════════════════════════════════════════════════

class _UF:
    def __init__(self, n: int):
        self.p = list(range(n))
        self.r = [0] * n

    def find(self, x: int) -> int:
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, x: int, y: int):
        rx, ry = self.find(x), self.find(y)
        if rx == ry:
            return
        if self.r[rx] < self.r[ry]:
            rx, ry = ry, rx
        self.p[ry] = rx
        if self.r[rx] == self.r[ry]:
            self.r[rx] += 1


# ═══════════════════════════════════════════════════════════════════════════════
# FIND DESIGNS
# ═══════════════════════════════════════════════════════════════════════════════

def find_designs(lib: dict, cell_name: str, tolerance_um: float = 0.1,
                 search_layer: int = 1, search_datatype: int = 0) -> dict:
    """
    Locate device designs in the GDS:

    1.  Flatten the active cell (resolving all SREFs/AREFs).
    2.  Separate search-layer polygons from everything else.
    3.  Discard "chip-level bounding boxes": non-search-layer shapes whose
        bounding box spans ≥ 85 % of the full search-layer extent in both X and Y.
    4.  Buffer each search-layer polygon by *tolerance_um* µm (in DB units).
    5.  Group search-layer polygons that:
          a) are within *tolerance_um* µm of each other, OR
          b) share at least one other-layer neighbour within *tolerance_um* µm.
    6.  Compute a tight bounding box for each group's search-layer polygons.

    Args:
        tolerance_um:     grouping buffer radius in µm (default 0.1 µm = 100 nm).
        search_layer:     GDS layer number to search for devices (default 1).
        search_datatype:  GDS datatype to search for devices (default 0).

    Returns:
        {designs: [{id, x0, y0, x1, y1, x0_um, y0_um, x1_um, y1_um, label}],
         count, message?}
    """
    dbunit = lib['dbunit']
    buf_dbu = max(tolerance_um, 0.0) * 1e-6 / dbunit   # µm → DB units

    cell = lib['cells'].get(cell_name)
    if cell is None:
        return {'error': f'Cell {cell_name!r} not found', 'designs': []}

    all_shapes = _flatten(cell, lib['cells'])

    l1  = [s for s in all_shapes
           if s['layer'] == search_layer and s['datatype'] == search_datatype
           and s['type'] == 'boundary']
    rest = [s for s in all_shapes
            if not (s['layer'] == search_layer and s['datatype'] == search_datatype)]

    if not l1:
        return {'designs': [], 'message': f'No layer {search_layer}/{search_datatype} polygons found.'}

    # ── Full design extent from all search-layer vertices ────────────────────
    all_xs = [x for s in l1 for x, _ in s['pts']]
    all_ys = [y for s in l1 for _, y in s['pts']]
    fx0, fy0, fx1, fy1 = min(all_xs), min(all_ys), max(all_xs), max(all_ys)
    fw, fh = fx1 - fx0, fy1 - fy0

    # ── Filter chip-level global bounding boxes ───────────────────────────────
    # Reject any non-1/0 shape whose bbox covers ≥ 85% of the design extent
    # on both axes (catching the layer 64/0 chip outline and similar).
    _GLOBAL_THRESH = 0.85

    def _is_global(s):
        if s['type'] in ('boundary', 'path'):
            b = _bbox(s['pts'])
        elif s['type'] == 'text':
            b = (s['x'], s['y'], s['x'], s['y'])
        else:
            return False
        if fw <= 0 or fh <= 0:
            return False
        bw, bh = b[2] - b[0], b[3] - b[1]
        return (bw / fw >= _GLOBAL_THRESH) and (bh / fh >= _GLOBAL_THRESH)

    other = [s for s in rest if not _is_global(s)]

    if _HAS_SHAPELY:
        return _find_shapely(l1, other, dbunit, buf_dbu)
    else:
        return _find_bbox(l1, other, dbunit, buf_dbu)


# ─── Shapely implementation ──────────────────────────────────────────────────

def _to_shapely(s):
    """Convert a flat shape dict to a Shapely geometry, or None on failure."""
    try:
        if s['type'] == 'boundary':
            g = _ShapelyPoly(s['pts']).buffer(0)
        elif s['type'] == 'path':
            line = _LS(s['pts'])
            w = abs(s.get('width', 0))
            g = line.buffer(w / 2) if w > 0 else line.buffer(1)
        elif s['type'] == 'text':
            g = _Pt(s['x'], s['y']).buffer(1)
        else:
            return None
        return g if not g.is_empty else None
    except Exception:
        return None


def _find_shapely(l1_shapes, other_shapes, dbunit, buf_dbu):
    l1_geoms = []
    for s in l1_shapes:
        g = _to_shapely(s)
        if g:
            l1_geoms.append(g)
    if not l1_geoms:
        return {'designs': [], 'message': 'No valid search-layer geometries.'}

    other_geoms = [g for s in other_shapes for g in [_to_shapely(s)] if g]

    n  = len(l1_geoms)
    uf = _UF(n)

    # Buffer each 1/0 polygon once
    l1_buf = []
    for g in l1_geoms:
        try:
            l1_buf.append(g.buffer(buf_dbu))
        except Exception:
            l1_buf.append(g)

    # Rule A: 1/0 polygons within buffer of each other
    l1_tree = _STRtree(l1_geoms)
    for i, buf in enumerate(l1_buf):
        try:
            for j in l1_tree.query(buf):
                j = int(j)
                if j != i and buf.intersects(l1_geoms[j]):
                    uf.union(i, j)
        except Exception:
            pass

    # Rule B: shared other-layer neighbours
    if other_geoms:
        ot = _STRtree(other_geoms)
        nbr = []
        for buf in l1_buf:
            try:
                touching = frozenset(
                    int(j) for j in ot.query(buf)
                    if buf.intersects(other_geoms[int(j)])
                )
            except Exception:
                touching = frozenset()
            nbr.append(touching)

        for i in range(n):
            for j in range(i + 1, n):
                if nbr[i] & nbr[j]:
                    uf.union(i, j)

    return _build_designs(l1_geoms, l1_shapes, uf, n, dbunit, use_shapely=True)


# ─── Bounding-box fallback ───────────────────────────────────────────────────

def _find_bbox(l1_shapes, other_shapes, dbunit, buf_dbu):
    n   = len(l1_shapes)
    uf  = _UF(n)

    l1_bbs  = [_bbox(s['pts']) for s in l1_shapes]
    oth_bbs = []
    for s in other_shapes:
        if s['type'] in ('boundary', 'path'):
            oth_bbs.append(_bbox(s['pts']))
        elif s['type'] == 'text':
            oth_bbs.append((s['x'], s['y'], s['x'], s['y']))

    def _exp(b, d):
        return (b[0] - d, b[1] - d, b[2] + d, b[3] + d)

    def _hits(a, b):
        return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])

    # Rule A
    for i in range(n):
        bi = _exp(l1_bbs[i], buf_dbu)
        for j in range(i + 1, n):
            if _hits(bi, l1_bbs[j]):
                uf.union(i, j)

    # Rule B
    if oth_bbs:
        nbr = []
        for i in range(n):
            bi = _exp(l1_bbs[i], buf_dbu)
            nbr.append(frozenset(j for j, ob in enumerate(oth_bbs) if _hits(bi, ob)))
        for i in range(n):
            for j in range(i + 1, n):
                if nbr[i] & nbr[j]:
                    uf.union(i, j)

    return _build_designs(None, l1_shapes, uf, n, dbunit, use_shapely=False)


# ─── Shared design-list builder ──────────────────────────────────────────────

def _build_designs(l1_geoms, l1_shapes, uf, n, dbunit, use_shapely):
    groups = defaultdict(list)
    for i in range(n):
        groups[uf.find(i)].append(i)

    designs = []
    for root, indices in sorted(groups.items()):
        if use_shapely and l1_geoms:
            try:
                merged = _unary_union([l1_geoms[i] for i in indices])
                b = merged.bounds   # (minx, miny, maxx, maxy)
            except Exception:
                use_shapely = False  # fall through

        if not use_shapely or not l1_geoms:
            xs = [c for i in indices for c in (
                min(p[0] for p in l1_shapes[i]['pts']),
                max(p[0] for p in l1_shapes[i]['pts']))]
            ys = [c for i in indices for c in (
                min(p[1] for p in l1_shapes[i]['pts']),
                max(p[1] for p in l1_shapes[i]['pts']))]
            b = (min(xs), min(ys), max(xs), max(ys))

        designs.append({
            'id':    len(designs),
            'x0':    float(b[0]), 'y0': float(b[1]),
            'x1':    float(b[2]), 'y1': float(b[3]),
            'x0_um': float(b[0]) * dbunit * 1e6,
            'y0_um': float(b[1]) * dbunit * 1e6,
            'x1_um': float(b[2]) * dbunit * 1e6,
            'y1_um': float(b[3]) * dbunit * 1e6,
            'label': None,
        })

    return {'designs': designs, 'count': len(designs)}


# ═══════════════════════════════════════════════════════════════════════════════
# GROUP DEVICES  —  detect regular rectangular arrays
# ═══════════════════════════════════════════════════════════════════════════════

def _cluster_1d(values: list, tol: float) -> list:
    """Cluster sorted floats within tolerance; return cluster centres."""
    if not values:
        return []
    sv = sorted(values)
    clusters, cur = [], [sv[0]]
    for v in sv[1:]:
        if v - cur[-1] <= tol:
            cur.append(v)
        else:
            clusters.append(sum(cur) / len(cur))
            cur = [v]
    clusters.append(sum(cur) / len(cur))
    return clusters


def group_devices(designs: list, dbunit: float) -> dict:
    """
    Detect rectangular device arrays from bounding-box centroids.

    Column index: 0 = leftmost  → increasing rightward.
    Row    index: 0 = bottommost → increasing upward.
    Label: <name><col><row>  (zero-padded to the required number of digits).

    Returns:
        {arrays: [{id, name, cols, rows, pitch_x_um, pitch_y_um,
                   devices: [{design_id, col, row, label}]}]}
    """
    if not designs:
        return {'arrays': []}

    if len(designs) == 1:
        return {'arrays': [{
            'id': 0, 'name': 'group', 'cols': 1, 'rows': 1,
            'pitch_x_um': 0.0, 'pitch_y_um': 0.0,
            'devices': [{'design_id': designs[0]['id'],
                         'col': 0, 'row': 0, 'label': 'group00'}],
        }]}

    # Centroids in DB units
    cx_list = [(d['x0'] + d['x1']) / 2 for d in designs]
    cy_list = [(d['y0'] + d['y1']) / 2 for d in designs]

    # Tolerance: 10% of median device dimension, at least 1 DBU
    med_w = sorted(d['x1'] - d['x0'] for d in designs)[len(designs) // 2]
    med_h = sorted(d['y1'] - d['y0'] for d in designs)[len(designs) // 2]
    tol_x = max(med_w * 0.10, 1.0)
    tol_y = max(med_h * 0.10, 1.0)

    x_cols = _cluster_1d(cx_list, tol_x)   # sorted ascending = left → right
    y_rows = _cluster_1d(cy_list, tol_y)   # sorted ascending = bottom → top

    nc, nr = len(x_cols), len(y_rows)

    # Pitch (µm)
    pitch_x = (((x_cols[-1] - x_cols[0]) / (nc - 1)) * dbunit * 1e6
               if nc > 1 else 0.0)
    pitch_y = (((y_rows[-1] - y_rows[0]) / (nr - 1)) * dbunit * 1e6
               if nr > 1 else 0.0)

    # Digit padding
    cd = max(len(str(nc - 1)), 1)
    rd = max(len(str(nr - 1)), 1)

    devices = []
    for d in designs:
        cx = (d['x0'] + d['x1']) / 2
        cy = (d['y0'] + d['y1']) / 2
        col = min(range(nc), key=lambda i: abs(x_cols[i] - cx))
        row = min(range(nr), key=lambda j: abs(y_rows[j] - cy))
        devices.append({
            'design_id': d['id'],
            'col': col, 'row': row,
            'label': f'group{col:0{cd}d}{row:0{rd}d}',
        })

    return {'arrays': [{
        'id': 0, 'name': 'group',
        'cols': nc, 'rows': nr,
        'pitch_x_um': round(pitch_x, 4),
        'pitch_y_um': round(pitch_y, 4),
        'devices': devices,
    }]}


# ═══════════════════════════════════════════════════════════════════════════════
# GDS INJECTOR  —  write layer 999/0 bounding boxes into the binary
# ═══════════════════════════════════════════════════════════════════════════════

def generate_gds_with_bboxes(raw_gds: bytes, designs: list,
                              cell_name: str,
                              out_layer: int = 1,
                              out_datatype: int = 100) -> bytes:
    """
    Insert a BOUNDARY element on *out_layer*/*out_datatype* for every design
    bounding box, directly before the ENDSTR record of *cell_name* in the raw
    GDS binary.  Default output layer is 1/100.
    Labels are NOT written to the GDS (they live only in the webapp).
    """

    def _rec(rtype: int, dtype: int, payload: bytes = b'') -> bytes:
        length = 4 + len(payload)
        if length & 1:          # must be even
            length += 1
            payload += b'\x00'
        return struct.pack('>HBB', length, rtype, dtype) + payload

    # Build all BOUNDARY records for the bounding boxes
    bbox_bytes = bytearray()
    for d in designs:
        x0, y0 = int(round(d['x0'])), int(round(d['y0']))
        x1, y1 = int(round(d['x1'])), int(round(d['y1']))
        # Closed rectangle: BL → BR → TR → TL → BL  (5 vertices)
        xy = struct.pack('>iiiiiiiiii',
                         x0, y0,
                         x1, y0,
                         x1, y1,
                         x0, y1,
                         x0, y0)
        bbox_bytes += _rec(0x08, 0x00)                                        # BOUNDARY
        bbox_bytes += _rec(0x0D, 0x02, struct.pack('>h', out_layer))       # LAYER
        bbox_bytes += _rec(0x0E, 0x02, struct.pack('>h', out_datatype))    # DATATYPE
        bbox_bytes += _rec(0x10, 0x03, xy)                      # XY
        bbox_bytes += _rec(0x11, 0x00)                          # ENDEL

    # Locate ENDSTR of the target cell
    pos = 0
    in_target = False
    insert_at = -1

    while pos + 4 <= len(raw_gds):
        length = struct.unpack_from('>H', raw_gds, pos)[0]
        if length < 4 or pos + length > len(raw_gds):
            break
        rt = raw_gds[pos + 2]
        dt = raw_gds[pos + 3]
        ds = pos + 4
        dl = length - 4

        if rt == 0x06 and dt == 0x06:   # STRNAME
            in_target = (_gds_str(raw_gds, ds, dl) == cell_name)

        if rt == 0x07 and dt == 0x00 and in_target:   # ENDSTR
            insert_at = pos
            break

        pos += length

    if insert_at < 0:
        # Fallback: insert just before ENDLIB (last 4 bytes)
        insert_at = max(len(raw_gds) - 4, 0)

    return raw_gds[:insert_at] + bytes(bbox_bytes) + raw_gds[insert_at:]
