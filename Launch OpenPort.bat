@echo off
rem Starts OpenPort from this folder (development launch; no install needed).
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is not installed here. Open a terminal in this folder and run:  npm install
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
