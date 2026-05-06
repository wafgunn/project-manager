/*
 * navigation.js — Tab and sub-tab switching
 *
 * goTab(n)         — switch main tab (1 GDS, 2 map, 3 device viewer)
 * setDvSubTab(n)   — switch device viewer sub-tab (1 overview, 2 SEM, 3 optical spectra, 4 optical readout)
 *
 * Depends on: state.js, renderer.js
 */
// ═══════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════════════════════
function goTab(n){
  var prevTab=currentTab;
  currentTab=n;
  document.querySelectorAll('.step-page').forEach(function(p,i){p.classList.toggle('active',i===n-1);});
  document.querySelectorAll('.step-tab').forEach(function(t,i){t.classList.toggle('active',i===n-1);});
  if(n===3){
    // When arriving from another tab (e.g. device map → new device selected),
    // always dismiss the SEM preview so we land on the sub-tab grid, not a
    // stale image from whichever device was previously viewed.
    if(prevTab!==3){
      var semprev=document.getElementById('dv-sub-semprev');
      if(semprev)semprev.classList.remove('active');
      _semPrevObj=null;
    }
    updateDeviceViewerHeader();
    setTimeout(function(){
      if(canvas3)resizeCanvas(canvas3);
      redraw3();
      if(activeDeviceId>=0){
        var d=devices.find(function(dd){return dd.id===activeDeviceId;});
        if(d)zoomToDevice(d);
      }
      if(dvSubTab===2)renderSemGrid();   // refresh SEM grid for the newly-selected device
      if(dvSubTab===3){resizeOptChart();autoMatchOptDevice();drawOptChart();}
      if(dvSubTab===4){autoMatchOptDevice();renderOptReadout();}
    },20);
  } else {
    // Leaving the Device Viewer — always dismiss the SEM preview overlay so it
    // cannot resurface when the user returns via the device map.
    var semprev=document.getElementById('dv-sub-semprev');
    if(semprev)semprev.classList.remove('active');
    _semPrevObj=null;
    setTimeout(function(){
      var c=activeCanvas();
      resizeCanvas(c);
      // Coming back to Device Map from Device Viewer — centre on group (or device if ungrouped)
      if(n===2&&prevTab===3&&activeDeviceId>=0&&_fitGroupBounds(c)){updateZoomLabel();}
      redrawActive();
    },20);
  }
}
