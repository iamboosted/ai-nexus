/* Retained presentation utilities; the roster comes only from configuration. */
function tempColor(t) {
  if (t < 45) return "var(--cool)";
  if (t < 60) return "var(--accent)";        // nominal load — accent tint
  if (t < 72) return "var(--warm)";
  if (t < 82) return "var(--hot)";
  return "var(--crit)";
}
function tempColorRaw(t) {
  if (t < 45) return "oklch(0.72 0.10 230)";
  if (t < 60) return "var(--accent)";
  if (t < 72) return "oklch(0.83 0.15 80)";
  if (t < 82) return "oklch(0.72 0.17 45)";
  return "oklch(0.64 0.22 25)";
}

function fmtVRAM(mb, asGB) {
  if (asGB) return (mb / 1024).toFixed(1) + " GB";
  return Math.round(mb).toLocaleString() + " MB";
}

function hexToRgb(hex) {
  hex = String(hex).replace("#", "");
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex({ r, g, b }) {
  const h = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}
function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx };
}
function hsvToRgb({ h, s, v }) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
// derive the full --accent var family from one hex + chosen ink (black|white)
function accentVars(hex, ink) {
  const { r, g, b } = hexToRgb(hex);
  return {
    "--accent": hex,
    "--accent-2": `color-mix(in oklab, ${hex} 68%, #07131c)`,
    "--accent-ink": ink === "white" ? "oklch(0.985 0.006 250)" : "oklch(0.16 0.02 250)",
    "--accent-soft": `rgba(${r},${g},${b},0.15)`,
    "--accent-line": `rgba(${r},${g},${b},0.5)`,
    "--accent-glow": `rgba(${r},${g},${b},0.34)`,
  };
}


