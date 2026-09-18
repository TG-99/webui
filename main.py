import sys
import os
import asyncio
import datetime
import time
import logging
import json
import re
import base64
import hashlib
import xml.etree.ElementTree as ET
from contextlib import asynccontextmanager
from typing import Dict, Any, Optional, List, Union, Tuple
from dotenv import load_dotenv

# Ensure local directory is in python search path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn
import httpx
from pymongo import MongoClient, DESCENDING
from cryptography import x509
from cryptography.hazmat.primitives.serialization import (
    load_pem_private_key,
    load_pem_public_key,
    load_der_private_key,
    Encoding,
    PublicFormat
)

# ==========================================
# 1. CONFIGURATIONS & LOGGING
# ==========================================
load_dotenv()
MONGO_URI = os.environ.get("MONGO_URI", "mongodb+srv://mltb-2:mltb-2@cluster0.56sdwsb.mongodb.net")
DB_NAME = os.environ.get("MONGO_DB_NAME", "keybox")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("keybox_service")

# ==========================================
# 2. DATABASE LAYER
# ==========================================
client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
db = client[DB_NAME]

def serialize_doc(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Utility to map MongoDB ObjectId to string 'id' for JSON responses."""
    if not doc:
        return None
    d = dict(doc)
    if "_id" in d:
        d["id"] = str(d.pop("_id"))
    return d

def init_db():
    """Initializes the database collections and unique indexes."""
    try:
        client.admin.command("ping")
        logger.info("Successfully connected to MongoDB.")
        db.keyboxes.create_index("serial_number", unique=True)
        db.keyboxes.create_index("created_at")
        db.keyboxes.create_index("status")
        logger.info("Keybox collections and indexes initialized successfully.")
    except Exception as e:
        logger.error(f"Error initializing MongoDB database: {e}")

# ==========================================
# 3. ROOT CERTIFICATES & ATTESTATION CONSTANTS
# ==========================================
# ==========================================
# 3. ROOT DEFINITIONS & CERTIFICATE FINGERPRINTS (EVOKER ENGINE)
# ==========================================
ROOTS_BY_SPKI_SHA256 = {
    "feb2ea7551ee316ed4bb443c8293b884dbfdea40b603ee3e4f4a897e4580fbae": {
        "kind": "hardware",
        "name": "Google Hardware Attestation Root",
        "algorithm": "RSA-4096",
        "note": "Classic TEE root (subject serialNumber f92009e853b6b045), RSA-4096. Hardware keyboxes chain to this."
    },
    "3ee44512a1af2beb39c889490c60ea3f82e43f5d5a5532f5ab9419f676cd07ec": {
        "kind": "rkp",
        "name": "Google Key Attestation CA1 (RKP)",
        "algorithm": "ECDSA P-384",
        "note": "Remote Key Provisioning root, valid 2025-07-17 to 2035-07-15, ECDSA P-384."
    }
}

ROOT_BY_NAME_FALLBACK = {
    "f92009e853b6b045": "feb2ea7551ee316ed4bb443c8293b884dbfdea40b603ee3e4f4a897e4580fbae",
    "key attestation ca1": "3ee44512a1af2beb39c889490c60ea3f82e43f5d5a5532f5ab9419f676cd07ec"
}

SOFTWARE_ROOT_RE = re.compile(r"android\s+keystore\s+software\s+attestation\s+root", re.IGNORECASE)

KNOX_ROOT_PEM = """-----BEGIN PUBLIC KEY-----
MIGbMBAGByqGSM49AgEGBSuBBAAjA4GGAAQBhbGuLrpql5I2WJmrE5kEVZOo+dgA
46mKrVJf/sgzfzs2u7M9c1Y9ZkCEiiYkhTFE9vPbasmUfXybwgZ2EM30A1ABPd12
4n3JbEDfsB/wnMH1AcgsJyJFPbETZiy42Fhwi+2BCA5bcHe7SrdkRIYSsdBRaKBo
ZsapxB0gAOs0jSPRX5M=
-----END PUBLIC KEY-----"""

def get_spki_der_and_sha256(pub_key) -> Tuple[bytes, str]:
    spki_der = pub_key.public_bytes(
        encoding=Encoding.DER,
        format=PublicFormat.SubjectPublicKeyInfo
    )
    sha256_hex = hashlib.sha256(spki_der).hexdigest().lower()
    return spki_der, sha256_hex

STATUS_FILE_PATH = os.path.join(CURRENT_DIR, "data", "attestation_status.json")
SOFTBAN_FILE_PATH = os.path.join(CURRENT_DIR, "data", "softban_status.json")

# Known Specter catalog & community softbanned serial numbers (hex lowercase)
KNOWN_SOFTBANNED_SERIALS = {
    "64deaa4d53885472afac267bdbd4a472",
    "09307822e6c6f88cd2f1ab20c37afeb1",
    "9307822e6c6f88cd2f1ab20c37afeb1",
    "134078943617139521927251692639770420338",
    "12214718865605971583567181966175043249"
}

# ==========================================
# 4. ADVANCED KEYBOX PARSER & VALIDATION LAYER
# ==========================================
def parse_keybox_xml(xml_content: str) -> Dict[str, Any]:
    """Parses Android keybox XML string, extracting device ID, algorithm, private key and cert chain."""
    try:
        cleaned_xml = xml_content.strip()
        cleaned_xml = re.sub(r"<\?xml.*?\?>", "", cleaned_xml).strip()
        root = ET.fromstring(cleaned_xml)
    except Exception as e:
        logger.error(f"XML Parsing Exception: {e}")
        raise ValueError(f"Invalid XML syntax: {str(e)}")

    keybox = None
    if root.tag.endswith("AndroidAttestation"):
        for child in root:
            if child.tag.endswith("Keybox"):
                keybox = child
                break
    else:
        if root.tag.endswith("Keybox"):
            keybox = root

    if not keybox:
        for elem in root.iter():
            if elem.tag.endswith("Keybox"):
                keybox = elem
                break

    if not keybox:
        raise ValueError("Invalid Keybox XML: missing AndroidAttestation/Keybox element structure.")

    device_id = "Unknown"
    for k, v in keybox.attrib.items():
        if k.lower().endswith("deviceid"):
            device_id = v
            break

    key_elems = [e for e in keybox if e.tag.endswith("Key")]
    if not key_elems:
        raise ValueError("Invalid Keybox XML: missing Key element.")

    key_elem = key_elems[0]
    algorithm = "Unknown"
    for k, v in key_elem.attrib.items():
        if k.lower().endswith("algorithm"):
            algorithm = v
            break

    private_key_pem = ""
    cert_chain_elem = None
    for child in key_elem:
        if child.tag.endswith("PrivateKey"):
            private_key_pem = (child.text or "").strip()
        elif child.tag.endswith("CertificateChain"):
            cert_chain_elem = child

    if not cert_chain_elem:
        raise ValueError("Invalid Keybox XML: missing CertificateChain element.")

    cert_pems = []
    for child in cert_chain_elem:
        if child.tag.endswith("Certificate"):
            child_text = (child.text or "").strip()
            if child_text:
                certs_found = []
                pattern = re.compile(r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", re.DOTALL)
                for match in pattern.finditer(child_text):
                    certs_found.append(match.group(0).strip())
                
                if not certs_found:
                    base64_only = re.sub(r"\s+", "", child_text)
                    if base64_only:
                        certs_found.append(f"-----BEGIN CERTIFICATE-----\n{base64_only}\n-----END CERTIFICATE-----")
                
                cert_pems.extend(certs_found)

    return {
        "device_id": device_id,
        "algorithm": algorithm,
        "private_key_pem": private_key_pem,
        "cert_pems": cert_pems
    }

def load_private_key_robust(priv_key_str: str, cert_pub_key=None) -> Any:
    """Robustly load a private key in PEM or base64 DER format."""
    cleaned = priv_key_str.strip()

    if "BEGIN" in cleaned:
        try:
            return load_pem_private_key(cleaned.encode("utf-8"), password=None)
        except Exception:
            pass

    base64_data = cleaned
    for header in [
        "-----BEGIN RSA PRIVATE KEY-----", "-----END RSA PRIVATE KEY-----",
        "-----BEGIN EC PRIVATE KEY-----", "-----END EC PRIVATE KEY-----",
        "-----BEGIN PRIVATE KEY-----", "-----END PRIVATE KEY-----"
    ]:
        base64_data = base64_data.replace(header, "")
    base64_data = re.sub(r"\s+", "", base64_data)

    try:
        der_bytes = base64.b64decode(base64_data)
        return load_der_private_key(der_bytes, password=None)
    except Exception:
        pass

    raise ValueError("Could not parse private key format (PEM or raw DER).")

def load_cert_robust(cert_str: str) -> x509.Certificate:
    """Robustly load an x509 Certificate from PEM string or raw base64 DER bytes."""
    cleaned = cert_str.strip()

    if "BEGIN CERTIFICATE" in cleaned:
        try:
            return x509.load_pem_x509_certificate(cleaned.encode("utf-8"))
        except Exception:
            pass

    base64_data = cleaned
    for header in ["-----BEGIN CERTIFICATE-----", "-----END CERTIFICATE-----"]:
        base64_data = base64_data.replace(header, "")
    base64_data = re.sub(r"\s+", "", base64_data)

    wrapped_pem = "-----BEGIN CERTIFICATE-----\n" + "\n".join([base64_data[i:i+64] for i in range(0, len(base64_data), 64)]) + "\n-----END CERTIFICATE-----"
    try:
        return x509.load_pem_x509_certificate(wrapped_pem.encode("utf-8"))
    except Exception:
        pass

    try:
        der_bytes = base64.b64decode(base64_data)
        return x509.load_der_x509_certificate(der_bytes)
    except Exception as e:
        raise ValueError(f"Could not load certificate in PEM or DER format: {e}")

def check_cert_validity(cert: x509.Certificate) -> Dict[str, Any]:
    """Helper to verify certificate active/expired status against current UTC time."""
    now_utc = datetime.timezone.utc
    try:
        not_before = cert.not_valid_before_utc
        not_after = cert.not_valid_after_utc
    except AttributeError:
        not_before = cert.not_valid_before.replace(tzinfo=datetime.timezone.utc)
        not_after = cert.not_valid_after.replace(tzinfo=datetime.timezone.utc)

    now_dt = datetime.datetime.now(now_utc)
    return {
        "valid": not_before <= now_dt <= not_after,
        "expired": now_dt > not_after,
        "not_before": not_before,
        "not_after": not_after
    }

def verify_certificate_chain_advanced(certs: List[x509.Certificate]) -> Dict[str, Any]:
    """
    Advanced verification of certificate signatures up the chain.
    For each certificate, matches its issuer in the chain and tests signature.
    """
    if len(certs) <= 1:
        return {"valid": True, "broken_count": 0, "links": []}

    broken_count = 0
    links = []

    for i in range(len(certs) - 1):
        child = certs[i]
        parent = certs[i + 1]

        # Check if parent subject matches child issuer
        is_direct = (child.issuer == parent.subject)
        sig_ok = False
        try:
            child.verify_directly_issued_by(parent)
            sig_ok = True
        except Exception as e:
            logger.debug(f"Direct issuance check failed between cert {i} and {i+1}: {e}")
            sig_ok = False
            broken_count += 1

        links.append({
            "child_serial": format(child.serial_number, "x").lstrip("0") or "0",
            "parent_serial": format(parent.serial_number, "x").lstrip("0") or "0",
            "valid": sig_ok,
            "issuer_match": is_direct
        })

    return {
        "valid": broken_count == 0,
        "broken_count": broken_count,
        "links": links
    }

def identify_root_advanced(certs: List[x509.Certificate]) -> Dict[str, Any]:
    """
    Advanced Attestation Root identification based on SPKI SHA-256 fingerprint,
    subject naming, and issuer fallback (matching Evoker specification).
    """
    if not certs:
        return {
            "kind": "unknown",
            "name": "No Certificates Found",
            "spki_sha256": None,
            "included": False,
            "note": "Chain is empty."
        }

    # Find self-signed certificate if bundled
    self_signed = [c for c in certs if c.subject == c.issuer]
    root_cert = None
    root_spki_sha256 = None
    included = False

    if self_signed:
        included = True
        root_cert = self_signed[0]
        _, root_spki_sha256 = get_spki_der_and_sha256(root_cert.public_key())
        for c in self_signed:
            _, h = get_spki_der_and_sha256(c.public_key())
            if h in ROOTS_BY_SPKI_SHA256:
                root_cert = c
                root_spki_sha256 = h
                break
    else:
        # Fallback to topmost intermediate certificate's issuer name
        top_cert = certs[-1]
        try:
            top_issuer_str = top_cert.issuer.rfc4514_string().lower()
        except Exception:
            top_issuer_str = str(top_cert.issuer).lower()

        for needle, spki_h in ROOT_BY_NAME_FALLBACK.items():
            if needle in top_issuer_str:
                root_spki_sha256 = spki_h
                break

    # Look up in known roots
    if root_spki_sha256 and root_spki_sha256 in ROOTS_BY_SPKI_SHA256:
        root_info = ROOTS_BY_SPKI_SHA256[root_spki_sha256]
        return {
            "kind": root_info["kind"],
            "name": root_info["name"],
            "spki_sha256": root_spki_sha256,
            "included": included,
            "note": root_info["note"]
        }

    # Check for AOSP software root
    root_subject = ""
    if root_cert:
        try: root_subject = root_cert.subject.rfc4514_string()
        except Exception: root_subject = str(root_cert.subject)
    else:
        try: root_subject = certs[-1].issuer.rfc4514_string()
        except Exception: root_subject = str(certs[-1].issuer)

    if SOFTWARE_ROOT_RE.search(root_subject):
        return {
            "kind": "software",
            "name": "AOSP Software Attestation Root",
            "spki_sha256": root_spki_sha256,
            "included": included,
            "note": "This is the AOSP software attestation key that Android builds ship publicly. It is not a hardware keybox and can never reach STRONG integrity."
        }

    # Check for Knox TEE root
    if root_cert:
        try:
            _, h = get_spki_der_and_sha256(root_cert.public_key())
            knox_pub = load_pem_public_key(KNOX_ROOT_PEM.encode("utf-8"))
            _, knox_h = get_spki_der_and_sha256(knox_pub)
            if h == knox_h:
                return {
                    "kind": "knox",
                    "name": "Samsung Knox Attestation Root",
                    "spki_sha256": h,
                    "included": included,
                    "note": "Samsung Knox Hardware TEE root certificate."
                }
        except Exception:
            pass

    return {
        "kind": "unknown",
        "name": root_subject or "Custom / OEM Attestation Root",
        "spki_sha256": root_spki_sha256,
        "included": included,
        "note": "This root is not one of Google’s standard public attestation roots."
    }

def check_revocation_status_advanced(certs: List[x509.Certificate]) -> Dict[str, Any]:
    """Check all serial numbers across the certificate chain against Google CRL."""
    if not os.path.exists(STATUS_FILE_PATH):
        return {"revoked": False, "reason": None, "revoked_serials": []}

    try:
        with open(STATUS_FILE_PATH, "r") as f:
            status_data = json.load(f)

        entries = status_data.get("entries", {})
        revoked_serials = []
        revoke_reason = None

        for cert in certs:
            sn_int = cert.serial_number
            sn_hex = format(sn_int, "x").lower()
            sn_hex_clean = sn_hex.lstrip("0") or "0"
            sn_dec = str(sn_int)

            matched_entry = None
            if sn_hex_clean in entries:
                matched_entry = entries[sn_hex_clean]
            elif sn_hex in entries:
                matched_entry = entries[sn_hex]
            elif sn_dec in entries:
                matched_entry = entries[sn_dec]

            if matched_entry:
                reason = matched_entry.get("reason", "REVOKED in Google CRL")
                revoked_serials.append({"serial": sn_hex_clean, "reason": reason})
                if not revoke_reason:
                    revoke_reason = reason

        if revoked_serials:
            return {
                "revoked": True,
                "reason": revoke_reason or "Revoked in Google CRL",
                "revoked_serials": revoked_serials
            }
    except Exception as e:
        logger.error(f"Error checking attestation status: {e}")
        return {"revoked": False, "reason": f"Check error: {str(e)}", "revoked_serials": []}

    return {"revoked": False, "reason": None, "revoked_serials": []}

def check_softban_status_advanced(certs: List[x509.Certificate], root_info: Dict[str, Any]) -> Dict[str, Any]:
    """
    Check if a keybox is softbanned:
    1. Root is specifically AOSP software root -> only achieves Device integrity.
    2. Serial number matches Specter Catalog / known softbanned list.
    """
    if root_info.get("kind") == "software":
        return {
            "is_softbanned": True,
            "reason": "AOSP Software Attestation Root - Play Integrity evaluates as Device Integrity only",
            "specter_match": False
        }

    file_serials = set()
    if os.path.exists(SOFTBAN_FILE_PATH):
        try:
            with open(SOFTBAN_FILE_PATH, "r") as f:
                sb_data = json.load(f)
                if isinstance(sb_data, list):
                    file_serials.update(str(s).lower() for s in sb_data)
                elif isinstance(sb_data, dict):
                    file_serials.update(str(s).lower() for s in sb_data.get("serials", []))
                    file_serials.update(str(s).lower() for s in sb_data.get("entries", {}).keys())
        except Exception as e:
            logger.warning(f"Could not read softban file: {e}")

    combined_softbanned = KNOWN_SOFTBANNED_SERIALS.union(file_serials)

    for cert in certs:
        sn_int = cert.serial_number
        sn_hex = format(sn_int, "x").lower()
        sn_hex_clean = sn_hex.lstrip("0") or "0"
        sn_dec = str(sn_int)

        if (sn_hex in combined_softbanned) or (sn_hex_clean in combined_softbanned) or (sn_dec in combined_softbanned):
            return {
                "is_softbanned": True,
                "reason": f"Flagged in Specter Softban Catalog (Serial: {sn_hex_clean}) - cannot pass Strong hardware attestation",
                "specter_match": True
            }

    return {
        "is_softbanned": False,
        "reason": None,
        "specter_match": False
    }

def validate_keybox_xml(xml_content: str) -> Dict[str, Any]:
    """
    Advanced verification validator for Android Keyboxes (Evoker Specification).
    Checks Google Root identification, Chain Signatures, Private Key Match, Expiry, CRL, and Specter Catalog.
    """
    parsed = parse_keybox_xml(xml_content)
    device_id = parsed["device_id"]
    algorithm = parsed["algorithm"]
    private_key_pem = parsed["private_key_pem"]
    cert_pems = parsed["cert_pems"]

    if not cert_pems:
        raise ValueError("No certificates found in Keybox.")

    certs = [load_cert_robust(pem) for pem in cert_pems]
    leaf_cert = certs[0]
    serial_number_hex = format(leaf_cert.serial_number, "x").lstrip("0") or "0"

    try:
        subject_str = leaf_cert.subject.rfc4514_string()
    except Exception:
        subject_str = str(leaf_cert.subject)

    # 1. Private Key Match Verification
    private_key_match = None
    if private_key_pem:
        try:
            priv_key = load_private_key_robust(private_key_pem, leaf_cert.public_key())
            _, priv_pub_h = get_spki_der_and_sha256(priv_key.public_key())
            _, cert_pub_h = get_spki_der_and_sha256(leaf_cert.public_key())
            private_key_match = (priv_pub_h == cert_pub_h)
        except Exception as e:
            logger.error(f"Private key match verification exception: {e}")
            private_key_match = False

    # 2. Chain Signature Verification
    chain_report = verify_certificate_chain_advanced(certs)
    chain_valid = chain_report["valid"]

    # 3. Root Attestation Identification
    root_info = identify_root_advanced(certs)
    root_type = root_info["kind"]
    root_name = root_info["name"]

    # 4. Validity Window & Expiration Calculations
    validity_list = [check_cert_validity(c) for c in certs]
    all_valid = all(v["valid"] for v in validity_list)
    any_expired = any(v["expired"] for v in validity_list)

    earliest_not_after = min(v["not_after"] for v in validity_list)
    latest_not_before = max(v["not_before"] for v in validity_list)
    now_utc_dt = datetime.datetime.now(datetime.timezone.utc)
    days_left = (earliest_not_after - now_utc_dt).total_seconds() / 86400.0

    # 5. Google Attestation CRL Verification
    rev_info = check_revocation_status_advanced(certs)
    revoked = rev_info["revoked"]
    revoke_reason = rev_info["reason"]

    # 6. Softban & Specter Catalog Check
    softban_info = check_softban_status_advanced(certs, root_info)
    is_softbanned = softban_info["is_softbanned"]
    softban_reason = softban_info["reason"]

    # 7. Final Classification Status: "STRONG" | "SOFTBAN" | "REVOKED" | "INVALID"
    if revoked:
        status = "REVOKED"
        integrity_verdict = "Revoked in Google CRL"
    elif any_expired or (not chain_valid) or (private_key_match is False):
        status = "INVALID"
        if any_expired:
            integrity_verdict = "Expired Certificate Chain"
        elif not chain_valid:
            integrity_verdict = "Broken Certificate Chain Signature"
        elif private_key_match is False:
            integrity_verdict = "Private Key Mismatched from Leaf Certificate"
        else:
            integrity_verdict = "Invalid Certificate Structure"
    elif root_type == "software" or is_softbanned:
        status = "SOFTBAN"
        integrity_verdict = "Device Integrity (Softbanned / AOSP Software Root)"
    elif root_type in ["hardware", "rkp", "knox", "unknown"]:
        status = "STRONG"
        if root_type == "hardware":
            integrity_verdict = "Strong Hardware Attestation (Google Hardware Root)"
        elif root_type == "rkp":
            integrity_verdict = "Strong Hardware Attestation (Google Key Attestation CA1 RKP)"
        elif root_type == "knox":
            integrity_verdict = "Strong Hardware Attestation (Samsung Knox Root)"
        else:
            integrity_verdict = "Strong Hardware Attestation (Custom / OEM Attestation Root)"
    else:
        status = "INVALID"
        integrity_verdict = "Invalid / Untrusted Root"

    check_time = now_utc_dt.strftime("%Y-%m-%d %H:%M:%S")

    cert_infos = []
    for idx, (cert, v_info) in enumerate(zip(certs, validity_list)):
        try:
            c_sub = cert.subject.rfc4514_string()
            c_iss = cert.issuer.rfc4514_string()
        except Exception:
            c_sub = str(cert.subject)
            c_iss = str(cert.issuer)

        cert_infos.append({
            "level": idx,
            "serialNumber": format(cert.serial_number, "x").lstrip("0") or "0",
            "subject": c_sub,
            "issuer": c_iss,
            "notBefore": v_info["not_before"].strftime("%Y-%m-%d %H:%M:%S"),
            "notAfter": v_info["not_after"].strftime("%Y-%m-%d %H:%M:%S"),
            "isValid": v_info["valid"],
            "isExpired": v_info["expired"]
        })

    return {
        "deviceId": device_id,
        "algorithm": algorithm,
        "serialNumber": serial_number_hex,
        "subject": subject_str,
        "certValid": all_valid,
        "certExpired": any_expired,
        "privateKeyMatch": private_key_match,
        "chainValid": chain_valid,
        "brokenLinksCount": chain_report["broken_count"],
        "rootType": root_type,
        "rootName": root_name,
        "rootInfo": root_info,
        "expiresAt": earliest_not_after.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "daysLeft": max(0, int(days_left)),
        "isExpiringSoon": days_left <= 14,
        "certCount": len(certs),
        "revoked": revoked,
        "revokeReason": revoke_reason,
        "isSoftbanned": is_softbanned,
        "softbanReason": softban_reason,
        "status": status,
        "integrityVerdict": integrity_verdict,
        "checkTime": check_time,
        "certInfos": cert_infos
    }

def reclassify_all_stored_keyboxes():
    """Immediately re-verifies and reclassifies all stored keyboxes with Strong/Softban/Revoked tags."""
    try:
        stored = list(db.keyboxes.find())
        if not stored:
            return
        logger.info(f"Re-verifying and classifying {len(stored)} stored keyboxes...")
        dhaka_tz = datetime.timezone(datetime.timedelta(hours=6))
        now_str = datetime.datetime.now(dhaka_tz).isoformat()
        for kb in stored:
            xml_content = kb.get("xml_content")
            serial_number = kb.get("serial_number")
            if not xml_content or not serial_number:
                continue
            try:
                res = validate_keybox_xml(xml_content)
                status_str = res.get("status", "INVALID")
                is_revoked_or_invalid = status_str in ["REVOKED", "INVALID"]
                detected_revoked_at = None
                if is_revoked_or_invalid:
                    detected_revoked_at = kb.get("detected_revoked_at") or now_str

                db.keyboxes.update_one(
                    {"serial_number": serial_number},
                    {"$set": {
                        "last_checked_at": now_str,
                        "status": status_str,
                        "is_softbanned": res.get("isSoftbanned", False),
                        "root_type": res.get("rootType", "Attestation Root"),
                        "root_name": res.get("rootName", "Attestation Root"),
                        "days_left": res.get("daysLeft", 0),
                        "expires_at": res.get("expiresAt", ""),
                        "is_expiring_soon": res.get("isExpiringSoon", False),
                        "chain_valid": res.get("chainValid", True),
                        "private_key_match": res.get("privateKeyMatch", True),
                        "detected_revoked_at": detected_revoked_at
                    }}
                )
            except Exception as ve:
                logger.error(f"Failed to reclassify keybox {serial_number}: {ve}")
        purge_expired_revoked_keyboxes()
    except Exception as e:
        logger.error(f"Error in reclassify_all_stored_keyboxes: {e}")

def purge_expired_revoked_keyboxes() -> int:
    """
    Deletes all REVOKED or INVALID keyboxes after 24 hours of detection.
    """
    try:
        dhaka_tz = datetime.timezone(datetime.timedelta(hours=6))
        cutoff = datetime.datetime.now(dhaka_tz) - datetime.timedelta(hours=24)
        cutoff_str = cutoff.isoformat()
        
        # Purge keys marked REVOKED/INVALID with detected_revoked_at older than 24h,
        # or created_at older than 24h if detected_revoked_at is missing.
        query = {
            "status": {"$in": ["REVOKED", "INVALID"]},
            "$or": [
                {"detected_revoked_at": {"$lte": cutoff_str}},
                {"detected_revoked_at": None, "created_at": {"$lte": cutoff_str}}
            ]
        }
        res = db.keyboxes.delete_many(query)
        if res.deleted_count > 0:
            logger.info(f"Auto-purged {res.deleted_count} expired REVOKED/INVALID keyboxes (>24h since detection).")
        return res.deleted_count
    except Exception as e:
        logger.error(f"Error in purge_expired_revoked_keyboxes: {e}")
        return 0

# ==========================================
# 5. BACKGROUND LOOPS
# ==========================================
async def update_attestation_status_loop():
    """Background downloader loop that refreshes Google's attestation status file every 3 hours."""
    logger.info("Background Google attestation status downloader loop started.")
    data_dir = os.path.join(CURRENT_DIR, "data")
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)

    url = "https://android.googleapis.com/attestation/status"
    while True:
        try:
            logger.info("Downloading latest attestation status list from Google...")
            async with httpx.AsyncClient(timeout=30.0) as http_client:
                response = await http_client.get(f"{url}?ts={int(time.time())}", headers={
                    "Cache-Control": "max-age=0, no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache"
                })
                if response.status_code == 200:
                    status_json = response.json()
                    with open(STATUS_FILE_PATH, "w") as f:
                        json.dump(status_json, f)
                    logger.info(f"Updated attestation status list ({len(status_json.get('entries', {}))} entries).")
                else:
                    logger.error(f"Failed to fetch Google attestation status list: HTTP {response.status_code}")
        except Exception as e:
            logger.error(f"Error in attestation status downloader loop: {e}")

        await asyncio.sleep(10800) # Every 3 hours

