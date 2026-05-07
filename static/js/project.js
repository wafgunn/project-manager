/*
 * project.js — Project file save/open (.gdspm format)
 *
 * The .gdspm file is plain JSON.  GDS binary and SEM images are not
 * saved — only paths and device metadata.  Paths are stored relative
 * to the project file so the project folder is portable.
 *
 * Depends on: state.js
 */
// ═══════════════════════════════════════════════════════════════════
// PROJECT SAVE / OPEN  (.gdspm — JSON)
// GDS binary is NOT saved; user must re-upload the .gds file.
// SEM dir-scan images are NOT saved (too large); all other state is.
// ═══════════════════════════════════════════════════════════════════

// ── GDS base64 helpers ───────────────────────────────────────────
function _gdsToBase64(){
  if(!rawBuffer)return null;
  var bytes=new Uint8Array(rawBuffer);
  var chunk=8192,parts=[];
  for(var i=0;i<bytes.length;i+=chunk)
    parts.push(String.fromCharCode.apply(null,bytes.subarray(i,i+chunk)));
  return btoa(parts.join(''));
}

function _restoreGds(b64,filename,activeCellName){
  var bin=atob(b64);
  var bytes=new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  rawBuffer=bytes.buffer;
  lib=parseGDS(rawBuffer);
  renderCacheDirty=true;
  var cellNames=Object.keys(lib.cells);
  var topName=(activeCellName&&lib.cells[activeCellName])?activeCellName
              :(cellNames[cellNames.length-1]||cellNames[0]);
  activeCell=lib.cells[topName]||null;
  rebuildCellList(cellNames,topName);
  rebuildLayerList();
  document.getElementById('drop-overlay').classList.add('hidden');
  document.getElementById('st-file').textContent=filename||'project.gds';
  document.getElementById('st-unit').textContent=(lib.dbunit*1e9).toFixed(3)+' nm/DBU';
  document.getElementById('st-cell').textContent=topName||'—';
  ['find-btn','find-tol-arrow','clear-btn','merge-btn','group-btn',
   't1-export-btn','t2-export-btn','export-footer-btn','export-footer-btn-2']
    .forEach(function(id){var el=document.getElementById(id);if(el)el.disabled=false;});
  resizeCanvas(canvas1);resizeCanvas(canvas2);
  // Re-upload to backend so export still works
  var gdsFile=new File([rawBuffer],filename||'project.gds',{type:'application/octet-stream'});
  uploadToBackend(gdsFile);
}

function saveProject(){
  var state={
    version:'1.0',format:'gdspm',
    savedAt:new Date().toISOString(),
    // GDS binary (base64) + metadata
    gdsData:_gdsToBase64(),
    gdsFilename:(lib&&lib.filename)||null,
    activeCell:activeCell?activeCell.name:null,
    // Devices & groups
    devices:devices,
    deviceGroups:deviceGroups,
    nextGroupId:nextGroupId,
    nextGroupLetter:nextGroupLetter,
    hiddenGroups:Array.from(hiddenGroups),
    collapsedGroups:Array.from(collapsedGroups),
    // View state
    currentTab:currentTab,
    panX:panX,panY:panY,zoom:zoom,
    zoomFactor:zoomFactor,
    tool1:tool1,
    hiddenLayers:Array.from(hiddenLayers),
    // Device viewer
    activeDeviceId:activeDeviceId,
    dvSubTab:dvSubTab,
    // SEM settings (no image data — auto-reloaded from path)
    // Paths stored relative to the .gdspm directory for portability
    semServerPath:_toRelPath(semServerPath),
    _semRotAngle:_semRotAngle,
    _semNmPerPx:_semNmPerPx,
    _semGridOn:_semGridOn,
    _semGridRows:_semGridRows,
    _semGridCols:_semGridCols,
    _semGridWidth:_semGridWidth,
    _semGridColor:_semGridColor,
    // Optical settings (no curve data — auto-reloaded from path)
    optServerPath:_toRelPath(optServerPath),
    optTargetWL:optTargetWL,
    hiddenCurves:Array.from(hiddenCurves),
    optSubtract:optSubtract,
    chipLossActive:chipLossActive,
    chipLossDbCm:chipLossDbCm,
    // Grating finder settings + found gratings
    gratingSettings:{
      layer:          parseInt((document.getElementById('grd-layer')||{}).value||2),
      datatype:       parseInt((document.getElementById('grd-dt')||{}).value||6),
      tolerance:      parseFloat((document.getElementById('grd-tolerance')||{}).value||1.0),
      fibrePitchEnabled: (document.getElementById('grd-fibre-pitch-en')||{}).checked!==false,
      fibrePitch:     parseFloat((document.getElementById('grd-fibre-pitch')||{}).value||127.0),
    },
    gratings:gratings,
    // Waveguide length measurements
    wgLengths:wgLengths,
    wgSettings:{
      widthUm: parseFloat((document.getElementById('wg-width-um')||{}).value||0.5),
    },
  };
  if(!projectPath){
    alert('Enter the project file path (.gdspm) in the top bar first.');return;
  }
  var body;
  try{body=JSON.stringify({path:projectPath,state:state});}
  catch(e){alert('Save failed (serialisation error): '+e);return;}
  fetch('/api/project/save',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:body
  }).then(function(r){
    if(!r.ok){
      return r.text().then(function(t){
        throw new Error('HTTP '+r.status+' — '+(t.substring(0,300)||'(empty response)'));
      });
    }
    return r.json();
  }).then(function(d){
    if(d.error){alert('Save error: '+d.error);return;}
    var btn=document.querySelector('button[onclick="saveProject()"]');
    if(btn){var t=btn.textContent;btn.textContent='✓ Saved';setTimeout(function(){btn.textContent=t;},2000);}
  }).catch(function(e){alert('Save failed: '+e);});
}

