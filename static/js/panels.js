/*
 * panels.js — Layer and cell panel HTML builders (Tab 1 sidebar)
 *
 * Renders the left sidebar cell list and layer list from parsed GDS data.
 *
 * Depends on: state.js
 */
// ═══════════════════════════════════════════════════════════════════
// LAYER / CELL PANELS
// ═══════════════════════════════════════════════════════════════════
function rebuildLayerList(){
  if(!lib)return;
  var pairs={};
  Object.values(lib.cells).forEach(function(cell){
    cell.boundaries.forEach(function(b){pairs[b.layer+'/'+b.datatype]=true;});
    cell.paths.forEach(function(p){pairs[p.layer+'/'+p.datatype]=true;});
  });
  var keys=Object.keys(pairs).sort(function(a,b){
    var ap=a.split('/'),bp=b.split('/');
    var ld=parseInt(ap[0])-parseInt(bp[0]);
    return ld!==0?ld:parseInt(ap[1])-parseInt(bp[1]);
  });
  var list=document.getElementById('layer-list');list.innerHTML='';
  keys.forEach(function(k){
    var parts=k.split('/'),l=parseInt(parts[0]),dt=parseInt(parts[1]);
    getLC(l,dt);
    var div=document.createElement('div');
    div.className='layer-item'+(hiddenLayers.has(k)?' hidden':'');
    div.innerHTML='<div class="layer-swatch" style="background:'+getLC(l,dt)+'"></div><span class="layer-name" style="flex:1">'+k+'</span>';
    div.addEventListener('click',function(){
      if(hiddenLayers.has(k)){hiddenLayers.delete(k);div.classList.remove('hidden');}
      else{hiddenLayers.add(k);div.classList.add('hidden');}
      redrawActive();
    });
    list.appendChild(div);
  });
  document.getElementById('st-layers').textContent=keys.length;
}

function rebuildCellList(cells,active){
  var list=document.getElementById('cell-list');list.innerHTML='';
  cells.forEach(function(name){
    var div=document.createElement('div');div.className='cell-item'+(name===active?' active':'');
    div.textContent=name;
    div.addEventListener('click',function(){activateCell(name);});
    list.appendChild(div);
  });
}
function activateCell(name){
  activeCell=lib.cells[name];
  renderCacheDirty=true;
  document.querySelectorAll('.cell-item').forEach(function(el){
    el.classList.toggle('active',el.textContent===name);
  });
  document.getElementById('st-cell').textContent=name;
  fitView();
}