def recheck_all_keyboxes() -> dict:
    """Re-validates all stored keyboxes against latest Google CRL / Softban catalogs and purges expired ones."""
    purge_expired_revoked_keyboxes()
    stored_keyboxes = list(db.keyboxes.find())
    dhaka_tz = datetime.timezone(datetime.timedelta(hours=6))
    now_str = datetime.datetime.now(dhaka_tz).isoformat()
    checked_count = 0
    strong_count = 0
    softban_count = 0
    revoked_count = 0
    invalid_count = 0

    if stored_keyboxes:
        logger.info(f"Re-verifying {len(stored_keyboxes)} stored keyboxes...")
        for kb in stored_keyboxes:
            xml_content = kb.get("xml_content")
            serial_number = kb.get("serial_number")
            if not xml_content or not serial_number:
                continue

            try:
                res = validate_keybox_xml(xml_content)
                status_str = res.get("status", "INVALID")
                is_revoked_or_invalid = status_str in ["REVOKED", "INVALID"]
                detected_revoked_at = None
                if is_revoked_or_invalid:
                    detected_revoked_at = kb.get("detected_revoked_at") or now_str

                if status_str == "STRONG":
                    strong_count += 1
                elif status_str == "SOFTBAN":
                    softban_count += 1
                elif status_str == "REVOKED":
                    revoked_count += 1
                else:
                    invalid_count += 1

                db.keyboxes.update_one(
                    {"serial_number": serial_number},
                    {"$set": {
                        "last_checked_at": now_str,
                        "status": status_str,
                        "is_softbanned": res.get("isSoftbanned", False),
                        "root_type": res.get("rootType", "Attestation Root"),
                        "root_name": res.get("rootName", "Attestation Root"),
                        "days_left": res.get("daysLeft", 0),
                        "expires_at": res.get("expiresAt", ""),
                        "is_expiring_soon": res.get("isExpiringSoon", False),
                        "chain_valid": res.get("chainValid", True),
                        "private_key_match": res.get("privateKeyMatch", True),
                        "detected_revoked_at": detected_revoked_at
                    }}
                )
                checked_count += 1
            except Exception as ve:
                logger.error(f"Keybox re-checker failed for serial {serial_number}: {ve}")

    purge_expired_revoked_keyboxes()

    db.scraper_config.update_one(
        {"type": "pool_meta"},
        {"$set": {
            "type": "pool_meta",
            "last_checked_at": now_str,
            "checked_count": checked_count,
            "strong_count": strong_count,
            "softban_count": softban_count,
            "revoked_count": revoked_count,
            "invalid_count": invalid_count
        }},
        upsert=True
    )

    return {
        "success": True,
        "last_checked_at": now_str,
        "checked_count": checked_count,
        "strong_count": strong_count,
        "softban_count": softban_count,
        "revoked_count": revoked_count,
        "invalid_count": invalid_count
    }

