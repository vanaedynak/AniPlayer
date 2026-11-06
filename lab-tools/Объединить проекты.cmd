@echo off
rem Окно обмена работой между основным проектом и лабораторией (двойной щелчок)
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0merge-tool.ps1" %*
