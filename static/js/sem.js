/*
 * sem.js — SEM image viewer (Tab 3, sub-tab 2)
 *
 * Owns:
 *   • SEM image directory scanning (server and file-picker modes)
 *   • Thumbnail grid rendering
 *   • Full-screen preview with pan/zoom/rotation
 *   • Pixel-calibrated ruler overlay
 *   • BMP save with rotation correction
 *
 * Depends on: state.js, navigation.js
 */
// ═══════════════════════════════════════════════════════════════════
// SEM IMAGING
// ═══════════════════════════════════════════════════════════════════
function addSemImages(files){
  if(activeDeviceId<0)return;
  if(!semImages[activeDeviceId])semImages[activeDeviceId]=[];
  Array.from(files).forEach(function(file){
    var reader=new FileReader();
    reader.onload=function(e){
      semImages[activeDeviceId].push({id:semImageCounter++,name:file.name,url:e.target.result});
      renderSemGrid();redraw2();
    };
    reader.readAsDataURL(file);
  });
}

async function _semPickDir(){
  var st=document.getElementById('sem-dir-status');
  if(window.showDirectoryPicker){
    try{
      var handle=await window.showDirectoryPicker({mode:'readwrite'});
      _semDirHandle=handle;
      semDirFiles=[];
      var entries=[];
      for await(var entry of handle.values()){
        if(entry.kind==='file'&&entry.name.toLowerCase().endsWith('.bmp'))entries.push(entry);
      }
      if(!entries.length){if(st)st.textContent='No .bmp files found';return;}
      if(st)st.textContent='Loading '+entries.length+' .bmp…';
      var pending=entries.length;
      entries.forEach(async function(entry){
        var file=await entry.getFile();
        var reader=new FileReader();
        reader.onload=function(e){
          semDirFiles.push({name:file.name,url:e.target.result});
          if(--pending===0){
            var n=semDirFiles.length;
            if(st)st.textContent=n+' .bmp file'+(n===1?'':'s')+' in dir';
            renderSemGrid();redraw2();
          }
        };
        reader.readAsDataURL(file);
      });
    }catch(e){if(e.name!=='AbortError')console.error('Dir picker error',e);}
  } else {
    // Fallback for browsers without FSA
    document.getElementById('sem-dir-input').click();
  }
}

function addSemDirFiles(files){
  // Fallback path (old-style input, no write-back)
  _semDirHandle=null;
  var bmps=Array.from(files).filter(function(f){return f.name.toLowerCase().endsWith('.bmp');});
  if(!bmps.length){
    var st=document.getElementById('sem-dir-status');
    if(st)st.textContent='No .bmp files found in directory';
    return;
  }
  semDirFiles=[];
  var pending=bmps.length;
  var st=document.getElementById('sem-dir-status');
  if(st)st.textContent='Loading '+pending+' .bmp…';
  bmps.forEach(function(file){
    var reader=new FileReader();
    reader.onload=function(e){
      semDirFiles.push({name:file.name,url:e.target.result});
      if(--pending===0){
        var n=semDirFiles.length;
        if(st)st.textContent=n+' .bmp file'+(n===1?'':'s')+' in dir';
        renderSemGrid();redraw2();
      }
    };
    reader.readAsDataURL(file);
  });
}

function clearSemDir(){
  semDirFiles=[];_semDirHandle=null;semServerPath='';
  var el=document.getElementById('sem-server-path');if(el)el.value='';
  var st=document.getElementById('sem-dir-status');
  if(st)st.textContent='No directory loaded';
  renderSemGrid();redraw2();
}

