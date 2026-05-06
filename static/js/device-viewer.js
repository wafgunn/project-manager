/*
 * device-viewer.js — Tab 3 device viewer core + app init()
 *
 * Owns:
 *   • init() — wires all event handlers and starts the app
 *   • Tab 3 device fit-view
 *   • Device navigation (next/prev/select)
 *   • Sub-tab switching for the device viewer
 *
 * Depends on: all other modules
 */
// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════
(function init(){
  initCanvases();
  setupMouse(canvas1,function(){return tool1;});
  setupMouse(canvas2,function(){return tool2;});
  if(canvas3)setupMouse(canvas3,function(){return tool3;});

  // Canvas2: track mousedown for click-vs-drag, navigate on click
  canvas2.addEventListener('mousedown',function(e){_c2DownX=e.clientX;_c2DownY=e.clientY;},true);
  canvas2.addEventListener('click',function(e){
    if(!devices.length)return;
    if(Math.hypot(e.clientX-_c2DownX,e.clientY-_c2DownY)>6)return;
    var rect=canvas2.getBoundingClientRect();
    var cx=e.clientX-rect.left,cy=e.clientY-rect.top;
    // Badge hit-test: SEM badge → sub-tab 2, OD badge → sub-tab 3
    for(var bi=0;bi<_mapBadgeHits.length;bi++){
      var bh=_mapBadgeHits[bi];
      if(cx>=bh.x&&cx<=bh.x+bh.w&&cy>=bh.y&&cy<=bh.y+bh.h){
        activeDeviceId=bh.deviceId;goTab(3);setDvSubTab(bh.subTab);return;
      }
    }
    var wp=s2w(cx,cy);
    var idx=findDeviceAt(wp[0],wp[1]);
    if(idx>=0){activeDeviceId=devices[idx].id;goTab(3);}
  });

  // Tab 3 tool buttons
  ['t3-pan','t3-ruler'].forEach(function(id){
    var el=document.getElementById(id);
    if(el)el.addEventListener('click',function(){setTool(3,id.replace('t3-',''));});
  });

  // SEM file input
  var semIn=document.getElementById('sem-input');
  if(semIn)semIn.addEventListener('change',function(e){addSemImages(e.target.files);this.value='';});
  var semDirIn=document.getElementById('sem-dir-input');
  if(semDirIn)semDirIn.addEventListener('change',function(e){addSemDirFiles(e.target.files);this.value='';});
  _initSemPreviewHandlers();
  _initProjectHandlers();

  // Optical file input
  var optIn=document.getElementById('opt-input');
  if(optIn)optIn.addEventListener('change',function(){optFiles=Array.from(this.files);_scanOptFromFiles();autoMatchOptDevice();this.value='';});

  makeSidebarResizeH('sb-left-handle','sb-left',120,400,false);
  makeSidebarResizeH('devices-handle','devices-sidebar',150,440,true);
  makeSidebarResizeH('devices-handle-2','devices-sidebar-2',150,440,true);
  makeSidebarResizeV('sb-left-row-handle','cells-section',50);
  redraw1();
  redraw2();

  // ── Optical chart mouse handlers ──────────────────────────────────
  // Margins must match drawOptChart: m={t:38,r:22,b:52,l:68}
  var OC_PL=68,OC_PR=22,OC_PT=38,OC_PB=52;
  var oc=document.getElementById('opt-chart');
  if(oc){
    // ── Wheel: zoom in/out around cursor (0.25× original sensitivity) ──
    oc.addEventListener('wheel',function(e){
      e.preventDefault();
      var curves=_optActiveCurves();
      if(!curves.length)return;
      var roll=Math.max(1,parseInt(document.getElementById('opt-rolling').value)||1);
      var r=_optGetCurrentRanges(curves,roll);
      var rect=oc.getBoundingClientRect();
      var mx=e.clientX-rect.left,my=e.clientY-rect.top;
      var pw=oc.width-OC_PL-OC_PR,ph=oc.height-OC_PT-OC_PB;
      var wx=r.xMin+(mx-OC_PL)/pw*(r.xMax-r.xMin);
      var wy=r.yMax-(my-OC_PT)/ph*(r.yMax-r.yMin);
      var factor=e.deltaY>0?1.0625:(1/1.0625); // ≈ ±6 % per tick (0.25× original ±25%)
      optViewXMin=wx+(r.xMin-wx)*factor;optViewXMax=wx+(r.xMax-wx)*factor;
      optViewYMin=wy+(r.yMin-wy)*factor;optViewYMax=wy+(r.yMax-wy)*factor;
      drawOptChart();
    },{passive:false});

    // ── Hover cursor: ew-resize near target-WL marker ──
    oc.addEventListener('mousemove',function(e){
      if(_optDragStart)return; // let window handler take over during drag
      var curves=_optActiveCurves();
      if(!curves.length){oc.style.cursor='default';return;}
      var roll=Math.max(1,parseInt(document.getElementById('opt-rolling').value)||1);
      var r=_optGetCurrentRanges(curves,roll);
      var rect=oc.getBoundingClientRect();
      var cx=e.clientX-rect.left,cy=e.clientY-rect.top;
      var pw=oc.width-OC_PL-OC_PR;
      var markerPx=OC_PL+(optTargetWL-r.xMin)/(r.xMax-r.xMin)*pw;
      _optNearTWL=(Math.abs(cx-markerPx)<7&&cy>=OC_PT&&cy<=oc.height-OC_PB);
      oc.style.cursor=_optNearTWL?'ew-resize':(_optTool==='zoombox'?'crosshair':'default');
    });

    // ── Mousedown: start pan / zoombox / TWL drag ──
    oc.addEventListener('mousedown',function(e){
      e.preventDefault();
      var rect=oc.getBoundingClientRect();
      _optDragStart={x:e.clientX-rect.left,y:e.clientY-rect.top};
      _optDragEnd=null;
      if(_optNearTWL){
        _optDragMode='twl';
        oc.style.cursor='ew-resize';
      } else {
        _optDragMode=(e.ctrlKey||e.shiftKey)?'zoombox':_optTool;
        oc.style.cursor=_optDragMode==='zoombox'?'crosshair':'grabbing';
      }
    });

    // ── Mousemove (window): pan / zoombox rubber-band / TWL drag ──
    window.addEventListener('mousemove',function(e){
      if(!_optDragStart)return;
      var rect=oc.getBoundingClientRect();
      var cx=e.clientX-rect.left,cy=e.clientY-rect.top;
      if(_optDragMode==='twl'){
        // Drag target-WL marker left/right
        var curves=_optActiveCurves();
        if(!curves.length)return;
        var roll=Math.max(1,parseInt(document.getElementById('opt-rolling').value)||1);
        var r=_optGetCurrentRanges(curves,roll);
        var pw=oc.width-OC_PL-OC_PR;
        var rawWL=r.xMin+(cx-OC_PL)/pw*(r.xMax-r.xMin);
        // Snap to data step
        var snapped=Math.round(rawWL/optWLStep)*optWLStep;
        snapped=Math.max(r.xMin,Math.min(r.xMax,snapped));
        optTargetWL=+snapped.toFixed(6);
        var el=document.getElementById('opt-target-wl');
        var el2=document.getElementById('opt-target-wl-2');
        if(el)el.value=optTargetWL;
        if(el2)el2.value=optTargetWL;
        drawOptChart();
        if(dvSubTab===4)renderOptReadout();
      } else if(_optDragMode==='pan'){
        var curves=_optActiveCurves();
        if(!curves.length){_optDragStart=null;return;}
        var roll=Math.max(1,parseInt(document.getElementById('opt-rolling').value)||1);
        var r=_optGetCurrentRanges(curves,roll);
        var pw=oc.width-OC_PL-OC_PR,ph=oc.height-OC_PT-OC_PB;
        var dx=(_optDragStart.x-cx)/pw*(r.xMax-r.xMin);
        var dy=(cy-_optDragStart.y)/ph*(r.yMax-r.yMin);
        optViewXMin=r.xMin+dx;optViewXMax=r.xMax+dx;
        optViewYMin=r.yMin+dy;optViewYMax=r.yMax+dy;
        _optDragStart={x:cx,y:cy};
        drawOptChart();
      } else {
        _optDragEnd={x:cx,y:cy};
        drawOptChart();
      }
    });

    // ── Mouseup: apply zoombox or end drag ──
    window.addEventListener('mouseup',function(e){
      if(!_optDragStart)return;
      if(_optDragMode==='zoombox'&&_optDragEnd){
        var curves=_optActiveCurves();
        var roll=Math.max(1,parseInt(document.getElementById('opt-rolling').value)||1);
        var r=_optGetCurrentRanges(curves,roll);
        var pw=oc.width-OC_PL-OC_PR,ph=oc.height-OC_PT-OC_PB;
        var x1p=Math.min(_optDragStart.x,_optDragEnd.x);
        var x2p=Math.max(_optDragStart.x,_optDragEnd.x);
        var y1p=Math.min(_optDragStart.y,_optDragEnd.y);
        var y2p=Math.max(_optDragStart.y,_optDragEnd.y);
        if(x2p-x1p>8&&y2p-y1p>8){
          optViewXMin=r.xMin+(x1p-OC_PL)/pw*(r.xMax-r.xMin);
          optViewXMax=r.xMin+(x2p-OC_PL)/pw*(r.xMax-r.xMin);
          optViewYMax=r.yMax-(y1p-OC_PT)/ph*(r.yMax-r.yMin);
          optViewYMin=r.yMax-(y2p-OC_PT)/ph*(r.yMax-r.yMin);
        }
        _optDragEnd=null;
      }
      _optDragStart=null;
      _optDragMode=null;
      oc.style.cursor=_optNearTWL?'ew-resize':(_optTool==='zoombox'?'crosshair':'default');
      drawOptChart();
    });
  }
})();

