export const PALETTES = {
  contrast: ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#332288", "#e69f00", "#117733", "#882255"],
  accessible: ["#0072b2", "#e69f00", "#009e73", "#cc79a7", "#56b4e9", "#d55e00", "#000000"],
  print: ["#111111", "#333333", "#555555", "#222222"]
};
export const LINE_DASHES = [[], [9, 5], [2, 4], [12, 4, 2, 4], [15, 5], [5, 3]];
export function stripFileSuffix(name) { return String(name || "").replace(/\.(txt|csv|frd|dat|mdat)$/i, ""); }
export function assignPalette(curves, key) {
  const palette = PALETTES[key] || PALETTES.contrast;
  curves.forEach((curve, i) => { curve.color = palette[i % palette.length]; curve.dash = LINE_DASHES[key === "print" ? i % LINE_DASHES.length : Math.floor(i / palette.length) % LINE_DASHES.length].slice(); });
}
export function reorderCurve(curves, sourceId, targetId) {
  const from = curves.findIndex(c => c.id === sourceId), to = curves.findIndex(c => c.id === targetId);
  if (from < 0 || to < 0 || from === to) return false;
  const [curve] = curves.splice(from, 1); curves.splice(to, 0, curve); return true;
}
export function filterCurves(curves, query, group = "*") {
  const needle = String(query).trim().toLocaleLowerCase();
  return curves.filter(c => (group === "*" || (c.group || "") === group) && `${c.name} ${c.legendName || ""} ${c.group || ""}`.toLocaleLowerCase().includes(needle));
}
export function normalizedAlignmentLock(value = {}, curves = []) {
  const frequency = Number(value.frequency);
  return { enabled: Boolean(value.enabled) && curves.some(c => c.id === value.referenceId),
    referenceId: curves.some(c => c.id === value.referenceId) ? value.referenceId : curves[0]?.id || null,
    frequency: Number.isFinite(frequency) && frequency >= 20 && frequency <= 20000 ? frequency : 1000 };
}

