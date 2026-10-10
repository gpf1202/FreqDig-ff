// Reusable workspace models; no DOM or renderer dependencies.
export const DEFAULT_APPEARANCE = {
  axisFontSize: 12, axisColor: "#657484", legendColumns: 1,
  hideLegendSuffix: true, legendCustomPosition: null
};
export function normalizeAppearance(value = {}) {
  const n = (v, fallback, min, max) => Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback;
  const p = value?.legendCustomPosition;
  return {
    axisFontSize: n(value?.axisFontSize ?? 12, 12, 8, 28),
    axisColor: /^#[0-9a-f]{6}$/i.test(value?.axisColor) ? value.axisColor : DEFAULT_APPEARANCE.axisColor,
    legendColumns: Math.round(n(value?.legendColumns ?? 1, 1, 1, 12)),
    hideLegendSuffix: value?.hideLegendSuffix !== false,
    legendCustomPosition: p && Number.isFinite(p.x) && Number.isFinite(p.y)
      ? { x: n(p.x, 0, 0, 1), y: n(p.y, 0, 0, 1) } : null
  };
}
export function legendLayout(items, measure, { columns = 1, rowHeight, lineLength, gap }) {
  columns = Math.max(1, Math.min(items.length || 1, Math.round(columns)));
  const rows = Math.ceil(items.length / columns);
  const widths = Array.from({ length: columns }, () => 0);
  items.forEach((item, i) => { const col = i % columns; widths[col] = Math.max(widths[col], lineLength + gap + measure(item.label)); });
  const origins = widths.map((_, col) => widths.slice(0, col).reduce((a, b) => a + b + 24, 0));
  return { width: widths.reduce((a, b) => a + b, 0) + Math.max(0, columns - 1) * 24,
    height: rows * rowHeight, positions: items.map((_, i) => ({ x: origins[i % columns], y: Math.floor(i / columns) * rowHeight })) };
}
export function cleanSnapshot(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => /cache/i.test(key) ? undefined : item));
}
export class WorkspaceHistory {
  constructor(limit = 50, byteLimit = 64 * 1024 * 1024) { this.limit = limit; this.byteLimit = byteLimit; this.entries = []; this.index = -1; this.pool = new Map(); this.ids = new WeakMap(); this.nextId = 1; }
  pack(snapshot) {
    const datasets = [];
    const intern = data => {
      let id = this.ids.get(data);
      if (!this.pool.has(id)) {
        const text = JSON.stringify(data);
        id = [...this.pool].find(([, item]) => item.text === text)?.[0];
        if (!id) { id = this.nextId++; this.pool.set(id, { text, bytes: text.length * 2 }); }
        this.ids.set(data, id);
      }
      datasets.push(id); return { $dataset: id };
    };
    const text = JSON.stringify(snapshot, (key, value) => ((key === "data" || key === "samples") && Array.isArray(value)) ? intern(value) : value);
    return { text, datasets };
  }
  collect() {
    const keep = new Set(this.entries.flatMap(e => e.datasets));
    for (const id of this.pool.keys()) if (!keep.has(id)) this.pool.delete(id);
  }
  unpack(entry) { return JSON.parse(entry.text, (_key, value) => value && Object.hasOwn(value, "$dataset") ? JSON.parse(this.pool.get(value.$dataset).text) : value); }
  record(snapshot) {
    const packed = this.pack(snapshot);
    if (this.entries[this.index]?.text === packed.text) return false;
    this.entries.splice(this.index + 1);
    this.entries.push(packed); this.collect();
    const bytes = () => this.entries.reduce((n, e) => n + e.text.length * 2, 0) + [...this.pool.values()].reduce((n, e) => n + e.bytes, 0);
    while (this.entries.length > this.limit || (this.entries.length > 1 && bytes() > this.byteLimit)) { this.entries.shift(); this.collect(); }
    this.index = this.entries.length - 1;
    return true;
  }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index + 1 < this.entries.length; }
  undo() { return this.canUndo ? this.unpack(this.entries[--this.index]) : null; }
  redo() { return this.canRedo ? this.unpack(this.entries[++this.index]) : null; }
}
export function parseComparisonFrequencies(text) {
  const values = String(text).split(/[\s,，;；]+/).filter(Boolean).map(Number);
  if (!values.length || values.length > 32 || values.some(v => !Number.isFinite(v) || v < 20 || v > 20000)) throw new Error("请输入 1–32 个 20–20000 Hz 频点，用逗号或空格分隔。");
  return [...new Set(values)].sort((a, b) => a - b);
}
export function comparisonRows(series, frequencies, interpolate) {
  return series.map(curve => ({ name: curve.legendName?.trim() || curve.name,
    values: frequencies.map(f => interpolate(curve.data, f)) }));
}
export function comparisonCsv(rows, frequencies) {
  const quote = v => `"${String(v).replaceAll('"', '""')}"`;
  return "\ufeff" + [["曲线 / 当前显示值 (dB)", ...frequencies.map(f => `${f} Hz`)], ...rows.map(r => [r.name, ...r.values.map(v => Number.isFinite(v) ? v.toFixed(2) : "")])].map(r => r.map(quote).join(",")).join("\r\n");
}
export class WorkspaceStore {
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("freqdig-workspace-v1", 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("workspace")) request.result.createObjectStore("workspace", { keyPath: "id" });
        if (!request.result.objectStoreNames.contains("metadata")) {
          const metadata = request.result.createObjectStore("metadata", { keyPath: "id" });
          const cursor = request.transaction.objectStore("workspace").openCursor();
          cursor.onsuccess = () => { if (cursor.result) { const { id, name, updatedAt } = cursor.result.value; metadata.put({ id, name, updatedAt }); cursor.result.continue(); } };
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.db;
  }
  async request(mode, operation) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["workspace", "metadata"], mode);
      const request = operation(tx.objectStore("workspace"), tx.objectStore("metadata"));
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || request.error);
      tx.onabort = () => reject(tx.error || new Error("本机存储事务已取消"));
    });
  }
  get(id) { return this.request("readonly", s => s.get(id)); }
  put(item) { return this.request("readwrite", (s, m) => { m.put({ id: item.id, name: item.name, updatedAt: item.updatedAt }); return s.put(item); }); }
  delete(id) { return this.request("readwrite", (s, m) => { m.delete(id); return s.delete(id); }); }
  all() { return this.request("readonly", s => s.getAll()); }
  metadata() { return this.request("readonly", (_s, m) => m.getAll()); }
  async remember(name, snapshot, id = `recent:${crypto.randomUUID()}`) {
    await this.put({ id, name, snapshot, updatedAt: Date.now() });
    const recent = (await this.metadata()).filter(i => i.id.startsWith("recent:")).sort((a, b) => b.updatedAt - a.updatedAt);
    for (const item of recent.slice(12)) await this.delete(item.id);
    return id;
  }
}
