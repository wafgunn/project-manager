/*
 * waveguides.js — Waveguide centreline-length measurement (Tab 3 Sub-tab 1)
 *
 * Owns:
 *   • measureWaveguideLengths()    — calls /api/measure-waveguides, updates state
 *   • drawWgLengthOverlays(ctx)    — renders measurement lines + labels on canvas3
 *   • _wgMenuToggle(e)             — opens/closes the settings dropdown
 *   • _wgToAllToggle()             — enables/disables the To input
 *   • _wgPopulateGratingDropdowns() — refreshes From/To selects from current gratings
 *
 * State written: wgLengths  (declared in state.js; guard below covers stale cache)
 *
 * Depends on: state.js, canvas.js, modal.js, gratings.js
 */

// Guard: declare wgLengths here in case a cached state.js pre-dates its addition.
// state.js is the canonical home; this is a safety net only.
if (typeof wgLengths === 'undefined') { var wgLengths = []; }

// ═══════════════════════════════════════════════════════════════════
// SETTINGS DROPDOWN  (mirrors _gratingMenuToggle / _exportMenuToggle)
// ═══════════════════════════════════════════════════════════════════

function _wgMenuToggle(e) {
  e.stopPropagation();
  var m = document.getElementById('wg-settings-menu');
  if (!m) return;
  var open = m.style.display === 'block';
  m.style.display = open ? 'none' : 'block';
  if (!open) _wgPopulateGratingDropdowns();
}

document.addEventListener('click', function(e) {
  var menu  = document.getElementById('wg-settings-menu');
  var arrow = document.getElementById('wg-settings-arrow');
  if (menu && menu.style.display === 'block'
      && !menu.contains(e.target) && e.target !== arrow)
    menu.style.display = 'none';
});

// ═══════════════════════════════════════════════════════════════════
// POPULATE FROM / TO DROPDOWNS
// ═══════════════════════════════════════════════════════════════════

function _wgPopulateGratingDropdowns() {
  var fromSel = document.getElementById('wg-from');
  var toSel   = document.getElementById('wg-to');
  if (!fromSel || !toSel) return;

  // Gratings on the currently active device
  var devGratings = (activeDeviceId >= 0)
    ? gratings.filter(function(g) { return g.device_id === activeDeviceId; })
    : [];

  var labels = devGratings.map(function(g) { return g.label; });

  // Rebuild From
  var prevFrom = fromSel.value;
  fromSel.innerHTML = '';
  labels.forEach(function(l) {
    var o = document.createElement('option');
    o.value = o.textContent = l;
    fromSel.appendChild(o);
  });
  if (labels.indexOf(prevFrom) >= 0) fromSel.value = prevFrom;

  // Rebuild To
  var prevTo = toSel.value;
  toSel.innerHTML = '';
  labels.forEach(function(l) {
    var o = document.createElement('option');
    o.value = o.textContent = l;
    toSel.appendChild(o);
  });
  if (labels.indexOf(prevTo) >= 0) toSel.value = prevTo;

  // Default To to G2 if From is G1, etc.
  if (labels.length >= 2 && fromSel.value === toSel.value) {
    var nextIdx = (labels.indexOf(fromSel.value) + 1) % labels.length;
    toSel.value = labels[nextIdx];
  }

  _wgToAllToggle();
}

// ═══════════════════════════════════════════════════════════════════
// TO-ALL TOGGLE
// ═══════════════════════════════════════════════════════════════════

function _wgToAllToggle() {
  var allChk = document.getElementById('wg-to-all');
  var toSel  = document.getElementById('wg-to');
  if (!allChk || !toSel) return;
  toSel.disabled    = allChk.checked;
  toSel.style.opacity = allChk.checked ? '0.35' : '1';
}

// ═══════════════════════════════════════════════════════════════════
// DEVICE LABEL + TYPE HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Return the display label for a device from deviceGroups (the same
 * source used by buildLabelMap / updateDeviceViewerHeader).
 * Falls back to dev.label then "id:<n>" so this never returns empty.
 */
