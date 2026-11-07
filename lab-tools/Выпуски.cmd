@echo off
rem Окно выпусков: выпустить новую версию, откатить, отметить стабильной (двойной щелчок)
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0release-tool.ps1" %*
