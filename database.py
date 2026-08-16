import os
import certifi
from pymongo import MongoClient, ASCENDING
from datetime import datetime, timezone
import hashlib

MONGODB_URI = os.getenv(
    "MONGODB_URI",
    "mongodb+srv://mltb-2:mltb-2@cluster0.56sdwsb.mongodb.net"
)
DB_NAME = "mohammad_construction_db"

def get_client():
    """Returns PyMongo client with SSL certificate bundle for MongoDB Atlas."""
    try:
        client = MongoClient(
            MONGODB_URI,
            tlsCAFile=certifi.where(),
            serverSelectionTimeoutMS=10000
        )
        # Test connection
        client.admin.command('ping')
        return client
    except Exception as e:
        print(f"[Database] Atlas connection error with certifi tlsCAFile: {e}. Trying fallback without explicit cert...")
        try:
            client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10000)
            client.admin.command('ping')
            return client
        except Exception as err:
            print(f"[Database] Critical connection failure: {err}")
            raise err

_client = None

def get_db():
    global _client
    if _client is None:
        _client = get_client()
    return _client[DB_NAME]

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return hash_password(plain_password) == hashed_password

def init_db():
    """Initializes indexes and creates default admin account if users collection is empty."""
    db = get_db()
    
    # Create indexes with error handling for pre-existing index spec variations
    indexes = [
        ("users", [("username", ASCENDING)], {"unique": True}),
        ("projects", [("name", ASCENDING)], {"unique": True}),
        ("groups", [("name", ASCENDING)], {"unique": True}),
        ("workers", [("passport_number", ASCENDING)], {
            "unique": True,
            "partialFilterExpression": {"passport_number": {"$type": "string", "$gt": ""}}
        }),
        ("attendance", [("worker_id", ASCENDING), ("date", ASCENDING)], {"unique": True})
    ]

    for col_name, keys, kwargs in indexes:
        try:
            db[col_name].create_index(keys, **kwargs)
        except Exception as e:
            print(f"[Database Init] Info on index '{col_name}': {e}")
    
    # Seed default Admin user if empty
    if db.users.count_documents({}) == 0:
        db.users.insert_one({
            "username": "admin",
            "password_hash": hash_password("admin123"),
            "full_name": "Chief Executive Admin",
            "role": "admin",
            "email": "admin@mohammad-construction.com.my",
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        print("[Database Init] Created default admin user (admin / admin123)")

