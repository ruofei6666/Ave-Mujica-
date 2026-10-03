@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.13 或更高版本。
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);if(major < 22 || (major === 22 && minor < 13))process.exit(1)"
if errorlevel 1 (
  echo 当前 Node.js 版本过旧，需要 22.13 或更高版本。
  pause
  exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 (
  echo 请先运行 npm install --global pnpm@11.25.0，安装后重新打开本窗口。
  pause
  exit /b 1
)
call pnpm install --frozen-lockfile
if errorlevel 1 (
  echo 依赖安装失败，请检查 pnpm 版本和网络后重试。
  pause
  exit /b 1
)
if not defined HOST set "HOST=0.0.0.0"
if not defined PORT set "PORT=3000"
echo 本机浏览器：http://localhost:%PORT%
echo 同一 Wi-Fi 的手机可尝试以下地址；需允许 Windows 防火墙的专用网络访问。
powershell.exe -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { Write-Host ('http://' + $_.IPAddress + ':' + $env:PORT) }"
echo 这些是局域网候选地址，不代表公网可访问。关闭窗口会停止服务。
echo 正在构建 Vue 客户端和 TypeScript 房间服务…
call pnpm run build
if errorlevel 1 (
  echo 构建失败，请查看上面的错误信息。
  pause
  exit /b 1
)
node server.js
pause
