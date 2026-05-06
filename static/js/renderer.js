/*
 * renderer.js — GDS canvas rendering and overlay drawing
 *
 * Owns the render cache (flat list of visible shapes) and all draw*()
 * functions.  Also draws Tab 2 (device map), bounding-box overlays,
 * the ruler, zoom-box, and group-select rectangle.
 *
 * Depends on: state.js, canvas.js
 */
// ═══════════════════════════════════════════════════════════════════
// RENDER CACHE  (flat list of all visible shapes)
// ═══════════════════════════════════════════════════════════════════
function buildRenderCache(){
  renderCache=[];
  if(!activeCell||!lib)return;
  flattenCell(activeCell,lib.cells,0,0,new Set());
  renderCacheDirty=false;
}
function flattenCell(cell,cells,tx,ty,vis){
  if(!cell||vis.has(cell.name))return;
  vis=new Set(vis);vis.add(cell.name);
  var i,b,p,t,r,sub,ox,oy;
  for(i=0;i<cell.boundaries.length;i++){
    b=cell.boundaries[i];if(b.xy.length<3)continue;
    var pts=b.xy,wxmin=Infinity,wxmax=-Infinity,wymin=Infinity,wymax=-Infinity;
    var sh=new Array(pts.length);
    for(var j=0;j<pts.length;j++){
      var wx=pts[j][0]+tx,wy=pts[j][1]+ty;sh[j]=[wx,wy];
      if(wx<wxmin)wxmin=wx;if(wx>wxmax)wxmax=wx;if(wy<wymin)wymin=wy;if(wy>wymax)wymax=wy;
    }
    renderCache.push({type:'poly',layer:b.layer,datatype:b.datatype,xy:sh,wxmin:wxmin,wxmax:wxmax,wymin:wymin,wymax:wymax});
  }
  for(i=0;i<cell.paths.length;i++){
    p=cell.paths[i];if(p.xy.length<2)continue;
    var pts2=p.xy,wxmin2=Infinity,wxmax2=-Infinity,wymin2=Infinity,wymax2=-Infinity;
    var sh2=new Array(pts2.length);
    for(var j2=0;j2<pts2.length;j2++){
      var wx2=pts2[j2][0]+tx,wy2=pts2[j2][1]+ty;sh2[j2]=[wx2,wy2];
      if(wx2<wxmin2)wxmin2=wx2;if(wx2>wxmax2)wxmax2=wx2;if(wy2<wymin2)wymin2=wy2;if(wy2>wymax2)wymax2=wy2;
    }
    renderCache.push({type:'path',layer:p.layer,datatype:p.datatype,xy:sh2,width:p.width||0,wxmin:wxmin2,wxmax:wxmax2,wymin:wymin2,wymax:wymax2});
  }
  for(i=0;i<cell.texts.length;i++){
    t=cell.texts[i];if(!t.xy.length)continue;
    renderCache.push({type:'text',layer:t.layer,datatype:t.datatype||0,str:t.string,wx:t.xy[0][0]+tx,wy:t.xy[0][1]+ty});
  }
  for(i=0;i<cell.refs.length;i++){
    r=cell.refs[i];sub=cells[r.sname];if(!sub)continue;
    if(r.type==='sref'&&r.xy.length){ox=r.xy[0][0];oy=r.xy[0][1];flattenCell(sub,cells,tx+ox,ty+oy,vis);}
    else if(r.type==='aref'&&r.xy.length>=3){
      var cols=Math.max(r.cols||1,1),rows=Math.max(r.rows||1,1);
      ox=r.xy[0][0];oy=r.xy[0][1];
      var cdx=(r.xy[1][0]-ox)/cols,cdy=(r.xy[1][1]-oy)/cols;
      var rdx=(r.xy[2][0]-ox)/rows,rdy=(r.xy[2][1]-oy)/rows;
      for(var ci=0;ci<cols;ci++)for(var ri=0;ri<rows;ri++){
        var ax=Math.round(tx+ox+ci*cdx+ri*rdx),ay=Math.round(ty+oy+ci*cdy+ri*rdy);
        flattenCell(sub,cells,ax,ay,vis);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// DRAW
// ═══════════════════════════════════════════════════════════════════
var RAF1=0,RAF2=0;
function redrawActive(){if(currentTab===1)redraw1();else if(currentTab===2)redraw2();else redraw3();}
function redraw1(){
  cancelAnimationFrame(RAF1);
  RAF1=requestAnimationFrame(function(){
    resizeCanvas(canvas1);
    ctx1.clearRect(0,0,canvas1.width,canvas1.height);
    ctx1.fillStyle='#0a0c10';ctx1.fillRect(0,0,canvas1.width,canvas1.height);
    if(!activeCell)return;
    drawGrid(ctx1,canvas1);
    drawCached(ctx1,canvas1.width,canvas1.height);
    drawDeviceOverlays(ctx1);
    if(tool1==='ruler')drawRuler(ctx1);
    if(tool1==='zoombox')drawZoomBox(ctx1);
    if(tool1==='groupsel')drawGroupSelRect(ctx1);
    updateZoomLabel();
  });
}
function redraw2(){
  cancelAnimationFrame(RAF2);
  RAF2=requestAnimationFrame(function(){
    resizeCanvas(canvas2);
    ctx2.clearRect(0,0,canvas2.width,canvas2.height);
    ctx2.fillStyle='#0a0c10';ctx2.fillRect(0,0,canvas2.width,canvas2.height);
    if(!activeCell)return;
    drawGrid(ctx2,canvas2);
    drawCached(ctx2,canvas2.width,canvas2.height);
    drawDeviceMapSolid(ctx2);      // solid coloured boxes hide GDS within bbox
    if(tool2==='ruler')drawRuler(ctx2);
    if(tool2==='zoombox')drawZoomBox(ctx2);
    updateZoomLabel();
  });
}

function drawGrid(c2,c){
  var step=1000,ss=step*zoom;if(ss<8)return;
  c2.strokeStyle='#21262d';c2.lineWidth=0.5;
  for(var x=((panX%ss)+ss)%ss;x<c.width;x+=ss){c2.beginPath();c2.moveTo(x,0);c2.lineTo(x,c.height);c2.stroke();}
  for(var y=((panY%ss)+ss)%ss;y<c.height;y+=ss){c2.beginPath();c2.moveTo(0,y);c2.lineTo(c.width,y);c2.stroke();}
}

function drawCached(c2,cw,ch){
  if(renderCacheDirty)buildRenderCache();
  if(!renderCache.length)return;
  var vx0=(0-panX)/zoom,vy1=-(0-panY)/zoom;
  var vx1=(cw-panX)/zoom,vy0=-(ch-panY)/zoom;
  var doFill=zoom>0.0001,lw=Math.max(0.5,zoom*0.25);
  for(var i=0;i<renderCache.length;i++){
    var rec=renderCache[i];
    var lk=rec.layer+'/'+rec.datatype;
    if(hiddenLayers.has(lk))continue;
    if(rec.type==='text'){
      var fs=Math.max(8,Math.min(20,zoom*2.5));
      var sp=w2s(rec.wx,rec.wy);
      if(sp[0]<-50||sp[0]>cw+50||sp[1]<-50||sp[1]>ch+50)continue;
      c2.font=fs+'px monospace';c2.fillStyle='#c9d1d9aa';c2.fillText(rec.str,sp[0],sp[1]);
      continue;
    }
    if(rec.wxmax<vx0||rec.wxmin>vx1||rec.wymax<vy0||rec.wymin>vy1)continue;
    var sw=(rec.wxmax-rec.wxmin)*zoom,sh=(rec.wymax-rec.wymin)*zoom;
    if(Math.sqrt(sw*sw+sh*sh)<1.5)continue;
    var col=getLC(rec.layer,rec.datatype);
    var pts=rec.xy;
    if(rec.type==='poly'){
      c2.beginPath();
      var p0=w2s(pts[0][0],pts[0][1]);c2.moveTo(p0[0],p0[1]);
      for(var j=1;j<pts.length;j++){var pj=w2s(pts[j][0],pts[j][1]);c2.lineTo(pj[0],pj[1]);}
      c2.closePath();
      if(doFill){c2.fillStyle=col+'28';c2.fill();}
      c2.strokeStyle=col;c2.lineWidth=lw;c2.stroke();
    } else if(rec.type==='path'){
      c2.beginPath();
      var p0b=w2s(pts[0][0],pts[0][1]);c2.moveTo(p0b[0],p0b[1]);
      for(var jj=1;jj<pts.length;jj++){var pjj=w2s(pts[jj][0],pts[jj][1]);c2.lineTo(pjj[0],pjj[1]);}
      c2.strokeStyle=col;c2.lineWidth=Math.max(1,(rec.width||1)*zoom);c2.stroke();
    }
  }
}

// ── Build label map from groups ───────────────────────────────────
function buildLabelMap(){
  var map={};
  deviceGroups.forEach(function(g){
    g.devices.forEach(function(dev){map[dev.device_id]=dev.label;});
  });
  return map;
}

// ── Build set of device IDs that belong to hidden groups ──────────
function buildHiddenDeviceIds(){
  var s=new Set();
  deviceGroups.forEach(function(g){
    if(hiddenGroups.has(g.id))g.devices.forEach(function(dev){s.add(dev.device_id);});
  });
  return s;
}

// ── Group → colour map (same colour for every device in a group) ──
function buildGroupColorMap(){
  var map={};
  deviceGroups.forEach(function(g,gi){
    var col=DEV_COLS[gi%DEV_COLS.length];
    g.devices.forEach(function(dev){map[dev.device_id]=col;});
  });
  devices.forEach(function(d){if(!(d.id in map))map[d.id]=d.color||devColor(d.id);});
  return map;
}

// ── Tab 2: solid-fill boxes painted over the GDS ─────────────────
function drawDeviceMapSolid(c2){
  if(!devices.length)return;
  _mapBadgeHits=[];
  var colorMap=buildGroupColorMap();
  var hiddenIds=buildHiddenDeviceIds();
  var labelMap=buildLabelMap();
  var cw=canvas2.width,ch=canvas2.height;
  for(var i=0;i<devices.length;i++){
    var d=devices[i];
    if(hiddenIds.has(d.id))continue;
    var sx=d.x0*zoom+panX, sy=-d.y1*zoom+panY;
    var sw=(d.x1-d.x0)*zoom, shh=(d.y1-d.y0)*zoom;
    if(sw<1&&shh<1)continue;
    if(sx+sw<0||sx>cw||sy+shh<0||sy>ch)continue;
    var col=colorMap[d.id]||d.color;
    var isAct=(d.id===activeDeviceId);
    // Opaque fill — hides GDS geometry underneath
    c2.fillStyle=col+'cc';
    c2.fillRect(sx,sy,sw,shh);
    // Border
    c2.strokeStyle=isAct?'#ffffff':col;
    c2.lineWidth=isAct?2.5:1.5;
    c2.setLineDash([]);
    c2.strokeRect(sx,sy,sw,shh);
    // Label (top-left)
    var label=labelMap[d.id]||('D'+(d.id+1));
    var fs=Math.max(8,Math.min(14,sw/6,shh/2.5));
    var labelBoxW=0;
    if(fs>=8&&sw>30&&shh>14){
      c2.font='bold '+fs+'px monospace';
      var tw=c2.measureText(label).width;
      labelBoxW=tw+8; // reserve this width so badges don't overlap
      c2.fillStyle='#00000099';
      c2.fillRect(sx+2,sy+2,tw+6,fs+4);
      c2.fillStyle='#ffffff';
      c2.fillText(label,sx+5,sy+fs+3);
    }
    // ── SEM / OD availability badges (top-right & bottom-right) ──────────────
    if(sw>=46&&shh>=28){
      var bfs=Math.max(6,Math.min(9,sw/10,shh/5));
      var bpad=3;
      var bdh=Math.round(bfs+bpad*2);
      var dotR=Math.max(2,bfs*0.4);
      var hasSEM=_deviceHasSEM(d.id,labelMap);
      var hasOD=_deviceHasOD(d.id,labelMap);
      c2.save();
      c2.font=bfs+'px monospace';
      c2.textBaseline='middle';
      // Badge widths (capped to half the box so they can't crowd the label)
      var maxBW=Math.floor(sw/2)-4;
      var semBW=Math.min(Math.round(dotR*2+5+c2.measureText('SEM').width+5),maxBW);
      var odBW=Math.min(Math.round(dotR*2+5+c2.measureText('OD').width+5),maxBW);
      // ── SEM badge (top-right) ──
      var semBX=Math.floor(sx+sw-semBW-2);
      var semBY=Math.floor(sy+2);
      // Only draw if it doesn't overlap the label box
      if(semBX>sx+labelBoxW+2){
        c2.fillStyle=hasSEM?'#0d1117cc':'#0d111750';
        c2.fillRect(semBX,semBY,semBW,bdh);
        c2.fillStyle=hasSEM?'#3fb950':'#484f58';
        c2.beginPath();c2.arc(semBX+dotR+2,semBY+bdh/2,dotR,0,Math.PI*2);c2.fill();
        c2.fillStyle=hasSEM?'#e6edf3':'#484f5888';
        c2.fillText('SEM',semBX+dotR*2+5,semBY+bdh/2);
        _mapBadgeHits.push({deviceId:d.id,subTab:2,x:semBX,y:semBY,w:semBW,h:bdh});
      }
      // ── OD badge (bottom-right) ──
      var odBX=Math.floor(sx+sw-odBW-2);
      var odBY=Math.floor(sy+shh-bdh-2);
      if(odBY>semBY+bdh+2){  // only if it doesn't overlap the SEM badge
        c2.fillStyle=hasOD?'#0d1117cc':'#0d111750';
        c2.fillRect(odBX,odBY,odBW,bdh);
        c2.fillStyle=hasOD?'#3fb950':'#484f58';
        c2.beginPath();c2.arc(odBX+dotR+2,odBY+bdh/2,dotR,0,Math.PI*2);c2.fill();
        c2.fillStyle=hasOD?'#e6edf3':'#484f5888';
        c2.fillText('OD',odBX+dotR*2+5,odBY+bdh/2);
        _mapBadgeHits.push({deviceId:d.id,subTab:3,x:odBX,y:odBY,w:odBW,h:bdh});
      }
      c2.restore();
    }
  }
}

// ── Device bounding-box overlays ──────────────────────────────────
function drawDeviceOverlays(c2){
  if(!devices.length)return;
  var labelMap=buildLabelMap();
  var hiddenIds=buildHiddenDeviceIds();
  var cw=c2.canvas?c2.canvas.width:(currentTab===1?canvas1.width:canvas2.width);
  var ch=c2.canvas?c2.canvas.height:(currentTab===1?canvas1.height:canvas2.height);
  for(var i=0;i<devices.length;i++){
    var d=devices[i];
    if(hiddenIds.has(d.id))continue;
    var sx=d.x0*zoom+panX;
    var sy=-d.y1*zoom+panY;
    var sw=(d.x1-d.x0)*zoom;
    var sh=(d.y1-d.y0)*zoom;
    if(sw<1&&sh<1)continue;
    // Cull offscreen
    if(sx+sw<0||sx>cw||sy+sh<0||sy>ch)continue;

    var col=d.color||devColor(i);
    var hl=(i===highlightedDevice);
    var sel=selectedDevices.has(d.id);
    var strokeCol=sel?'#e3b341':col;

    c2.strokeStyle=strokeCol;
    c2.lineWidth=sel?2.5:hl?2.5:1.5;
    c2.setLineDash((sel||hl)?[]:[6,3]);
    c2.strokeRect(sx,sy,sw,sh);
    c2.setLineDash([]);
    c2.fillStyle=sel?'#e3b34120':col+(hl?'22':'10');
    c2.fillRect(sx,sy,sw,sh);

    // Corner ticks for selected
    if(sel){
      var tickLen=Math.min(8,sw/4,sh/4);
      c2.strokeStyle='#e3b341';c2.lineWidth=2;
      c2.beginPath();c2.moveTo(sx,sy+tickLen);c2.lineTo(sx,sy);c2.lineTo(sx+tickLen,sy);c2.stroke();
      c2.beginPath();c2.moveTo(sx+sw-tickLen,sy);c2.lineTo(sx+sw,sy);c2.lineTo(sx+sw,sy+tickLen);c2.stroke();
      c2.beginPath();c2.moveTo(sx,sy+sh-tickLen);c2.lineTo(sx,sy+sh);c2.lineTo(sx+tickLen,sy+sh);c2.stroke();
      c2.beginPath();c2.moveTo(sx+sw-tickLen,sy+sh);c2.lineTo(sx+sw,sy+sh);c2.lineTo(sx+sw,sy+sh-tickLen);c2.stroke();
    }

    // Label
    var label=labelMap[d.id]||('D'+(d.id+1));
    var fs=Math.max(9,Math.min(15,sw/5,sh/2));
    if(fs<7)continue;
    c2.font='bold '+fs+'px monospace';
    var tw=c2.measureText(label).width;
    c2.fillStyle='#0a0c10cc';
    c2.fillRect(sx+2,sy+2,tw+6,fs+4);
    c2.fillStyle=sel?'#e3b341':strokeCol;
    c2.fillText(label,sx+5,sy+fs+3);
  }
}

// ── Ruler overlay ─────────────────────────────────────────────────
function drawRuler(c2){
  if(!rulerPt1)return;
  var s1=w2s(rulerPt1[0],rulerPt1[1]);
  c2.beginPath();c2.arc(s1[0],s1[1],4,0,Math.PI*2);c2.fillStyle='#f0e68c';c2.fill();
  if(!rulerPt2)return;
  var s2=w2s(rulerPt2[0],rulerPt2[1]);
  c2.strokeStyle='#f0e68c';c2.lineWidth=1.5;c2.setLineDash([5,4]);
  c2.beginPath();c2.moveTo(s1[0],s1[1]);c2.lineTo(s2[0],s2[1]);c2.stroke();c2.setLineDash([]);
  c2.beginPath();c2.arc(s2[0],s2[1],4,0,Math.PI*2);c2.fillStyle='#f0e68c';c2.fill();
  var dx=rulerPt2[0]-rulerPt1[0],dy=rulerPt2[1]-rulerPt1[1];
  var um=(Math.sqrt(dx*dx+dy*dy)*(lib?lib.dbunit:1e-9)*1e6).toFixed(3)+' µm';
  var mx=(s1[0]+s2[0])/2,my=(s1[1]+s2[1])/2;
  c2.font='bold 12px monospace';
  var tw=c2.measureText(um).width;
  c2.fillStyle='#00000099';c2.fillRect(mx-tw/2-4,my-18,tw+8,20);
  c2.fillStyle='#f0e68c';c2.fillText(um,mx-tw/2,my-4);
}

// ── Zoom-box overlay ──────────────────────────────────────────────
function drawZoomBox(c2){
  if(!zoomBoxStart||!zoomBoxEnd)return;
  var x=Math.min(zoomBoxStart[0],zoomBoxEnd[0]),y=Math.min(zoomBoxStart[1],zoomBoxEnd[1]);
  var bw=Math.abs(zoomBoxEnd[0]-zoomBoxStart[0]),bh=Math.abs(zoomBoxEnd[1]-zoomBoxStart[1]);
  var isOut=zoomBoxEnd[0]<zoomBoxStart[0]&&zoomBoxEnd[1]<zoomBoxStart[1];
  var col=isOut?'#ff9f4a':'#58a6ff';
  c2.strokeStyle=col;c2.lineWidth=1.5;c2.setLineDash([5,3]);
  c2.strokeRect(x,y,bw,bh);c2.setLineDash([]);
  c2.fillStyle=col+'18';c2.fillRect(x,y,bw,bh);
  c2.font='10px monospace';c2.fillStyle=col;
  c2.fillText(isOut?'zoom out':'zoom in',x+4,y-4);
}

// ── Group-select rectangle overlay ────────────────────────────────
function drawGroupSelRect(c2){
  if(!groupSelStart||!groupSelEnd)return;
  var x=Math.min(groupSelStart[0],groupSelEnd[0]),y=Math.min(groupSelStart[1],groupSelEnd[1]);
  var bw=Math.abs(groupSelEnd[0]-groupSelStart[0]),bh=Math.abs(groupSelEnd[1]-groupSelStart[1]);
  c2.strokeStyle='#3fb950';c2.lineWidth=1.5;c2.setLineDash([5,3]);
  c2.strokeRect(x,y,bw,bh);c2.setLineDash([]);
  c2.fillStyle='#3fb95018';c2.fillRect(x,y,bw,bh);
  c2.font='10px monospace';c2.fillStyle='#3fb950';
  c2.fillText('Group selection',x+4,y>14?y-4:y+bh+12);
}

function updateZoomLabel(){
  var info=zoom<10?zoom.toFixed(3):zoom.toFixed(1);
  document.getElementById('zoom-info-1').textContent='zoom: '+info+'×';
  document.getElementById('zoom-info-2').textContent='zoom: '+info+'×';
  var z3=document.getElementById('zoom-info-3');if(z3)z3.textContent='zoom: '+info+'×';
}
