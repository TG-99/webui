import sys
import os
import asyncio
import datetime
import time
import logging
import json
from contextlib import asynccontextmanager
from typing import Dict, Any, Optional, List
from dotenv import load_dotenv

# Ensure local directory is in python search path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from fastapi import FastAPI, HTTPException, Body, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn
import httpx
from bson import ObjectId
from pymongo import MongoClient, DESCENDING

# ==========================================
# 1. CONFIGURATIONS
# ==========================================
load_dotenv()
MONGO_URI = os.environ.get("MONGO_URI", "mongodb+srv://mltb-2:mltb-2@cluster0.56sdwsb.mongodb.net")
DB_NAME = os.environ.get("MONGO_DB_NAME", "alive_manager")
PREDEFINED_URI = os.environ.get("MONGODB_PREDEFINED_URI", MONGO_URI)

# Auto-detect BASE_URL from platform env vars if not explicitly set
def _detect_base_url():
    """Auto-detect the app's external URL from platform environment variables."""
    explicit = os.environ.get("BASE_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")

    # Render: sets RENDER_EXTERNAL_HOSTNAME (e.g. my-app.onrender.com)
    render_host = os.environ.get("RENDER_EXTERNAL_HOSTNAME")
    if render_host:
        return f"https://{render_host}"

    # Render: some versions set RENDER_EXTERNAL_URL directly
    render_url = os.environ.get("RENDER_EXTERNAL_URL")
    if render_url:
        return render_url.rstrip("/")

    # Heroku: requires Dyno Metadata lab feature enabled
    heroku_app = os.environ.get("HEROKU_APP_NAME")
    if heroku_app:
        return f"https://{heroku_app}.herokuapp.com"

    # Railway
    railway_url = os.environ.get("RAILWAY_PUBLIC_DOMAIN")
    if railway_url:
        return f"https://{railway_url}"

    # Koyeb
    koyeb_url = os.environ.get("KOYEB_PUBLIC_DOMAIN")
    if koyeb_url:
        return f"https://{koyeb_url}"

    return None

BASE_URL = _detect_base_url()

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("keepalive")

# ==========================================
# 2. DATABASE LAYER
# ==========================================
client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
db = client[DB_NAME]

def serialize_doc(doc):
    """Utility to map MongoDB ObjectId to string 'id' for API compatibility."""
    if not doc:
        return None
    doc = dict(doc)
    if "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    return doc



def init_db():
    """Initializes the database collections and unique indexes."""
    try:
        # Check connection
        client.admin.command('ping')
        logger.info("Successfully connected to MongoDB.")
        
        # Enforce unique index on url in targets collection
        db.targets.create_index("url", unique=True)
        # Enforce unique index on serial_number in keyboxes collection
        db.keyboxes.create_index("serial_number", unique=True)
        # Create helper index for log queries
        db.ping_logs.create_index("target_id")
        db.ping_logs.create_index("timestamp")
        db.targets.create_index("active")
        db.targets.create_index("order")
        
        # Check if any target is missing 'order' field
        if db.targets.count_documents({"order": {"$exists": False}}) > 0:
            logger.info("Some targets are missing 'order' field. Re-indexing all targets...")
            all_targets = list(db.targets.find().sort("created_at", DESCENDING))
            for index, target in enumerate(all_targets):
                db.targets.update_one(
                    {"_id": target["_id"]},
                    {"$set": {"order": index + 1}}
                )
            logger.info("Re-indexing completed successfully.")
        
        logger.info("MongoDB collections and indexes initialized successfully.")
    except Exception as e:
        logger.error(f"Error initializing MongoDB database: {e}")

def add_target(name: str, url: str, interval: int = 10, order: Optional[int] = None) -> str:
    """Adds a new Keep-Alive target to targets collection."""
    dhaka_tz = datetime.timezone(datetime.timedelta(hours=6))
    created_at = datetime.datetime.now(dhaka_tz).isoformat()
    if order is None:
        try:
            highest = db.targets.find_one(sort=[("order", DESCENDING)])
            order = (highest["order"] + 1) if (highest and "order" in highest) else 1
        except Exception:
            order = 1
    new_target = {
        "name": name.strip(),
        "url": url.strip(),
        "interval": interval,
        "active": 1,
        "created_at": created_at,
        "last_pinged_at": None,
        "status": "PENDING",
        "last_response_time": None,
        "last_status_code": None,
        "order": order
    }
    result = db.targets.insert_one(new_target)
    return str(result.inserted_id)

def get_all_targets():
    """Retrieves all Keep-Alive targets sorted by order."""
    targets = db.targets.find().sort([("order", 1), ("created_at", DESCENDING)])
    return [serialize_doc(t) for t in targets]

def get_target_by_id(target_id: str):
    """Retrieves a single target by its stringified ObjectId."""
    try:
        row = db.targets.find_one({"_id": ObjectId(target_id)})
        return serialize_doc(row) if row else None
    except Exception:
        return None

def toggle_target_active(target_id: str, active: int):
    """Toggles target active status."""
    try:
        db.targets.update_one(
            {"_id": ObjectId(target_id)},
            {"$set": {"active": active}}
        )
    except Exception as e:
        logger.error(f"Error toggling active status: {e}")

def update_target_details(target_id: str, name: str, url: str, interval: int, order: Optional[int] = None):
    """Updates target name, url, check interval, and order."""
    try:
        update_fields = {
            "name": name.strip(),
            "url": url.strip(),
            "interval": interval
        }
        if order is not None:
            update_fields["order"] = order
        db.targets.update_one(
            {"_id": ObjectId(target_id)},
            {"$set": update_fields}
        )
    except Exception as e:
        logger.error(f"Error updating target details: {e}")
        raise e

def delete_target(target_id: str):
    """Deletes a target and all its logs."""
    try:
        obj_id = ObjectId(target_id)
        db.targets.delete_one({"_id": obj_id})
        # Delete matching logs
        db.ping_logs.delete_many({"target_id": target_id})
    except Exception as e:
        logger.error(f"Error deleting target: {e}")

def get_active_targets():
    """Retrieves active Keep-Alive targets sorted by order."""
    targets = db.targets.find({"active": 1}).sort([("order", 1), ("created_at", DESCENDING)])
    return [serialize_doc(t) for t in targets]