function _wgGetDeviceLabel(dev) {
  var map = (typeof buildLabelMap === 'function') ? buildLabelMap() : {};
  return map[dev.id] || dev.label || ('id:' + dev.id);
}

/**
 * Return the type prefix of a device: the first '_'-separated segment
 * of its display label.  "intc1to10_intc17" → "intc1to10".
 */
function _wgDeviceType(dev) {
  var label = _wgGetDeviceLabel(dev);
  return label.split('_')[0] || label;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN MEASUREMENT
// ═══════════════════════════════════════════════════════════════════

function measureWaveguideLengths() {
  if (!gratings.length) {
    showModal('No Gratings', 'Run Find Optical Gratings first (Tab 3, Sub-tab 1).');
    return;
  }
  if (activeDeviceId < 0) {
    showModal('No Device', 'Select a device first.');
    return;
  }

  // Close dropdown
  var menu = document.getElementById('wg-settings-menu');
  if (menu) menu.style.display = 'none';

  // Read settings
  var fromLabel  = (document.getElementById('wg-from')  || {}).value || 'G1';
  var toAllChk   = document.getElementById('wg-to-all');
  var toAll      = toAllChk ? toAllChk.checked : false;
  var toLabel    = (document.getElementById('wg-to') || {}).value || 'G2';
  var wgWidthUm  = parseFloat((document.getElementById('wg-width-um') || {}).value || 0.5);
  var toLabels   = toAll ? null : [toLabel];

  // Inherit wg layer from Tab 1 find layer (or default 1/0)
  var wgLayer = parseInt((document.getElementById('find-layer-input')    || {}).value) || 1;
  var wgDt    = parseInt((document.getElementById('find-datatype-input') || {}).value) || 0;

  // Grating layer from Tab 3 settings
  var gLayer = parseInt((document.getElementById('grd-layer') || {}).value) || 2;
  var gDt    = parseInt((document.getElementById('grd-dt')    || {}).value) || 6;

  // Always measure the active device only; use Apply to All Type for propagation
  var deviceIds = [activeDeviceId];

  var btn = document.getElementById('measure-wg-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Measuring…'; }

  fetch('/api/measure-waveguides', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_label:       fromLabel,
      to_labels:        toLabels,
      wg_layer:         wgLayer,
      wg_datatype:      wgDt,
      grating_layer:    gLayer,
      grating_datatype: gDt,
      comp_layer:       68,
      comp_datatype:    0,
      wg_width_um:      wgWidthUm,
      device_ids:       deviceIds,
      // Frontend fallbacks for after .gdspm open
      designs:          devices,
      gratings:         gratings,
      active_cell:      activeCell ? activeCell.name : '',
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.detail) { showModal('Measurement Error', data.detail, '', true); return; }

    // Merge into wgLengths (replace existing entries for same port pairs)
    var newResults = data.results || [];
    newResults.forEach(function(nr) {
      var idx = wgLengths.findIndex(function(e) {
        return e.port_from === nr.port_from && e.port_to === nr.port_to;
      });
      if (idx >= 0) wgLengths[idx] = nr;
      else wgLengths.push(nr);
    });

    _wgRenderMeasurementsPanel();
    redraw3();

    var st = document.getElementById('wg-status');
    if (st) st.textContent = data.message || '';

    // ── Connection warnings (only when measuring to all) ─────────────────
    if (toAll && newResults.length) {
      var warnings = [];

      // Check whether the from-grating connects to a component at all.
      // If every successful result is a loopback (comp_info null), alert the user.
      var successResults = newResults.filter(function(r) { return !r.discontinuity; });
      var anyComp = successResults.some(function(r) { return !!r.comp_info; });
      if (successResults.length && !anyComp) {
        warnings.push(fromLabel + ' does not connect to any component on this device — '
          + 'it appears to be a loopback port, so component-path lengths cannot be measured from it.');
      }

      // Collect gratings that have no waveguide path to the from-grating
      var disconnected = newResults
        .filter(function(r) { return r.discontinuity; })
        .map(function(r) { return r.to; });
      if (disconnected.length) {
        warnings.push(disconnected.join(', ')
          + (disconnected.length === 1 ? ' is' : ' are')
          + ' not connected to ' + fromLabel + '.');
      }

      if (warnings.length) {
        showModal('Connection Warning', warnings.join('\n\n'), '', true);
      }
    }
  })
  .catch(function(e) { showModal('Network Error', '' + e, '', true); })
  .finally(function() {
    var b = document.getElementById('measure-wg-btn');
    if (b) { b.disabled = false; b.textContent = '⟵⟶ Measure Waveguide Lengths'; }
  });
}

