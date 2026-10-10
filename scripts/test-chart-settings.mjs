import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { getExportDimensions, getExportLayout, normalizeExportSettings, normalizeAxisRange, normalizeAxisPresets, getLegendOrigin, formatEditableValue } from "../src/chartSettings.js";
import { getExportPngDataUrl } from "../src/chartExport.js";

assert.equal(getExportDimensions({resolution:"original"}), null);
assert.deepEqual(getExportDimensions({resolution:"1080p"}), {width:1920,height:1080});
assert.deepEqual(getExportDimensions({resolution:"4k"}), {width:3840,height:2160});
assert.deepEqual(getExportDimensions({resolution:"custom",width:2500,height:1600}), {width:2500,height:1600});
assert.deepEqual(normalizeExportSettings({resolution:"invalid",width:9000,height:10}), {resolution:"original",width:8192,height:320});
for (const dimensions of [{width:1920,height:1080},{width:3840,height:2160},{width:2500,height:1600}]) {
  for (const summary of [0,116]) {
    const layout=getExportLayout(dimensions,summary);
    assert.equal(layout.width*layout.dpr,dimensions.width);
    assert(Math.abs((layout.height+summary)*layout.dpr-dimensions.height)<0.0001);
  }
}
assert.throws(()=>getExportLayout({width:8192,height:320},116),/图片高度不足/);
assert.deepEqual(normalizeAxisRange({minFreq:"20",maxFreq:"20000",minDb:"",maxDb:""}),{minFreq:20,maxFreq:20000,minDb:null,maxDb:null});
const fixed={minFreq:20,maxFreq:20000,minDb:60,maxDb:120};
assert.deepEqual(normalizeAxisRange(fixed),fixed);
for (const invalid of [{...fixed,minFreq:0},{...fixed,maxFreq:20},{...fixed,minDb:120},{...fixed,maxDb:""},{...fixed,minDb:"oops"}]) assert.throws(()=>normalizeAxisRange(invalid));
const presets=normalizeAxisPresets([{name:"耳机",...fixed},{name:"bad",...fixed,maxDb:0},{name:"耳机",...fixed,maxDb:125},{name:"<b>名称</b>",...fixed}]);
assert.equal(presets.length,2);assert.equal(presets[0].maxDb,125);
assert.deepEqual(normalizeAxisPresets(JSON.parse(JSON.stringify(presets))),presets);

const geometry={pad:{left:62,top:28},plotW:1100,plotH:600,boxWidth:180,boxHeight:48,scale:4/3};
const tl=getLegendOrigin({...geometry,position:"top-left"});
const tr=getLegendOrigin({...geometry,position:"top-right"});
const bl=getLegendOrigin({...geometry,position:"bottom-left"});
const br=getLegendOrigin({...geometry,position:"bottom-right"});
assert.equal(tl.x,bl.x);assert.equal(tr.x,br.x);assert.equal(tl.y,tr.y);assert.equal(bl.y,br.y);
assert(tr.x>tl.x && bl.y>tl.y);
assert.equal(tr.x+geometry.boxWidth,geometry.pad.left+geometry.plotW-10);

