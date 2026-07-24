import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Query, status
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date, timezone
from bson import ObjectId

from database import get_db, init_db, verify_password, hash_password
from auth import create_access_token, get_current_user, require_admin


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        init_db()
        print("[Startup] Database initialized successfully.")
    except Exception as e:
        print(f"[Startup Warning] Could not initialize database: {e}")
    yield


app = FastAPI(
    title="MOHAMMAD CONSTRUCTION & ENGINEERING - Worker Attendance System",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Helper to serialize Mongo object IDs
def serialize_doc(doc):
    if doc is None:
        return None
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    return doc

# --- Pydantic Schemas ---
class LoginRequest(BaseModel):
    username: str
    password: str

class UserCreate(BaseModel):
    username: str
    password: str
    full_name: str
    role: str = "site_manager" # admin or site_manager
    phone: Optional[str] = ""
    email: Optional[str] = ""
    assigned_project_id: Optional[str] = ""
    assigned_project_name: Optional[str] = ""
    allowed_tabs: Optional[List[str]] = None

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    assigned_project_id: Optional[str] = None
    assigned_project_name: Optional[str] = None
    allowed_tabs: Optional[List[str]] = None
    password: Optional[str] = None

class ProjectModel(BaseModel):
    name: str
    location: Optional[str] = ""
    code: Optional[str] = ""
    status: Optional[str] = "Active"
    assigned_manager_id: Optional[str] = ""
    assigned_manager_name: Optional[str] = ""

class GroupModel(BaseModel):
    name: str
    description: Optional[str] = ""

class WorkerModel(BaseModel):
    name: str
    passport_number: Optional[str] = ""
    phone: Optional[str] = ""
    project_id: Optional[str] = ""
    group_id: Optional[str] = ""
    picture_url: Optional[str] = ""
    status: Optional[str] = "Active"

class AttendanceRecordRequest(BaseModel):
    worker_id: str
    date: str # YYYY-MM-DD
    check_in: Optional[str] = None # HH:MM or ISO timestamp
    check_out: Optional[str] = None # HH:MM or ISO timestamp
    status: Optional[str] = "Present" # Present, Late, Absent, Half-Day
    notes: Optional[str] = ""
    work_volume: Optional[str] = ""
    admin_confirmed: Optional[bool] = False

class BulkCheckInRequest(BaseModel):
    worker_ids: List[str]
    date: str # YYYY-MM-DD
    check_in_time: str # HH:MM
    admin_confirmed: Optional[bool] = False

class BulkCheckOutRequest(BaseModel):
    worker_ids: List[str]
    date: str # YYYY-MM-DD
    check_out_time: str # HH:MM
    admin_confirmed: Optional[bool] = False

# --- Auth Routes ---
@app.post("/api/auth/login")
def login(req: LoginRequest):
    db = get_db()
    user = db.users.find_one({"username": req.username})
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    
    token = create_access_token({
        "sub": user["username"],
        "role": user.get("role", "site_manager")
    })
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user["_id"]),
            "username": user["username"],
            "full_name": user.get("full_name", ""),
            "role": user.get("role", "site_manager"),
            "email": user.get("email", ""),
            "phone": user.get("phone", user.get("email", "")),
            "assigned_project_id": user.get("assigned_project_id", ""),
            "assigned_project_name": user.get("assigned_project_name", ""),
            "allowed_tabs": user.get("allowed_tabs", ["dashboard", "attendance", "workers", "projects", "groups", "reports"])
        }
    }

@app.get("/api/auth/me")
def get_me(current_user: dict = Depends(get_current_user)):
    return current_user

def check_site_manager_access(current_user: dict, target_project_id: Optional[str] = None, target_worker_id: Optional[str] = None):
    if current_user.get("role") == "admin":
        return
    
    assigned_pid = current_user.get("assigned_project_id")
    if not assigned_pid:
        return
        
    db = get_db()
    if target_project_id and target_project_id != assigned_pid:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: You are only allowed to manage data for your assigned construction site project."
        )
        
    if target_worker_id:
        try:
            w = db.workers.find_one({"_id": ObjectId(target_worker_id)})
            if w and w.get("project_id") and w["project_id"] != assigned_pid:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Forbidden: You are only allowed to manage workers at your assigned site project."
                )
        except HTTPException:
            raise
        except Exception:
            pass

