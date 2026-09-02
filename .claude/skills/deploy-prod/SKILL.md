---
name: deploy-prod
description: Deploy Autoweb (this repo) to production on UpCloud at autoweb24.no. Use when asked to push, ship, deploy, or release to prod, or to check what is live.
---

# Deploy to production (UpCloud, autoweb24.no)

Production is one UpCloud server (`autoweb-prod`, `81.27.105.83`, SSH user
`autoweb`, key already installed on this machine). Render is gone; `render.yaml`
and `Dockerfile.render` are historical. Pushing to `main` does NOT deploy.

## Procedure

1. Commit and `git push origin main` (the script refuses commits not on origin/main).
2. Run the deploy (Bash tool, `timeout: 600000`):

   ```bash
   bash scripts/deploy-upcloud.sh            # deploys HEAD
   bash scripts/deploy-upcloud.sh <sha>      # deploys a specific pushed commit
   ```

   It archives the commit, uploads it, builds the api/worker/web images on the
   host (3-8 min; skipped if that SHA was built before), runs
   `infra/upcloud/scripts/deploy.sh` (migrate + `docker compose up`), and
   prints `/api/health`.
3. Verify: `bash scripts/deploy-upcloud.sh --status` shows `current=<sha>`,
   six containers healthy, and health JSON with `ok:true` and `worker:"up"`.
4. Report the SHA that is live.

The user can also run the same command themselves from the session prompt
with the `!` prefix.

## Rollback

```bash
ssh autoweb@81.27.105.83 /srv/autoweb/current/infra/upcloud/scripts/rollback.sh
```

## Notes

- Full runbook, compose file, and host scripts: `infra/upcloud/README.md`.
  The host copy lives at `/srv/autoweb/current/infra/upcloud`; if you change
  those scripts, copy them to the host too.
- Migrations run inside `deploy.sh`, so schema changes need nothing extra.
- Local release archives land in `tmp/upcloud-release-<short>/` (gitignored).