def update_target_ping_status(target_id: str, status: str, response_time: int, status_code: int):
    """Updates target metrics on pinger success/failure."""
    try:
        dhaka_tz = datetime.timezone(datetime.timedelta(hours=6))
        last_pinged_at = datetime.datetime.now(dhaka_tz).isoformat()
        db.targets.update_one(
            {"_id": ObjectId(target_id)},
            {"$set": {
                "status": status,
                "last_pinged_at": last_pinged_at,
                "last_response_time": response_time,
                "last_status_code": status_code
            }}
        )
    except Exception as e:
        logger.error(f"Error updating target ping status: {e}")

def insert_ping_log(target_id: str, status: str, response_time: int, status_code: int, error_message: str = None):
    """Inserts a ping response execution log entry and caps logs per target to the last 100."""
    try:
        dhaka_tz = datetime.timezone(datetime.timedelta(hours=6))
        timestamp = datetime.datetime.now(dhaka_tz).isoformat()
        new_log = {
            "target_id": str(target_id),
            "timestamp": timestamp,
            "status": status,
            "response_time_ms": response_time,
            "status_code": status_code,
            "error_message": error_message
        }
        db.ping_logs.insert_one(new_log)
        
        # Keep only the last 100 logs globally in the database
        excess_logs = list(db.ping_logs.find(
            {},
            {"_id": 1}
        ).sort("timestamp", DESCENDING).skip(100))
        if excess_logs:
            excess_ids = [doc["_id"] for doc in excess_logs]
            db.ping_logs.delete_many({"_id": {"$in": excess_ids}})
    except Exception as e:
        logger.error(f"Error inserting ping log: {e}")

def get_ping_logs(target_id: str, limit: int = 20):
    """Gets recent ping logs for a specific target (used for visual charts)."""
    try:
        logs = db.ping_logs.find({"target_id": str(target_id)}).sort("timestamp", DESCENDING).limit(limit)
        serialized = [serialize_doc(log) for log in logs]
        return serialized[::-1]  # Return in chronological order
    except Exception as e:
        logger.error(f"Error retrieving ping logs: {e}")
        return []

def get_system_stats():
    """Gathers aggregate system-wide performance statistics using aggregation pipeline."""
    try:
        # Single aggregation for target stats (replaces 3 separate count_documents + 1 find)
        pipeline = [
            {"$group": {
                "_id": None,
                "total_targets": {"$sum": 1},
                "active_targets": {"$sum": {"$cond": [{"$eq": ["$active", 1]}, 1, 0]}},
                "up_targets": {"$sum": {"$cond": [{"$and": [{"$eq": ["$active", 1]}, {"$eq": ["$status", "UP"]}]}, 1, 0]}},
                "avg_response_time": {"$avg": {
                    "$cond": [{"$and": [{"$eq": ["$active", 1]}, {"$ne": ["$last_response_time", None]}]},
                               "$last_response_time", None]
                }}
            }}
        ]
        result = list(db.targets.aggregate(pipeline))
        
        if result:
            r = result[0]
            total_targets = r["total_targets"]
            active_targets = r["active_targets"]
            up_targets = r["up_targets"]
            avg_res_time = round(r["avg_response_time"]) if r["avg_response_time"] else 0
        else:
            total_targets = active_targets = up_targets = avg_res_time = 0

        # Uptime from recent logs
        uptime_pct = 100.0
        log_pipeline = [
            {"$sort": {"timestamp": -1}},
            {"$limit": 500},
            {"$group": {
                "_id": None,
                "total": {"$sum": 1},
                "up_count": {"$sum": {"$cond": [{"$eq": ["$status", "UP"]}, 1, 0]}}
            }}
        ]
        log_result = list(db.ping_logs.aggregate(log_pipeline))
        if log_result and log_result[0]["total"] > 0:
            uptime_pct = round((log_result[0]["up_count"] / log_result[0]["total"]) * 100, 1)

        return {
            "total_targets": total_targets,
            "active_targets": active_targets,
            "up_targets": up_targets,
            "down_targets": active_targets - up_targets,
            "avg_response_time_ms": avg_res_time,
            "uptime_percentage": uptime_pct
        }
    except Exception as e:
        logger.error(f"Error getting statistics: {e}")
        return {
            "total_targets": 0,
            "active_targets": 0,
            "up_targets": 0,
            "down_targets": 0,
            "avg_response_time_ms": 0,
            "uptime_percentage": 100.0
        }


# ==========================================
# 3. PINGER / SCHEDULER LAYER
# ==========================================
def response_code_is_healthy(status_code: int) -> bool:
    """Classify if the status code is considered healthy/alive."""
    return 100 <= status_code < 500

async def perform_ping(target_id: str, url: str) -> Dict[str, Any]:
    """
    Performs an async GET ping request to the specified URL.
    Measures response time and returns performance parameters.
    """
    headers = {
        "User-Agent": "KeepAliveManager/1.0 (Web-Keep-Alive-Scheduler; https://github.com/google-deepmind/antigravity)",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
    }
    
    start_time = time.perf_counter()
    status = "DOWN"
    response_time_ms = 0
    status_code = 0
    error_msg = None
    
    try:
        # Pinging using httpx AsyncClient
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)
            elapsed = time.perf_counter() - start_time
            response_time_ms = int(elapsed * 1000)
            status_code = response.status_code
            
            if response_code_is_healthy(status_code):
                status = "UP"
            else:
                status = "DOWN"
                error_msg = f"HTTP Error Status Code: {status_code}"
                
    except httpx.TimeoutException:
        elapsed = time.perf_counter() - start_time
        response_time_ms = int(elapsed * 1000)
        status_code = 504
        status = "DOWN"
        error_msg = "Connection Timeout (15s)"
    except httpx.ConnectError:
        elapsed = time.perf_counter() - start_time
        response_time_ms = int(elapsed * 1000)
        status_code = 503
        status = "DOWN"
        error_msg = "Connection Refused or Host Unresolved"
    except Exception as e:
        elapsed = time.perf_counter() - start_time
        response_time_ms = int(elapsed * 1000)
        status_code = 0
        status = "DOWN"
        error_msg = str(e)
        
    return {
        "target_id": target_id,
        "status": status,
        "response_time_ms": response_time_ms,
        "status_code": status_code,
        "error_message": error_msg
    }

