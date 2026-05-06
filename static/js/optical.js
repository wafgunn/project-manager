/*
 * optical.js — Optical data (sub-tabs 3 & 4 of Tab 3)
 *
 * Owns:
 *   • Client-side LossData*.csv parsing (SANTEC TSL format)
 *   • Optical chart drawing (canvas-based)
 *   • Box-zoom, rolling average, background subtraction
 *   • Device list sidebar
 *   • Readout table (sub-tab 4)
 *   • Global reference curve averaging
 *
 * Plugin integration: add new curve type defs (CURVE_DEFS style) in this
 * file and a matching detect-keyword in _scanOptFromFiles / _keyTypes.
 *
 * Depends on: state.js, navigation.js
 */
// ═══════════════════════════════════════════════════════════════════
// OPTICAL DATA
// ═══════════════════════════════════════════════════════════════════
// Curve style definitions — mirrors the Python script's CURVE_DEFS
var OPT_CURVE_DEFS=[
  {label:'T (2→4)',    mtype:'in2out4_234',ch:'CH3',color:'#ffa657',dash:[],   lw:1.5},
  {label:'T (3→5)',    mtype:'in3out5_234',ch:'CH4',color:'#3fb950',dash:[],   lw:1.5},
  {label:'CT(2→4)CH2',mtype:'in2out4_234',ch:'CH2',color:'#58a6ff',dash:[6,3],lw:0.9},
  {label:'CT(2→4)CH4',mtype:'in2out4_234',ch:'CH4',color:'#ff7b72',dash:[6,3],lw:0.9},
  {label:'CT(3→5)CH2',mtype:'in3out5_234',ch:'CH2',color:'#79c0ff',dash:[3,3],lw:0.9},
  {label:'CT(3→5)CH3',mtype:'in3out5_234',ch:'CH3',color:'#e3b341',dash:[3,3],lw:0.9},
  {label:'Ref (1→6)', mtype:'in1out6_2',  ch:'CH2',color:'#c9d1d9',dash:[],   lw:1.0},
];
// MRR curve style definitions — mirrors mrr_algorithms.py CURVE_DEFS
var MRR_CURVE_DEFS=[
  {label:'MRR T',   mtype:'in2out3_23',ch:'CH3',color:'#3fb950',dash:[],lw:1.5},
  {label:'MRR Ref', mtype:'in1out4_23',ch:'CH2',color:'#c9d1d9',dash:[],lw:1.0},
];
// intc1to10 channel→port map — mirrors intc1to10_algorithms.py MTYPE_CHANNELS
// Keyed by mtype string detected from the folder path.
// 10 clearly distinct hues — no two ports share a similar colour family.
var INTC1TO10_MTYPE_MAP={
  'in7out123_234': [
    {ch:'CH2',label:'o7', color:'#2dd4bf',dash:[],lw:1.2},  // teal
    {ch:'CH3',label:'o8', color:'#e3b341',dash:[],lw:1.2},  // amber
    {ch:'CH4',label:'o9', color:'#f778ba',dash:[],lw:1.2},  // pink
  ],
  'in7out453_234': [
    {ch:'CH2',label:'o10',color:'#818cf8',dash:[],lw:1.2},  // indigo
    {ch:'CH3',label:'o11',color:'#fb923c',dash:[],lw:1.2},  // apricot
    {ch:'CH4',label:'o9', color:'#f778ba',dash:[],lw:1.2},  // pink (averaged with in7out123)
  ],
  'in7out91011_234': [
    {ch:'CH2',label:'o2', color:'#388bfd',dash:[],lw:1.2},  // blue
    {ch:'CH3',label:'o3', color:'#3fb950',dash:[],lw:1.2},  // green
    {ch:'CH4',label:'o4', color:'#ffa657',dash:[],lw:1.2},  // orange
  ],
  'in7out121311_234': [
    {ch:'CH2',label:'o5', color:'#ff7b72',dash:[],lw:1.2},  // red
    {ch:'CH3',label:'o6', color:'#d2a8ff',dash:[],lw:1.2},  // lavender
    {ch:'CH4',label:'o4', color:'#ffa657',dash:[],lw:1.2},  // orange (averaged with in7out91011)
  ],
  'in8out6_2': [
    {ch:'CH2',label:'Ref',color:'#8b949e',dash:[],lw:1.0},  // neutral grey
  ],
};
// Display order for intc1to10 ports (Ref first, then ascending port number)
var INTC1TO10_PORT_ORDER=['Ref','o2','o3','o4','o5','o6','o7','o8','o9','o10','o11'];

// loopback channel→curve map — mirrors loopback_algorithms.py CURVE_DEFS
var LOOPBACK_MTYPE_MAP={
  'in1out2_2':[
    {ch:'CH2',label:'T (1→2)',color:'#58a6ff',dash:[],lw:1.5},
  ],
};

// ── Scan: build device list from browser files or server path ─────
function scanOptDirectory(){
  var path=(document.getElementById('opt-path').value||'').trim();
  if(path){
    optFiles=[];optFileMap={};optServerPath=path;
    optDevices=[];optCurrentKey=null;optCache={};
    _scanOptFromServer(path);
  } else {
    if(!optFiles.length){
      showModal('No Source','Pick a directory using "Pick Dir" or enter a server directory path.');return;
    }
    optCurrentKey=null;optCache={};
    _scanOptFromFiles();
  }
}

