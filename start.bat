@echo off
start "" http://localhost:8765
powershell -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
