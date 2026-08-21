$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

Add-Type -AssemblyName System.Windows.Forms | Out-Null

function Text([int[]]$codes) {
  -join ($codes | ForEach-Object { [char]$_ })
}

$tOk = Text 0x90E8, 0x7F72, 0x6210, 0x529F
$tFail = Text 0x90E8, 0x7F72, 0x5931, 0x8D25
$site = "https://ruofei6666.github.io/Ave-Mujica-/"
$hint = (Text 0x5927, 0x7EA6, 0x0031, 0x5206, 0x949F, 0x540E, 0x5237, 0x65B0, 0x5373, 0x53EF) + "`r`n" + $site
$latest = (Text 0x6CA1, 0x6709, 0x65B0, 0x4FEE, 0x6539, 0xFF0C, 0x7F51, 0x7AD9, 0x5DF2, 0x662F, 0x6700, 0x65B0) + "`r`n" + $site

function Popup($ok, $body) {
  $title = if ($ok) { $tOk } else { $tFail }
  $icon = if ($ok) { [System.Windows.Forms.MessageBoxIcon]::Information } else { [System.Windows.Forms.MessageBoxIcon]::Error }
  Write-Host ""
  Write-Host $title -ForegroundColor $(if ($ok) { "Green" } else { "Red" })
  Write-Host $body
  [System.Windows.Forms.MessageBox]::Show($body, $title, [System.Windows.Forms.MessageBoxButtons]::OK, $icon) | Out-Null
}

try {
  Write-Host ""
  Write-Host "Ave Mujica" -ForegroundColor Cyan

  $src = Get-ChildItem -File -Filter "*.html" |
    Where-Object { $_.Name -ne "index.html" } |
    Select-Object -First 1

  if (-not $src) {
    Popup $false "HTML not found"
    exit 1
  }

  Copy-Item -LiteralPath $src.FullName -Destination (Join-Path $PSScriptRoot "index.html") -Force

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
    Popup $true $latest
    exit 0
  }

  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
  $msg = "Update Ave Mujica ($stamp)"
  & git.exe @("commit", "-m", $msg)
  if ($LASTEXITCODE -ne 0) {
    Popup $false "git commit failed"
    exit 1
  }

  git push origin HEAD
  if ($LASTEXITCODE -ne 0) {
    Popup $false "git push failed"
    exit 1
  }

  Popup $true $hint
  exit 0
}
catch {
  Popup $false $_.Exception.Message
  exit 1
}