function _scanOptFromFiles(){
  optFileMap={};optCurrentKey=null;optCache={};
  var lossFiles=optFiles.filter(function(f){return /LossData.*\.csv$/i.test(f.name);});
  var keyTypes={};
  lossFiles.forEach(function(f){
    var parts=f.webkitRelativePath.split('/');
    var dir=parts.length>=2?parts[parts.length-2]:'';
    if(!dir)return;
    var key=dir.replace(/_(in\d+out\d+_?\d*)$/i,'');
    if(!optFileMap[key])optFileMap[key]=[];
    optFileMap[key].push(f);
    if(!keyTypes[key]){
      var dl=dir.toLowerCase();
      keyTypes[key]=dl.indexOf('mrr')>=0?'mrr':dl.indexOf('intc1to10')>=0?'intc1to10':dl.indexOf('loopbacks')>=0?'loopback':'crosser';
    }
  });
  optDevices=Object.keys(optFileMap).sort().map(function(k){return{key:k,label:k,type:keyTypes[k]||'crosser'};});
  renderOptDeviceList();
  var n=optDevices.length;
  document.getElementById('opt-status').textContent=n+' device'+(n===1?'':'s')+' found';
  redraw2();
}

function _scanOptFromServer(path){
  document.getElementById('opt-status').textContent='Scanning…';
  fetch('/api/optical-scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:path})})
  .then(function(r){return r.json();})
  .then(function(data){
    if(data.error){showModal('Scan Error',data.error,'',true);return;}
    // Use full devices list (key + type) when available; fall back to legacy keys
    if(data.devices&&data.devices.length){
      optDevices=data.devices.map(function(d){return{key:d.key,label:d.key,type:d.type||'crosser'};});
    } else {
      optDevices=(data.keys||[]).map(function(k){return{key:k,label:k,type:'crosser'};});
    }
    renderOptDeviceList();
    var n=optDevices.length;
    document.getElementById('opt-status').textContent=n+' device'+(n===1?'':'s')+' found';
    redraw2();
  })
  .catch(function(e){showModal('Server Error',''+e,'',true);});
}

function renderOptDeviceList(){
  var el=document.getElementById('opt-dev-items');if(!el)return;
  el.innerHTML='';
  if(!optDevices.length){
    el.innerHTML='<div style="padding:12px;font-size:10px;color:#484f58;text-align:center;">No devices found.</div>';return;
  }
  optDevices.forEach(function(dev){
    var item=document.createElement('div');
    item.className='opt-dev-item'+(dev.key===optCurrentKey?' active':'');
    item.title=dev.key;
    // Type badge
    var badge=document.createElement('span');
    badge.textContent=dev.type==='mrr'?'MRR':'CX';
    badge.style.cssText='font-size:9px;font-family:monospace;padding:1px 4px;border-radius:3px;margin-right:5px;flex-shrink:0;'
      +(dev.type==='mrr'?'background:#1a3a2a;color:#3fb950;border:1px solid #3fb950;'
                        :'background:#1a2a3a;color:#58a6ff;border:1px solid #58a6ff;');
    item.appendChild(badge);
    item.appendChild(document.createTextNode(dev.key));
    item.addEventListener('click',function(){selectOptDevice(dev.key);});
    el.appendChild(item);
  });
}

function selectOptDevice(key,searchLabel){
  // key:         optical device key (used for cache + chart title)
  // searchLabel: optional substring to send to backend (defaults to key).
  //              Pass the GDS device label here so the backend finds subfolders
  //              that CONTAIN that label, rather than needing an exact key match.
  optCurrentKey=key;
  document.querySelectorAll('.opt-dev-item').forEach(function(el){
    el.classList.toggle('active',el.title===key);
  });
  if(optCache[key]!==undefined&&optCache[key].length>0){
    // Use non-empty cache hit
    document.getElementById('opt-ph').style.display='none';
    resizeOptChart();drawOptChart();
    if(dvSubTab===4)renderOptReadout();
    return;
  }
  // Cache miss (or previously empty) — always re-fetch so stale empty entries don't stick
  var devObj=optDevices.find(function(d){return d.key===key;})||{};
  if(optFiles.length){
    _loadKeyFromFiles(key,optFileMap[key]||[]);
  } else if(optServerPath){
    // Use 'auto' so the backend detects type from the subfolder name.
    // Pass searchLabel (GDS device label) as the substring search term.
    _loadKeyFromServer(key,optServerPath,'auto',searchLabel);
  }
}

// Update the wavelength step from the first curve that has ≥2 wavelength points.
function _updateOptWLStep(curves){
  for(var i=0;i<curves.length;i++){
    var wl=curves[i].wl;
    if(wl&&wl.length>=2){
      var step=Math.abs(wl[1]-wl[0]);
      if(step>0){
        optWLStep=step;
        // round to at most 6 decimal places to avoid floating-point noise
        var decimals=Math.max(0,-Math.floor(Math.log10(step))+1);
        var stepStr=step.toFixed(Math.min(decimals,6));
        ['opt-target-wl','opt-target-wl-2'].forEach(function(id){
          var el=document.getElementById(id);if(el)el.step=stepStr;
        });
      }
      break;
    }
  }
}

function _loadKeyFromFiles(key,files){
  if(!files.length){
    optCache[key]=[];delete _subCache[key];
    var pmsg=document.getElementById('opt-ph-msg');
    if(pmsg)pmsg.innerHTML='No optical data for this device.';
    document.getElementById('opt-status').textContent='No data for '+key;
    drawOptChart();renderOptLegend([]);
    return;
  }
  document.getElementById('opt-status').textContent='Loading '+key+'…';
  var curves=[];var pending=files.length;
  files.forEach(function(file){
    var rdr=new FileReader();
    rdr.onload=function(e){
      var res=parseOptCSV(e.target.result,file.webkitRelativePath);
      if(res)curves=curves.concat(res);
      if(--pending===0){
        curves=_mergeOptCurves(curves);
        optCache[key]=curves;delete _subCache[key];
        _updateOptWLStep(curves);
        document.getElementById('opt-status').textContent=key+': '+curves.length+' curves';
        document.getElementById('opt-ph').style.display='none';
        resizeOptChart();drawOptChart();
        if(dvSubTab===4)renderOptReadout();
      }
    };
    rdr.readAsText(file);
  });
}

function _loadKeyFromServer(key,path,dataType,searchLabel){
  // searchLabel: the substring to search for in subfolder names (defaults to key).
  // key:         used as the cache key and chart title.
  // dataType:    'mrr', 'crosser', or 'auto' — 'auto' lets the backend detect
  //              from the subfolder name (default; safe for all device types).
  if(!dataType)dataType='auto';
  var lbl=searchLabel||key;
  document.getElementById('opt-status').textContent='Loading '+key+'…';
  fetch('/api/optical-data',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({path:path,label:lbl,data_type:dataType})})
  .then(function(r){return r.json();})
  .then(function(data){
    if(data.error){showModal('Error',data.error,'',true);return;}
    optCache[key]=data.curves||[];delete _subCache[key];
    _updateOptWLStep(optCache[key]);
    var n=(data.curves||[]).length;
    document.getElementById('opt-status').textContent=key+': '+n+' curve'+(n===1?'':'s');
    if(n===0){var pmsg=document.getElementById('opt-ph-msg');if(pmsg)pmsg.innerHTML='No optical data for this device.';}
    document.getElementById('opt-ph').style.display='none';
    resizeOptChart();drawOptChart();
    if(dvSubTab===4)renderOptReadout();
  })
  .catch(function(e){showModal('Server Error',''+e,'',true);});
}

