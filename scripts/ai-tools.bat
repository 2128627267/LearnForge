@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
rem =====================================================================
rem  LearnForge model integration CLI (like skill/MCP/plugin entry)
rem  Usage:
rem    ai-tools.bat caps            - show capability list (function tools)
rem    ai-tools.bat demo            - demo: batch create 3 cards + 2 links, then connect 1 more
rem    ai-tools.bat batch file.json - POST /api/cards/batch with json file
rem    ai-tools.bat connect file.json - POST /api/cards/connect with json file
rem    ai-tools.bat canvas          - show current canvas nodes/edges
rem    ai-tools.bat list            - list cards (GET /api/cards)
rem  Requires: dev server on http://localhost:3000, curl.exe (Win10+ built-in)
rem =====================================================================
set "BASE=http://localhost:3000"
set "M=%~1"

if "%M%"=="" goto help
if "%M%"=="caps" goto caps
if "%M%"=="demo" goto demo
if "%M%"=="batch" goto batch
if "%M%"=="connect" goto connect
if "%M%"=="canvas" goto canvas
if "%M%"=="list" goto list
goto help

:caps
echo == capabilities (function tools) ==
curl -s %BASE%/api/ai/capabilities
echo.
goto end

:demo
echo == full demo: batch create 3 cards + 2 relations, then connect 1 more ==
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ai-tools-demo.ps1"
if errorlevel 1 echo demo failed - is the dev server running on localhost:3000?
goto end

:list
echo == GET /api/cards?limit=20 ==
curl -s "%BASE%/api/cards?limit=20"
echo.
goto end

:batch
if "%~2"=="" ( echo usage: ai-tools.bat batch ^<json-file^> & goto end )
echo == POST /api/cards/batch with %~2 ==
curl -s -X POST %BASE%/api/cards/batch -H "Content-Type: application/json" -d @%~2
echo.
goto end

:connect
if "%~2"=="" ( echo usage: ai-tools.bat connect ^<json-file^> & goto end )
echo == POST /api/cards/connect with %~2 ==
curl -s -X POST %BASE%/api/cards/connect -H "Content-Type: application/json" -d @%~2
echo.
goto end

:canvas
echo == GET /api/canvas-layout ==
curl -s %BASE%/api/canvas-layout
echo.
goto end

:help
echo LearnForge model integration CLI
echo.
echo Usage:
echo   ai-tools.bat caps               show capability list (function tools)
echo   ai-tools.bat demo               demo: batch create 3 cards + 2 links, then connect 1 more
echo   ai-tools.bat batch file.json    POST /api/cards/batch with json file
echo   ai-tools.bat connect file.json  POST /api/cards/connect with json file
echo   ai-tools.bat canvas             show current canvas nodes/edges
echo   ai-tools.bat list               list cards (GET /api/cards)
echo.
echo Example json files:
echo   {"items":[{"title":"A","content":"..."}],"relations":[{"source":"0","target":"1","label":"link"}]}
echo   {"relations":[{"source":"card-...-0","target":"card-...-1","label":"link"}]}
goto end

:end
endlocal
