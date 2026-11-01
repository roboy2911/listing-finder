@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe call install.bat nopause
start "" http://localhost:8765
.venv\Scripts\python.exe server.py
pause
