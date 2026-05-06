/*
 * interaction.js — Mouse, touch, and keyboard interaction for Tabs 1 & 2
 *
 * Owns:
 *   • Tool selection (pan, ruler, zoom-box)
 *   • Mouse/wheel/touch handlers for the GDS canvas
 *   • findDeviceAtWorld() hit-test
 *   • Zoom sensitivity panel
 *   • Sidebar drag-resize handles
 *
 * Depends on: state.js, canvas.js, renderer.js, navigation.js
 */
// ═══════════════════════════════════════════════════════════════════
// TOOL MANAGEMENT
// ═══════════════════════════════════════════════════════════════════
function setTool(tab,tool){
  if(tab===1)tool1=tool;else if(tab===2)tool2=tool;else tool3=tool;
  var prefix=tab===1?'t1':tab===2?'t2':'t3';
  ['pan','select','ruler','zoombox'].forEach(function(t){
    var el=document.getElementById(prefix+'-'+t);
    if(el)el.classList.toggle('active',t===tool);
  });
  // groupsel active state on the group button (tab1 only)
  var gb=document.getElementById('group-btn');
  if(gb&&tab===1)gb.classList.toggle('active',tool==='groupsel');

  var cursors={pan:'grab',select:'default',ruler:'crosshair',zoombox:'crosshair',groupsel:'crosshair'};
  var ac=activeCanvas();if(ac)ac.style.cursor=cursors[tool]||'default';

  rulerPt1=null;rulerPt2=null;
  zoomBoxStart=null;zoomBoxEnd=null;zoomBoxDragging=false;
  groupSelStart=null;groupSelEnd=null;groupSelDragging=false;
  document.getElementById('st-mode').textContent=tool;
  redrawActive();
}

['t1-pan','t1-select','t1-ruler','t1-zoombox'].forEach(function(id){
  document.getElementById(id).addEventListener('click',function(){setTool(1,id.replace('t1-',''));});
});
['t2-pan','t2-select','t2-ruler','t2-zoombox'].forEach(function(id){
  document.getElementById(id).addEventListener('click',function(){setTool(2,id.replace('t2-',''));});
});
document.getElementById('t1-fit').addEventListener('click',fitView);
document.getElementById('t2-fit').addEventListener('click',fitView);
document.getElementById('t1-zoomin').addEventListener('click',function(){applyZoom(2,null);});
document.getElementById('t1-zoomout').addEventListener('click',function(){applyZoom(0.5,null);});
document.getElementById('t2-zoomin').addEventListener('click',function(){applyZoom(2,null);});
document.getElementById('t2-zoomout').addEventListener('click',function(){applyZoom(0.5,null);});

// ═══════════════════════════════════════════════════════════════════
// FIND DEVICE AT WORLD COORDS
// ═══════════════════════════════════════════════════════════════════
function findDeviceAt(wx,wy){
  for(var i=devices.length-1;i>=0;i--){
    var d=devices[i];
    if(wx>=d.x0&&wx<=d.x1&&wy>=d.y0&&wy<=d.y1)return i;
  }
  return-1;
}

