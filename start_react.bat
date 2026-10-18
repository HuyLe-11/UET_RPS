@echo off
cd /d "%~dp0frontend"
if not exist "node_modules" (
  echo Hay chay npm ci trong thu muc frontend truoc.
  pause
  exit /b 1
)
echo Tai khoan: demo / Demo@123456
echo Mo trinh duyet tai http://localhost:5173
call npm.cmd run dev
pause