async def ping_and_log_target(target: Dict[str, Any]):
    """Pings a single target, updates targets table status, and writes a log entry."""
    target_id = target["id"]
    url = target["url"]
    name = target["name"]
    
    logger.debug(f"Pinging target '{name}' ({url})...")
    result = await perform_ping(target_id, url)
    
    update_target_ping_status(
        target_id=target_id,
        status=result["status"],
        response_time=result["response_time_ms"],
        status_code=result["status_code"]
    )
    
    insert_ping_log(
        target_id=target_id,
        status=result["status"],
        response_time=result["response_time_ms"],
        status_code=result["status_code"],
        error_message=result["error_message"]
    )
    
    if result["status"] == "DOWN":
        logger.warning(f"Target '{name}' ({url}) is DOWN! Code: {result['status_code']}, Error: {result['error_message']}")
    else:
        logger.info(f"Target '{name}' ping OK. Status: {result['status']}, Time: {result['response_time_ms']}ms, Code: {result['status_code']}")

async def scheduler_loop():
    """Infinite background scheduler loop checking for due pings."""
    logger.info("Keep-Alive background scheduler loop started.")
    dhaka_tz = datetime.timezone(datetime.timedelta(hours=6))
    
    while True:
        try:
            active_targets = get_active_targets()
            now = datetime.datetime.now(dhaka_tz)
            
            ping_tasks = []
            for target in active_targets:
                should_ping = False
                last_pinged_str = target.get("last_pinged_at")
                interval_minutes = target.get("interval", 10)
                
                if not last_pinged_str:
                    should_ping = True
                else:
                    try:
                        last_pinged = datetime.datetime.fromisoformat(last_pinged_str)
                        # If stored timestamp is naive (old data), assume Dhaka time
                        if last_pinged.tzinfo is None:
                            last_pinged = last_pinged.replace(tzinfo=dhaka_tz)
                        time_delta = now - last_pinged
                        if time_delta.total_seconds() >= (interval_minutes * 60):
                            should_ping = True
                    except ValueError:
                        should_ping = True
                
                if should_ping:
                    ping_tasks.append(ping_and_log_target(target))
            
            if ping_tasks:
                logger.info(f"Running {len(ping_tasks)} scheduled keep-alive pings...")
                await asyncio.gather(*ping_tasks)
            else:
                logger.debug("Scheduler tick: no targets due for ping.")
                
        except Exception as e:
            logger.error(f"Error in scheduler loop: {e}", exc_info=True)
            
        await asyncio.sleep(10)


# ==========================================
# 4. SELF-PING / KEEP-ALIVE LOOP
# ==========================================
async def self_ping_loop():
    """Keep-alive self-ping loop to prevent the Alive app itself from sleeping."""
    port = os.environ.get('PORT')
    if not BASE_URL or not port:
        logger.info("Self-ping keep-alive loop skipped (BASE_URL or PORT not set).")
        return

    logger.info(f"Self-ping keep-alive loop started for {BASE_URL} (Port: {port}).")
    fail_count = 0
    MAX_RETRIES = 10

    while fail_count < MAX_RETRIES:
        try:
            await asyncio.sleep(300)  # Ping every 5 minutes (well within Render's 15-min sleep)
            async with httpx.AsyncClient(timeout=15.0) as http_client:
                response = await http_client.get(BASE_URL)
                response.raise_for_status()
                logger.info(f"Self-ping keep-alive successful (HTTP {response.status_code}).")
                fail_count = 0  # Reset on success
        except Exception as e:
            fail_count += 1
            wait_time = min(60 * fail_count, 300)  # Exponential backoff, max 5 min
            logger.error(f"Self-ping failed ({fail_count}/{MAX_RETRIES}): {e}. Retrying in {wait_time}s...")
            await asyncio.sleep(wait_time)

    logger.error(f"Self-ping permanently failed after {MAX_RETRIES} consecutive errors. Loop stopped.")


# ==========================================
# 4.5 KEYBOX CHECKER AND MANAGER LAYER
# ==========================================
import xml.etree.ElementTree as ET
import re
import base64
from cryptography import x509
from cryptography.hazmat.primitives.serialization import load_pem_private_key, load_pem_public_key, load_der_private_key, Encoding, PublicFormat
from cryptography.hazmat.primitives.asymmetric import rsa, ec

# Google hardware attestation root public key (RSA 4096)
GOOGLE_ROOT_PEM = """-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAr7bHgiuxpwHsK7Qui8xU
FmOr75gvMsd/dTEDDJdSSxtf6An7xyqpRR90PL2abxM1dEqlXnf2tqw1Ne4Xwl5j
lRfdnJLmN0pTy/4lj4/7tv0Sk3iiKkypnEUtR6WfMgH0QZfKHM1+di+y9TFRtv6y
//0rb+T+W8a9nsNL/ggjnar86461qO0rOs2cXjp3kOG1FEJ5MVmFmBGtnrKpa73X
pXyTqRxB/M0n1n/W9nGqC4FSYa04T6N5RIZGBN2z2MT5IKGbFlbC8UrW0DxW7AYI
mQQcHtGl/m00QLVWutHQoVJYnFPlXTcHYvASLu+RhhsbDmxMgJJ0mcDpvsC4PjvB
+TxywElgS70vE0XmLD+OJtvsBslHZvPBKCOdT0MS+tgSOIfga+z1Z1g7+DVagf7q
uvmag8jfPioyKvxnK/EgsTUVi2ghzq8wm27ud/mIM7AY2qEORR8Go3TVB4HzWQgp
Zrt3i5MIlCaY504LzSRiigHCzAPlHws+W0rB5N+er5/2pJKnfBSDiCiFAVtCLOZ7
gLiMm0jhO2B6tUXHI/+MRPjy02i59lINMRRev56GKtcd9qO/0kUJWdZTdA2XoS82
ixPvZtXQpUpuL12ab+9EaDK8Z4RHJYYfCT3Q5vNAXaiWQ+8PTWm2QgBR/bkwSWc+
NpUFgNPN9PvQi8WEg5UmAGMCAwEAAQ==
-----END PUBLIC KEY-----"""

# AOSP software attestation root public key (EC P-256)
AOSP_EC_ROOT_PEM = """-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7l1ex+HA220Dpn7mthvsTWpdamgu
D/9/SQ59dx9EIm29sa/6FsvHrcV30lacqrewLVQBXT5DKyqO107sSHVBpA==
-----END PUBLIC KEY-----"""

