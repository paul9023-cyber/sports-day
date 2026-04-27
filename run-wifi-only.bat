@echo off
chcp 65001 >nul
title 우리동네 체육대회 서버 (Wi-Fi 전용)
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [오류] Python이 설치되어 있지 않습니다.
  echo https://www.python.org/downloads/ 에서 Python 3.10 이상을 설치하세요.
  pause
  exit /b 1
)

python app.py --no-tunnel
echo.
echo 서버가 종료되었습니다.
pause
