@echo off
rem Start LearnForge dev server
cd /d "%~dp0"
echo ============================================
echo  Starting LearnForge dev server...
echo  Open: http://localhost:3000
echo  Press Ctrl+C to stop
echo ============================================
rem -H 127.0.0.1: 仅绑定回环地址，禁止局域网访问（安全加固：
rem              防止外部主机伪造 Host: localhost 获取本地访问令牌）
call npm.cmd run dev -- -H 127.0.0.1
pause
