import { describe, expect, it } from "vitest";
import {
  classifyIngestJobName,
  ingestJobNames
} from "./ingest-job-routing.js";

describe("classifyIngestJobName", () => {
  it.each([
    [ingestJobNames.cleanup, "cleanup"],
    [ingestJobNames.numericShadowMonitor, "numericShadowMonitor"],
    [ingestJobNames.poll, "poll"],
    [ingestJobNames.notice, "notice"]
  ] as const)("classifies %s as %s", (jobName, expected) => {
    expect(classifyIngestJobName(jobName)).toBe(expected);
  });

  it("does not reinterpret an unknown maintenance job as a notice ingest", () => {
    expect(classifyIngestJobName("future-maintenance-job")).toBe("unsupported");
  });
});