async def verify_stored_keyboxes_loop():
    """Background periodic checker that re-validates stored keyboxes and auto-purges 24h-old Revoked/Invalid keys."""
    logger.info("Background stored keybox verification loop started.")
    await asyncio.sleep(1)

    while True:
        try:
            recheck_all_keyboxes()
        except Exception as e:
            logger.error(f"Error in keybox re-verification loop: {e}")

        await asyncio.sleep(3600)

# ==========================================
# 6. KEYBOX & SOURCES DATA MODELS
# ==========================================
class KeyboxSourcesScrapeRequest(BaseModel):
    sources: Optional[List[Any]] = None

class SingleSourceScrapeRequest(BaseModel):
    url: str
    name: Optional[str] = None

class KeyboxSourcesConfig(BaseModel):
    sources: List[Any]

class KeyboxCheckRequest(BaseModel):
    xml_content: str = Field(..., min_length=10)

# ==========================================
# 7. RAW URL SOURCES SCRAPER ENGINE
# ==========================================
def normalize_source_url(url_input: str) -> str:
    """Normalizes raw source URLs, converting GitHub blob links to raw links, Pastebin links, etc."""
    url = str(url_input).strip()
    if not url:
        return ""
    # Convert github.com/user/repo/blob/branch/path -> raw.githubusercontent.com/user/repo/branch/path
    github_blob_match = re.match(r"^https?://github\.com/([^/]+)/([^/]+)/blob/(.+)$", url)
    if github_blob_match:
        user, repo, rest = github_blob_match.groups()
        return f"https://raw.githubusercontent.com/{user}/{repo}/{rest}"
    # Convert pastebin.com/xxxx -> pastebin.com/raw/xxxx
    pastebin_match = re.match(r"^https?://pastebin\.com/(?!raw/)([a-zA-Z0-9]+)$", url)
    if pastebin_match:
        code = pastebin_match.group(1)
        return f"https://pastebin.com/raw/{code}"
    return url