function _scanSemFromServer(path){
  if(!path)return;
  semServerPath=path;
  var st=document.getElementById('sem-dir-status');
  if(st)st.textContent='Scanning…';
  fetch('/api/sem-scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:path})})
  .then(function(r){return r.json();})
  .then(function(data){
    if(data.error){if(st)st.textContent='Error: '+data.error;return;}
    semDirFiles=data.files.map(function(name){
      return{name:name,url:'/api/sem-image?path='+encodeURIComponent(data.dir+'/'+name)};
    });
    var n=semDirFiles.length;
    if(st)st.textContent=n+' .bmp file'+(n===1?'':'s')+' in dir';
    renderSemGrid();redraw2();
  })
  .catch(function(e){if(st)st.textContent='Server error';console.error(e);});
}

function removeSemImage(did,iid){
  if(!semImages[did])return;
  semImages[did]=semImages[did].filter(function(img){return img.id!==iid;});
  if(did===activeDeviceId)renderSemGrid();
  redraw2();
}

function clearSemImages(){
  if(activeDeviceId<0)return;
  semImages[activeDeviceId]=[];renderSemGrid();
}

// Returns the device label for a given device_id (used for BMP matching)
function _semDeviceLabel(deviceId){
  var labelMap=buildLabelMap();
  var d=devices.find(function(dd){return dd.id===deviceId;});
  if(!d)return null;
  return labelMap[d.id]||null;
}

// Returns all device labels in the same group as activeDeviceId (for auto-match hints)
function _semGroupLabels(){
  if(activeDeviceId<0)return[];
  var grp=deviceGroups.find(function(g){
    return g.devices.some(function(dv){return dv.device_id===activeDeviceId;});
  });
  if(!grp)return[_semDeviceLabel(activeDeviceId)].filter(Boolean);
  var labelMap=buildLabelMap();
  return grp.devices.map(function(dv){return labelMap[dv.device_id]||null;}).filter(Boolean);
}

// ── Per-device data-availability helpers ──────────────────────────────────────
// lm: pre-built labelMap (pass from drawDeviceMapSolid to avoid repeated buildLabelMap calls)
function _deviceHasSEM(deviceId,lm){
  if(semImages[deviceId]&&semImages[deviceId].length>0)return true;
  var lbl=(lm&&lm[deviceId])||null;
  if(!lbl){var dm=devices.find(function(dd){return dd.id===deviceId;});lbl=dm?dm.label||null:null;}
  if(lbl&&semDirFiles.some(function(f){return f.name.toLowerCase().indexOf(lbl.toLowerCase())>=0;}))return true;
  return false;
}
function _deviceHasOD(deviceId,lm){
  var d=devices.find(function(dd){return dd.id===deviceId;});if(!d)return false;
  var lbl=((lm&&lm[deviceId])||d.label||'').toLowerCase();if(!lbl)return false;
  if(optDevices.some(function(dev){var k=dev.key.toLowerCase();
    return lbl===k||lbl.indexOf(k)>=0||k.indexOf(lbl)>=0;}))return true;
  if(optFiles.length)return optFiles.some(function(f){
    return f.webkitRelativePath.toLowerCase().indexOf(lbl)>=0;});
  return false;
}

function renderSemGrid(){
  var grid=document.getElementById('sem-grid');
  var cntEl=document.getElementById('sem-count');
  if(!grid)return;

  // Manual uploads for this device
  var manual=(activeDeviceId>=0&&semImages[activeDeviceId])||[];

  // Dir BMP files matching this device's label
  var devLabel=activeDeviceId>=0?_semDeviceLabel(activeDeviceId):null;
  var dirMatched=devLabel
    ?semDirFiles.filter(function(f){return f.name.toLowerCase().includes(devLabel.toLowerCase());})
    :[];

  var allImgs=manual.concat(dirMatched.map(function(f){return{id:null,name:f.name,url:f.url,fromDir:true};}));
  if(cntEl)cntEl.textContent=allImgs.length+' image'+(allImgs.length===1?'':'s');

  grid.innerHTML='';
  if(!allImgs.length){
    var hint=devLabel?(' matching <strong>'+devLabel+'</strong>'):'';
    grid.innerHTML='<div style="color:#484f58;font-size:11px;width:100%;text-align:center;margin-top:60px;">'
      +'<div style="font-size:32px;opacity:.2;margin-bottom:8px;">📷</div>'
      +(devLabel?'No images'+hint+' found.<br><span style="font-size:10px;">Pick a directory or upload manually.</span>':'No device selected.')
      +'</div>';
    return;
  }

  allImgs.forEach(function(img){
    var did=activeDeviceId;var iid=img.id;
    var card=document.createElement('div');card.className='sem-img-card';
    card.style.cursor='pointer';
    card.title='Click to preview';
    (function(imgSnap){card.addEventListener('click',function(e){if(!e.target.closest('button'))openSemPreview(imgSnap);});})(img);
    var im=document.createElement('img');im.src=img.url;im.alt=img.name;card.appendChild(im);
    // RotCor badge — top-left overlay, ~1/8 card width font size
    if(img.name.indexOf('RotCor')!==-1){
      var badge=document.createElement('div');
      badge.textContent='RotCor';
      badge.style.cssText='position:absolute;top:0;left:0;font-family:monospace;font-size:11px;'
        +'line-height:1.2;color:#00ffff;background:#00000099;'
        +'border:1px solid #00ffff;border-top:none;border-left:none;'
        +'border-radius:0 0 4px 0;padding:2px 6px;pointer-events:none;';
      card.appendChild(badge);
    }
    var bar=document.createElement('div');
    bar.style.cssText='display:flex;align-items:center;gap:4px;padding:4px 6px;background:#1c2128;';
    var nm=document.createElement('span');
    nm.style.cssText='font-size:9px;color:'+(img.fromDir?'#58a6ff':'#8b949e')+';flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    nm.textContent=img.name;
    bar.appendChild(nm);
    if(!img.fromDir){
      var del=document.createElement('button');del.className='group-icon-btn del-btn';
      del.textContent='✕';del.title='Remove';
      del.addEventListener('click',function(){removeSemImage(did,iid);});
      bar.appendChild(del);
    }
    card.appendChild(bar);grid.appendChild(card);
  });
}

// ═══════════════════════════════════════════════════════════════════
// SEM PREVIEW + RULER
// ═══════════════════════════════════════════════════════════════════

function openSemPreview(img){
  _semRulerPt1=null;_semRulerPt2=null;
  _semUpdateReadout();
  document.getElementById('sem-prev-title').textContent=img.name;
  // Switch to the preview sub-page
  document.querySelectorAll('.dv-subpage').forEach(function(p){p.classList.remove('active');});
  document.getElementById('dv-sub-semprev').classList.add('active');
  var el=new Image();
  el.onload=function(){
    _semPrevObj={url:img.url,name:img.name,imgEl:el,relPath:img.relPath||''};
    // RotCor images are already corrected — reset rotation to 0
    if(img.name.indexOf('RotCor')!==-1)_semRotAngle=0;
    // Auto-set nm/px from filename (PixelSize or ImageSize segment)
    var cal=_semExtractCalibration(img.name,el.naturalWidth,el.naturalHeight);
    if(cal!==null)_semNmPerPx=cal;
    requestAnimationFrame(function(){
      _semComputeAndSetSize();
      _semRenderProps();
    });
  };
  el.src=img.url;
}

function closeSemPreview(){
  _semPrevObj=null;
  document.querySelectorAll('.dv-subpage').forEach(function(p){p.classList.remove('active');});
  document.getElementById('dv-sub2').classList.add('active');
  renderSemGrid();
}

// Size the canvas to fill the available canvas area, preserving image aspect ratio.
function _semComputeAndSetSize(){
  var canvas=document.getElementById('sem-preview-canvas');
  var area=document.getElementById('sem-canvas-area');
  if(!canvas||!area||!_semPrevObj)return;
  var iw=_semPrevObj.imgEl.naturalWidth,ih=_semPrevObj.imgEl.naturalHeight;
  if(!iw||!ih)return;
  var aw=area.clientWidth||area.offsetWidth;
  var ah=area.clientHeight||area.offsetHeight;
  if(!aw||!ah)return;
  var PAD=24; // breathing room around image
  var scale=Math.min((aw-PAD)/iw,(ah-PAD)/ih,1);
  var cw=Math.floor(iw*scale),ch=Math.floor(ih*scale);
  canvas.width=cw; canvas.height=ch;
  canvas.style.width=cw+'px'; canvas.style.height=ch+'px';
  _semPrevZoom=scale;_semPrevPanX=0;_semPrevPanY=0;
  _semDraw();
}

// Reset zoom/pan so the full image fills the current canvas (canvas size unchanged).
function _semFitCanvas(){
  var canvas=document.getElementById('sem-preview-canvas');
  if(!canvas||!_semPrevObj)return;
  var iw=_semPrevObj.imgEl.naturalWidth;
  _semPrevZoom=canvas.width/iw;
  _semPrevPanX=0;_semPrevPanY=0;
  _semDraw();
}

function resetSemRuler(){
  _semRulerPt1=null;_semRulerPt2=null;_semRulerComplete=false;
  _semUpdateReadout();
  _semDraw();
}

function _semNmPerPxChange(){
  var el=document.getElementById('sem-nm-per-px');
  _semNmPerPx=Math.max(0.0001,parseFloat(el.value)||1.0);
  _semUpdateImgSize();
  _semUpdateReadout();
  _semDraw();
}

function _semUpdateImgSize(){
  var lbl=document.getElementById('sem-img-size-lbl');
  if(!lbl||!_semPrevObj)return;
  var iw=_semPrevObj.imgEl.naturalWidth,ih=_semPrevObj.imgEl.naturalHeight;
  lbl.textContent=_semFmtNm(iw*_semNmPerPx)+' × '+_semFmtNm(ih*_semNmPerPx);
}

// Parse SEM filename into [{key,val}] property list.
// Format: AUTHOR_wNchipM_doseXuC_currentYnA_apertureZum_BSSWnm_CATEGORY_deviceNN_position
function _semParseFilename(name){
  var base=name.replace(/\.[^.]+$/,'');
  var parts=base.split('_');
  var props=[],i=0,group=null,device=null,imagePos=null;
  // Author: index 0, all-caps letters only (e.g. WG)
  if(i<parts.length&&/^[A-Z]{1,8}$/.test(parts[i])){props.push({key:'Author',val:parts[i]});i++;}
  // Chip: starts with 'w' followed by digit (e.g. w1chip23)
  if(i<parts.length&&/^w\d/i.test(parts[i])){props.push({key:'Chip',val:parts[i]});i++;}
  for(;i<parts.length;i++){
    var p=parts[i],m;
    if((m=p.match(/^dose([\d.]+)(uC|nC|pC)/i))){
      var du=m[2].toLowerCase()==='uc'?'µC/cm²':m[2].toLowerCase()==='nc'?'nC/cm²':'pC/cm²';
      props.push({key:'Dose',val:m[1]+' '+du});
    } else if((m=p.match(/^current([\d.]+[a-z]+)/i))){
      props.push({key:'Current',val:m[1]});
    } else if((m=p.match(/^aperture([\d.]+)(um|nm|mm)/i))){
      props.push({key:'Aperture',val:m[1]+(m[2].toLowerCase()==='um'?'µm':m[2])});
    } else if((m=p.match(/^BSS([\d.]+)(nm|um)/i))){
      props.push({key:'Beam Step Size',val:m[1]+' '+(m[2].toLowerCase()==='um'?'µm':'nm')});
    } else if((m=p.match(/^ImageSize([\d.]+)(um|nm|mm)/i))){
      var isu=m[2].toLowerCase();
      var isDisp=m[1]+(isu==='um'?'µm':isu==='mm'?'mm':'nm');
      props.push({key:'Image Size',val:isDisp});
    } else if((m=p.match(/^PixelSize([\d.]+)(nm|um)/i))){
      var psu=m[2].toLowerCase();
      var psDisp=m[1]+(psu==='um'?'µm':'nm');
      props.push({key:'Pixel Size',val:psDisp});
    } else if(/^[a-z]{2,}\d{2,}$/i.test(p)){
      device=p; // e.g. cros01, ring05
    } else if(i===parts.length-1&&/^(left|right|top|bottom|center|centre|mid|full|wide|close|zoom|detail)$/i.test(p)){
      imagePos=p;
    } else if(/^[a-z]+$/i.test(p)&&p.length>2&&!group){
      group=p; // category word, e.g. crossers
    }
  }
  if(group||device){
    var gs=group||'';
    if(device){var dp=device.replace(/\d+$/,'');gs=gs?(gs+'_'+dp):dp;}
    if(gs)props.push({key:'Group',val:gs});
    if(device)props.push({key:'Device',val:device});
  }
  if(imagePos)props.push({key:'Image',val:imagePos});
  return props;
}

// Extract nm/px calibration from filename segments ImageSize*um and PixelSize*nm.
// PixelSize takes priority; if absent, ImageSize / image_width is used.
function _semExtractCalibration(name,imgW,imgH){
  var base=name.replace(/\.[^.]+$/,'');
  var parts=base.split('_');
  var nmPerPx=null,imageSizeNm=null;
  parts.forEach(function(p){
    var m;
    if((m=p.match(/^PixelSize([\d.]+)(nm|um)/i))){
      var v=parseFloat(m[1]);
      nmPerPx=m[2].toLowerCase()==='um'?v*1000:v;
    } else if((m=p.match(/^ImageSize([\d.]+)(um|nm|mm)/i))){
      var v=parseFloat(m[1]);
      var u=m[2].toLowerCase();
      imageSizeNm=u==='um'?v*1000:u==='mm'?v*1e6:v;
    }
  });
  // If no explicit PixelSize but ImageSize given, derive from width
  if(nmPerPx===null&&imageSizeNm!==null&&imgW>0){
    nmPerPx=imageSizeNm/imgW;
  }
  return nmPerPx;
}

// Build the properties panel HTML and inject it.
function _semRenderProps(){
  var panel=document.getElementById('sem-props-panel');
  if(!panel||!_semPrevObj)return;
  var iw=_semPrevObj.imgEl.naturalWidth,ih=_semPrevObj.imgEl.naturalHeight;
  var props=_semParseFilename(_semPrevObj.name);
  var sHdr='font-size:9px;color:#484f58;text-transform:uppercase;letter-spacing:.08em;margin:14px 0 8px;';
  var sKey='font-size:9px;color:#484f58;margin-bottom:3px;';
  var sVal='font-size:11px;color:#c9d1d9;font-weight:500;word-break:break-all;';
  var sRow='margin-bottom:10px;';
  var html='';
  // ── Calibration ──────────────────────────────────────────────────
  html+='<div style="'+sHdr+'margin-top:0;">Calibration</div>';
  html+='<div style="'+sRow+'">';
  html+='<div style="'+sKey+'">nm / pixel</div>';
  html+='<input type="number" id="sem-nm-per-px" value="'+_semNmPerPx.toPrecision(6)+'" min="0.0001" step="any" oninput="_semNmPerPxChange()"'
      +' style="background:#21262d;border:1px solid #30363d;color:#c9d1d9;font-family:monospace;font-size:11px;'
      +'padding:5px 8px;border-radius:4px;width:100%;box-sizing:border-box;text-align:right;">';
  html+='</div>';
  html+='<div style="'+sRow+'">';
  html+='<div style="'+sKey+'">Image size</div>';
  html+='<div id="sem-img-size-lbl" style="'+sVal+'">'+_semFmtNm(iw*_semNmPerPx)+' × '+_semFmtNm(ih*_semNmPerPx)+'</div>';
  html+='</div>';
  html+='<div style="'+sRow+'">';
  html+='<div style="'+sKey+'">Resolution</div>';
  html+='<div style="font-size:10px;color:#8b949e;">'+iw+' × '+ih+' px</div>';
  html+='</div>';
  // ── Rotation ─────────────────────────────────────────────────────
  html+='<div style="border-top:1px solid #21262d;margin:4px 0 8px;"></div>';
  html+='<div style="'+sHdr+'margin-top:0;">Rotation</div>';
  html+='<div style="'+sRow+'">';
  html+='<div style="'+sKey+'">Angle (°)</div>';
  html+='<div style="display:flex;align-items:center;">';
  html+='<input type="number" id="sem-rot-angle" value="'+_semRotAngle.toFixed(2)+'" step="0.05" oninput="_semRotateTo()"'
      +' style="background:#21262d;border:1px solid #30363d;color:#c9d1d9;font-family:monospace;font-size:11px;'
      +'padding:4px 6px;border-radius:4px;width:0;flex:1;min-width:0;text-align:center;">';
  html+='</div>';
  html+='</div>';
  html+='<button onclick="_semSaveRotCor()" title="Apply bilinear-interpolation rotation to pixel data and save as _RotCor.bmp"'
      +' style="width:100%;background:#1f6feb;border:1px solid #388bfd;color:#fff;font-family:inherit;font-size:11px;'
      +'padding:5px 8px;border-radius:4px;cursor:pointer;margin-bottom:10px;">＋ Add RotCor to Library</button>';
  // ── File properties ───────────────────────────────────────────────
  if(props.length){
    html+='<div style="border-top:1px solid #21262d;margin:4px 0 0;"></div>';
    html+='<div style="'+sHdr+'">File Properties</div>';
    props.forEach(function(p){
      html+='<div style="'+sRow+'">';
      html+='<div style="'+sKey+'">'+p.key+'</div>';
      html+='<div style="'+sVal+'">'+p.val+'</div>';
      html+='</div>';
    });
  }
  panel.innerHTML=html;
}

// Axis-snap: constrain pt to H or V from pt1 (image-pixel space)
function _semAxisSnap(pt){
  if(!_semRulerPt1)return pt;
  var dx=pt.x-_semRulerPt1.x,dy=pt.y-_semRulerPt1.y;
  return Math.abs(dx)>=Math.abs(dy)?{x:pt.x,y:_semRulerPt1.y}:{x:_semRulerPt1.x,y:pt.y};
}

// Convert canvas coords → image-pixel coords (accounts for rotation)
function _semC2I(cx,cy){
  if(_semRotAngle&&_semPrevObj){
    var iw=_semPrevObj.imgEl.naturalWidth,ih=_semPrevObj.imgEl.naturalHeight;
    var imgCX=_semPrevPanX+iw*_semPrevZoom/2,imgCY=_semPrevPanY+ih*_semPrevZoom/2;
    var r=-_semRotAngle*Math.PI/180,cos=Math.cos(r),sin=Math.sin(r);
    var dx=cx-imgCX,dy=cy-imgCY;
    cx=imgCX+dx*cos-dy*sin; cy=imgCY+dx*sin+dy*cos;
  }
  return{x:(cx-_semPrevPanX)/_semPrevZoom,y:(cy-_semPrevPanY)/_semPrevZoom};
}
// Convert image-pixel coords → canvas coords (accounts for rotation)
function _semI2C(ix,iy){
  var cx=ix*_semPrevZoom+_semPrevPanX,cy=iy*_semPrevZoom+_semPrevPanY;
  if(_semRotAngle&&_semPrevObj){
    var iw=_semPrevObj.imgEl.naturalWidth,ih=_semPrevObj.imgEl.naturalHeight;
    var imgCX=_semPrevPanX+iw*_semPrevZoom/2,imgCY=_semPrevPanY+ih*_semPrevZoom/2;
    var r=_semRotAngle*Math.PI/180,cos=Math.cos(r),sin=Math.sin(r);
    var dx=cx-imgCX,dy=cy-imgCY;
    return{x:imgCX+dx*cos-dy*sin,y:imgCY+dx*sin+dy*cos};
  }
  return{x:cx,y:cy};
}
// Raw convert: image-pixel → canvas coords WITHOUT rotation (for ruler overlay)
function _semI2C_raw(ix,iy){
  return{x:ix*_semPrevZoom+_semPrevPanX,y:iy*_semPrevZoom+_semPrevPanY};
}
// Raw convert: canvas coords → image-pixel coords WITHOUT rotation (for ruler placement)
function _semC2I_raw(cx,cy){
  return{x:(cx-_semPrevPanX)/_semPrevZoom,y:(cy-_semPrevPanY)/_semPrevZoom};
}

function _semDraw(){
  var canvas=document.getElementById('sem-preview-canvas');
  if(!canvas||!_semPrevObj)return;
  var ctx=canvas.getContext('2d');
  var cw=canvas.width,ch=canvas.height;
  ctx.clearRect(0,0,cw,ch);
  ctx.fillStyle='#0a0c10';ctx.fillRect(0,0,cw,ch);
  // Draw image (with optional rotation around image centre)
  var iw=_semPrevObj.imgEl.naturalWidth,ih=_semPrevObj.imgEl.naturalHeight;
  ctx.save();
  if(_semRotAngle){
    var imgCX=_semPrevPanX+iw*_semPrevZoom/2,imgCY=_semPrevPanY+ih*_semPrevZoom/2;
    ctx.translate(imgCX,imgCY);
    ctx.rotate(_semRotAngle*Math.PI/180);
    ctx.translate(-imgCX,-imgCY);
  }
  ctx.drawImage(_semPrevObj.imgEl,_semPrevPanX,_semPrevPanY,iw*_semPrevZoom,ih*_semPrevZoom);
  ctx.restore();
  // Draw grid (fixed in canvas/screen space — does not rotate with image)
  if(_semGridOn){
    ctx.strokeStyle=_semGridColor;ctx.lineWidth=_semGridWidth;ctx.setLineDash([]);
    ctx.globalAlpha=0.55;
    for(var gi=1;gi<_semGridRows;gi++){
      var gy=ch*gi/_semGridRows;
      ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(cw,gy);ctx.stroke();
    }
    for(var gj=1;gj<_semGridCols;gj++){
      var gx=cw*gj/_semGridCols;
      ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,ch);ctx.stroke();
    }
    ctx.globalAlpha=1;
  }
  // Draw ruler (always in raw canvas coords — unaffected by rotation)
  if(_semRulerPt1){
    var c1=_semI2C_raw(_semRulerPt1.x,_semRulerPt1.y);
    // Endpoint 1
    ctx.strokeStyle='#ff7b72';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.arc(c1.x,c1.y,5,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='#ff7b7260';ctx.fill();
    _semCrossHair(ctx,c1.x,c1.y,'#ff7b72');
    if(_semRulerPt2){
      var c2=_semI2C_raw(_semRulerPt2.x,_semRulerPt2.y);
      // Line
      ctx.strokeStyle='#ffdd57';ctx.lineWidth=1.5;ctx.setLineDash([6,3]);
      ctx.beginPath();ctx.moveTo(c1.x,c1.y);ctx.lineTo(c2.x,c2.y);ctx.stroke();
      ctx.setLineDash([]);
      // Endpoint 2
      ctx.strokeStyle='#ff7b72';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(c2.x,c2.y,5,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle='#ff7b7260';ctx.fill();
      _semCrossHair(ctx,c2.x,c2.y,'#ff7b72');
      // Midpoint label
      var mx=(c1.x+c2.x)/2,my=(c1.y+c2.y)/2;
      var dx=_semRulerPt2.x-_semRulerPt1.x,dy=_semRulerPt2.y-_semRulerPt1.y;
      var pxDist=Math.sqrt(dx*dx+dy*dy);
      var nmDist=pxDist*_semNmPerPx;
      var lbl=pxDist.toFixed(1)+' px  |  '+_semFmtNm(nmDist);
      ctx.font='bold 11px monospace';
      var tw=ctx.measureText(lbl).width;
      var lx=mx-tw/2,ly=my-14;
      ctx.fillStyle='#000000bb';ctx.fillRect(lx-4,ly-11,tw+8,16);
      ctx.fillStyle='#ffdd57';ctx.fillText(lbl,lx,ly);
      // Pixel-scale tick marks (end marks)
      _semTickMark(ctx,c1,c2);
    }
  }
}

function _semCrossHair(ctx,x,y,col){
  var r=9;ctx.strokeStyle=col;ctx.lineWidth=1;ctx.setLineDash([]);
  ctx.beginPath();ctx.moveTo(x-r,y);ctx.lineTo(x+r,y);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x,y-r);ctx.lineTo(x,y+r);ctx.stroke();
}

function _semTickMark(ctx,c1,c2){
  var dx=c2.x-c1.x,dy=c2.y-c1.y;
  var len=Math.sqrt(dx*dx+dy*dy);if(len<1)return;
  var nx=-dy/len*8,ny=dx/len*8; // perpendicular, 8px half-length
  ctx.strokeStyle='#ffdd57';ctx.lineWidth=1.5;ctx.setLineDash([]);
  [[c1.x,c1.y],[c2.x,c2.y]].forEach(function(p){
    ctx.beginPath();ctx.moveTo(p[0]+nx,p[1]+ny);ctx.lineTo(p[0]-nx,p[1]-ny);ctx.stroke();
  });
}

// ── Rotation controls ─────────────────────────────────────────────
function _semRotate(delta){
  _semRotAngle=Math.round((_semRotAngle+delta)*1000)/1000;
  var el=document.getElementById('sem-rot-angle');
  if(el)el.value=_semRotAngle.toFixed(2);
  _semDraw();
}
function _semRotateTo(){
  var el=document.getElementById('sem-rot-angle');
  if(!el)return;
  _semRotAngle=parseFloat(el.value)||0;
  _semDraw();
}

// ── Grid overlay ─────────────────────────────────────────────────
function _semGridToggle(){
  _semGridOn=!_semGridOn;
  var btn=document.getElementById('sem-grid-btn');
  if(btn){btn.style.background=_semGridOn?'#0d419d':'';btn.style.borderColor=_semGridOn?'#1f6feb':'';}
  _semDraw();
}
function _semGridMenuToggle(e){
  e.stopPropagation();
  var m=document.getElementById('sem-grid-menu');
  if(!m)return;
  m.style.display=m.style.display==='none'?'block':'none';
}
function _semGridApply(){
  var r=parseInt(document.getElementById('sg-rows').value)||10;
  var c=parseInt(document.getElementById('sg-cols').value)||10;
  var w=parseFloat(document.getElementById('sg-width').value)||1;
  var col=(document.getElementById('sg-color').value||'#00ffff').trim();
  _semGridRows=Math.max(1,Math.min(100,r));
  _semGridCols=Math.max(1,Math.min(100,c));
  _semGridWidth=Math.max(0.5,Math.min(10,w));
  _semGridColor=/^#[0-9a-fA-F]{3,6}$/.test(col)?col:'#00ffff';
  _semDraw();
}
function _semGridReset(){
  _semGridRows=10;_semGridCols=10;_semGridWidth=1;_semGridColor='#00ffff';
  document.getElementById('sg-rows').value='10';
  document.getElementById('sg-cols').value='10';
  document.getElementById('sg-width').value='1';
  document.getElementById('sg-color').value='#00ffff';
  _semDraw();
}
// Close grid menu when clicking outside
document.addEventListener('click',function(e){
  var m=document.getElementById('sem-grid-menu');
  if(m&&m.style.display!=='none'&&!m.contains(e.target)){
    var arrow=m.previousElementSibling;
    if(!arrow||!arrow.contains(e.target))m.style.display='none';
  }
});

// ── Save rotation-corrected BMP ───────────────────────────────────
// Uses bilinear interpolation (ImageJ-style): for every output pixel, look up
// the source pixel via the inverse rotation, interpolate — same canvas size,
// corners filled black. nm/px is preserved because we rotate pixel data, not display.
function _semSaveRotCor(){
  if(!_semPrevObj){alert('No image open.');return;}
  if(_semRotAngle===0){alert('Rotation is 0° — nothing to correct.');return;}
  var imgEl=_semPrevObj.imgEl;
  var iw=imgEl.naturalWidth,ih=imgEl.naturalHeight;

  // Pull source pixels from a temporary canvas
  var srcC=document.createElement('canvas');srcC.width=iw;srcC.height=ih;
  var srcCtx=srcC.getContext('2d');srcCtx.drawImage(imgEl,0,0);
  var srcPx=srcCtx.getImageData(0,0,iw,ih).data;

  // Destination buffer (same dimensions — no distortion of scale)
  var dstC=document.createElement('canvas');dstC.width=iw;dstC.height=ih;
  var dstCtx=dstC.getContext('2d');
  var dstImg=dstCtx.createImageData(iw,ih);
  var dst=dstImg.data;

  // Inverse rotation angle (we map output → source)
  var r=-_semRotAngle*Math.PI/180;
  var cos=Math.cos(r),sin=Math.sin(r);
  var cx=iw/2,cy=ih/2;

  for(var y=0;y<ih;y++){
    for(var x=0;x<iw;x++){
      var dx=x-cx,dy=y-cy;
      var sx=dx*cos-dy*sin+cx;  // source x
      var sy=dx*sin+dy*cos+cy;  // source y
      var x0=Math.floor(sx),y0=Math.floor(sy);
      var x1=x0+1,y1=y0+1;
      var idx=(y*iw+x)*4;
      if(x0<0||y0<0||x1>=iw||y1>=ih){
        dst[idx]=0;dst[idx+1]=0;dst[idx+2]=0;dst[idx+3]=255;
        continue;
      }
      var fx=sx-x0,fy=sy-y0;
      var i00=(y0*iw+x0)*4,i10=(y0*iw+x1)*4,i01=(y1*iw+x0)*4,i11=(y1*iw+x1)*4;
      for(var c=0;c<3;c++){
        dst[idx+c]=Math.round(
          srcPx[i00+c]*(1-fx)*(1-fy)+srcPx[i10+c]*fx*(1-fy)+
          srcPx[i01+c]*(1-fx)*fy  +srcPx[i11+c]*fx*fy);
      }
      dst[idx+3]=255;
    }
  }
  dstCtx.putImageData(dstImg,0,0);

  // Encode as 24-bit uncompressed BMP
  var bmpBlob=_semBMPEncode(dstC);
  var origName=_semPrevObj.name.replace(/\.[^.]+$/,'');
  var saveFileName=origName+'_RotCor.bmp';

  // Store as an in-memory image entry in the current device's SEM tab
  var blobUrl=URL.createObjectURL(bmpBlob);
  if(!semImages[activeDeviceId])semImages[activeDeviceId]=[];
  semImages[activeDeviceId].push({id:semImageCounter++,name:saveFileName,url:blobUrl});
  // Brief confirmation in status bar
  var hint=document.getElementById('sem-ruler-hint');
  if(hint){var _ph=hint.textContent;hint.textContent='✓ '+saveFileName+' added to device images';setTimeout(function(){hint.textContent=_ph;},3000);}
}

// Encode a canvas as a 24-bit uncompressed BMP Blob
function _semBMPEncode(canvas){
  var w=canvas.width,h=canvas.height;
  var ctx=canvas.getContext('2d');
  var px=ctx.getImageData(0,0,w,h).data;
  var rowBytes=w*3;
  var padBytes=(4-rowBytes%4)%4; // row padding to 4-byte boundary
  var rowSize=rowBytes+padBytes;
  var pixSize=rowSize*h;
  var buf=new ArrayBuffer(54+pixSize);
  var v=new DataView(buf);
  // File header
  v.setUint8(0,0x42);v.setUint8(1,0x4D); // 'BM'
  v.setUint32(2,54+pixSize,true);
  v.setUint32(6,0,true);
  v.setUint32(10,54,true);
  // DIB header (BITMAPINFOHEADER)
  v.setUint32(14,40,true);
  v.setInt32(18,w,true);
  v.setInt32(22,h,true);   // positive = bottom-up (standard)
  v.setUint16(26,1,true);  // colour planes
  v.setUint16(28,24,true); // bits per pixel
  v.setUint32(30,0,true);  // no compression
  v.setUint32(34,pixSize,true);
  v.setInt32(38,2835,true);v.setInt32(42,2835,true); // ~72 DPI
  v.setUint32(46,0,true);v.setUint32(50,0,true);
  // Pixel data: BMP rows are bottom-up, channels are BGR
  var off=54;
  for(var y=h-1;y>=0;y--){
    for(var x=0;x<w;x++){
      var i=(y*w+x)*4;
      v.setUint8(off++,px[i+2]); // B
      v.setUint8(off++,px[i+1]); // G
      v.setUint8(off++,px[i]);   // R
    }
    for(var p=0;p<padBytes;p++)v.setUint8(off++,0);
  }
  return new Blob([buf],{type:'image/bmp'});
}

function _semFmtNm(nm){
  if(nm>=1e6)return(nm/1e6).toFixed(3)+' mm';
  if(nm>=1000)return(nm/1000).toFixed(3)+' µm';
  return nm.toFixed(1)+' nm';
}

function _semUpdateReadout(){
  var hint   =document.getElementById('sem-ruler-hint');
  var measure=document.getElementById('sem-ruler-measure');
  var pxEl   =document.getElementById('sem-ruler-px');
  var nmEl   =document.getElementById('sem-ruler-nm');
  if(!hint||!measure||!pxEl||!nmEl)return;
  if(!_semRulerPt1){
    hint.textContent='🖱 Scroll to zoom · Drag to pan · Click to set Pt 1';
    measure.style.display='none';return;
  }
  if(!_semRulerPt2){
    hint.textContent='Pt 1 set — click to set Pt 2';
    measure.style.display='none';return;
  }
  var dx=_semRulerPt2.x-_semRulerPt1.x,dy=_semRulerPt2.y-_semRulerPt1.y;
  var pxDist=Math.sqrt(dx*dx+dy*dy);
  pxEl.textContent=pxDist.toFixed(2)+' px';
  nmEl.textContent=_semFmtNm(pxDist*_semNmPerPx);
  hint.textContent='Click to start a new measurement';
  measure.style.display='flex';
}

// ── SEM preview mouse / touch handlers (registered in init) ──────

function _initSemPreviewHandlers(){
  var canvas=document.getElementById('sem-preview-canvas');
  if(!canvas)return;

  // Recompute canvas size + re-render props on window resize while preview is active
  window.addEventListener('resize',function(){
    if(_semPrevObj){_semComputeAndSetSize();_semRenderProps();}
  });

  // Keyboard: Escape clears ruler (if active); does not close the image
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&_semPrevObj){
      if(_semRulerPt1||_semRulerPt2)resetSemRuler();
    }
  });

  // Scroll: zoom around cursor
  canvas.addEventListener('wheel',function(e){
    e.preventDefault();
    if(!_semPrevObj)return;
    var rect=canvas.getBoundingClientRect();
    var cx=e.clientX-rect.left,cy=e.clientY-rect.top;
    var factor=e.deltaY>0?0.93:1.075;
    // Zoom so the canvas point under cursor stays fixed
    _semPrevPanX=cx-(cx-_semPrevPanX)*factor;
    _semPrevPanY=cy-(cy-_semPrevPanY)*factor;
    _semPrevZoom*=factor;
    _semDraw();
  },{passive:false});

  // Drag: pan
  canvas.addEventListener('mousedown',function(e){
    if(e.button!==0)return;
    _semDragActive=true;_semDragLast={x:e.clientX,y:e.clientY};_semClickMoved=false;
    canvas.style.cursor='grabbing';
  });
  window.addEventListener('mousemove',function(e){
    if(!_semPrevObj)return;
    var rect=canvas.getBoundingClientRect();
    // Live ruler preview: track cursor as pt2 while pt1 is placed but measurement not complete
    if(_semRulerPt1&&!_semRulerComplete){
      var _livePt=_semC2I_raw(e.clientX-rect.left,e.clientY-rect.top);
      _semRulerPt2=e.shiftKey?_semAxisSnap(_livePt):_livePt;
      _semUpdateReadout();
    }
    if(!_semDragActive){if(_semRulerPt1&&!_semRulerComplete)_semDraw();return;}
    var dx=e.clientX-_semDragLast.x,dy=e.clientY-_semDragLast.y;
    if(Math.abs(dx)>2||Math.abs(dy)>2)_semClickMoved=true;
    _semPrevPanX+=dx;_semPrevPanY+=dy;
    _semDragLast={x:e.clientX,y:e.clientY};
    _semDraw();
  });
  window.addEventListener('mouseup',function(){
    _semDragActive=false;
    if(canvas)canvas.style.cursor='crosshair';
  });

  // Click: two-click ruler state machine (only fires if not a drag)
  canvas.addEventListener('click',function(e){
    if(_semClickMoved||!_semPrevObj)return;
    var rect=canvas.getBoundingClientRect();
    var pt=_semC2I_raw(e.clientX-rect.left,e.clientY-rect.top);
    if(!_semRulerPt1||_semRulerComplete){
      // Start fresh measurement
      _semRulerPt1=pt;_semRulerPt2=null;_semRulerComplete=false;
    } else {
      // Lock in pt2 — Shift+click snaps to H/V axis
      _semRulerPt2=e.shiftKey?_semAxisSnap(pt):pt;
      _semRulerComplete=true;
    }
    _semUpdateReadout();
    _semDraw();
  });

  // Right-click: clear ruler
  canvas.addEventListener('contextmenu',function(e){
    e.preventDefault();
    resetSemRuler();
  });
}