function onRollingChange(){drawOptChart();if(dvSubTab===4)renderOptReadout();}

function onTargetWLChange(){
  var el=document.getElementById('opt-target-wl');
  var el2=document.getElementById('opt-target-wl-2');
  var val=parseFloat((el||{}).value)||1550.0;
  optTargetWL=val;
  if(el2&&el2!==document.activeElement)el2.value=val;
  if(dvSubTab===3)drawOptChart();
  if(dvSubTab===4)renderOptReadout();
}

function onTargetWLChange2(){
  var el2=document.getElementById('opt-target-wl-2');
  var el=document.getElementById('opt-target-wl');
  var val=parseFloat((el2||{}).value)||1550.0;
  optTargetWL=val;
  if(el&&el!==document.activeElement)el.value=val;
  renderOptReadout();
  // update chart marker silently even if not on spectra tab
  if(dvSubTab===3)drawOptChart();
}

function _setOptTool(tool){
  _optTool=tool;
  var pb=document.getElementById('opt-pan-btn');
  var bb=document.getElementById('opt-box-btn');
  if(pb)pb.classList.toggle('active',tool==='pan');
  if(bb)bb.classList.toggle('active',tool==='zoombox');
  var oc=document.getElementById('opt-chart');
  if(oc)oc.style.cursor=tool==='zoombox'?'crosshair':'default';
}

function _optFit(){
  optViewXMin=null;optViewXMax=null;optViewYMin=null;optViewYMax=null;
  drawOptChart();
}

function _optZoomBtn(isIn){
  var curves=_optActiveCurves();
  if(!curves.length)return;
  var roll=Math.max(1,parseInt(document.getElementById('opt-rolling').value)||1);
  var r=_optGetCurrentRanges(curves,roll);
  var cx=(r.xMin+r.xMax)/2,cy=(r.yMin+r.yMax)/2;
  var factor=isIn?(1/1.0625):1.0625;
  optViewXMin=cx+(r.xMin-cx)*factor;optViewXMax=cx+(r.xMax-cx)*factor;
  optViewYMin=cy+(r.yMin-cy)*factor;optViewYMax=cy+(r.yMax-cy)*factor;
  drawOptChart();
}

function toggleOptSubtract(){
  optSubtract=!optSubtract;
  var btn=document.getElementById('btn-subtract');
  if(btn)btn.classList.toggle('active',optSubtract);
  // reset zoom when toggling so auto-range recalculates for new data range
  optViewXMin=null;optViewXMax=null;optViewYMin=null;optViewYMax=null;
  drawOptChart();
  if(dvSubTab===4)renderOptReadout();
}

// Returns curves with ref curve subtracted from every other curve's IL.
// The ref curve itself is returned as a flat 0 dB line.
// Works for both crossers (Ref (1→6)) and MRRs (MRR Ref).
function _applySubtraction(rawCurves){
  var refCurve=rawCurves.find(function(c){return /\bRef\b/i.test(c.label);});
  if(!refCurve)return rawCurves;
  var refLabel=refCurve.label;
  return rawCurves.map(function(c){
    if(c.label===refLabel){
      return Object.assign({},c,{il:c.wl.map(function(){return 0;})});
    }
    var newIL=c.il.map(function(v,i){
      var rv=_optInterpolateAt(refCurve.wl,refCurve.il,c.wl[i]);
      return isFinite(rv)?v-rv:v;
    });
    return Object.assign({},c,{il:newIL});
  });
}

// Return subtracted curves for the current key, computing once and caching.
function _getSubCurves(key,rawCurves){
  if(!_subCache[key])_subCache[key]=_applySubtraction(rawCurves);
  return _subCache[key];
}