# AOSP software attestation root public key (RSA 1024)
AOSP_RSA_ROOT_PEM = """-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCia63rbi5EYe/VDoLmt5TRdSMf
d5tjkWP/96r/C3JHTsAsQ+wzfNes7UA+jCigZtX3hwszl94OuE4TQKuvpSe/lWmg
MdsGUmX4RFlXYfC78hdLt0GAZMAoDo9Sd47b0ke2RekZyOmLw9vCkT/X11DEHTVm
+Vfkl5YLCazOkjWFmwIDAQAB
-----END PUBLIC KEY-----"""

# Samsung Knox attestation root public key (EC P-521)
KNOX_ROOT_PEM = """-----BEGIN PUBLIC KEY-----
MIGbMBAGByqGSM49AgEGBSuBBAAjA4GGAAQBhbGuLrpql5I2WJmrE5kEVZOo+dgA
46mKrVJf/sgzfzs2u7M9c1Y9ZkCEiiYkhTFE9vPbasmUfXybwgZ2EM30A1ABPd12
4n3JbEDfsB/wnMH1AcgsJyJFPbETZiy42Fhwi+2BCA5bcHe7SrdkRIYSsdBRaKBo
ZsapxB0gAOs0jSPRX5M=
-----END PUBLIC KEY-----"""

# Cache public key DERs for identification
def get_spki_der(pem_str: str) -> bytes:
    pub_key = load_pem_public_key(pem_str.encode('utf-8'))
    return pub_key.public_bytes(
        encoding=Encoding.DER,
        format=PublicFormat.SubjectPublicKeyInfo
    )

GOOGLE_ROOT_DER = get_spki_der(GOOGLE_ROOT_PEM)
AOSP_EC_ROOT_DER = get_spki_der(AOSP_EC_ROOT_PEM)
AOSP_RSA_ROOT_DER = get_spki_der(AOSP_RSA_ROOT_PEM)
KNOX_ROOT_DER = get_spki_der(KNOX_ROOT_PEM)

STATUS_FILE_PATH = os.path.join(CURRENT_DIR, "data", "attestation_status.json")

