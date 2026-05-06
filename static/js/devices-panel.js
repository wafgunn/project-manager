/*
 * devices-panel.js — Right sidebar device/group list for Tab 1
 *
 * Renders detected device groups and ungrouped devices in the right
 * sidebar.  Handles group expand/collapse, rename, delete, and
 * device click-to-highlight.
 *
 * Depends on: state.js, renderer.js, gds-io.js
 */
// ═══════════════════════════════════════════════════════════════════
// DEVICES PANEL (right sidebar Tab 1)
// ═══════════════════════════════════════════════════════════════════
function updateDevicesPanel(){
  var count=devices.length;
  document.getElementById('devices-count').textContent=count;
  var cnt2=document.getElementById('devices-count-2');if(cnt2)cnt2.textContent=count;
  document.getElementById('st-devices').textContent=count;
  var list1=document.getElementById('device-list');
  var list2=document.getElementById('device-list-2');
  _buildDeviceListInto(list1);
  if(list2)_buildDeviceListInto(list2);
}

function _buildDeviceListInto(list){
  list.innerHTML='';
  var count=devices.length;
  if(!count){
    var em=document.createElement('div');em.className='no-devices';
    em.innerHTML='<span style="font-size:22px;opacity:.3;">◈</span><span>Open a GDS and click<br><strong>Find Devices</strong></span>';
    list.appendChild(em);
    return;
  }

  var dbu=lib?lib.dbunit:1e-9;
  var labelMap=buildLabelMap();

  var groupedIds=new Set();
  deviceGroups.forEach(function(g){g.devices.forEach(function(dev){groupedIds.add(dev.device_id);});});

  // ── Groups ──────────────────────────────────────────────────────
  deviceGroups.forEach(function(g){
    var section=document.createElement('div');section.className='group-section';
    var hdr=document.createElement('div');hdr.className='group-header';
    var isCollapsed=collapsedGroups.has(g.id);
    var isHidden=hiddenGroups.has(g.id);

    var chev=document.createElement('span');
    chev.className='group-chevron'+(isCollapsed?' collapsed':'');
    chev.textContent='▾';

    var nameInput=document.createElement('input');
    nameInput.className='group-name-input';
    nameInput.type='text';
    nameInput.value=g.name;
    nameInput.readOnly=true;
    nameInput.title='Right-click to rename';
    nameInput.addEventListener('blur',function(){
      var newName=(nameInput.value.trim()||g.name);
      nameInput.value=newName;nameInput.readOnly=true;nameInput.classList.remove('editing');
      if(newName!==g.name)renameDeviceGroup(g.id,newName);
      updateDevicesPanel();
    });
    nameInput.addEventListener('keydown',function(e){
      if(e.key==='Enter'){nameInput.blur();}
      if(e.key==='Escape'){nameInput.value=g.name;nameInput.blur();}
      e.stopPropagation();
    });
    nameInput.addEventListener('click',function(e){if(!nameInput.readOnly)e.stopPropagation();});

    var badge=document.createElement('span');badge.className='group-badge';
    badge.textContent=g.cols+'c×'+g.rows+'r';

    var visBtn=document.createElement('button');
    visBtn.className='group-icon-btn';visBtn.title='Hide / show on canvas';
    visBtn.textContent=isHidden?'○':'●';visBtn.style.opacity=isHidden?'0.4':'0.7';
    visBtn.addEventListener('click',function(e){
      e.stopPropagation();
      if(hiddenGroups.has(g.id)){hiddenGroups.delete(g.id);visBtn.textContent='●';visBtn.style.opacity='0.7';}
      else{hiddenGroups.add(g.id);visBtn.textContent='○';visBtn.style.opacity='0.4';}
      redrawActive();
    });

    var delBtn=document.createElement('button');delBtn.className='group-icon-btn del-btn';delBtn.title='Delete group';delBtn.textContent='✕';
    delBtn.addEventListener('click',function(e){e.stopPropagation();deleteDeviceGroup(g.id);});

    hdr.appendChild(chev);hdr.appendChild(nameInput);hdr.appendChild(badge);hdr.appendChild(visBtn);hdr.appendChild(delBtn);
    hdr.title='Right-click to rename';
    hdr.addEventListener('contextmenu',function(e){
      e.preventDefault();e.stopPropagation();
      nameInput.readOnly=false;nameInput.classList.add('editing');nameInput.focus();nameInput.select();
    });

    var body=document.createElement('div');
    body.className='group-body'+(isCollapsed?' collapsed':'');
    hdr.addEventListener('click',function(e){
      if(!nameInput.readOnly)return;
      var nowCollapsed=body.classList.toggle('collapsed');
      chev.classList.toggle('collapsed',nowCollapsed);
      if(nowCollapsed)collapsedGroups.add(g.id);else collapsedGroups.delete(g.id);
    });

    var sorted=g.devices.slice().sort(function(a,b){return a.col!==b.col?a.col-b.col:a.row-b.row;});
    sorted.forEach(function(dev){
      var d=devices.find(function(dd){return dd.id===dev.device_id;});
      if(!d)return;
      var wUm=((d.x1-d.x0)*dbu*1e6).toFixed(2);
      var hUm=((d.y1-d.y0)*dbu*1e6).toFixed(2);
      var row=document.createElement('div');row.className='device-item in-group'+(d.id===activeDeviceId?' highlighted':'');
      row.innerHTML=
        '<div class="device-swatch" style="background:'+d.color+'"></div>'+
        '<span class="device-lbl">'+dev.label+'</span>'+
        '<span class="device-dim">'+wUm+'×'+hUm+'</span>';
      row.addEventListener('click',function(){
        highlightedDevice=devices.indexOf(d);
        activeDeviceId=d.id;
        zoomToDevice(d);
        updateDevicesPanel();
        redrawActive();
        if(currentTab===3&&dvSubTab===3){autoMatchOptDevice();drawOptChart();}
      });
      body.appendChild(row);
    });

    section.appendChild(hdr);section.appendChild(body);
    list.appendChild(section);
  });

  // ── Ungrouped ───────────────────────────────────────────────────
  var ungrouped=devices.filter(function(d){return!groupedIds.has(d.id);});
  if(ungrouped.length){
    if(deviceGroups.length){
      var div=document.createElement('div');div.className='ungrouped-divider';
      div.innerHTML='<span>Ungrouped ('+ungrouped.length+')</span>';
      list.appendChild(div);
    }
    ungrouped.forEach(function(d){
      var idx=devices.indexOf(d);
      var wUm=((d.x1-d.x0)*dbu*1e6).toFixed(2);
      var hUm=((d.y1-d.y0)*dbu*1e6).toFixed(2);
      var label=labelMap[d.id]||('D'+(d.id+1));
      var item=document.createElement('div');
      item.className='device-item'+(idx===highlightedDevice?' highlighted':'');
      item.innerHTML=
        '<div class="device-swatch" style="background:'+d.color+'"></div>'+
        '<span class="device-lbl">'+label+'</span>'+
        '<span class="device-dim">'+wUm+'×'+hUm+'</span>';
      item.addEventListener('click',function(){
        highlightedDevice=idx;
        zoomToDevice(d);
        updateDevicesPanel();
        redrawActive();
      });
      list.appendChild(item);
    });
  }
}

function zoomToDevice(d){
  var c=activeCanvas();
  var dw=d.x1-d.x0,dh=d.y1-d.y0;
  if(!dw||!dh)return;
  zoom=Math.min((c.width-60)/dw,(c.height-60)/dh)*0.8;
  var cx=(d.x0+d.x1)/2,cy=(d.y0+d.y1)/2;
  panX=c.width/2-cx*zoom;
  panY=c.height/2+cy*zoom;
  redrawActive();
}
