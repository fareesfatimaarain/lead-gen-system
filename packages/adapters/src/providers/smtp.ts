import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { providerError } from "@outreach/shared";
import type { TestResult } from "@outreach/shared";
import type { AdapterCtx, EmailSender, OutboundEmail, SendReceipt } from "../types";

/**
 * Generic SMTP sender.
 *
 * The no-lock-in option: it works with Gmail, Outlook, Fastmail, a self-hosted
 * Postfix, or any transactional provider's SMTP bridge. Also the only email
 * adapter whose `testConnection` is fully verifiable without a vendor account —
 * `verify()` opens a real connection and completes AUTH.
 */

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromEmail: string;
  fromName?: string;
}

function readConfig(ctx: AdapterCtx): SmtpConfig {
  const c = ctx.config as Record<string, unknown>;
  const host = typeof c.host === "string" ? c.host.trim() : "";
  const user = typeof c.user === "string" ? c.user.trim() : "";
  const fromEmail = typeof c.fromEmail === "string" ? c.fromEmail.trim() : "";
  const port = Number(c.port ?? 587);

  if (!host) throw providerError("smtp", "SMTP host is not set. Add it on the Connections page.");
  if (!user) throw providerError("smtp", "SMTP username is not set. Add it on the Connections page.");
  if (!fromEmail) throw providerError("smtp", "A From address is not set. Add it on the Connections page.");

  return {
    host,
    port,
    // 465 is implicit TLS; 587 and 25 negotiate STARTTLS.
    secure: typeof c.secure === "boolean" ? c.secure : port === 465,
    user,
    fromEmail,
    fromName: typeof c.fromName === "string" ? c.fromName : undefined,
  };
}

function transport(ctx: AdapterCtx) {
  const cfg = readConfig(ctx);
  const options: SMTPTransport.Options = {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: ctx.secret },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
  // Deliberately unpooled — that is nodemailer's default and it is the one we
  // want. Pacing is the guardrail engine's job, and a pooled connection firing
  // a burst of sends is exactly the pattern that gets a mailbox flagged.
  return { cfg, transporter: nodemailer.createTransport(options) };
}

/** Map the common SMTP failures onto something a user can fix. */
function describe(err: unknown, host: string): string {
  const e = err as { code?: string; responseCode?: number; message?: string };
  switch (e.code) {
    case "EAUTH":
      return "The server rejected these credentials. If this is Gmail or Outlook with 2FA, you need an app password, not your account password.";
    case "ECONNREFUSED":
      return `Nothing is listening on ${host} at that port. Check the host and port.`;
    case "ENOTFOUND":
      return `Could not resolve ${host}. Check the hostname for a typo.`;
    case "ETIMEDOUT":
    case "ESOCKET":
      return `Timed out connecting to ${host}. Check the port and whether TLS should be on.`;
    case "EENVELOPE":
      return "The server rejected the From address. It usually has to match the authenticated account.";
    default:
      return e.message ? `SMTP error: ${e.message}` : "SMTP connection failed.";
  }
}

export const smtpProvider: EmailSender = {
  id: "smtp",
  category: "email_send",

  /**
   * `verify()` opens a real connection, negotiates TLS, and completes AUTH —
   * then disconnects without sending. It proves the credential works, not just
   * that it is well-formed, and it costs nothing and reaches no prospect.
   */
  async testConnection(ctx: AdapterCtx): Promise<TestResult> {
    const startedAt = Date.now();
    let cfg: SmtpConfig;
    try {
      cfg = readConfig(ctx);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }

    const { transporter } = transport(ctx);
    try {
      await transporter.verify();
      return {
        ok: true,
        message: `Connected to ${cfg.host}:${cfg.port} and authenticated as ${cfg.user}.`,
        detail: { host: cfg.host, port: cfg.port, tls: cfg.secure ? "implicit" : "starttls", from: cfg.fromEmail },
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      return { ok: false, message: describe(err, cfg.host), latencyMs: Date.now() - startedAt };
    } finally {
      transporter.close();
    }
  },

  async send(email: OutboundEmail, ctx: AdapterCtx): Promise<SendReceipt> {
    const { transporter } = transport(ctx);
    try {
      const info = await transporter.sendMail({
        from: email.from.name ? { name: email.from.name, address: email.from.email } : email.from.email,
        to: email.to.name ? { name: email.to.name, address: email.to.email } : email.to.email,
        subject: email.subject,
        text: email.text,
        ...(email.html ? { html: email.html } : {}),
        ...(email.replyTo ? { replyTo: email.replyTo } : {}),
        ...(email.inReplyTo ? { inReplyTo: email.inReplyTo } : {}),
        ...(email.references ? { references: email.references } : {}),
        headers: email.headers,
      });

      return {
        providerMessageId: info.messageId,
        messageId: info.messageId,
        acceptedAt: new Date(),
      };
    } catch (err) {
      throw providerError("smtp", describe(err, readConfig(ctx).host), err);
    } finally {
      transporter.close();
    }
  },
};
