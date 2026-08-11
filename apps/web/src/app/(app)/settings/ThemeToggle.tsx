"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Button, cx } from "@/components/ui";

type Theme = "system" | "light" | "dark";

/**
 * localStorage has no change event for the tab that wrote it, so writes
 * announce themselves. "storage" covers the other direction: a second tab.
 */
const THEME_EVENT = "themechange";

function subscribe(onStoreChange: () => void) {
  window.addEventListener(THEME_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function readTheme(): Theme {
  const stored = localStorage.getItem("theme");
  return stored === "light" || stored === "dark" ? stored : "system";
}

/**
 * The server cannot know the preference. Rendering "system" and correcting on
 * hydration is safe here because layout.tsx sets data-theme before first paint,
 * so the page is never briefly the wrong colour — only this control is.
 */
function serverTheme(): Theme {
  return "system";
}

/**
 * Theme switch. Both themes are designed, not one derived from the other, so
 * "system" is a real third option rather than a fallback.
 *
 * localStorage is the source of truth rather than component state: the pre-paint
 * script in layout.tsx already reads it, and a second copy in React state is one
 * that can disagree with the DOM.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  function apply(next: Theme) {
    if (next === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return (
    <div className="flex items-center gap-1">
      {(["system", "light", "dark"] as Theme[]).map((option) => (
        <Button
          key={option}
          size="sm"
          variant={theme === option ? "default" : "ghost"}
          className={cx("capitalize", theme === option && "border-border-strong")}
          onClick={() => apply(option)}
        >
          {option}
        </Button>
      ))}
    </div>
  );
}
