import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  and,
  clearRateLimit,
  consumeRateLimit,
  db,
  eq,
  gt,
  hashPassword,
  hashToken,
  newSessionToken,
  schema,
  sql,
  verifyPassword,
  withUser,
} from "@outreach/db";
import { conflict, forbidden, rateLimited, unauthenticated, validationFailed } from "@outreach/shared";
import type { Capability, OrgRole } from "@outreach/shared";
import { can } from "@outreach/shared";

/**
 * Session and org context.
 *
 * The cookie carries an opaque token and nothing else. Identity, the active org,
 * and the role are all resolved server-side from the sessions table on every
 * request — none of it is client-readable or client-settable, because the active
 * org id is the value every RLS policy resolves through.
 */

const COOKIE_NAME = "outreach_session";
const SESSION_TTL_DAYS = 30;

/**
 * Sign-in is limited twice over, and both limits are needed.
 *
 * Per-account stops someone grinding one victim's password from a rotating pool
 * of addresses. Per-address stops credential stuffing, where each guess is
 * against a different account so the per-account counter never rises. The
 * per-address limit is the looser of the two because a shared office NAT puts
 * real colleagues behind one address.
 */
const SIGN_IN_PER_ACCOUNT = { limit: 5, windowSeconds: 900 };
const SIGN_IN_PER_ADDRESS = { limit: 30, windowSeconds: 900 };
/** Sign-up creates rows, so it is limited by address only — there is no account yet. */
const SIGN_UP_PER_ADDRESS = { limit: 5, windowSeconds: 3600 };

/**
 * The caller's address, for rate-limit keying only.
 *
 * Behind a proxy the socket address is the proxy, so x-forwarded-for is the only
 * signal available — and it is client-settable, which is why this is never used
 * for authorization. The leftmost entry is the original client; a spoofed one
 * only lets an attacker choose which bucket to exhaust, and the per-account
 * limit still holds.
 */
async function callerAddress(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || h.get("x-real-ip") || "unknown";
}

/** Throws if the attempt is over the limit. */
async function enforceLimit(key: string, policy: { limit: number; windowSeconds: number }, what: string) {
  const result = await consumeRateLimit({ key, ...policy });
  if (!result.allowed) throw rateLimited(result.retryAfterSeconds, what);
}

export interface SessionContext {
  userId: string;
  userEmail: string;
  userName: string | null;
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: OrgRole;
  sessionId: string;
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

/** The current session, or null. Never throws — callers decide what to do. */
export async function getSession(): Promise<SessionContext | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;

  const rows = await db()
    .select({
      sessionId: schema.sessions.id,
      activeOrgId: schema.sessions.activeOrgId,
      userId: schema.users.id,
      userEmail: schema.users.email,
      userName: schema.users.name,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.tokenHash, hashToken(token)),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.activeOrgId) return null;

  const memberships = await db()
    .select({
      role: schema.orgMembers.role,
      orgName: schema.orgs.name,
      orgSlug: schema.orgs.slug,
    })
    .from(schema.orgMembers)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.orgMembers.orgId))
    .where(
      and(eq(schema.orgMembers.userId, row.userId), eq(schema.orgMembers.orgId, row.activeOrgId)),
    )
    .limit(1);

  const membership = memberships[0];
  // Membership revoked while the session was live — the session is no longer valid for this org.
  if (!membership) return null;

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    userEmail: row.userEmail,
    userName: row.userName,
    orgId: row.activeOrgId,
    orgName: membership.orgName,
    orgSlug: membership.orgSlug,
    role: membership.role,
  };
}

/**
 * For route handlers. Throws, so `handle()` turns it into a 401 the client can
 * act on.
 */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) throw unauthenticated();
  return session;
}

/**
 * For server components.
 *
 * A page render is not an API call: "not signed in" means send them to sign-in,
 * not raise a 401. Throwing here would also race the layout's own redirect —
 * Next renders layouts and pages in parallel — and log an error for a case that
 * is entirely expected.
 */
export async function requirePageSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

