import os
import sys
import json
import subprocess
import threading
import time
from datetime import datetime
from flask import Flask, jsonify, request, render_template, session, redirect, url_for

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "ssh-panel-railway-secret-key-super-secure")

DATA_DIR = os.getenv("DATA_DIR", "/data")
if not os.path.exists(DATA_DIR):
    DATA_DIR = "/etc/ssh-panel"

os.makedirs(DATA_DIR, exist_ok=True)
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")
LIMITS_FILE = os.path.join(DATA_DIR, "user_limits.json")

def load_config():
    default_conf = {
        "username": os.getenv("ADMIN_USER", "admin"), 
        "password": os.getenv("ADMIN_PASS", "admin123"), 
        "host": os.getenv("RAILWAY_STATIC_URL", "")
    }
    if not os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "w") as f:
                json.dump(default_conf, f, indent=4)
        except Exception:
            pass
        return default_conf
    try:
        with open(CONFIG_FILE, "r") as f:
            conf = json.load(f)
            return conf
    except Exception:
        return default_conf

def save_config(conf):
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(conf, f, indent=4)
    except Exception as e:
        print(f"Error saving config: {e}")

def load_user_limits():
    if not os.path.exists(LIMITS_FILE):
        return {}
    try:
        with open(LIMITS_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}

def save_user_limits(data):
    try:
        with open(LIMITS_FILE, "w") as f:
            json.dump(data, f, indent=4)
    except Exception as e:
        print(f"Error saving user limits: {e}")

def sync_accounts_backup():
    """Backup user accounts database to persistent volume if available"""
    if os.path.exists(DATA_DIR) and DATA_DIR != "/etc/ssh-panel":
        try:
            subprocess.call(f"cp /etc/passwd {DATA_DIR}/passwd.bak 2>/dev/null", shell=True)
            subprocess.call(f"cp /etc/shadow {DATA_DIR}/shadow.bak 2>/dev/null", shell=True)
            subprocess.call(f"cp /etc/group {DATA_DIR}/group.bak 2>/dev/null", shell=True)
        except Exception:
            pass

def get_system_stats():
    stats = {"cpu": 0, "ram": 0, "disk": 0, "uptime": "N/A", "online_users": "0 Active", "total_users": 0}
    try:
        # CPU
        cpu_cmd = "top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'"
        stats["cpu"] = round(float(subprocess.check_output(cpu_cmd, shell=True).decode().strip()), 1)
    except Exception:
        pass

    try:
        # RAM
        ram_total = float(subprocess.check_output("free -m | awk '/^Mem:/{print $2}'", shell=True).decode().strip())
        ram_used = float(subprocess.check_output("free -m | awk '/^Mem:/{print $3}'", shell=True).decode().strip())
        stats["ram"] = round((ram_used / ram_total) * 100, 1)
    except Exception:
        pass

    try:
        # Disk
        disk_cmd = "df -h / | awk 'NR==2{print $5}' | tr -d '%'"
        stats["disk"] = int(subprocess.check_output(disk_cmd, shell=True).decode().strip())
    except Exception:
        pass

    try:
        # Uptime
        stats["uptime"] = subprocess.check_output("uptime -p", shell=True).decode().strip().replace("up ", "")
    except Exception:
        pass

    try:
        users_list = get_users_list()
        stats["total_users"] = len(users_list)
        active_count = sum(1 for u in users_list if u["sessions"] > 0)
        stats["online_users"] = f"{active_count} Active"
    except Exception:
        pass

    return stats

def get_users_list():
    users = []
    try:
        with open("/etc/passwd", "r") as f:
            lines = f.readlines()
        
        limits = load_user_limits()

        for line in lines:
            parts = line.strip().split(":")
            if len(parts) >= 3:
                username = parts[0]
                uid = int(parts[2])
                if uid >= 1000 and username != "nobody":
                    expiry = "Never"
                    try:
                        chage_out = subprocess.check_output(f"chage -l {username}", shell=True).decode()
                        for cl in chage_out.splitlines():
                            if "Account expires" in cl:
                                exp_val = cl.split(":", 1)[1].strip()
                                if exp_val and exp_val.lower() != "never":
                                    expiry = exp_val
                                break
                    except Exception:
                        pass
                    
                    status = "Active"
                    try:
                        pwd_out = subprocess.check_output(f"passwd -S {username}", shell=True).decode()
                        if pwd_out.split()[1] == "L":
                            status = "Locked"
                    except Exception:
                        pass
                    
                    sessions = 0
                    try:
                        ps_cmd = f"pgrep -u {username} -f 'sshd|dropbear'"
                        ps_out = subprocess.check_output(ps_cmd, shell=True).decode().strip()
                        sessions = len([p for p in ps_out.split() if p.isdigit()])
                    except Exception:
                        pass
                    
                    user_lim = limits.get(username, {"connection_limit": 0})
                    
                    users.append({
                        "username": username,
                        "expiry": expiry,
                        "status": status,
                        "sessions": sessions,
                        "connection_limit": user_lim.get("connection_limit", 0)
                    })
    except Exception as e:
        print(f"Error listing users: {e}")
    return users

@app.route("/")
def home():
    if not session.get("logged_in"):
        return render_template("login.html")
    return render_template("index.html")

@app.route("/login", methods=["POST"])
def login():
    data = request.form
    config = load_config()
    if data.get("username") == config["username"] and data.get("password") == config["password"]:
        session["logged_in"] = True
        return redirect(url_for("home"))
    return render_template("login.html", error="Invalid username or password!")

@app.route("/logout")
def logout():
    session.pop("logged_in", None)
    return redirect(url_for("home"))

@app.route("/api/stats")
def api_stats():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify(get_system_stats())

