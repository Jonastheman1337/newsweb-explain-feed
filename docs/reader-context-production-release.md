# Reader context and original-passage verification release

Baseline: f4a21b82a157b6b0e36907d662ecee3f28a26034. Prepared 17 September 2026.

This release ports reader context and bound verification into the existing production pipeline. It does not ship the separate local notice-pipeline/brief refactor. Regular notices retrieve useful earlier source paragraphs after triage and before writing. The shared writer principle is a short explanation of the latest development with enough context for an unfamiliar reader, without fixed paragraph placement.

Retrieval is bounded to two rounds, forty same-issuer candidates per round, four documents read, and 24,000 selected characters. Earlier publication times and original paragraph IDs are checked. Already-validated triage sources remain intact when extra reader context is added; those retained sources can exceed the optional retrieval's four-document limit. Failure retains eligible existing sources and records fallback telemetry.

The regular notice verifier selects server-created source/hash/paragraph IDs and checks meaning, entity, amount, currency, time and status. Invalid evidence IDs receive one checker-only retry. Unsupported claims use the existing article repair loop, then fail closed if unresolved. Final links are attached only when the checked sentences equal the final article. Exact anchors link to the supporting Newsweb ID; ambiguous mixed-source anchors are not guessed. Existing report verification flows remain unchanged.

Defaults: READER_CONTEXT_ENABLED=true and REFERENCE_BINDING_MODE=bound. Independent emergency switches are false and legacy respectively. Full application rollback is the preferred way to restore the entire previous behavior. No database migrations.

Validation:
- Full application build passed; final worker source recompiled after attachment-input deduplication.
- Focused worker, mapper and link tests passed; shared prompt tests updated to assert flexible context rather than old placement bans.
- Five fresh public-source replays used the production hybrid writer, reader retrieval, bound verifier and existing repair loop: Elmera 682534, TORM 682509, Vend 682514, Borr 682516, DNO 682522.
- All five passed source verification and final publication gates. Borr required the existing numeric repair to replace 4.3 million with the exact amount; a nonblocking quote-opportunity warning remains. This is not evidence that the existing numeric matcher or writing style is ideal.
- Replay finalization was staged: original model drafts were first checked; then the production source-limitations helper and high-risk warning repair policy were applied to those same saved drafts. These are bounded offline replays, not full queue/publication integration tests.
- Artifacts are in tmp/release-replay in the isolated release worktree; they are public source text and model outputs, not checked into Git.

Postdeploy acceptance must verify the exact image revision, live configuration, authenticated routes, worker/polling health and a generation through the deployed pipeline. The previous production SHA above is the rollback target.