def extract_keyboxes_from_raw_content(content: str) -> List[str]:
    """Extracts AndroidAttestation / Keybox XML strings from raw web page / file content."""
    if not content or not content.strip():
        return []

    extracted = []

    # 1. Look for <AndroidAttestation>...</AndroidAttestation> blocks
    attest_pattern = re.compile(r"(<\?xml[^>]*\?>\s*)?(<AndroidAttestation\b[\s\S]*?</AndroidAttestation>)", re.IGNORECASE)
    for match in attest_pattern.finditer(content):
        xml_block = match.group(0).strip()
        if xml_block and xml_block not in extracted:
            extracted.append(xml_block)

    # 2. Look for <Keybox>...</Keybox> blocks
    if not extracted:
        keybox_pattern = re.compile(r"(<\?xml[^>]*\?>\s*)?(<Keybox\b[\s\S]*?</Keybox>)", re.IGNORECASE)
        for match in keybox_pattern.finditer(content):
            xml_block = match.group(0).strip()
            if xml_block and xml_block not in extracted:
                extracted.append(xml_block)

    # 3. If no regex match but content looks like direct Keybox XML
    if not extracted and ("<AndroidAttestation" in content or "<Keybox" in content or "<CertificateChain" in content):
        extracted.append(content.strip())

    return extracted

