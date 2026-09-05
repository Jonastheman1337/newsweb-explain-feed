# Notice-quality release validation, 5 September 2026

The owner authorized fresh comparisons and actual worker verification, followed
by release only when the gates pass. Sak, model settings, historical
republication and production infrastructure changes remain excluded.

## First candidate rejected

The first candidate, `b52b306cb826ed73db7c333f1a80ea792a71da56`, was compared
against production `fa7701e09a14c3b2ebe17d14691a0af10a5e9525` on 24 fresh
public notices. Both arms ran the real worker, PostgreSQL publication path and
Redis queue in isolated validation projects. Inputs, model settings, terminal
queue states, source hashes and immutable publication ownership were verified.

Blinded agent review of the final outputs gave the candidate 7 wins, the
baseline 9 wins, 6 ties and 2 both-bad outcomes. The candidate preference rate
was 43.75%, below the 65% release threshold. Seven material regressions included
five blocked financial reports, a skipped liquidity update and an omitted
dividend-payment condition. There were no fatal factual findings or marker
leaks. Production was not changed.

Passing 1,138 local tests, builds and the real worker's synthetic ownership,
retry, completeness and replay checks did not override that editorial failure.
The original source corpus, outputs, blind assignments and reviews are retained
unchanged under `tmp/notice-release-2026-09-05/`.

## Remediation and confirmation

The next candidate addresses extraction of real PDF table geometry and
financial headers, preservation of raw evidence, materially important financing
status, and payment conditions. Completeness review receives the original
sources, rather than just the planner's selected excerpts. A notice-only
checker retry can correct malformed source annotations on unchanged article
bytes; invalid source IDs, unsupported numbers and missing historical markers
continue to block publication. Optional historical background can be removed
on the final article repair while essential facts remain protected.

Independent synthetic parser review also found unsafe period and entity
inheritance in narrative facts, note lists acting as number-format witnesses,
older grouped headers overriding newer explicit headers, forward scope
inheritance across a parent-company section, and property NOI displacing
ordinary operating profit. These are blockers even if a later model could
notice the conflicting raw text. Their reproductions must fail safely after
repair, alongside replay of the unchanged original report attachments. An
ambiguous metric, period, scope or number format must not become an aligned,
usable financial fact merely to make report readiness pass.

Original cases are now regression cases, not held-out promotion evidence. The
new held-out cohort contains 24 different issuers selected from public source
titles and categories before model generation. It covers seven reports, six
deals, three financing/legal notices, five operating/governance updates and
three routine controls. The only annual notice in the original date window
was already used; annual behavior remains covered separately.

Source-first expectations and independently randomized balanced A/B assignment
are frozen before outputs are reviewed. Each final article pair receives one
agent review; this is neither human-editor approval nor a statistical estimate
of production-wide quality. Both review files must be saved before unblinding.

The unchanged gates require at least 65% candidate preference among decided
pairs, no increase in fatal findings, no marker leaks, no material candidate
regression, no aggregate dimension regression and no financing loss of two
points. Real worker integration, build, backup, preflight and live behavior
remain separate requirements. A failed gate means another fix and a new
candidate, not relabeling an existing run as successful.

## Evidence identities and release controls

- Initial corpus SHA256:
  `8998beecc707e3de2e655d88c661d8fe4f950ee9c1dae3290dd5265a4d8d6140`.
- Initial baseline artifact SHA256:
  `4cf325c11a7309194aa68c9bf37e7b369a6ed272d52e224bb9cbab6a28fc86b4`.
- Initial candidate artifact SHA256:
  `01924a4fab726bb25b1827ae9f819a58408a4a95873d69c3c6bd25e304fb8542`.
- New held-out corpus SHA256:
  `57b2854b87dacf81cbe1a4e75fb2aa5d24249658b07d47782d9471be9d318922`.
- New blind protocol SHA256:
  `8cfb15b6e35a171257e9b6868fecc6d82d7561a2338c94d70ad9934bc872fd47`.

Validation uses frozen public sources, isolated databases and internal-only
networks, with polling and mail disabled. The model credential stays on the
local machine; a private SSH socket relays permitted validation requests to
the local authenticated transport. No production notice is republished.

Final run receipts record the sealed Git revision, exact image, model profile,
source/publication hashes, latency and token usage. This document records the
plan and rejected first candidate; it does not declare the replacement passed.
A successful release must use the maintained UpCloud archive/build/deploy path,
a fresh verified backup, and exact deployed identity plus public behavior checks.