function _resetOptView(){
  optViewXMin=null;optViewXMax=null;optViewYMin=null;optViewYMax=null;
  hiddenCurves=new Set();
  drawOptChart();
}

function _optInterpolateAt(wls,ils,twl){
  // Binary search — O(log n) instead of O(n)
  var lo=0,hi=wls.length-1;
  if(twl<wls[lo]||twl>wls[hi])return NaN;
  while(lo<hi-1){var mid=(lo+hi)>>1;if(wls[mid]<=twl)lo=mid;else hi=mid;}
  var t=(twl-wls[lo])/(wls[hi]-wls[lo]);
  return ils[lo]+t*(ils[hi]-ils[lo]);
}

// Average the Ref-curve IL at *twl* across every cached device of *type*.
// Returns {val, n} — val is NaN when no ref data is available.
// Loopbacks have no reference, so always return NaN for that type.
function _globalRefIL(twl, roll, type){
  if(!type||type==='loopback')return{val:NaN,n:0};
  var vals=[];
  optDevices.forEach(function(dev){
    if(dev.type!==type)return;
    var curves=optCache[dev.key];
    if(!curves||!curves.length)return;
    var rc=curves.find(function(c){return /\bRef\b/i.test(c.label);});
    if(!rc)return;
    var v=_optInterpolateAt(rc.wl,rollingAvg(rc.il,roll),twl);
    if(isFinite(v))vals.push(v);
  });
  if(!vals.length)return{val:NaN,n:0};
  return{val:vals.reduce(function(s,v){return s+v;},0)/vals.length,n:vals.length};
}

function renderOptReadout(){
  var emptyEl=document.getElementById('opt-rd-empty');
  var tableEl=document.getElementById('opt-rd-table');
  var rowsEl=document.getElementById('opt-rd-rows');
  var wlLbl=document.getElementById('opt-rd-wl-lbl');
  if(!emptyEl||!tableEl||!rowsEl)return;
  var rawCurves=(optCurrentKey&&optCache[optCurrentKey])||[];
  var twl=optTargetWL;
  // sync both λ inputs to current optTargetWL
  var el1=document.getElementById('opt-target-wl');
  var el2=document.getElementById('opt-target-wl-2');
  if(el1&&el1!==document.activeElement)el1.value=twl;
  if(el2&&el2!==document.activeElement)el2.value=twl;
  if(wlLbl)wlLbl.textContent=twl.toFixed(1)+' nm';
  var _refLblEl=document.getElementById('opt-rd-ref-lbl');
  if(!rawCurves.length){
    if(_refLblEl){_refLblEl.textContent='—';_refLblEl.style.color='#484f58';}
    emptyEl.style.display='';tableEl.style.display='none';return;
  }
  emptyEl.style.display='none';tableEl.style.display='';
  var roll=Math.max(1,parseInt(document.getElementById('opt-rolling').value)||1);
  // Build subtracted curves for the right column (cached)
  var subCurves=_getSubCurves(optCurrentKey,rawCurves);
  var subMap={};subCurves.forEach(function(c){subMap[c.label]=c;});
  // Find ref curve for raw IL at target WL (works for both crossers and MRRs)
  var refCurve=rawCurves.find(function(c){return /\bRef\b/i.test(c.label);});
  var refRL=refCurve?rollingAvg(refCurve.il,roll):null;
  var refIL=refRL?_optInterpolateAt(refCurve.wl,refRL,twl):NaN;
  var refLabel=refCurve?refCurve.label:null;
  // ── Toolbar: global-average Ref IL across all cached devices of this type ──
  var _curDev=optDevices.find(function(d){return d.key===optCurrentKey;});
  var _curType=_curDev?_curDev.type:null;
  var _gRef=_globalRefIL(twl,roll,_curType);
  if(_refLblEl){
    if(isFinite(_gRef.val)){
      _refLblEl.textContent=_gRef.val.toFixed(2)+' dB';
      _refLblEl.style.color='#c9d1d9';
      _refLblEl.title='Global avg Ref at '+twl.toFixed(1)+' nm'
        +' (n='+_gRef.n+' '+_curType+' device'+(_gRef.n===1?'':'s')+' cached)';
    } else if(_curType==='loopback'){
      _refLblEl.textContent='n/a';
      _refLblEl.style.color='#484f58';
      _refLblEl.title='Loopback devices have no reference curve';
    } else {
      _refLblEl.textContent='—';
      _refLblEl.style.color='#484f58';
      _refLblEl.title=_curType?'No ref curves cached yet for '+_curType:'Reference curve IL at target wavelength';
    }
  }
  var seen={},html='';
  rawCurves.forEach(function(curve){
    if(seen[curve.label])return;seen[curve.label]=true;
    var hidden=hiddenCurves.has(curve.label);
    var col=hidden?'#484f58':curve.color;
    var dashAttr=(curve.dash&&curve.dash.length)?'stroke-dasharray="'+curve.dash.join(',')+'"':'';
    var swatch='<svg width="24" height="8" style="flex-shrink:0"><line x1="0" y1="4" x2="24" y2="4"'
      +' stroke="'+col+'" stroke-width="'+(curve.lw||1)+'" '+dashAttr+'/></svg>';
    // Raw IL
    var rl=rollingAvg(curve.il,roll);
    var rawIL=_optInterpolateAt(curve.wl,rl,twl);
    var rawStr=isFinite(rawIL)?rawIL.toFixed(2)+' dB':'—';
    // Subtracted IL (ref curve shows 0.00 dB reference)
    var isRef=(curve.label===refLabel);
    var subStr;
    if(isRef){
      subStr='0.00 dB';
    } else if(isFinite(rawIL)&&isFinite(refIL)){
      subStr=(rawIL-refIL).toFixed(2)+' dB';
    } else {
      subStr='—';
    }
    var subColor=isRef?'#484f58':'#58a6ff';
    html+='<div style="display:flex;align-items:center;gap:7px;'
        +'padding:4px 0;border-bottom:1px solid #21262d20;opacity:'+(hidden?'0.35':'1')+'">'
        +swatch
        +'<span style="font-size:10px;color:#c9d1d9;font-family:monospace;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+curve.label+'</span>'
        +'<span style="font-size:11px;font-weight:bold;color:'+col+';font-family:monospace;background:#21262d;padding:1px 6px;border-radius:3px;flex-shrink:0;">'+rawStr+'</span>'
        +'<span style="font-size:11px;font-weight:bold;color:'+subColor+';font-family:monospace;background:#0d2137;padding:1px 6px;border-radius:3px;flex-shrink:0;">'+subStr+'</span>'
        +'</div>';
  });
  rowsEl.innerHTML=html;
}