DEFAULT_COMMUNITY_SOURCES = []

def parse_source_config(
    src_item: Any,
    default_interval: float = 1.0
) -> Tuple[str, str, str, float, Optional[str], Optional[str]]:
    """Parses source item into (display_name, raw_url, source_type, interval_hours, last_scraped_at, scan_status)."""
    name = ""
    url = ""
    source_type = "raw_url"
    interval = default_interval
    last_scraped_at = None
    scan_status = "Ready"

    if isinstance(src_item, dict):
        url = str(src_item.get("url") or src_item.get("link") or "").strip()
        name = str(src_item.get("name") or src_item.get("title") or "").strip()
        source_type = str(src_item.get("type") or "raw_url").strip()
        if src_item.get("interval") is not None:
            try:
                interval = float(src_item["interval"])
            except (ValueError, TypeError):
                pass
        last_scraped_at = src_item.get("last_scraped_at")
        scan_status = src_item.get("scan_status") or "Ready"
    else:
        url = str(src_item).strip()

    url = normalize_source_url(url)
    if "specter" in url.lower() or "catalog" in url.lower() or "dpejoh" in url.lower():
        source_type = "specter"

    if not name and url:
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            path_part = parsed.path.rstrip("/").split("/")[-1] or parsed.netloc
            name = path_part
        except Exception:
            name = url[:30]

    return name or url, url, source_type, interval, last_scraped_at, scan_status

