@echo off
setlocal EnableDelayedExpansion
title Manna CMMS - localhost

REM ---------------------------------------------------------------------------
REM  Manna CMMS on localhost.
REM
REM  Double-click this file. It opens two windows - the API and the web client -
REM  and points a browser at the client.
REM
REM      API     http://localhost:5055
REM      Client  http://localhost:5173
REM
REM  The client already knows to talk to :5055; that is what
REM  client\.env.development.local says, and it beats the committed
REM  .env.development, which points at :5000 where another project runs.
REM
REM  The port check below is not boilerplate. A node process left over from an
REM  earlier run keeps answering on 5055 and keeps serving the code it started
REM  with, so the browser shows a version of the app that no longer exists on
REM  disk - which looks exactly like a change that did not work. Close both
REM  windows when you are done, or this catches it next time.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

echo.
echo   Manna CMMS - starting on localhost
echo   ==================================
echo.

REM --- prerequisites ---------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo   [X] Node is not on PATH. Install Node 20+ and try again.
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo   Node %%v

if not exist "server\node_modules\" (
  echo   [!] server dependencies missing - running npm install...
  pushd server && call npm install && popd
)
if not exist "client\node_modules\" (
  echo   [!] client dependencies missing - running npm install...
  pushd client && call npm install && popd
)

if not exist "server\.env" (
  echo.
  echo   [X] server\.env is missing. It holds the ERPNext key the API reads
  echo       everything through, so the server will start and every screen
  echo       will be empty. Copy server\.env.example and fill it in.
  echo.
  pause
  exit /b 1
)

REM --- the stale-process trap ------------------------------------------------
set "STALE="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5055" ^| findstr "LISTENING"') do set "STALE=%%p"

if defined STALE (
  echo.
  echo   [!] Something is already listening on port 5055  ^(PID !STALE!^)
  echo.
  echo       If that is an old Manna CMMS server, it is still serving the code
  echo       it started with - so today's changes will not show up no matter
  echo       how many times you reload.
  echo.
  choice /c YN /m "       Stop it and start fresh"
  if !errorlevel! equ 1 (
    taskkill /PID !STALE! /F >nul 2>&1
    echo       stopped.
    timeout /t 2 /nobreak >nul
  ) else (
    echo       left alone - the API window below will fail to bind.
  )
)

REM --- go --------------------------------------------------------------------
echo.
echo   Opening two windows. Close both to stop.
echo.

REM start /D sets the working directory. Quoting a "cd /d ..." inside the
REM command string instead nests quotes, which cmd parses wrongly and the
REM window dies on open with no message.
start "Manna CMMS - API (:5055)"    /D "%~dp0server" cmd /k npm run dev
start "Manna CMMS - Client (:5173)" /D "%~dp0client" cmd /k npm run dev

REM Vite needs a moment to bind before a browser hitting it gets anything.
echo   Waiting for the client to come up...
timeout /t 6 /nobreak >nul
start "" "http://localhost:5173"

echo.
echo   Started.
echo     API     http://localhost:5055
echo     Client  http://localhost:5173
echo.
echo   Sign in with your ERPNext email and password.
echo.
timeout /t 8 /nobreak >nul
exit /b 0
