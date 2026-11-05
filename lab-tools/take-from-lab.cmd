@echo off
rem Забрать изменения из лаборатории (двойной щелчок)
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0take-from-lab.ps1" %*