async def run_sources_keybox_scraper(
    sources_list: List[Any],
    default_interval: float = 1.0
) -> Dict[str, Any]:
    """Fetches raw URLs, extracts Keybox XML payloads, and verifies against database."""
    cleaned_sources: List[Tuple[str, str, str, float]] = []
    for src in sources_list:
        name, url, stype, inv, _, _ = parse_source_config(src, default_interval=default_interval)
        if url and not any(s[1] == url for s in cleaned_sources):
            cleaned_sources.append((name, url, stype, inv))

    if not cleaned_sources:
        raise ValueError("No valid Raw Source URLs provided.")

    by_source = {
        name: {
            "url": url,
            "type": stype,
            "scraped_files": 0,
            "valid_found": 0,
            "saved_to_db": 0,
            "revoked_or_invalid": 0,
            "skipped_existing": 0,
            "status": "completed",
            "error": None
        }
        for name, url, stype, _ in cleaned_sources
    }

    stats = {
        "scraped_files": 0,
        "valid_found": 0,
        "saved_to_db": 0,
        "revoked_or_invalid": 0,
        "skipped_existing": 0,
        "details": [],
        "by_source": by_source
    }

    dhaka_tz = datetime.timezone(datetime.timedelta(hours=6))
    now_str = datetime.datetime.now(dhaka_tz).isoformat()

    logger.info(f"Starting Raw URL Sources scraper for {len(cleaned_sources)} source(s)...")

    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"}
    ) as http_client:
        for name, url, stype, _ in cleaned_sources:
            logger.info(f"Fetching raw URL source: {name} ({url})...")
            stats["details"].append({
                "type": "info",
                "text": f"Fetching source '{name}' from {url}..."
            })
            try:
                resp = await http_client.get(url)
                if resp.status_code >= 400:
                    raise ValueError(f"HTTP {resp.status_code}: {resp.reason_phrase}")

                raw_text = resp.text
                if not raw_text or not raw_text.strip():
                    stats["details"].append({
                        "type": "info",
                        "text": f"{name}: Empty response received."
                    })
                    continue

                extracted_xmls = extract_keyboxes_from_raw_content(raw_text)

                # Check if the response is a JSON API Catalog (e.g. hzzmonet /api/keys or custom keybox hub)
                if not extracted_xmls:
                    try:
                        parsed_json = json.loads(raw_text)
                        items = []
                        if isinstance(parsed_json, list):
                            items = parsed_json
                        elif isinstance(parsed_json, dict):
                            for k in ["keys", "data", "items", "results", "keyboxes", "list"]:
                                if isinstance(parsed_json.get(k), list):
                                    items = parsed_json[k]
                                    break

                        if items:
                            from urllib.parse import urlparse
                            parsed_url = urlparse(url)
                            origin = f"{parsed_url.scheme}://{parsed_url.netloc}"
                            stats["details"].append({
                                "type": "info",
                                "text": f"{name}: Detected JSON catalog with {len(items)} key item(s). Downloading keybox XMLs..."
                            })

                            for item in items:
                                if isinstance(item, dict):
                                    # 1. Direct inline XML field
                                    inline_xml = item.get("xml") or item.get("xml_content") or item.get("content") or item.get("keybox")
                                    if inline_xml and ("<AndroidAttestation" in inline_xml or "<Keybox" in inline_xml):
                                        extracted_xmls.append(inline_xml)
                                        continue

                                    # 2. Keybox Hub / API ID download (e.g. /api/download?id=X)
                                    kid = item.get("id")
                                    if kid is not None:
                                        dl_url = f"{origin}/api/download?id={kid}"
                                        try:
                                            sub_r = await http_client.get(dl_url)
                                            if sub_r.status_code == 200 and ("<AndroidAttestation" in sub_r.text or "<Keybox" in sub_r.text):
                                                extracted_xmls.append(sub_r.text.strip())
                                        except Exception as dl_e:
                                            logger.warning(f"Error downloading keybox ID {kid} from {dl_url}: {dl_e}")

                                    # 3. Explicit URL/download_url path
                                    dl_path = item.get("download_url") or item.get("url") or item.get("link")
                                    if dl_path and isinstance(dl_path, str) and dl_path.startswith(("http://", "https://", "/")):
                                        if dl_path.startswith("/"):
                                            dl_path = f"{origin}{dl_path}"
                                        if dl_path != url:
                                            try:
                                                sub_r = await http_client.get(dl_path)
                                                if sub_r.status_code == 200 and ("<AndroidAttestation" in sub_r.text or "<Keybox" in sub_r.text):
                                                    extracted_xmls.append(sub_r.text.strip())
                                            except Exception as dl_e:
                                                logger.warning(f"Error fetching path {dl_path}: {dl_e}")
                    except Exception:
                        pass

                if not extracted_xmls:
                    # Check if the content is a list of URLs (one per line)
                    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip().startswith("http")]
                    if lines:
                        stats["details"].append({
                            "type": "info",
                            "text": f"{name}: Found {len(lines)} nested URLs in source list. Scraping nested URLs..."
                        })
                        for sub_url in lines[:30]:
                            sub_url_norm = normalize_source_url(sub_url)
                            try:
                                sub_resp = await http_client.get(sub_url_norm)
                                if sub_resp.status_code == 200:
                                    sub_xmls = extract_keyboxes_from_raw_content(sub_resp.text)
                                    extracted_xmls.extend(sub_xmls)
                            except Exception as sub_e:
                                logger.warning(f"Error fetching sub-url {sub_url}: {sub_e}")

                if not extracted_xmls:
                    stats["details"].append({
                        "type": "info",
                        "text": f"{name}: No valid Keybox XML structures found in source."
                    })
                    continue

                for i, xml_str in enumerate(extracted_xmls, 1):
                    stats["scraped_files"] += 1
                    if name in by_source:
                        by_source[name]["scraped_files"] += 1

                    try:
                        res = validate_keybox_xml(xml_str)
                        status_str = res.get("status", "INVALID")
                        is_valid = status_str in ["STRONG", "SOFTBAN"]
                        serial = res.get("serialNumber") or f"url_{abs(hash(url))}_{i}"

                        existing = db.keyboxes.find_one({"serial_number": serial})
                        is_revoked_or_invalid = status_str in ["REVOKED", "INVALID"]
                        detected_revoked_at = None
                        if is_revoked_or_invalid:
                            detected_revoked_at = (existing.get("detected_revoked_at") if existing else None) or now_str

                        db.keyboxes.update_one(
                            {"serial_number": serial},
                            {"$set": {
                                "device_id": res.get("deviceId", "Unknown"),
                                "serial_number": serial,
                                "algorithm": res.get("algorithm", "RSA/ECDSA"),
                                "root_type": res.get("rootType", "Attestation Root"),
                                "root_name": res.get("rootName", "Attestation Root"),
                                "days_left": res.get("daysLeft", 0),
                                "expires_at": res.get("expiresAt", ""),
                                "is_expiring_soon": res.get("isExpiringSoon", False),
                                "chain_valid": res.get("chainValid", True),
                                "private_key_match": res.get("privateKeyMatch", True),
                                "is_softbanned": res.get("isSoftbanned", False),
                                "xml_content": xml_str,
                                "created_at": (existing.get("created_at") if existing else None) or now_str,
                                "last_checked_at": now_str,
                                "status": status_str,
                                "detected_revoked_at": detected_revoked_at,
                                "source": f"Raw URL ({name})",
                                "source_url": url
                            }},
                            upsert=True
                        )

                        if status_str == "STRONG":
                            log_type = "strong"
                            stats["valid_found"] += 1
                            if name in by_source:
                                by_source[name]["valid_found"] += 1
                        elif status_str == "SOFTBAN":
                            log_type = "softban"
                            stats["valid_found"] += 1
                            if name in by_source:
                                by_source[name]["valid_found"] += 1
                        elif status_str == "REVOKED":
                            log_type = "revoked"
                            stats["revoked_or_invalid"] += 1
                            if name in by_source:
                                by_source[name]["revoked_or_invalid"] += 1
                        else:
                            log_type = "invalid"
                            stats["revoked_or_invalid"] += 1
                            if name in by_source:
                                by_source[name]["revoked_or_invalid"] += 1

                        reason = ""
                        if res.get("revoked"):
                            reason = " [Google CRL Revoked]"
                        elif res.get("isSoftbanned"):
                            reason = f" [{res.get('softbanReason', 'Softbanned')}]"
                        elif not res.get("certValid"):
                            reason = " [Cert Expired/Invalid]"
                        elif not res.get("chainValid"):
                            reason = " [Chain Invalid]"
                        elif res.get("privateKeyMatch") is False:
                            reason = " [Private Key Mismatch]"

                        item_label = f"Keybox #{i}" if len(extracted_xmls) > 1 else "Keybox"
                        if existing:
                            stats["skipped_existing"] += 1
                            if name in by_source:
                                by_source[name]["skipped_existing"] += 1
                            stats["details"].append({
                                "type": log_type,
                                "text": f"{name} ({item_label}): SN {serial} -> {status_str}{reason} (Updated in DB)"
                            })
                        else:
                            stats["saved_to_db"] += 1
                            if name in by_source:
                                by_source[name]["saved_to_db"] += 1
                            stats["details"].append({
                                "type": log_type,
                                "text": f"{name} ({item_label}): SN {serial} -> {status_str}{reason} (Saved to DB Pool)"
                            })

                    except Exception as ve:
                        stats["revoked_or_invalid"] += 1
                        if name in by_source:
                            by_source[name]["revoked_or_invalid"] += 1
                        stats["details"].append({
                            "type": "error",
                            "text": f"{name}: XML parse error ({str(ve)})"
                        })

            except Exception as e:
                logger.error(f"Error scraping source {name} ({url}): {e}")
                if name in by_source:
                    by_source[name]["status"] = "error"
                    by_source[name]["error"] = str(e)
                stats["details"].append({
                    "type": "error",
                    "text": f"Error fetching {name} ({url}): {e}"
                })

    return stats

