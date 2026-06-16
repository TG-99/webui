@echo off
title MustDO App Launcher
setlocal enabledelayedexpansion

:: Aesthetic console colors and styling
color 0B
echo ===================================================
echo               M U S T D O   A P P
echo        Deadline TODO App with Notifications
echo ===================================================
echo.

:: Detect PORT from .env file
set PORT=8000
if exist .env (
    for /f "usebackq tokens=1,2 delims==" %%i in (".env") do (
        if "%%i"=="PORT" set PORT=%%j
    )
)

:: Check if Python is installed (check python first, then py launcher)
set PYTHON_CMD=python
python --version >nul 2>nul
if %errorlevel% neq 0 (
    py --version >nul 2>nul
    if %errorlevel% neq 0 (
        color 0C
        echo [ERROR] Python was not found in your system PATH!
        echo Please install Python 3.8+ and make sure it is added to environment variables.
        echo.
        pause
        exit /b 1
    ) else (
        set PYTHON_CMD=py
    )
)

:: Check for virtual environment
set USE_VENV=1
set VENV_DIR=.venv
if not exist %VENV_DIR%\Scripts\activate.bat (
    if exist venv\Scripts\activate.bat (
        set VENV_DIR=venv
    ) else (
        echo [INFO] Virtual environment not found. 
        echo [INFO] Creating a virtual environment in .venv...
        %PYTHON_CMD% -m venv .venv 2>nul
        if not exist .venv\Scripts\activate.bat (
            echo [WARNING] Could not create virtual environment. python -m venv may be missing or disabled.
            echo [WARNING] Falling back to global system Python installation.
            set USE_VENV=0
        ) else (
            set VENV_DIR=.venv
        )
    )
)

:: Activate virtual environment if available
if "%USE_VENV%"=="1" (
    echo [INFO] Activating virtual environment %VENV_DIR%...
    call %VENV_DIR%\Scripts\activate.bat
)

echo [INFO] Verifying / Installing dependencies from requirements.txt...
%PYTHON_CMD% -m pip install -r requirements.txt --quiet
if %errorlevel% neq 0 (
    color 0E
    echo [WARNING] Failed to install dependencies automatically. 
    echo We will still attempt to run the server.
    echo.
)

:: Automatically open browser after a small delay
echo [INFO] Starting Web Server on port %PORT%...
echo [INFO] Opening your browser at http://localhost:%PORT% ...
start /b powershell -Command "Start-Sleep -s 2; Start-Process 'http://localhost:%PORT%'"

:: Launch the application
%PYTHON_CMD% app.py

:: Keep terminal open if the application crashes or exits
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [ERROR] MustDO server exited with an error.
    pause
)
