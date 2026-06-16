#!/bin/bash

# Theme colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}===================================================${NC}"
echo -e "${CYAN}              M U S T D O   A P P                  ${NC}"
echo -e "${CYAN}       Deadline TODO App with Notifications       ${NC}"
echo -e "${CYAN}===================================================${NC}"
echo ""

# Detect PORT from .env file
PORT=8000
if [ -f .env ]; then
    # Read PORT from .env, handling potential Windows CR/LF line endings
    ENV_PORT=$(grep -E "^PORT=" .env | cut -d'=' -f2 | tr -d '\r')
    if [ ! -z "$ENV_PORT" ]; then
        PORT=$ENV_PORT
    fi
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    # Check if 'python' refers to Python 3
    if command -v python &> /dev/null && python --version 2>&1 | grep -q "Python 3"; then
        PYTHON_CMD="python"
    else
        echo -e "${RED}[ERROR] python3 or python (Python 3) could not be found.${NC}"
        echo "Please install Python 3.8+ and try again."
        echo ""
        read -p "Press Enter to exit..."
        exit 1
    fi
else
    PYTHON_CMD="python3"
fi

# Check virtual environment
USE_VENV=1
VENV_DIR=".venv"
if [ ! -f "$VENV_DIR/bin/activate" ]; then
    if [ -f "venv/bin/activate" ]; then
        VENV_DIR="venv"
    else
        echo -e "${YELLOW}[INFO] Virtual environment not found. Creating one in .venv...${NC}"
        $PYTHON_CMD -m venv .venv 2>/dev/null
        if [ ! -f ".venv/bin/activate" ]; then
            echo -e "${YELLOW}[WARNING] Could not create virtual environment. Falling back to global system Python.${NC}"
            USE_VENV=0
        else
            VENV_DIR=".venv"
        fi
    fi
fi

# Activate virtual environment if available
if [ "$USE_VENV" -eq 1 ]; then
    echo -e "${CYAN}[INFO] Activating virtual environment ($VENV_DIR)...${NC}"
    source "$VENV_DIR/bin/activate"
fi

# Install requirements
echo -e "${CYAN}[INFO] Verifying / Installing dependencies...${NC}"
pip install -r requirements.txt --quiet
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}[WARNING] Failed to install dependencies. Attempting to start server anyway...${NC}"
fi

# Function to open the browser after a delay
open_browser() {
    sleep 2
    if command -v xdg-open &> /dev/null; then
        xdg-open "http://localhost:$PORT"
    elif command -v open &> /dev/null; then
        open "http://localhost:$PORT"
    else
        echo -e "${YELLOW}[INFO] Please open your browser and navigate to http://localhost:$PORT${NC}"
    fi
}

# Open browser in the background
open_browser &

# Start FastAPI application
echo -e "${GREEN}[INFO] Starting MustDO Web Server on port $PORT...${NC}"
$PYTHON_CMD app.py