async def background_sources_scraper_loop():
    """Background task that monitors raw URL sources and automatically scrapes them when due."""
    logger.info("Background Raw URL Sources Scraper loop started.")
    await asyncio.sleep(20)

    while True:
        try:
            config_doc = db.scraper_config.find_one({"type": "sources_scraper"}) or {}
            saved_sources = config_doc.get("sources") or []

            dhaka_tz = datetime.timezone(datetime.timedelta(hours=6))
            now_dt = datetime.datetime.now(dhaka_tz)
            due_sources = []

            for sc in saved_sources:
                name, url, stype, inv, last_scraped, scan_status = parse_source_config(sc)
                if not url:
                    continue

                is_due = True
                if last_scraped:
                    try:
                        last_dt = datetime.datetime.fromisoformat(last_scraped)
                        elapsed_hours = (now_dt - last_dt).total_seconds() / 3600.0
                        if elapsed_hours < inv:
                            is_due = False
                    except Exception:
                        is_due = True

                if is_due:
                    due_sources.append({"name": name, "url": url, "type": stype, "interval": inv})

            if due_sources:
                logger.info(f"Running automated background Raw URL Sources Scraper for {len(due_sources)} source(s)...")
                results = await run_sources_keybox_scraper(due_sources)
                now_str = now_dt.isoformat()

                by_source = results.get("by_source", {})
                updated_sources = []
                for sc in saved_sources:
                    name, url, stype, inv, last_scraped, scan_status = parse_source_config(sc)
                    if url and any(parse_source_config(ds)[1] == url for ds in due_sources):
                        source_res = by_source.get(name, {})
                        scraped_count = source_res.get("scraped_files", 0)
                        status_txt = f"OK (Found {scraped_count} candidate(s))" if source_res.get("status") == "completed" else (source_res.get("error") or "Scan Failed")
                        updated_sources.append({
                            "name": name,
                            "url": url,
                            "type": stype,
                            "interval": inv,
                            "last_scraped_at": now_str,
                            "scan_status": status_txt
                        })
                    else:
                        updated_sources.append(sc)

                db.scraper_config.update_one(
                    {"type": "sources_scraper"},
                    {"$set": {
                        "type": "sources_scraper",
                        "sources": updated_sources,
                        "last_run_at": now_str,
                        "last_results": results
                    }},
                    upsert=True
                )
        except Exception as e:
            logger.error(f"Error in background Raw URL Sources Scraper loop: {e}")

        await asyncio.sleep(60)

# ==========================================
# 8. FASTAPI APPLICATION & LIFESPAN
# ==========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Keybox database...")
    init_db()
    reclassify_all_stored_keyboxes()
    logger.info("Starting background Google attestation status downloader...")
    asyncio.create_task(update_attestation_status_loop())
    logger.info("Starting background stored keybox verification loop...")
    asyncio.create_task(verify_stored_keyboxes_loop())
    logger.info("Starting background Raw URL Sources Scraper loop...")
    asyncio.create_task(background_sources_scraper_loop())
    yield

app = FastAPI(
    title="Keybox Attestation Verifier & Pool Manager API",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 9. REST API ENDPOINTS
# ==========================================
@app.get("/api/stats")
def api_get_stats():
    """Returns overview statistics with Strong, Softban, Revoked counts."""
    try:
        if db.keyboxes.count_documents({"status": "VALID"}) > 0:
            reclassify_all_stored_keyboxes()

        total = db.keyboxes.count_documents({})
        strong = db.keyboxes.count_documents({"status": "STRONG"})
        softban = db.keyboxes.count_documents({"status": "SOFTBAN"})
        revoked = db.keyboxes.count_documents({"status": "REVOKED"})
        invalid = db.keyboxes.count_documents({"status": "INVALID"})
        valid = strong + softban
        
        pool_meta = db.scraper_config.find_one({"type": "pool_meta"}) or {}
        last_pool_check = pool_meta.get("last_checked_at")
        if not last_pool_check:
            latest_kb = db.keyboxes.find_one(
                {"last_checked_at": {"$ne": None}},
                sort=[("last_checked_at", -1)]
            )
            if latest_kb:
                last_pool_check = latest_kb.get("last_checked_at")

        sources_cfg = db.scraper_config.find_one({"type": "sources_scraper"}) or {}
        sources_count = len(sources_cfg.get("sources") or [])
        return {
            "total_pool": total,
            "strong_keyboxes": strong,
            "softban_keyboxes": softban,
            "revoked_keyboxes": revoked,
            "invalid_keyboxes": invalid,
            "valid_keyboxes": valid,
            "sources_monitored": sources_count,
            "last_sources_run": sources_cfg.get("last_run_at"),
            "last_pool_check": last_pool_check
        }
    except Exception as e:
        logger.error(f"Error fetching stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/keyboxes/recheck")
def api_recheck_keyboxes_pool():
    """Manually triggers full re-validation of all keyboxes in the database pool."""
    try:
        results = recheck_all_keyboxes()
        return results
    except Exception as e:
        logger.error(f"Error re-checking keybox pool: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/keybox/check")
def api_check_keybox(req: KeyboxCheckRequest):
    """Parses and checks an Android Keybox XML, saving it to database (Strong/SoftBan/Revoked classification)."""
    try:
        res = validate_keybox_xml(req.xml_content)
        status_str = res.get("status", "INVALID")
        serial = res.get("serialNumber", "unknown")
        is_valid = status_str in ["STRONG", "SOFTBAN"]
        saved = False
        try:
            dhaka_tz = datetime.timezone(datetime.timedelta(hours=6))
            now_str = datetime.datetime.now(dhaka_tz).isoformat()
            existing = db.keyboxes.find_one({"serial_number": serial})
            is_revoked_or_invalid = status_str in ["REVOKED", "INVALID"]
            detected_revoked_at = None
            if is_revoked_or_invalid:
                detected_revoked_at = (existing.get("detected_revoked_at") if existing else None) or now_str

            db.keyboxes.update_one(
                {"serial_number": serial},
                {"$set": {
                    "device_id": res.get("deviceId", "Unknown"),
                    "serial_number": serial,
                    "algorithm": res.get("algorithm", "RSA/ECDSA"),
                    "root_type": res.get("rootType", "Attestation Root"),
                    "root_name": res.get("rootName", "Attestation Root"),
                    "days_left": res.get("daysLeft", 0),
                    "expires_at": res.get("expiresAt", ""),
                    "is_expiring_soon": res.get("isExpiringSoon", False),
                    "chain_valid": res.get("chainValid", True),
                    "private_key_match": res.get("privateKeyMatch", True),
                    "is_softbanned": res.get("isSoftbanned", False),
                    "xml_content": req.xml_content,
                    "created_at": (existing.get("created_at") if existing else None) or now_str,
                    "last_checked_at": now_str,
                    "status": status_str,
                    "detected_revoked_at": detected_revoked_at,
                    "source": "Web Verification"
                }},
                upsert=True
            )
            saved = True
        except Exception as dbe:
            logger.error(f"Failed to save keybox to database: {dbe}")
                
        return {
            "success": is_valid,
            "status": status_str,
            "result": res,
            "saved": saved
        }
    except Exception as e:
        logger.error(f"Keybox validation endpoint exception: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/keyboxes")
def api_get_keyboxes():
    """Retrieve all stored keyboxes, with STRONG keyboxes on top, followed by SOFTBAN. Auto-purges 24h expired revoked/invalid keys."""
    try:
        purge_expired_revoked_keyboxes()
        kbs = list(db.keyboxes.find())
        def sort_priority(k):
            st = k.get("status")
            if st == "STRONG": return (0, k.get("created_at") or "")
            if st == "SOFTBAN" or st == "VALID": return (1, k.get("created_at") or "")
            if st == "REVOKED": return (2, k.get("created_at") or "")
            return (3, k.get("created_at") or "")

        kbs.sort(key=sort_priority)
        return [serialize_doc(kb) for kb in kbs]
    except Exception as e:
        logger.error(f"Error fetching keyboxes: {e}")
        raise HTTPException(status_code=500, detail="Internal server error fetching keyboxes")

@app.get("/api/download")
def api_download_random_valid_keybox():
    """
    Download a random keybox.xml (Strong -> SoftBan / Device priority).
    Allows easy integration with scripts, Magisk or KernelSU modules via REST API.
    """
    try:
        # Priority 1: STRONG (Hardware Attestation Google Root & Unrevoked)
        strong_kbs = list(db.keyboxes.find({"status": "STRONG"}))
        if strong_kbs:
            candidates = strong_kbs
        else:
            # Priority 2: SOFTBAN / VALID
            softban_kbs = list(db.keyboxes.find({"status": {"$in": ["SOFTBAN", "VALID"]}}))
            if softban_kbs:
                candidates = softban_kbs
            else:
                # Priority 3: Any available keybox
                all_kbs = list(db.keyboxes.find())
                if not all_kbs:
                    raise HTTPException(status_code=404, detail="No keybox available in database pool.")
                candidates = all_kbs

        import random
        chosen = random.choice(candidates)
        xml_content = chosen.get("xml_content", "")
        if not xml_content:
            raise HTTPException(status_code=404, detail="Keybox XML content is empty.")

        serial = chosen.get("serial_number", "keybox")
        device_id = chosen.get("device_id", "Unknown")
        root_type = chosen.get("root_type", "Unknown")
        status = chosen.get("status", "Unknown")

        return Response(
            content=xml_content,
            media_type="application/xml",
            headers={
                "Content-Disposition": 'attachment; filename="keybox.xml"',
                "X-Keybox-Serial": str(serial),
                "X-Keybox-Device": str(device_id),
                "X-Keybox-Root": str(root_type),
                "X-Keybox-Status": str(status),
                "Access-Control-Expose-Headers": "Content-Disposition, X-Keybox-Serial, X-Keybox-Device, X-Keybox-Root, X-Keybox-Status"
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading random valid keybox: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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

@app.post("/api/keybox/sources/run")
async def api_run_sources_scraper(req: KeyboxSourcesScrapeRequest):
    """Scrapes keybox XML files from specified or configured raw URL sources."""
    try:
        config_doc = db.scraper_config.find_one({"type": "sources_scraper"}) or {}
        saved_sources = config_doc.get("sources") or []

        sources = req.sources or saved_sources
        if not sources:
            raise HTTPException(status_code=400, detail="No sources configured or provided.")

        results = await run_sources_keybox_scraper(sources)

        now_str = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=6))).isoformat()

        updated_sources_map = {}
        for sc in saved_sources:
            name, url, stype, inv, last_sc, scan_st = parse_source_config(sc)
            if url:
                updated_sources_map[url] = {
                    "name": name,
                    "url": url,
                    "type": stype,
                    "interval": inv,
                    "last_scraped_at": last_sc,
                    "scan_status": scan_st
                }

        by_source = results.get("by_source", {})
        for src in sources:
            name, url, stype, inv, _, _ = parse_source_config(src)
            if url:
                source_res = by_source.get(name, {})
                scraped_count = source_res.get("scraped_files", 0)
                status_txt = f"OK (Found {scraped_count} candidate(s))" if source_res.get("status") == "completed" else (source_res.get("error") or "Scan Failed")
                
                if url in updated_sources_map:
                    if isinstance(src, dict):
                        if "name" in src and src["name"]:
                            updated_sources_map[url]["name"] = src["name"]
                        if "type" in src and src["type"]:
                            updated_sources_map[url]["type"] = src["type"]
                        if "interval" in src:
                            updated_sources_map[url]["interval"] = inv
                    updated_sources_map[url]["last_scraped_at"] = now_str
                    updated_sources_map[url]["scan_status"] = status_txt
                else:
                    updated_sources_map[url] = {
                        "name": name,
                        "url": url,
                        "type": stype,
                        "interval": inv,
                        "last_scraped_at": now_str,
                        "scan_status": status_txt
                    }

        updated_sources = list(updated_sources_map.values())

        db.scraper_config.update_one(
            {"type": "sources_scraper"},
            {"$set": {
                "type": "sources_scraper",
                "sources": updated_sources,
                "last_run_at": now_str,
                "last_results": results
            }},
            upsert=True
        )
        return {"success": True, "results": results}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error running Sources Scraper: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/keybox/sources/scrape-url")
