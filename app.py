import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jwt
import bcrypt
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, status, Header, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from bson import ObjectId
from bson.errors import InvalidId
from dotenv import load_dotenv

from db import users_col, todos_col, settings_col
from scheduler import start_scheduler_thread

# Load environment configuration
load_dotenv()

PORT = int(os.getenv("PORT", 8000))
JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-jwt-key-for-mustdo-app-2026")

# Modern lifespan context manager (replaces deprecated @app.on_event)
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: launch background notification scheduler
    start_scheduler_thread()
    yield
    # Shutdown: cleanup if needed

# Initialize FastAPI app
app = FastAPI(
    title="MustDO REST API",
    description="Backend API for the themeable Deadline TODO App with Telegram Notifications",
    version="1.1.0",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- HELPERS -----------------

def utc_now() -> datetime:
    """Returns current UTC time as a naive datetime (for MongoDB compatibility)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)

def validate_object_id(id_str: str) -> ObjectId:
    """Validates and converts a string to ObjectId, raising 400 on invalid format."""
    try:
        return ObjectId(id_str)
    except (InvalidId, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid ID format"
        )

# ----------------- JWT HELPERS & DEPENDENCIES -----------------

def create_access_token(user_id: str, role: str) -> str:
    """Generates a secure JWT authentication token valid for 7 days."""
    expire = utc_now() + timedelta(days=7)
    payload = {
        "sub": user_id,
        "role": role,
        "exp": expire
    }
    encoded_jwt = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
    return encoded_jwt

def get_current_user(authorization: Optional[str] = Header(None)):
    """Dependency to extract and validate the JWT from the Authorization header."""
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header missing"
        )
    
    try:
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication scheme"
            )
        
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload"
            )
        
        oid = validate_object_id(user_id)
        user = users_col.find_one({"_id": oid})
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )
        
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired"
        )
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token"
        )

def require_admin(current_user=Depends(get_current_user)):
    """Dependency to restrict route access to administrators only."""
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrative privileges required"
        )
    return current_user

# ----------------- SERIALIZATION HELPERS -----------------

def serialize_user(user) -> dict:
    return {
        "id": str(user["_id"]),
        "username": user["username"],
        "role": user["role"],
        "telegram_chat_id": user.get("telegram_chat_id", ""),
        "telegram_bot_token": user.get("telegram_bot_token", ""),
        "created_at": (user.get("created_at").isoformat() + "Z") if user.get("created_at") else None
    }

def serialize_todo(todo) -> dict:
    return {
        "id": str(todo["_id"]),
        "user_id": str(todo["user_id"]),
        "title": todo["title"],
        "description": todo.get("description", ""),
        "deadline": (todo.get("deadline").isoformat() + "Z") if todo.get("deadline") else None,
        "completed": todo.get("completed", False),
        "priority": todo.get("priority", "medium"),
        "notification_interval": todo.get("notification_interval", 60),
        "last_notified_at": (todo.get("last_notified_at").isoformat() + "Z") if todo.get("last_notified_at") else None,
        "created_at": (todo.get("created_at").isoformat() + "Z") if todo.get("created_at") else None
    }

# ----------------- PYDANTIC SCHEMAS -----------------

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6)

class LoginRequest(BaseModel):
    username: str
    password: str

class ProfileUpdateRequest(BaseModel):
    password: Optional[str] = None
    telegram_chat_id: str
    telegram_bot_token: Optional[str] = ""

class TodoCreateRequest(BaseModel):
    title: str = Field(..., min_length=1)
    description: Optional[str] = ""
    deadline: str  # ISO-8601 string
    priority: str = "medium"  # low, medium, high
    notification_interval: int = 60  # minutes

class TodoUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    deadline: Optional[str] = None
    priority: Optional[str] = None
    notification_interval: Optional[int] = None
    completed: Optional[bool] = None

class SettingUpdateRequest(BaseModel):
    telegram_bot_token: str

# ----------------- AUTHENTICATION API -----------------

@app.post("/api/auth/register")
def register(req: RegisterRequest):
    # Check duplicate user
    if users_col.find_one({"username": req.username}):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken"
        )
    
    hashed_pw = bcrypt.hashpw(req.password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    new_user = {
        "username": req.username,
        "password_hash": hashed_pw,
        "role": "user",
        "telegram_chat_id": "",
        "telegram_bot_token": "",
        "created_at": utc_now()
    }
    
    result = users_col.insert_one(new_user)
    new_user["_id"] = result.inserted_id
    
    token = create_access_token(str(new_user["_id"]), new_user["role"])
    return {
        "token": token,
        "user": serialize_user(new_user)
    }

@app.post("/api/auth/login")
def login(req: LoginRequest):
    user = users_col.find_one({"username": req.username})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )
    
    # Check password
    is_correct = bcrypt.checkpw(req.password.encode('utf-8'), user["password_hash"].encode('utf-8'))
    if not is_correct:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )
    
    token = create_access_token(str(user["_id"]), user["role"])
    return {
        "token": token,
        "user": serialize_user(user)
    }

@app.get("/api/auth/me")
def get_me(current_user=Depends(get_current_user)):
    return serialize_user(current_user)

@app.put("/api/auth/profile")
def update_profile(req: ProfileUpdateRequest, current_user=Depends(get_current_user)):
    update_data = {
        "telegram_chat_id": req.telegram_chat_id,
        "telegram_bot_token": req.telegram_bot_token or ""
    }
    
    if req.password:
        hashed_pw = bcrypt.hashpw(req.password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        update_data["password_hash"] = hashed_pw
        
    users_col.update_one({"_id": current_user["_id"]}, {"$set": update_data})
    updated_user = users_col.find_one({"_id": current_user["_id"]})
    return serialize_user(updated_user)

# ----------------- TODO MANAGEMENT API -----------------

@app.get("/api/todos")
def list_todos(current_user=Depends(get_current_user)):
    todos = todos_col.find({"user_id": current_user["_id"]}).sort("deadline", 1)
    return [serialize_todo(t) for t in todos]

@app.post("/api/todos")
def create_todo(req: TodoCreateRequest, current_user=Depends(get_current_user)):
    try:
        # Parse deadline
        parsed_deadline = datetime.fromisoformat(req.deadline.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid date format. Use ISO-8601 (YYYY-MM-DDTHH:MM)"
        )
        
    # Automatically manage/coerce notification interval to 60 for deadlines < 24h
    now = utc_now()
    time_remaining = parsed_deadline - now
    if time_remaining <= timedelta(hours=24):
        req.notification_interval = 60
        
    new_todo = {
        "user_id": current_user["_id"],
        "title": req.title,
        "description": req.description,
        "deadline": parsed_deadline,
        "completed": False,
        "priority": req.priority,
        "notification_interval": req.notification_interval,
        "last_notified_at": None,
        "created_at": utc_now()
    }
    
    result = todos_col.insert_one(new_todo)
    new_todo["_id"] = result.inserted_id
    return serialize_todo(new_todo)

@app.put("/api/todos/{todo_id}")
def update_todo(todo_id: str, req: TodoUpdateRequest, current_user=Depends(get_current_user)):
    oid = validate_object_id(todo_id)
    todo = todos_col.find_one({"_id": oid, "user_id": current_user["_id"]})
    if not todo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Todo task not found"
        )
        
    update_data = {}
    if req.title is not None:
        update_data["title"] = req.title
    if req.description is not None:
        update_data["description"] = req.description
    if req.priority is not None:
        update_data["priority"] = req.priority
    if req.notification_interval is not None:
        update_data["notification_interval"] = req.notification_interval
    if req.completed is not None:
        update_data["completed"] = req.completed
        # Reset notification status when completed to avoid immediate alerts if reopened later
        if req.completed:
            update_data["last_notified_at"] = None
            
    if req.deadline is not None:
        try:
            update_data["deadline"] = datetime.fromisoformat(req.deadline.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid date format"
            )
            
    # Force alert interval to 60 if the deadline is less than 24 hours away
    now = utc_now()
    deadline = update_data.get("deadline", todo.get("deadline"))
    if deadline:
        if isinstance(deadline, str):
            try:
                deadline = datetime.fromisoformat(deadline.replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError:
                pass
        
        time_remaining = deadline - now
        if time_remaining <= timedelta(hours=24):
            update_data["notification_interval"] = 60
            
    if update_data:
        todos_col.update_one({"_id": oid}, {"$set": update_data})
        
    updated_todo = todos_col.find_one({"_id": oid})
    return serialize_todo(updated_todo)

@app.post("/api/todos/{todo_id}/toggle")
def toggle_todo(todo_id: str, current_user=Depends(get_current_user)):
    oid = validate_object_id(todo_id)
    todo = todos_col.find_one({"_id": oid, "user_id": current_user["_id"]})
    if not todo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Todo task not found"
        )
        
    new_state = not todo.get("completed", False)
    update_fields = {"completed": new_state}
    if new_state:
        update_fields["last_notified_at"] = None # Reset
        
    todos_col.update_one({"_id": oid}, {"$set": update_fields})
    updated_todo = todos_col.find_one({"_id": oid})
    return serialize_todo(updated_todo)

@app.delete("/api/todos/{todo_id}")
def delete_todo(todo_id: str, current_user=Depends(get_current_user)):
    oid = validate_object_id(todo_id)
    todo = todos_col.find_one({"_id": oid, "user_id": current_user["_id"]})
    if not todo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Todo task not found"
        )
        
    todos_col.delete_one({"_id": oid})
    return {"message": "Todo task deleted successfully"}

# ----------------- ADMIN API SECTION -----------------

@app.get("/api/admin/users")
def admin_list_users(current_user=Depends(require_admin)):
    all_users = list(users_col.find({}))
    
    # Batch-load all todo stats with aggregation instead of N+1 queries
    user_ids = [u["_id"] for u in all_users]
    pipeline = [
        {"$match": {"user_id": {"$in": user_ids}}},
        {"$group": {
            "_id": "$user_id",
            "total": {"$sum": 1},
            "completed": {"$sum": {"$cond": ["$completed", 1, 0]}}
        }}
    ]
    stats_map = {}
    for doc in todos_col.aggregate(pipeline):
        stats_map[doc["_id"]] = {"total": doc["total"], "completed": doc["completed"]}
    
    users_data = []
    for u in all_users:
        user_stats = stats_map.get(u["_id"], {"total": 0, "completed": 0})
        total_count = user_stats["total"]
        completed_count = user_stats["completed"]
        
        users_data.append({
            "user": serialize_user(u),
            "stats": {
                "total_todos": total_count,
                "completed_todos": completed_count,
                "pending_todos": total_count - completed_count
            }
        })
        
    return users_data

@app.get("/api/admin/settings")
def admin_get_settings(current_user=Depends(require_admin)):
    bot_token = settings_col.find_one({"key": "telegram_bot_token"})
    token_val = bot_token["value"] if bot_token else os.getenv("TELEGRAM_BOT_TOKEN", "")
    return {
        "telegram_bot_token": token_val
    }

@app.post("/api/admin/settings")
def admin_save_settings(req: SettingUpdateRequest, current_user=Depends(require_admin)):
    settings_col.update_one(
        {"key": "telegram_bot_token"},
        {"$set": {"value": req.telegram_bot_token}},
        upsert=True
    )
    return {"message": "Telegram Bot Token updated successfully"}

# ----------------- STATIC FILES AND SPA ROUTING -----------------

# Ensure the static folder exists
os.makedirs("static", exist_ok=True)

# Mount the static directory
app.mount("/static", StaticFiles(directory="static"), name="static")

# Catch-all to serve index.html for frontend SPA routing
@app.get("/{catchall:path}")
def serve_spa(catchall: str = None):
    # Do not intercept direct calls to API paths that might have fallen through
    if catchall and catchall.startswith("api/"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API endpoint not found"
        )
        
    index_path = os.path.join("static", "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
        
    return {
        "status": "Running",
        "message": "FastAPI is running! Create static/index.html to display the gorgeous user interface."
    }

if __name__ == "__main__":
    import uvicorn
    # Start the web server
    print(f"Starting MustDO Web Server on port {PORT}...")
    uvicorn.run("app:app", host="0.0.0.0", port=PORT, reload=True)
