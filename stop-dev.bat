@echo off
rem Stop LearnForge dev server (port 3100)
set "killed="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r ":3100.*LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
    if not errorlevel 1 (
        echo Terminated PID %%p
        set "killed=1"
    )
)
if not defined killed echo No dev server found on port 3100
pause
