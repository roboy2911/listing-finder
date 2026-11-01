@echo off
cd /d "%~dp0"
rem The app gets its own Python environment in .venv, so it works whichever Python Windows finds first
if not exist .venv\Scripts\python.exe (
  echo Setting up Listing Finder...
  python -m venv .venv
  if errorlevel 1 (
    echo Could not set up Python. Install Python from python.org and tick "Add python.exe to PATH".
    pause
    exit /b 1
  )
)
.venv\Scripts\python.exe -m pip install -q -r requirements.txt
if not exist config.json copy config.example.json config.json
echo.
echo Done. Put your SerpApi key in config.json, then double-click start.bat
if not "%1"=="nopause" pause