def parse_keybox_xml(xml_content: str) -> Dict[str, Any]:
    """Parses Android keybox XML string, extracting device ID, algorithm, private key and cert chain."""
    try:
        # Strip and clean encoding declaration if any
        cleaned_xml = xml_content.strip()
        cleaned_xml = re.sub(r'<\?xml.*?\?>', '', cleaned_xml).strip()
        root = ET.fromstring(cleaned_xml)
    except Exception as e:
        logger.error(f"XML Parsing Exception: {e}")
        raise ValueError(f"Invalid XML syntax: {str(e)}")

    keybox = None
    if root.tag.endswith('AndroidAttestation'):
        for child in root:
            if child.tag.endswith('Keybox'):
                keybox = child
                break
    else:
        if root.tag.endswith('Keybox'):
            keybox = root

    if not keybox:
        for elem in root.iter():
            if elem.tag.endswith('Keybox'):
                keybox = elem
                break

    if not keybox:
        raise ValueError("Invalid Keybox XML: missing AndroidAttestation/Keybox element structure.")

    device_id = 'Unknown'
    for k, v in keybox.attrib.items():
        if k.lower().endswith('deviceid'):
            device_id = v
            break

    key_elems = [e for e in keybox if e.tag.endswith('Key')]
    if not key_elems:
        raise ValueError("Invalid Keybox XML: missing Key element.")

    key_elem = key_elems[0]
    algorithm = 'Unknown'
    for k, v in key_elem.attrib.items():
        if k.lower().endswith('algorithm'):
            algorithm = v
            break

    private_key_pem = ''
    cert_chain_elem = None
    for child in key_elem:
        if child.tag.endswith('PrivateKey'):
            private_key_pem = (child.text or '').strip()
        elif child.tag.endswith('CertificateChain'):
            cert_chain_elem = child

    if not cert_chain_elem:
        raise ValueError("Invalid Keybox XML: missing CertificateChain element.")

    # Extract all certificates
    cert_pems = []
    for child in cert_chain_elem:
        if child.tag.endswith('Certificate'):
            child_text = (child.text or '').strip()
            if child_text:
                # Find all PEM wrappers in the text
                certs_found = []
                pattern = re.compile(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----', re.DOTALL)
                for match in pattern.finditer(child_text):
                    certs_found.append(match.group(0).strip())
                
                # If no PEM found but text exists, assume raw base64 and wrap it
                if not certs_found:
                    base64_only = re.sub(r'\s+', '', child_text)
                    if base64_only:
                        certs_found.append(f"-----BEGIN CERTIFICATE-----\n{base64_only}\n-----END CERTIFICATE-----")
                
                cert_pems.extend(certs_found)

    return {
        'device_id': device_id,
        'algorithm': algorithm,
        'private_key_pem': private_key_pem,
        'cert_pems': cert_pems
    }

def load_private_key_robust(priv_key_str: str, cert_pub_key) -> Any:
    """Robustly load a private key in PEM or base64 DER format."""
    cleaned = priv_key_str.strip()

    # Try PEM
    if "BEGIN" in cleaned:
        try:
            return load_pem_private_key(cleaned.encode('utf-8'), password=None)
        except Exception:
            pass

    # Try base64-encoded DER
    base64_data = cleaned
    for header in ["-----BEGIN RSA PRIVATE KEY-----", "-----END RSA PRIVATE KEY-----",
                   "-----BEGIN EC PRIVATE KEY-----", "-----END EC PRIVATE KEY-----",
                   "-----BEGIN PRIVATE KEY-----", "-----END PRIVATE KEY-----"]:
        base64_data = base64_data.replace(header, "")
    base64_data = re.sub(r'\s+', '', base64_data)

    try:
        der_bytes = base64.b64decode(base64_data)
        return load_der_private_key(der_bytes, password=None)
    except Exception:
        pass

    # If it failed but algorithm is EC, SEC1 EC keys can be wrapped in PKCS#8 or loaded directly if base64.
    # We raise an error if all loading methods failed.
    raise ValueError("Could not parse private key format (PEM or raw DER).")

def check_cert_validity(cert: x509.Certificate) -> Dict[str, Any]:
    """Helper to verify certificate active/expired status against current UTC time."""
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    try:
        not_before = cert.not_valid_before_utc
        not_after = cert.not_valid_after_utc
    except AttributeError:
        not_before = cert.not_valid_before.replace(tzinfo=datetime.timezone.utc)
        not_after = cert.not_valid_after.replace(tzinfo=datetime.timezone.utc)

    return {
        'valid': not_before <= now_utc <= not_after,
        'expired': now_utc > not_after,
        'not_before': not_before,
        'not_after': not_after
    }

def verify_certificate_chain(certs: List[x509.Certificate]) -> bool:
    """Verify certificate signatures up the chain."""
    if len(certs) <= 1:
        return True
    try:
        for i in range(len(certs) - 1):
            child = certs[i]
            parent = certs[i + 1]
            child.verify_directly_issued_by(parent)
        return True
    except Exception as e:
        logger.error(f"Cert signature verification error: {e}")
        return False

def identify_root(root_cert: x509.Certificate) -> str:
    """Compare SPKI DER to match known Attestation Root Certs."""
    try:
        root_spki = root_cert.public_key().public_bytes(
            encoding=Encoding.DER,
            format=PublicFormat.SubjectPublicKeyInfo
        )
        if root_spki == GOOGLE_ROOT_DER:
            return "google"
        elif root_spki == AOSP_EC_ROOT_DER:
            return "aosp_ec"
        elif root_spki == AOSP_RSA_ROOT_DER:
            return "aosp_rsa"
        elif root_spki == KNOX_ROOT_DER:
            return "knox"
    except Exception:
        pass
    return "unknown"

def check_revocation_status(certs: List[x509.Certificate]) -> Dict[str, Any]:
    """Check both hex and decimal serial numbers against local revocation database."""
    if not os.path.exists(STATUS_FILE_PATH):
        return {
            'revoked': False,
            'reason': "⚠️ Revocation database not yet downloaded."
        }

    try:
        with open(STATUS_FILE_PATH, 'r') as f:
            status_data = json.load(f)
        
        entries = status_data.get('entries', {})
        for cert in certs:
            sn_int = cert.serial_number
            sn_hex = format(sn_int, 'x').lower()
            sn_dec = str(sn_int)

            if sn_hex in entries:
                return {'revoked': True, 'reason': entries[sn_hex].get('reason', 'REVOKED')}
            elif sn_dec in entries:
                return {'revoked': True, 'reason': entries[sn_dec].get('reason', 'REVOKED')}
    except Exception as e:
        logger.error(f"Error checking attestation status: {e}")
        return {'revoked': False, 'reason': f"⚠️ Check error: {str(e)}"}

    return {'revoked': False, 'reason': None}

def validate_keybox_xml(xml_content: str) -> Dict[str, Any]:
    """Main verification validator for Keyboxes."""
    parsed = parse_keybox_xml(xml_content)
    device_id = parsed['device_id']
    algorithm = parsed['algorithm']
    private_key_pem = parsed['private_key_pem']
    cert_pems = parsed['cert_pems']

    if not cert_pems:
        raise ValueError("No certificates found in Keybox.")

    certs = []
    for pem in cert_pems:
        certs.append(x509.load_pem_x509_certificate(pem.encode('utf-8')))

    leaf_cert = certs[0]
    serial_number_hex = format(leaf_cert.serial_number, 'x').lower()

    # Format subject name cleanly
    try:
        subject_str = leaf_cert.subject.rfc4514_string()
    except Exception:
        subject_str = str(leaf_cert.subject)

    val_info = check_cert_validity(leaf_cert)
    cert_valid = val_info['valid']
    cert_expired = val_info['expired']

    private_key_match = None
    if private_key_pem:
        try:
            priv_key = load_private_key_robust(private_key_pem, leaf_cert.public_key())
            priv_pub_der = priv_key.public_key().public_bytes(
                encoding=Encoding.DER,
                format=PublicFormat.SubjectPublicKeyInfo
            )
            cert_pub_der = leaf_cert.public_key().public_bytes(
                encoding=Encoding.DER,
                format=PublicFormat.SubjectPublicKeyInfo
            )
            private_key_match = (priv_pub_der == cert_pub_der)
        except Exception as e:
            logger.error(f"Private key match verification exception: {e}")
            private_key_match = False

    chain_valid = verify_certificate_chain(certs)
    root_cert = certs[-1]
    root_type = identify_root(root_cert)

    rev_info = check_revocation_status(certs)
    revoked = rev_info['revoked']
    revoke_reason = rev_info['reason']

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    check_time = now_utc.strftime("%Y-%m-%d %H:%M:%S")

    cert_infos = []
    for idx, cert in enumerate(certs):
        c_val = check_cert_validity(cert)
        try:
            c_sub = cert.subject.rfc4514_string()
            c_iss = cert.issuer.rfc4514_string()
        except Exception:
            c_sub = str(cert.subject)
            c_iss = str(cert.issuer)

        cert_infos.append({
            'level': idx,
            'serialNumber': format(cert.serial_number, 'x').lower(),
            'subject': c_sub,
            'issuer': c_iss,
            'notBefore': c_val['not_before'].strftime("%Y-%m-%d %H:%M:%S"),
            'notAfter': c_val['not_after'].strftime("%Y-%m-%d %H:%M:%S"),
            'isValid': c_val['valid'],
            'isExpired': c_val['expired']
        })

    return {
        'deviceId': device_id,
        'algorithm': algorithm,
        'serialNumber': serial_number_hex,
        'subject': subject_str,
        'certValid': cert_valid,
        'certExpired': cert_expired,
        'privateKeyMatch': private_key_match,
        'chainValid': chain_valid,
        'rootType': root_type,
        'certCount': len(certs),
        'revoked': revoked,
        'revokeReason': revoke_reason,
        'checkTime': check_time,
        'certInfos': cert_infos
    }

async def update_attestation_status_loop():
    """Background downloader loop that refreshes Google's attestation status file."""
    logger.info("Background Google attestation status downloader loop started.")
    data_dir = os.path.join(CURRENT_DIR, "data")
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)

    url = "https://android.googleapis.com/attestation/status"
    while True:
        try:
            logger.info("Downloading latest attestation status list from Google...")
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(f"{url}?ts={int(time.time())}", headers={
                    "Cache-Control": "max-age=0, no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache"
                })
                if response.status_code == 200:
                    status_json = response.json()
                    with open(STATUS_FILE_PATH, 'w') as f:
                        json.dump(status_json, f)
                    logger.info(f"Successfully updated attestation status list ({len(status_json.get('entries', {}))} entries).")
                else:
                    logger.error(f"Failed to fetch Google attestation status list: HTTP {response.status_code}")
        except Exception as e:
            logger.error(f"Error in attestation status downloader loop: {e}")

        await asyncio.sleep(10800) # Every 3 hours

