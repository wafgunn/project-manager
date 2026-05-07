/*
 * gds-io.js — GDS file I/O, device detection, and backend sync
 *
 * Handles:
 *   • GDS file upload (drag-drop and file picker)
 *   • POST /api/upload, /api/find-designs, /api/group-devices
 *   • Merge-intersecting-devices client logic
 *   • Client-side device group selection drag-rectangle
 *
 * Depends on: state.js, canvas.js, renderer.js, panels.js
 */
// ═══════════════════════════════════════════════════════════════════
// FILE HANDLING
// ═══════════════════════════════════════════════════════════════════
function handleFile(file){
  if(!file)return;
  var reader=new FileReader();
  reader.onload=function(e){
    rawBuffer=e.target.result;
    lib=parseGDS(rawBuffer);
    activeCell=null;
    renderCacheDirty=true;
    hiddenLayers=new Set(['1/10']);
    devices=[];
    deviceGroups=[];
    selectedDevices=new Set();
    highlightedDevice=-1;
    nextGroupLetter=0;
    nextGroupId=0;

    var cellNames=Object.keys(lib.cells);
    var topName=cellNames[cellNames.length-1]||cellNames[0];
    if(topName)activeCell=lib.cells[topName];

    rebuildCellList(cellNames,topName);
    rebuildLayerList();
    updateDevicesPanel();
    document.getElementById('drop-overlay').classList.add('hidden');
    document.getElementById('st-file').textContent=file.name;
    document.getElementById('st-unit').textContent=(lib.dbunit*1e9).toFixed(3)+' nm/DBU';
    document.getElementById('st-cell').textContent=topName||'—';
    document.getElementById('find-btn').disabled=false;
    var _fta=document.getElementById('find-tol-arrow');if(_fta)_fta.disabled=false;
    resizeCanvas(canvas1);resizeCanvas(canvas2);
    fitView();
    uploadToBackend(file);
  };
  reader.readAsArrayBuffer(file);
}

function uploadToBackend(file){
  var fd=new FormData();fd.append('file',file);
  fetch('/api/upload',{method:'POST',body:fd})
    .catch(function(e){console.warn('Backend upload failed:',e);});
}

