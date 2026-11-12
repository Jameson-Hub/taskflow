// The light/dark choice. "system" follows the device; the others override it. Saved per browser.
import { useEffect, useState } from "react";

const THEMES = ["system", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const LABEL: Record<Theme, string> = { system: "match system", light: "light", dark: "dark" };
// U+FE0E asks for the plain text glyph rather than a colour emoji.
const ICON: Record<Theme, string> = { system: "◐\uFE0E", light: "☀\uFE0E", dark: "☾\uFE0E" };

// index.html reads this key too, to apply the choice before the first paint. Change both together.
const KEY = "theme";

function savedTheme(): Theme {
  try {
    return THEMES.find((t) => t === localStorage.getItem(KEY)) ?? "system";
  } catch {
    return "system";
  }
}

function saveTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the choice lasts until the page is reloaded.
  }
}

/** The page's colours (CSS light-dark() follows data-theme) and the browser bar's: one meta per scheme in index.html. */
function showTheme(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  for (const meta of document.querySelectorAll<HTMLMetaElement>("meta[data-scheme]")) {
    const scheme = meta.dataset.scheme;
    meta.media = theme === "system" ? `(prefers-color-scheme: ${scheme})` : scheme === theme ? "all" : "not all";
  }
}

/** Applies the saved choice to the browser bar too, at startup: index.html's pre-paint script only sets data-theme. */
export const showSavedTheme = () => showTheme(savedTheme());

/** Cycles match system → light → dark. */
export function ThemeToggle() {
  const [theme, setTheme] = useState(savedTheme);
  useEffect(() => showTheme(theme), [theme]);
  const label = `Theme: ${LABEL[theme]}`;
  return (
    <button
      className="ghost"
      aria-label={label}
      title={`${label} (click to change)`}
      onClick={() => {
        const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
        saveTheme(next);
        setTheme(next);
      }}
    >
      {ICON[theme]}
    </button>
  );
}
