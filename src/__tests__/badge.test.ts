/**
 * Integration tests for GET /api/v1/agents/:id/badge
 *
 * Seeds D1 with agent #1 (no metadata values) and verifies badge responses.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env as rawEnv } from "cloudflare:test";
import type { Env } from "../types";
import { setupDb, clearData } from "./helpers";
import { esc } from "../routes/badge";

import applyIdentityFixture from "./fixtures/apply-identity.json";

const env = rawEnv as unknown as Env;
const TEST_SECRET = "test-api-secret";
const WEBHOOK_URL = "http://localhost/webhook";
const BASE_URL = "http://localhost/api/v1";

async function postWebhook(body: unknown): Promise<Response> {
  return SELF.fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TEST_SECRET}`,
    },
    body: JSON.stringify(body),
  });
}

async function getBadge(path: string): Promise<Response> {
  return SELF.fetch(`${BASE_URL}${path}`);
}

beforeEach(async () => {
  await setupDb(env.DB);
  await clearData(env.DB);
  await env.INDEXER_KV.put("webhook_secret", TEST_SECRET);
  const res = await postWebhook(applyIdentityFixture);
  if (!res.ok) throw new Error(`Identity fixture failed: ${res.status}`);
});

// ── esc() unit tests ──────────────────────────────────────────────────────────

describe("esc()", () => {
  it("escapes all five XML/HTML special characters", () => {
    expect(esc(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("escapes single quotes — prevents onclick attribute injection", () => {
    // A malicious agent name containing a single quote must not break out of
    // onclick="fn('${esc(val)}')" — if ' is unescaped the string terminates early.
    expect(esc("it's me")).toBe("it&#39;s me");
    expect(esc("'; alert(1); //")).toBe("&#39;; alert(1); //");
  });

  it("escapes double quotes — prevents attribute boundary injection", () => {
    expect(esc(`"><svg/onload=alert(1)>`)).toBe(
      "&quot;&gt;&lt;svg/onload=alert(1)&gt;"
    );
  });

  it("escapes ampersands first to avoid double-encoding", () => {
    expect(esc("a & b")).toBe("a &amp; b");
    // Ensure & in an entity-like string doesn't produce double-encoding
    expect(esc("&amp;")).toBe("&amp;amp;");
  });

  it("handles null and undefined gracefully", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });

  it("handles non-string inputs", () => {
    expect(esc(42)).toBe("42");
    expect(esc(true)).toBe("true");
  });

  it("passes clean strings through unchanged", () => {
    const clean = "ERC-8004 AGENT #42";
    expect(esc(clean)).toBe(clean);
  });
});

// ── Route integration tests ───────────────────────────────────────────────────

describe("GET /api/v1/agents/:id/badge", () => {
  it("returns SVG with correct Content-Type for registered agent", async () => {
    const res = await getBadge("/agents/1/badge");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    const body = await res.text();
    expect(body).toContain("<svg");
    expect(body).toContain("ERC-8004");
  });

  it("includes the agent ID in the badge SVG", async () => {
    const res = await getBadge("/agents/1/badge");
    const body = await res.text();
    expect(body).toContain("#1");
  });

  it("returns pill style badge", async () => {
    const res = await getBadge("/agents/1/badge?style=pill");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<svg");
    // Pill is narrower — height is 24
    expect(body).toContain('height="24"');
  });

  it("returns card style badge", async () => {
    const res = await getBadge("/agents/1/badge?style=card");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<svg");
    // Card is taller — height is 92
    expect(body).toContain('height="92"');
    // Card shows registered block
    expect(body).toContain("registered block");
  });

  it("sets Cache-Control on success", async () => {
    const res = await getBadge("/agents/1/badge");
    expect(res.headers.get("Cache-Control")).toContain("max-age=3600");
  });

  it("returns 404 SVG for unknown agent", async () => {
    const res = await getBadge("/agents/9999/badge");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    const body = await res.text();
    expect(body).toContain("agent not found");
  });

  it("returns 400 SVG for invalid agent ID", async () => {
    const res = await getBadge("/agents/abc/badge");
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("<svg");
  });

  it("returns 400 SVG for invalid style param", async () => {
    const res = await getBadge("/agents/1/badge?style=unknown");
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("style must be");
  });

  it("ignores unknown query params and returns valid badge", async () => {
    // Unknown params like ?v=123 must not affect the response — the handler only
    // reads `style`. This also documents that cache normalization (to avoid
    // edge-cache fragmentation) must be handled at the CF Cache Rules layer.
    const res = await getBadge("/agents/1/badge?style=pill&v=123&bust=abc");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<svg");
    expect(body).toContain('height="24"');
  });
});