document.getElementById('file-input').addEventListener('change',function(e){
  handleFile(e.target.files[0]);this.value='';
});
['dragover','dragleave','drop'].forEach(function(ev){
  document.addEventListener(ev,function(e){
    if(ev==='dragover'){e.preventDefault();document.body.classList.add('drag-over');}
    else if(ev==='dragleave'){document.body.classList.remove('drag-over');}
    else if(ev==='drop'){
      e.preventDefault();document.body.classList.remove('drag-over');
      var f=e.dataTransfer&&e.dataTransfer.files[0];
      if(f&&(f.name.match(/\.gds2?i?i?$/i)||f.type==='application/octet-stream'))handleFile(f);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// FIND DEVICES — tolerance dropdown
// ═══════════════════════════════════════════════════════════════════
function _findTolMenuToggle(e){
  e.stopPropagation();
  var m=document.getElementById('find-tol-menu');
  if(!m)return;
  var open=m.style.display!=='none';
  m.style.display=open?'none':'block';
}
document.addEventListener('click',function(e){
  var menu=document.getElementById('find-tol-menu');
  var arrow=document.getElementById('find-tol-arrow');
  if(menu&&menu.style.display!=='none'&&!menu.contains(e.target)&&e.target!==arrow){
    menu.style.display='none';
  }
});

function findDevices(){
  if(!activeCell){showModal('No Cell Active','Select a cell first.');return;}
  // Close tolerance menu if open
  var tm=document.getElementById('find-tol-menu');if(tm)tm.style.display='none';
  var tolInput=document.getElementById('find-tol-input');
  var toleranceUm=tolInput?Math.max(0,parseFloat(tolInput.value)||0.1):0.1;
  var layerInput=document.getElementById('find-layer-input');
  var dtInput=document.getElementById('find-datatype-input');
  var searchLayer   =layerInput?Math.max(0,parseInt(layerInput.value)||1):1;
  var searchDatatype=dtInput   ?Math.max(0,parseInt(dtInput.value)   ||0):0;

  var btn=document.getElementById('find-btn');
  btn.disabled=true;
  btn.innerHTML='<span class="spinner"></span>Searching…';

  fetch('/api/find-designs',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      cell:activeCell.name,
      tolerance_um:toleranceUm,
      search_layer:searchLayer,
      search_datatype:searchDatatype
    })
  })
  .then(function(r){return r.json();})
  .then(function(data){
    if(data.error){showModal('Find Devices Error',data.error,'',true);return;}
    devices=(data.designs||[]).map(function(d,i){
      return Object.assign({},d,{color:devColor(i)});
    });
    gratings=[];   // stale — user must re-run Find Optical Gratings
    deviceGroups=[];
    selectedDevices=new Set();
    highlightedDevice=-1;
    nextGroupLetter=0;nextGroupId=0;
    collapsedGroups=new Set();hiddenGroups=new Set();

    var canExport=devices.length>0;
    ['t1-export-btn','export-footer-btn','export-footer-btn-2','t2-export-btn',
     'export-layer-arrow','export-layer-arrow-2'].forEach(function(id){
      var el=document.getElementById(id);if(el)el.disabled=!canExport;
    });
    document.getElementById('clear-btn').disabled=!canExport;
    document.getElementById('merge-btn').disabled=!canExport;
    document.getElementById('group-btn').disabled=!canExport;

    updateDevicesPanel();
    redrawActive();

    if(devices.length===0){
      showModal('No Devices Found',data.message||'No polygons found on the selected search layer.','',true);
    }
  })
  .catch(function(e){showModal('Backend Error','Could not reach the server.\n'+e,'',true);})
  .finally(function(){
    btn.disabled=false;
    btn.textContent='🔍 Find Devices';
    var _fta=document.getElementById('find-tol-arrow');if(_fta)_fta.disabled=false;
  });
}

// ═══════════════════════════════════════════════════════════════════
// CLEAR DEVICES
// ═══════════════════════════════════════════════════════════════════
function clearDevices(){
  devices=[];gratings=[];deviceGroups=[];selectedDevices=new Set();highlightedDevice=-1;
  nextGroupLetter=0;nextGroupId=0;collapsedGroups=new Set();hiddenGroups=new Set();
  ['t1-export-btn','export-footer-btn','export-footer-btn-2','t2-export-btn',
   'export-layer-arrow','export-layer-arrow-2','clear-btn','merge-btn','group-btn'].forEach(function(id){
    var el=document.getElementById(id);if(el)el.disabled=true;
  });
  updateDevicesPanel();
  fetch('/api/set-designs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({designs:[]})}).catch(function(){});
  redrawActive();
}

// ═══════════════════════════════════════════════════════════════════
// SYNC TO BACKEND
// ═══════════════════════════════════════════════════════════════════
function syncDevicesToBackend(){
  fetch('/api/set-designs',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({designs:devices})
  }).catch(function(){});
}

var _syncTimer=null;
function debouncedSyncLabels(){
  clearTimeout(_syncTimer);
  _syncTimer=setTimeout(syncLabelsToBackend,600);
}
function syncLabelsToBackend(){
  var payload=deviceGroups.map(function(g){
    return{
      id:g.id,name:g.name,cols:g.cols,rows:g.rows,
      devices:g.devices.map(function(dev){
        return{design_id:dev.device_id,col:dev.col,row:dev.row,label:dev.label};
      })
    };
  });
  fetch('/api/update-labels',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({arrays:payload})
  }).catch(function(){});
}

// ═══════════════════════════════════════════════════════════════════
// MERGE INTERSECTING DEVICES
// ═══════════════════════════════════════════════════════════════════
function mergeIntersectingDevices(){
  if(!devices.length){showModal('No Devices','Run Find Devices first.');return;}

  var dbu=lib?lib.dbunit:1e-9;

  if(selectedDevices.size>=2){
    // Force-merge all selected devices
    var toMerge=devices.filter(function(d){return selectedDevices.has(d.id);});
    var x0=Math.min.apply(null,toMerge.map(function(d){return d.x0;}));
    var y0=Math.min.apply(null,toMerge.map(function(d){return d.y0;}));
    var x1=Math.max.apply(null,toMerge.map(function(d){return d.x1;}));
    var y1=Math.max.apply(null,toMerge.map(function(d){return d.y1;}));
    var merged={id:0,x0:x0,y0:y0,x1:x1,y1:y1,
      x0_um:x0*dbu*1e6,y0_um:y0*dbu*1e6,x1_um:x1*dbu*1e6,y1_um:y1*dbu*1e6,
      color:devColor(0)};
    // Remove merged devices from groups
    var mergedIds=toMerge.map(function(d){return d.id;});
    var kept=devices.filter(function(d){return!selectedDevices.has(d.id);});
    kept.unshift(merged);
    kept.forEach(function(d,i){d.id=i;d.color=devColor(i);});
    // Fix groups
    _removeDevicesFromGroups(mergedIds);
    deviceGroups=deviceGroups.filter(function(g){return g.devices.length>0;});
    devices=kept;
    selectedDevices=new Set();
    syncDevicesToBackend();
    updateDevicesPanel();
    redrawActive();
    return;
  }

  // Auto-detect: union-find on intersecting pairs
  var n=devices.length;
  var parent=Array.from({length:n},function(_,i){return i;});
  function find(x){while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;}
  function union(x,y){var rx=find(x),ry=find(y);if(rx!==ry)parent[ry]=rx;}
  function intersects(a,b){return!(a.x1<=b.x0||b.x1<=a.x0||a.y1<=b.y0||b.y1<=a.y0);}
  var anyMerge=false;
  for(var i=0;i<n;i++)for(var j=i+1;j<n;j++){
    if(intersects(devices[i],devices[j])){union(i,j);anyMerge=true;}
  }
  if(!anyMerge){showModal('No Overlaps','No bounding boxes intersect or overlap.');return;}

  var groups={};
  for(var ii=0;ii<n;ii++){var r=find(ii);if(!groups[r])groups[r]=[];groups[r].push(ii);}
  var newDevices=[];
  Object.keys(groups).sort().forEach(function(r){
    var idx=groups[r];
    var x0=Math.min.apply(null,idx.map(function(i){return devices[i].x0;}));
    var y0=Math.min.apply(null,idx.map(function(i){return devices[i].y0;}));
    var x1=Math.max.apply(null,idx.map(function(i){return devices[i].x1;}));
    var y1=Math.max.apply(null,idx.map(function(i){return devices[i].y1;}));
    newDevices.push({id:newDevices.length,x0:x0,y0:y0,x1:x1,y1:y1,
      x0_um:x0*dbu*1e6,y0_um:y0*dbu*1e6,x1_um:x1*dbu*1e6,y1_um:y1*dbu*1e6,
      color:devColor(newDevices.length)});
  });
  var mergedCount=devices.length-newDevices.length;
  devices=newDevices;
  deviceGroups=[];  // groups are now stale
  selectedDevices=new Set();
  syncDevicesToBackend();
  updateDevicesPanel();
  redrawActive();
  showModal('Merge Complete','Merged '+mergedCount+' box'+(mergedCount===1?'':'es')+'. '+newDevices.length+' device'+(newDevices.length===1?'':'s')+' remain.');
}

function _removeDevicesFromGroups(deviceIds){
  var idSet=new Set(deviceIds);
  deviceGroups.forEach(function(g){
    g.devices=g.devices.filter(function(dev){return!idSet.has(dev.device_id);});
  });
}

// ═══════════════════════════════════════════════════════════════════
// GROUP DEVICES — CLIENT-SIDE SELECTION MODE
// ═══════════════════════════════════════════════════════════════════
function startGroupSelect(){
  if(!devices.length){showModal('No Devices','Run Find Devices first.');return;}
  setTool(1,'groupsel');
}

function finishGroupSelect(x0s,y0s,x1s,y1s){
  // Convert screen rect to world rect
  var wxMin=Math.min((x0s-panX)/zoom,(x1s-panX)/zoom);
  var wxMax=Math.max((x0s-panX)/zoom,(x1s-panX)/zoom);
  var wyMin=Math.min(-(y0s-panY)/zoom,-(y1s-panY)/zoom);
  var wyMax=Math.max(-(y0s-panY)/zoom,-(y1s-panY)/zoom);

  var inside=[];
  devices.forEach(function(d){
    var cx=(d.x0+d.x1)/2,cy=(d.y0+d.y1)/2;
    if(cx>=wxMin&&cx<=wxMax&&cy>=wyMin&&cy<=wyMax)inside.push(d.id);
  });

  if(!inside.length){
    // Nothing selected — stay in groupsel mode, just clear rect
    groupSelStart=null;groupSelEnd=null;
    redrawActive();
    return;
  }

  // Remove these devices from any existing groups
  _removeDevicesFromGroups(inside);
  deviceGroups=deviceGroups.filter(function(g){return g.devices.length>0;});

  createDeviceGroup(inside);
  setTool(1,'pan');
}

// ── 1-D clustering helper ─────────────────────────────────────────
function cluster1d(vals,tol){
  if(!vals.length)return[];
  var n=vals.length;
  var idxArr=[];for(var i=0;i<n;i++)idxArr.push(i);
  idxArr.sort(function(a,b){return vals[a]-vals[b];});
  var result=new Array(n);
  result[idxArr[0]]=0;
  var clusterIdx=0;
  for(var k=1;k<n;k++){
    if(vals[idxArr[k]]-vals[idxArr[k-1]]>tol)clusterIdx++;
    result[idxArr[k]]=clusterIdx;
  }
  return result;
}

function minPosSep(arr){
  if(arr.length<2)return 0;
  var sorted=arr.slice().sort(function(a,b){return a-b;});
  var minD=Infinity;
  for(var i=1;i<sorted.length;i++){
    var d=sorted[i]-sorted[i-1];
    if(d>0&&d<minD)minD=d;
  }
  return minD===Infinity?0:minD;
}

function createDeviceGroup(deviceIds){
  if(!deviceIds.length)return;
  var devList=deviceIds.map(function(id){
    return devices.find(function(d){return d.id===id;});
  }).filter(Boolean);
  if(!devList.length)return;

  var letter=String.fromCharCode(65+(nextGroupLetter%26));
  nextGroupLetter++;
  var name='Group'+letter;

  var cxs=devList.map(function(d){return(d.x0+d.x1)/2;});
  var cys=devList.map(function(d){return(d.y0+d.y1)/2;});

  var cxTol=Math.max(0.5,minPosSep(cxs)*0.5);
  var cyTol=Math.max(0.5,minPosSep(cys)*0.5);

  var colAssign=cluster1d(cxs,cxTol);
  var rowAssign=cluster1d(cys,cyTol);

  var nCols=Math.max.apply(null,colAssign)+1;
  var nRows=Math.max.apply(null,rowAssign)+1;
  var colPad=Math.max(String(nCols-1).length,1);
  var rowPad=Math.max(String(nRows-1).length,1);

  var groupDevs=devList.map(function(d,i){
    var col=colAssign[i],row=rowAssign[i];
    var label=makeDevLabel(name,nCols,nRows,colPad,rowPad,col,row);
    return{device_id:d.id,col:col,row:row,label:label};
  });

  deviceGroups.push({
    id:nextGroupId++,
    name:name,
    letter:letter,
    cols:nCols,
    rows:nRows,
    colPad:colPad,
    rowPad:rowPad,
    devices:groupDevs
  });

  debouncedSyncLabels();
  updateDevicesPanel();
  redrawActive();
}

function deleteDeviceGroup(groupId){
  deviceGroups=deviceGroups.filter(function(g){return g.id!==groupId;});
  collapsedGroups.delete(groupId);
  hiddenGroups.delete(groupId);
  debouncedSyncLabels();
  updateDevicesPanel();
  redrawActive();
}

// ── Label helper: single index when only 1 col or 1 row ──────────
function makeDevLabel(gName,nCols,nRows,colPad,rowPad,col,row){
  if(nCols<=1&&nRows<=1) return gName+'0';
  if(nRows<=1)           return gName+String(col).padStart(colPad,'0');
  if(nCols<=1)           return gName+String(row).padStart(rowPad,'0');
  return gName+String(col).padStart(colPad,'0')+String(row).padStart(rowPad,'0');
}

function renameDeviceGroup(groupId,newName){
  var g=deviceGroups.find(function(g){return g.id===groupId;});
  if(!g)return;
  g.name=newName;
  g.devices.forEach(function(dev){
    dev.label=makeDevLabel(newName,g.cols,g.rows,g.colPad,g.rowPad,dev.col,dev.row);
  });
  debouncedSyncLabels();
  redrawActive();
}
