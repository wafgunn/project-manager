/*
 * canvas.js — Canvas setup and coordinate transforms
 *
 * Sets up the two canvas elements (GDS + overlay), exposes world↔screen
 * coordinate transforms, and implements fitView().
 *
 * Depends on: state.js
 */
// ═══════════════════════════════════════════════════════════════════
// UNIT HELPERS
// ═══════════════════════════════════════════════════════════════════
function toUm(v){return v*(lib?lib.dbunit:1e-9)*1e6;}
function fmtUm(v){return toUm(v).toFixed(3)+' µm';}

// ═══════════════════════════════════════════════════════════════════
// CANVAS SETUP
// ═══════════════════════════════════════════════════════════════════
function initCanvases(){
  canvas1=document.getElementById('gds-canvas');
  ctx1=canvas1.getContext('2d');
  canvas2=document.getElementById('gds-canvas-2');
  ctx2=canvas2.getContext('2d');
  canvas3=document.getElementById('gds-canvas-3');
  if(canvas3)ctx3=canvas3.getContext('2d');
  resizeCanvas(canvas1);
  resizeCanvas(canvas2);
  if(canvas3)resizeCanvas(canvas3);
}
function resizeCanvas(c){var w=c.parentElement;if(!w)return;c.width=w.clientWidth;c.height=w.clientHeight;}
function activeCanvas(){return currentTab===1?canvas1:currentTab===2?canvas2:canvas3;}
function activeCtx(){return currentTab===1?ctx1:currentTab===2?ctx2:ctx3;}

// World ↔ screen (Y flipped: GDS +Y up, canvas +Y down)
function w2s(x,y){return[x*zoom+panX,-y*zoom+panY];}
function s2w(sx,sy){return[(sx-panX)/zoom,-(sy-panY)/zoom];}

// ═══════════════════════════════════════════════════════════════════
// FIT VIEW
// ═══════════════════════════════════════════════════════════════════
function getBBox(cell,cells,vis){
  if(!vis)vis=new Set();
  if(vis.has(cell.name))return null;vis.add(cell.name);
  var mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
  function ex(x,y){if(x<mnX)mnX=x;if(x>mxX)mxX=x;if(y<mnY)mnY=y;if(y>mxY)mxY=y;}
  cell.boundaries.forEach(function(b){b.xy.forEach(function(p){ex(p[0],p[1]);});});
  cell.paths.forEach(function(p){p.xy.forEach(function(pt){ex(pt[0],pt[1]);});});
  cell.refs.forEach(function(r){
    var s=cells[r.sname];if(!s)return;
    var bb=getBBox(s,cells,new Set(vis));if(!bb)return;
    var ox=(r.xy[0]||[0,0])[0],oy=(r.xy[0]||[0,0])[1];
    ex(bb.mnX+ox,bb.mnY+oy);ex(bb.mxX+ox,bb.mxY+oy);
  });
  if(mnX===Infinity)return{mnX:0,mnY:0,mxX:1000,mxY:1000};
  return{mnX:mnX,mnY:mnY,mxX:mxX,mxY:mxY};
}
function fitView(){
  if(!activeCell)return;
  var c=activeCanvas();
  resizeCanvas(c);   // ensure dimensions reflect current sidebar layout
  var bb=getBBox(activeCell,lib.cells);
  var W=c.width-60,H=c.height-60,cw=bb.mxX-bb.mnX,ch=bb.mxY-bb.mnY;
  if(!cw||!ch)return;
  zoom=Math.min(W/cw,H/ch);
  panX=(c.width-cw*zoom)/2-bb.mnX*zoom;
  panY=(c.height+ch*zoom)/2+bb.mnY*zoom;
  redrawActive();
}