// ═══════════════════════════════════════════════════════════════════
// CANVAS OVERLAYS  (called from redraw3 in device-viewer.js)
// ═══════════════════════════════════════════════════════════════════

var _WG_PATH_COLOR = '#58a6ff';   // blue — traced centreline path + label

// drawWgLengthOverlays — retained for the component dot only.
// The amber ruler line and its label have been removed; the measured
// length is now displayed on the traced path by drawWgPathOverlays.
function drawWgLengthOverlays(ctx) {
  if (!wgLengths.length || activeDeviceId < 0) return;
  var dbu = lib ? lib.dbunit : 1e-9;

  wgLengths.forEach(function(r) {
    if (r.device_id !== activeDeviceId) return;
    if (r.discontinuity || !r.comp_info)  return;

    // Purple dot at the 68/0 component location
    var cx =  r.comp_info.center_um[0] * 1e-6 / dbu * zoom + panX;
    var cy = -r.comp_info.center_um[1] * 1e-6 / dbu * zoom + panY;
    ctx.save();
    ctx.fillStyle = '#bc8cff';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  });
}

// ═══════════════════════════════════════════════════════════════════
// TRACED-PATH OVERLAY  (dotted blue centreline + one-way length label)
// ═══════════════════════════════════════════════════════════════════

function drawWgPathOverlays(ctx) {
  if (!wgLengths.length || activeDeviceId < 0) return;

  var dbu   = lib ? lib.dbunit : 1e-9;
  var scale = 1e-6 / dbu;   // µm → canvas:  x = x_um * scale * zoom + panX

  wgLengths.forEach(function(r) {
    if (r.device_id !== activeDeviceId) return;
    if (r.discontinuity)               return;
    if (!r.path_pts_um || r.path_pts_um.length < 2) return;

    var pts = r.path_pts_um;

    // Convert all points to canvas coords
    var cpts = pts.map(function(p) {
      return [p[0] * scale * zoom + panX,
             -p[1] * scale * zoom + panY];
    });

    ctx.save();

    // ── Dotted centreline path ──────────────────────────────────────
    ctx.strokeStyle = _WG_PATH_COLOR + 'cc';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 5]);
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';

    ctx.beginPath();
    ctx.moveTo(cpts[0][0], cpts[0][1]);
    for (var i = 1; i < cpts.length; i++) {
      ctx.lineTo(cpts[i][0], cpts[i][1]);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Small terminal dots at G* and G% ───────────────────────────
    ctx.fillStyle = _WG_PATH_COLOR + 'cc';
    [cpts[0], cpts[cpts.length - 1]].forEach(function(p) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], 2.5, 0, 2 * Math.PI);
      ctx.fill();
    });

    // ── Length label at path midpoint ──────────────────────────────
    if (r.length_um !== null && r.length_um !== undefined) {
      var mid   = cpts[Math.floor(cpts.length / 2)];
      var label = r.from + '→' + r.to + '  ' + r.length_um.toFixed(2) + ' µm';
      ctx.font  = 'bold 9px monospace';
      var tw    = ctx.measureText(label).width;
      // Background pill
      ctx.fillStyle = '#00000099';
      ctx.fillRect(mid[0] - tw / 2 - 4, mid[1] - 9, tw + 8, 13);
      // Text
      ctx.fillStyle = _WG_PATH_COLOR;
      ctx.fillText(label, mid[0] - tw / 2, mid[1] + 2);
    }

    ctx.restore();
  });
}