// ═══════════════════════════════════════════════════════════════════
// TAB 3 — DEVICE VIEWER CORE
// ═══════════════════════════════════════════════════════════════════
function fitToActiveDevice(){
  if(activeDeviceId<0)return;
  var d=devices.find(function(dd){return dd.id===activeDeviceId;});
  if(d)zoomToDevice(d);
}

// Fit zoom/pan to the group containing the active device, using the given canvas dimensions.
// Returns true if a valid group fit was applied.
function _fitGroupBounds(c){
  if(activeDeviceId<0||!c||!c.width||!c.height)return false;
  var grp=deviceGroups.find(function(g){
    return g.devices.some(function(dev){return dev.device_id===activeDeviceId;});
  });
  var groupDevs;
  if(grp){
    var ids=new Set(grp.devices.map(function(dev){return dev.device_id;}));
    groupDevs=devices.filter(function(d){return ids.has(d.id);});
  } else {
    var d=devices.find(function(dd){return dd.id===activeDeviceId;});
    groupDevs=d?[d]:[];
  }
  if(!groupDevs.length)return false;
  var x0=groupDevs.reduce(function(m,d){return Math.min(m,d.x0);},Infinity);
  var y0=groupDevs.reduce(function(m,d){return Math.min(m,d.y0);},Infinity);
  var x1=groupDevs.reduce(function(m,d){return Math.max(m,d.x1);},-Infinity);
  var y1=groupDevs.reduce(function(m,d){return Math.max(m,d.y1);},-Infinity);
  var dw=x1-x0,dh=y1-y0;if(!dw||!dh)return false;
  var pad=0.12;
  zoom=Math.min(c.width/(dw*(1+2*pad)),c.height/(dh*(1+2*pad)));
  panX=c.width/2-(x0+x1)/2*zoom;
  panY=c.height/2+(y0+y1)/2*zoom;
  return true;
}

