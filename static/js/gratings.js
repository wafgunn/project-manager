/*
 * gratings.js — Optical grating coupler finder + overlay renderer (Tab 3 Sub-tab 1)
 *
 * Owns:
 *   • findOpticalGratings()        — calls /api/find-gratings, updates state
 *   • drawGratingOverlays(ctx)     — renders grating bboxes + labels on canvas3
 *   • _gratingMenuToggle(e)        — opens/closes the settings dropdown
 *   • _gratingFibrePitchToggle()   — enables/disables the pitch input
 *
 * Device layer/datatype is not exposed in the UI; it is silently inherited from
 * the Tab 1 "Find Devices" search layer (find-layer-input / find-datatype-input),
 * defaulting to 1/0 if those inputs are absent.
 *
 * Depends on: state.js, canvas.js, modal.js
 */
// ═══════════════════════════════════════════════════════════════════
// SETTINGS DROPDOWN  (mirrors _findTolMenuToggle / _exportMenuToggle)
// ═══════════════════════════════════════════════════════════════════
function _gratingMenuToggle(e){
  e.stopPropagation();
  var m=document.getElementById('grd-settings-menu');
  if(!m)return;
  m.style.display=(m.style.display==='none'||!m.style.display)?'block':'none';
}
document.addEventListener('click',function(e){
  var menu=document.getElementById('grd-settings-menu');
  var arrow=document.getElementById('grd-settings-arrow');
  if(menu&&menu.style.display==='block'&&!menu.contains(e.target)&&e.target!==arrow)
    menu.style.display='none';
});

// ═══════════════════════════════════════════════════════════════════
// FIBRE PITCH TOGGLE
// ═══════════════════════════════════════════════════════════════════
function _gratingFibrePitchToggle(){
  var en=document.getElementById('grd-fibre-pitch-en');
  var inp=document.getElementById('grd-fibre-pitch');
  if(!en||!inp)return;
  inp.disabled=!en.checked;
  inp.style.opacity=en.checked?'1':'0.35';
}

// ═══════════════════════════════════════════════════════════════════
// FIND OPTICAL GRATINGS
// ═══════════════════════════════════════════════════════════════════
function findOpticalGratings(){
  if(!devices.length){showModal('No Devices','Run Find Devices first (Tab 1).');return;}

  // Close settings menu
  var menu=document.getElementById('grd-settings-menu');
  if(menu)menu.style.display='none';

  // Read grating settings from dropdown
  var gLayer  = parseInt((document.getElementById('grd-layer')||{}).value)      || 2;
  var gDt     = parseInt((document.getElementById('grd-dt')||{}).value)          || 6;
  var tol     = parseFloat((document.getElementById('grd-tolerance')||{}).value) || 1.0;
  var pitchEn = (document.getElementById('grd-fibre-pitch-en')||{}).checked !== false;
  var pitch   = pitchEn
    ? (parseFloat((document.getElementById('grd-fibre-pitch')||{}).value) || 127.0)
    : null;

  // Inherit device layer silently from Tab 1 search layer (defaults to 1/0)
  var dLayer  = parseInt((document.getElementById('find-layer-input')||{}).value)    || 1;
  var dDt     = parseInt((document.getElementById('find-datatype-input')||{}).value) || 0;

  var btn=document.getElementById('find-gratings-btn');
  if(btn){btn.disabled=true;btn.textContent='⏳ Searching…';}

  fetch('/api/find-gratings',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      grating_layer:    gLayer,
      grating_datatype: gDt,
      device_layer:     dLayer,
      device_datatype:  dDt,
      tolerance_um:     tol,
      fibre_pitch_um:   pitch,
      // Send current frontend devices so the endpoint works after a .gdspm
      // open where the backend session has no designs yet.
      designs:          devices,
      // Send the active cell name — session["active_cell"] is "" after a
      // .gdspm open because /api/upload resets it; the frontend always knows.
      active_cell:      activeCell ? activeCell.name : '',
    })
  })
  .then(function(r){return r.json();})
  .then(function(data){
    if(data.detail){showModal('Grating Error',data.detail,'',true);return;}

    // Update frontend grating state
    gratings=data.gratings||[];

    // Apply expanded device bboxes to frontend devices array
    var expMap={};
    (data.expanded_designs||[]).forEach(function(d){expMap[d.id]=d;});
    devices.forEach(function(d){
      var exp=expMap[d.id];
      if(exp){d.x0=exp.x0;d.y0=exp.y0;d.x1=exp.x1;d.y1=exp.y1;}
    });

    renderCacheDirty=true;
    redraw3();

    var statusEl=document.getElementById('grd-status');
    if(statusEl)statusEl.textContent=data.message||'';
  })
  .catch(function(e){showModal('Network Error',''+e,'',true);})
  .finally(function(){
    var b=document.getElementById('find-gratings-btn');
    if(b){b.disabled=false;b.textContent='✦ Find Optical Gratings';}
  });
}

// ═══════════════════════════════════════════════════════════════════
// RENDER GRATING OVERLAYS  (called from redraw3 in device-viewer.js)
// ═══════════════════════════════════════════════════════════════════
var _GRATING_COLOR='#00ffaa';

function drawGratingOverlays(ctx){
  if(!gratings.length||activeDeviceId<0)return;
  var devGratings=gratings.filter(function(g){return g.device_id===activeDeviceId;});
  if(!devGratings.length)return;

  devGratings.forEach(function(g){
    var sx=g.x0*zoom+panX;
    var sy=-g.y1*zoom+panY;
    var sw=(g.x1-g.x0)*zoom;
    var sh=(g.y1-g.y0)*zoom;
    if(sw<1||sh<1)return;

    // Filled tint + dashed outline
    ctx.fillStyle=_GRATING_COLOR+'20';
    ctx.fillRect(sx,sy,sw,sh);
    ctx.strokeStyle=_GRATING_COLOR;
    ctx.lineWidth=1.2;
    ctx.setLineDash([4,3]);
    ctx.strokeRect(sx,sy,sw,sh);
    ctx.setLineDash([]);

    // Label badge
    var fs=Math.max(7,Math.min(11,sw/4,sh/1.8));
    if(fs>=7&&sw>18&&sh>10){
      ctx.font='bold '+fs+'px monospace';
      var tw=ctx.measureText(g.label).width;
      ctx.fillStyle='#00000099';
      ctx.fillRect(sx+2,sy+2,tw+5,fs+5);
      ctx.fillStyle=_GRATING_COLOR;
      ctx.fillText(g.label,sx+4,sy+fs+4);
    }
  });
}