export function installCurveManager(api) {
  const el = (tag, text, props = {}) => { const n = document.createElement(tag); if (text) n.textContent = text; Object.assign(n, props); return n; };
  const action = (text, fn) => { const n = el("button", text, { type: "button" }); n.addEventListener("click", fn); return n; };
  const panel = el("div", "", { className: "curve-management" });
  const search = el("input", "", { type: "search", placeholder: "搜索曲线名称或分组", ariaLabel: "搜索曲线" });
  const groupSelect = el("select", "", { ariaLabel: "筛选分组" });
  const groupName = el("input", "", { placeholder: "分组名称（留空取消分组）", maxLength: 60 });
  const grouping = el("details"); grouping.append(el("summary", "分组、排序与配色"), groupName, action("将选中曲线放入此组", () => { const selected = api.selected(); if (!selected.length) return api.status("请先勾选曲线。"); selected.forEach(c => c.group = groupName.value.trim()); api.render(); }), action("名称排序", () => { api.curves().sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true })); api.render(); }));
  const palette = el("select"); palette.append(el("option", "高对比", { value: "contrast" }), el("option", "色觉友好", { value: "accessible" }), el("option", "黑白打印（搭配线型）", { value: "print" }));
  grouping.append(palette, action("应用配色到当前曲线", () => { assignPalette([...api.curves(), ...(api.target() ? [api.target()] : [])], palette.value); api.render(); }));
  panel.append(search, groupSelect, grouping, el("p", "双击曲线名称可独显 / 恢复；拖动曲线卡片可排序。", { className: "settings-help" }));
  document.getElementById("curvesPanel").prepend(panel);
  let solo = null;
  const expanded = new Set();
  function filter() {
    const ids = new Set(filterCurves(api.curves(), search.value, groupSelect.options.length ? groupSelect.value : "*").map(c => c.id));
    document.querySelectorAll("#curveList [data-curve-id]").forEach(n => n.hidden = !ids.has(n.dataset.curveId));
    document.querySelectorAll("#curveList .curve-group-title").forEach(n => n.hidden = ![...n.parentNode.querySelectorAll(`[data-group-key]`)].some(card => card.dataset.groupKey === n.dataset.groupKey && !card.hidden));
  }
  search.addEventListener("input", filter); groupSelect.addEventListener("change", filter);
  function decorate() {
    panel.hidden = !api.frequencyMode();
    processingGroup.hidden = !api.frequencyMode();
    const chosen = groupSelect.options.length ? groupSelect.value : "*";
    const groups = [...new Set(api.curves().map(c => c.group || ""))];
    groupSelect.replaceChildren(el("option", "全部分组", { value: "*" }), ...groups.map(g => el("option", g || "未分组", { value: g })));
    groupSelect.value = groups.includes(chosen) || chosen === "*" ? chosen : "*";
    let previousGroup = null;
    for (const card of document.querySelectorAll("#curveList [data-curve-id]")) {
      const curve = api.curves().find(c => c.id === card.dataset.curveId); if (!curve) continue;
      card.dataset.groupKey = curve.group || "";
      if (curve.group && curve.group !== previousGroup) {
        const title = el("div", curve.group, { className: "curve-group-title" }); title.dataset.groupKey = curve.group; card.before(title);
      }
      previousGroup = curve.group || "";
      // The header stays visible while infrequently used controls collapse.
      const details = el("details", "", { className: "curve-details", open: expanded.has(curve.id) }); details.append(el("summary", "样式、相位与偏移"));
      details.addEventListener("toggle", () => { if (details.open) expanded.add(curve.id); else expanded.delete(curve.id); });
      for (const selector of [".legend-name-field", ".curve-meta", ".curve-options", ".curve-offset"]) { const node = card.querySelector(selector); if (node) details.append(node); }
      card.append(details);
      const name = card.querySelector(".curve-name-input");
      name?.addEventListener("dblclick", e => {
        e.preventDefault();
        if (solo?.id === curve.id) { api.curves().forEach(c => { if (solo.visibility.has(c.id)) c.visible = solo.visibility.get(c.id); }); if (api.target()) api.target().visible = solo.targetVisible; solo = null; }
        else { if (!solo) solo = { visibility: new Map(api.curves().map(c => [c.id, c.visible])), targetVisible: api.target()?.visible }; solo.id = curve.id; api.curves().forEach(c => c.visible = c.id === curve.id); if (api.target()) api.target().visible = false; }
        api.render();
      });
      const handle = el("span", "⠿", { className: "curve-drag-handle", title: "拖动排序", draggable: true }); card.prepend(handle);
      handle.addEventListener("dragstart", e => { e.dataTransfer.setData("application/x-freqdig-curve", curve.id); e.dataTransfer.effectAllowed = "move"; });
      card.addEventListener("dragover", e => { if ([...e.dataTransfer.types].includes("application/x-freqdig-curve")) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } });
      card.addEventListener("drop", e => { const id = e.dataTransfer.getData("application/x-freqdig-curve"); if (!id) return; e.preventDefault(); e.stopPropagation(); if (reorderCurve(api.curves(), id, curve.id)) api.render(); });
      const order = el("div", "", { className: "curve-order-actions" });
      order.append(action("上移", () => { const index = api.curves().findIndex(c => c.id === curve.id); if (index > 0) { reorderCurve(api.curves(), curve.id, api.curves()[index - 1].id); api.render(); } }), action("下移", () => { const index = api.curves().findIndex(c => c.id === curve.id); if (index < api.curves().length - 1) { reorderCurve(api.curves(), curve.id, api.curves()[index + 1].id); api.render(); } })); details.append(order);
    }
    filter(); syncLock();
  }
  const lockPanel = el("details", "", { className: "alignment-lock-panel" }); lockPanel.append(el("summary", "固定对齐基准"));
  const lockRef = el("select", "", { ariaLabel: "固定对齐曲线" });
  const lockFreq = el("input", "", { type: "number", min: "20", max: "20000", value: "1000", ariaLabel: "固定对齐频率 Hz" });
  const lockEnabled = el("input", "", { type: "checkbox" }); const enabledLabel = el("label", "新导入曲线自动对齐"); enabledLabel.prepend(lockEnabled);
  lockPanel.append(lockRef, el("label", "对齐频点（Hz）"), lockFreq, enabledLabel, action("将现有曲线对齐到此基准", () => {
    if (!saveLock()) return; api.alignExisting();
  }));
  document.getElementById("smoothingControls").after(lockPanel);
  const processingGroup = el("details", "", { className: "curve-processing-group" });
  processingGroup.append(el("summary", "对齐、斜率与归一化"));
  const existingProcessing = document.querySelector(".processing-settings");
  existingProcessing.open = true;
  document.getElementById("smoothingControls").after(processingGroup);
  processingGroup.append(lockPanel, existingProcessing);
  const processingPanel = el("div", "", { id: "processingPanel", hidden: true, role: "tabpanel" });
  processingPanel.setAttribute("aria-labelledby", "processingTab");
  const processingTab = el("button", "处理工具", { id: "processingTab", type: "button", role: "tab" });
  processingTab.dataset.sidebarTab = "processing";
  processingTab.setAttribute("aria-controls", "processingPanel"); processingTab.setAttribute("aria-selected", "false");
  document.getElementById("chartTab").before(processingTab);
  document.getElementById("curvesTab").textContent = "曲线管理";
  document.getElementById("curvesPanel").after(processingPanel);
  processingPanel.append(document.getElementById("smoothingControls"), processingGroup); processingGroup.open = true;
  function selectSidebar(key) {
    for (const [name, id] of [["curves", "curvesPanel"], ["processing", "processingPanel"], ["chart", "chartSettingsPanel"]]) document.getElementById(id).hidden = name !== key;
    for (const tab of document.querySelectorAll("[data-sidebar-tab]")) { const active = tab.dataset.sidebarTab === key; tab.setAttribute("aria-selected", String(active)); tab.classList.toggle("is-active", active); }
  }
  for (const tab of document.querySelectorAll("[data-sidebar-tab]")) tab.addEventListener("click", () => selectSidebar(tab.dataset.sidebarTab));
  function saveLock() { const frequency = Number(lockFreq.value); if (!Number.isFinite(frequency) || frequency < 20 || frequency > 20000) { api.status("对齐频点须为 20–20000 Hz。"); return false; }
    api.setLock({ enabled: lockEnabled.checked, referenceId: lockRef.value, frequency }); return true;
  }
  [lockRef, lockFreq, lockEnabled].forEach(n => n.addEventListener("change", saveLock));
  function syncLock() {
    const lock = api.lock(); lockPanel.hidden = !api.frequencyMode();
    lockRef.replaceChildren(...api.curves().map(c => el("option", stripFileSuffix(c.name), { value: c.id })));
    lockRef.value = lock.referenceId || api.curves()[0]?.id || ""; lockFreq.value = lock.frequency; lockEnabled.checked = lock.enabled;
  }
  const hold = action("按住查看原始曲线", () => {}); hold.className = "original-compare-button";
  document.querySelector(".chart-head").append(hold);
  let holding = false;
  function begin(e) { if (!api.frequencyMode()) return; holding = true; if (e.pointerId != null) hold.setPointerCapture(e.pointerId); api.original(true); hold.textContent = "正在显示原始曲线 · 松开恢复"; }
  function end() { if (!holding) return; holding = false; api.original(false); hold.textContent = "按住查看原始曲线"; }
  hold.addEventListener("pointerdown", begin); hold.addEventListener("pointerup", end); hold.addEventListener("pointercancel", end); hold.addEventListener("lostpointercapture", end); hold.addEventListener("blur", end);
  hold.addEventListener("keydown", e => { if ([" ", "Enter"].includes(e.key) && !e.repeat) { e.preventDefault(); begin(e); } });
  hold.addEventListener("keyup", e => { if ([" ", "Enter"].includes(e.key)) { e.preventDefault(); end(); } }); window.addEventListener("blur", end);
  return { decorate, search, groupSelect, resetSolo: () => { solo = null; }, syncLock };
}
