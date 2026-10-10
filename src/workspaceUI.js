import { WorkspaceHistory, WorkspaceStore, normalizeAppearance, parseComparisonFrequencies, comparisonRows, comparisonCsv } from "./workspaceTools.js";

const $ = id => document.getElementById(id);
function el(tag, text, props = {}) { const node = document.createElement(tag); if (text) node.textContent = text; Object.assign(node, props); return node; }
function button(text, action) { const node = el("button", text, { type: "button" }); node.addEventListener("click", action); return node; }
function dialog(title) {
  const node = el("dialog", "", { className: "workspace-dialog" });
  const header = el("div", "", { className: "workspace-dialog-head" });
  header.append(el("h2", title), button("关闭", () => node.close())); node.append(header); document.body.append(node); return node;
}
function field(label, input) { const node = el("label", "", { className: "workspace-field" }); node.append(el("span", label), input); return node; }
const TEMPLATE_KEYS = ["axisMinFreq", "axisMaxFreq", "axisMinDb", "axisMaxDb", "axisFreqStepOctaves", "axisDbStep", "showBandIndicator", "legendScale", "legendLineLength", "legendLineWidth", "legendPosition", "legendTextColor", "appearance", "exportSettings", "exportDeviationSummary"];

export function installWorkspaceUI(api) {
  const history = new WorkspaceHistory();
  let savedEntryText = null;
  const store = new WorkspaceStore();
  let replaying = false, suspended = false, timer, autosaveTimer, currentRecentId = null, currentName = "未命名工程", ready = false;
  const undo = button("撤销", () => { flushHistory(); replay(history.undo()); }); undo.title = "Ctrl+Z";
  const redo = button("重做", () => { flushHistory(); replay(history.redo()); }); redo.title = "Ctrl+Y / Ctrl+Shift+Z";
  const recentButton = button("最近工程", showRecent);
  const status = el("span", "自动保存准备中", { className: "workspace-save-status", role: "status" });
  $("saveProject").after(recentButton);
  document.querySelector(".analysis-toolbar").append(undo, redo, status);
  function updateHistoryButtons() {
    undo.disabled = !history.canUndo; redo.disabled = !history.canRedo;
    dirtyStatus.textContent = savedEntryText === history.entries[history.index]?.text ? "已保存工程" : "有修改 · 自动保存不替代工程文件";
    projectName.value = api.projectName();
  }
  const projectInfo = el("div", "", { className: "project-info" });
  const projectName = el("input", "", { value: api.projectName(), maxLength: 80, ariaLabel: "当前工程名称", title: "当前工程名称，可直接修改" });
  const dirtyStatus = el("span", "", { className: "project-dirty-status" });
  projectInfo.append(projectName, dirtyStatus); document.querySelector(".brand-group").append(projectInfo);
  projectName.addEventListener("change", () => { api.setProjectName(projectName.value.trim() || "未命名工程"); currentName=api.projectName(); changed(); });
  function markSaved() { flushHistory(); savedEntryText=history.entries[history.index]?.text; updateHistoryButtons(); }
  async function replay(snapshot) {
    if (!snapshot) return;
    replaying = true;
    try { await api.restore(snapshot); } catch (error) { alert(error.message); }
    finally { replaying = false; updateHistoryButtons(); scheduleSave(); }
  }
  function changed() {
    if (!ready || replaying || suspended || api.isExporting()) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (replaying || suspended || api.isExporting()) return;
      if (history.record(api.capture())) { updateHistoryButtons(); scheduleSave(); }
    }, 250);
  }
  function flushHistory() { clearTimeout(timer); if (!replaying && !suspended && !api.isExporting()) history.record(api.capture()); updateHistoryButtons(); }
  function scheduleSave() {
    status.textContent = "等待自动保存…";
    clearTimeout(autosaveTimer); autosaveTimer = setTimeout(saveRecovery, 1200);
  }
  async function saveRecovery() {
    if (!ready || replaying || suspended || api.isExporting()) { scheduleSave(); return; }
    try {
      const snapshot = api.capture();
      await store.put({ id: "recovery", name: api.projectName() || currentName, snapshot, updatedAt: Date.now() });
      status.textContent = `已自动保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
      return true;
    } catch { status.textContent = "自动保存失败，请保存工程文件"; return false; }
  }
  async function remember(name) {
    currentName = name || currentName;
    try { currentRecentId = await store.remember(currentName, api.capture(), currentRecentId || undefined); }
    catch { status.textContent = "最近工程保存失败，请保存工程文件"; }
    scheduleSave();
  }
  async function opened(name) { if(api.projectName()==="未命名工程") api.setProjectName(String(name).replace(/\.json$/i,"")); currentRecentId = null; await remember(name); markSaved(); }
  const recentDialog = dialog("最近使用工程");
  async function showRecent() {
    recentDialog.querySelectorAll(".recent-content").forEach(n => n.remove());
    const content = el("div", "", { className: "recent-content" }); recentDialog.append(content); recentDialog.showModal();
    try {
      const items = (await store.metadata()).filter(i => i.id.startsWith("recent:")).sort((a, b) => b.updatedAt - a.updatedAt);
      content.append(el("p", "以下是本机保存的工程副本，可直接打开；不会追踪磁盘文件后续修改。"));
      if (!items.length) content.append(el("p", "暂无最近工程。打开或保存工程后会显示在这里。"));
      for (const item of items) {
        const row = el("div", "", { className: "recent-row" });
        row.append(el("div", `${item.name}\n${new Date(item.updatedAt).toLocaleString("zh-CN")}`), button("打开", async () => {
          flushHistory(); const saved=await store.get(item.id); recentDialog.close(); await replay(saved.snapshot); history.record(api.capture()); markSaved();
          currentRecentId = item.id; currentName = item.name; await remember(currentName);
        }), button("移除记录", async () => { await store.delete(item.id); if (currentRecentId === item.id) currentRecentId = null; row.remove(); }));
        content.append(row);
      }
      content.append(button("清空最近记录", async () => { for (const item of items) await store.delete(item.id); currentRecentId = null; recentDialog.close(); }));
    } catch { content.append(el("p", "无法读取本机工程记录。")); }
  }
  document.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();
    if (!(event.ctrlKey || event.metaKey) || event.altKey || !["z", "y"].includes(key)) return;
    // Native text undo stays available while editing; project undo works outside fields.
    if (event.target.matches("input:not([type=range]), textarea, [contenteditable=true]")) return;
    event.preventDefault(); flushHistory(); replay(key === "y" || event.shiftKey ? history.redo() : history.undo());
  });
  ["input", "change", "click", "drop", "pointerup", "wheel"].forEach(type => document.addEventListener(type, event => {
    if (event.target.closest(".workspace-dialog") && !event.target.closest(".export-settings-column")) return;
    changed();
  }));

  // Appearance controls are placed alongside the existing legend/axis controls.
  const appearancePanel = el("details", "", { className: "chart-settings-panel", open: true });
  appearancePanel.append(el("summary", "坐标文字与图例排版"));
  const axisSize = el("input", "", { type: "number", min: "8", max: "28", step: "1", value: "12" });
  const axisSlider = el("input", "", { type: "range", min: "8", max: "28", step: "1", value: "12" });
  const pair = el("div", "", { className: "range-number-pair" }); pair.append(axisSlider, axisSize);
  const axisColor = el("input", "", { type: "color", value: "#657484" });
  const columns = el("input", "", { type: "number", min: "1", max: "12", step: "1", value: "1" });
  const suffix = el("input", "", { type: "checkbox" });
  appearancePanel.append(field("坐标刻度及标题大小（px）", pair), field("坐标文字颜色", axisColor), field("图例列数（增大可横向排列）", columns), field("图例隐藏 .txt / .csv 等文件后缀", suffix), el("p", "按住图例区域可拖动位置；选取四角位置会清除拖动位置。"), button("重置图例位置", () => updateAppearance({ legendCustomPosition: null })));
  const legendPanel=el("details","",{className:"chart-settings-panel legend-settings-panel",open:true}); legendPanel.append(el("summary","图例样式"));
  for(const id of ["legendSize","legendLineLength","legendLineWidth","legendPosition","legendTextColor"]){ const label=$(id).closest("label"); if(label) legendPanel.append(label); }
  $("chartSettingsPanel").prepend(legendPanel);
  $("axisSettings").open=false; appearancePanel.open=false;
  $("chartSettingsPanel").append(appearancePanel);
  function updateAppearance(patch) { api.setAppearance(normalizeAppearance({ ...api.appearance(), ...patch })); sync(); changed(); }
  axisSlider.addEventListener("input", () => updateAppearance({ axisFontSize: Number(axisSlider.value) }));
  axisSize.addEventListener("change", () => updateAppearance({ axisFontSize: axisSize.value === "" ? 12 : Number(axisSize.value) }));
  axisColor.addEventListener("input", () => updateAppearance({ axisColor: axisColor.value }));
  columns.addEventListener("change", () => updateAppearance({ legendColumns: columns.value === "" ? 1 : Number(columns.value) }));
  suffix.addEventListener("change", () => updateAppearance({ hideLegendSuffix: suffix.checked }));
  function sync() { projectName.value=api.projectName(); if(preview?.open)queuePreview(); const value = api.appearance(); axisSize.value = axisSlider.value = value.axisFontSize; axisColor.value = value.axisColor; columns.value = value.legendColumns; suffix.checked = value.hideLegendSuffix; }

  // A single export workspace contains settings and a live, zoomable preview.
  const preview = dialog("图片导出"); preview.classList.add("export-workspace-dialog");
  const exportBody=el("div","",{className:"export-workspace-body"});
  const exportControls=document.querySelector(".toolbar-menu-panel"); exportControls.className="export-settings-column"; exportControls.removeAttribute("role");
  const previewColumn=el("div","",{className:"export-preview-column"});
  const previewInfo=el("p"); const previewStage=el("div","",{className:"export-preview-stage"});
  const previewImage=el("img","",{alt:"当前导出效果"}); previewStage.append(previewImage);
  const zoom=el("select","",{ariaLabel:"预览缩放比例"});
  for(const [value,label] of [["fit","适应窗口"],[".5","50%"],["1","100% 原始像素"],["2","200%"]]) zoom.append(el("option",label,{value}));
  const layoutStatus=el("div","",{className:"export-layout-report",role:"status"});
  let previewTimer, lastResult;
  function applyZoom(){ if(!lastResult)return; previewImage.style.width=zoom.value==="fit" ? "100%" : (lastResult.width*Number(zoom.value)/(window.devicePixelRatio || 1))+"px"; previewImage.style.maxWidth="none"; }
  function updatePreview(){
    clearTimeout(previewTimer);
    try { const result=api.preview(); lastResult=result;previewImage.src=result.url;applyZoom();
      previewInfo.textContent=result.width+" × "+result.height+" px · "+(result.transparent ? "透明背景（棋盘格仅用于预览）" : "含背景");
      const issues=api.layoutReport();layoutStatus.replaceChildren(...(issues.length?issues:["排版检查通过"]).map(message=>el("p",message)));layoutStatus.classList.toggle("has-issues",issues.length>0);
    } catch(error){ previewInfo.textContent=error.message || "预览失败"; previewImage.removeAttribute("src"); }
  }
  function queuePreview(){clearTimeout(previewTimer);previewTimer=setTimeout(updatePreview,180);}
  previewColumn.append(field("查看比例",zoom),previewInfo,previewStage,layoutStatus,button("一键调整图例排版",()=>{api.autoLayout();sync();updatePreview();changed();}));
  exportBody.append(exportControls,previewColumn);preview.append(exportBody);
  zoom.addEventListener("change",applyZoom);exportControls.addEventListener("input",queuePreview);exportControls.addEventListener("change",queuePreview);
  exportControls.addEventListener("click",event=>{if(event.target.closest("button"))queuePreview();});
  function openExport(){ if(!preview.open)preview.showModal(); updatePreview(); }
  const previewButton=button("刷新预览",updatePreview);previewButton.dataset.keepMenuOpen="true";$("exportPng").before(previewButton);

  let templates = [];
  try { const saved = JSON.parse(localStorage.getItem("freqdig-export-templates") || "[]"); if (Array.isArray(saved)) templates = saved.filter(t => typeof t.name === "string" && t.settings && typeof t.settings === "object").slice(-50); } catch {}
  const templatePanel = el("details", "", { className: "export-template-panel" }); templatePanel.append(el("summary", "完整导出模板"));
  const templateName = el("input", "", { placeholder: "模板名称，例如：2K 透明对比图", maxLength: 64 });
  const templateSelect = el("select");
  function templateOptions() { templateSelect.replaceChildren(el("option", "选择导出模板", { value: "" }), ...templates.map(t => el("option", t.name, { value: t.name }))); }
  function persistTemplates() { try { localStorage.setItem("freqdig-export-templates", JSON.stringify(templates)); } catch { alert("模板保存失败，本机存储空间可能不足。"); } }
  templatePanel.append(templateName, button("保存 / 更新当前模板", () => {
    const name = templateName.value.trim(); if (!name) { templateName.focus(); return; }
    const snapshot = api.capture(); const settings = Object.fromEntries(TEMPLATE_KEYS.map(k => [k, snapshot.state[k]]));
    const item = { name, settings, content: api.content() }; templates = templates.filter(t => t.name !== name); templates.push(item); templates = templates.slice(-50); persistTemplates(); templateOptions(); templateSelect.value = name;
  }), templateSelect, button("应用模板", () => {
    const item = templates.find(t => t.name === templateSelect.value); if (!item) return;
    try { api.applyTemplate(item); templateName.value = item.name; sync(); changed(); } catch (error) { alert(`模板无法应用：${error.message}`); }
  }), button("删除模板", () => { templates = templates.filter(t => t.name !== templateSelect.value); persistTemplates(); templateOptions(); }));
  templatePanel.querySelectorAll("button").forEach(n => n.dataset.keepMenuOpen = "true");
  $("exportSettingsStatus").before(templatePanel); templateOptions();

  // Frequency comparison contains processed display values in the current comparison mode.
  const comparison = dialog("频点对比表");
  const frequenciesInput = el("input", "", { value: "20, 60, 100, 250, 500, 1000, 2000, 4000, 8000, 16000", className: "comparison-frequencies" });
  const tableWrap = el("div", "", { className: "comparison-table-wrap" });
  const comparisonStatus = el("p", "", { role: "status" }); let comparisonData;
  function fillComparison() {
    comparisonData = null;
    try {
      if (!api.frequencyMode()) throw new Error("频点对比表适用于频响模式，请先切换到频响。");
      const frequencies = parseComparisonFrequencies(frequenciesInput.value);
      const rows = comparisonRows(api.series(), frequencies, api.interpolate);
      comparisonData = { frequencies, rows };
      comparisonStatus.textContent = `${api.viewName()} · 当前可见曲线的显示值（包含平滑、斜率与偏移）；超出数据范围留空。`;
      const table = el("table"), head = el("tr"); head.append(el("th", "曲线 (dB)"), ...frequencies.map(f => el("th", `${f} Hz`))); table.append(head);
      for (const row of rows) { const tr = el("tr"); tr.append(el("th", row.name), ...row.values.map(v => el("td", Number.isFinite(v) ? v.toFixed(2) : "—"))); table.append(tr); }
      tableWrap.replaceChildren(table);
    } catch (error) { tableWrap.replaceChildren(); comparisonStatus.textContent = error.message; }
  }
  comparison.append(field("对比频率（Hz）", frequenciesInput), button("更新对比", fillComparison), comparisonStatus, tableWrap, button("导出 CSV", () => {
    fillComparison(); if (!comparisonData) return; api.downloadText(comparisonCsv(comparisonData.rows, comparisonData.frequencies), `FreqDig_频点对比_${api.viewName()}.csv`, "text/csv;charset=utf-8");
  }));
  document.querySelector(".analysis-toolbar").append(button("频点对比", () => { fillComparison(); comparison.showModal(); }));

  // Keep the old recovery intact until the user chooses whether to restore it.
  (async () => {
    try {
      const recovery = await store.get("recovery");
      if (recovery?.snapshot) {
        suspended = true;
        const recoveryDialog = dialog("发现自动保存的工程");
        recoveryDialog.querySelector(".workspace-dialog-head button").remove();
        recoveryDialog.append(el("p", `${recovery.name} · ${new Date(recovery.updatedAt).toLocaleString("zh-CN")}`), button("恢复上次工作", async () => {
          recoveryDialog.close(); currentName = recovery.name; await replay(recovery.snapshot); suspended = false; ready = true; history.record(api.capture()); updateHistoryButtons(); sync(); scheduleSave();
        }), button("保留副本并开始新工程", async () => {
          try { await store.remember(`${recovery.name}（自动恢复副本）`, recovery.snapshot); } catch { alert("恢复副本保存失败；原自动保存仍保留。"); return; }
          recoveryDialog.close(); suspended = false; ready = true; history.record(api.capture()); updateHistoryButtons(); scheduleSave();
        }));
        recoveryDialog.addEventListener("cancel", e => e.preventDefault()); recoveryDialog.showModal(); return;
      }
      status.textContent = "自动保存已启用";
    } catch { status.textContent = "自动保存不可用，请保存工程文件"; }
    ready = true; history.record(api.capture()); updateHistoryButtons();
  })();
  document.addEventListener("visibilitychange", () => { if (document.hidden && ready && !suspended) { flushHistory(); saveRecovery(); } });
  window.addEventListener("pagehide", () => { if (ready && !suspended) saveRecovery(); });
  sync(); updateHistoryButtons();
  async function flushBeforeClose(){
    if(!ready||suspended)return true;
    clearTimeout(autosaveTimer);flushHistory();
    try{await store.put({id:"recovery",name:api.projectName(),snapshot:api.capture(),updatedAt:Date.now()});return true;}
    catch{status.textContent="关闭前自动保存失败，请手动保存工程";return false;}
  }
  globalThis.freqdigDesktop?.onCloseRequested(flushBeforeClose);
  return { changed, opened, remember, sync, flushHistory, markSaved, openExport, flushBeforeClose };
}