// ═══════════════════════════════════════════════════════════════════
// MOUSE INTERACTION
// ═══════════════════════════════════════════════════════════════════
function setupMouse(canvas,getToolFn){
  var dragging=false,lastX=0,lastY=0;

  canvas.addEventListener('dblclick',function(e){
    e.preventDefault();
    document.getElementById('file-input').click();
  });

  canvas.addEventListener('contextmenu',function(e){
    e.preventDefault();
    var rect=canvas.getBoundingClientRect();
    var mx=e.clientX-rect.left,my=e.clientY-rect.top;
    var wp=s2w(mx,my);
    var c=activeCanvas();
    panX=c.width/2-wp[0]*zoom;
    panY=c.height/2+wp[1]*zoom;
    redrawActive();
  });

  canvas.addEventListener('mousedown',function(e){
    if(e.button===2)return;
    var rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top;
    var tool=getToolFn();

    if(tool==='pan'){
      dragging=true;lastX=mx;lastY=my;
      canvas.style.cursor='grabbing';
    }
    else if(tool==='select'){
      var wp=s2w(mx,my);
      var idx=findDeviceAt(wp[0],wp[1]);
      if(idx>=0){
        var did=devices[idx].id;
        if(e.shiftKey||e.metaKey||e.ctrlKey){
          if(selectedDevices.has(did))selectedDevices.delete(did);
          else selectedDevices.add(did);
        } else {
          if(selectedDevices.size===1&&selectedDevices.has(did))selectedDevices.clear();
          else{selectedDevices.clear();selectedDevices.add(did);}
        }
      } else {
        if(!e.shiftKey&&!e.metaKey&&!e.ctrlKey)selectedDevices.clear();
      }
      redrawActive();
    }
    else if(tool==='ruler'){
      if(!rulerPt1||rulerPt2){rulerPt1=s2w(mx,my);rulerPt2=null;}
      else{rulerPt2=s2w(mx,my);}
      redrawActive();
    }
    else if(tool==='zoombox'){
      zoomBoxStart=[mx,my];zoomBoxEnd=[mx,my];zoomBoxDragging=true;
    }
    else if(tool==='groupsel'){
      groupSelStart=[mx,my];groupSelEnd=[mx,my];groupSelDragging=true;
    }
  });

  canvas.addEventListener('mousemove',function(e){
    var rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top;
    var wp=s2w(mx,my);
    document.getElementById('st-cursor').textContent=
      toUm(wp[0]).toFixed(3)+', '+toUm(wp[1]).toFixed(3)+' µm';
    var tool=getToolFn();
    if(dragging&&tool==='pan'){
      panX+=mx-lastX;panY+=my-lastY;lastX=mx;lastY=my;redrawActive();
    }
    else if(tool==='ruler'&&rulerPt1&&!rulerPt2){rulerPt2=s2w(mx,my);redrawActive();}
    else if(zoomBoxDragging){zoomBoxEnd=[mx,my];redrawActive();}
    else if(groupSelDragging){groupSelEnd=[mx,my];redrawActive();}
  });

  canvas.addEventListener('mouseup',function(e){
    var rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top;
    var tool=getToolFn();
    dragging=false;
    if(tool==='pan')canvas.style.cursor='grab';

    if(zoomBoxDragging){
      zoomBoxDragging=false;
      if(zoomBoxStart&&zoomBoxEnd){
        var isOut=zoomBoxEnd[0]<zoomBoxStart[0]&&zoomBoxEnd[1]<zoomBoxStart[1];
        if(isOut){
          zoom/=2;redrawActive();
        } else {
          var bw=Math.abs(zoomBoxEnd[0]-zoomBoxStart[0]),bh=Math.abs(zoomBoxEnd[1]-zoomBoxStart[1]);
          if(bw>10&&bh>10){
            var ww=s2w(Math.min(zoomBoxStart[0],zoomBoxEnd[0]),Math.max(zoomBoxStart[1],zoomBoxEnd[1]));
            var ww2=s2w(Math.max(zoomBoxStart[0],zoomBoxEnd[0]),Math.min(zoomBoxStart[1],zoomBoxEnd[1]));
            var dw=ww2[0]-ww[0],dh2=ww2[1]-ww[1];
            if(dw>0&&dh2>0){
              zoom=Math.min(canvas.width/dw,canvas.height/dh2)*0.9;
              var cx=(ww[0]+ww2[0])/2,cy=(ww[1]+ww2[1])/2;
              panX=canvas.width/2-cx*zoom;panY=canvas.height/2+cy*zoom;
            }
          }
        }
        zoomBoxStart=null;zoomBoxEnd=null;
        redrawActive();
      }
    }

    if(groupSelDragging){
      groupSelDragging=false;
      if(groupSelStart&&groupSelEnd){
        var bwG=Math.abs(groupSelEnd[0]-groupSelStart[0]);
        var bhG=Math.abs(groupSelEnd[1]-groupSelStart[1]);
        if(bwG>5&&bhG>5){
          finishGroupSelect(groupSelStart[0],groupSelStart[1],groupSelEnd[0],groupSelEnd[1]);
        }
        groupSelStart=null;groupSelEnd=null;
        redrawActive();
      }
    }
  });

  canvas.addEventListener('mouseleave',function(){
    dragging=false;
    if(getToolFn()==='pan')canvas.style.cursor='grab';
  });

  canvas.addEventListener('wheel',function(e){
    e.preventDefault();
    var rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top;
    var factor=(e.deltaY<0)?zoomFactor:(1/zoomFactor);
    applyZoom(factor,[mx,my]);
  },{passive:false});
}

