@echo off
rem ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
rem  SolveWatch AI — Windows launcher
rem
rem  Usage:
rem    start.bat              — start all services
rem    start.bat --setup      — first-time setup then start
rem    start.bat --setup-only — install deps only
rem    start.bat --newlogs    — clear logs then start
rem    start.bat --debug      — enable DEBUG logging
rem
rem  This script delegates to start.ps1.
rem  If PowerShell execution policy blocks it, run once in PowerShell:
rem    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
rem ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

setlocal
cd /d "%~dp0"

rem Build PowerShell parameter string from batch args
set "PS_ARGS="
:arg_loop
if "%~1"=="" goto run
if /i "%~1"=="--setup"      set "PS_ARGS=%PS_ARGS% -Setup"
if /i "%~1"=="--setup-only" set "PS_ARGS=%PS_ARGS% -SetupOnly"
if /i "%~1"=="--newlogs"    set "PS_ARGS=%PS_ARGS% -NewLogs"
if /i "%~1"=="--debug"      set "PS_ARGS=%PS_ARGS% -Debug"
shift
goto arg_loop

:run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %PS_ARGS%
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [error] Failed to start. If you see an ExecutionPolicy error, run this in PowerShell:
    echo   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
    pause
)
