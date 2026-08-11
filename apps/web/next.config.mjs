import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load the monorepo-root .env.
 *
 * Next only looks inside the app directory, but infrastructure config is shared
 * across the web app, the worker, and the migration runner — duplicating the
 * credential-vault master key into a second file is how one copy drifts and
 * every stored secret stops decrypting.
 */
function loadRootEnv() {
  const rootEnv = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
  let contents;
  try {
    contents = readFileSync(rootEnv, "utf8");
  } catch {
    return; // No .env yet — the app surfaces the missing values on first use.
  }
  for (const line of contents.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    // An explicitly set environment variable always wins over the file.
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

loadRootEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The workspace packages ship TypeScript source rather than build output, so
  // Next compiles them in-place. One fewer build step, and stack traces point at
  // real files.
  transpilePackages: ["@outreach/shared", "@outreach/db", "@outreach/adapters", "@outreach/jobs", "@outreach/ingest"],
  // Never bundle the driver or the provider SDKs — they use dynamic requires and
  // native sockets that a bundler mangles.
  serverExternalPackages: ["postgres", "nodemailer", "@anthropic-ai/sdk"],
};

export default nextConfig;
