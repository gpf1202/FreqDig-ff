// Isolated, hidden Electron window runs the real application. User data is untouched.
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("fs"), path = require("path"), os = require("os"), assert = require("assert/strict");
const root = path.resolve(__dirname, "..");
const tempApp = path.join(root, "test-runtime-app.js"), tempHtml = path.join(root, "test-runtime.html");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "freqdig-qa-")));
app.disableHardwareAcceleration();
const outputDirectory=fs.mkdtempSync(path.join(os.tmpdir(), "freqdig-direct-")); dialog.showOpenDialog=async()=>({canceled:false,filePaths:[outputDirectory]}); require("../src/desktopImageExport.cjs").registerImageExport({ipcMain,dialog,BrowserWindow});
fs.writeFileSync(tempApp, fs.readFileSync(path.join(root, "app.js"), "utf8") + '\nglobalThis.__qa = { state, exportAllCurves, setExportContent, readFiles, selectedCurveIds, applyUnifiedSmoothing, curveManager, getExportLayoutReport, fitExportLegend, captureWorkspace, restoreWorkspace, previewExport, buildSizedChartSvg, workspaceTools, getVisibleSeries, getLegendItems, getLegendGeometry, getDbRange, getChartRenderRect, getActualExportDimensions, render, canvas, getLegendBounds: () => legendBounds };');
fs.writeFileSync(tempHtml, fs.readFileSync(path.join(root, "index.html"), "utf8").replace('src="app.js"', 'src="test-runtime-app.js"'));
let window, errors = [];
const evaluate = async code => { try { return await window.webContents.executeJavaScript(code, true); } catch (error) { console.error('FAILED SCRIPT:', code, 'RENDERER:', errors); throw error; } };
async function check(code) { const result = await evaluate(`(async()=>{ ${code} })()`); assert.equal(result, true, code); }
const delay = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { preload: path.join(root,'electron-preload.cjs'), offscreen: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
    await window.loadFile(tempHtml); await delay(700);
    assert(await evaluate('Boolean(globalThis.__qa)'), 'app initializes');
    await evaluate('document.getElementById("loadDemo").click()'); await delay(500);
    await check('return __qa.state.curves.length > 1');
    await check(String.raw`const snapshot = __qa.captureWorkspace(); __qa.state.curves[0].visible = false; __qa.render(); const a = __qa.getDbRange(__qa.getVisibleSeries(true),20,20000); await __qa.restoreWorkspace(snapshot); const b = __qa.getDbRange(__qa.getVisibleSeries(true),20,20000); return a.minDb === b.minDb && a.maxDb === b.maxDb;`);
    // Actual UI undo and redo recover a deletion and scalar settings.
    await delay(500);
    await evaluate(`__qa.workspaceTools.flushHistory(); __qa.state.curves.splice(0,1); __qa.render();`); await delay(500);
    const removedCount = await evaluate('__qa.state.curves.length');
    await evaluate(`Array.from(document.querySelectorAll(".analysis-toolbar button")).find(b=>b.textContent==="撤销").click()`); await delay(500);
    assert.equal(await evaluate('__qa.state.curves.length'), removedCount + 1);
    await evaluate(`Array.from(document.querySelectorAll(".analysis-toolbar button")).find(b=>b.textContent==="重做").click()`); await delay(500);
    assert.equal(await evaluate('__qa.state.curves.length'), removedCount);
    await evaluate(`document.getElementById("loadDemo").click()`); await delay(500);
    await check(String.raw`__qa.state.appearance = { axisFontSize: 20, axisColor: "#123456", legendColumns: 2, hideLegendSuffix: true, legendCustomPosition: {x:.6,y:.3} }; __qa.state.exportSettings = {resolution:"2k",width:2560,height:1440}; __qa.render(); const p = __qa.previewExport(); const image = new Image(); image.src=p.url; await image.decode(); return p.width===2560 && image.width===2560 && image.height===1440 && !__qa.state.curves.some(c=>!c.visible);`);
    await check(String.raw`const svg=__qa.buildSizedChartSvg(); return svg.includes('font-size="20"') && svg.includes('#123456') && svg.includes('legend-clip');`);
    await check(String.raw`document.getElementById("exportBackground").checked=false; const p=__qa.previewExport(); const image = new Image(); image.src=p.url; await image.decode(); const c=document.createElement("canvas"); c.width=image.width;c.height=image.height; const ctx=c.getContext("2d");ctx.drawImage(image,0,0);return p.transparent && ctx.getImageData(0,0,1,1).data[3]===0;`);
    await check(String.raw`const snapshot=__qa.captureWorkspace(); __qa.state.appearance.axisColor="#abcdef"; await __qa.restoreWorkspace(snapshot); return __qa.state.appearance.axisColor==="#123456" && document.getElementById("exportBackground").checked===false;`);
    await check(String.raw`const c=__qa.canvas,b=__qa.getLegendBounds(),r=c.getBoundingClientRect();const old=__qa.state.appearance.legendCustomPosition.x;
      const geometry=__qa.getChartRenderRect(); const sx=r.width/geometry.width,sy=r.height/geometry.height;
      c.setPointerCapture=()=>{}; c.hasPointerCapture=()=>false;
      c.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,button:0,clientX:r.left+(b.x+4)*sx,clientY:r.top+(b.y+4)*sy,bubbles:true}));
      c.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:r.left+(b.x+84)*sx,clientY:r.top+(b.y+24)*sy,bubbles:true}));
      c.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,bubbles:true}));
      return __qa.state.appearance.legendCustomPosition.x>old;`);
    // Complete template save/apply changes the actual state and export content.
    await evaluate(`const panel=document.querySelector('.export-template-panel'); panel.querySelector('input').value='测试2K透明'; Array.from(panel.querySelectorAll('button')).find(b=>b.textContent.startsWith('保存')).click(); __qa.state.appearance.axisColor='#fedcba'; __qa.state.exportSettings.resolution='1080p'; document.getElementById('exportBackground').checked=true; Array.from(panel.querySelectorAll('button')).find(b=>b.textContent==='应用模板').click();`);
    await check(String.raw`return __qa.state.appearance.axisColor==='#123456' && __qa.state.exportSettings.resolution==='2k' && !document.getElementById('exportBackground').checked;`);
    await evaluate(`Array.from(document.querySelectorAll('.analysis-toolbar button')).find(b=>b.textContent==='频点对比').click()`);
    await check(String.raw`return document.querySelector('.comparison-table-wrap table').rows.length === __qa.getVisibleSeries().length+1;`);
    await evaluate(`document.querySelector('.workspace-dialog[open]').close();`);
    // IndexedDB is real Chromium storage: recovery and recent reopen retain data.
    await evaluate(`__qa.workspaceTools.opened('测试工程.json')`); await delay(2000);
    await check(String.raw`const {WorkspaceStore}=await import('./src/workspaceTools.js'); const store=new WorkspaceStore(); const saved=await store.get('recovery'); const recent=(await store.all()).filter(i=>i.id.startsWith('recent:')); return saved.snapshot.curves.length===__qa.state.curves.length && recent[0].name==='测试工程.json';`);
    await evaluate(`Array.from(document.querySelectorAll('.file-toolbar button')).find(b=>b.textContent==='最近工程').click()`); await delay(500);
    await check(String.raw`return document.querySelector('.recent-row').textContent.includes('测试工程.json')`);
    await evaluate(`document.querySelector('.workspace-dialog[open]').close();document.getElementById('chartTab').click();`); await delay(300);
    await check(String.raw`return document.getElementById('curvesPanel').hidden && !document.getElementById('chartSettingsPanel').hidden && document.getElementById('chartTab').getAttribute('aria-selected')==='true';`);
    const screenshot = await window.webContents.capturePage(); fs.writeFileSync(path.join(root, "qa-workspace.png"), screenshot.toPNG());
    await check(String.raw`return document.documentElement.scrollWidth<=window.innerWidth && document.querySelector('header').getBoundingClientRect().bottom <= document.querySelector('main').getBoundingClientRect().top + 2;`);
    window.setSize(960, 740); await delay(400);
    await check(String.raw`const header = document.querySelector('header').getBoundingClientRect(); return document.documentElement.scrollWidth<=window.innerWidth && document.querySelector('main').getBoundingClientRect().top>=header.bottom-2 && [...document.querySelectorAll('.toolbar-row > *')].every(n=>n.hidden || n.getBoundingClientRect().right <=window.innerWidth);`);
    fs.writeFileSync(path.join(root, "qa-workspace-960.png"), (await window.webContents.capturePage()).toPNG());
    window.setSize(1440,960);
    await window.loadFile(tempHtml); await delay(900);
    await check(String.raw`return document.querySelector('.workspace-dialog[open] h2').textContent==='发现自动保存的工程';`);
    await evaluate(`Array.from(document.querySelector('.workspace-dialog[open]').querySelectorAll('button')).find(b=>b.textContent==='恢复上次工作').click()`); await delay(700);
    await check(String.raw`return __qa.state.curves.length > 1 && __qa.state.appearance.axisColor==='#123456';`);
    // Version 0.0.5 workflow additions use the real DOM and production handlers.
    await check(String.raw`await __qa.readFiles([{name:'后缀测试.txt',text:async()=> '20 75\n1000 80\n20000 78'}]); return __qa.getLegendItems(__qa.getVisibleSeries()).some(i=>i.label==='后缀测试');`);
    await check(String.raw`const existing=__qa.state.curves.find(c=>c.sourceName==='后缀测试.txt');existing.group='重复组';existing.color='#223344';const id=existing.id; const count=__qa.state.curves.length;
      const loading=__qa.readFiles([{name:'后缀测试.txt',text:async()=> '20 85\n1000 90\n20000 88'}]);
      setTimeout(()=>Array.from(document.querySelector('.duplicate-import-dialog').querySelectorAll('button')).find(b=>b.textContent==='替换已有曲线').click(),80);
      await loading;const changed=__qa.state.curves.find(c=>c.id===id);return __qa.state.curves.length===count && changed.data[1].level===90 && changed.group==='重复组' && changed.color==='#223344';`);
    await check(String.raw`const count=__qa.state.curves.length;const loading=__qa.readFiles([{name:'后缀测试.txt',text:async()=> '20 75\n1000 80\n20000 78'}]);setTimeout(()=>Array.from(document.querySelector('.duplicate-import-dialog').querySelectorAll('button')).find(b=>b.textContent==='跳过').click(),80);await loading;return __qa.state.curves.length===count;`);
    await check(String.raw`__qa.selectedCurveIds.clear();__qa.state.curves.slice(0,2).forEach(c=>__qa.selectedCurveIds.add(c.id));const panel=document.querySelector('.curve-management');panel.querySelector('details input').value='左右声道';Array.from(panel.querySelectorAll('button')).find(b=>b.textContent==='将选中曲线放入此组').click();return __qa.state.curves.slice(0,2).every(c=>c.group==='左右声道') && Boolean(document.querySelector('.curve-group-title'));`);
    await check(String.raw`const search=document.querySelector('.curve-management input[type=search]');search.value='后缀测试';search.dispatchEvent(new Event('input',{bubbles:true}));const shown=[...document.querySelectorAll('#curveList [data-curve-id]')].filter(c=>!c.hidden);search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));return shown.length===1;`);
    await check(String.raw`__qa.state.curves.forEach(c=>c.visible=true);__qa.state.target.visible=true;__qa.render();document.querySelector('#curveList [data-curve-id] .curve-name-input').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const solo=__qa.state.curves.filter(c=>c.visible).length===1 && !__qa.state.target.visible;document.querySelector('#curveList [data-curve-id] .curve-name-input').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return solo && __qa.state.curves.every(c=>c.visible) && __qa.state.target.visible;`);
    await check(String.raw`document.getElementById('globalSmoothingLevel').value=String(1/12);document.getElementById('globalSmoothingLevel').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('smoothingScope').value='all';document.getElementById('globalSmoothing').click();if(!__qa.state.curves.every(c=>c.smoothingOctaves===1/12))return false;__qa.selectedCurveIds.clear();__qa.selectedCurveIds.add(__qa.state.curves[0].id);document.getElementById('smoothingScope').value='selected';document.getElementById('globalSmoothingLevel').value=String(1/6);document.getElementById('globalSmoothingLevel').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('globalSmoothing').click();return __qa.state.curves[0].smoothingOctaves===1/6 && __qa.state.curves[1].smoothingOctaves===1/12 && !document.querySelector('[data-batch=smoothing]');`);
    await check(String.raw`const ref=__qa.state.curves[0];__qa.state.alignmentLock={enabled:true,referenceId:ref.id,frequency:1000};await __qa.readFiles([{name:'自动对齐.txt',text:async()=> '20 20\n1000 30\n20000 25'}]);const {interpolate}=await import('./src/audioMath.js');const series=__qa.getVisibleSeries();const a=series.find(c=>c.id===ref.id),b=series.find(c=>c.sourceName==='自动对齐.txt');return Math.abs(interpolate(a.data,1000)-interpolate(b.data,1000))<.00001;`);
    await check(String.raw`const panel=document.querySelector('.curve-management details');panel.querySelector('select').value='print';Array.from(panel.querySelectorAll('button')).find(b=>b.textContent==='应用配色到当前曲线').click();return __qa.state.curves[1].dash.length>0 && __qa.buildSizedChartSvg().includes('stroke-dasharray');`);
    await check(String.raw`const hold=document.querySelector('.original-compare-button');const curve=__qa.state.curves[0];const offset=curve.offsetDb;hold.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));const raw=__qa.getVisibleSeries()[0].data===curve.data;hold.dispatchEvent(new KeyboardEvent('keyup',{key:' ',bubbles:true}));return raw && __qa.getVisibleSeries()[0].data!==curve.data && offset===curve.offsetDb;`);
    await check(String.raw`document.getElementById('toolbarMenuToggle').click();const modal=document.querySelector('.export-workspace-dialog');const zoom=modal.querySelector('select[aria-label="预览缩放比例"]');zoom.value='1';zoom.dispatchEvent(new Event('change'));const good=modal.open && Math.abs(parseFloat(modal.querySelector('img').style.width)*window.devicePixelRatio-2560)<1;modal.close();return good;`);
    await check(String.raw`__qa.state.legendScale=6;__qa.state.appearance.legendColumns=1;__qa.render();const issues=__qa.getExportLayoutReport();__qa.fitExportLegend();return issues.length>0 && !__qa.getExportLayoutReport().some(v=>v.includes('图例超出'));`);
    await check(String.raw`__qa.state.projectName='关闭前即时保存';const ok=await __qa.workspaceTools.flushBeforeClose();const {WorkspaceStore}=await import('./src/workspaceTools.js');const store=new WorkspaceStore();const recovery=await store.get('recovery');return ok && recovery.snapshot.state.projectName==='关闭前即时保存' && recovery.snapshot.curves.length===__qa.state.curves.length;`);
    await evaluate(`__qa.state.projectName='真实IPC关闭保存';`);
    await new Promise((resolve,reject)=> { const timeout=setTimeout(()=>reject(new Error('close handshake timeout')),5000); ipcMain.once('workspace-close-ready',(_event,result)=>{clearTimeout(timeout);try{assert.equal(result.ok,true);resolve();}catch(error){reject(error);}});window.webContents.send('workspace-save-before-close'); });
    await check(String.raw`const {WorkspaceStore}=await import('./src/workspaceTools.js');return (await new WorkspaceStore().get('recovery')).snapshot.state.projectName==='真实IPC关闭保存';`);
    await evaluate(`document.getElementById('curvesTab').click();document.querySelector('aside').scrollTop=0;`);await delay(300);
    fs.writeFileSync(path.join(root,'qa-workspace-005.png'),(await window.webContents.capturePage()).toPNG());
    await evaluate(`document.getElementById('toolbarMenuToggle').click();`);await delay(300);
    fs.writeFileSync(path.join(root,'qa-export-005.png'),(await window.webContents.capturePage()).toPNG());
    await check(String.raw`const d=document.querySelector('.export-workspace-dialog'),b=d.getBoundingClientRect(); return d.open && b.left>=0 && b.right<=window.innerWidth+1 && d.querySelector('.export-settings-column').clientHeight>0;`);
    await check(String.raw`document.querySelector('.export-workspace-dialog').close();const snapshot=__qa.captureWorkspace();__qa.state.showBandIndicator=true;__qa.state.exportDeviationSummary=false;__qa.state.mode='raw';__qa.state.analysisMode='frequency';__qa.state.distortionMode=false;
      for(const id of ['exportBackground','exportCurves','exportLegend'])document.getElementById(id).checked=false;
      for(let mask=0;mask<8;mask++){
        ['exportAxes','exportGrid','exportBands'].forEach((id,i)=>document.getElementById(id).checked=Boolean(mask&(1<<i)));
        const svg=__qa.buildSizedChartSvg();const xml=new DOMParser().parseFromString(svg,'image/svg+xml');
        if(Boolean(xml.querySelector('text')?.textContent)!==Boolean(mask&5))return false;
        if(Boolean([...xml.querySelectorAll('line')].some(n=>n.getAttribute('stroke')==='#c8d5dd'))!==Boolean(mask&2))return false;
        const p=__qa.previewExport(),img=new Image();img.src=p.url;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data;let painted=false;for(let j=3;j<pixels.length;j+=4)if(pixels[j]){painted=true;break;}if(painted!==Boolean(mask))return false;
      }
      __qa.setExportContent({exportAxes:false});if(document.getElementById('exportGrid').checked||document.getElementById('exportBands').checked)return false;
      await __qa.restoreWorkspace(snapshot);return true;`);
    await check(String.raw`document.getElementById('batchOutputMode').value='direct';document.getElementById('batchExportFormat').value='png';await __qa.exportAllCurves();return document.getElementById('exportSettingsStatus').textContent.includes('所选文件夹') && !document.getElementById('batchExportDialog').open;`);
    const outputs=fs.readdirSync(outputDirectory);assert.equal(outputs.length,await evaluate('__qa.state.curves.filter(c=>c.data.length).length'));assert(outputs.every(name=>name.endsWith('.png')));assert(outputs.every(name=>fs.readFileSync(path.join(outputDirectory,name)).subarray(1,4).toString()==='PNG'));
    assert.deepEqual(errors, [], 'no renderer runtime errors');
    console.log('PASS: real Electron workflow; import suffix and duplicate replacement/skip; grouping/search/solo; unified smoothing scopes; locked alignment; palette line patterns; original comparison; 100% export panel; layout fit; close-time save; previous export/history/recovery regressions.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { window?.destroy(); fs.unlinkSync(tempApp); fs.unlinkSync(tempHtml); app.exit(process.exitCode || 0); }
});

