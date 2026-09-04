import { describe, expect, it } from "vitest";

import { buildUpstreamInit, buildUpstreamUrl, readUpstreamBody } from "./bff-proxy";

const OWNER = "editor-0123456789";

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

describe("buildUpstreamInit", () => {
  it("forwards method, bearer token and x-sak-owner", () => {
    const request = new Request("http://web.local/api/sak", {
      method: "POST",
      headers: { "x-sak-owner": OWNER, "x-other": "ignored" }
    });

    const init = buildUpstreamInit(request, "session-token", {
      kind: "text",
      text: '{"targetChars":2500}',
      contentType: "application/json"
    });

    expect(init.method).toBe("POST");
    expect(headersOf(init)).toEqual({
      Authorization: "Bearer session-token",
      "x-sak-owner": OWNER,
      "Content-Type": "application/json"
    });
    expect(init.body).toBe('{"targetChars":2500}');
    expect(init.cache).toBeUndefined();
  });

  it("omits the bearer header without a token and never caches GET", () => {
    const request = new Request("http://web.local/api/sak", {
      headers: { "x-sak-owner": OWNER }
    });

    const init = buildUpstreamInit(request, null, null);

    expect(init.method).toBe("GET");
    expect(headersOf(init)).toEqual({ "x-sak-owner": OWNER });
    expect(init.body).toBeUndefined();
    expect(init.cache).toBe("no-store");
  });

  it("passes multipart bodies through untouched and lets fetch set the boundary", () => {
    const formData = new FormData();
    formData.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "a.pdf");
    const request = new Request("http://web.local/api/sak/abc/materials/pdf", {
      method: "POST",
      headers: { "x-sak-owner": OWNER, "content-type": "multipart/form-data; boundary=x" }
    });

    const init = buildUpstreamInit(request, "tok", { kind: "form", data: formData });

    expect(init.body).toBe(formData);
    expect(headersOf(init)["Content-Type"]).toBeUndefined();
    expect(headersOf(init)["content-type"]).toBeUndefined();
  });

  it("ignores a body for GET", () => {
    const request = new Request("http://web.local/api/sak");
    const init = buildUpstreamInit(request, null, {
      kind: "text",
      text: "{}",
      contentType: "application/json"
    });
    expect(init.body).toBeUndefined();
  });
});

describe("buildUpstreamUrl", () => {
  it("forwards the query string", () => {
    const request = new Request(
      "http://web.local/api/sak/abc/status?jobId=job-1&version=2"
    );
    expect(buildUpstreamUrl("http://api:4000", "/sak/abc/status", request)).toBe(
      "http://api:4000/sak/abc/status?jobId=job-1&version=2"
    );
  });

  it("leaves the path alone without a query", () => {
    const request = new Request("http://web.local/api/sak");
    expect(buildUpstreamUrl("http://api:4000", "/sak", request)).toBe("http://api:4000/sak");
  });
});

describe("readUpstreamBody", () => {
  it("returns null for GET and for an empty body", async () => {
    expect(await readUpstreamBody(new Request("http://web.local/api/sak"))).toBeNull();
    expect(
      await readUpstreamBody(new Request("http://web.local/api/sak/x", { method: "DELETE" }))
    ).toBeNull();
  });

  it("reads JSON as text with its content type", async () => {
    const body = await readUpstreamBody(
      new Request("http://web.local/api/sak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"url":"https://e24.no"}'
      })
    );
    expect(body).toEqual({
      kind: "text",
      text: '{"url":"https://e24.no"}',
      contentType: "application/json"
    });
  });

  it("reads multipart as FormData", async () => {
    const formData = new FormData();
    formData.append("file", new Blob(["x"], { type: "application/pdf" }), "a.pdf");
    const body = await readUpstreamBody(
      new Request("http://web.local/api/sak/x/materials/pdf", {
        method: "POST",
        body: formData
      })
    );
    expect(body?.kind).toBe("form");
    if (body?.kind === "form") {
      expect(body.data.get("file")).toBeInstanceOf(Blob);
    }
  });
});