// Exercise the actual PNG composition helper: exact sizes, summaries, opacity,
// and transparency, while recording its canvas drawing calls.
function fakeCanvas(width=1,height=1) {
  const calls=[];
  const ctx=new Proxy({measureText:text=>({width:String(text).length*8})},{get:(object,key)=>key in object?object[key]:(...args)=>calls.push([key,...args])});
  return {width,height,calls,getContext:()=>ctx,getBoundingClientRect:()=>({width:1280,height:720})};
}
function makeCanvas(width=1,height=1) {
  const result=fakeCanvas(width,height);
  result.toDataURL=()=>JSON.stringify({width:result.width,height:result.height});
  return result;
}
const created=[];
globalThis.document={createElement:tag=>{assert.equal(tag,"canvas");const result=makeCanvas();created.push(result);return result;}};
for (const dimensions of [{width:1920,height:1080},{width:3840,height:2160},{width:2500,height:1600}]) {
  for (const transparent of [false,true]) for (const summary of [false,true]) {
    created.length=0;
    const layout=getExportLayout(dimensions,summary?116:0);
    const source=makeCanvas(Math.floor(layout.width*layout.dpr),Math.floor(layout.height*layout.dpr));
    const output=getExportPngDataUrl({canvas:source,targetSize:dimensions,transparent,state:{showBandIndicator:false,exportDeviationSummary:summary},chartView:{},getCanvasDpr:()=>layout.dpr,getExportSummaryTitle:()=>"分析",getExportSummaryItems:()=>[],frequencyBands:[]});
    assert.deepEqual(JSON.parse(output),dimensions);
    assert.equal(created[0].calls.some(call=>call[0]==="fillRect" && call[1]===0 && call[2]===0),!transparent);
    assert(created[0].calls.some(call=>call[0]==="drawImage" && call[1]===source));
  }
}
delete globalThis.document;

// The production legend and axis functions must consume the new settings.
const source=fs.readFileSync(fileURLToPath(new URL("../app.js",import.meta.url)),"utf8");
function functionSource(name) {
  const start=source.indexOf("function "+name+"(");
  const end=source.indexOf("\nfunction ",start+1);
  assert(start>=0);
  return source.slice(start,end<0?source.length:end);
}
const context={workspaceTools:null,compareOriginalActive:false,state:{appearance:{hideLegendSuffix:false},curves:[],mode:"raw"},displayData:curve=>curve.data,transformedData:curve=>curve.data,getVisibleIndexRange:data=>({start:0,end:data.length}),getRangeSampleStride:()=>1,optionalNumber:value=>value==null?null:Number(value)};
vm.createContext(context);
vm.runInContext(functionSource("legendCurveName")+"\n"+functionSource("getLegendItems")+"\n"+functionSource("getVisibleSeries")+"\n"+functionSource("getDbRange"),context);
context.series=[{name:"import.txt",legendName:"耳机 A",phaseSeries:[{id:"phase",label:"相位",dash:[2,2]}]}];
assert.equal(vm.runInContext("getLegendItems(series)[0].label",context),"耳机 A");
assert.equal(vm.runInContext("getLegendItems(series)[1].label",context),"耳机 A - 相位");
context.series[0].legendName="   ";
assert.equal(vm.runInContext("getLegendItems(series)[0].label",context),"import.txt");
context.state.curves=[{visible:true,data:[{frequency:20,level:70},{frequency:20000,level:90}]},{visible:true,data:[{frequency:20,level:95},{frequency:20000,level:115}]}];
const range=vm.runInContext("getDbRange(getVisibleSeries(true),20,20000)",context);
context.state.curves[1].visible=false;
assert.deepEqual(vm.runInContext("getDbRange(getVisibleSeries(true),20,20000)",context),range);
context.state.axisMinDb=55;context.state.axisMaxDb=125;
assert.equal(vm.runInContext("getDbRange(getVisibleSeries(true),20,20000).maxDb",context),125);

