@echo off
rem Update the lab from the main project (double-click)
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-from-main.ps1" %*
