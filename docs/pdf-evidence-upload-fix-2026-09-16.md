# PDF evidence and upload repair — 2026-09-16

## Scope

CMB.Tech notice 682396 failed regeneration because both report filenames bypassed financial-report extraction; the generic path truncated one attachment before its financial statement. A separate upload attempt on notice 682395 failed in Next.js middleware: its 10 MB body clone truncated the 12.2 MB PDF before multipart parsing.

## Change

- Exclude API requests from host-redirect middleware and configure a body allowance above the 40 MiB API file limit.
- Validate uploaded PDF bytes independently of filenames/MIME types. Keep original extracted pages privately for instruction-aware selection at regeneration time.
- Prioritise financial statements and requested pages before packing uploaded text. Keep original units, periods and continuation pages.
- Use bounded multi-attachment content inspection for report routing; prefer compact financial reports and keep a complementary report. Preserve production PDF rendering and cancellation.
- Reuse inspected PDF bytes/pages within the source object's lifetime; no persistent cross-generation PDF cache.
- Keep image-only uploaded PDFs on a visual transcription fallback. Reject incomplete transcription instead of saving it as ready.
- Leave generation status wording unchanged.

## Verification before release

- Actual 33-page/35,050,403-byte report: page 27 retained.
- Actual 53-page/12,197,856-byte financial report: pages 4–5 retained.
- Reversed attachment order, opaque filenames, failed first attachment and no-instruction continuation checks passed.
- Multipart route accepted a 35 MiB PDF with an extensionless name and generic MIME type; fake PDFs rejected; empty extraction remains failed.
- Both original PDF uploads preserve profit 733,214 in their packed input without model extraction.
- Image-only copy of the statement: live visual fallback recovered current/prior profit (733,214 / 32,789).
- Writer/source-check replay produced a results-led draft. Normal source repair reached 100% coverage. Numeric matcher warning remains a warning under the existing fresh-reference publication policy; no numeric/reference guard was loosened.
- Focused API, worker, shared selection and BFF tests passed. Full release build required before push.

Local Next server launch was blocked by automatic approval review, including after user permission. Full public-route upload verification is therefore a mandatory postdeployment check. Paid replay/real-PDF artifacts are in the isolated worktree's ignored tmp directory. Production upload/regeneration verification and exact release receipt follow in the task.