// Execute production control handlers, including save/update/load/delete and
// validation failures. Values are persisted in the same format used by the app.
const elements=new Map();
const element=id=>{
  if (!elements.has(id)) elements.set(id,{value:"",listeners:{},textContent:"",addEventListener(name,callback){this.listeners[name]=callback;},replaceChildren(){},appendChild(){}});
  return elements.get(id);
};
const storage=new Map();
Object.assign(context,{normalizeAxisRange,normalizeAxisPresets,normalizeExportSettings,getExportDimensions,getExportLayout,formatEditableValue,renderSizePresetOptions:()=>{},sizePresets:[],axisPresets:[],localStorage:{setItem:(key,value)=>storage.set(key,value)},document:{getElementById:element,createElement:()=>({})},hideTooltip:()=>{},renderTitle:()=>{},drawChart:()=>{},resetAxisSettings:()=>{},chartView:{minFreq:20,maxFreq:20000,minDb:65,maxDb:115},state:{...context.state,analysisMode:"frequency",legendPosition:"top-left",exportSettings:normalizeExportSettings()}});
const controlsStart=source.indexOf("function syncChartSettingsControls()");
const controlsEnd=source.indexOf("function exportIncludes",controlsStart);
vm.runInContext(source.slice(controlsStart,controlsEnd),context);
element("manualMinFreq").value="20";element("manualMaxFreq").value="20000";
element("manualMinDb").value="60";element("manualMaxDb").value="120";element("axisPresetName").value="固定对比";
element("saveAxisPreset").listeners.click();
assert.equal(context.axisPresets[0].maxDb,120);
assert.equal(context.state.axisMinDb,60);
assert.equal(JSON.parse(storage.get("freqdig-axis-presets"))[0].name,"固定对比");
element("manualMaxDb").value="130";
element("saveAxisPreset").listeners.click();
assert.equal(context.axisPresets.length,1);assert.equal(context.axisPresets[0].maxDb,130);
context.state.axisMinDb=0;context.state.axisMaxDb=1;
element("axisPresetSelect").value="固定对比";
element("loadAxisPreset").listeners.click();
assert.equal(context.state.axisMinDb,60);assert.equal(context.state.axisMaxDb,130);
element("manualMaxDb").value="50";
element("applyAxisRange").listeners.click();
assert.equal(context.state.axisMaxDb,130);
assert.match(element("axisSettingsStatus").textContent,/上限大于下限/);
element("deleteAxisPreset").listeners.click();
assert.equal(context.axisPresets.length,0);
assert.equal(JSON.parse(storage.get("freqdig-axis-presets")).length,0);

Object.assign(context,{dataHasPhase:()=>false,cropToDefaultFrequencyRange:data=>data,makeId:()=>"new",normalizeColor:color=>color,nextCurveColor:()=>"#123456"});
vm.runInContext(functionSource("serializeCurve")+"\n"+functionSource("hydrateCurve"),context);
context.curve={id:"a",name:"original.txt",legendName:"用于图例的名称",data:[{frequency:20,level:90}],color:"#123456",visible:true};
assert.equal(vm.runInContext("hydrateCurve(serializeCurve(curve),'fallback').legendName",context),"用于图例的名称");

// Actual PNG handler uses the selected layout and restores the screen on errors.
let downloaded=false, alerts=[];
context.state.exportSettings={resolution:"4k",width:1920,height:1080};
Object.assign(context,{EXPORT_SUMMARY_HEIGHT:116,exportRenderLayout:null,transparentExportMode:false,exportingFrame:false,alert:message=>alerts.push(message),exportIncludes:()=>false,getChartExportFilename:()=>"test.png",document:{...context.document,createElement:()=>({click:()=>{downloaded=true;}})},getExportPngDataUrl:transparent=>{
  assert.equal(transparent,true);
  assert.equal(context.exportRenderLayout.dpr,3);
  assert.equal(context.exportingFrame,true);
  return "data:image/png;base64,test";
}});
vm.runInContext(functionSource("exportPng"),context);
vm.runInContext("exportPng()",context);
assert(downloaded);assert.equal(context.exportRenderLayout,null);assert.equal(context.exportingFrame,false);
context.getExportPngDataUrl=()=>{throw Error("encoding failure");};
vm.runInContext("exportPng()",context);
assert.equal(context.exportRenderLayout,null);assert.equal(context.transparentExportMode,false);assert.equal(context.exportingFrame,false);
assert.equal(alerts[0],"encoding failure");

console.log("PASS: exact PNG sizes and summaries; transparency; axis validation; production preset save/update/load/delete; legend corners, names and project round-trip; stable scaling; export-state restoration.");
