@echo off
title Openarc Launcher

:: Check if server is already running on port 8765
netstat -ano | findstr ":8765 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% == 0 (
    :: Server already running, just open browser
    start "" "http://localhost:8765"
    exit
)

:: Start server in a visible command prompt window
start "Openarc Local Server" cmd /c "cd /d "%~dp0\.." && node server.js"

:: Wait a moment for server to boot up
timeout /t 2 /nobreak >nul

:: Open browser
start "" "http://localhost:8765"

exit