function fitActiveGroup(){
  if(!_fitGroupBounds(canvas3)){fitToActiveDevice();return;}
  updateZoomLabel();redraw3();
}

function updateDeviceViewerHeader(){
  var noDevEl=document.getElementById('dv-noDev');
  if(activeDeviceId<0||!devices.length){
    document.getElementById('dv-title').textContent='No device selected';
    document.getElementById('dv-dims').textContent='';
    if(noDevEl)noDevEl.style.display='flex';
    return;
  }
  var d=devices.find(function(dd){return dd.id===activeDeviceId;});
  if(!d){if(noDevEl)noDevEl.style.display='flex';return;}
  if(noDevEl)noDevEl.style.display='none';
  var labelMap=buildLabelMap();
  var label=labelMap[d.id]||('D'+(d.id+1));
  var dbu=lib?lib.dbunit:1e-9;
  var wUm=((d.x1-d.x0)*dbu*1e6).toFixed(2);
  var hUm=((d.y1-d.y0)*dbu*1e6).toFixed(2);
  document.getElementById('dv-title').textContent=label;
  document.getElementById('dv-dims').textContent=wUm+' × '+hUm+' µm';
  renderSemGrid();
}

function autoMatchOptDevice(){
  if(activeDeviceId<0)return;
  if(!optServerPath&&!optFiles.length)return;
  var labelMap=buildLabelMap();
  var d=devices.find(function(dd){return dd.id===activeDeviceId;});
  if(!d)return;

  // Prefer the most specific label available for this device.
  // Using the group name causes every device in the group to match the same
  // optical key, so only fall back to it when no per-device label is set.
  var specificLabel=labelMap[d.id]||d.label||'';
  var cands=[];
  if(specificLabel){
    cands.push(specificLabel.toLowerCase());
  } else {
    // No label assigned — fall back to group name then device index
    var grp=deviceGroups.find(function(g){
      return g.devices.some(function(dev){return dev.device_id===activeDeviceId;});
    });
    if(grp&&grp.name)cands.push(grp.name.toLowerCase());
    cands.push(('D'+(activeDeviceId+1)).toLowerCase());
  }

  // ── Try to match against the scanned optical-device key list ─────────────
  // A key matches when the candidate label appears as an underscore-bounded
  // token inside the key, or the strings are equal / one prefixes the other.
  var best=null,bestScore=0;
  optDevices.forEach(function(dev){
    var k=dev.key.toLowerCase();
    cands.forEach(function(lbl){
      var s=0;
      if(lbl===k){
        s=1000+k.length;                    // exact match
      } else if(lbl.startsWith(k)){
        s=500+k.length;                     // key is leading prefix of label
      } else if(k.startsWith(lbl)){
        s=400+lbl.length;                   // label is leading prefix of key
      } else if(lbl.indexOf(k)>=0){
        s=200+k.length;                     // key is substring of label
      } else {
        // Token-bounded: "bias7nm_euler10" in "dose280uc_mrrs_bias7nm_euler10" ✓
        //                "bias7nm_euler"   in "dose280uc_mrrs_bias7nm_euler10" ✗
        var padded='_'+k+'_';
        var padLbl='_'+lbl+'_';
        var atStart=(k+'_').startsWith(lbl+'_');
        var atEnd=('_'+k).endsWith('_'+lbl);
        var inMid=padded.indexOf(padLbl)>=0;
        if(atStart||atEnd||inMid) s=150+lbl.length;
      }
      if(s>bestScore){bestScore=s;best=dev.key;}
    });
  });

  if(best){
    // Pass specificLabel as searchLabel so the backend searches for subfolders
    // that CONTAIN the device label (e.g. "bias7nm_euler10"), not exact key.
    if(best!==optCurrentKey||!optCache[best]||!optCache[best].length){
      selectOptDevice(best,specificLabel||undefined);
    }
    return;
  }

  // ── No key match — load directly by device label ──────────────────────────
  // The backend will scan for any subfolder CONTAINING the label and
  // auto-detect the device type (MRRs → mrr, crossers → crosser, etc.)
  if(specificLabel&&optServerPath){
    var directKey='__label__'+specificLabel;
    if(directKey!==optCurrentKey||!optCache[directKey]||!optCache[directKey].length){
      optCurrentKey=directKey;
      document.querySelectorAll('.opt-dev-item').forEach(function(el){el.classList.remove('active');});
      _loadKeyFromServer(directKey,optServerPath,'auto',specificLabel);
    }
    return;
  }

  // No match and no direct-label fallback — blank the chart
  optCurrentKey=null;
  document.querySelectorAll('.opt-dev-item').forEach(function(el){el.classList.remove('active');});
  var pmsg=document.getElementById('opt-ph-msg');
  if(pmsg)pmsg.innerHTML='No optical data for this device.';
  drawOptChart(); // rawCurves=[] → shows placeholder
  renderOptLegend([]);
  var st=document.getElementById('opt-status');
  if(st)st.textContent='No match: '+cands.join(', ');
}