@app.route("/api/config", methods=["GET"])
def api_get_config():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    config = load_config()
    safe_config = config.copy()
    safe_config["password"] = ""
    return jsonify(safe_config)

@app.route("/api/config/update", methods=["POST"])
def api_update_config():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json or {}
    config = load_config()
    if data.get("username"):
        config["username"] = data["username"]
    if data.get("password"):
        config["password"] = data["password"]
    if "host" in data:
        config["host"] = data["host"]
    
    save_config(config)
    return jsonify({"success": "Settings saved!"})

@app.route("/api/users", methods=["GET"])
def api_users():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify(get_users_list())

@app.route("/api/users/create", methods=["POST"])
def api_create_user():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    expiry_days = data.get("expiry", 0)
    conn_limit = int(data.get("connection_limit", 0))

    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400

    try:
        subprocess.check_call(f"id {username} >/dev/null 2>&1", shell=True)
        return jsonify({"error": f"User '{username}' already exists!"}), 400
    except subprocess.CalledProcessError:
        pass

    try:
        subprocess.check_call(f"useradd -m -s /bin/bash {username}", shell=True)
        subprocess.check_call(f"echo '{username}:{password}' | chpasswd", shell=True)
        
        if expiry_days and int(expiry_days) > 0:
            exp_date = subprocess.check_output(f"date -d '+{expiry_days} days' +%Y-%m-%d", shell=True).decode().strip()
            subprocess.check_call(f"chage -E {exp_date} {username}", shell=True)
        
        limits = load_user_limits()
        limits[username] = {
            "connection_limit": conn_limit
        }
        save_user_limits(limits)
        sync_accounts_backup()

        return jsonify({"success": f"User '{username}' created successfully!"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/users/delete", methods=["POST"])
def api_delete_user():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json or {}
    username = data.get("username", "").strip()
    
    if not username:
        return jsonify({"error": "Username required"}), 400
        
    try:
        subprocess.call(f"pkill -u {username} 2>/dev/null", shell=True)
        subprocess.check_call(f"userdel -r {username}", shell=True)
        
        limits = load_user_limits()
        if username in limits:
            del limits[username]
            save_user_limits(limits)
        
        sync_accounts_backup()
        return jsonify({"success": f"User '{username}' deleted."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/users/toggle-lock", methods=["POST"])
def api_toggle_lock():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json or {}
    username = data.get("username", "").strip()
    
    if not username:
        return jsonify({"error": "Username required"}), 400
        
    try:
        pwd_out = subprocess.check_output(f"passwd -S {username}", shell=True).decode()
        if pwd_out.split()[1] == "L":
            subprocess.check_call(f"passwd -u {username}", shell=True)
            sync_accounts_backup()
            return jsonify({"success": f"User '{username}' unlocked.", "status": "Active"})
        else:
            subprocess.call(f"pkill -u {username} 2>/dev/null", shell=True)
            subprocess.check_call(f"passwd -l {username}", shell=True)
            sync_accounts_backup()
            return jsonify({"success": f"User '{username}' locked.", "status": "Locked"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/users/chpass", methods=["POST"])
def api_chpass():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json or {}
    username = data.get("username", "").strip()
    new_password = data.get("password", "")
    
    if not username or not new_password:
        return jsonify({"error": "Username and password required"}), 400
        
    try:
        subprocess.check_call(f"echo '{username}:{new_password}' | chpasswd", shell=True)
        sync_accounts_backup()
        return jsonify({"success": f"Password changed for '{username}'."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/users/expiry", methods=["POST"])
def api_set_expiry():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json or {}
    username = data.get("username", "").strip()
    expiry_days = data.get("expiry")
    
    if not username or expiry_days is None:
        return jsonify({"error": "Username and expiry days required"}), 400
        
    try:
        if int(expiry_days) == -1:
            subprocess.check_call(f"chage -E -1 {username}", shell=True)
            sync_accounts_backup()
            return jsonify({"success": f"Expiry removed for '{username}'."})
        else:
            exp_date = subprocess.check_output(f"date -d '+{expiry_days} days' +%Y-%m-%d", shell=True).decode().strip()
            subprocess.check_call(f"chage -E {exp_date} {username}", shell=True)
            sync_accounts_backup()
            return jsonify({"success": f"Expiry set for '{username}' to {exp_date}."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Background Limits Enforcer Thread
def limits_enforcer_thread():
    while True:
        try:
            usernames = []
            with open("/etc/passwd", "r") as f:
                for line in f.readlines():
                    parts = line.strip().split(":")
                    if len(parts) >= 3:
                        username = parts[0]
                        uid = int(parts[2])
                        if uid >= 1000 and username != "nobody":
                            usernames.append(username)

            limits = load_user_limits()

            for user in usernames:
                user_limit = limits.get(user, {"connection_limit": 0})
                conn_limit = user_limit.get("connection_limit", 0)
                if conn_limit > 0:
                    try:
                        ps_out = subprocess.check_output(f"pgrep -u {user} -f 'sshd|dropbear'", shell=True).decode().strip()
                        pids = [int(p) for p in ps_out.split() if p.isdigit()]
                        if len(pids) > conn_limit:
                            pids.sort()
                            excess_count = len(pids) - conn_limit
                            pids_to_kill = pids[-excess_count:]
                            for pid in pids_to_kill:
                                subprocess.call(f"kill -9 {pid} 2>/dev/null", shell=True)
                    except subprocess.CalledProcessError:
                        pass
        except Exception as e:
            print(f"Error in limits enforcer thread: {e}")
        time.sleep(10)

if __name__ == "__main__":
    t = threading.Thread(target=limits_enforcer_thread, daemon=True)
    t.start()
    panel_port = int(os.getenv("PANEL_PORT", 40460))
    app.run(host="0.0.0.0", port=panel_port)
