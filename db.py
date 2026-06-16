import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bcrypt
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient

# Load environment variables
load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017/mustdo")

# Extract DB name from URI or default to "mustdo"
db_name = "mustdo"
try:
    uri_path = MONGODB_URI.split("://")[-1]
    if "/" in uri_path:
        path_part = uri_path.split("/")[-1]
        if "?" in path_part:
            path_part = path_part.split("?")[0]
        if path_part.strip():
            db_name = path_part.strip()
except Exception:
    pass

client = None
db = None
try:
    client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=8000)
    db = client.get_database(db_name)
    # Force check of connection status
    client.server_info()
    print(f"Successfully connected to MongoDB database: '{db_name}'!")
except Exception as e:
    print(f"Error connecting to MongoDB: {e}")
    print("Please make sure MongoDB is running locally or MONGODB_URI is correctly configured in .env.")
    if client is not None:
        db = client.get_database(db_name)



# Collections
users_col = db["users"]
todos_col = db["todos"]
settings_col = db["settings"]

# Setup unique indexes
try:
    users_col.create_index("username", unique=True)
    settings_col.create_index("key", unique=True)
except Exception as e:
    print(f"Index creation warning: {e}")

def seed_admin_user():
    """Seeds a default admin user if the database is empty or has no admin."""
    try:
        admin_exists = users_col.find_one({"role": "admin"})
        if not admin_exists:
            # Create default admin
            admin_password = "admin123"
            hashed_pw = bcrypt.hashpw(admin_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            
            admin_user = {
                "username": "admin",
                "password_hash": hashed_pw,
                "role": "admin",
                "telegram_chat_id": "",
                "telegram_bot_token": "",
                "created_at": datetime.now(timezone.utc).replace(tzinfo=None)
            }
            users_col.insert_one(admin_user)
            print("--- SEED --- Created default admin user:")
            print("Username: admin")
            print("Password: admin123")
            print("Please change this password after logging in!")
            print("------------")
    except Exception as e:
        print(f"Error seeding admin user: {e}")

# Seed the admin user immediately upon import
seed_admin_user()
