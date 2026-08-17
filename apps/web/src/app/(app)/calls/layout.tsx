import type { ReactNode } from "react";

/**
 * Fuchesi Calls.
 *
 * Everything under /calls is the voice module, which carries its own accent in
 * the Fuchesi family. The attribute is the whole mechanism: `globals.css`
 * rebinds `--accent` beneath it, so buttons, links and focus rings shift to
 * magenta while the neutrals, type and components stay exactly as they are
 * everywhere else in Leads.
 *
 * Scoped here rather than set per-page so a new screen under /calls inherits the
 * identity by existing, and cannot forget to opt in.
 */
export default function CallsLayout({ children }: { children: ReactNode }) {
  return <div data-product="calls">{children}</div>;
}
