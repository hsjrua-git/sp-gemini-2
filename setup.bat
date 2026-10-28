@echo off
REM Student Panel - double-clickable Windows launcher.
REM Runs setup.ps1 (which self-elevates to Administrator, installs Node.js and
REM PostgreSQL if missing, then configures, builds, and starts the app).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
