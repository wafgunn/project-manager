/*
 * export.js — GDS export (annotated file download)
 *
 * Triggers GET /api/export-gds and downloads the resulting file.
 *
 * Depends on: state.js
 */
// ═══════════════════════════════════════════════════════════════════
// EXPORT GDS
// ═══════════════════════════════════════════════════════════════════
function exportGDS(){
  if(!devices.length){showModal('Nothing to Export','Run Find Devices first.');return;}
  window.location.href='/api/export-gds?out_layer='+exportLayer+'&out_datatype='+exportDatatype;
}

// Called by both export-settings dropdowns (Tab 1 and Tab 2)
function _applyExportSettings(){
  var li=document.getElementById('export-layer-input');
  var di=document.getElementById('export-datatype-input');
  exportLayer   = li ? (parseInt(li.value)  || 1)   : 1;
  exportDatatype= di ? (parseInt(di.value)  || 100) : 100;
  // Keep the two dropdowns in sync
  ['export-layer-input','export-layer-input-2'].forEach(function(id){
    var el=document.getElementById(id);if(el)el.value=exportLayer;
  });
  ['export-datatype-input','export-datatype-input-2'].forEach(function(id){
    var el=document.getElementById(id);if(el)el.value=exportDatatype;
  });
  // Update button labels on both tabs
  _updateExportBtnLabels();
}

function _applyExportSettings2(){
  var li=document.getElementById('export-layer-input-2');
  var di=document.getElementById('export-datatype-input-2');
  exportLayer   = li ? (parseInt(li.value)  || 1)   : 1;
  exportDatatype= di ? (parseInt(di.value)  || 100) : 100;
  _applyExportSettings(); // sync back to tab1 inputs and labels
}

function _updateExportBtnLabels(){
  var lbl=exportLayer+'/'+exportDatatype;
  ['t1-export-btn','t2-export-btn','export-footer-btn','export-footer-btn-2'].forEach(function(id){
    var el=document.getElementById(id);
    if(el)el.textContent='⬇ Export GDS ('+lbl+')';
  });
}

function _exportMenuToggle(e, menuId){
  e.stopPropagation();
  var m=document.getElementById(menuId);
  if(!m)return;
  var open=m.style.display!=='none';
  // close the other one first
  ['export-layer-menu','export-layer-menu-2'].forEach(function(id){
    if(id!==menuId){var el=document.getElementById(id);if(el)el.style.display='none';}
  });
  m.style.display=open?'none':'block';
}

// Close export menus when clicking outside
document.addEventListener('click',function(e){
  ['export-layer-menu','export-layer-menu-2'].forEach(function(mid){
    var menu=document.getElementById(mid);
    var arrow=document.getElementById(mid.replace('menu','arrow'));
    if(menu&&menu.style.display!=='none'&&!menu.contains(e.target)&&e.target!==arrow)
      menu.style.display='none';
  });
});