// ═══════════════════════════════════════════════════════════════════
// CLEAR MEASUREMENTS
// ═══════════════════════════════════════════════════════════════════

/**
 * Remove all waveguide measurement results for the currently active device.
 * Other devices' results are preserved.
 */
function clearDeviceMeasurements() {
  if (activeDeviceId < 0) {
    showModal('No Device', 'Select a device first.');
    return;
  }
  var before = wgLengths.length;
  wgLengths = wgLengths.filter(function(r) { return r.device_id !== activeDeviceId; });
  var removed = before - wgLengths.length;

  _wgRenderMeasurementsPanel();
  redraw3();

  var st = document.getElementById('wg-status');
  if (st) st.textContent = removed
    ? 'Cleared ' + removed + ' measurement' + (removed > 1 ? 's' : '') + ' for this device.'
    : 'No measurements to clear for this device.';
}

/**
 * Remove every waveguide measurement result across all devices.
 */
function clearAllMeasurements() {
  var count = wgLengths.length;
  wgLengths = [];

  _wgRenderMeasurementsPanel();
  redraw3();

  var st = document.getElementById('wg-status');
  if (st) st.textContent = count
    ? 'Cleared all ' + count + ' measurement' + (count > 1 ? 's' : '') + '.'
    : 'No measurements to clear.';
}

// ═══════════════════════════════════════════════════════════════════
// APPLY TO ALL TYPE  —  dropdown picker
// ═══════════════════════════════════════════════════════════════════

/**
 * Open the type-picker dropdown near the clicked button.
 * Shows every unique type prefix found across ALL devices so the user can
 * choose which family to propagate the active device's measurements to.
 */
function applyWgToAllType(event) {
  var menu = document.getElementById('wg-type-picker-menu');
  if (!menu) return;

  // Toggle closed if already open
  if (menu.style.display === 'block') {
    menu.style.display = 'none';
    return;
  }

  // Guard: need an active device with measurements
  if (activeDeviceId < 0) { showModal('No Device', 'Select a device first.'); return; }
  var srcMeas = wgLengths.filter(function(r) {
    return r.device_id === activeDeviceId && !r.discontinuity;
  });
  if (!srcMeas.length) {
    showModal('No Measurements', 'Measure the active device first, then apply to type.');
    return;
  }

  // Build type → count map from ALL device labels
  var activeDev   = devices.find(function(d) { return d.id === activeDeviceId; });
  var activeType  = activeDev ? _wgDeviceType(activeDev) : '';
  var typeCount   = {};
  devices.forEach(function(d) {
    var t = _wgDeviceType(d);
    if (t) typeCount[t] = (typeCount[t] || 0) + 1;
  });
  var types = Object.keys(typeCount).sort();

  // Populate the list
  var list = document.getElementById('wg-type-picker-list');
  if (!list) return;
  list.innerHTML = '';
  types.forEach(function(t) {
    var count    = typeCount[t];
    var isActive = (t === activeType);
    var btn      = document.createElement('button');
    btn.style.cssText = 'display:flex;justify-content:space-between;align-items:center;'
      + 'width:100%;padding:5px 10px;'
      + 'background:' + (isActive ? '#0d2137' : 'transparent') + ';'
      + 'border:' + (isActive ? '1px solid #1f6feb44' : '1px solid transparent') + ';'
      + 'border-radius:4px;'
      + 'color:' + (isActive ? '#58a6ff' : '#c9d1d9') + ';'
      + 'font-family:inherit;font-size:11px;cursor:pointer;text-align:left;';
    btn.innerHTML = '<span>' + t + '</span>'
      + '<span style=”font-size:9px;color:#484f58;margin-left:12px;”>'
      + count + ' device' + (count !== 1 ? 's' : '') + '</span>';
    btn.onmouseenter = function() { this.style.background = '#1f6feb22'; };
    btn.onmouseleave = function() { this.style.background = isActive ? '#0d2137' : 'transparent'; };
    btn.onclick = function(e) {
      e.stopPropagation();
      menu.style.display = 'none';
      _applyWgToType(t);
    };
    list.appendChild(btn);
  });

  // Position fixed below the clicked button
  var rect = (event && event.currentTarget)
    ? event.currentTarget.getBoundingClientRect()
    : (event && event.target ? event.target.getBoundingClientRect() : { bottom: 100, right: 200 });
  menu.style.top   = (rect.bottom + 4) + 'px';
  // Right-justify: align the dropdown's right edge with the button's right edge.
  // This keeps it on-screen for buttons near the right side of the window.
  menu.style.left  = 'auto';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  menu.style.display = 'block';
  event && event.stopPropagation && event.stopPropagation();
}