async def api_scrape_single_url(req: SingleSourceScrapeRequest):
    """Scrapes and tests a single raw URL immediately."""
    try:
        url = normalize_source_url(req.url)
        if not url:
            raise HTTPException(status_code=400, detail="URL is required.")

        name = req.name or url
        results = await run_sources_keybox_scraper([{"name": name, "url": url}])
        now_str = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=6))).isoformat()
        
        by_source = results.get("by_source", {})
        source_res = by_source.get(name, {})
        scraped_count = source_res.get("scraped_files", 0)
        status_txt = f"OK (Found {scraped_count} candidate(s))" if source_res.get("status") == "completed" else (source_res.get("error") or "Scan Failed")
        
        stype = "specter" if ("specter" in url.lower() or "catalog" in url.lower()) else "raw_url"

        # Update or add in scraper config
        config_doc = db.scraper_config.find_one({"type": "sources_scraper"}) or {}
        saved_sources = config_doc.get("sources") or []
        found = False
        for s in saved_sources:
            if s.get("url") == url:
                s["last_scraped_at"] = now_str
                s["scan_status"] = status_txt
                found = True
                break
        if not found:
            saved_sources.append({
                "name": name,
                "url": url,
                "type": stype,
                "interval": 1.0,
                "last_scraped_at": now_str,
                "scan_status": status_txt
            })
        db.scraper_config.update_one(
            {"type": "sources_scraper"},
            {"$set": {"sources": saved_sources, "last_run_at": now_str}},
            upsert=True
        )

        return {"success": True, "results": results}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error testing raw URL source: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/keybox/sources/config")
def api_get_sources_config():
    """Get saved raw URL sources configuration and last run results."""
    try:
        config = db.scraper_config.find_one({"type": "sources_scraper"})
        if not config:
            return {"type": "sources_scraper", "sources": []}
        return serialize_doc(config)
    except Exception as e:
        logger.error(f"Error fetching sources config: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/keybox/sources/config")
def api_save_sources_config(cfg: KeyboxSourcesConfig):
    """Save raw URL sources and interval configurations."""
    try:
        config_doc = db.scraper_config.find_one({"type": "sources_scraper"}) or {}
        existing_sources = {}
        for sc in (config_doc.get("sources") or []):
            name, url, stype, inv, last_sc, scan_st = parse_source_config(sc)
            if url:
                existing_sources[url] = {
                    "last_scraped_at": last_sc,
                    "scan_status": scan_st,
                    "type": stype
                }

        updated_sources = []
        for src in cfg.sources:
            name, url, stype, inv, _, _ = parse_source_config(src)
            if url:
                old_info = existing_sources.get(url, {})
                item = {
                    "name": name,
                    "url": url,
                    "type": (src.get("type") if isinstance(src, dict) else None) or old_info.get("type") or stype,
                    "interval": inv,
                    "last_scraped_at": old_info.get("last_scraped_at"),
                    "scan_status": old_info.get("scan_status") or "Ready"
                }
                updated_sources.append(item)

        db.scraper_config.update_one(
            {"type": "sources_scraper"},
            {"$set": {
                "type": "sources_scraper",
                "sources": updated_sources
            }},
            upsert=True
        )
        return {"success": True, "message": "Sources configuration saved."}
    except Exception as e:
        logger.error(f"Error saving sources config: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 10. FRONTEND STATIC FILE SERVING
# ==========================================
STATIC_DIR = os.path.join(CURRENT_DIR, "static")
if not os.path.exists(STATIC_DIR):
    os.makedirs(STATIC_DIR)

@app.get("/")
def serve_index():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "Keybox Checker service running! Static frontend initializing."}

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True, access_log=False)
