@echo off
cd /d "%~dp0"
python -m pip install -r requirements.txt
if not exist config.json copy config.example.json config.json
echo.
echo Done. Put your SerpApi key in config.json, then double-click start.bat
pause