async def verify_stored_keyboxes_loop():
    """Background periodic checker that validates stored keyboxes and deletes invalid/revoked ones."""
    logger.info("Background stored keybox verification loop started.")
    await asyncio.sleep(60) # Wait 1 minute after start to let database init fully

    while True:
        try:
            stored_keyboxes = list(db.keyboxes.find())
            if stored_keyboxes:
                logger.info(f"Re-verifying {len(stored_keyboxes)} stored keyboxes...")
                for kb in stored_keyboxes:
                    xml_content = kb.get('xml_content')
                    serial_number = kb.get('serial_number')
                    if not xml_content or not serial_number:
                        continue

                    try:
                        res = validate_keybox_xml(xml_content)
                        # Check validation flags
                        is_valid = (
                            res['certValid'] and
                            (not res['revoked']) and
                            res['chainValid'] and
                            (res['privateKeyMatch'] is not False)
                        )
                        if not is_valid:
                            logger.warning(f"Keybox with serial {serial_number} is no longer valid. Deleting from database...")
                            db.keyboxes.delete_one({'serial_number': serial_number})
                        else:
                            dhaka_tz = datetime.timezone(datetime.timedelta(hours=6))
                            now_str = datetime.datetime.now(dhaka_tz).isoformat()
                            db.keyboxes.update_one(
                                {'serial_number': serial_number},
                                {'$set': {'last_checked_at': now_str}}
                            )
                    except Exception as ve:
                        logger.error(f"Keybox parser failed for stored keybox {serial_number} during periodic verification: {ve}. Deleting...")
                        db.keyboxes.delete_one({'serial_number': serial_number})
            else:
                logger.debug("No stored keyboxes to verify in pool.")
        except Exception as e:
            logger.error(f"Error in keybox re-verification loop: {e}")

        await asyncio.sleep(3600) # Every 1 hour


# ==========================================
# 5. FASTAPI APP & ROUTES
# ==========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database...")
    init_db()
    
    logger.info("Starting background Keep-Alive pinger...")
    asyncio.create_task(scheduler_loop())
    
    logger.info("Starting background self-ping keep-alive...")
    asyncio.create_task(self_ping_loop())

    logger.info("Starting background Google attestation status downloader...")
    asyncio.create_task(update_attestation_status_loop())

    logger.info("Starting background keybox validator loop...")
    asyncio.create_task(verify_stored_keyboxes_loop())
    yield

app = FastAPI(title="Keep-Alive Manager API", version="1.0.0", lifespan=lifespan)

# CORS middleware for local testing/development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic Schemas for validation
class TargetCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    url: str = Field(..., min_length=5, max_length=500)
    interval: int = Field(10, ge=1, le=1440) # Interval between 1 minute and 24 hours
    order: Optional[int] = Field(None, ge=1)

class TargetUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    url: str = Field(..., min_length=5, max_length=500)
    interval: int = Field(10, ge=1, le=1440)
    order: Optional[int] = Field(None, ge=1)

class TargetToggle(BaseModel):
    active: bool

# API REST Endpoints
@app.get("/api/targets")
def api_get_targets():
    """Fetch all configured keep-alive targets."""
    try:
        return get_all_targets()
    except Exception as e:
        logger.error(f"Error fetching targets: {e}")
        raise HTTPException(status_code=500, detail="Internal server error fetching targets")

@app.post("/api/targets")
def api_create_target(target: TargetCreate):
    """Add a new keep-alive app target."""
    try:
        target_id = add_target(name=target.name, url=target.url, interval=target.interval, order=target.order)
        return {"success": True, "id": target_id, "message": "Target added successfully."}
    except Exception as e:
        logger.error(f"Error creating target: {e}")
        if "UNIQUE constraint failed" in str(e):
            raise HTTPException(status_code=400, detail="A keep-alive target with this URL already exists.")
        raise HTTPException(status_code=500, detail="Internal server error creating target")

