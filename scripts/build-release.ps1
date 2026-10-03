param([string]$OutputDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) 'dist'))
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $outputRoot.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '发布包输出目录必须在项目内。' }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$releaseId = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$staging = Join-Path $outputRoot ('release-' + $releaseId)
New-Item -ItemType Directory -Path $staging | Out-Null
function Copy-Publish([string]$Relative, [bool]$Directory = $false, [string]$PhysicalSource = '') {
    $source = if ($PhysicalSource) { [IO.Path]::GetFullPath($PhysicalSource) } else { Join-Path $projectRoot $Relative }
    if (-not $source.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "发布源必须在项目内：$Relative" }
    if (-not (Test-Path -LiteralPath $source)) { throw "缺少发布文件：$Relative" }
    $items = @(Get-Item -LiteralPath $source)
    if ($Directory) { $items += @(Get-ChildItem -LiteralPath $source -Recurse -Force) }
    if ($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw "发布文件不能含链接：$Relative" }
    $destination = Join-Path $staging $Relative
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Recurse:$Directory
}
Get-Command node, pnpm, tar -ErrorAction Stop | Out-Null
Push-Location -LiteralPath $projectRoot
try {
    & pnpm run build | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Vue / TypeScript 构建失败。' }
    $package = Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json
    # pnpm links top-level dependencies into its virtual store. Resolve only ws,
    # then copy its physical files so the release remains independent of that store.
    $wsRoot = & node -e "const fs = require('node:fs'); const path = require('node:path'); console.log(fs.realpathSync(path.dirname(require.resolve('ws/package.json'))));"
    if ($LASTEXITCODE -ne 0) { throw '无法解析 ws 依赖，请执行 pnpm install --frozen-lockfile。' }
    $wsRoot = [IO.Path]::GetFullPath($wsRoot.Trim())
    $modulesRoot = Join-Path $projectRoot 'node_modules'
    if (-not $wsRoot.StartsWith($modulesRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'ws 必须安装在项目的 node_modules 内。' }
    $installedWs = Get-Content -LiteralPath (Join-Path $wsRoot 'package.json') -Raw | ConvertFrom-Json
    if ($installedWs.version -ne $package.dependencies.ws) { throw 'ws 版本与锁定依赖不符，请执行 pnpm install --frozen-lockfile。' }
    foreach ($name in @('server.js', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'README.md', 'scripts/ensure-build.cjs')) { Copy-Publish $name }
    foreach ($directory in @('dist/client', 'dist/server')) { Copy-Publish $directory $true }
    Copy-Publish 'node_modules/ws' $true $wsRoot
    foreach ($name in @('scripts/update-release.sh', 'scripts/install-linux.sh', 'scripts/nginx.conf.example')) { Copy-Publish $name }
    $javascript = @((Join-Path $staging 'server.js'), (Join-Path $staging 'dist/server/index.cjs'), (Join-Path $staging 'dist/client/sw.js'))
    foreach ($file in $javascript) { & node --check $file; if ($LASTEXITCODE -ne 0) { throw "语法检查失败：$file" } }
    $info = @{ release = $releaseId; nodeMinimum = 20; packageManager = $package.packageManager; ws = $installedWs.version; builtAtUtc = [DateTime]::UtcNow.ToString('o') }
    [IO.File]::WriteAllText((Join-Path $staging 'release-info.json'), ($info | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $archive = Join-Path $outputRoot ('ave-mujica-' + $releaseId + '.tar.gz')
    & tar -czf $archive -C $staging .
    if ($LASTEXITCODE -ne 0) { throw '发布包打包失败。' }
    $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($archive + '.sha256', "$hash  $([IO.Path]::GetFileName($archive))`n", [Text.UTF8Encoding]::new($false))
    Write-Host "已生成发布包：$archive"
    [PSCustomObject]@{ Archive = $archive; Release = $releaseId; Sha256 = $hash; Staging = $staging }
} finally { Pop-Location }