// ── Plot: pre-load every device into its own cache slot, then show current ─
function plotAllOptDevices(){
  var path=(document.getElementById('opt-path').value||'').trim();
  // Server path — scan first if needed, then cache all
  if(path&&(!optServerPath||optServerPath!==path||!optDevices.length)){
    optFiles=[];optFileMap={};optServerPath=path;
    optDevices=[];optCurrentKey=null;optCache={};
    document.getElementById('opt-status').textContent='Scanning…';
    fetch('/api/optical-scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:path})})
    .then(function(r){return r.json();})
    .then(function(data){
      if(data.error){showModal('Scan Error',data.error,'',true);return;}
      if(data.devices&&data.devices.length){
        optDevices=data.devices.map(function(d){return{key:d.key,label:d.key,type:d.type||'crosser'};});
      } else {
        optDevices=(data.keys||[]).map(function(k){return{key:k,label:k,type:'crosser'};});
      }
      _cacheAllKeys();
    })
    .catch(function(e){showModal('Server Error',''+e,'',true);});
    return;
  }
  // Browser files — scan if not yet done
  if(optFiles.length&&!optDevices.length){optCurrentKey=null;optCache={};_scanOptFromFiles();}
  if(!optDevices.length){showModal('No Data','Pick a directory first.');return;}
  _cacheAllKeys();
}

function _cacheAllKeys(){
  // Pre-populate optCache[key] for every found device key.
  // When all are loaded, autoMatchOptDevice() draws the current device's chart.
  if(!optDevices.length)return;
  var total=optDevices.length;
  var done=0;
  var statusEl=document.getElementById('opt-status');
  statusEl.textContent='Loading 0 / '+total+'…';

  function onKeyDone(){
    done++;
    statusEl.textContent='Loading '+done+' / '+total+(done<total?'…':' — done');
    if(done>=total){
      // All cached — show current device
      autoMatchOptDevice();
      if(!optCurrentKey)statusEl.textContent=total+' devices cached — select a device';
    }
  }

  optDevices.forEach(function(dev){
    var key=dev.key;
    // Already in cache — count it immediately
    if(optCache[key]!==undefined){onKeyDone();return;}
    if(optFiles.length){
      var files=optFileMap[key]||[];
      if(!files.length){optCache[key]=[];delete _subCache[key];onKeyDone();return;}
      var fp=files.length,kc=[];
      files.forEach(function(file){
        var rdr=new FileReader();
        rdr.onload=function(e){
          var res=parseOptCSV(e.target.result,file.webkitRelativePath);
          if(res)kc=kc.concat(res);
          if(--fp===0){kc=_mergeOptCurves(kc);optCache[key]=kc;delete _subCache[key];onKeyDone();}
        };
        rdr.readAsText(file);
      });
    } else if(optServerPath){
      fetch('/api/optical-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:optServerPath,label:key,data_type:'auto'})})
      .then(function(r){return r.json();})
      .then(function(data){optCache[key]=data.curves||[];delete _subCache[key];onKeyDone();})
      .catch(function(){optCache[key]=[];delete _subCache[key];onKeyDone();});
    } else {optCache[key]=[];delete _subCache[key];onKeyDone();}
  });
}

function parseOptCSV(text,filePath){
  var lines=text.split(/\r?\n/);
  var ds=-1;
  for(var i=0;i<lines.length;i++){if(lines[i].indexOf('--DATA START--')>=0){ds=i;break;}}
  if(ds<0)return null;
  var hi=ds+1;while(hi<lines.length&&lines[hi].trim()==='')hi++;
  if(hi>=lines.length)return null;
  var hdr=lines[hi].trim().split(/[\t,;]+/);
  var wlI=-1,ch2I=-1,ch3I=-1,ch4I=-1;
  hdr.forEach(function(h,idx){
    var hh=h.replace(/﻿/g,'').trim();
    if(/wavelength/i.test(hh))wlI=idx;
    else if(/CH4/i.test(hh))ch4I=idx;
    else if(/CH3/i.test(hh))ch3I=idx;
    else if(/CH2/i.test(hh))ch2I=idx;
  });
  if(wlI<0)return null;
  var wl=[],ch2=[],ch3=[],ch4=[];
  for(var j=hi+1;j<lines.length;j++){
    var row=lines[j].trim();if(!row)continue;
    var cols=row.split(/[\t,;]+/);
    var w=parseFloat(cols[wlI]);if(isNaN(w))continue;
    wl.push(w);
    if(ch2I>=0)ch2.push(parseFloat(cols[ch2I])||0);
    if(ch3I>=0)ch3.push(parseFloat(cols[ch3I])||0);
    if(ch4I>=0)ch4.push(parseFloat(cols[ch4I])||0);
  }
  if(!wl.length)return null;
  var p=filePath.toLowerCase();
  var results=[];

  // ── intc1to10: look up per-mtype channel→port table ─────────────
  if(p.indexOf('intc1to10')>=0){
    var imtype='unknown';
    if(p.indexOf('in8out6')>=0)          imtype='in8out6_2';
    else if(p.indexOf('in7out121311')>=0) imtype='in7out121311_234';  // check longer first
    else if(p.indexOf('in7out91011')>=0)  imtype='in7out91011_234';
    else if(p.indexOf('in7out453')>=0)    imtype='in7out453_234';
    else if(p.indexOf('in7out123')>=0)    imtype='in7out123_234';
    var imappings=INTC1TO10_MTYPE_MAP[imtype]||[];
    imappings.forEach(function(def){
      var arr=def.ch==='CH2'?ch2:def.ch==='CH3'?ch3:ch4;
      if(!arr.length)return;
      results.push({label:def.label,wl:wl.slice(),il:arr.slice(),color:def.color,dash:def.dash,lw:def.lw});
    });
    return results.length?results:null;
  }

  // ── Loopback: single in1out2 / CH2 measurement, no reference ────
  if(p.indexOf('loopbacks')>=0){
    var lbmtype=p.indexOf('in1out2')>=0?'in1out2_2':'unknown';
    var lbmappings=LOOPBACK_MTYPE_MAP[lbmtype]||[];
    lbmappings.forEach(function(def){
      var arr=def.ch==='CH2'?ch2:def.ch==='CH3'?ch3:ch4;
      if(!arr.length)return;
      results.push({label:def.label,wl:wl.slice(),il:arr.slice(),color:def.color,dash:def.dash,lw:def.lw});
    });
    return results.length?results:null;
  }

  // ── MRR ──────────────────────────────────────────────────────────
  var isMrr=p.indexOf('mrr')>=0||p.indexOf('in1out4')>=0||p.indexOf('in2out3')>=0;
  var mtype;
  if(isMrr){
    mtype=p.indexOf('in1out4')>=0?'in1out4_23':p.indexOf('in2out3')>=0?'in2out3_23':'unknown';
  } else {
    // ── Crosser ────────────────────────────────────────────────────
    mtype=p.indexOf('in1out6')>=0?'in1out6_2':p.indexOf('in2out4')>=0?'in2out4_234':p.indexOf('in3out5')>=0?'in3out5_234':'unknown';
  }
  var defs=isMrr?MRR_CURVE_DEFS:OPT_CURVE_DEFS;
  defs.forEach(function(def){
    if(def.mtype!==mtype)return;
    var arr=def.ch==='CH2'?ch2:def.ch==='CH3'?ch3:ch4;
    if(!arr.length)return;
    results.push({label:def.label,wl:wl.slice(),il:arr.slice(),color:def.color,dash:def.dash,lw:def.lw});
  });
  return results.length?results:null;
}

// Merge curves that share the same label by element-wise averaging their IL.
// Ensures o4 and o9 (present in two intc1to10 folders) are averaged rather
// than shown twice.  Also re-sorts intc1to10 curves into PORT_ORDER.
function _mergeOptCurves(curves){
  if(!curves.length)return curves;
  var byLabel={};
  var order=[];
  curves.forEach(function(c){
    if(!byLabel[c.label]){byLabel[c.label]=[];order.push(c.label);}
    byLabel[c.label].push(c);
  });
  var merged=[];
  order.forEach(function(lbl){
    var group=byLabel[lbl];
    if(group.length===1){merged.push(group[0]);return;}
    // Average IL arrays element-wise
    var ref=group[0];
    var n=group.length;
    var avgIL=ref.il.map(function(_,i){
      return group.reduce(function(s,c){return s+c.il[i];},0)/n;
    });
    merged.push({label:lbl,wl:ref.wl,il:avgIL,color:ref.color,dash:ref.dash,lw:ref.lw});
  });
  // Re-order intc1to10 curves into canonical port order
  var hasIntc=merged.some(function(c){return INTC1TO10_PORT_ORDER.indexOf(c.label)>=0;});
  if(hasIntc){
    merged.sort(function(a,b){
      var ai=INTC1TO10_PORT_ORDER.indexOf(a.label);
      var bi=INTC1TO10_PORT_ORDER.indexOf(b.label);
      if(ai<0)ai=999;if(bi<0)bi=999;
      return ai-bi;
    });
  }
  return merged;
}

function rollingAvg(arr,n){
  if(n<=1)return arr.slice();
  var h=Math.floor(n/2);
  return arr.map(function(v,i){
    var s=Math.max(0,i-h),e=Math.min(arr.length-1,i+h),sum=0;
    for(var j=s;j<=e;j++)sum+=arr[j];
    return sum/(e-s+1);
  });
}

function clearOptData(){
  optFiles=[];optFileMap={};optServerPath='';
  optDevices=[];optCurrentKey=null;optCache={};_subCache={};
  hiddenCurves=new Set();
  optViewXMin=null;optViewXMax=null;optViewYMin=null;optViewYMax=null;
  optSubtract=false;
  var btn=document.getElementById('btn-subtract');if(btn)btn.classList.remove('active');
  var devItems=document.getElementById('opt-dev-items');
  if(devItems)devItems.innerHTML='';
  document.getElementById('opt-status').textContent='No data loaded';
  document.getElementById('opt-ph').style.display='flex';
  var pmsg=document.getElementById('opt-ph-msg');
  if(pmsg)pmsg.innerHTML='Pick a directory or enter a server path, then click <strong>Scan</strong>.<br>Select a device in Tab 2 to auto-load its optical data.';
  document.getElementById('opt-legend').innerHTML='';
  resizeOptChart();
  var oc=document.getElementById('opt-chart');
  if(oc){var cx=oc.getContext('2d');cx.clearRect(0,0,oc.width,oc.height);}
  var rdTable=document.getElementById('opt-rd-table');
  var rdEmpty=document.getElementById('opt-rd-empty');
  if(rdTable)rdTable.style.display='none';
  if(rdEmpty)rdEmpty.style.display='block';
  redraw2();
}

function resizeOptChart(){
  var wrap=document.getElementById('opt-chart-wrap');
  var c=document.getElementById('opt-chart');
  if(!wrap||!c)return;
  c.width=wrap.clientWidth;c.height=wrap.clientHeight;
}

// ── Chart range helpers ───────────────────────────────────────────
function _niceStep(range){
  var steps=[0.1,0.2,0.5,1,2,5,10,20,50,100,200,500];
  for(var i=0;i<steps.length;i++){if(range/steps[i]<=8)return steps[i];}
  return 500;
}
// Returns the curves that are actually rendered — subtracted when optSubtract is on.
// Use this instead of reading optCache directly so that zoom/pan/box coordinate
// mapping always matches what drawOptChart actually drew.
function _optActiveCurves(){
  var raw=optCurrentKey&&optCache[optCurrentKey]?optCache[optCurrentKey]:[];
  return (optSubtract&&raw.length)?_getSubCurves(optCurrentKey,raw):raw;
}

function _optGetCurrentRanges(allCurves,roll){
  if(optViewXMin!==null)return{xMin:optViewXMin,xMax:optViewXMax,yMin:optViewYMin,yMax:optViewYMax};
  var xMin=Infinity,xMax=-Infinity,yMin=Infinity,yMax=-Infinity;
  var src=allCurves.filter(function(c){return!hiddenCurves.has(c.label);});
  if(!src.length)src=allCurves;
  src.forEach(function(c){
    c.wl.forEach(function(w){if(w<xMin)xMin=w;if(w>xMax)xMax=w;});
    rollingAvg(c.il,roll).forEach(function(v){if(isFinite(v)){if(v<yMin)yMin=v;if(v>yMax)yMax=v;}});
  });
  xMin=Math.floor(xMin/5)*5;xMax=Math.ceil(xMax/5)*5;
  yMin=Math.floor(yMin/10)*10-5;yMax=Math.ceil(yMax/10)*10+5;
  if(xMin>=xMax){xMin=1510;xMax=1590;}if(yMin>=yMax){yMin=-70;yMax=5;}
  return{xMin:xMin,xMax:xMax,yMin:yMin,yMax:yMax};
}

function drawOptChart(){
  resizeOptChart();
  var canvas=document.getElementById('opt-chart');if(!canvas)return;
  var ctx=canvas.getContext('2d');
  var cw=canvas.width,ch=canvas.height;
  var rawCurves=(optCurrentKey&&optCache[optCurrentKey])||[];
  var ph=document.getElementById('opt-ph');
  if(!rawCurves.length){if(ph)ph.style.display='flex';renderOptLegend([]);return;}
  if(ph)ph.style.display='none';
  var allCurves=optSubtract?_getSubCurves(optCurrentKey,rawCurves):rawCurves;
  var roll=Math.max(1,parseInt(document.getElementById('opt-rolling').value)||1);
  var m={t:38,r:22,b:52,l:68};
  var pw=cw-m.l-m.r,phH=ch-m.t-m.b;
  if(pw<=0||phH<=0)return;
  var r=_optGetCurrentRanges(allCurves,roll);
  var xMin=r.xMin,xMax=r.xMax,yMin=r.yMin,yMax=r.yMax;
  function px(w){return m.l+(w-xMin)/(xMax-xMin)*pw;}
  function py(v){return m.t+phH-(v-yMin)/(yMax-yMin)*phH;}
  // Background
  ctx.fillStyle='#0a0c10';ctx.fillRect(0,0,cw,ch);
  ctx.fillStyle='#0d1117';ctx.fillRect(m.l,m.t,pw,phH);
  // Adaptive grid
  ctx.strokeStyle='#21262d';ctx.lineWidth=0.5;
  var xStep=_niceStep((xMax-xMin)/6),yStep=_niceStep((yMax-yMin)/5);
  var xi=Math.ceil(xMin/xStep)*xStep;
  for(;xi<=xMax+1e-9;xi+=xStep){
    var sx=px(xi);ctx.beginPath();ctx.moveTo(sx,m.t);ctx.lineTo(sx,m.t+phH);ctx.stroke();
    ctx.fillStyle='#484f58';ctx.font='9px monospace';
    var xt=(xStep<1?xi.toFixed(1):Math.round(xi).toString());
    ctx.fillText(xt,sx-ctx.measureText(xt).width/2,m.t+phH+14);
  }
  var yi=Math.ceil(yMin/yStep)*yStep;
  for(;yi<=yMax+1e-9;yi+=yStep){
    var sy=py(yi);ctx.beginPath();ctx.moveTo(m.l,sy);ctx.lineTo(m.l+pw,sy);ctx.stroke();
    ctx.fillStyle='#484f58';ctx.font='9px monospace';
    var yt=(yStep<1?yi.toFixed(1):Math.round(yi).toString());
    ctx.fillText(yt,m.l-6-ctx.measureText(yt).width,sy+3);
  }
  // Clip plot area
  ctx.save();ctx.beginPath();ctx.rect(m.l,m.t,pw,phH);ctx.clip();
  // Target WL marker — brighter when hovered/dragged so user knows it's draggable
  var twl=optTargetWL;
  if(twl>=xMin&&twl<=xMax){
    var isDraggingTWL=(_optDragMode==='twl');
    var markerAlpha=(_optNearTWL||isDraggingTWL)?'cc':'55';
    var markerX=px(twl);
    ctx.strokeStyle='#ff7b72'+markerAlpha;ctx.lineWidth=isDraggingTWL?2:1;
    ctx.setLineDash([5,4]);
    ctx.beginPath();ctx.moveTo(markerX,m.t);ctx.lineTo(markerX,m.t+phH);ctx.stroke();
    ctx.setLineDash([]);
    // Label
    ctx.fillStyle='#ff7b72'+markerAlpha;ctx.font='8px monospace';
    var wlStr=twl.toFixed(optWLStep<0.01?3:optWLStep<0.1?2:1)+'nm';
    ctx.fillText(wlStr,markerX+3,m.t+9);
    // Drag handle triangle at top of marker
    ctx.fillStyle='#ff7b72'+markerAlpha;
    ctx.beginPath();ctx.moveTo(markerX-5,m.t);ctx.lineTo(markerX+5,m.t);
    ctx.lineTo(markerX,m.t+7);ctx.closePath();ctx.fill();
  }
  // Curves (skip hidden)
  allCurves.forEach(function(curve){
    if(hiddenCurves.has(curve.label))return;
    var rl=rollingAvg(curve.il,roll);
    ctx.strokeStyle=curve.color;ctx.lineWidth=curve.lw||1;
    ctx.setLineDash(curve.dash||[]);ctx.beginPath();var first=true;
    for(var i=0;i<curve.wl.length;i++){
      var xp=px(curve.wl[i]),yp=py(rl[i]);
      if(first){ctx.moveTo(xp,yp);first=false;}else ctx.lineTo(xp,yp);
    }
    ctx.stroke();ctx.setLineDash([]);
  });
  // Zoom-box rubber band
  if(_optDragMode==='zoombox'&&_optDragStart&&_optDragEnd){
    var bx=Math.min(_optDragStart.x,_optDragEnd.x),by=Math.min(_optDragStart.y,_optDragEnd.y);
    var bw=Math.abs(_optDragEnd.x-_optDragStart.x),bh=Math.abs(_optDragEnd.y-_optDragStart.y);
    ctx.strokeStyle='#58a6ff90';ctx.lineWidth=1;ctx.setLineDash([4,3]);
    ctx.strokeRect(bx,by,bw,bh);ctx.fillStyle='#58a6ff18';ctx.fillRect(bx,by,bw,bh);
    ctx.setLineDash([]);
  }
  ctx.restore();
  // Axes border + labels
  ctx.strokeStyle='#30363d';ctx.lineWidth=1;ctx.strokeRect(m.l,m.t,pw,phH);
  ctx.fillStyle='#8b949e';ctx.font='10px monospace';
  var xlbl='Wavelength (nm)';
  ctx.fillText(xlbl,m.l+pw/2-ctx.measureText(xlbl).width/2,ch-6);
  var ylbl=optSubtract?'IL − Ref (dB)':'IL (dB)';
  ctx.save();ctx.translate(14,m.t+phH/2);ctx.rotate(-Math.PI/2);ctx.fillText(ylbl,0,0);ctx.restore();
  var vis=allCurves.length-hiddenCurves.size;
  var modeTag=optSubtract?' [− Ref]':'';
  ctx.fillStyle='#c9d1d9';ctx.font='bold 11px monospace';
  ctx.fillText((optCurrentKey||'')+'  —  Optical Spectra'+modeTag+'  ('+vis+'/'+allCurves.length+')',m.l,m.t-12);
  renderOptLegend(allCurves);
  if(dvSubTab===4)renderOptReadout();
}

function renderOptLegend(curves){
  var leg=document.getElementById('opt-legend');if(!leg)return;
  leg.innerHTML='';if(!curves||!curves.length)return;
  var seen={};
  curves.forEach(function(c){
    if(seen[c.label])return;seen[c.label]=true;
    var hidden=hiddenCurves.has(c.label);
    var col=hidden?'#484f58':c.color;
    var sp=document.createElement('span');
    sp.title=(hidden?'Show ':'Hide ')+c.label;
    sp.style.cssText='display:inline-flex;align-items:center;gap:4px;font-size:10px;color:'+col
      +';white-space:nowrap;cursor:pointer;padding:1px 5px;border-radius:3px;opacity:'+(hidden?'0.45':'1')
      +';transition:opacity .1s;user-select:none;';
    sp.innerHTML='<svg width="22" height="8" style="flex-shrink:0"><line x1="0" y1="4" x2="22" y2="4"'
      +' stroke="'+col+'" stroke-width="'+(c.lw||1)+'" stroke-dasharray="'+(c.dash||[]).join(',')+'"/></svg>'
      +c.label;
    sp.addEventListener('click',function(){
      if(hiddenCurves.has(c.label))hiddenCurves.delete(c.label);
      else hiddenCurves.add(c.label);
      drawOptChart();
    });
    leg.appendChild(sp);
  });
}