function setDvSubTab(n){
  dvSubTab=n;
  // Always close SEM preview when switching sub-tabs
  var semprev=document.getElementById('dv-sub-semprev');
  if(semprev)semprev.classList.remove('active');
  _semPrevObj=null;
  [1,2,3,4].forEach(function(i){
    var btn=document.getElementById('dv-st'+i);
    var pg=document.getElementById('dv-sub'+i);
    if(btn)btn.classList.toggle('active',i===n);
    if(pg)pg.classList.toggle('active',i===n);
  });
  if(n===1){if(canvas3)resizeCanvas(canvas3);redraw3();fitToActiveDevice();}
  if(n===2)renderSemGrid();
  if(n===3){resizeOptChart();autoMatchOptDevice();drawOptChart();}
  if(n===4)renderOptReadout();
}


function redraw3(){
  if(!canvas3||!ctx3)return;
  cancelAnimationFrame(RAF3);
  RAF3=requestAnimationFrame(function(){
    resizeCanvas(canvas3);
    ctx3.clearRect(0,0,canvas3.width,canvas3.height);
    ctx3.fillStyle='#0a0c10';ctx3.fillRect(0,0,canvas3.width,canvas3.height);
    var noDevEl=document.getElementById('dv-noDev');
    if(activeDeviceId<0||!activeCell){
      if(noDevEl)noDevEl.style.display='flex';
      updateZoomLabel();return;
    }
    if(noDevEl)noDevEl.style.display='none';
    var d=devices.find(function(dd){return dd.id===activeDeviceId;});
    if(!d){updateZoomLabel();return;}
    drawGrid(ctx3,canvas3);
    var colorMap=buildGroupColorMap();
    var col=colorMap[d.id]||d.color;
    var sx=d.x0*zoom+panX, sy=-d.y1*zoom+panY;
    var sw=(d.x1-d.x0)*zoom, sh=(d.y1-d.y0)*zoom;
    drawCached(ctx3,canvas3.width,canvas3.height);
    // Dashed bbox outline + light tint
    ctx3.strokeStyle=col;ctx3.lineWidth=2;ctx3.setLineDash([8,4]);
    ctx3.strokeRect(sx,sy,sw,sh);ctx3.setLineDash([]);
    ctx3.fillStyle=col+'18';ctx3.fillRect(sx,sy,sw,sh);
    // Label in same style as Tab 2 solid boxes
    var labelMap=buildLabelMap();
    var lbl=labelMap[d.id]||('D'+(d.id+1));
    var fs=Math.max(8,Math.min(14,sw/6,sh/2.5));
    if(fs>=8&&sw>30&&sh>14){
      ctx3.font='bold '+fs+'px monospace';
      var tw=ctx3.measureText(lbl).width;
      ctx3.fillStyle='#00000099';ctx3.fillRect(sx+2,sy+2,tw+6,fs+4);
      ctx3.fillStyle='#ffffff';ctx3.fillText(lbl,sx+5,sy+fs+3);
    }
    if(tool3==='ruler')drawRuler(ctx3);
    updateZoomLabel();
  });
}
