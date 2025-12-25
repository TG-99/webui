from time import sleep
from requests import get as rget
from os import environ
from dotenv import load_dotenv
import logging

# Load environment variables from .env
load_dotenv()

# --- Logging Setup ---
logging.basicConfig(
    filename="alive.log",
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger(__name__)

# --- Configuration ---
BASE_URL = environ.get("BASE_URL", "").rstrip("/") or None
BASE_URL_PORT = environ.get("PORT", None)

if BASE_URL is not None and BASE_URL_PORT is not None:
    connection_failed = False  # Flag to track connection failure
    
    while not connection_failed:
        try:
            response = rget(BASE_URL, timeout=10)
            response.raise_for_status()  # Raise exception for 4xx/5xx codes
            log.info(f"Connection successful to {BASE_URL} (status {response.status_code}).")
            sleep(300)
        except Exception as e:
            if not connection_failed:  # Log only first failure
                log.error(f"alive.py: Failed to connect to {BASE_URL}. Error: {e}")
            connection_failed = True
            break
else:
    log.error("BASE_URL or PORT not configured properly in .env")
