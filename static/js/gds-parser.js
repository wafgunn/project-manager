/*
 * gds-parser.js — Client-side GDS-II binary file parser
 *
 * Converts a GDS-II ArrayBuffer into a JS object tree:
 *   { name, units, dbunit, cells: { cellName: { boundaries, paths, texts, refs } } }
 *
 * Pure function — no DOM or global state access.
 * Depends on: nothing
 */
// ═══════════════════════════════════════════════════════════════════
// GDS PARSER  (pure JS — client-side rendering)
// ═══════════════════════════════════════════════════════════════════
function parseGDS(buffer){
  var view=new DataView(buffer);
  var lib={name:'unknown',units:[0.001,1e-9],cells:{},dbunit:1e-9};
  var pos=0,currentCell=null,currentEl=null;
  while(pos<buffer.byteLength-3){
    var len=view.getUint16(pos);if(len<4){pos+=4;continue;}
    var recType=view.getUint8(pos+2),dataType=view.getUint8(pos+3);
    var key=(recType<<8)|dataType,dl=len-4,ds=pos+4;
    pos+=len;
    switch(key){
      case 0x0206:lib.name=rStr(view,ds,dl);break;
      case 0x0305:lib.units=[rF64(view,ds),rF64(view,ds+8)];lib.dbunit=lib.units[1];break;
      case 0x0502:currentCell={name:'cell_'+Object.keys(lib.cells).length,boundaries:[],paths:[],texts:[],refs:[]};break;
      case 0x0606:if(currentCell){currentCell.name=rStr(view,ds,dl);lib.cells[currentCell.name]=currentCell;}break;
      case 0x0700:currentCell=null;break;
      case 0x0800:currentEl={type:'boundary',layer:0,datatype:0,xy:[]};break;
      case 0x0900:currentEl={type:'path',layer:0,datatype:0,width:0,xy:[]};break;
      case 0x0C00:currentEl={type:'text',layer:0,datatype:0,xy:[],string:''};break;
      case 0x0A00:currentEl={type:'sref',sname:'',xy:[],mag:1,angle:0};break;
      case 0x0B00:currentEl={type:'aref',sname:'',xy:[],cols:1,rows:1};break;
      case 0x0D02:if(currentEl)currentEl.layer=view.getInt16(ds);break;
      case 0x0E02:if(currentEl)currentEl.datatype=view.getInt16(ds);break;
      case 0x1602:if(currentEl)currentEl.datatype=view.getInt16(ds);break;
      case 0x0F03:if(currentEl)currentEl.width=view.getInt32(ds);break;
      case 0x1003:if(currentEl){var pts=[];for(var i=0;i<dl;i+=8)pts.push([view.getInt32(ds+i),view.getInt32(ds+i+4)]);currentEl.xy=pts;}break;
      case 0x1206:if(currentEl)currentEl.sname=rStr(view,ds,dl);break;
      case 0x1302:if(currentEl){currentEl.cols=view.getUint16(ds);currentEl.rows=view.getUint16(ds+2);}break;
      case 0x1906:if(currentEl)currentEl.string=rStr(view,ds,dl);break;
      case 0x1100:if(currentEl&&currentCell){
        var t=currentEl.type;
        if(t==='boundary')currentCell.boundaries.push(currentEl);
        else if(t==='path')currentCell.paths.push(currentEl);
        else if(t==='text')currentCell.texts.push(currentEl);
        else if(t==='sref'||t==='aref')currentCell.refs.push(currentEl);
        currentEl=null;}break;
    }
  }
  return lib;
}
function rStr(v,s,l){var r='';for(var i=0;i<l;i++){var c=v.getUint8(s+i);if(!c)break;r+=String.fromCharCode(c);}return r.trim();}
function rF64(v,o){var hi=v.getUint32(o),lo=v.getUint32(o+4),sign=(hi>>31)?-1:1,exp=((hi>>24)&0x7F)-64,mant=((hi&0xFFFFFF)*0x100000000+lo)/(Math.pow(2,56));return sign*mant*Math.pow(16,exp);}
