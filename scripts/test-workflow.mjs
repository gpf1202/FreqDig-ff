import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { normalizeSizePresets, normalizeExportSettings, getExportDimensions, getExportLayout, formatEditableValue, makeExportFilename } from "../src/chartSettings.js";
import { bindRangeNumber } from "../src/numberControls.js";
import { buildZipArchive, crc32, dataUrlBytes } from "../src/zipArchive.js";

assert.deepEqual(getExportDimensions({resolution:"2k"}),{width:2560,height:1440});
const sizes=normalizeSizePresets([{name:"论文",width:2500,height:1600},{name:"更新名称",width:2500,height:1600},{width:3840,height:2160}]);
assert.equal(sizes.length,2);assert.equal(sizes[0].name,"更新名称");
assert.deepEqual(getExportDimensions({resolution:sizes[0].id,width:2500,height:1600}),{width:2500,height:1600});
assert.equal(formatEditableValue(19999.999999999996),"20000");
assert.equal(formatEditableValue(-70.0630000573),"-70.06");
const used=new Set();
assert.equal(makeExportFilename({name:"耳机.txt",view:"原始频响",width:2560,height:1440,usedNames:used}),"耳机_原始频响_2560x1440.png");
assert.equal(makeExportFilename({name:"耳机.txt",view:"原始频响",width:2560,height:1440,usedNames:used}),"耳机_原始频响_2560x1440_2.png");
assert(!makeExportFilename({name:"A/B:*.txt",width:1920,height:1080}).includes("/"));
assert(makeExportFilename({name:"CON.txt",width:1920,height:1080}).startsWith("曲线_CON_"));

function control(value="") {
  return {value,listeners:{},attributes:{},textContent:"",addEventListener(name,callback){this.listeners[name]=callback;},setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];},setCustomValidity(message){this.validationMessage=message;},reportValidity(){},replaceChildren(){this.children=[];},appendChild(child){(this.children??=[]).push(child);}};
}
const range={...control("0"),min:"-200",max:"200",step:"0.1"}, number=control("0");
let offset=0;
bindRangeNumber({range,number,onChange:value=>offset=value});
range.value="-97.5";range.listeners.input();
assert.equal(number.value,"-97.5");assert.equal(offset,-97.5);
number.value="-81.1";number.listeners.input();
assert(Math.abs(Number(range.value)+81.1)<0.0001);assert(Math.abs(offset+81.1)<0.0001);
number.value="999";number.listeners.input();assert(Math.abs(offset+81.1)<0.0001);
number.listeners.change();assert.equal(offset,200);assert.equal(number.value,"200");
number.value="";number.listeners.change();assert.equal(number.value,"200");

assert.equal(crc32(new TextEncoder().encode("123456789")),0xcbf43926);
assert.deepEqual([...dataUrlBytes("data:image/png;base64,AQID")],[1,2,3]);
const fixture=[{name:"耳机一.png",data:new Uint8Array([1,2,3])},{name:"耳机二.svg",data:"<svg/>"}];
const zip=buildZipArchive(fixture,new Date(2026,9,10));
const bytes=new Uint8Array(await zip.arrayBuffer()), view=new DataView(bytes.buffer);
assert.equal(view.getUint32(0,true),0x04034b50);
assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);
assert.equal(view.getUint16(bytes.length-12,true),2);
let cursor=0;
for(const file of fixture) {
  const nameLength=view.getUint16(cursor+26,true), length=view.getUint32(cursor+22,true);
  const name=new TextDecoder().decode(bytes.slice(cursor+30,cursor+30+nameLength));
  assert.equal(name,file.name);
  const payload=bytes.slice(cursor+30+nameLength,cursor+30+nameLength+length);
  const expected=typeof file.data==="string"?new TextEncoder().encode(file.data):file.data;
  assert.deepEqual(payload,expected);
  assert.equal(view.getUint32(cursor+14,true),crc32(payload));
  cursor+=30+nameLength+length;
}
assert.equal(view.getUint32(cursor,true),0x02014b50);
// Verify the archive with an independent ZIP reader, including UTF-8 names.
const require=createRequire(import.meta.url);
const yauzl=require("yauzl");
await new Promise((resolve,reject)=>{
  yauzl.fromBuffer(Buffer.from(bytes),{lazyEntries:true},(error,reader)=>{
    if(error)return reject(error);
    let count=0;
    reader.on("error",reject);
    reader.on("entry",entry=>{
      const expected=fixture[count++];
      assert.equal(entry.fileName,expected.name);
      reader.openReadStream(entry,(error,stream)=>{
        if(error)return reject(error);
        const chunks=[];stream.on("data",chunk=>chunks.push(chunk));stream.on("error",reject);
        stream.on("end",()=>{
          assert.deepEqual(Buffer.concat(chunks),Buffer.from(typeof expected.data==="string"?new TextEncoder().encode(expected.data):expected.data));
          reader.readEntry();
        });
      });
    });
    reader.on("end",()=>{assert.equal(count,fixture.length);resolve();});
    reader.readEntry();
  });
});

