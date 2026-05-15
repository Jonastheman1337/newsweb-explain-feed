import { describe, expect, it } from "vitest";
import { hashTelemetryId } from "./editorial-telemetry.js";

describe("editorial telemetry helpers", () => {
  it("hashes telemetry identifiers without storing the raw value", () => {
    const rawId = "editor-browser-id";
    const hash = hashTelemetryId("session-secret", rawId);

    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(rawId);
    expect(hash).toEqual(hashTelemetryId("session-secret", rawId));
    expect(hash).not.toEqual(hashTelemetryId("other-secret", rawId));
  });
});