function applyZoom(factor,pivot){
  var c=activeCanvas();
  if(!pivot)pivot=[c.width/2,c.height/2];
  var wx=s2w(pivot[0],pivot[1]);
  zoom=Math.max(1e-10,Math.min(1e8,zoom*factor));
  panX=pivot[0]-wx[0]*zoom;
  panY=pivot[1]+wx[1]*zoom;
  redrawActive();
}

// ═══════════════════════════════════════════════════════════════════
// ZOOM SENSITIVITY
// ═══════════════════════════════════════════════════════════════════
function _sliderToSens(p){return Math.pow(10,(parseFloat(p)-50)/50);}
function applyZoomSens(s){
  if(isNaN(s)||s<=0)return;
  s=Math.max(0.1,Math.min(10,s));
  zoomFactor=1+s*0.15;
  var label=s<0.15?'Barely':s<0.3?'Very Slow':s<0.6?'Slow':s<0.85?'Moderate':s<1.2?'Medium':s<3?'Fast':s<7?'Very Fast':'Extreme';
  document.querySelectorAll('.zsv-label').forEach(function(el){el.textContent=label+' '+s.toFixed(2);});
  document.querySelectorAll('.zoom-sens-num').forEach(function(el){el.value=s.toFixed(2);});
}
function toggleZoomSens(e,wrapId){
  e.stopPropagation();
  var panel=document.getElementById(wrapId).querySelector('.zoom-sens-panel');
  var was=panel.classList.contains('hidden');
  document.querySelectorAll('.zoom-sens-panel').forEach(function(p){p.classList.add('hidden');});
  if(was)panel.classList.remove('hidden');
}
document.addEventListener('click',function(){
  document.querySelectorAll('.zoom-sens-panel').forEach(function(p){p.classList.add('hidden');});
});

// ═══════════════════════════════════════════════════════════════════
// SIDEBAR RESIZE
// ═══════════════════════════════════════════════════════════════════
function makeSidebarResizeH(handleId,sidebarId,minW,maxW,rightSide){
  var handle=document.getElementById(handleId);
  var sidebar=document.getElementById(sidebarId);
  if(!handle||!sidebar)return;
  var dragging=false,startX=0,startW=0;
  handle.addEventListener('mousedown',function(e){
    dragging=true;startX=e.clientX;startW=sidebar.offsetWidth;
    handle.classList.add('dragging');e.preventDefault();
  });
  document.addEventListener('mousemove',function(e){
    if(!dragging)return;
    var delta=rightSide?(startX-e.clientX):(e.clientX-startX);
    sidebar.style.width=Math.max(minW,Math.min(maxW,startW+delta))+'px';
    redrawActive();
  });
  document.addEventListener('mouseup',function(){if(dragging){dragging=false;handle.classList.remove('dragging');}});
}
function makeSidebarResizeV(handleId,topId,minH){
  var handle=document.getElementById(handleId);
  var top=document.getElementById(topId);
  if(!handle||!top)return;
  var dragging=false,startY=0,startH=0;
  handle.addEventListener('mousedown',function(e){
    dragging=true;startY=e.clientY;startH=top.offsetHeight;
    handle.classList.add('dragging');e.preventDefault();
  });
  document.addEventListener('mousemove',function(e){
    if(!dragging)return;
    top.style.flex='none';top.style.height=Math.max(minH,startH+(e.clientY-startY))+'px';
  });
  document.addEventListener('mouseup',function(){if(dragging){dragging=false;handle.classList.remove('dragging');}});
}