const source=fs.readFileSync(fileURLToPath(new URL("../app.js",import.meta.url)),"utf8");
function functionSource(name) {
  let start=source.indexOf("async function "+name+"(");
  if(start<0)start=source.indexOf("function "+name+"(");
  assert(start>=0,name);
  return source.slice(start,source.indexOf("\n}",start)+2);
}
const elements=new Map();
const element=id=>{if(!elements.has(id))elements.set(id,control());return elements.get(id);};
const storage=new Map();
const context={workspaceTools:null,compareOriginalActive:false,syncAxisRangeForm:()=>{},normalizeSizePresets,normalizeExportSettings,getExportDimensions,getExportLayout,formatEditableValue,makeExportFilename,TextEncoder,Uint8Array,Set,Date,buildZipArchive,dataUrlBytes,MIN_FREQ:20,MAX_FREQ:20000,EXPORT_SUMMARY_HEIGHT:116,batchCurveId:null,exportRenderLayout:null,transparentExportMode:false,exportingFrame:false,batchExportCancelled:false,sizePresets:[],localStorage:{setItem:(key,value)=>storage.set(key,value)},document:{getElementById:element,createElement:()=>control()},state:{curves:[],mode:"raw",analysisMode:"frequency",axisMinFreq:20,axisMaxFreq:20000,exportSettings:{resolution:"2k",width:2560,height:1440}},chartView:{minDb:60,maxDb:120},hideTooltip:()=>{},renderTitle:()=>{},drawChart:()=>{},displayCurveColor:color=>color,cssColor:()=>"#ffffff",renderAxisPresetOptions:()=>{}};
vm.createContext(context);
vm.runInContext(functionSource("getLegendTextColor")+"\n"+functionSource("commitChartAxisInput"),context);
context.curve={color:"#112233"};
context.state.legendTextColor="black";assert.equal(vm.runInContext("getLegendTextColor(curve)",context),"#000000");
context.state.legendTextColor="curve";assert.equal(vm.runInContext("getLegendTextColor(curve)",context),"#112233");
context.state.legendTextColor="theme";assert.equal(vm.runInContext("getLegendTextColor(curve)",context),"#ffffff");
context.input=control("500");vm.runInContext("commitChartAxisInput(input,'x',false)",context);assert.equal(context.state.axisMinFreq,500);
context.input.value="200";vm.runInContext("commitChartAxisInput(input,'x',true)",context);assert.equal(context.state.axisMaxFreq,20000);assert(context.input.validationMessage);
context.input.value="-70.1";vm.runInContext("commitChartAxisInput(input,'y',false)",context);assert.equal(context.state.axisMinDb,-70.1);assert.equal(context.state.axisMaxDb,120);

// Use the real size-preset handlers against a small DOM model.
const presetStart=source.indexOf('document.getElementById("saveSizePreset").addEventListener');
const presetEnd=source.indexOf('document.getElementById("legendTextColor").addEventListener',presetStart);
vm.runInContext(functionSource("renderSizePresetOptions")+"\n"+functionSource("persistSizePresets")+"\n"+functionSource("syncChartSettingsControls")+"\n"+source.slice(presetStart,presetEnd),context);
element("exportWidth").value="2500";element("exportHeight").value="1600";element("sizePresetName").value="论文插图";
element("saveSizePreset").listeners.click();
assert.equal(context.state.exportSettings.resolution,"saved:2500x1600");
assert.equal(context.sizePresets[0].name,"论文插图");
assert(element("exportResolution").children.some(option=>option.value==="saved:2500x1600"));
assert.equal(JSON.parse(storage.get("freqdig-size-presets"))[0].width,2500);
element("deleteSizePreset").listeners.click();assert.equal(context.sizePresets.length,0);assert.equal(context.state.exportSettings.resolution,"custom");

// Each actual batch iteration isolates one curve, includes hidden curves and
// restores rendering state. Cancellation and encoder failure must not download.
let archive=null, errors=[], encodedIds=[];
const curves=[{id:"a",name:"same.txt",visible:true,data:[{frequency:20,level:70}]},{id:"b",name:"same.txt",visible:false,data:[{frequency:20,level:90}]}];
context.state.curves=curves;context.state.exportSettings={resolution:"2k",width:2560,height:1440};context.state.axisMinFreq=20;
Object.assign(context,{alert:message=>errors.push(message),requestAnimationFrame:callback=>callback(),exportIncludes:()=>false,canvas:{width:2560,height:1440},displayData:curve=>curve.data,transformedData:curve=>curve.data,getPhaseSeries:()=>[],drawChart:()=>{context.chartView={series:context.getVisibleSeries(),width:1280,height:720,minDb:60,maxDb:120};},getExportPngDataUrl:()=>{assert.equal(context.chartView.series.length,1);encodedIds.push(context.batchCurveId);return 'data:image/png;base64,AQID';},downloadBlob:blob=>archive=blob});
element("batchExportDialog").showModal=()=>{};element("batchExportDialog").close=()=>{};
vm.runInContext(["getVisibleSeries","getExportViewName","getActualExportDimensions","getChartExportFilename","getFileTimestamp","exportAllCurves"].map(functionSource).join("\n"),context);
await vm.runInContext("exportAllCurves()",context);
assert.deepEqual(encodedIds,["a","b"]);assert(archive);assert.equal(errors.length,0);
assert.equal(context.batchCurveId,null);assert.equal(context.exportRenderLayout,null);assert.equal(context.exportingFrame,false);assert.equal(context.transparentExportMode,false);
assert.equal(curves[0].visible,true);assert.equal(curves[1].visible,false);
assert.equal(context.chartView.series.length,1);
archive=null;encodedIds=[];context.requestAnimationFrame=callback=>{context.batchExportCancelled=true;callback();};
await vm.runInContext("exportAllCurves()",context);assert.equal(archive,null);assert.equal(encodedIds.length,0);assert.equal(context.batchCurveId,null);
context.requestAnimationFrame=callback=>callback();context.getExportPngDataUrl=()=>{throw Error("encoder failure");};
await vm.runInContext("exportAllCurves()",context);assert.equal(archive,null);assert.equal(errors.at(-1),"encoder failure");assert.equal(context.exportingFrame,false);assert.equal(context.batchCurveId,null);
console.log("PASS: range/number linkage, numeric axis inputs, 2K and named sizes, legend colours, safe unique filenames, ZIP structure/CRC, separate hidden-curve batch export, cancellation and state restoration.");
