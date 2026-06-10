/**
 * Integration tests for GET /api/v1/agents/:id/badge
 *
 * Seeds D1 with agent #1 (no metadata values) and verifies badge responses.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env as rawEnv } from "cloudflare:test";
import type { Env } from "../types";
import { setupDb, clearData } from "./helpers";

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
});
