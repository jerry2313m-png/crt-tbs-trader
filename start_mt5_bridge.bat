@echo off
REM ============================================================
REM  CRT+TBS Trader — MetaTrader 5 Bridge quick-start (Windows)
REM ============================================================
echo.
echo  ==============================================
echo   CRT+TBS Trader - MT5 Bridge
echo  ==============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo  Python not found. Install Python from https://python.org
    echo  (Check "Add Python to PATH" during install)
    pause
    exit /b
)

echo  Installing/updating dependencies...
python -m pip install --quiet --upgrade MetaTrader5 flask flask-cors
if errorlevel 1 (
    echo.
    echo  ERROR: Could not install packages. Try running:
    echo    python -m pip install MetaTrader5 flask flask-cors
    pause
    exit /b
)

echo.
echo  Starting bridge...
echo  Once it's running, open:  http://localhost:8080
echo  (Keep this window open while trading)
echo.
python mt5_bridge.py
pause
