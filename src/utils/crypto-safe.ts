/**
 * Shared constant-time comparison and HMAC helpers.
 *
 * Security primitives belong in one place, not re-derived at each call site: the
 * control server had a correct `timingSafeEqual`, the webhook server had a naive
 * `===` (#249). Both now go through here.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison. Avoids the timing oracle of `a === b`, which
 * short-circuits on the first differing byte and can leak a secret's prefix
 * through response timing. Lengths are compared first (necessarily
 * non-constant-time), which reveals only the length, never the contents.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Lower-case hex HMAC-SHA256 of `body` under `secret`. */
export function hmacSha256Hex(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

/**
 * Verify an `HMAC-SHA256(raw body)` signature against a shared secret, the shape
 * every major provider (Stripe, GitHub, Shopify) uses. Authenticating the
 * *message* (this exact payload came from the key holder, unmodified) is a
 * stronger guarantee than authenticating the *channel* (someone knows the
 * secret) — for webhooks, whose URL leaks easily, we want the former.
 *
 * `provided` may carry a scheme prefix (`sha256=...`), which is stripped before
 * comparison. Comparison is constant-time.
 */
export function verifyHmacSignature(secret: string, rawBody: string, provided: string): boolean {
  if (!provided) return false;
  // Accept `sha256=<hex>` (GitHub/Shopify style) as well as a bare hex digest.
  const supplied = provided.includes('=') ? provided.slice(provided.indexOf('=') + 1) : provided;
  const expected = hmacSha256Hex(secret, rawBody);
  return safeEqual(supplied, expected);
}
