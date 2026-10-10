import { formatEditableValue } from "./chartSettings.js";

export function bindRangeNumber({ range, number, onChange }) {
  const limits = () => ({ min: Number(range.min), max: Number(range.max), step: Number(range.step) || 1 });
  function normalize(value) {
    const { min, max, step } = limits();
    return Math.min(max, Math.max(min, Math.round((Number(value) - min) / step) * step + min));
  }
  function update(value) {
    const normalized = normalize(value);
    range.value = String(normalized);
    number.value = formatEditableValue(normalized);
    number.removeAttribute("aria-invalid");
    return normalized;
  }
  range.addEventListener("input", () => onChange(update(range.value)));
  number.addEventListener("input", () => {
    if (number.value === "" || !Number.isFinite(Number(number.value))) return;
    const value = Number(number.value), { min, max } = limits();
    if (value < min || value > max) { number.setAttribute("aria-invalid", "true"); return; }
    const normalized = normalize(value);
    range.value = String(normalized);
    number.removeAttribute("aria-invalid");
    onChange(normalized);
  });
  number.addEventListener("change", () => {
    const value = number.value !== "" && Number.isFinite(Number(number.value)) ? number.value : range.value;
    onChange(update(value));
  });
  update(number.value === "" ? range.value : number.value);
  return { update };
}
