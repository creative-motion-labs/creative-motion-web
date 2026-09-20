/**
 * Run: npx tsx --test app/lib/research/volunteer-repetition-request.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { VOLUNTEER_NO_CACHE_HEADERS } from "./volunteer-api-guards";
import { readVolunteerRepetitionJsonBody } from "./volunteer-repetition-request";
import { VOLUNTEER_REPETITION_MAX_JSON_BYTES } from "./volunteer-repetition-validation";

function streamRequest(
  bytes: Uint8Array,
  headers: Record<string, string> = {},
): NextRequest {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reqHeaders: Record<string, string> = { ...headers };
  if (!("content-type" in reqHeaders) && !("Content-Type" in reqHeaders)) {
    reqHeaders["content-type"] = "application/json";
  }
  return new NextRequest("http://localhost/api/research/volunteer/repetitions", {
    method: "POST",
    headers: reqHeaders,
    body: stream,
    duplex: "half",
  } as RequestInit);
}

function assertNoCacheHeaders(response: Response): void {
  for (const [name, value] of Object.entries(VOLUNTEER_NO_CACHE_HEADERS)) {
    assert.equal(response.headers.get(name), value, name);
  }
}

describe("readVolunteerRepetitionJsonBody", () => {
  it("rejects when Content-Length exceeds the cap before reading", async () => {
    const req = streamRequest(new Uint8Array([123, 125]), {
      "content-length": String(VOLUNTEER_REPETITION_MAX_JSON_BYTES + 1),
    });
    const result = await readVolunteerRepetitionJsonBody(req);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 413);
      assertNoCacheHeaders(result.response);
    }
  });

  it("rejects oversized body when Content-Length is absent", async () => {
    const oversized = Buffer.alloc(VOLUNTEER_REPETITION_MAX_JSON_BYTES + 1, 0x41);
    const req = streamRequest(oversized);
    const result = await readVolunteerRepetitionJsonBody(req);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, 413);
  });

  it("rejects oversized body when Content-Length is misleadingly small", async () => {
    const oversized = Buffer.alloc(VOLUNTEER_REPETITION_MAX_JSON_BYTES + 64, 0x42);
    const req = streamRequest(oversized, { "content-length": "16" });
    const result = await readVolunteerRepetitionJsonBody(req);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, 413);
  });

  it("rejects invalid or negative Content-Length before streaming", async () => {
    for (const header of ["-1", "not-a-number"]) {
      const req = streamRequest(Buffer.from("{}", "utf8"), { "content-length": header });
      const result = await readVolunteerRepetitionJsonBody(req);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.response.status, 413);
    }
  });

  it("accepts valid JSON without Content-Length", async () => {
    const text = JSON.stringify({ ok: true });
    const req = streamRequest(Buffer.from(text, "utf8"));
    const result = await readVolunteerRepetitionJsonBody(req);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.body, { ok: true });
  });

  it("accepts application/json with charset", async () => {
    const text = JSON.stringify({ ok: true });
    const req = streamRequest(Buffer.from(text, "utf8"), {
      "content-type": "application/json; charset=utf-8",
    });
    const result = await readVolunteerRepetitionJsonBody(req);
    assert.equal(result.ok, true);
  });

  it("returns 415 for missing Content-Type", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from("{}", "utf8"));
        controller.close();
      },
    });
    const req = new NextRequest("http://localhost/api/research/volunteer/repetitions", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    const result = await readVolunteerRepetitionJsonBody(req);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 415);
      assertNoCacheHeaders(result.response);
    }
  });

  it("returns 415 for unsupported Content-Type", async () => {
    const req = streamRequest(Buffer.from("{}", "utf8"), { "content-type": "text/plain" });
    const result = await readVolunteerRepetitionJsonBody(req);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, 415);
  });

  it("returns 400 for malformed JSON", async () => {
    const req = streamRequest(Buffer.from("{not-json", "utf8"));
    const result = await readVolunteerRepetitionJsonBody(req);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, 400);
  });

  it("returns 400 for invalid UTF-8", async () => {
    const req = streamRequest(Uint8Array.from([0xff, 0xfe, 0xfd]));
    const result = await readVolunteerRepetitionJsonBody(req);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, 400);
  });

  it("returns 400 for empty body", async () => {
    const req = streamRequest(new Uint8Array());
    const result = await readVolunteerRepetitionJsonBody(req);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, 400);
  });

  it("returns 400 for array top-level JSON", async () => {
    const req = streamRequest(Buffer.from("[]", "utf8"));
    const result = await readVolunteerRepetitionJsonBody(req);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, 400);
  });

  it("returns 400 for string top-level JSON", async () => {
    const req = streamRequest(Buffer.from(JSON.stringify("hello"), "utf8"));
    const result = await readVolunteerRepetitionJsonBody(req);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, 400);
  });

  it("returns 400 for null top-level JSON", async () => {
    const req = streamRequest(Buffer.from("null", "utf8"));
    const result = await readVolunteerRepetitionJsonBody(req);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, 400);
  });
});
