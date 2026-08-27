param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$AppSha,
  [string]$OutputDirectory = "dist/upcloud"
)

$ErrorActionPreference = "Stop"

if ((git status --porcelain).Length -ne 0) {
  throw "The migration worktree is dirty. Commit infrastructure changes before preparing a release."
}

git cat-file -e "$AppSha`^{commit}"
if ($LASTEXITCODE -ne 0) {
  throw "App SHA $AppSha does not exist in this repository."
}

$appPaths = @("apps", "packages", "prisma", "package.json", "package-lock.json", "Dockerfile.render", "scripts/render-start.sh", "scripts/init-log-db.mjs")
git diff --quiet $AppSha -- $appPaths
if ($LASTEXITCODE -ne 0) {
  throw "The migration branch changes application release inputs relative to $AppSha."
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$archive = Join-Path $OutputDirectory "autoweb-app-$AppSha.tar"
$checksum = "$archive.sha256"

git archive --format=tar --output=$archive $AppSha
if ($LASTEXITCODE -ne 0) {
  throw "git archive failed."
}

$hash = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
Set-Content -Encoding ascii -NoNewline -Path $checksum -Value "$hash  $(Split-Path -Leaf $archive)`n"

Write-Output "Archive: $archive"
Write-Output "SHA256:  $hash"
