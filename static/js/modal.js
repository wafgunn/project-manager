/*
 * modal.js — Modal dialog and global keyboard shortcuts
 *
 * showModal(opts) — display a modal with title, description, optional confirm
 * closeModal()    — dismiss the current modal
 * Also registers the global keydown handler (Escape closes modal, etc.)
 *
 * Depends on: state.js
 */
// ═══════════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════════
function showModal(title,desc,result,warn){
  document.getElementById('modal-title').textContent=title;
  document.getElementById('modal-desc').textContent=desc;
  var r=document.getElementById('modal-result');
  r.style.display=result?'block':'none';
  r.textContent=result||'';
  r.className='modal-result'+(warn?' warn':'');
  document.getElementById('modal').classList.remove('hidden');
  setTimeout(function(){var b=document.querySelector('#modal .modal-btn.primary');if(b)b.focus();},50);
}
function closeModal(){document.getElementById('modal').classList.add('hidden');}

// ═══════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════════════
document.addEventListener('keydown',function(e){
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;
  if(e.key==='f'||e.key==='F'){if(currentTab===3)fitToActiveDevice();else fitView();}
  if(e.key==='+')applyZoom(2,null);
  if(e.key==='-')applyZoom(0.5,null);
  if(e.key==='Escape'){
    rulerPt1=null;rulerPt2=null;
    zoomBoxStart=null;zoomBoxEnd=null;zoomBoxDragging=false;
    groupSelStart=null;groupSelEnd=null;groupSelDragging=false;
    if(tool1==='groupsel')setTool(1,'pan');
    redrawActive();
  }
  if(e.key==='1')goTab(1);
  if(e.key==='2')goTab(2);
  if(e.key==='3')goTab(3);
});

// ═══════════════════════════════════════════════════════════════════
// WINDOW RESIZE
// ═══════════════════════════════════════════════════════════════════
window.addEventListener('resize',function(){
  resizeCanvas(canvas1);resizeCanvas(canvas2);
  if(canvas3)resizeCanvas(canvas3);
  if(currentTab===3&&dvSubTab===3)resizeOptChart();
  redrawActive();
});