# --- Projects Routes ---
@app.get("/api/projects")
def list_projects(current_user: dict = Depends(get_current_user)):
    db = get_db()
    projects = list(db.projects.find())
    return [serialize_doc(p) for p in projects]

@app.post("/api/projects")
def create_project(proj: ProjectModel, current_user: dict = Depends(get_current_user)):
    db = get_db()
    if db.projects.find_one({"name": proj.name}):
        raise HTTPException(status_code=400, detail="Project with this name already exists")
    
    doc = proj.dict()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    res = db.projects.insert_one(doc)
    doc["id"] = str(res.inserted_id)
    if "_id" in doc: del doc["_id"]
    return doc

@app.put("/api/projects/{proj_id}")
def update_project(proj_id: str, proj: ProjectModel, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        oid = ObjectId(proj_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid Project ID format")
    
    res = db.projects.update_one({"_id": oid}, {"$set": proj.dict()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Sync project_name on linked workers
    db.workers.update_many({"project_id": proj_id}, {"$set": {"project_name": proj.name}})
    
    updated = db.projects.find_one({"_id": oid})
    return serialize_doc(updated)

@app.delete("/api/projects/{proj_id}")
def delete_project(proj_id: str, current_user: dict = Depends(require_admin)):
    db = get_db()
    try:
        oid = ObjectId(proj_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid Project ID format")
    
    db.projects.delete_one({"_id": oid})
    return {"message": "Project deleted successfully"}

# --- Groups Routes ---
@app.get("/api/groups")
def list_groups(current_user: dict = Depends(get_current_user)):
    db = get_db()
    groups = list(db.groups.find())
    return [serialize_doc(g) for g in groups]

@app.post("/api/groups")
def create_group(grp: GroupModel, current_user: dict = Depends(get_current_user)):
    db = get_db()
    if db.groups.find_one({"name": grp.name}):
        raise HTTPException(status_code=400, detail="Group with this name already exists")
    
    doc = grp.dict()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    res = db.groups.insert_one(doc)
    doc["id"] = str(res.inserted_id)
    if "_id" in doc: del doc["_id"]
    return doc

@app.put("/api/groups/{grp_id}")
def update_group(grp_id: str, grp: GroupModel, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        oid = ObjectId(grp_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid Group ID format")
    
    res = db.groups.update_one({"_id": oid}, {"$set": grp.dict()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Sync group_name on linked workers
    db.workers.update_many({"group_id": grp_id}, {"$set": {"group_name": grp.name}})
    
    updated = db.groups.find_one({"_id": oid})
    return serialize_doc(updated)

@app.delete("/api/groups/{grp_id}")
def delete_group(grp_id: str, current_user: dict = Depends(require_admin)):
    db = get_db()
    try:
        oid = ObjectId(grp_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid Group ID format")
    
    db.groups.delete_one({"_id": oid})
    return {"message": "Worker Group deleted successfully"}

# --- Workers Routes ---
@app.get("/api/workers")
def list_workers(
    project_id: Optional[str] = None,
    group_id: Optional[str] = None,
    status: Optional[str] = None,
    query: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    if current_user.get("role") == "site_manager" and current_user.get("assigned_project_id"):
        project_id = current_user["assigned_project_id"]

    filter_query = {}
    if project_id:
        filter_query["project_id"] = project_id
    if group_id:
        filter_query["group_id"] = group_id
    if status:
        filter_query["status"] = status
    if query:
        filter_query["$or"] = [
            {"name": {"$regex": query, "$options": "i"}},
            {"passport_number": {"$regex": query, "$options": "i"}}
        ]
    
    workers = list(db.workers.find(filter_query))
    return [serialize_doc(w) for w in workers]

@app.post("/api/workers")
def create_worker(worker: WorkerModel, current_user: dict = Depends(get_current_user)):
    db = get_db()
    if current_user.get("role") == "site_manager" and current_user.get("assigned_project_id"):
        worker.project_id = current_user["assigned_project_id"]

    passport_clean = (worker.passport_number or "").strip().upper()
    if passport_clean and db.workers.find_one({"passport_number": passport_clean}):
        raise HTTPException(status_code=400, detail="Worker with this Passport Number already exists")
    
    doc = worker.dict()
    doc["passport_number"] = passport_clean
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    
    # Resolve names if missing
    if doc.get("project_id"):
        try:
            p = db.projects.find_one({"_id": ObjectId(doc["project_id"])})
            if p: doc["project_name"] = p["name"]
        except: pass
    if doc.get("group_id"):
        try:
            g = db.groups.find_one({"_id": ObjectId(doc["group_id"])})
            if g: doc["group_name"] = g["name"]
        except: pass
        
    res = db.workers.insert_one(doc)
    doc["id"] = str(res.inserted_id)
    if "_id" in doc: del doc["_id"]
    return doc

@app.get("/api/workers/{worker_id}")
def get_worker(worker_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        oid = ObjectId(worker_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid Worker ID format")
    w = db.workers.find_one({"_id": oid})
    if not w:
        raise HTTPException(status_code=404, detail="Worker not found")
    return serialize_doc(w)

@app.put("/api/workers/{worker_id}")
def update_worker(worker_id: str, worker: WorkerModel, current_user: dict = Depends(get_current_user)):
    db = get_db()
    check_site_manager_access(current_user, target_worker_id=worker_id)
    
    if current_user.get("role") == "site_manager" and current_user.get("assigned_project_id"):
        worker.project_id = current_user["assigned_project_id"]

    try:
        oid = ObjectId(worker_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid Worker ID format")
    
    passport_clean = (worker.passport_number or "").strip().upper()
    if passport_clean:
        existing = db.workers.find_one({"passport_number": passport_clean, "_id": {"$ne": oid}})
        if existing:
            raise HTTPException(status_code=400, detail="Worker with this Passport Number already exists")

    doc = worker.dict()
    doc["passport_number"] = passport_clean
    
    # Resolve names
    if doc.get("project_id"):
        try:
            p = db.projects.find_one({"_id": ObjectId(doc["project_id"])})
            if p: doc["project_name"] = p["name"]
        except: pass
    if doc.get("group_id"):
        try:
            g = db.groups.find_one({"_id": ObjectId(doc["group_id"])})
            if g: doc["group_name"] = g["name"]
        except: pass
        
    res = db.workers.update_one({"_id": oid}, {"$set": doc})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Worker not found")
    
    updated = db.workers.find_one({"_id": oid})
    return serialize_doc(updated)

@app.delete("/api/workers/{worker_id}")
def delete_worker(worker_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    check_site_manager_access(current_user, target_worker_id=worker_id)
    try:
        oid = ObjectId(worker_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid Worker ID format")
    
    db.workers.delete_one({"_id": oid})
    return {"message": "Worker deleted successfully"}

def check_24h_window(att_record: Optional[dict], target_date_str: str) -> tuple:
    """
    Determines if an attendance record or date is older than 24 hours from input recording.
    Returns (is_older_than_24h: bool, recorded_at_iso: Optional[str])
    """
    now_utc = datetime.now(timezone.utc)
    
    if att_record:
        rec_str = att_record.get("recorded_at") or att_record.get("created_at") or att_record.get("updated_at")
        if rec_str:
            try:
                clean_str = str(rec_str).replace("Z", "+00:00")
                rec_dt = datetime.fromisoformat(clean_str)
                if rec_dt.tzinfo is None:
                    rec_dt = rec_dt.replace(tzinfo=timezone.utc)
                elapsed_seconds = (now_utc - rec_dt).total_seconds()
                return (elapsed_seconds > 24 * 3600), rec_dt.isoformat()
            except Exception:
                pass

    # If no recorded_at timestamp exists yet, check against target_date midnight UTC + 36h
    try:
        t_date = datetime.strptime(target_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        elapsed_seconds = (now_utc - t_date).total_seconds()
        is_older = (elapsed_seconds > 36 * 3600)
        return is_older, None
    except Exception:
        return False, None

# --- Attendance Routes ---
@app.get("/api/attendance")
def get_attendance(
    target_date: Optional[str] = Query(None, alias="date"),
    project_id: Optional[str] = None,
    group_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    today_str = date.today().isoformat()
    if not target_date or target_date > today_str:
        target_date = today_str
    
    if current_user.get("role") == "site_manager" and current_user.get("assigned_project_id"):
        project_id = current_user["assigned_project_id"]

    # Fetch active workers filtered by project/group (Inactive workers like On Leave/Resigned do not appear on Daily Attendance)
    worker_filter = {
        "$or": [
            {"status": "Active"},
            {"status": {"$exists": False}}
        ]
    }
    if project_id: worker_filter["project_id"] = project_id
    if group_id: worker_filter["group_id"] = group_id
    
    workers = list(db.workers.find(worker_filter))
    worker_map = {str(w["_id"]): serialize_doc(w) for w in workers}
    worker_ids = list(worker_map.keys())
    
    # Fetch existing attendance records for the target date
    records = list(db.attendance.find({
        "date": target_date,
        "worker_id": {"$in": worker_ids}
    }))
    
    record_map = {r["worker_id"]: serialize_doc(r) for r in records}
    
    # Merge workers with their attendance for target_date
    result = []
    for wid, wdata in worker_map.items():
        att = record_map.get(wid)
        if att:
            is_older_than_24h, rec_at_iso = check_24h_window(att, target_date)
            att["recorded_at"] = att.get("recorded_at") or rec_at_iso
            att["is_older_than_24h"] = is_older_than_24h
            att["is_locked"] = is_older_than_24h and (current_user.get("role") == "site_manager")
            if not att.get("check_in"):
                att["status"] = "Absent"
        else:
            is_older_than_24h, rec_at_iso = check_24h_window(None, target_date)
            att = {
                "worker_id": wid,
                "date": target_date,
                "check_in": None,
                "check_out": None,
                "status": "Absent", # Absent if no check-in
                "hours_worked": 0.0,
                "notes": "",
                "work_volume": "",
                "recorded_at": None,
                "is_older_than_24h": is_older_than_24h,
                "is_locked": is_older_than_24h and (current_user.get("role") == "site_manager")
            }

        if att.get("check_in") and att.get("check_out"):
            att["hours_worked"] = calculate_hours(att["check_in"], att["check_out"])
            
        result.append({
            "worker": wdata,
            "attendance": att
        })
        
    return {
        "date": target_date,
        "records": result
    }

@app.get("/api/attendance/worker/{worker_id}")
def get_worker_attendance_history(
    worker_id: str,
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    check_site_manager_access(current_user, target_worker_id=worker_id)

    try:
        oid = ObjectId(worker_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid Worker ID format")

    worker = db.workers.find_one({"_id": oid})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    worker_doc = serialize_doc(worker)

    today_str = date.today().isoformat()
    att_filter: dict = {"worker_id": worker_id}

    if start_date or end_date:
        date_filter: dict = {}
        if start_date:
            date_filter["$gte"] = start_date
        if end_date:
            eff_end = min(end_date, today_str)
            date_filter["$lte"] = eff_end
        att_filter["date"] = date_filter

    records_raw = list(db.attendance.find(att_filter).sort("date", -1))
    records = []
    for r in records_raw:
        doc = serialize_doc(r)
        if doc.get("check_in") and doc.get("check_out"):
            doc["hours_worked"] = calculate_hours(doc["check_in"], doc["check_out"])
        records.append(doc)

    total_hours = round(sum(float(r.get("hours_worked") or 0) for r in records), 2)
    days_worked = sum(
        1 for r in records if r.get("status") in ["Present", "Late", "Half-Day"] or r.get("check_in")
    )

    return {
        "worker": worker_doc,
        "records": records,
        "total_hours": total_hours,
        "days_worked": days_worked
    }

@app.get("/api/reports/payroll")
def get_payroll_report(
    start_date: Optional[str] = Query(None, alias="start_date"),
    end_date: Optional[str] = Query(None, alias="end_date"),
    project_id: Optional[str] = None,
    group_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    
    today_str = date.today().isoformat()
    if not start_date or start_date > today_str:
        start_date = date.today().replace(day=1).isoformat()
        if start_date > today_str:
            start_date = today_str
    if not end_date or end_date > today_str:
        end_date = today_str

    if current_user.get("role") == "site_manager" and current_user.get("assigned_project_id"):
        project_id = current_user["assigned_project_id"]

    worker_filter = {}
    if project_id: worker_filter["project_id"] = project_id
    if group_id: worker_filter["group_id"] = group_id

    workers = list(db.workers.find(worker_filter))
    
    projects = list(db.projects.find({}))
    project_map = {str(p["_id"]): p.get("name", "") for p in projects}

    groups = list(db.groups.find({}))
    group_map = {str(g["_id"]): g.get("name", "") for g in groups}

    worker_map = {}
    for w in workers:
        wid = str(w["_id"])
        w_doc = serialize_doc(w)
        pid = str(w_doc.get("project_id", ""))
        gid = str(w_doc.get("group_id", ""))
        w_doc["project_name"] = project_map.get(pid) or w_doc.get("project_name", "")
        w_doc["group_name"] = group_map.get(gid) or w_doc.get("group_name", "")
        worker_map[wid] = w_doc

    worker_ids = list(worker_map.keys())

    att_query = {
        "date": {"$gte": start_date, "$lte": end_date},
        "worker_id": {"$in": worker_ids}
    }
    
    records = list(db.attendance.find(att_query))

    # Aggregate attendance records per worker
    attendance_by_worker = {wid: [] for wid in worker_ids}
    for att in records:
        wid = att.get("worker_id")
        if wid in attendance_by_worker:
            att_doc = serialize_doc(att)
            if att_doc.get("check_in") and att_doc.get("check_out"):
                att_doc["hours_worked"] = calculate_hours(att_doc["check_in"], att_doc["check_out"])
            attendance_by_worker[wid].append(att_doc)

    summary_list = []
    grand_total_hours = 0.0
    total_days_worked = 0

    for wid, wdata in worker_map.items():
        att_list = attendance_by_worker.get(wid, [])
        worker_hours = 0.0
        days_worked = 0
        volumes = []

        for att in att_list:
            hrs = float(att.get("hours_worked") or 0.0)
            st = att.get("status", "")
            worker_hours += hrs
            if hrs > 0 or st in ["Present", "Late"]:
                days_worked += 1
            vol = str(att.get("work_volume") or "").strip()
            if vol:
                volumes.append(vol)

        worker_hours = round(worker_hours, 2)
        grand_total_hours += worker_hours
        total_days_worked += days_worked

        summary_list.append({
            "worker": wdata,
            "days_worked": days_worked,
            "total_hours": worker_hours,
            "work_volume_summary": ", ".join(volumes) if volumes else "",
            "records_count": len(att_list)
        })

    # Sort summary list by total_hours descending, then worker name
    summary_list.sort(key=lambda x: (-x["total_hours"], x["worker"]["name"]))

    return {
        "start_date": start_date,
        "end_date": end_date,
        "total_workers": len(summary_list),
        "total_days_worked": total_days_worked,
        "total_hours": round(grand_total_hours, 2),
        "records": summary_list
    }

def calculate_hours(check_in_str, check_out_str):
    if not check_in_str or not check_out_str:
        return 0.0
    
    t1 = None
    t2 = None
    
    for fmt in ("%H:%M:%S", "%H:%M", "%I:%M %p", "%I:%M:%S %p"):
        if not t1:
            try: t1 = datetime.strptime(str(check_in_str).strip(), fmt)
            except ValueError: pass
        if not t2:
            try: t2 = datetime.strptime(str(check_out_str).strip(), fmt)
            except ValueError: pass
        if t1 and t2:
            break
            
    if not t1 or not t2:
        return 0.0
        
    delta_sec = (t2 - t1).total_seconds()
    if delta_sec < 0:
        delta_sec += 86400  # Overnight shift
        
    hours = delta_sec / 3600.0
    return round(max(0.0, hours), 2)

@app.post("/api/attendance/record")
def record_attendance(req: AttendanceRecordRequest, current_user: dict = Depends(get_current_user)):
    db = get_db()
    check_site_manager_access(current_user, target_worker_id=req.worker_id)
    
    today_str = date.today().isoformat()
    if req.date > today_str:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Future dates are disabled for attendance recording."
        )

    check_in_clean = (req.check_in or "").strip() if req.check_in else None
    check_out_clean = (req.check_out or "").strip() if req.check_out else None

    filter_doc = {"worker_id": req.worker_id, "date": req.date}
    existing = db.attendance.find_one(filter_doc)

    is_older_than_24h, recorded_at_str = check_24h_window(existing, req.date)

    if is_older_than_24h:
        if current_user.get("role") == "site_manager":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Editing locked: Site managers can only edit worker work details within 24 hours of input recording."
            )
        elif current_user.get("role") == "admin":
            if not req.admin_confirmed:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="24_HOUR_OVERRIDE_REQUIRED: Work details were recorded over 24 hours ago. Admin confirmation is required."
                )

    now_iso = datetime.now(timezone.utc).isoformat()
    if existing:
        recorded_at = existing.get("recorded_at") or recorded_at_str or existing.get("created_at") or existing.get("updated_at") or now_iso
    else:
        recorded_at = now_iso

    # If both Check-In and Check-Out times are empty/null, delete attendance record from database
    if not check_in_clean and not check_out_clean:
        if existing:
            db.attendance.delete_one(filter_doc)
        return {
            "worker_id": req.worker_id,
            "date": req.date,
            "check_in": None,
            "check_out": None,
            "status": "Pending",
            "hours_worked": 0.0,
            "notes": "",
            "deleted": True,
            "recorded_at": recorded_at,
            "updated_at": None,
            "is_older_than_24h": is_older_than_24h,
            "is_locked": False
        }

    hours = calculate_hours(check_in_clean, check_out_clean)
    if check_in_clean:
        status_val = req.status if (req.status and req.status not in ["Pending", "Absent"]) else ("Late" if check_in_clean > "09:00" else "Present")
    else:
        status_val = "Absent"
    
    update_doc = {
        "$set": {
            "worker_id": req.worker_id,
            "date": req.date,
            "check_in": check_in_clean,
            "check_out": check_out_clean,
            "status": status_val,
            "hours_worked": hours,
            "notes": req.notes,
            "work_volume": req.work_volume or "",
            "recorded_at": recorded_at,
            "updated_by": current_user["username"],
            "updated_at": now_iso
        }
    }
    
    db.attendance.update_one(filter_doc, update_doc, upsert=True)
    saved = db.attendance.find_one(filter_doc)
    doc = serialize_doc(saved)
    doc["is_older_than_24h"] = is_older_than_24h
    doc["is_locked"] = is_older_than_24h and (current_user.get("role") == "site_manager")
    return doc

@app.post("/api/attendance/bulk-checkin")
def bulk_checkin(req: BulkCheckInRequest, current_user: dict = Depends(get_current_user)):
    db = get_db()
    
    today_str = date.today().isoformat()
    if req.date > today_str:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Future dates are disabled for attendance recording."
        )

    # Check if any workers have existing records > 24 hours old
    locked_records_exist = False
    for wid in req.worker_ids:
        check_site_manager_access(current_user, target_worker_id=wid)
        existing = db.attendance.find_one({"worker_id": wid, "date": req.date})
        is_older, _ = check_24h_window(existing, req.date)
        if is_older:
            locked_records_exist = True
            break

    if locked_records_exist:
        if current_user.get("role") == "site_manager":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Editing locked: Attendance records for one or more workers on this date were recorded >24 hours ago."
            )
        elif current_user.get("role") == "admin":
            if not req.admin_confirmed:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="24_HOUR_OVERRIDE_REQUIRED: One or more attendance records were recorded over 24 hours ago. Admin confirmation is required."
                )

    now_iso = datetime.now(timezone.utc).isoformat()
    updated_count = 0
    
    for wid in req.worker_ids:
        filter_doc = {"worker_id": wid, "date": req.date}
        existing = db.attendance.find_one(filter_doc)
        
        recorded_at = now_iso
        if existing:
            rec_str = existing.get("recorded_at") or existing.get("created_at") or existing.get("updated_at")
            if rec_str: recorded_at = rec_str

        check_out = existing.get("check_out") if existing else None
        hours = calculate_hours(req.check_in_time, check_out)
        
        db.attendance.update_one(
            filter_doc,
            {"$set": {
                "worker_id": wid,
                "date": req.date,
                "check_in": req.check_in_time,
                "check_out": check_out,
                "status": "Present",
                "hours_worked": hours,
                "recorded_at": recorded_at,
                "updated_by": current_user["username"],
                "updated_at": now_iso
            }},
            upsert=True
        )
        updated_count += 1
        
    return {"message": f"Successfully checked in {updated_count} workers", "count": updated_count}

@app.post("/api/attendance/bulk-checkout")
def bulk_checkout(req: BulkCheckOutRequest, current_user: dict = Depends(get_current_user)):
    db = get_db()
    
    today_str = date.today().isoformat()
    if req.date > today_str:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Future dates are disabled for attendance recording."
        )

    # Check if any workers have existing records > 24 hours old
    locked_records_exist = False
    for wid in req.worker_ids:
        check_site_manager_access(current_user, target_worker_id=wid)
        existing = db.attendance.find_one({"worker_id": wid, "date": req.date})
        is_older, _ = check_24h_window(existing, req.date)
        if is_older:
            locked_records_exist = True
            break

    if locked_records_exist:
        if current_user.get("role") == "site_manager":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Editing locked: Attendance records for one or more workers on this date were recorded >24 hours ago."
            )
        elif current_user.get("role") == "admin":
            if not req.admin_confirmed:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="24_HOUR_OVERRIDE_REQUIRED: One or more attendance records were recorded over 24 hours ago. Admin confirmation is required."
                )

    now_iso = datetime.now(timezone.utc).isoformat()
    updated_count = 0
    
    for wid in req.worker_ids:
        filter_doc = {"worker_id": wid, "date": req.date}
        existing = db.attendance.find_one(filter_doc)
        
        recorded_at = now_iso
        if existing:
            rec_str = existing.get("recorded_at") or existing.get("created_at") or existing.get("updated_at")
            if rec_str: recorded_at = rec_str

        check_in = existing.get("check_in") if existing else None
        hours = calculate_hours(check_in, req.check_out_time)
        status_val = "Present" if check_in else "Absent"
        
        db.attendance.update_one(
            filter_doc,
            {"$set": {
                "worker_id": wid,
                "date": req.date,
                "check_in": check_in,
                "check_out": req.check_out_time,
                "status": status_val,
                "hours_worked": hours,
                "recorded_at": recorded_at,
                "updated_by": current_user["username"],
                "updated_at": now_iso
            }},
            upsert=True
        )
        updated_count += 1
        
    return {"message": f"Successfully checked out {updated_count} workers", "count": updated_count}

@app.get("/api/attendance/stats")
def get_stats(target_date: Optional[str] = Query(None, alias="date"), current_user: dict = Depends(get_current_user)):
    db = get_db()
    today_str = date.today().isoformat()
    if not target_date or target_date > today_str:
        target_date = today_str
        
    active_filter = {"$or": [{"status": "Active"}, {"status": {"$exists": False}}]}
    if current_user.get("role") == "site_manager" and current_user.get("assigned_project_id"):
        assigned_pid = current_user["assigned_project_id"]
        total_workers = db.workers.count_documents({"project_id": assigned_pid, **active_filter})
        site_worker_ids = [str(w["_id"]) for w in db.workers.find({"project_id": assigned_pid, **active_filter})]
        records = list(db.attendance.find({"date": target_date, "worker_id": {"$in": site_worker_ids}}))
    else:
        total_workers = db.workers.count_documents(active_filter)
        records = list(db.attendance.find({"date": target_date}))
    
    present = sum(1 for r in records if r.get("check_in"))
    late = sum(1 for r in records if r.get("status") == "Late" or (r.get("check_in") and r.get("check_in") > "09:00"))
    absent = max(0, total_workers - present)
    checked_out = sum(1 for r in records if r.get("check_out"))
    pending = 0
    
    return {
        "date": target_date,
        "total_workers": total_workers,
        "present": present,
        "late": late,
        "absent": absent,
        "checked_out": checked_out,
        "pending": pending
    }

# --- Admin User Management Routes ---
@app.get("/api/admin/users")
def list_users(current_user: dict = Depends(require_admin)):
    db = get_db()
    users = list(db.users.find())
    for u in users:
        u["id"] = str(u["_id"])
        del u["_id"]
        if "password_hash" in u: del u["password_hash"]
    return users

@app.post("/api/admin/users")
def create_user(u: UserCreate, current_user: dict = Depends(require_admin)):
    db = get_db()
    uname = u.username.strip().lower()
    if db.users.find_one({"username": uname}):
        raise HTTPException(status_code=400, detail="Username already exists")
    
    proj_name = u.assigned_project_name
    if u.assigned_project_id:
        try:
            p = db.projects.find_one({"_id": ObjectId(u.assigned_project_id)})
            if p: proj_name = p["name"]
        except: pass
        
    user_doc = {
        "username": uname,
        "password_hash": hash_password(u.password),
        "full_name": u.full_name,
        "role": u.role,
        "phone": u.phone or u.email or "",
        "email": u.email or "",
        "assigned_project_id": u.assigned_project_id or "",
        "assigned_project_name": proj_name or "",
        "allowed_tabs": u.allowed_tabs if u.allowed_tabs is not None else ["dashboard", "attendance", "workers", "projects", "groups", "reports"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    res = db.users.insert_one(user_doc)
    user_doc["id"] = str(res.inserted_id)
    del user_doc["_id"]
    del user_doc["password_hash"]
    return user_doc

@app.put("/api/admin/users/{username}")
def update_user(username: str, u: UserUpdate, current_user: dict = Depends(require_admin)):
    db = get_db()
    existing = db.users.find_one({"username": username})
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
        
    if u.role is not None and u.role != existing.get("role") and existing.get("role") == "admin":
        admin_count = db.users.count_documents({"role": "admin"})
        if admin_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot change role: System requires at least one active Admin account."
            )

    update_data = {}
    if u.full_name is not None: update_data["full_name"] = u.full_name
    if u.role is not None: update_data["role"] = u.role
    if u.phone is not None: update_data["phone"] = u.phone
    if u.email is not None: update_data["email"] = u.email
    if u.allowed_tabs is not None: update_data["allowed_tabs"] = u.allowed_tabs
    
    if u.assigned_project_id is not None:
        update_data["assigned_project_id"] = u.assigned_project_id
        if u.assigned_project_id:
            try:
                p = db.projects.find_one({"_id": ObjectId(u.assigned_project_id)})
                if p: update_data["assigned_project_name"] = p["name"]
            except: pass
        else:
            update_data["assigned_project_name"] = ""
            
    if u.password and u.password.strip():
        update_data["password_hash"] = hash_password(u.password.strip())
        
    db.users.update_one({"username": username}, {"$set": update_data})
    updated = db.users.find_one({"username": username})
    updated["id"] = str(updated["_id"])
    del updated["_id"]
    if "password_hash" in updated: del updated["password_hash"]
    return updated

@app.delete("/api/admin/users/{username}")
def delete_user(username: str, current_user: dict = Depends(require_admin)):
    db = get_db()
    if username == current_user["username"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account")
    
    target_user = db.users.find_one({"username": username})
    if target_user and target_user.get("role") == "admin":
        admin_count = db.users.count_documents({"role": "admin"})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the sole Admin account in the system.")

    res = db.users.delete_one({"username": username})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": f"User {username} removed successfully"}

# --- Static Files Mount ---
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir, exist_ok=True)

app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
