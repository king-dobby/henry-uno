import { cookies } from "next/headers";
import crypto from "crypto";

export interface PortalUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  tool_access: string[];
}

const SESSION_COOKIE = "henry_portal_session";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(payload: string, secret: string): string {
  return base64url(crypto.createHmac("sha256", secret).update(payload).digest());
}

// Verify a signed cookie value. Returns the unsigned payload if valid, else null.
function verifySigned(payload: string, signature: string, secret: string): string | null {
  const expected = sign(payload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return payload;
}

// Decode a base64url payload back to its UTF-8 string. base64url is the cookie
// encoding because — unlike percent-encoding — it is invariant under the
// URL-decoding that Next's cookie parser applies on read, so the exact bytes
// we signed are the exact bytes we verify. (The old percent-encoded scheme
// silently broke every login: it signed over the encoded value but verified
// over the decoded value, so no signature ever matched and /artifacts bounced
// straight back to /login.)
function fromBase64url(s: string): string {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export async function getSession(): Promise<PortalUser | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const secret = process.env.HENRY_PORTAL_SESSION_SECRET;
  let payload: string;

  if (secret && raw.includes(".")) {
    // Signed mode: require a valid signature over the base64url payload.
    const dot = raw.lastIndexOf(".");
    const body = raw.slice(0, dot);
    const signature = raw.slice(dot + 1);
    const verified = verifySigned(body, signature, secret);
    if (verified === null) return null;
    payload = verified;
  } else if (secret) {
    // Secret is set but the cookie carries no signature — reject it (legacy
    // unsigned session; the user simply re-logs in).
    return null;
  } else {
    // Fallback: no secret configured — accept the unsigned cookie so a deploy
    // can't lock everyone out before the env var is set.
    payload = raw;
  }

  // New cookies store base64url(JSON). Try that first, then fall back to the
  // legacy percent-encoded / raw-JSON shapes so older cookies keep working.
  for (const decode of [fromBase64url, decodeURIComponent, (s: string) => s]) {
    try {
      return JSON.parse(decode(payload)) as PortalUser;
    } catch {
      /* try next decoder */
    }
  }
  return null;
}

export function setSessionCookie(user: PortalUser): string {
  // Returns Set-Cookie header value. Payload is base64url(JSON) so it survives
  // the cookie round-trip byte-for-byte (no percent-encoding ambiguity).
  const value = base64url(Buffer.from(JSON.stringify(user), "utf8"));
  const secret = process.env.HENRY_PORTAL_SESSION_SECRET;
  // When a secret is configured, append an HMAC-SHA256 signature over the
  // base64url payload so the backend-trusted user id can't be forged. Without
  // a secret, fall back to the unsigned cookie.
  const cookieValue = secret ? `${value}.${sign(value, secret)}` : value;
  const maxAge = 8 * 60 * 60; // 8 hours
  return `${SESSION_COOKIE}=${cookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
}
