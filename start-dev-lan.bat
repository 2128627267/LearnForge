@echo off
rem Start LearnForge dev server (LAN mode)
rem 局域网模式启动脚本：允许同一局域网内的设备（手机/平板）访问本应用。
rem 与默认的 start-dev.bat（回环绑定，禁止局域网访问）互斥，按需选用。
cd /d "%~dp0"
echo ============================================
echo  Starting LearnForge dev server (LAN mode)...
echo ============================================
rem -H 0.0.0.0: 监听所有网卡，局域网设备可通过本机 IP 访问
rem              （首次启动 Windows 会弹出防火墙授权，需选择"允许"）
rem LAN_ACCESS=1: 局域网模式标记。绑定 0.0.0.0 后，局域网内主机可
rem              伪造 Host: localhost 头绕过 /api/local-token 的来源
rem              校验窃取 LOCAL_ACCESS_TOKEN，故该模式下自动下发端点
rem              直接禁用（见 app/api/local-token/route.ts），令牌一律
rem              由浏览器端手动输入（详见 app/layout.tsx 引导脚本）。
set "LAN_ACCESS=1"
echo  Open on this PC: http://localhost:3000
echo  Open on LAN devices (try each address on your phone):
rem 列出本机局域网 IPv4 地址（过滤回环 127.* 与链路本地 169.254.*，
rem 虚拟网卡/VPN 地址也会列出，一般选用 192.168.x.x 即可）
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { Write-Host ('   http://' + $_.IPAddress + ':3000') }"
echo.
echo  Notes:
echo   - First run: allow Node.js in the Windows Firewall prompt.
echo   - If LOCAL_ACCESS_TOKEN is set in .env.local, each device
echo     needs to enter the token once when prompted in browser.
echo   - Stop with stop-dev.bat or Ctrl+C.
echo  Press Ctrl+C to stop
echo ============================================
call npm.cmd run dev -- -H 0.0.0.0
pause
