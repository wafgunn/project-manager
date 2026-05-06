/*
 * state.js — Global application state variables
 *
 * All mutable application state lives here so that every other module
 * can find it in one place.  No functions — just var declarations.
 *
 * Load order: must be first script after gds-parser.js
 * Depends on: nothing
 */
// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════
var lib=null, activeCell=null, rawBuffer=null;
var hiddenLayers=new Set();
var currentTab=1;
var panX=0,panY=0,zoom=1;
var zoomFactor=1.15;
var renderCache=[],renderCacheDirty=true;

// Devices: [{id,x0,y0,x1,y1,x0_um,y0_um,x1_um,y1_um,color}]
var devices=[];
// Groups: [{id,name,cols,rows,colPad,rowPad,devices:[{device_id,col,row,label}]}]
var deviceGroups=[];
var selectedDevices=new Set();  // device ids selected via Select tool
var highlightedDevice=-1;
var nextGroupLetter=0;   // 0=A,1=B,...
var nextGroupId=0;
var collapsedGroups=new Set(); // group ids whose panel body is collapsed
var hiddenGroups=new Set();    // group ids hidden from canvas

// ── Tab 3 state ───────────────────────────────────────────────────
var activeDeviceId=-1;
var dvSubTab=1;
var semImages={};          // {device_id:[{id,name,url}]} — manual uploads
var semImageCounter=0;
var semDirFiles=[];        // [{name,url}] all .bmp files from picked directory
var semServerPath='';      // server-side absolute path to SEM directory (for auto-reload)
var projectPath='';        // server-side absolute path to the .gdspm project file
var _semDirHandle=null;    // FileSystemDirectoryHandle for write-back saves
// SEM preview / ruler state
var _semPrevObj=null;      // {url,name,imgEl} for the image currently in preview
var _semPrevZoom=1,_semPrevPanX=0,_semPrevPanY=0;
var _semRotAngle=0;        // display rotation in degrees
var _semGridOn=false,_semGridRows=10,_semGridCols=10,_semGridWidth=1,_semGridColor='#00ffff';
var _semRulerPt1=null,_semRulerPt2=null,_semRulerComplete=false; // ruler state
var _semNmPerPx=1.0;       // calibration: nanometres per image pixel
var _semDragActive=false,_semDragLast=null;
var _semClickMoved=false;  // distinguish click from drag-end
// Optical data (scan-then-click-to-load model)
var optFiles=[];           // all browser-picked files
var optFileMap={};         // {deviceKey:[file,...]} grouped by device key
var optServerPath='';      // server-side directory path
var optDevices=[];         // [{key,label}] found by scan
var optCurrentKey=null;    // key of device currently charted
var optCache={};           // {key:curves[]} lazy-loaded cache
var optTargetWL=1550.0;    // target wavelength for marker + readout
var hiddenCurves=new Set();// curve labels toggled off in legend
var optViewXMin=null,optViewXMax=null,optViewYMin=null,optViewYMax=null; // null=auto-range
var _optDragMode=null,_optDragStart=null,_optDragEnd=null; // zoom/pan drag state
var optSubtract=false;     // whether to subtract Ref (1→6) from all curves
var _subCache={};          // key → subtracted curves (invalidated when raw cache changes)
var _optTool='pan';        // active tool: 'pan' | 'zoombox'
var optWLStep=0.001;       // wavelength step derived from loaded data (nm)
var _optNearTWL=false;     // mouse is hovering near the target-WL marker
var _c2DownX=0,_c2DownY=0; // canvas2 click-vs-drag tracking
var _mapBadgeHits=[];      // [{deviceId,subTab,x,y,w,h}] — rebuilt each drawDeviceMapSolid call

// Export layer settings (written by the dropdown, read by exportGDS)
var exportLayer=1, exportDatatype=100;

// Canvas refs
var canvas1=null,ctx1=null,canvas2=null,ctx2=null,canvas3=null,ctx3=null;
var RAF3=0;

// Tools
var tool1='pan',tool2='pan',tool3='pan';

// Ruler / zoom-box state
var rulerPt1=null,rulerPt2=null;
var zoomBoxStart=null,zoomBoxEnd=null,zoomBoxDragging=false;

// Group-select state
var groupSelStart=null,groupSelEnd=null,groupSelDragging=false;

// Color palettes
var LPAL=['#3fb950','#58a6ff','#ff7b72','#e3b341','#bc8cff','#79c0ff','#ffa657','#ff6e96','#a5f3fc','#4ade80','#facc15'];
var DEV_COLS=['#58a6ff','#3fb950','#ff7b72','#e3b341','#bc8cff','#ffa657','#79c0ff','#ff6e96','#a5f3fc','#4ade80'];
var layerColors={},layerColorIdx=0;
function getLC(l,dt){var k=l+'/'+dt;if(!layerColors[k])layerColors[k]=LPAL[layerColorIdx++%LPAL.length];return layerColors[k];}
function devColor(i){return DEV_COLS[i%DEV_COLS.length];}