// Close picker on any outside click
document.addEventListener('click', function() {
  var m = document.getElementById('wg-type-picker-menu');
  if (m) m.style.display = 'none';
});

/**
 * Actually copy the active device's measurements to every device whose
 * display label contains *typePrefix* as a substring.
 * Path points and comp centres are translated by the device-centre offset.
 */
function _applyWgToType(typePrefix) {
  if (activeDeviceId < 0) return;
  var srcMeas = wgLengths.filter(function(r) {
    return r.device_id === activeDeviceId && !r.discontinuity;
  });
  if (!srcMeas.length) return;

  var activeDev = devices.find(function(d) { return d.id === activeDeviceId; });
  if (!activeDev) return;

  var dbu   = lib ? lib.dbunit : 1e-9;
  var srcCx = (activeDev.x0 + activeDev.x1) * 0.5 * dbu * 1e6;  // µm
  var srcCy = (activeDev.y0 + activeDev.y1) * 0.5 * dbu * 1e6;

  // Match: any device (other than source) whose label contains typePrefix
  var targets = devices.filter(function(d) {
    if (d.id === activeDeviceId) return false;
    var lbl = _wgGetDeviceLabel(d);
    return lbl.indexOf(typePrefix) !== -1;
  });

  if (!targets.length) {
    showModal('No Matches',
      'No other devices found with “' + typePrefix + '” in their label.');
    return;
  }

  var applied = 0;
  targets.forEach(function(tgt) {
    var tgtCx    = (tgt.x0 + tgt.x1) * 0.5 * dbu * 1e6;
    var tgtCy    = (tgt.y0 + tgt.y1) * 0.5 * dbu * 1e6;
    var dx       = tgtCx - srcCx;
    var dy       = tgtCy - srcCy;
    var tgtLabel = _wgGetDeviceLabel(tgt);

    srcMeas.forEach(function(src) {
      var portFrom = tgtLabel + '__' + src.from;
      var portTo   = tgtLabel + '__' + src.to;

      // Translate path points by centre offset
      var newPts = (src.path_pts_um || []).map(function(p) {
        return [p[0] + dx, p[1] + dy];
      });

      // Translate component centre; arm lengths stay the same
      var newComp = null;
      if (src.comp_info) {
        newComp = {
          center_um:    [src.comp_info.center_um[0] + dx,
                         src.comp_info.center_um[1] + dy],
          dist_from_um: src.comp_info.dist_from_um,
          dist_to_um:   src.comp_info.dist_to_um,
          bbox_dbu:     src.comp_info.bbox_dbu,
        };
      }

      var entry = {
        device_id:    tgt.id,
        device_label: tgtLabel,
        from:         src.from,
        to:           src.to,
        length_um:    src.length_um,
        discontinuity: false,
        is_loopback:  src.is_loopback,
        comp_info:    newComp,
        path_pts_um:  newPts,
        port_from:    portFrom,
        port_to:      portTo,
        error:        null,
      };

      var idx = wgLengths.findIndex(function(e) {
        return e.port_from === portFrom && e.port_to === portTo;
      });
      if (idx >= 0) wgLengths[idx] = entry;
      else wgLengths.push(entry);
      applied++;
    });
  });

  _wgRenderMeasurementsPanel();
  redraw3();

  var st = document.getElementById('wg-status');
  if (st) st.textContent = 'Applied “' + typePrefix + '” → '
    + targets.length + ' device' + (targets.length !== 1 ? 's' : '')
    + ' (' + applied + ' measurement' + (applied !== 1 ? 's' : '') + ').';
}