@app.put("/api/targets/{target_id}")
def api_update_target(target_id: str, target: TargetUpdate):
    """Update name, URL, interval details, and order of a target."""
    existing = get_target_by_id(target_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Target not found")
    try:
        update_target_details(target_id, name=target.name, url=target.url, interval=target.interval, order=target.order)
        return {"success": True, "message": "Target details updated."}
    except Exception as e:
        logger.error(f"Error updating target: {e}")
        if "UNIQUE constraint failed" in str(e):
            raise HTTPException(status_code=400, detail="A keep-alive target with this URL already exists.")
        raise HTTPException(status_code=500, detail="Internal server error updating target")

@app.patch("/api/targets/{target_id}/toggle")
def api_toggle_target(target_id: str, toggle: TargetToggle):
    """Toggle target active or inactive state."""
    existing = get_target_by_id(target_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Target not found")
    try:
        active_val = 1 if toggle.active else 0
        toggle_target_active(target_id, active_val)
        return {"success": True, "active": toggle.active, "message": f"Target {'activated' if toggle.active else 'deactivated'}."}
    except Exception as e:
        logger.error(f"Error toggling target state: {e}")
        raise HTTPException(status_code=500, detail="Internal server error toggling target status")

@app.delete("/api/targets/{target_id}")
def api_delete_target(target_id: str):
    """Delete a target and its associated logs."""
    existing = get_target_by_id(target_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Target not found")
    try:
        delete_target(target_id)
        return {"success": True, "message": "Target deleted successfully."}
    except Exception as e:
        logger.error(f"Error deleting target: {e}")
        raise HTTPException(status_code=500, detail="Internal server error deleting target")

class ReorderPayload(BaseModel):
    ordered_ids: List[str]

@app.post("/api/targets/reorder")
def api_reorder_targets(payload: ReorderPayload):
    """Update target order sequence."""
    try:
        for index, target_id in enumerate(payload.ordered_ids):
            db.targets.update_one(
                {"_id": ObjectId(target_id)},
                {"$set": {"order": index + 1}}
            )
        return {"success": True, "message": "Targets reordered successfully."}
    except Exception as e:
        logger.error(f"Error reordering targets: {e}")
        raise HTTPException(status_code=500, detail="Internal server error reordering targets")

@app.get("/api/targets/{target_id}/logs")
def api_get_target_logs(target_id: str, limit: int = 20):
    """Get recent ping execution logs for performance graph."""
    existing = get_target_by_id(target_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Target not found")
    try:
        return get_ping_logs(target_id, limit)
    except Exception as e:
        logger.error(f"Error retrieving target logs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error retrieving logs")

@app.post("/api/targets/{target_id}/ping")
async def api_trigger_ping(target_id: str):
    """Perform an instantaneous manual ping, saving execution metrics immediately."""
    target = get_target_by_id(target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    
    try:
        result = await perform_ping(target_id, target["url"])
        
        update_target_ping_status(
            target_id=target_id,
            status=result["status"],
            response_time=result["response_time_ms"],
            status_code=result["status_code"]
        )
        
        insert_ping_log(
            target_id=target_id,
            status=result["status"],
            response_time=result["response_time_ms"],
            status_code=result["status_code"],
            error_message=result["error_message"]
        )
        
        return {
            "success": True,
            "status": result["status"],
            "response_time_ms": result["response_time_ms"],
            "status_code": result["status_code"],
            "error_message": result["error_message"]
        }
    except Exception as e:
        logger.error(f"Error during manual target ping: {e}")
        raise HTTPException(status_code=500, detail="Internal server error during manual check")

@app.get("/api/stats")
def api_get_system_stats():
    """Retrieve global stats dashboard parameters."""
    try:
        return get_system_stats()
    except Exception as e:
        logger.error(f"Error getting statistics: {e}")
        raise HTTPException(status_code=500, detail="Internal server error loading stats")


# ==========================================
# MONGODB CRUD EXPLORER (DBHANDLER MERGED)
# ==========================================

active_client = None
active_uri = None

def db_serialize_doc(doc):
    if doc is None:
        return None
    if isinstance(doc, list):
        return [db_serialize_doc(d) for d in doc]
    if isinstance(doc, dict):
        new_doc = {}
        for k, v in doc.items():
            if isinstance(v, ObjectId):
                new_doc[k] = {"$oid": str(v)}
            elif isinstance(v, datetime.datetime):
                dhaka_tz = datetime.timezone(datetime.timedelta(hours=6))
                if v.tzinfo is None:
                    v = v.replace(tzinfo=datetime.timezone.utc)
                v_dhaka = v.astimezone(dhaka_tz)
                new_doc[k] = {"$date": v_dhaka.isoformat()}
            elif isinstance(v, (dict, list)):
                new_doc[k] = db_serialize_doc(v)
            else:
                new_doc[k] = v
        return new_doc
    return doc

def db_deserialize_doc(doc):
    if doc is None:
        return None
    if isinstance(doc, list):
        return [db_deserialize_doc(d) for d in doc]
    if isinstance(doc, dict):
        new_doc = {}
        for k, v in doc.items():
            if isinstance(v, dict):
                if "$oid" in v:
                    try:
                        new_doc[k] = ObjectId(v["$oid"])
                    except Exception:
                        new_doc[k] = v["$oid"]
                elif "$date" in v:
                    try:
                        new_doc[k] = datetime.datetime.fromisoformat(v["$date"])
                    except Exception:
                        new_doc[k] = v["$date"]
                else:
                    new_doc[k] = db_deserialize_doc(v)
            elif isinstance(v, list):
                new_doc[k] = [db_deserialize_doc(item) for item in v]
            else:
                new_doc[k] = v
        return new_doc
    return doc

def db_get_client():
    global active_client
    if active_client is None:
        raise HTTPException(status_code=400, detail="No active MongoDB connection. Please connect first.")
    return active_client

# Models for Request Bodies
class ConnectRequest(BaseModel):
    uri: str

class CreateCollectionRequest(BaseModel):
    db_name: str
    collection_name: str

class DeleteCollectionRequest(BaseModel):
    db_name: str
    collection_name: str

class QueryRequest(BaseModel):
    db_name: str
    collection_name: str
    filter_query: Optional[str] = "{}"
    sort_field: Optional[str] = None
    sort_order: Optional[int] = 1 # 1 = Asc, -1 = Desc
    page: int = 1
    limit: int = 10

class CreateDocumentRequest(BaseModel):
    db_name: str
    collection_name: str
    document: Dict[str, Any]

class UpdateDocumentRequest(BaseModel):
    db_name: str
    collection_name: str
    id_str: str
    document: Dict[str, Any]

class DeleteDocumentRequest(BaseModel):
    db_name: str
    collection_name: str
    id_str: str

# API ENDPOINTS

@app.post("/api/connect")
def connect_db(req: ConnectRequest):
    global active_client, active_uri
    try:
        # Create a client with a 5-second timeout for testing connection immediately
        client = MongoClient(req.uri, serverSelectionTimeoutMS=5000)
        # Ping the server to trigger connection validation
        client.admin.command('ping')
        
        # Save successfully connected client
        active_client = client
        active_uri = req.uri
        
        # Get initial list of databases
        dbs = client.list_database_names()
        return {
            "status": "success",
            "message": "Successfully connected to MongoDB!",
            "databases": dbs
        }
    except Exception as e:
        active_client = None
        active_uri = None
        raise HTTPException(status_code=400, detail=f"Connection failed: {str(e)}")

@app.post("/api/disconnect")
def disconnect_db():
    global active_client, active_uri
    if active_client:
        active_client.close()
    active_client = None
    active_uri = None
    return {"status": "success", "message": "Disconnected from database."}

@app.get("/api/connection-status")
def connection_status():
    global active_client, active_uri
    if active_client:
        try:
            active_client.admin.command('ping')
            return {"connected": True, "uri": active_uri}
        except Exception:
            active_client = None
            active_uri = None
    return {"connected": False}

@app.get("/api/databases")
def list_databases():
    client = db_get_client()
    try:
        return {"databases": client.list_database_names()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/collections")
def list_collections(db_name: str = Query(...)):
    client = db_get_client()
    try:
        db = client[db_name]
        collections_info = []
        for name in sorted(db.list_collection_names()):
            try:
                stats = db.command("collStats", name)
                count = stats.get("count", 0)
                size = stats.get("size", 0)
            except Exception:
                count = 0
                size = 0
            collections_info.append({
                "name": name,
                "count": count,
                "size": size
            })
        return {"collections": collections_info}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/collections/create")
def create_collection(req: CreateCollectionRequest):
    client = db_get_client()
    try:
        db = client[req.db_name]
        db.create_collection(req.collection_name)
        return {"status": "success", "message": f"Collection '{req.collection_name}' created."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/collections/delete")
def delete_collection(req: DeleteCollectionRequest):
    client = db_get_client()
    try:
        db = client[req.db_name]
        db.drop_collection(req.collection_name)
        return {"status": "success", "message": f"Collection '{req.collection_name}' dropped successfully."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/documents")
def list_documents(req: QueryRequest):
    client = db_get_client()
    try:
        db = client[req.db_name]
        col = db[req.collection_name]
        
        # Parse query filter
        filter_dict = {}
        if req.filter_query and req.filter_query.strip():
            try:
                # We deserialize custom structures if present
                raw_dict = json.loads(req.filter_query)
                filter_dict = db_deserialize_doc(raw_dict)
            except json.JSONDecodeError as je:
                raise HTTPException(status_code=400, detail=f"Invalid JSON in search filter: {str(je)}")
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Filter parse error: {str(e)}")
        
        # Count matching documents
        total_docs = col.count_documents(filter_dict)
        
        # Prepare pagination & query
        skip_count = (req.page - 1) * req.limit
        cursor = col.find(filter_dict)
        
        # Handle sorting
        if req.sort_field and req.sort_field.strip():
            cursor = cursor.sort(req.sort_field, req.sort_order)
            
        cursor = cursor.skip(skip_count).limit(req.limit)
        
        documents = list(cursor)
        serialized = [db_serialize_doc(doc) for doc in documents]
        
        return {
            "documents": serialized,
            "total": total_docs,
            "page": req.page,
            "limit": req.limit,
            "pages": (total_docs + req.limit - 1) // req.limit if total_docs > 0 else 0
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query error: {str(e)}")

@app.post("/api/documents/create")
def create_document(req: CreateDocumentRequest):
    client = db_get_client()
    try:
        db = client[req.db_name]
        col = db[req.collection_name]
        
        # Parse document, applying custom deserializer for special fields
        document_bson = db_deserialize_doc(req.document)
        
        # Insert document
        result = col.insert_one(document_bson)
        return {
            "status": "success",
            "message": "Document inserted successfully",
            "_id": str(result.inserted_id)
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Insertion failed: {str(e)}")

@app.post("/api/documents/update")
def update_document(req: UpdateDocumentRequest):
    client = db_get_client()
    try:
        db = client[req.db_name]
        col = db[req.collection_name]
        
        # Parse active target document id
        try:
            target_id = ObjectId(req.id_str)
        except Exception:
            target_id = req.id_str  # Use string directly if not an ObjectId
            
        # Parse incoming update payload
        document_bson = db_deserialize_doc(req.document)
        
        # Make sure we don't accidentally try to modify the immutable _id field in the $set query
        if "_id" in document_bson:
            del document_bson["_id"]
            
        result = col.update_one({"_id": target_id}, {"$set": document_bson})
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Document not found or no changes made")
            
        return {
            "status": "success",
            "message": "Document updated successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Update failed: {str(e)}")

@app.post("/api/documents/delete")
def delete_document(req: DeleteDocumentRequest):
    client = db_get_client()
    try:
        db = client[req.db_name]
        col = db[req.collection_name]
        
        try:
            target_id = ObjectId(req.id_str)
        except Exception:
            target_id = req.id_str
            
        result = col.delete_one({"_id": target_id})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Document not found.")
            
        return {"status": "success", "message": "Document deleted successfully."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Deletion failed: {str(e)}")

@app.get("/api/config")
def get_config():
    return {"predefined_uri": PREDEFINED_URI}


class KeyboxCheckRequest(BaseModel):
    xml_content: str

@app.post("/api/keybox/check")
def api_check_keybox(req: KeyboxCheckRequest):
    """Parses and checks an Android Keybox XML, saving it if it is valid."""
    try:
        res = validate_keybox_xml(req.xml_content)
        # Check if valid
        is_valid = (
            res['certValid'] and
            (not res['revoked']) and
            res['chainValid'] and
            (res['privateKeyMatch'] is not False)
        )
        saved = False
        if is_valid:
            try:
                dhaka_tz = datetime.timezone(datetime.timedelta(hours=6))
                now_str = datetime.datetime.now(dhaka_tz).isoformat()
                # Upsert into database
                db.keyboxes.update_one(
                    {"serial_number": res['serialNumber']},
                    {"$set": {
                        "device_id": res['deviceId'],
                        "serial_number": res['serialNumber'],
                        "algorithm": res['algorithm'],
                        "root_type": res['rootType'],
                        "xml_content": req.xml_content,
                        "created_at": now_str,
                        "last_checked_at": now_str,
                        "status": "VALID"
                    }},
                    upsert=True
                )
                saved = True
            except Exception as dbe:
                logger.error(f"Failed to save valid keybox to database: {dbe}")
                
        return {
            "success": is_valid,
            "result": res,
            "saved": saved
        }
    except Exception as e:
        logger.error(f"Keybox validation endpoint exception: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/keyboxes")
def api_get_keyboxes():
    """Retrieve all stored valid keyboxes."""
    try:
        kbs = list(db.keyboxes.find().sort("created_at", -1))
        return [serialize_doc(kb) for kb in kbs]
    except Exception as e:
        logger.error(f"Error fetching keyboxes: {e}")
        raise HTTPException(status_code=500, detail="Internal server error fetching keyboxes")

@app.delete("/api/keyboxes/{serial_number}")
def api_delete_keybox(serial_number: str):
    """Delete a stored keybox by its serial number."""
    try:
        result = db.keyboxes.delete_one({"serial_number": serial_number})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Keybox not found")
        return {"success": True, "message": "Keybox deleted successfully."}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting keybox: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Serve Frontend SPA
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

if not os.path.exists(STATIC_DIR):
    os.makedirs(STATIC_DIR)

@app.get("/")
def serve_index():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "Keep-Alive Manager running! Static HTML is being initialized."}

# Mount CSS/JS folders
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True, access_log=False)
