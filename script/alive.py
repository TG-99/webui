from time import sleep
from requests import get as rget
from os import environ
from logging import error as logerror
from dotenv import load_dotenv  # <-- import dotenv

load_dotenv()  # <-- load variables from .env into environ

BASE_URL = environ.get("BASE_URL", "")
try:
    if len(BASE_URL) == 0:
        raise TypeError
    BASE_URL = BASE_URL.rstrip("/")
except TypeError:
    BASE_URL = None

BASE_URL_PORT = environ.get('PORT', None)
if BASE_URL_PORT is not None and BASE_URL is not None:
    connection_failed = False  # Flag to track connection failure
    
    while not connection_failed:
        try:
            response = rget(BASE_URL)
            response.raise_for_status()  # Raise an exception for bad status codes
            print("Done")
            sleep(600)
        except Exception as e:
            if not connection_failed:  # Log error only on the first failure
                logerror(f"alive.py: Failed to connect.")
                #logerror(f"alive.py:  Error: {e}")
            connection_failed = True  # Set the flag to True to stop further execution
            break  # Exit the loop
