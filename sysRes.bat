@echo off
echo Full reboot started>>app.log
taskkill /f /im node.exe
timeout /t 1
if %errorlevel% neq 0 {
    echo Failed to kill current node instance - exiting restarter>>app.log
    exit /b %errorlevel%
}else {
    timeout /t 5
    cmd /c node app.js
}