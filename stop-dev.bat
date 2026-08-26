@echo off
rem Stop LearnForge dev server (port 3000)
set "killed="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r ":3000.*LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
    if not errorlevel 1 (
        echo Terminated PID %%p
        set "killed=1"
    )
)
if not defined killed echo No dev server found on port 3000
pause
