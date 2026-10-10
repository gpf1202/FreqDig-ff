const assert=require('assert/strict'),fs=require('fs/promises'),os=require('os'),path=require('path');
const {registerImageExport}=require('../src/desktopImageExport.cjs');
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freqdig-images-'));
 const handlers={},owner={isDestroyed:()=>false,once:()=>{}},event={sender:owner};let cancelled=false;
 registerImageExport({ipcMain:{handle:(id,fn)=>handlers[id]=fn},dialog:{showOpenDialog:async()=>({canceled:cancelled,filePaths:[directory]})},BrowserWindow:{fromWebContents:()=>null}});
 const token=await handlers['images-export-begin'](event),bytes=new Uint8Array([1,2,3]);
 assert.equal(await handlers['images-export-save'](event,token,'耳机.png',bytes),'耳机.png');
 assert.equal(await handlers['images-export-save'](event,token,'耳机.png',bytes),'耳机_2.png');
 assert.deepEqual([...await fs.readFile(path.join(directory,'耳机.png'))],[1,2,3]);
 await assert.rejects(()=>handlers['images-export-save'](event,token,'../escape.png',bytes));
 await assert.rejects(()=>handlers['images-export-save']({sender:{}},token,'test.png',bytes));
 await handlers['images-export-end'](event,token);
 await assert.rejects(()=>handlers['images-export-save'](event,token,'test.png',bytes));
 cancelled=true;assert.equal(await handlers['images-export-begin'](event),null);
 console.log('PASS: direct image folder session, original preservation, collision suffix, traversal rejection, sender isolation, cleanup and picker cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