// Return path relative to the project directory (or absolute if outside it)
function _toRelPath(absPath){
  if(!absPath||!projectPath)return absPath||'';
  var projDir=projectPath.replace(/[^\\/]+$/,'').replace(/[\\/]$/,'');
  if(absPath.startsWith(projDir+'/'))return absPath.slice(projDir.length+1);
  if(absPath.startsWith(projDir+'\\'))return absPath.slice(projDir.length+1);
  return absPath;
}

function openProject(){
  if(projectPath){
    // Load from server using path already in the input
    fetch('/api/project/open',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({path:projectPath})
    }).then(function(r){return r.json();})
    .then(function(d){
      if(d.error){alert('Open error: '+d.error);return;}
      _applyProject(d);
    }).catch(function(e){alert('Open failed: '+e);});
  } else {
    // Fallback: browser file picker
    document.getElementById('project-file-input').click();
  }
}

function _applyProject(s){
  if(!s||s.format!=='gdspm'){alert('Not a valid .gdspm project file.');return;}
  // GDS — restore binary and re-parse
  if(s.gdsData)_restoreGds(s.gdsData,s.gdsFilename,s.activeCell);
  // Devices & groups (restore after GDS so panel renders correctly)
  devices=s.devices||[];
  deviceGroups=s.deviceGroups||[];
  nextGroupId=s.nextGroupId||0;
  nextGroupLetter=s.nextGroupLetter||0;
  hiddenGroups=new Set(s.hiddenGroups||[]);
  collapsedGroups=new Set(s.collapsedGroups||[]);
  // View
  panX=s.panX||0;panY=s.panY||0;zoom=s.zoom||1;
  if(s.zoomFactor)zoomFactor=s.zoomFactor;
  tool1=s.tool1||'pan';
  hiddenLayers=new Set(s.hiddenLayers||[]);
  // Device viewer
  activeDeviceId=(s.activeDeviceId!==undefined)?s.activeDeviceId:-1;
  dvSubTab=s.dvSubTab||1;
  // SEM settings
  _semRotAngle=s._semRotAngle||0;
  _semNmPerPx=s._semNmPerPx||1.0;
  _semGridOn=!!s._semGridOn;
  _semGridRows=s._semGridRows||10;
  _semGridCols=s._semGridCols||10;
  _semGridWidth=s._semGridWidth||1;
  _semGridColor=s._semGridColor||'#00ffff';
  // Optical settings
  optTargetWL=s.optTargetWL||1550;
  hiddenCurves=new Set(s.hiddenCurves||[]);
  optSubtract=!!s.optSubtract;
  chipLossActive=!!s.chipLossActive;
  if(s.chipLossDbCm!==undefined)chipLossDbCm=s.chipLossDbCm;
  var clBtn=document.getElementById('btn-chip-loss');
  if(clBtn)clBtn.classList.toggle('active',chipLossActive);
  var clInp=document.getElementById('chip-loss-input');
  if(clInp)clInp.value=chipLossDbCm;
  // Navigate to saved tab then re-render
  goTab(s.currentTab||1);
  updateDevicesPanel();
  redrawActive();
  updateDeviceViewerHeader();
  // Sync input widgets
  var el;
  el=document.getElementById('opt-target-wl'); if(el)el.value=optTargetWL;
  el=document.getElementById('btn-subtract');  if(el)el.classList.toggle('active',optSubtract);
  el=document.getElementById('sem-grid-btn');
  if(el){el.style.background=_semGridOn?'#0d419d':'';el.style.borderColor=_semGridOn?'#1f6feb':'';}
  el=document.getElementById('sg-rows');  if(el)el.value=_semGridRows;
  el=document.getElementById('sg-cols');  if(el)el.value=_semGridCols;
  el=document.getElementById('sg-width'); if(el)el.value=_semGridWidth;
  el=document.getElementById('sg-color'); if(el)el.value=_semGridColor;
  // Restore project path (server resolved the relative paths before sending)
  if(s._projectDir&&projectPath){
    // projectPath already set from the input field; keep it
  }
  // Auto-reload SEM images (path already resolved to absolute by server)
  if(s.semServerPath){
    el=document.getElementById('sem-server-path');if(el)el.value=s.semServerPath;
    _scanSemFromServer(s.semServerPath);
  }
  // Auto-reload optical data (path already resolved to absolute by server)
  if(s.optServerPath){
    optServerPath=s.optServerPath;
    el=document.getElementById('opt-path');if(el)el.value=optServerPath;
    optFiles=[];optFileMap={};optDevices=[];optCurrentKey=null;optCache={};
    _scanOptFromServer(optServerPath);
  }
  // Grating finder settings + previously found gratings
  gratings=s.gratings||[];
  if(s.gratingSettings){
    var gs=s.gratingSettings;
    el=document.getElementById('grd-layer');          if(el)el.value=gs.layer!==undefined?gs.layer:2;
    el=document.getElementById('grd-dt');             if(el)el.value=gs.datatype!==undefined?gs.datatype:6;
    el=document.getElementById('grd-tolerance');      if(el)el.value=gs.tolerance!==undefined?gs.tolerance:1.0;
    el=document.getElementById('grd-fibre-pitch-en'); if(el)el.checked=gs.fibrePitchEnabled!==undefined?gs.fibrePitchEnabled:true;
    el=document.getElementById('grd-fibre-pitch');    if(el)el.value=gs.fibrePitch!==undefined?gs.fibrePitch:127.0;
    if(typeof _gratingFibrePitchToggle==='function')_gratingFibrePitchToggle();
  }
  // Waveguide length measurements + settings
  wgLengths=s.wgLengths||[];
  if(s.wgSettings){
    var ws=s.wgSettings;
    el=document.getElementById('wg-width-um');
    if(el)el.value=ws.widthUm!==undefined?ws.widthUm:(ws.widthNm!==undefined?ws.widthNm/1000:0.5);
  }
  // Refresh measurements panel after project load
  if(typeof _wgRenderMeasurementsPanel==='function')_wgRenderMeasurementsPanel();
}

// Wire up file input on page load (called from init block at bottom)
function _initProjectHandlers(){
  var inp=document.getElementById('project-file-input');
  if(!inp)return;
  inp.addEventListener('change',function(e){
    var f=e.target.files[0];if(!f)return;
    // Hint user to set the project path for server-side features
    var pathEl=document.getElementById('proj-path-input');
    if(pathEl&&!pathEl.value)pathEl.placeholder='Set path above to enable server save';
    var reader=new FileReader();
    reader.onload=function(ev){
      try{_applyProject(JSON.parse(ev.target.result));}
      catch(err){alert('Could not read project file:\n'+err.message);}
    };
    reader.readAsText(f);
    this.value='';
  });
}
