@echo off
setlocal
set "PANEL=http://127.0.0.1:8899/plugin.cafe-projects/"
curl.exe -fsS --noproxy "*" --max-time 2 "%PANEL%api/token" >nul 2>nul
if not errorlevel 1 goto open_panel

where.exe node.exe >nul 2>nul
if errorlevel 1 (
  echo Install Node.js first, then reopen Cybercafe.
  goto failed
)
where.exe w2.cmd >nul 2>nul
if errorlevel 1 (
  echo Install Whistle with: npm install -g whistle
  goto failed
)
call w2.cmd start -H 127.0.0.1 -p 8899 --addon "%~dp0."
if errorlevel 1 goto failed
for /l %%I in (1,1,8) do (
  curl.exe -fsS --noproxy "*" --max-time 2 "%PANEL%api/token" >nul 2>nul
  if not errorlevel 1 goto open_panel
  ping -n 2 127.0.0.1 >nul
)
echo Whistle is not serving the Cybercafe panel on port 8899.
echo If you already started Whistle separately, stop it before reopening Cybercafe.
goto failed

:open_panel
if exist "%LOCALAPPDATA%\Cybercafe\data\proxy-disabled" (
  powershell.exe -NoProfile -Command "$p=$env:PANEL; $token=(Invoke-RestMethod -Uri ($p+'api/token') -TimeoutSec 4).token; Invoke-RestMethod -Uri ($p+'api/proxy/on') -Method Post -Headers @{'X-Cafe-Token'=$token} -TimeoutSec 20 | Out-Null"
  if errorlevel 1 goto failed
)
start "" "%PANEL%"
exit /b 0

:failed
pause
exit /b 1
