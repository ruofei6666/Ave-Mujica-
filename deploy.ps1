$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

Write-Host ""
Write-Host "Ave Mujica deploy" -ForegroundColor Cyan
Write-Host "-----------------"

$src = Get-ChildItem -File -Filter "*.html" |
  Where-Object { $_.Name -ne "index.html" } |
  Select-Object -First 1

if (-not $src) {
  Write-Host "Game HTML file not found." -ForegroundColor Red
  exit 1
}

Copy-Item -LiteralPath $src.FullName -Destination (Join-Path $PSScriptRoot "index.html") -Force
Write-Host ("Synced {0} -> index.html" -f $src.Name)

$gitName = git config --get user.name
if (-not $gitName) {
  $env:GIT_AUTHOR_NAME = "ruofei6666"
  $env:GIT_AUTHOR_EMAIL = "ruofei6666@users.noreply.github.com"
  $env:GIT_COMMITTER_NAME = "ruofei6666"
  $env:GIT_COMMITTER_EMAIL = "ruofei6666@users.noreply.github.com"
}

git add -A
$status = git status --porcelain
if (-not $status) {
  Write-Host "No changes. Site is already up to date." -ForegroundColor Yellow
  Write-Host "https://ruofei6666.github.io/Ave-Mujica-/"
  exit 0
}

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
$msg = "Update Ave Mujica ($stamp)"
& git.exe @("commit", "-m", $msg)
if ($LASTEXITCODE -ne 0) {
  Write-Host "Commit failed." -ForegroundColor Red
  exit 1
}

Write-Host "Pushing to GitHub..."
git push origin HEAD
if ($LASTEXITCODE -ne 0) {
  Write-Host "Push failed. Check network or GitHub login." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Deployed. Refresh in about 1 minute:" -ForegroundColor Green
Write-Host "https://ruofei6666.github.io/Ave-Mujica-/"
Write-Host ""
