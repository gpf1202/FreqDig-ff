/* Chart layout and export settings shared by the UI and project files. */
export const LEGEND_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"];

export function normalizeExportSettings(value = {}) {
  if (!value || typeof value !== "object") value = {};
  const resolution = ["original", "1080p", "2k", "4k", "custom"].includes(value.resolution) || /^saved:\d+x\d+$/.test(value.resolution || "") ? value.resolution : "original";
  const dimension = (number, fallback) => Number.isFinite(Number(number))
    ? Math.round(Math.min(8192, Math.max(320, Number(number)))) : fallback;
  return { resolution, width: dimension(value.width ?? 1920, 1920), height: dimension(value.height ?? 1080, 1080) };
}

export function getExportDimensions(settings) {
  const normalized = normalizeExportSettings(settings);
  if (normalized.resolution === "original") return null;
  if (normalized.resolution === "1080p") return { width: 1920, height: 1080 };
  if (normalized.resolution === "2k") return { width: 2560, height: 1440 };
  if (normalized.resolution === "4k") return { width: 3840, height: 2160 };
  return { width: normalized.width, height: normalized.height };
}

export function normalizeSizePresets(value) {
  if (!Array.isArray(value)) return [];
  const presets = new Map();
  for (const item of value.slice(-100)) {
    if (!item || !Number.isFinite(Number(item.width)) || !Number.isFinite(Number(item.height))) continue;
    const { width, height } = normalizeExportSettings(item);
    const id = `saved:${width}x${height}`;
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 64) : "";
    presets.set(id, { id, name: name || `${width} × ${height}`, width, height });
  }
  return [...presets.values()];
}

export function formatEditableValue(value) {
  if (!Number.isFinite(Number(value))) return "";
  return String(Math.round((Number(value) + Number.EPSILON) * 100) / 100);
}

export function makeExportFilename({ name, view = "频响", width, height, transparent = false, extension = "png", usedNames = new Set() }) {
  let stem = String(name || "曲线").replace(/\.(csv|txt|frd|dat|mdat)$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim().slice(0, 100) || "曲线";
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(stem)) stem = `曲线_${stem}`;
  const base = `${stem}_${view}_${width}x${height}${transparent ? "_透明" : ""}`;
  let result = `${base}.${extension}`;
  let suffix = 2;
  while (usedNames.has(result.toLowerCase())) result = `${base}_${suffix++}.${extension}`;
  usedNames.add(result.toLowerCase());
  return result;
}

// Draw at a stable logical size and render at the requested pixel density.
// The optional summary is part of the requested total height.
export function getExportLayout(dimensions, summaryHeight = 0) {
  if (!dimensions) return null;
  const width = Math.min(1280, dimensions.width);
  const dpr = dimensions.width / width;
  const height = dimensions.height / dpr - summaryHeight;
  if (height < 240) throw new Error("图片高度不足：请增加高度、减小宽度，或取消导出分析概要。");
  return { width, height, dpr, dimensions };
}

export function normalizeAxisRange(value) {
  const optional = number => number === "" || number == null ? null : Number(number);
  const minFreq = Number(value.minFreq), maxFreq = Number(value.maxFreq);
  const minDb = optional(value.minDb), maxDb = optional(value.maxDb);
  if (!Number.isFinite(minFreq) || !Number.isFinite(maxFreq) || minFreq < 20 || maxFreq > 20000 || maxFreq <= minFreq) {
    throw new Error("频率范围须在 20–20000 Hz 内，且上限大于下限。");
  }
  if ((minDb === null) !== (maxDb === null) || (minDb !== null && (!Number.isFinite(minDb) || !Number.isFinite(maxDb) || maxDb <= minDb))) {
    throw new Error("纵轴请同时填写有效的上下限（上限大于下限），或同时留空以自动计算。");
  }
  return { minFreq, maxFreq, minDb, maxDb };
}

export function normalizeAxisPresets(value) {
  if (!Array.isArray(value)) return [];
  const presets = new Map();
  for (const item of value.slice(-100)) {
    try {
      const name = typeof item?.name === "string" ? item.name.trim().slice(0, 64) : "";
      if (name) presets.set(name, { name, ...normalizeAxisRange(item) });
    } catch { /* Ignore invalid entries in old projects or local storage. */ }
  }
  return [...presets.values()];
}

export function getLegendOrigin({ position, pad, plotW, plotH, boxWidth, boxHeight, scale }) {
  const inset = 10;
  const left = pad.left + inset;
  const top = pad.top + inset;
  const x = position.endsWith("right") ? Math.max(left, pad.left + plotW - inset - boxWidth) : left;
  const boxTop = position.startsWith("bottom") ? Math.max(top, pad.top + plotH - inset - boxHeight) : top;
  return { x, y: boxTop + 15 * scale };
}
