@echo off
rem Start LearnForge dev server
cd /d "%~dp0"
echo ============================================
echo  Starting LearnForge dev server...
echo  Open: http://localhost:3100
echo  Press Ctrl+C to stop
echo ============================================
rem -H 127.0.0.1: 仅绑定回环地址，禁止局域网访问（安全加固：
rem              防止外部主机伪造 Host: localhost 获取本地访问令牌）
rem -p 3100:      对齐 NC-API 端口表（LearnForge=3100）；3000 留给主站。
call npm.cmd run dev -- -p 3100 -H 127.0.0.1
pause
