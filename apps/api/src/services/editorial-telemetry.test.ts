import { describe, expect, it } from "vitest";
import {
  editorialTelemetrySchema,
  hashTelemetryId
} from "./editorial-telemetry.js";

describe("editorial telemetry helpers", () => {
  it("hashes telemetry identifiers without storing the raw value", () => {
    const rawId = "editor-browser-id";
    const hash = hashTelemetryId("session-secret", rawId);

    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(rawId);
    expect(hash).toEqual(hashTelemetryId("session-secret", rawId));
    expect(hash).not.toEqual(hashTelemetryId("other-secret", rawId));
  });

  it("accepts the exact immutable publication identity rendered by the client", () => {
    expect(
      editorialTelemetrySchema.parse({
        version: 3,
        rewriteId: "published-rewrite-3",
        publicationRevision: 4,
        contentHash: "sha256-content-hash",
        isFinal: true
      })
    ).toMatchObject({
      rewriteId: "published-rewrite-3",
      publicationRevision: 4,
      contentHash: "sha256-content-hash",
      isFinal: true
    });
  });
});