/** Require a capability. Checked server-side on every mutating path. */
export async function requireCapability(capability: Capability): Promise<SessionContext> {
  const session = await requireSession();
  if (!can(session.role, capability)) {
    throw forbidden(
      `This action needs a role above ${session.role}. Ask an owner of ${session.orgName} to make the change.`,
    );
  }
  return session;
}

// ---------------------------------------------------------------------------
// Sign up / in / out
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "workspace"
  );
}

async function issueSession(userId: string, orgId: string): Promise<void> {
  const { token, tokenHash } = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  await db().insert(schema.sessions).values({ userId, activeOrgId: orgId, tokenHash, expiresAt });
  (await cookies()).set(COOKIE_NAME, token, cookieOptions(expiresAt));
}

/**
 * Create the first user and their org together.
 *
 * The two are created in one transaction because an org with no owner is
 * unreachable and a user with no org has nowhere to land.
 */
export async function signUp(input: {
  email: string;
  password: string;
  name: string;
  orgName: string;
}): Promise<void> {
  const email = input.email.trim().toLowerCase();
  await enforceLimit(`signup:ip:${await callerAddress()}`, SIGN_UP_PER_ADDRESS, "sign-up attempts");

  if (input.password.length < 12) {
    throw validationFailed("Use a password of at least 12 characters.");
  }

  const existing = await db().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing.length > 0) {
    throw conflict("An account with that email already exists. Sign in instead.");
  }

  const { userId, orgId } = await db().transaction(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({ email, name: input.name.trim(), passwordHash: hashPassword(input.password) })
      .returning({ id: schema.users.id });

    let slug = slugify(input.orgName);
    const clash = await tx.select({ id: schema.orgs.id }).from(schema.orgs).where(eq(schema.orgs.slug, slug)).limit(1);
    if (clash.length > 0) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

    const [org] = await tx
      .insert(schema.orgs)
      .values({ name: input.orgName.trim(), slug })
      .returning({ id: schema.orgs.id });

    await tx.insert(schema.orgMembers).values({ orgId: org!.id, userId: user!.id, role: "owner" });

    // `settings` is org-scoped and under forced RLS, so the tenant claim must be
    // set before the row can be written — even during bootstrap, when the org was
    // created moments ago in this same transaction.
    await tx.execute(sql`SELECT set_config('app.org_id', ${org!.id}, true)`);
    // Materialize the default sending policy now, so the guardrail engine always
    // has a row to read rather than falling back to hardcoded values.
    await tx.insert(schema.settings).values({ orgId: org!.id });

    return { userId: user!.id, orgId: org!.id };
  });

  await issueSession(userId, orgId);
}

export async function signIn(email: string, password: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const accountKey = `signin:email:${normalized}`;

  // Counted before the password is checked, not after a failure: an attempt that
  // is never recorded is an attempt that is never limited, and a crash between
  // the check and the increment would leave the guess free.
  await enforceLimit(`signin:ip:${await callerAddress()}`, SIGN_IN_PER_ADDRESS, "sign-in attempts");
  await enforceLimit(accountKey, SIGN_IN_PER_ACCOUNT, "sign-in attempts for this account");

  const rows = await db()
    .select({ id: schema.users.id, passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.email, normalized))
    .limit(1);

  const user = rows[0];
  // Same message either way — a distinct "no such account" reply tells an
  // attacker which addresses are registered.
  const invalid = validationFailed("That email and password combination is not recognized.");
  if (!user || !verifyPassword(password, user.passwordHash)) throw invalid;

  const memberships = await withUser(user.id, (tx) =>
    tx
      .select({ orgId: schema.orgMembers.orgId })
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.userId, user.id))
      .limit(1),
  );

  const orgId = memberships[0]?.orgId;
  if (!orgId) {
    throw forbidden("This account is not a member of any workspace yet. Ask an owner to invite you.");
  }

  // Only the per-account counter is cleared. The per-address one stays, so one
  // valid login among many failures does not reset a stuffing run's budget.
  await clearRateLimit(accountKey);
  await db().update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
  await issueSession(user.id, orgId);
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) {
    await db().delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
  }
  jar.delete(COOKIE_NAME);
}
