@echo off
setlocal
cd /d "%~dp0"

echo Creating Desktop Shortcuts for Global Aviation Nav DB...

powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "$s1 = $ws.CreateShortcut(\"$desktop\Global Aviation Nav DB (GUI).lnk\"); " ^
  "$s1.TargetPath = 'wscript.exe'; " ^
  "$s1.Arguments = '\"%~dp0Launch-GUI.vbs\"'; " ^
  "$s1.WorkingDirectory = '%~dp0'; " ^
  "$s1.Description = 'Global Aviation Nav DB Visual GUI Launcher'; " ^
  "$s1.Save(); " ^
  "$s2 = $ws.CreateShortcut(\"$desktop\Start Global Nav DB.lnk\"); " ^
  "$s2.TargetPath = '%~dp0start-server.bat'; " ^
  "$s2.WorkingDirectory = '%~dp0'; " ^
  "$s2.Description = 'Start Global Aviation Nav DB Server'; " ^
  "$s2.Save(); " ^
  "$s3 = $ws.CreateShortcut(\"$desktop\Stop Global Nav DB.lnk\"); " ^
  "$s3.TargetPath = '%~dp0stop-server.bat'; " ^
  "$s3.WorkingDirectory = '%~dp0'; " ^
  "$s3.Description = 'Stop Global Aviation Nav DB Server'; " ^
  "$s3.Save();"

echo.
echo [SUCCESS] Shortcuts created on your Desktop:
echo   - Global Aviation Nav DB (GUI)
echo   - Start Global Nav DB
echo   - Stop Global Nav DB
echo.
timeout /t 3 >nul