// ═══════════════════════════════════════════════════════════════════
// VIEW MEASUREMENTS PANEL  (Sub-tab 5)
// ═══════════════════════════════════════════════════════════════════

/**
 * Toggle the Measurements dropdown open/closed.
 * Pass event to prevent bubbling (so the click-outside handler doesn't
 * immediately close it again on the same click).
 */
function _wgMeasDropdownToggle(event) {
  if (event) event.stopPropagation();
  var d = document.getElementById('wg-meas-dropdown');
  if (!d) return;
  var isOpen = d.style.display === 'flex';
  d.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen) _wgRenderMeasurementsPanel();
}

// Close the Measurements dropdown when the user clicks outside it.
document.addEventListener('click', function(e) {
  var d = document.getElementById('wg-meas-dropdown');
  if (!d || d.style.display === 'none') return;
  var wrapper = document.getElementById('wg-meas-wrapper');
  if (wrapper && !wrapper.contains(e.target)) d.style.display = 'none';
});

/**
 * Render measurements for the active device into #wg-meas-panel-content.
 */
function _wgRenderMeasurementsPanel() {
  var panel   = document.getElementById('wg-meas-panel-content');
  var counter = document.getElementById('wg-meas-count');
  if (!panel) return;

  var rows = activeDeviceId >= 0
    ? wgLengths.filter(function(r) { return r.device_id === activeDeviceId; })
    : [];

  if (counter) counter.textContent = rows.length
    ? rows.length + ' measurement' + (rows.length !== 1 ? 's' : '')
    : '';

  if (!rows.length) {
    panel.innerHTML = '<span style="color:#484f58;font-size:11px;display:block;'
      + 'text-align:center;padding-top:40px;">'
      + (activeDeviceId < 0
          ? 'No device selected.'
          : 'No measurements for this device.<br>Use Measure Waveguide Lengths in GDS Preview.')
      + '</span>';
    return;
  }

  var html = '<table style="width:100%;border-collapse:collapse;">';
  rows.forEach(function(r, i) {
    var bg = i % 2 === 0 ? '#0d1117' : '#161b22';

    var portStr = '<span style="font-family:monospace;font-size:11px;color:#c9d1d9;">'
                + r.from + ' → ' + r.to + '</span>';

    var typeStr = r.discontinuity
      ? '<span style="font-size:9px;color:#ff7b72;">no path</span>'
      : r.comp_info
        ? '<span style="font-size:9px;color:#bc8cff;" title="'
          + r.comp_info.dist_from_um.toFixed(1) + ' µm + '
          + r.comp_info.dist_to_um.toFixed(1) + ' µm">⬡ comp</span>'
        : '<span style="font-size:9px;color:#58a6ff;">⟲ loop</span>';

    var lenStr = r.discontinuity
      ? '<span style="color:#ff7b72;font-family:monospace;font-size:11px;">—</span>'
      : (r.length_um !== null
          ? '<span style="color:#3fb950;font-family:monospace;font-size:11px;font-weight:600;">'
            + r.length_um.toFixed(2) + ' µm</span>'
          : '<span style="color:#e3b341;font-size:11px;">—</span>');

    html += '<tr style="background:' + bg + ';border-bottom:1px solid #30363d22;">'
          + '<td style="padding:6px 12px;">' + portStr + '</td>'
          + '<td style="padding:6px 8px;text-align:center;">' + typeStr + '</td>'
          + '<td style="padding:6px 12px;text-align:right;">' + lenStr + '</td>'
          + '</tr>';
  });
  html += '</table>';

  panel.innerHTML = html;
}
