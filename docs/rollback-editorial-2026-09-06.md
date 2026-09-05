# Restore the pre-v5.12 production application

The owner requested rollback to the application state before the large editorial
pipeline release. Restore the tracked tree from `fa7701e09a14c3b2ebe17d14691a0af10a5e9525`
on a new descendant of `c5c8949`, preserving Git history and unrelated local work.
All writer prompts and worker code return to that exact historical version.

One compatibility exception is necessary: accept an empty `company_sentence`
when parsing saved articles. The newer release has stored valid articles with
that empty metadata field. A direct image rollback exposed a feed HTTP 500 from
the older parser's ten-character minimum. The working release was restored while
this compatibility rollback was prepared. No saved article is modified or deleted.
Historical generation JSON schemas remain unchanged.

A regression test checks that an immutable published article with empty company
context remains visible with the same title, body and content hash.

There are no Prisma schema or migration differences between the two releases.
A fresh PostgreSQL backup passed its checksum check before the initial rollback.
Deployment must take another fresh backup and verify authenticated feed, notice,
attachment, SSE and admin routes, plus the running v5.11.0 writer and exact image
revision. This is an application rollback, not a database restore.

Validation before release: shared tests 17 passed; prompt-kit 156 passed; worker
582 passed with one existing skip; API feed mapper 8 passed, including the new
rollback compatibility case. The application build includes all five workspaces.
