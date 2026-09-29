export const THEMES = [
  { id: "paper", name: "Warm paper", mood: "Ivory · copper", mode: "light", swatches: ["#f4f1e9", "#e8e2d6", "#925621"], strands: ["#d69a63", "#8e83b6", "#5a9a93"] },
  { id: "arctic", name: "Arctic", mood: "Mist · glacier", mode: "light", swatches: ["#edf4f8", "#dceaf1", "#276a92"], strands: ["#57a0d3", "#7d8cca", "#69b8ad"] },
  { id: "sakura", name: "Sakura", mood: "Blush · rose", mode: "light", swatches: ["#f8eff4", "#f0dce8", "#9b3f69"], strands: ["#cc7399", "#9187cf", "#69a89e"] },
  { id: "ink", name: "Ink", mood: "Soft charcoal · glacier", mode: "dark", swatches: ["#27313b", "#3d4a55", "#b5d9e2"], strands: ["#b5d9e2", "#b1acd8", "#85c9ad"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export type ThemeDefinition = (typeof THEMES)[number];
const FALLBACK_THEME: ThemeId = "paper";

export function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export function getTheme(themeId: ThemeId): ThemeDefinition {
  return THEMES.find((theme) => theme.id === themeId) ?? THEMES[0];
}

export function getInitialTheme(): ThemeId {
  try {
    const saved = window.localStorage.getItem("pivot-theme");
    // Preserve the dark palette selected by earlier builds under its new name.
    if (saved === "obsidian") return "ink";
    return isThemeId(saved) ? saved : FALLBACK_THEME;
  } catch {
    return FALLBACK_THEME;
  }
}

export function applyTheme(themeId: ThemeId): void {
  const theme = getTheme(themeId);
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.colorScheme = theme.mode;
  try {
    window.localStorage.setItem("pivot-theme", theme.id);
  } catch {
    // Private browsing or storage restrictions should not block theme switching.
  }
}
