@echo off
chcp 65001 >nul
rem =====================================================================
rem  LearnForge Git network timeout wrapper (Windows)
rem  Usage (same as git; cloud commands get a timeout automatically):
rem    git-net.bat push origin develop     push (default 30s timeout)
rem    git-net.bat pull origin develop     pull
rem    git-net.bat fetch --all             fetch
rem    git-net.bat clone https://.../a.git clone
rem    git-net.bat status                  local op, no timeout
rem  Tips:
rem    - adjust timeout: set GIT_NET_TIMEOUT=60 then run
rem    - local workflow (commit/branch/checkout/log/status) is never affected
rem =====================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0git-net.ps1" %*
exit /b %errorlevel%
