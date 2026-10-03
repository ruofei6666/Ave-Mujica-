param([string]$ConfigPath = (Join-Path $PSScriptRoot '.deploy/target.json'), [switch]$PackageOnly)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
function Quote-Shell([string]$Value) { "'" + $Value.Replace("'", "'\''") + "'" }
function Run-Native([string]$Program, [string[]]$Arguments) { & $Program @Arguments; if ($LASTEXITCODE -ne 0) { throw "$Program 失败，退出码 $LASTEXITCODE。" } }
try {
    $release = & (Join-Path $PSScriptRoot 'scripts/build-release.ps1')
    if ($PackageOnly) { Write-Host '仅打包：未连接服务器、未上传、未部署。'; exit 0 }
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw '请先按 README 安装云服务器，把 scripts/deploy.example.json 复制到 .deploy/target.json 并填写 SSH 信息。发布包已生成。' }
    $target = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    $targetHost = [string]$target.host; $targetUser = [string]$target.user; $targetPort = [int]$target.port; $remotePath = [string]$target.remotePath
    $service = if ($target.service) { [string]$target.service } else { 'ave-mujica' }
    if ($targetHost -notmatch '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' -or $targetUser -notmatch '^[a-z_][a-z0-9_-]{0,31}$' -or $targetPort -lt 1 -or $targetPort -gt 65535) { throw 'SSH host/user/port 无效。' }
    if ($remotePath -notmatch '^/(opt|srv)/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$' -or $remotePath.Split('/') -contains '..' -or $remotePath.Split('/') -contains '.') { throw 'remotePath 必须是 /opt 或 /srv 下的专用目录，例如 /opt/ave-mujica。' }
    if ($service -notmatch '^[a-z][a-z0-9-]{0,63}$') { throw '服务名无效。' }
    Get-Command ssh, scp -ErrorAction Stop | Out-Null
    $destination = "$targetUser@$targetHost"
    $scpHost = if ($targetHost.Contains(':')) { "[$targetHost]" } else { $targetHost }
    $remoteArchive = '/tmp/ave-mujica-' + $release.Release + '.tar.gz'
    $sshOptions = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
    Run-Native 'scp' ($sshOptions + @('-P', [string]$targetPort, $release.Archive, "${targetUser}@${scpHost}:$remoteArchive"))
    $command = @'
set -eu
archive=__ARCHIVE__
test "$(sha256sum "$archive" | cut -d ' ' -f 1)" = __HASH__
work=$(mktemp -d /tmp/ave-mujica-update.XXXXXX)
trap 'case "$work" in /tmp/ave-mujica-update.*) rm -rf -- "$work" ;; esac' EXIT
tar -xzf "$archive" -C "$work" ./scripts/update-release.sh
if [ "$(id -u)" -eq 0 ]; then
  bash "$work/scripts/update-release.sh" __ROOT__ "$archive" __SERVICE__ __RELEASE__
else
  sudo -n bash "$work/scripts/update-release.sh" __ROOT__ "$archive" __SERVICE__ __RELEASE__
fi
rm -f -- "$archive"
'@
    $command = $command.Replace('__ARCHIVE__', (Quote-Shell $remoteArchive)).Replace('__HASH__', (Quote-Shell $release.Sha256)).Replace('__ROOT__', (Quote-Shell $remotePath)).Replace('__SERVICE__', (Quote-Shell $service)).Replace('__RELEASE__', (Quote-Shell $release.Release)).Replace("`r`n", "`n")
    Run-Native 'ssh' ($sshOptions + @('-p', [string]$targetPort, $destination, $command))
    Write-Host '更新完成，服务器已通过健康检查。' -ForegroundColor Green
    Write-Host '服务重启会结束已有房间；公网 HTTPS 与手机速度须另外实测。'
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; Write-Host '切换后健康检查失败会恢复上一版本；首次安装没有旧版本可恢复。'; exit 1 }
