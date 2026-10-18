@echo off
if exist "%~dp0server.py" (cd /d "%~dp0") else (cd /d "%~dp0..")
if not exist server.py (
  echo LOI: khong thay server.py trong %CD%
  pause
  exit /b 1
)
set "PYTHON=%~dp0venv\Scripts\python.exe"
if not exist "%PYTHON%" (
  echo LOI: khong thay Python trong %PYTHON%
  echo Hay chay setup.bat truoc.
  pause
  exit /b 1
)
"%PYTHON%" serve.py
pause
