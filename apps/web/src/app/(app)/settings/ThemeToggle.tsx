"use client";

import { useEffect, useState } from "react";
import { Button, cx } from "@/components/ui";

type Theme = "system" | "light" | "dark";

/**
 * Theme switch. Both themes are designed, not one derived from the other, so
 * "system" is a real third option rather than a fallback.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") setTheme(stored);
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    if (next === "system") {
      localStorage.removeItem("theme");
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem("theme", next);
      document.documentElement.dataset.theme = next;
    }
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
