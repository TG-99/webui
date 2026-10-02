#!/bin/bash
# ============================================================
#   VPS SETUP SCRIPT - CLEAN & LIGHT (SSH + 3X-UI + Web Panel)
#   Supports: Ubuntu 20.04 / 22.04 / 24.04
# ============================================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; PURPLE='\033[0;35m'
WHITE='\033[1;37m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

[[ $EUID -ne 0 ]] && echo -e "${RED}[ERROR] Run as root!${NC}" && exit 1

detect_os() {
    [ -f /etc/os-release ] && . /etc/os-release && OS_NAME=$ID && OS_VERSION=$VERSION_ID && OS_CODENAME=$VERSION_CODENAME || { echo -e "${RED}Cannot detect OS!${NC}"; exit 1; }
    [[ "$OS_NAME" != "ubuntu" && "$OS_NAME" != "debian" ]] && echo -e "${RED}Only Ubuntu and Debian supported!${NC}" && exit 1
}

get_system_info() {
    IP_ADDR=$(curl -s4 ifconfig.me 2>/dev/null || echo "N/A")
    CPU_CORES=$(nproc)
    RAM_TOTAL=$(free -m | awk '/^Mem:/{print $2}')
    RAM_USED=$(free -m | awk '/^Mem:/{print $3}')
    DISK_TOTAL=$(df -h / | awk 'NR==2{print $2}')
    DISK_USED=$(df -h / | awk 'NR==2{print $3}')
    UPTIME=$(uptime -p 2>/dev/null || echo "N/A")
    DOMAIN=$(cat /etc/vps-domain 2>/dev/null || echo "$IP_ADDR")
}

show_banner() {
    clear
    echo -e "${CYAN}"
    echo "   __      _______   _____    _____ ______ _______ _    _ _____   "
    echo "   \ \    / /  __ \ / ____|  / ____|  ____|__   __| |  | |  __ \  "
    echo "    \ \  / /| |__) | (___   | (___ | |__     | |  | |  | | |__) | "
    echo "     \ \/ / |  ___/ \___ \   \___ \|  __|    | |  | |  | |  ___/  "
    echo "      \  /  | |     ____) |  ____) | |____   | |  | |__| | |      "
    echo "       \/   |_|    |_____/  |_____/|______|  |_|   \____/|_|      "
    echo -e "${NC}"
    echo -e "${PURPLE}  ---------------------------------------------------------------------${NC}"
    echo -e "${WHITE}          SSH & 3X-UI Setup Script | Ubuntu 20.04 / 22.04 / 24.04${NC}"
    echo -e "${PURPLE}  ---------------------------------------------------------------------${NC}"
    echo ""
}

show_info() {
    get_system_info
    echo -e "${BLUE}  +-------------------------------------------------------------+${NC}"
    echo -e "${BLUE}  |${WHITE}                    SYSTEM INFORMATION                       ${BLUE}|${NC}"
    echo -e "${BLUE}  +-------------------------------------------------------------+${NC}"
    echo -e "${BLUE}  |${NC}  Host/IP    : ${GREEN}${DOMAIN}${NC}"
    echo -e "${BLUE}  |${NC}  OS         : ${GREEN}Ubuntu ${OS_VERSION} (${OS_CODENAME})${NC}"
    echo -e "${BLUE}  |${NC}  CPU        : ${GREEN}${CPU_CORES} cores${NC}"
    echo -e "${BLUE}  |${NC}  RAM        : ${GREEN}${RAM_USED}MB / ${RAM_TOTAL}MB${NC}"
    echo -e "${BLUE}  |${NC}  Disk       : ${GREEN}${DISK_USED} / ${DISK_TOTAL}${NC}"
    echo -e "${BLUE}  |${NC}  Uptime     : ${GREEN}${UPTIME}${NC}"
    echo -e "${BLUE}  +-------------------------------------------------------------+${NC}"
    echo ""
}

log_info()  { echo -e "  ${GREEN}[✔]${NC} $1"; }
log_warn()  { echo -e "  ${YELLOW}[!]${NC} $1"; }
log_error() { echo -e "  ${RED}[✘]${NC} $1"; }
log_step()  { echo -e "\n  ${CYAN}[→]${NC} ${BOLD}$1${NC}"; }
log_done()  { echo -e "  ${GREEN}[★]${NC} ${BOLD}$1${NC}\n"; }
press_enter() { echo ""; echo -ne "  ${DIM}Press Enter to continue...${NC}"; read; }

update_system() {
    log_step "Updating system packages..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get upgrade -y -qq
    apt-get install -y -qq curl wget unzip net-tools iptables cron \
        python3 python3-pip build-essential git ca-certificates \
        gnupg lsb-release software-properties-common sqlite3 python3-flask
    log_info "System updated!"
}

# ═══════════════════════════════════════════════════════════
#   MAIN MENU
# ═══════════════════════════════════════════════════════════
show_main_menu() {
    show_banner
    show_info
    echo -e "${YELLOW}  ╭─────────────────────────────────────────────────────────╮${NC}"
    echo -e "${YELLOW}  │${WHITE}                      MAIN MENU                          ${YELLOW}│${NC}"
    echo -e "${YELLOW}  ├─────────────────────────────────────────────────────────┤${NC}"
    echo -e "${YELLOW}  │${NC}"
    echo -e "${YELLOW}  │${NC}  ${CYAN}[1]${NC}  SSH Server Setup (Dropbear + WS + Stunnel)"
    echo -e "${YELLOW}  │${NC}  ${CYAN}[2]${NC}  BadVPN UDP Gateway"
    echo -e "${YELLOW}  │${NC}  ${CYAN}[3]${NC}  SSL Certificate (acme.sh)"
    echo -e "${YELLOW}  │${NC}  ${CYAN}[4]${NC}  3X-UI Panel (Xray/V2Ray)"
    echo -e "${YELLOW}  │${NC}"
    echo -e "${YELLOW}  ├─────────────────────────────────────────────────────────┤${NC}"
    echo -e "${YELLOW}  │${NC}  ${GREEN}[5]${NC}  SSH User Management"
    echo -e "${YELLOW}  │${NC}  ${GREEN}[6]${NC}  Domain / Hostname Setup"
    echo -e "${YELLOW}  │${NC}  ${GREEN}[7]${NC}  SSH Web Panel Management (SSH-UI)"
    echo -e "${YELLOW}  │${NC}  ${GREEN}[8]${NC}  Show Service Status"
    echo -e "${YELLOW}  │${NC}  ${GREEN}[9]${NC}  Restart All Services"
    echo -e "${YELLOW}  │${NC}"
    echo -e "${YELLOW}  ├─────────────────────────────────────────────────────────┤${NC}"
    echo -e "${YELLOW}  │${NC}  ${PURPLE}[10]${NC} Install ALL (SSH + BadVPN + 3X-UI + SSH-UI)"
    echo -e "${YELLOW}  │${NC}  ${PURPLE}[11]${NC} Change Service Ports"
    echo -e "${YELLOW}  │${NC}  ${PURPLE}[12]${NC} Change SSH Banner"
    echo -e "${YELLOW}  │${NC}  ${RED}[0]${NC}  Exit"
    echo -e "${YELLOW}  │${NC}"
    echo -e "${YELLOW}  ╰─────────────────────────────────────────────────────────╯${NC}"
    echo ""
    echo -ne "  ${WHITE}Enter your choice [0-12]: ${NC}"
}

# ═══════════════════════════════════════════════════════════
#   SSH WEB PANEL MANAGEMENT SUBMENU
# ═══════════════════════════════════════════════════════════
install_ssh_ui() {
    show_banner
    log_step "Installing SSH-UI Web Panel (Flask)..."
    
    log_step "Updating system package list..."
    apt-get update -y -o Acquire::ForceIPv4=true -qq
    
    log_step "Installing dependency packages..."
    apt-get install -y -o Acquire::ForceIPv4=true -qq python3 python3-flask sqlite3 jq curl
    
    mkdir -p /etc/ssh-panel/templates
    
    log_step "Creating SSH-UI application files..."
    
    # 1. Create app.py
    cat > /etc/ssh-panel/app.py << 'EOF'
import os
import sys
import json
import subprocess
import threading
import time
from datetime import datetime
from flask import Flask, jsonify, request, render_template, session, redirect, url_for

app = Flask(__name__)
app.secret_key = "ssh-panel-secret-key-super-secure"

CONFIG_FILE = "/etc/ssh-panel/config.json"
BANDWIDTH_FILE = "/etc/ssh-panel/bandwidth.json"
LIMITS_FILE = "/etc/ssh-panel/user_limits.json"

def load_config():
    default_conf = {
        "username": "admin", 
        "password": "admin123", 
        "port": 40460,
        "host": "free-vps.foridul.store",
        "ssh_port": 22,
        "dropbear_ports": "144, 109, 50000",
        "ssl_port": 443,
        "ssl_ws_port": 2083,
        "ws_port": 143,
        "udp_port": 7300
    }
    if not os.path.exists(CONFIG_FILE):
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        with open(CONFIG_FILE, "w") as f:
            json.dump(default_conf, f, indent=4)
        return default_conf
    try:
        with open(CONFIG_FILE, "r") as f:
            conf = json.load(f)
            updated = False
            for k, v in default_conf.items():
                if k not in conf:
                    conf[k] = v
                    updated = True
            if updated:
                with open(CONFIG_FILE, "w") as f:
                    json.dump(conf, f, indent=4)
            return conf
    except Exception:
        return default_conf

def load_bandwidth():
    if not os.path.exists(BANDWIDTH_FILE):
        return {}
    try:
        with open(BANDWIDTH_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}

def save_bandwidth(data):
    try:
        os.makedirs(os.path.dirname(BANDWIDTH_FILE), exist_ok=True)
        with open(BANDWIDTH_FILE, "w") as f:
            json.dump(data, f, indent=4)
    except Exception as e:
        print(f"Error saving bandwidth: {e}")

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
        os.makedirs(os.path.dirname(LIMITS_FILE), exist_ok=True)
        with open(LIMITS_FILE, "w") as f:
            json.dump(data, f, indent=4)
    except Exception as e:
        print(f"Error saving user limits: {e}")

def apply_system_ports(old, new):
    changed = False
    
    # 1. Update OpenSSH Port if changed
    ssh_port_changed = old.get("ssh_port") != new.get("ssh_port")
    if ssh_port_changed:
        sshd_path = "/etc/ssh/sshd_config"
        if os.path.exists(sshd_path):
            try:
                with open(sshd_path, "r") as f:
                    lines = f.readlines()
                new_lines = []
                port_found = False
                for line in lines:
                    if line.strip().startswith("Port ") and not line.strip().startswith("PortName"):
                        new_lines.append(f"Port {new['ssh_port']}\n")
                        port_found = True
                    else:
                        new_lines.append(line)
                if not port_found:
                    new_lines.append(f"\nPort {new['ssh_port']}\n")
                with open(sshd_path, "w") as f:
                    f.writelines(new_lines)
                changed = True
            except Exception as e:
                print(f"Error updating sshd_config: {e}")

    # 2. Update Dropbear Ports if changed
    dropbear_ports_changed = old.get("dropbear_ports") != new.get("dropbear_ports")
    if dropbear_ports_changed:
        ports = [p.strip() for p in str(new["dropbear_ports"]).split(",") if p.strip().isdigit()]
        port_args = " ".join([f"-p {p}" for p in ports])
        
        dropbear_svc = "/etc/systemd/system/dropbear.service"
        if os.path.exists(dropbear_svc):
            try:
                with open(dropbear_svc, "r") as f:
                    lines = f.readlines()
                new_lines = []
                for line in lines:
                    if line.strip().startswith("ExecStart="):
                        new_lines.append(f"ExecStart=/usr/sbin/dropbear -F {port_args} -W 65536 -b /etc/issue.net\n")
                    else:
                        new_lines.append(line)
                with open(dropbear_svc, "w") as f:
                    f.writelines(new_lines)
                changed = True
            except Exception as e:
                print(f"Error updating dropbear.service: {e}")

    # 3. Update Stunnel Ports if changed
    stunnel_changed = (
        old.get("ssl_port") != new.get("ssl_port") or 
        old.get("ssl_ws_port") != new.get("ssl_ws_port") or
        ssh_port_changed or
        old.get("ws_port") != new.get("ws_port")
    )
    if stunnel_changed:
        stunnel_conf = "/etc/stunnel/stunnel.conf"
        if os.path.exists(stunnel_conf):
            try:
                cert_path = "/etc/stunnel/stunnel.pem"
                content = f"""pid = /var/run/stunnel4/stunnel4.pid
socket = a:SO_REUSEADDR=1
socket = l:TCP_NODELAY=1
socket = r:TCP_NODELAY=1

[dropbear-ssl]
accept  = {new['ssl_port']}
connect = 127.0.0.1:{new['ssh_port']}
cert    = {cert_path}

[ws-ssl]
accept  = {new['ssl_ws_port']}
connect = 127.0.0.1:{new['ws_port']}
cert    = {cert_path}
"""
                with open(stunnel_conf, "w") as f:
                    f.write(content)
                changed = True
            except Exception as e:
                print(f"Error updating stunnel.conf: {e}")

    # 4. Update WS-SSH Port if changed
    ws_changed = old.get("ws_port") != new.get("ws_port") or ssh_port_changed
    if ws_changed:
        ws_svc = "/etc/systemd/system/ws-ssh.service"
        if os.path.exists(ws_svc):
            try:
                with open(ws_svc, "r") as f:
                    lines = f.readlines()
                new_lines = []
                for line in lines:
                    if line.strip().startswith("ExecStart="):
                        new_lines.append(f"ExecStart=/usr/local/bin/ws-ssh {new['ws_port']} 127.0.0.1:{new['ssh_port']}\n")
                    else:
                        new_lines.append(line)
                with open(ws_svc, "w") as f:
                    f.writelines(new_lines)
                changed = True
            except Exception as e:
                print(f"Error updating ws-ssh.service: {e}")

    # 5. Update BadVPN UDP GW Port if changed
    udp_changed = old.get("udp_port") != new.get("udp_port")
    if udp_changed:
        old_port = old.get("udp_port", 7300)
        new_port = new.get("udp_port", 7300)
        
        subprocess.call(f"systemctl stop badvpn-{old_port} 2>/dev/null", shell=True)
        subprocess.call(f"systemctl disable badvpn-{old_port} 2>/dev/null", shell=True)
        old_svc_file = f"/etc/systemd/system/badvpn-{old_port}.service"
        if os.path.exists(old_svc_file):
            try:
                os.remove(old_svc_file)
            except Exception:
                pass
                
        new_svc_file = f"/etc/systemd/system/badvpn-{new_port}.service"
        svc_content = f"""[Unit]
Description=BadVPN UDP Gateway :{new_port}
After=network.target
[Service]
Type=simple
ExecStart=/usr/bin/badvpn-udpgw --listen-addr 127.0.0.1:{new_port} --max-clients 500 --max-connections-for-client 10
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
"""
        try:
            with open(new_svc_file, "w") as f:
                f.write(svc_content)
            subprocess.call("systemctl daemon-reload", shell=True)
            subprocess.call(f"systemctl enable badvpn-{new_port}", shell=True)
            subprocess.call(f"systemctl start badvpn-{new_port}", shell=True)
            changed = True
        except Exception as e:
            print(f"Error updating badvpn service: {e}")

    # Restart affected services
    if changed:
        try:
            subprocess.call("systemctl daemon-reload", shell=True)
            if ssh_port_changed:
                subprocess.call("systemctl restart ssh sshd", shell=True)
            if dropbear_ports_changed:
                subprocess.call("systemctl restart dropbear", shell=True)
            if stunnel_changed:
                subprocess.call("systemctl restart stunnel4", shell=True)
            if ws_changed:
                subprocess.call("systemctl restart ws-ssh", shell=True)
        except Exception as e:
            print(f"Error restarting services: {e}")

def get_users_bandwidth(usernames):
    db = load_bandwidth()
    updated = False

    # Initialize connmark core rules
    for tool in ["iptables", "ip6tables"]:
        for chain in ["PREROUTING", "OUTPUT"]:
            check_restore = f"{tool} -t mangle -C {chain} -j CONNMARK --restore-mark 2>/dev/null"
            if subprocess.call(check_restore, shell=True) != 0:
                subprocess.call(f"{tool} -t mangle -I {chain} 1 -j CONNMARK --restore-mark", shell=True)

    for user in usernames:
        uid = ""
        try:
            uid = subprocess.check_output(f"id -u {user}", shell=True).decode().strip()
        except Exception:
            pass

        if not uid:
            continue

        # Check and add user accounting rules
        for tool in ["iptables", "ip6tables"]:
            # Mangle set-mark rule
            check_mangle = f"{tool} -t mangle -C OUTPUT -m owner --uid-owner {user} -j CONNMARK --set-mark {uid} 2>/dev/null"
            if subprocess.call(check_mangle, shell=True) != 0:
                subprocess.call(f"{tool} -t mangle -A OUTPUT -m owner --uid-owner {user} -j CONNMARK --set-mark {uid}", shell=True)
            
            # INPUT counter
            check_input = f"{tool} -C INPUT -m mark --mark {uid} -m comment --comment 'ssh-panel:{user}' 2>/dev/null"
            if subprocess.call(check_input, shell=True) != 0:
                subprocess.call(f"{tool} -I INPUT -m mark --mark {uid} -m comment --comment 'ssh-panel:{user}'", shell=True)
                
            # OUTPUT counter
            check_output = f"{tool} -C OUTPUT -m mark --mark {uid} -m comment --comment 'ssh-panel:{user}' 2>/dev/null"
            if subprocess.call(check_output, shell=True) != 0:
                subprocess.call(f"{tool} -I OUTPUT -m mark --mark {uid} -m comment --comment 'ssh-panel:{user}'", shell=True)

        # Retrieve bytes count from counters
        bytes_count = 0
        search_str = f"ssh-panel:{user}"
        for tool in ["iptables", "ip6tables"]:
            for chain in ["INPUT", "OUTPUT"]:
                try:
                    out = subprocess.check_output(f"{tool} -nvx -L {chain}", shell=True).decode()
                    for line in out.splitlines():
                        if search_str in line:
                            parts = line.split()
                            if len(parts) >= 2:
                                bytes_count += int(parts[1])
                except Exception:
                    pass

        if user not in db:
            db[user] = {"accumulated": 0, "last_val": 0}
            updated = True

        user_data = db[user]
        last_val = user_data.get("last_val", 0)
        accumulated = user_data.get("accumulated", 0)

        if bytes_count >= last_val:
            diff = bytes_count - last_val
            if diff > 0:
                accumulated += diff
                user_data["accumulated"] = accumulated
                updated = True
        else:
            accumulated += bytes_count
            user_data["accumulated"] = accumulated
            updated = True

        user_data["last_val"] = bytes_count

    if updated:
        save_bandwidth(db)

    formatted = {}
    for user in usernames:
        bytes_used = db.get(user, {}).get("accumulated", 0)
        if bytes_used >= 1024 * 1024 * 1024:
            formatted[user] = f"{bytes_used / (1024*1024*1024):.2f} GB"
        elif bytes_used >= 1024 * 1024:
            formatted[user] = f"{bytes_used / (1024*1024):.1f} MB"
        elif bytes_used >= 1024:
            formatted[user] = f"{bytes_used / 1024:.1f} KB"
        else:
            formatted[user] = f"{bytes_used} B"
            
    return formatted

def get_system_stats():
    stats = {"cpu": 0, "ram": 0, "disk": 0, "uptime": "N/A", "network": "0 B", "total_ssh_bandwidth": "0 B", "online_users": "0 Active"}
    try:
        # CPU Usage
        cpu_cmd = "top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'"
        stats["cpu"] = round(float(subprocess.check_output(cpu_cmd, shell=True).decode().strip()), 1)
        
        # RAM Usage
        ram_total = float(subprocess.check_output("free -m | awk '/^Mem:/{print $2}'", shell=True).decode().strip())
        ram_used = float(subprocess.check_output("free -m | awk '/^Mem:/{print $3}'", shell=True).decode().strip())
        stats["ram"] = round((ram_used / ram_total) * 100, 1)
        
        # Disk Usage
        disk_cmd = "df -h / | awk 'NR==2{print $5}' | tr -d '%'"
        stats["disk"] = int(subprocess.check_output(disk_cmd, shell=True).decode().strip())
        
        # Uptime
        stats["uptime"] = subprocess.check_output("uptime -p", shell=True).decode().strip().replace("up ", "")

        # VPS Total network traffic (excluding loopback)
        total_net = 0
        try:
            with open("/proc/net/dev", "r") as f:
                lines = f.readlines()
            for line in lines[2:]:
                parts = line.split()
                if len(parts) >= 10:
                    iface = parts[0].strip(":")
                    if iface != "lo":
                        total_net += int(parts[1]) + int(parts[9])
        except Exception:
            pass
            
        if total_net >= 1024 * 1024 * 1024:
            stats["network"] = f"{total_net / (1024*1024*1024):.2f} GB"
        elif total_net >= 1024 * 1024:
            stats["network"] = f"{total_net / (1024*1024):.1f} MB"
        else:
            stats["network"] = f"{total_net / 1024:.1f} KB"

        # SSH Total bandwidth (sum of all users in json)
        total_ssh = 0
        try:
            db = load_bandwidth()
            for user, data in db.items():
                total_ssh += data.get("accumulated", 0)
        except Exception:
            pass
            
        if total_ssh >= 1024 * 1024 * 1024:
            stats["total_ssh_bandwidth"] = f"{total_ssh / (1024*1024*1024):.2f} GB"
        elif total_ssh >= 1024 * 1024:
            stats["total_ssh_bandwidth"] = f"{total_ssh / (1024*1024):.1f} MB"
        else:
            stats["total_ssh_bandwidth"] = f"{total_ssh / 1024:.1f} KB"

        # Count total active unique users
        active_users_count = 0
        try:
            users_list = get_users_list()
            active_users_count = sum(1 for u in users_list if u["sessions"] > 0)
        except Exception:
            pass
        stats["online_users"] = f"{active_users_count} Active"

    except Exception:
        pass
    return stats

def get_users_list():
    users = []
    usernames = []
    raw_users = []
    try:
        with open("/etc/passwd", "r") as f:
            lines = f.readlines()
        
        for line in lines:
            parts = line.strip().split(":")
            if len(parts) >= 3:
                username = parts[0]
                uid = int(parts[2])
                if uid >= 1000 and username != "nobody":
                    usernames.append(username)
                    expiry = "Never"
                    try:
                        chage_out = subprocess.check_output(f"chage -l {username}", shell=True).decode()
                        for cl in chage_out.splitlines():
                            if "Account expires" in cl:
                                expiry = cl.split(":", 1)[1].strip()
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
                        ps_cmd = f"ps -u {username} -o comm= 2>/dev/null"
                        ps_out = subprocess.check_output(ps_cmd, shell=True).decode()
                        for comm in ps_out.splitlines():
                            comm_name = comm.strip().lower()
                            if "sshd" in comm_name or "dropbear" in comm_name:
                                sessions += 1
                    except Exception:
                        pass
                    
                    raw_users.append({
                        "username": username,
                        "expiry": expiry,
                        "status": status,
                        "sessions": sessions
                    })
        
        bandwidths = get_users_bandwidth(usernames)
        limits = load_user_limits()
        for u in raw_users:
            uname = u["username"]
            u["bandwidth"] = bandwidths.get(uname, "0 B")
            
            user_lim = limits.get(uname, {"bandwidth_limit": 0, "connection_limit": 0})
            bw_lim_bytes = user_lim.get("bandwidth_limit", 0)
            if bw_lim_bytes == 0:
                u["bandwidth_limit_str"] = "Unlimited"
            else:
                u["bandwidth_limit_str"] = f"{bw_lim_bytes / (1024*1024*1024):.1f} GB"
                
            u["bandwidth_limit"] = bw_lim_bytes
            u["connection_limit"] = user_lim.get("connection_limit", 0)
            
            users.append(u)
            
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
    return render_template("login.html", error="Invalid credentials!")

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
    return jsonify(config)

@app.route("/api/config/update", methods=["POST"])
def api_update_config():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json
    
    config = load_config()
    old_config = config.copy()
    
    config["username"] = data.get("username", config.get("username", "admin"))
    config["password"] = data.get("password", config.get("password", "admin123"))
    config["port"] = int(data.get("port", config.get("port", 40460)))
    config["host"] = data.get("host", config.get("host", "free-vps.foridul.store"))
    config["ssh_port"] = int(data.get("ssh_port", config.get("ssh_port", 22)))
    config["dropbear_ports"] = data.get("dropbear_ports", config.get("dropbear_ports", "144, 109, 50000"))
    config["ssl_port"] = int(data.get("ssl_port", config.get("ssl_port", 443)))
    config["ssl_ws_port"] = int(data.get("ssl_ws_port", config.get("ssl_ws_port", 2083)))
    config["ws_port"] = int(data.get("ws_port", config.get("ws_port", 143)))
    config["udp_port"] = int(data.get("udp_port", config.get("udp_port", 7300)))
    
    try:
        apply_system_ports(old_config, config)
        
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=4)
            
        if config["port"] != old_config["port"]:
            def restart_service():
                time.sleep(1)
                subprocess.call("systemctl restart ssh-panel", shell=True)
            threading.Thread(target=restart_service).start()
            
        return jsonify({"success": "Server configuration and system ports updated successfully!", "port_changed": config["port"] != old_config["port"]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/users", methods=["GET"])
def api_users():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify(get_users_list())

@app.route("/api/users/create", methods=["POST"])
def api_create_user():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json
    username = data.get("username")
    password = data.get("password")
    expiry_days = data.get("expiry")
    conn_limit = int(data.get("connection_limit", 0))
    bw_limit_gb = float(data.get("bandwidth_limit", 0))

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
            "bandwidth_limit": int(bw_limit_gb * 1024 * 1024 * 1024),
            "connection_limit": conn_limit
        }
        save_user_limits(limits)

        return jsonify({"success": f"User '{username}' created successfully!"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/users/edit-limits", methods=["POST"])
def api_edit_limits():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json
    username = data.get("username")
    conn_limit = int(data.get("connection_limit", 0))
    bw_limit_gb = float(data.get("bandwidth_limit", 0))

    if not username:
        return jsonify({"error": "Username required"}), 400

    try:
        limits = load_user_limits()
        limits[username] = {
            "bandwidth_limit": int(bw_limit_gb * 1024 * 1024 * 1024),
            "connection_limit": conn_limit
        }
        save_user_limits(limits)
        return jsonify({"success": f"Limits updated for '{username}'."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/users/delete", methods=["POST"])
def api_delete_user():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json
    username = data.get("username")
    
    if not username:
        return jsonify({"error": "Username required"}), 400
        
    try:
        uid = ""
        try:
            uid = subprocess.check_output(f"id -u {username}", shell=True).decode().strip()
        except Exception:
            pass

        subprocess.call(f"pkill -u {username} 2>/dev/null", shell=True)
        subprocess.check_call(f"userdel -r {username}", shell=True)
        
        if uid:
            for tool in ["iptables", "ip6tables"]:
                subprocess.call(f"{tool} -t mangle -D OUTPUT -m owner --uid-owner {username} -j CONNMARK --set-mark {uid} 2>/dev/null", shell=True)
                subprocess.call(f"{tool} -D INPUT -m mark --mark {uid} -m comment --comment 'ssh-panel:{username}' 2>/dev/null", shell=True)
                subprocess.call(f"{tool} -D OUTPUT -m mark --mark {uid} -m comment --comment 'ssh-panel:{username}' 2>/dev/null", shell=True)
        
        db = load_bandwidth()
        if username in db:
            del db[username]
            save_bandwidth(db)
            
        limits = load_user_limits()
        if username in limits:
            del limits[username]
            save_user_limits(limits)
            
        return jsonify({"success": f"User '{username}' deleted."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/users/toggle-lock", methods=["POST"])
def api_toggle_lock():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json
    username = data.get("username")
    
    if not username:
        return jsonify({"error": "Username required"}), 400
        
    try:
        pwd_out = subprocess.check_output(f"passwd -S {username}", shell=True).decode()
        if pwd_out.split()[1] == "L":
            subprocess.check_call(f"passwd -u {username}", shell=True)
            return jsonify({"success": f"User '{username}' unlocked.", "status": "Active"})
        else:
            subprocess.call(f"pkill -u {username} 2>/dev/null", shell=True)
            subprocess.check_call(f"passwd -l {username}", shell=True)
            return jsonify({"success": f"User '{username}' locked.", "status": "Locked"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/users/chpass", methods=["POST"])
def api_chpass():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json
    username = data.get("username")
    new_password = data.get("password")
    
    if not username or not new_password:
        return jsonify({"error": "Username and password required"}), 400
        
    try:
        subprocess.check_call(f"echo '{username}:{new_password}' | chpasswd", shell=True)
        return jsonify({"success": f"Password changed for '{username}'."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/users/expiry", methods=["POST"])
def api_set_expiry():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json
    username = data.get("username")
    expiry_days = data.get("expiry")
    
    if not username or expiry_days is None:
        return jsonify({"error": "Username and expiry days required"}), 400
        
    try:
        if int(expiry_days) == -1:
            subprocess.check_call(f"chage -E -1 {username}", shell=True)
            return jsonify({"success": f"Expiry removed for '{username}'."})
        else:
            exp_date = subprocess.check_output(f"date -d '+{expiry_days} days' +%Y-%m-%d", shell=True).decode().strip()
            subprocess.check_call(f"chage -E {exp_date} {username}", shell=True)
            return jsonify({"success": f"Expiry set for '{username}' to {exp_date}."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/services", methods=["GET"])
def api_get_services():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
        
    # We check if badvpn-7300 or another dynamic badvpn exists from configuration
    config = load_config()
    badvpn_port = config.get("udp_port", 7300)
    
    services = [
        {"name": "OpenSSH Server", "service": "ssh"},
        {"name": "Dropbear SSH", "service": "dropbear"},
        {"name": "Stunnel TLS", "service": "stunnel4"},
        {"name": "WebSocket SSH Bridge", "service": "ws-ssh"},
        {"name": "BadVPN UDP Gateway", "service": f"badvpn-{badvpn_port}"},
        {"name": "X-UI Panel", "service": "x-ui"}
    ]
    
    status_list = []
    for s in services:
        state = "Inactive"
        try:
            out = subprocess.check_output(f"systemctl is-active {s['service']} 2>/dev/null", shell=True).decode().strip()
            if out == "active":
                state = "Active"
        except Exception:
            pass
        status_list.append({
            "name": s["name"],
            "service": s["service"],
            "status": state
        })
        
    return jsonify(status_list)

@app.route("/api/services/restart", methods=["POST"])
def api_restart_service():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json
    srv_name = data.get("service")
    if not srv_name:
        return jsonify({"error": "Service name required"}), 400
        
    # Allow restart for any valid systemd service we manage
    config = load_config()
    badvpn_port = config.get("udp_port", 7300)
    valid_services = ["ssh", "dropbear", "stunnel4", "ws-ssh", f"badvpn-{badvpn_port}", "x-ui"]
    
    if srv_name not in valid_services:
        return jsonify({"error": "Invalid service name"}), 400
        
    try:
        subprocess.check_call(f"systemctl restart {srv_name}", shell=True)
        return jsonify({"success": f"Service '{srv_name}' restarted successfully!"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/system/reboot", methods=["POST"])
def api_reboot():
    if not session.get("logged_in"):
        return jsonify({"error": "Unauthorized"}), 401
    
    def do_reboot():
        time.sleep(2)
        subprocess.call("reboot", shell=True)
        
    threading.Thread(target=do_reboot).start()
    return jsonify({"success": "VPS reboot initiated successfully! The system will restart in a few seconds."})

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
            bw_db = load_bandwidth()

            for user in usernames:
                user_limit = limits.get(user, {"bandwidth_limit": 0, "connection_limit": 0})
                
                # Check Bandwidth Limit
                bw_limit = user_limit.get("bandwidth_limit", 0)
                if bw_limit > 0:
                    accumulated = bw_db.get(user, {}).get("accumulated", 0)
                    if accumulated >= bw_limit:
                        try:
                            pwd_out = subprocess.check_output(f"passwd -S {user}", shell=True).decode()
                            if pwd_out.split()[1] != "L":
                                subprocess.call(f"pkill -u {user} 2>/dev/null", shell=True)
                                subprocess.check_call(f"passwd -l {user}", shell=True)
                                print(f"User {user} locked due to bandwidth limit exceeded.")
                        except Exception as e:
                            print(f"Error locking user {user}: {e}")
                        continue

                # Check Connection Limit
                conn_limit = user_limit.get("connection_limit", 0)
                if conn_limit > 0:
                    try:
                        ps_out = subprocess.check_output(f"pgrep -u {user} -f 'sshd:|dropbear'", shell=True).decode().strip()
                        pids = [int(p) for p in ps_out.split() if p.isdigit()]
                        if len(pids) > conn_limit:
                            pids.sort()
                            excess_count = len(pids) - conn_limit
                            pids_to_kill = pids[-excess_count:]
                            for pid in pids_to_kill:
                                subprocess.call(f"kill -9 {pid} 2>/dev/null", shell=True)
                                print(f"Killed excess connection PID {pid} for user {user} (Limit: {conn_limit}).")
                    except subprocess.CalledProcessError:
                        pass
        except Exception as e:
            print(f"Error in limits enforcer thread: {e}")
        time.sleep(10)

if __name__ == "__main__":
    conf = load_config()
    
    # Start background limits enforcer daemon
    t = threading.Thread(target=limits_enforcer_thread, daemon=True)
    t.start()
    
    app.run(host="0.0.0.0", port=conf["port"])

EOF

    # 2. Create login.html
    cat > /etc/ssh-panel/templates/login.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - SSH-UI</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0d0e15;
            --card-bg: rgba(20, 22, 37, 0.6);
            --border-color: rgba(255, 255, 255, 0.08);
            --primary-color: #7c4dff;
            --secondary-color: #00e5ff;
            --text-color: #f1f3f9;
            --text-dim: #8b9bb4;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: 'Inter', sans-serif;
        }

        body {
            background-color: var(--bg-color);
            background-image: 
                radial-gradient(at 0% 0%, rgba(124, 77, 255, 0.15) 0px, transparent 50%),
                radial-gradient(at 100% 100%, rgba(0, 229, 255, 0.12) 0px, transparent 50%);
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            color: var(--text-color);
            overflow: hidden;
        }

        .login-container {
            background: var(--card-bg);
            backdrop-filter: blur(16px);
            border: 1px solid var(--border-color);
            padding: 40px;
            border-radius: 20px;
            width: 100%;
            max-width: 400px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.4);
            animation: fadeIn 0.8s ease-out;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .brand {
            text-align: center;
            margin-bottom: 30px;
        }

        .brand h1 {
            font-size: 2.2rem;
            font-weight: 600;
            background: linear-gradient(45deg, var(--primary-color), var(--secondary-color));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
            display: inline-block;
        }

        .brand p {
            color: var(--text-dim);
            font-size: 0.9rem;
            margin-top: 5px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-group label {
            display: block;
            margin-bottom: 8px;
            color: var(--text-color);
            font-size: 0.85rem;
            font-weight: 600;
            letter-spacing: 0.5px;
            text-transform: uppercase;
        }

        .form-control {
            width: 100%;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid var(--border-color);
            padding: 14px 16px;
            border-radius: 10px;
            color: var(--text-color);
            font-size: 1rem;
            transition: all 0.3s ease;
        }

        .form-control:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 10px rgba(124, 77, 255, 0.2);
            background: rgba(255, 255, 255, 0.07);
        }

        .btn-submit {
            width: 100%;
            background: linear-gradient(45deg, var(--primary-color), #651fff);
            color: white;
            border: none;
            padding: 14px;
            border-radius: 10px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(124, 77, 255, 0.3);
            margin-top: 10px;
        }

        .btn-submit:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(124, 77, 255, 0.5);
        }

        .btn-submit:active {
            transform: translateY(0);
        }

        .error-msg {
            color: #ff5252;
            font-size: 0.85rem;
            text-align: center;
            margin-bottom: 15px;
            background: rgba(255, 82, 82, 0.1);
            padding: 10px;
            border-radius: 8px;
            border: 1px solid rgba(255, 82, 82, 0.2);
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="brand">
            <h1>SSH-UI</h1>
            <p>VPS SSH User Management Panel</p>
        </div>
        
        {% if error %}
        <div class="error-msg">{{ error }}</div>
        {% endif %}

        <form action="/login" method="POST">
            <div class="form-group">
                <label for="username">Username</label>
                <input type="text" id="username" name="username" class="form-control" placeholder="Enter username" required autocomplete="off">
            </div>
            <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" class="form-control" placeholder="Enter password" required>
            </div>
            <button type="submit" class="btn-submit">Login</button>
        </form>
    </div>
</body>
</html>
EOF

    # 3. Create index.html
    cat > /etc/ssh-panel/templates/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - SSH-UI</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root {
            --bg-color: #08090f;
            --card-bg: rgba(17, 19, 34, 0.7);
            --border-color: rgba(255, 255, 255, 0.08);
            --primary-color: #7c4dff;
            --primary-glow: rgba(124, 77, 255, 0.3);
            --secondary-color: #00e5ff;
            --success-color: #00e676;
            --danger-color: #ff1744;
            --warning-color: #ffea00;
            --text-color: #f1f3f9;
            --text-dim: #8b9bb4;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: 'Inter', sans-serif;
        }

        body {
            background-color: var(--bg-color);
            background-image: 
                radial-gradient(at 0% 0%, rgba(124, 77, 255, 0.1) 0px, transparent 50%),
                radial-gradient(at 100% 100%, rgba(0, 229, 255, 0.08) 0px, transparent 50%);
            color: var(--text-color);
            min-height: 100vh;
            padding: 30px;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            width: 100%;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            flex-wrap: wrap;
            gap: 20px;
        }

        .brand h1 {
            font-size: 2rem;
            font-weight: 700;
            background: linear-gradient(45deg, var(--primary-color), var(--secondary-color));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
        }

        .brand p {
            color: var(--text-dim);
            font-size: 0.85rem;
            margin-top: 4px;
        }

        .header-actions {
            display: flex;
            gap: 15px;
        }

        .btn {
            background: var(--primary-color);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 10px;
            font-weight: 600;
            font-size: 0.9rem;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px var(--primary-glow);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(124, 77, 255, 0.5);
            background: #651fff;
        }

        .btn-secondary {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--border-color);
            box-shadow: none;
        }

        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.1);
            border-color: rgba(255, 255, 255, 0.2);
            box-shadow: none;
            transform: translateY(-2px);
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: var(--card-bg);
            backdrop-filter: blur(12px);
            border: 1px solid var(--border-color);
            padding: 20px;
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .stat-icon {
            width: 50px;
            height: 50px;
            border-radius: 12px;
            background: rgba(124, 77, 255, 0.1);
            color: var(--primary-color);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
        }

        .stat-card:nth-child(2) .stat-icon {
            background: rgba(0, 229, 255, 0.1);
            color: var(--secondary-color);
        }

        .stat-card:nth-child(3) .stat-icon {
            background: rgba(0, 230, 118, 0.1);
            color: var(--success-color);
        }

        .stat-info h3 {
            font-size: 0.8rem;
            color: var(--text-dim);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        }

        .stat-info p {
            font-size: 1.4rem;
            font-weight: 700;
        }

        .content-card {
            background: var(--card-bg);
            backdrop-filter: blur(12px);
            border: 1px solid var(--border-color);
            border-radius: 20px;
            padding: 25px;
            box-shadow: 0 15px 35px rgba(0,0,0,0.3);
        }

        .table-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }

        .table-header h2 {
            font-size: 1.25rem;
            font-weight: 600;
        }

        .table-responsive {
            width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
        }

        .user-table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
        }

        .user-table th {
            padding: 15px;
            border-bottom: 1px solid var(--border-color);
            color: var(--text-dim);
            font-weight: 600;
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .user-table td {
            padding: 18px 15px;
            border-bottom: 1px solid rgba(255,255,255,0.03);
            font-size: 0.95rem;
        }

        .badge {
            padding: 5px 10px;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
            display: inline-block;
        }

        .badge-success { background: rgba(0, 230, 118, 0.15); color: var(--success-color); }
        .badge-danger { background: rgba(255, 23, 68, 0.15); color: var(--danger-color); }
        .badge-warning { background: rgba(255, 234, 0, 0.15); color: #ffd600; }

        .actions {
            display: flex;
            gap: 8px;
        }

        .btn-action {
            background: rgba(255,255,255,0.04);
            border: 1px solid var(--border-color);
            width: 36px;
            height: 36px;
            border-radius: 8px;
            color: var(--text-color);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .btn-action:hover {
            background: var(--primary-color);
            border-color: var(--primary-color);
            color: white;
        }

        .btn-action.btn-delete:hover {
            background: var(--danger-color);
            border-color: var(--danger-color);
        }

        /* Mobile cards view */
        .user-cards-list {
            display: none;
            flex-direction: column;
            gap: 15px;
        }

        .user-card {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .user-card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .user-card-name {
            font-weight: 700;
            font-size: 1.1rem;
            color: var(--text-color);
        }

        .user-card-details {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            background: rgba(0,0,0,0.15);
            padding: 12px;
            border-radius: 8px;
        }

        .user-card-detail-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .user-card-detail-item span:first-child {
            font-size: 0.75rem;
            color: var(--text-dim);
            text-transform: uppercase;
        }

        .user-card-detail-item span:last-child {
            font-size: 0.9rem;
            font-weight: 600;
        }

        .user-card-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 5px;
        }

        /* Services grid styling */
        .services-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }

        .service-card {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 15px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .service-info-block {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .service-name {
            font-weight: 600;
            font-size: 0.95rem;
            color: var(--text-color);
        }

        .service-action-btn {
            background: rgba(255,255,255,0.03);
            border: 1px solid var(--border-color);
            width: 32px;
            height: 32px;
            border-radius: 6px;
            color: var(--text-dim);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .service-action-btn:hover {
            color: var(--secondary-color);
            border-color: var(--secondary-color);
            background: rgba(0, 229, 255, 0.05);
        }

        /* Modal styling */
        .modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(8, 9, 15, 0.8);
            backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            pointer-events: none;
            transition: all 0.3s ease;
            z-index: 1000;
        }

        .modal.active {
            opacity: 1;
            pointer-events: auto;
        }

        .modal-content {
            background: #111322;
            border: 1px solid var(--border-color);
            border-radius: 20px;
            padding: 30px;
            width: 100%;
            max-width: 450px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 25px 50px rgba(0,0,0,0.5);
            transform: scale(0.9);
            transition: all 0.3s ease;
            z-index: 1001;
        }

        .modal.active .modal-content {
            transform: scale(1);
        }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 25px;
        }

        .modal-header h3 {
            font-size: 1.2rem;
            font-weight: 600;
        }

        .btn-close {
            background: none;
            border: none;
            color: var(--text-dim);
            font-size: 1.2rem;
            cursor: pointer;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text-dim);
        }

        .form-control {
            width: 100%;
            background: rgba(255,255,255,0.03);
            border: 1px solid var(--border-color);
            padding: 12px 16px;
            border-radius: 10px;
            color: var(--text-color);
            font-size: 0.95rem;
        }

        .form-control:focus {
            outline: none;
            border-color: var(--primary-color);
        }

        #qr-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            margin-top: 20px;
            padding: 15px;
            background: white;
            border-radius: 10px;
            width: fit-content;
            margin-left: auto;
            margin-right: auto;
        }

        #qr-code img {
            display: block;
        }

        .share-info {
            background: rgba(255,255,255,0.03);
            border: 1px solid var(--border-color);
            padding: 15px;
            border-radius: 10px;
            font-family: monospace;
            font-size: 0.85rem;
            margin-top: 15px;
            word-break: break-all;
            user-select: all;
            color: var(--text-color);
        }

        /* Responsive Media Queries */
        @media (max-width: 768px) {
            body {
                padding: 15px;
            }
            
            .header {
                flex-direction: column;
                align-items: flex-start;
                gap: 15px;
                margin-bottom: 20px;
            }

            .header-actions {
                width: 100%;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 10px;
            }

            .header-actions .btn, .header-actions a.btn {
                flex: 1 1 calc(50% - 10px);
                justify-content: center;
                padding: 10px 15px;
                font-size: 0.85rem;
            }

            .stats-grid {
                grid-template-columns: repeat(2, 1fr);
                gap: 10px;
                margin-bottom: 20px;
            }

            .stat-card {
                padding: 12px;
                gap: 10px;
                border-radius: 12px;
            }

            .stat-icon {
                width: 40px;
                height: 40px;
                font-size: 1.2rem;
                border-radius: 8px;
            }

            .stat-info h3 {
                font-size: 0.7rem;
            }

            .stat-info p {
                font-size: 1.05rem;
            }

            /* Hide table, show cards */
            .table-responsive {
                display: none;
            }

            .user-cards-list {
                display: flex;
            }
            
            .content-card {
                padding: 15px;
                border-radius: 15px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="brand">
                <h1>SSH-UI</h1>
                <p style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span>Admin Control Dashboard</span>
                    <span style="color: rgba(255,255,255,0.15); display: inline-block;">|</span>
                    <span style="color: var(--secondary-color); font-weight: 600; letter-spacing: 0.5px; text-shadow: 0 0 10px rgba(0, 229, 255, 0.3);">SCRIPT BY FORIDUL</span>
                </p>
            </div>
            <div class="header-actions">
                <button class="btn btn-secondary" onclick="fetchUsers()"><i class="fa-solid fa-rotate"></i> Refresh</button>
                <button class="btn" onclick="openModal('addUserModal')"><i class="fa-solid fa-plus"></i> Add User</button>
                <button class="btn btn-secondary" onclick="openConfigModal()"><i class="fa-solid fa-gears"></i> Settings</button>
                <button class="btn" style="background: var(--danger-color); box-shadow: 0 4px 15px rgba(255, 23, 68, 0.3);" onclick="rebootVPS()"><i class="fa-solid fa-power-off"></i> Reboot</button>
                <a href="/logout" class="btn btn-secondary" style="text-decoration:none;"><i class="fa-solid fa-right-from-bracket"></i> Logout</a>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon"><i class="fa-solid fa-microchip"></i></div>
                <div class="stat-info">
                    <h3>CPU Usage</h3>
                    <p id="cpu-stat">0%</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><i class="fa-solid fa-memory"></i></div>
                <div class="stat-info">
                    <h3>RAM Usage</h3>
                    <p id="ram-stat">0%</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><i class="fa-solid fa-hdd"></i></div>
                <div class="stat-info">
                    <h3>Disk Space</h3>
                    <p id="disk-stat">0%</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><i class="fa-solid fa-clock"></i></div>
                <div class="stat-info">
                    <h3>Uptime</h3>
                    <p id="uptime-stat">N/A</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(0, 230, 118, 0.1); color: var(--success-color);"><i class="fa-solid fa-users"></i></div>
                <div class="stat-info">
                    <h3>Online Users</h3>
                    <p id="online-users-stat">0 Active</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(124, 77, 255, 0.1); color: var(--primary-color);"><i class="fa-solid fa-chart-line"></i></div>
                <div class="stat-info">
                    <h3>Total SSH Traffic</h3>
                    <p id="ssh-bandwidth-stat">0 B</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon" style="background: rgba(0, 229, 255, 0.1); color: var(--secondary-color);"><i class="fa-solid fa-globe"></i></div>
                <div class="stat-info">
                    <h3>Total VPS Traffic</h3>
                    <p id="vps-bandwidth-stat">0 B</p>
                </div>
            </div>
        </div>

        <!-- System Services Status -->
        <div class="content-card" style="margin-bottom: 30px;">
            <div class="table-header">
                <h2>System Services Status</h2>
            </div>
            <div class="services-grid" id="services-status-list">
                <!-- Services status dynamic -->
            </div>
        </div>

        <div class="content-card">
            <div class="table-header">
                <h2>Active SSH Users</h2>
            </div>
            
            <!-- Desktop Table View -->
            <div class="table-responsive">
                <table class="user-table">
                    <thead>
                        <tr>
                            <th>Username</th>
                            <th>Bandwidth</th>
                            <th>Expiry</th>
                            <th>Status</th>
                            <th>Active Sessions</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="user-list-body">
                        <!-- User rows dynamically generated -->
                    </tbody>
                </table>
            </div>

            <!-- Mobile Cards View -->
            <div id="user-cards-list" class="user-cards-list">
                <!-- Cards dynamically generated -->
            </div>
        </div>
    </div>

    <!-- Add User Modal -->
    <div class="modal" id="addUserModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Create SSH User</h3>
                <button class="btn-close" onclick="closeModal('addUserModal')">&times;</button>
            </div>
            <form id="addUserForm" onsubmit="createUser(event)">
                <div class="form-group">
                    <label>Username</label>
                    <input type="text" id="add-username" class="form-control" placeholder="Enter username" required autocomplete="off">
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <input type="password" id="add-password" class="form-control" placeholder="Enter password" required>
                </div>
                <div class="form-group">
                    <label>Expiry (Days, 0 = Permanent)</label>
                    <input type="number" id="add-expiry" class="form-control" value="0" min="0" required>
                </div>
                <div class="form-group">
                    <label>Connection Limit (0 = Unlimited)</label>
                    <input type="number" id="add-conn-limit" class="form-control" value="0" min="0" required>
                </div>
                <div class="form-group">
                    <label>Bandwidth Limit (GB, 0 = Unlimited)</label>
                    <input type="number" id="add-bw-limit" class="form-control" value="0" min="0" step="0.1" required>
                </div>
                <button type="submit" class="btn" style="width: 100%; justify-content: center; margin-top: 10px;">Create Account</button>
            </form>
        </div>
    </div>

    <!-- Edit Limits Modal -->
    <div class="modal" id="editLimitsModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Edit User Limits</h3>
                <button class="btn-close" onclick="closeModal('editLimitsModal')">&times;</button>
            </div>
            <form id="editLimitsForm" onsubmit="saveLimits(event)">
                <input type="hidden" id="edit-limits-username">
                <div class="form-group">
                    <label>Connection Limit (0 = Unlimited)</label>
                    <input type="number" id="edit-conn-limit" class="form-control" min="0" required>
                </div>
                <div class="form-group">
                    <label>Bandwidth Limit (GB, 0 = Unlimited)</label>
                    <input type="number" id="edit-bw-limit" class="form-control" min="0" step="0.1" required>
                </div>
                <button type="submit" class="btn" style="width: 100%; justify-content: center; margin-top: 10px;">Save Limits</button>
            </form>
        </div>
    </div>

    <!-- Server Config Modal -->
    <div class="modal" id="configModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Server Configuration</h3>
                <button class="btn-close" onclick="closeModal('configModal')">&times;</button>
            </div>
            <form id="configForm" onsubmit="saveConfig(event)">
                <div class="form-group">
                    <label>Panel Web Port</label>
                    <input type="number" id="cfg-port" class="form-control" required>
                </div>
                <div class="form-group">
                    <label>Server Host / Domain</label>
                    <input type="text" id="cfg-host" class="form-control" required autocomplete="off">
                </div>
                <div class="form-group">
                    <label>SSH Port</label>
                    <input type="number" id="cfg-ssh" class="form-control" required>
                </div>
                <div class="form-group">
                    <label>Dropbear Ports (comma separated)</label>
                    <input type="text" id="cfg-dropbear" class="form-control" required autocomplete="off">
                </div>
                <div class="form-group">
                    <label>SSL Port (Stunnel)</label>
                    <input type="number" id="cfg-ssl" class="form-control" required>
                </div>
                <div class="form-group">
                    <label>SSL WS Port (Stunnel)</label>
                    <input type="number" id="cfg-ssl-ws" class="form-control" required>
                </div>
                <div class="form-group">
                    <label>WebSocket Port</label>
                    <input type="number" id="cfg-ws" class="form-control" required>
                </div>
                <div class="form-group">
                    <label>UDP GW Port (BadVPN)</label>
                    <input type="number" id="cfg-udp" class="form-control" required>
                </div>
                <button type="submit" class="btn" style="width: 100%; justify-content: center; margin-top: 10px;">Save Settings</button>
            </form>
        </div>
    </div>

    <!-- Share User Modal -->
    <div class="modal" id="shareUserModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Share Credentials</h3>
                <button class="btn-close" onclick="closeModal('shareUserModal')">&times;</button>
            </div>
            <div id="qr-container">
                <div id="qr-code"></div>
            </div>
            <div class="share-info" id="share-text">
                <!-- Share details dynamic -->
            </div>
        </div>
    </div>

    <!-- Edit Password Modal -->
    <div class="modal" id="editPasswordModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Change Password</h3>
                <button class="btn-close" onclick="closeModal('editPasswordModal')">&times;</button>
            </div>
            <form id="editPasswordForm" onsubmit="changePassword(event)">
                <input type="hidden" id="edit-pass-username">
                <div class="form-group">
                    <label>New Password</label>
                    <input type="password" id="edit-new-password" class="form-control" placeholder="Enter new password" required>
                </div>
                <button type="submit" class="btn" style="width: 100%; justify-content: center; margin-top: 10px;">Update Password</button>
            </form>
        </div>
    </div>

    <!-- Edit Expiry Modal -->
    <div class="modal" id="editExpiryModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3>Set Account Expiry</h3>
                <button class="btn-close" onclick="closeModal('editExpiryModal')">&times;</button>
            </div>
            <form id="editExpiryForm" onsubmit="changeExpiry(event)">
                <input type="hidden" id="edit-exp-username">
                <div class="form-group">
                    <label>Expiry Days from Today (-1 = Never Expire)</label>
                    <input type="number" id="edit-expiry-days" class="form-control" value="30" min="-1" required>
                </div>
                <button type="submit" class="btn" style="width: 100%; justify-content: center; margin-top: 10px;">Save Expiry</button>
            </form>
        </div>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script>
        let serverConfig = {};

        function openModal(id) {
            document.getElementById(id).classList.add('active');
        }

        function closeModal(id) {
            document.getElementById(id).classList.remove('active');
        }

        async function fetchConfig() {
            try {
                const res = await fetch('/api/config');
                serverConfig = await res.json();
            } catch (err) {
                console.error(err);
            }
        }

        function openConfigModal() {
            document.getElementById('cfg-port').value = serverConfig.port || 40460;
            document.getElementById('cfg-host').value = serverConfig.host || '';
            document.getElementById('cfg-ssh').value = serverConfig.ssh_port || 22;
            document.getElementById('cfg-dropbear').value = serverConfig.dropbear_ports || '144, 109, 50000';
            document.getElementById('cfg-ssl').value = serverConfig.ssl_port || 443;
            document.getElementById('cfg-ssl-ws').value = serverConfig.ssl_ws_port || 2083;
            document.getElementById('cfg-ws').value = serverConfig.ws_port || 143;
            document.getElementById('cfg-udp').value = serverConfig.udp_port || 7300;
            openModal('configModal');
        }

        async function saveConfig(e) {
            e.preventDefault();
            const payload = {
                port: parseInt(document.getElementById('cfg-port').value),
                host: document.getElementById('cfg-host').value,
                ssh_port: parseInt(document.getElementById('cfg-ssh').value),
                dropbear_ports: document.getElementById('cfg-dropbear').value,
                ssl_port: parseInt(document.getElementById('cfg-ssl').value),
                ssl_ws_port: parseInt(document.getElementById('cfg-ssl-ws').value),
                ws_port: parseInt(document.getElementById('cfg-ws').value),
                udp_port: parseInt(document.getElementById('cfg-udp').value)
            };

            try {
                const res = await fetch('/api/config/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data.error) {
                    alert(data.error);
                } else {
                    closeModal('configModal');
                    if (data.port_changed) {
                        alert('Settings saved. Web port changed, restarting web panel. Please log back in on the new port in a few seconds.');
                        window.location.port = payload.port;
                    } else {
                        alert('Settings saved successfully!');
                        fetchConfig();
                    }
                }
            } catch (err) {
                alert('Connection error');
            }
        }

        async function fetchStats() {
            try {
                const res = await fetch('/api/stats');
                const stats = await res.json();
                document.getElementById('cpu-stat').textContent = stats.cpu + '%';
                document.getElementById('ram-stat').textContent = stats.ram + '%';
                document.getElementById('disk-stat').textContent = stats.disk + '%';
                document.getElementById('uptime-stat').textContent = stats.uptime;
                document.getElementById('online-users-stat').textContent = stats.online_users || '0 Active';
                document.getElementById('ssh-bandwidth-stat').textContent = stats.total_ssh_bandwidth || '0 B';
                document.getElementById('vps-bandwidth-stat').textContent = stats.network || '0 B';
            } catch (err) {
                console.error(err);
            }
        }

        async function fetchServices() {
            try {
                const res = await fetch('/api/services');
                const services = await res.json();
                const container = document.getElementById('services-status-list');
                container.innerHTML = '';
                
                services.forEach(s => {
                    const card = document.createElement('div');
                    card.className = 'service-card';
                    
                    const badgeClass = s.status === 'Active' ? 'badge-success' : 'badge-danger';
                    
                    card.innerHTML = `
                        <div class="service-info-block">
                            <div class="service-name">${s.name}</div>
                            <div>
                                <span class="badge ${badgeClass}">${s.status}</span>
                            </div>
                        </div>
                        <button class="service-action-btn" title="Restart Service" onclick="restartService('${s.service}', '${s.name}')">
                            <i class="fa-solid fa-rotate"></i>
                        </button>
                    `;
                    container.appendChild(card);
                });
            } catch (err) {
                console.error(err);
            }
        }

        async function restartService(service, name) {
            if (!confirm(`Are you sure you want to restart ${name}?`)) return;
            try {
                const res = await fetch('/api/services/restart', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ service })
                });
                const data = await res.json();
                if (data.error) alert(data.error);
                else {
                    alert(`${name} restarted successfully!`);
                    fetchServices();
                }
            } catch (err) {
                alert('Connection error');
            }
        }

        async function rebootVPS() {
            if (!confirm('WARNING: Are you sure you want to reboot the VPS? This will disconnect all users and make the panel temporarily unavailable.')) return;
            try {
                const res = await fetch('/api/system/reboot', { method: 'POST' });
                const data = await res.json();
                if (data.error) alert(data.error);
                else {
                    alert('Reboot initiated. The panel will reload in 30 seconds.');
                    let seconds = 30;
                    const interval = setInterval(() => {
                        seconds--;
                        if (seconds <= 0) {
                            clearInterval(interval);
                            window.location.reload();
                        }
                    }, 1000);
                }
            } catch (err) {
                alert('Connection error');
            }
        }

        async function fetchUsers() {
            try {
                const res = await fetch('/api/users');
                const users = await res.json();
                const tbody = document.getElementById('user-list-body');
                tbody.innerHTML = '';
                
                const cardList = document.getElementById('user-cards-list');
                cardList.innerHTML = '';
                
                users.forEach(user => {
                    const tr = document.createElement('tr');
                    
                    const isExpired = user.expiry !== 'Never' && new Date(user.expiry) < new Date();
                    const expiryBadge = isExpired 
                        ? `<span class="badge badge-danger">${user.expiry}</span>`
                        : user.expiry === 'Never' 
                            ? `<span class="badge badge-success">Permanent</span>`
                            : `<span class="badge badge-warning">${user.expiry}</span>`;
                            
                    const statusBadge = user.status === 'Locked'
                        ? `<span class="badge badge-danger">Locked</span>`
                        : `<span class="badge badge-success">Active</span>`;

                    const maxBw = user.bandwidth_limit_str || 'Unlimited';
                    const maxConn = user.connection_limit > 0 ? user.connection_limit : '∞';
                    const bwBadge = `<span class="badge" style="background: rgba(0, 229, 255, 0.1); color: var(--secondary-color); font-weight:600;">${user.bandwidth || '0 B'} / ${maxBw}</span>`;

                    tr.innerHTML = `
                        <td style="font-weight:600;">${user.username}</td>
                        <td>${bwBadge}</td>
                        <td>${expiryBadge}</td>
                        <td>${statusBadge}</td>
                        <td><span style="font-weight:600; color:var(--secondary-color);">${user.sessions}</span> / ${maxConn} active</td>
                        <td class="actions">
                            <button class="btn-action" title="Share User" onclick="shareUser('${user.username}')"><i class="fa-solid fa-share-nodes"></i></button>
                            <button class="btn-action" title="Change Password" onclick="openChpassModal('${user.username}')"><i class="fa-solid fa-key"></i></button>
                            <button class="btn-action" title="Set Expiry" onclick="openExpiryModal('${user.username}')"><i class="fa-solid fa-calendar-days"></i></button>
                            <button class="btn-action" title="Edit Limits" onclick="openLimitsModal('${user.username}', ${user.connection_limit}, ${user.bandwidth_limit / 1073741824})"><i class="fa-solid fa-sliders"></i></button>
                            <button class="btn-action" title="Lock/Unlock" onclick="toggleLock('${user.username}')"><i class="fa-solid ${user.status === 'Locked' ? 'fa-lock' : 'fa-unlock'}"></i></button>
                            <button class="btn-action btn-delete" title="Delete User" onclick="deleteUser('${user.username}')"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    `;
                    tbody.appendChild(tr);

                    const card = document.createElement('div');
                    card.className = 'user-card';
                    card.innerHTML = `
                        <div class="user-card-header">
                            <div class="user-card-name">${user.username}</div>
                            <div style="display:flex; gap:6px;">
                                ${statusBadge}
                                ${expiryBadge}
                            </div>
                        </div>
                        <div class="user-card-details">
                            <div class="user-card-detail-item">
                                <span>Bandwidth</span>
                                <span>${user.bandwidth || '0 B'} / ${maxBw}</span>
                            </div>
                            <div class="user-card-detail-item">
                                <span>Active Sessions</span>
                                <span>${user.sessions} / ${maxConn}</span>
                            </div>
                        </div>
                        <div class="user-card-actions">
                            <button class="btn-action" title="Share User" onclick="shareUser('${user.username}')"><i class="fa-solid fa-share-nodes"></i></button>
                            <button class="btn-action" title="Change Password" onclick="openChpassModal('${user.username}')"><i class="fa-solid fa-key"></i></button>
                            <button class="btn-action" title="Set Expiry" onclick="openExpiryModal('${user.username}')"><i class="fa-solid fa-calendar-days"></i></button>
                            <button class="btn-action" title="Edit Limits" onclick="openLimitsModal('${user.username}', ${user.connection_limit}, ${user.bandwidth_limit / 1073741824})"><i class="fa-solid fa-sliders"></i></button>
                            <button class="btn-action" title="Lock/Unlock" onclick="toggleLock('${user.username}')"><i class="fa-solid ${user.status === 'Locked' ? 'fa-lock' : 'fa-unlock'}"></i></button>
                            <button class="btn-action btn-delete" title="Delete User" onclick="deleteUser('${user.username}')"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    `;
                    cardList.appendChild(card);
                });
            } catch (err) {
                console.error(err);
            }
        }

        async function createUser(e) {
            e.preventDefault();
            const username = document.getElementById('add-username').value;
            const password = document.getElementById('add-password').value;
            const expiry = document.getElementById('add-expiry').value;
            const connection_limit = document.getElementById('add-conn-limit').value;
            const bandwidth_limit = document.getElementById('add-bw-limit').value;

            try {
                const res = await fetch('/api/users/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, expiry, connection_limit, bandwidth_limit })
                });
                const data = await res.json();
                if (data.error) {
                    alert(data.error);
                } else {
                    closeModal('addUserModal');
                    document.getElementById('addUserForm').reset();
                    fetchUsers();
                }
            } catch (err) {
                alert('Connection error');
            }
        }

        function openLimitsModal(username, connLimit, bwLimitGb) {
            document.getElementById('edit-limits-username').value = username;
            document.getElementById('edit-conn-limit').value = connLimit;
            document.getElementById('edit-bw-limit').value = bwLimitGb;
            openModal('editLimitsModal');
        }

        async function saveLimits(e) {
            e.preventDefault();
            const username = document.getElementById('edit-limits-username').value;
            const connection_limit = document.getElementById('edit-conn-limit').value;
            const bandwidth_limit = document.getElementById('edit-bw-limit').value;

            try {
                const res = await fetch('/api/users/edit-limits', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, connection_limit, bandwidth_limit })
                });
                const data = await res.json();
                if (data.error) alert(data.error);
                else {
                    closeModal('editLimitsModal');
                    fetchUsers();
                }
            } catch (err) {
                alert('Connection error');
            }
        }

        async function deleteUser(username) {
            if (!confirm(`Are you sure you want to delete user ${username}?`)) return;
            try {
                const res = await fetch('/api/users/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username })
                });
                const data = await res.json();
                if (data.error) alert(data.error);
                else fetchUsers();
            } catch (err) {
                alert('Connection error');
            }
        }

        async function toggleLock(username) {
            try {
                const res = await fetch('/api/users/toggle-lock', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username })
                });
                const data = await res.json();
                if (data.error) alert(data.error);
                else fetchUsers();
            } catch (err) {
                alert('Connection error');
            }
        }

        function openChpassModal(username) {
            document.getElementById('edit-pass-username').value = username;
            document.getElementById('edit-new-password').value = '';
            openModal('editPasswordModal');
        }

        async function changePassword(e) {
            e.preventDefault();
            const username = document.getElementById('edit-pass-username').value;
            const password = document.getElementById('edit-new-password').value;

            try {
                const res = await fetch('/api/users/chpass', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                if (data.error) alert(data.error);
                else {
                    closeModal('editPasswordModal');
                    alert('Password updated successfully!');
                }
            } catch (err) {
                alert('Connection error');
            }
        }

        function openExpiryModal(username) {
            document.getElementById('edit-exp-username').value = username;
            openModal('editExpiryModal');
        }

        async function changeExpiry(e) {
            e.preventDefault();
            const username = document.getElementById('edit-exp-username').value;
            const expiry = document.getElementById('edit-expiry-days').value;

            try {
                const res = await fetch('/api/users/expiry', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, expiry })
                });
                const data = await res.json();
                if (data.error) alert(data.error);
                else {
                    closeModal('editExpiryModal');
                    fetchUsers();
                }
            } catch (err) {
                alert('Connection error');
            }
        }

        function shareUser(username) {
            const host = serverConfig.host || window.location.hostname;
            const port = serverConfig.ssh_port || 22; 
            const dbPorts = serverConfig.dropbear_ports || '144, 109, 50000';
            const wsPort = serverConfig.ws_port || 143;
            const sslPort = serverConfig.ssl_port || 443;
            const sslWsPort = serverConfig.ssl_ws_port || 2083;
            const udpPort = serverConfig.udp_port || 7300;
            
            const configText = `Host: ${host}\nSSH Port: ${port}\nDropbear Ports: ${dbPorts}\nWS Port: ${wsPort}\nSSL Port (SSH): ${sslPort}\nSSL Port (WS): ${sslWsPort}\nUDP GW Port: ${udpPort}\nUsername: ${username}`;
            
            document.getElementById('share-text').innerText = configText;
            
            const qrDiv = document.getElementById('qr-code');
            qrDiv.innerHTML = '';
            new QRCode(qrDiv, {
                text: `Host:${host}|Port:${sslPort}|User:${username}`,
                width: 160,
                height: 160,
                colorDark : "#000000",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.H
            });
            
            openModal('shareUserModal');
        }

        // Init
        fetchConfig().then(() => {
            fetchStats();
            fetchServices();
            fetchUsers();
        });
        setInterval(fetchStats, 10000);
        setInterval(fetchServices, 15000);
    </script>
</body>
</html>

EOF

    # 4. Create default config.json if not exists
    if [ ! -f /etc/ssh-panel/config.json ]; then
        cat > /etc/ssh-panel/config.json << 'EOF'
{
    "username": "admin",
    "password": "admin123",
    "port": 40460
}
EOF
    fi

    # 5. Create systemd unit
    cat > /etc/systemd/system/ssh-panel.service << 'EOF'
[Unit]
Description=SSH User Management Web Panel (SSH-UI)
After=network.target

[Service]
Type=simple
WorkingDirectory=/etc/ssh-panel
ExecStart=/usr/bin/python3 app.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

    log_step "Starting and enabling SSH-UI daemon..."
    systemctl daemon-reload
    systemctl enable ssh-panel 2>/dev/null
    systemctl restart ssh-panel 2>/dev/null
    
    PORT=$(jq -r '.port' /etc/ssh-panel/config.json 2>/dev/null || echo "40460")
    IP_NOW=$(curl -s4 ifconfig.me)
    DOMAIN_NOW=$(cat /etc/vps-domain 2>/dev/null || echo "$IP_NOW")
    
    echo ""
    echo -e "${GREEN}  +---------------------------------------------------------+${NC}"
    echo -e "${GREEN}  |         SSH-UI PANEL INSTALLED SUCCESSFULLY!            |${NC}"
    echo -e "${GREEN}  +---------------------------------------------------------+${NC}"
    echo -e "${GREEN}  |${NC}  Panel URL : ${WHITE}http://${DOMAIN_NOW}:${PORT}/${NC}"
    echo -e "${GREEN}  |${NC}  Username  : ${WHITE}admin${NC}"
    echo -e "${GREEN}  |${NC}  Password  : ${WHITE}admin123${NC}"
    echo -e "${GREEN}  |${NC}  ${YELLOW}Change default credentials after login!${NC}"
    echo -e "${GREEN}  +---------------------------------------------------------+${NC}"
    
    press_enter
}

uninstall_ssh_ui() {
    show_banner
    log_step "Uninstalling SSH-UI Web Panel..."
    systemctl stop ssh-panel 2>/dev/null
    systemctl disable ssh-panel 2>/dev/null
    rm -f /etc/systemd/system/ssh-panel.service
    systemctl daemon-reload
    rm -rf /etc/ssh-panel
    log_done "SSH-UI Web Panel uninstalled successfully!"
    press_enter
}

panel_menu() {
    while true; do
        show_banner
        get_system_info
        
        if [ ! -f /etc/ssh-panel/app.py ]; then
            # PANEL NOT INSTALLED
            echo -e "${BLUE}  +---------------------------------------------------------+${NC}"
            echo -e "${BLUE}  |            SSH-UI WEB PANEL MANAGEMENT                  |${NC}"
            echo -e "${BLUE}  +---------------------------------------------------------+${NC}"
            echo -e "${BLUE}  |${NC}  Status  : ${RED}Not Installed${NC}"
            echo -e "${BLUE}  +---------------------------------------------------------+${NC}"
            echo -e "${BLUE}  |${NC}"
            echo -e "${BLUE}  |${NC}  ${CYAN}[1]${NC}  Install SSH-UI Web Panel"
            echo -e "${BLUE}  |${NC}"
            echo -e "${BLUE}  |${NC}  ${RED}[0]${NC}  Back to Main Menu"
            echo -e "${BLUE}  +---------------------------------------------------------+${NC}"
            echo ""
            echo -ne "  ${WHITE}Enter choice [0-1]: ${NC}"
            read PCHOICE
            
            case $PCHOICE in
            1) install_ssh_ui ;;
            0) break ;;
            *) echo -e "\n  ${RED}Invalid option!${NC}"; sleep 1 ;;
            esac
        else
            # PANEL INSTALLED
            STATUS=$(systemctl is-active ssh-panel 2>/dev/null)
            if [ "$STATUS" = "active" ]; then
                P_STATUS="${GREEN}Running${NC}"
            else
                P_STATUS="${RED}Stopped${NC}"
            fi
            
            PORT=$(jq -r '.port' /etc/ssh-panel/config.json 2>/dev/null || echo "40460")
            USER=$(jq -r '.username' /etc/ssh-panel/config.json 2>/dev/null || echo "admin")
            
            echo -e "${BLUE}  +---------------------------------------------------------+${NC}"
            echo -e "${BLUE}  |            SSH-UI WEB PANEL MANAGEMENT                  |${NC}"
            echo -e "${BLUE}  +---------------------------------------------------------+${NC}"
            echo -e "${BLUE}  |${NC}  Status  : ${P_STATUS}${NC}"
            echo -e "${BLUE}  |${NC}  Port    : ${WHITE}${PORT}${NC}"
            echo -e "${BLUE}  |${NC}  Admin   : ${WHITE}${USER}${NC}"
            echo -e "${BLUE}  |${NC}  URL     : ${WHITE}http://${DOMAIN}:${PORT}/${NC}"
            echo -e "${BLUE}  +---------------------------------------------------------+${NC}"
            echo -e "${BLUE}  |${NC}"
            echo -e "${BLUE}  |${NC}  ${CYAN}[1]${NC}  Start Web Panel"
            echo -e "${BLUE}  |${NC}  ${CYAN}[2]${NC}  Stop Web Panel"
            echo -e "${BLUE}  |${NC}  ${CYAN}[3]${NC}  Restart Web Panel"
            echo -e "${BLUE}  |${NC}  ${CYAN}[4]${NC}  Change Admin Credentials"
            echo -e "${BLUE}  |${NC}  ${CYAN}[5]${NC}  Change Port"
            echo -e "${BLUE}  |${NC}  ${RED}[6]${NC}  Uninstall Web Panel"
            echo -e "${BLUE}  |${NC}"
            echo -e "${BLUE}  |${NC}  ${RED}[0]${NC}  Back to Main Menu"
            echo -e "${BLUE}  +---------------------------------------------------------+${NC}"
            echo ""
            echo -ne "  ${WHITE}Enter choice [0-6]: ${NC}"
            read PCHOICE

            case $PCHOICE in
            1)
                systemctl start ssh-panel
                log_done "SSH Web Panel started!"
                sleep 1
                ;;
            2)
                systemctl stop ssh-panel
                log_done "SSH Web Panel stopped!"
                sleep 1
                ;;
            3)
                systemctl restart ssh-panel
                log_done "SSH Web Panel restarted!"
                sleep 1
                ;;
            4)
                echo -ne "  New Admin Username: "
                read NEW_ADM_USER
                echo -ne "  New Admin Password: "
                read -s NEW_ADM_PASS; echo
                if [[ -n "$NEW_ADM_USER" && -n "$NEW_ADM_PASS" ]]; then
                    python3 -c "import json; f=open('/etc/ssh-panel/config.json','r'); d=json.load(f); f.close(); d['username']='$NEW_ADM_USER'; d['password']='$NEW_ADM_PASS'; f=open('/etc/ssh-panel/config.json','w'); json.dump(d,f,indent=4); f.close()"
                    systemctl restart ssh-panel
                    log_done "Credentials updated!"
                else
                    log_error "Fields cannot be empty!"
                fi
                sleep 2
                ;;
            5)
                echo -ne "  New Port [default: 40460]: "
                read NEW_PORT
                if [[ "$NEW_PORT" =~ ^[1-9][0-9]*$ ]]; then
                    python3 -c "import json; f=open('/etc/ssh-panel/config.json','r'); d=json.load(f); f.close(); d['port']=int('$NEW_PORT'); f=open('/etc/ssh-panel/config.json','w'); json.dump(d,f,indent=4); f.close()"
                    systemctl restart ssh-panel
                    log_done "Port updated to $NEW_PORT!"
                else
                    log_error "Invalid port!"
                fi
                sleep 2
                ;;
            6)
                uninstall_ssh_ui
                ;;
            0) break ;;
            *) echo -e "\n  ${RED}Invalid option!${NC}"; sleep 1 ;;
            esac
        fi
    done
}

# ═══════════════════════════════════════════════════════════
#   SSH USER MANAGEMENT MENU
# ═══════════════════════════════════════════════════════════
user_menu() {
    while true; do
        show_banner
        get_system_info
        DOMAIN=$(cat /etc/vps-domain 2>/dev/null || echo "$IP_ADDR")

        DB_PORT=$(grep -m1 "DROPBEAR_PORT" /etc/default/dropbear 2>/dev/null | cut -d= -f2 | tr -d '"' | xargs)
        DB_PORT=${DB_PORT:-143}
        WS_PORT=$(grep -oE 'ws-ssh(\.py)? [0-9]+' /etc/systemd/system/ws-ssh.service 2>/dev/null | awk '{print $2}')
        WS_PORT=${WS_PORT:-80}
        SSL_PORT=$(grep "^accept" /etc/stunnel/stunnel.conf 2>/dev/null | head -1 | awk '{print $3}')
        SSL_PORT=${SSL_PORT:-443}

        echo -e "${GREEN}  +---------------------------------------------------------+${NC}"
        echo -e "${GREEN}  |               SSH USER MANAGEMENT                       |${NC}"
        echo -e "${GREEN}  +---------------------------------------------------------+${NC}"
        echo -e "${GREEN}  |${NC}  Host   : ${WHITE}${DOMAIN}${NC}"
        echo -e "${GREEN}  |${NC}  Ports  : ${WHITE}Dropbear:${DB_PORT}  WS:${WS_PORT}  SSL:${SSL_PORT}  SSH:22${NC}"
        echo -e "${GREEN}  +---------------------------------------------------------+${NC}"
        echo -e "${GREEN}  |${NC}"
        echo -e "${GREEN}  |${NC}  ${CYAN}[1]${NC}  Create New SSH Account"
        echo -e "${GREEN}  |${NC}  ${RED}[2]${NC}  Delete SSH Account"
        echo -e "${GREEN}  |${NC}  ${YELLOW}[3]${NC}  List All SSH Accounts"
        echo -e "${GREEN}  |${NC}  ${BLUE}[4]${NC}  Set Account Expiry"
        echo -e "${GREEN}  |${NC}  ${PURPLE}[5]${NC}  Change Password"
        echo -e "${GREEN}  |${NC}  ${YELLOW}[6]${NC}  Lock / Unlock Account"
        echo -e "${GREEN}  |${NC}"
        echo -e "${GREEN}  |${NC}  ${RED}[0]${NC}  Back to Main Menu"
        echo -e "${GREEN}  +---------------------------------------------------------+${NC}"
        echo ""
        echo -ne "  ${WHITE}Enter choice [0-6]: ${NC}"
        read UCHOICE

        case $UCHOICE in
        1) user_create ;;
        2) user_delete ;;
        3) user_list ;;
        4) user_expiry ;;
        5) user_chpass ;;
        6) user_lock ;;
        0) break ;;
        *) echo -e "\n  ${RED}Invalid option!${NC}"; sleep 1 ;;
        esac
    done
}

# ─── Create User ───────────────────────────────────────────
user_create() {
    show_banner
    echo -e "${CYAN}  ------------------------------------------------------${NC}"
    echo -e "${WHITE}               CREATE NEW SSH ACCOUNT${NC}"
    echo -e "${CYAN}  ------------------------------------------------------${NC}\n"

    echo -ne "  ${WHITE}Username      : ${NC}"
    read NEWUSER
    [[ -z "$NEWUSER" ]] && log_error "Username cannot be empty!" && sleep 2 && return
    id "$NEWUSER" &>/dev/null && log_error "User '$NEWUSER' already exists!" && sleep 2 && return

    echo -ne "  ${WHITE}Password      : ${NC}"
    read -s NEWPASS; echo
    [[ -z "$NEWPASS" ]] && log_error "Password cannot be empty!" && sleep 2 && return

    echo -ne "  ${WHITE}Expiry (days) : ${NC}${DIM}(0 = no expiry)${NC} "
    read EXPDAYS

    useradd -m -s /bin/bash "$NEWUSER"
    echo "$NEWUSER:$NEWPASS" | chpasswd

    EXP_TEXT="Never"
    if [[ "$EXPDAYS" =~ ^[1-9][0-9]*$ ]]; then
        EXP_DATE=$(date -d "+${EXPDAYS} days" +%Y-%m-%d)
        chage -E "$EXP_DATE" "$NEWUSER"
        EXP_TEXT="${EXPDAYS} days (${EXP_DATE})"
    fi

    DOMAIN=$(cat /etc/vps-domain 2>/dev/null || curl -s4 ifconfig.me)
    DB_PORT=$(grep -m1 "DROPBEAR_PORT" /etc/default/dropbear 2>/dev/null | cut -d= -f2 | tr -d '"' | xargs)
    DB_PORT=${DB_PORT:-143}
    WS_PORT=$(grep -oE 'ws-ssh(\.py)? [0-9]+' /etc/systemd/system/ws-ssh.service 2>/dev/null | awk '{print $2}')
    WS_PORT=${WS_PORT:-80}
    SSL_PORT=$(grep "^accept" /etc/stunnel/stunnel.conf 2>/dev/null | head -1 | awk '{print $3}')
    SSL_PORT=${SSL_PORT:-443}

    echo ""
    echo -e ""
    echo -e "<a href=\\"https://t.me/internetfor_al\\">📢 JOIN TELEGRAM CHANNEL</a>"
    echo -e "</center>"
    echo -e ""
    echo -e "${GREEN}  +---------------------------------------------------------+${NC}"
    echo -e "${GREEN}  |          ACCOUNT CREATED SUCCESSFULLY!                  |${NC}"
    echo -e "${GREEN}  +---------------------------------------------------------+${NC}"
    echo -e "${GREEN}  |${NC}  Host      : ${WHITE}${DOMAIN}${NC}"
    echo -e "${GREEN}  |${NC}  Username  : ${WHITE}${NEWUSER}${NC}"
    echo -e "${GREEN}  |${NC}  Password  : ${WHITE}${NEWPASS}${NC}"
    echo -e "${GREEN}  |${NC}  Expiry    : ${WHITE}${EXP_TEXT}${NC}"
    echo -e "${GREEN}  +---------------------------------------------------------+${NC}"
    echo -e "${GREEN}  |${NC}  Dropbear SSH : ${WHITE}${DOMAIN}:${DB_PORT}${NC}"
    echo -e "${GREEN}  |${NC}  WebSocket    : ${WHITE}${DOMAIN}:${WS_PORT}${NC}"
    echo -e "${GREEN}  |${NC}  SSL/Stunnel  : ${WHITE}${DOMAIN}:${SSL_PORT}${NC}"
    echo -e "${GREEN}  +---------------------------------------------------------+${NC}"
    press_enter
}

# ─── Delete User ───────────────────────────────────────────
user_delete() {
    show_banner
    echo -e "${RED}  ------------------------------------------------------${NC}"
    echo -e "${WHITE}               DELETE SSH ACCOUNT${NC}"
    echo -e "${RED}  ------------------------------------------------------${NC}\n"

    echo -e "  ${YELLOW}Current accounts:${NC}"
    awk -F: '$3>=1000 && $1!="nobody" {printf "   • %s\n", $1}' /etc/passwd
    echo ""

    echo -ne "  ${WHITE}Username to delete: ${NC}"
    read DELUSER
    if ! id "$DELUSER" &>/dev/null; then
        log_error "User '$DELUSER' not found!"
        sleep 2; return
    fi

    echo -ne "  ${RED}[!] Are you sure you want to delete '$DELUSER'? [y/N]: ${NC}"
    read CONFIRM_DEL
    if [[ "$CONFIRM_DEL" == "y" || "$CONFIRM_DEL" == "Y" ]]; then
        pkill -u "$DELUSER" 2>/dev/null
        userdel -r "$DELUSER" 2>/dev/null
        log_done "User '$DELUSER' deleted successfully!"
    else
        log_warn "Cancelled."
    fi
    press_enter
}

# ─── List Users ────────────────────────────────────────────
user_list() {
    show_banner
    echo -e "${CYAN}  ------------------------------------------------------${NC}"
    echo -e "${WHITE}               SSH ACCOUNT LIST${NC}"
    echo -e "${CYAN}  ------------------------------------------------------${NC}\n"

    DOMAIN=$(cat /etc/vps-domain 2>/dev/null || curl -s4 ifconfig.me)
    DB_PORT=$(grep -m1 "DROPBEAR_PORT" /etc/default/dropbear 2>/dev/null | cut -d= -f2 | tr -d '"' | xargs)
    DB_PORT=${DB_PORT:-143}

    echo -e "  ${BLUE}Host: ${WHITE}${DOMAIN}  ${BLUE}Port: ${WHITE}${DB_PORT}${NC}"
    echo ""

    N=0
    awk -F: '$3>=1000 && $1!="nobody" {print $1}' /etc/passwd | while read USR; do
        N=$((N+1))
        EXP=$(chage -l "$USR" 2>/dev/null | grep "Account expires" | cut -d: -f2 | xargs)
        [[ "$EXP" == "never" || -z "$EXP" ]] && EXP_STR="Never" || EXP_STR="$EXP"
        LOCKED=$(passwd -S "$USR" 2>/dev/null | awk '{print $2}')
        [[ "$LOCKED" == "L" ]] && ST="${RED}Locked${NC}" || ST="${GREEN}Active${NC}"
        SESS=$(who 2>/dev/null | grep -c "^$USR" || echo 0)

        echo -e "${YELLOW}  +-- #${N} -----------------------------------------------+${NC}"
        echo -e "${YELLOW}  |${NC}  User     : ${WHITE}${USR}${NC}"
        echo -e "${YELLOW}  |${NC}  Expiry   : ${WHITE}${EXP_STR}${NC}"
        echo -e "${YELLOW}  |${NC}  Status   : $(echo -e $ST)"
        echo -e "${YELLOW}  |${NC}  Sessions : ${WHITE}${SESS} active${NC}"
        echo -e "${YELLOW}  +------------------------------------------------------+${NC}"
    done
    press_enter
}

# ─── Set Expiry ────────────────────────────────────────────
user_expiry() {
    show_banner
    echo -e "${BLUE}  ------------------------------------------------------${NC}"
    echo -e "${WHITE}               SET ACCOUNT EXPIRY${NC}"
    echo -e "${BLUE}  ------------------------------------------------------${NC}\n"

    echo -e "  ${YELLOW}Current accounts:${NC}"
    awk -F: '$3>=1000 && $1!="nobody" {
        cmd="chage -l "$1" 2>/dev/null | grep \"Account expires\" | cut -d: -f2"
        cmd | getline exp; close(cmd)
        gsub(/^ /,"",exp)
        printf "   - %-18s Expiry: %s\n", $1, (exp==""?"never":exp)
    }' /etc/passwd
    echo ""

    echo -ne "  ${WHITE}Username: ${NC}"
    read EXPUSER
    ! id "$EXPUSER" &>/dev/null && log_error "User '$EXPUSER' not found!" && sleep 2 && return

    echo -e "\n  ${YELLOW}Options:${NC}"
    echo -e "  ${CYAN}[1]${NC} Set expiry in X days"
    echo -e "  ${CYAN}[2]${NC} Set specific date (YYYY-MM-DD)"
    echo -e "  ${CYAN}[3]${NC} Remove expiry (never expire)"
    echo -ne "\n  ${WHITE}Choice [1-3]: ${NC}"
    read EXCHOICE

    case $EXCHOICE in
    1)
        echo -ne "  ${WHITE}Days from today: ${NC}"
        read EXPDAYS
        if [[ "$EXPDAYS" =~ ^[1-9][0-9]*$ ]]; then
            EXP_DATE=$(date -d "+${EXPDAYS} days" +%Y-%m-%d)
            chage -E "$EXP_DATE" "$EXPUSER"
            log_done "Expiry set: $EXPUSER -> $EXPDAYS days ($EXP_DATE)"
        else
            log_error "Invalid number!"
        fi
        ;;
    2)
        echo -ne "  ${WHITE}Date (YYYY-MM-DD): ${NC}"
        read EXPDATE
        chage -E "$EXPDATE" "$EXPUSER" && log_done "Expiry set: $EXPUSER -> $EXPDATE"
        ;;
    3)
        chage -E -1 "$EXPUSER" && log_done "Expiry removed: $EXPUSER (never expires)"
        ;;
    esac
    press_enter
}

# ─── Change Password ───────────────────────────────────────
user_chpass() {
    show_banner
    echo -e "${PURPLE}  ------------------------------------------------------${NC}"
    echo -e "${WHITE}               CHANGE PASSWORD${NC}"
    echo -e "${PURPLE}  ------------------------------------------------------${NC}\n"

    echo -e "  ${YELLOW}Current accounts:${NC}"
    awk -F: '$3>=1000 && $1!="nobody" {printf "   - %s\n", $1}' /etc/passwd
    echo ""

    echo -ne "  ${WHITE}Username: ${NC}"
    read CHGUSER
    ! id "$CHGUSER" &>/dev/null && log_error "User '$CHGUSER' not found!" && sleep 2 && return

    echo -ne "  ${WHITE}New Password: ${NC}"
    read -s CHGPASS; echo
    echo -ne "  ${WHITE}Confirm Password: ${NC}"
    read -s CHGPASS2; echo

    if [[ "$CHGPASS" != "$CHGPASS2" ]]; then
        log_error "Passwords do not match!"
        sleep 2; return
    fi

    echo "$CHGUSER:$CHGPASS" | chpasswd
    log_done "Password changed for '$CHGUSER'!"
    press_enter
}

# ─── Lock/Unlock Account ───────────────────────────────────
user_lock() {
    show_banner
    echo -e "${YELLOW}  ══════════════════════════════════════════════════════${NC}"
    echo -e "${WHITE}               LOCK / UNLOCK ACCOUNT${NC}"
    echo -e "${YELLOW}  ══════════════════════════════════════════════════════${NC}\n"

    echo -e "  ${YELLOW}Current accounts:${NC}"
    awk -F: '$3>=1000 && $1!="nobody" {print $1}' /etc/passwd | while read USR; do
        LOCKED=$(passwd -S "$USR" 2>/dev/null | awk '{print $2}')
        [[ "$LOCKED" == "L" ]] && STATUS="${RED}[Locked]${NC}" || STATUS="${GREEN}[Active]${NC}"
        echo -e "   • ${USR} $(echo -e $STATUS)"
    done
    echo ""

    echo -ne "  ${WHITE}Username: ${NC}"
    read LKUSER
    ! id "$LKUSER" &>/dev/null && log_error "User '$LKUSER' not found!" && sleep 2 && return

    LOCKED=$(passwd -S "$LKUSER" 2>/dev/null | awk '{print $2}')
    if [[ "$LOCKED" == "L" ]]; then
        echo -ne "  ${WHITE}Account is LOCKED. Unlock it? [y/N]: ${NC}"
        read CONFIRM
        if [[ "$CONFIRM" == "y" || "$CONFIRM" == "Y" ]]; then
            passwd -u "$LKUSER"
            log_done "Account '$LKUSER' UNLOCKED!"
        fi
    else
        echo -ne "  ${WHITE}Account is ACTIVE. Lock it? [y/N]: ${NC}"
        read CONFIRM
        if [[ "$CONFIRM" == "y" || "$CONFIRM" == "Y" ]]; then
            pkill -u "$LKUSER" 2>/dev/null
            passwd -l "$LKUSER"
            log_done "Account '$LKUSER' LOCKED!"
        fi
    fi
    press_enter
}

# ═══════════════════════════════════════════════════════════
#   DOMAIN SETUP
# ═══════════════════════════════════════════════════════════
setup_domain() {
    show_banner
    echo -e "${CYAN}  ══════════════════════════════════════════════════════${NC}"
    echo -e "${WHITE}              DOMAIN / HOSTNAME SETUP${NC}"
    echo -e "${CYAN}  ══════════════════════════════════════════════════════${NC}\n"

    CURRENT_IP=$(curl -s4 ifconfig.me)
    CURRENT_DOMAIN=$(cat /etc/vps-domain 2>/dev/null || echo "Not set")
    echo -e "  Current IP     : ${GREEN}${CURRENT_IP}${NC}"
    echo -e "  Current Domain : ${GREEN}${CURRENT_DOMAIN}${NC}"
    echo ""
    echo -e "  ${YELLOW}[!] Point your domain A Record → ${WHITE}${CURRENT_IP}${NC}"
    echo -e "  ${YELLOW}[!] Example: free-vps.foridul.store → ${CURRENT_IP}${NC}"
    echo ""
    echo -ne "  ${WHITE}Enter domain (or press Enter to use IP): ${NC}"
    read NEW_DOMAIN

    if [[ -z "$NEW_DOMAIN" ]]; then
        NEW_DOMAIN="$CURRENT_IP"
    fi

    echo "$NEW_DOMAIN" > /etc/vps-domain
    sed -i "/vps-domain/d" /etc/hosts
    echo "127.0.0.1  $NEW_DOMAIN  # vps-domain" >> /etc/hosts

    echo ""
    echo -e "${GREEN}  ╔═════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}  ║${WHITE}          ✅  DOMAIN CONFIGURED SUCCESSFULLY!           ${GREEN}║${NC}"
    echo -e "${GREEN}  ╠═════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}  ║${NC}  🌐 Domain : ${WHITE}${NEW_DOMAIN}${NC}"
    echo -e "${GREEN}  ║${NC}  🖥️  IP     : ${WHITE}${CURRENT_IP}${NC}"
    echo -e "${GREEN}  ╚═════════════════════════════════════════════════════════╝${NC}"
    press_enter
}

# ═══════════════════════════════════════════════════════════
#   SSH INSTALLATION
# ═══════════════════════════════════════════════════════════
install_ssh() {
    show_banner
    echo -e "${CYAN}  ══════════════════════════════════════════════════════${NC}"
    echo -e "${WHITE}         SSH INSTALLATION (Dropbear + WS + Stunnel)${NC}"
    echo -e "${CYAN}  ══════════════════════════════════════════════════════${NC}\n"

    update_system

    # ── Enable BBR & TCP Optimizations ──
    log_step "Enabling Google BBR and network performance optimizations..."
    sed -i '/net.core.default_qdisc/d' /etc/sysctl.conf
    sed -i '/net.ipv4.tcp_congestion_control/d' /etc/sysctl.conf
    sed -i '/net.core.rmem_max/d' /etc/sysctl.conf
    sed -i '/net.core.wmem_max/d' /etc/sysctl.conf
    sed -i '/net.ipv4.tcp_rmem/d' /etc/sysctl.conf
    sed -i '/net.ipv4.tcp_wmem/d' /etc/sysctl.conf
    sed -i '/net.core.netdev_max_backlog/d' /etc/sysctl.conf
    sed -i '/net.core.somaxconn/d' /etc/sysctl.conf
    sed -i '/net.ipv4.tcp_max_syn_backlog/d' /etc/sysctl.conf
    sed -i '/net.ipv4.tcp_fin_timeout/d' /etc/sysctl.conf
    sed -i '/net.ipv4.tcp_keepalive_/d' /etc/sysctl.conf
    sed -i '/net.ipv4.tcp_tw_reuse/d' /etc/sysctl.conf
    
    cat >> /etc/sysctl.conf << 'EOF'
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
net.core.rmem_max=67108864
net.core.wmem_max=67108864
net.ipv4.tcp_rmem=4096 87380 67108864
net.ipv4.tcp_wmem=4096 65536 67108864
net.core.netdev_max_backlog=10000
net.core.somaxconn=10000
net.ipv4.tcp_max_syn_backlog=8192
net.ipv4.tcp_fin_timeout=15
net.ipv4.tcp_keepalive_time=300
net.ipv4.tcp_keepalive_intvl=15
net.ipv4.tcp_keepalive_probes=5
net.ipv4.tcp_tw_reuse=1
EOF
    sysctl -p &>/dev/null

    # ── OpenSSH ──
    log_step "Configuring OpenSSH..."
    echo -ne "  Enter OpenSSH Port [default: 22]: "
    read OPENSSH_PORT; OPENSSH_PORT=${OPENSSH_PORT:-22}
    sed -i "s/^#*Port .*/Port $OPENSSH_PORT/" /etc/ssh/sshd_config
    sed -i "s/^#*PermitRootLogin .*/PermitRootLogin yes/" /etc/ssh/sshd_config
    sed -i "s/^#*PasswordAuthentication .*/PasswordAuthentication yes/" /etc/ssh/sshd_config
    sed -i '/^Compression/d' /etc/ssh/sshd_config
    sed -i '/^UseDNS/d' /etc/ssh/sshd_config
    sed -i '/^IPQoS/d' /etc/ssh/sshd_config
    echo 'Compression no' >> /etc/ssh/sshd_config
    echo 'UseDNS no' >> /etc/ssh/sshd_config
    echo 'IPQoS throughput' >> /etc/ssh/sshd_config
    sed -i '/MaxStartups/d' /etc/ssh/sshd_config
    echo 'MaxStartups 1000:30:2000' >> /etc/ssh/sshd_config
    sed -i "s|^#*Banner .*|Banner /etc/issue.net|g" /etc/ssh/sshd_config
    grep -q "^Banner" /etc/ssh/sshd_config || echo "Banner /etc/issue.net" >> /etc/ssh/sshd_config
    systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null
    log_info "OpenSSH on port $OPENSSH_PORT (Optimized)"

    # ── Dropbear ──
    log_step "Installing Dropbear SSH..."
    apt-get install -y -qq dropbear
    echo -ne "  Dropbear Port 1 [default: 144]: "; read DB_PORT1; DB_PORT1=${DB_PORT1:-144}
    echo -ne "  Dropbear Port 2 [default: 109]: "; read DB_PORT2; DB_PORT2=${DB_PORT2:-109}
    echo -ne "  Dropbear Port 3 [default: 50000]: "; read DB_PORT3; DB_PORT3=${DB_PORT3:-50000}

    # Write SSH Banner
    cat > /etc/issue.net << 'EOF'
<center>
<font color="blue"><b>🌐 PREMIUM SERVER STATUS 🌐</b></font><br><br>

<font color="red">❌ NO DDOS</font><br>
<font color="green">🛡️ NO HACKING</font><br>
<font color="orange">🚫 NO MULTILOGIN</font><br>
<font color="red">⚠️ VIOLATION = AUTO BAN</font><br><br>

<b>👑 OWNER: FORIDUL ISLAM</b><br><br>

<a href="https://t.me/internetfor_al">📢 JOIN TELEGRAM CHANNEL</a>
</center>
EOF

    cat > /etc/systemd/system/dropbear.service <<EOF
[Unit]
Description=Dropbear SSH server
After=network.target
[Service]
Type=simple
ExecStart=/usr/sbin/dropbear -F -p $DB_PORT1 -p $DB_PORT2 -p $DB_PORT3 -W 65536 -b /etc/issue.net
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable dropbear --force
    systemctl restart dropbear 2>/dev/null
    log_info "Dropbear on ports: $DB_PORT1, $DB_PORT2, $DB_PORT3"

    # ── WebSocket SSH ──
    log_step "Installing SSH over WebSocket (Go)..."
    echo -ne "  WebSocket SSH Port [default: 143]: "; read WS_PORT; WS_PORT=${WS_PORT:-143}

    # Install Go compiler if not present
    if ! command -v go &> /dev/null; then
        log_step "Installing Go compiler on the VPS..."
        apt-get update -qq && apt-get install -y -qq golang-go
    fi

    # Create Go source file
    cat > /tmp/ws-ssh.go << 'EOF'
package main

import (
	"fmt"
	"io"
	"net"
	"os"
	"strings"
)

func handleClient(client net.Conn, sshAddr string) {
	defer client.Close()

	// Read handshake
	buf := make([]byte, 4096)
	n, err := client.Read(buf)
	if err != nil || n == 0 {
		return
	}

	requestStr := string(buf[:n])
	
	// Check if this is a WebSocket upgrade or a CONNECT request
	if strings.Contains(requestStr, "UPGRADE") || strings.Contains(requestStr, "Upgrade") || 
	   strings.Contains(requestStr, "CONNECT") || strings.Contains(requestStr, "GET") {
		response := "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"
		_, err = client.Write([]byte(response))
		if err != nil {
			return
		}
	}

	// Connect to local SSH / Dropbear
	ssh, err := net.Dial("tcp", sshAddr)
	if err != nil {
		return
	}
	defer ssh.Close()

	// If we read data that wasn't just a handshake, send it to SSH first
	if !strings.Contains(requestStr, "HTTP/") && !strings.Contains(requestStr, "CONNECT") {
		_, err = ssh.Write(buf[:n])
		if err != nil {
			return
		}
	}

	// Bidirectional tunnel
	done := make(chan struct{}, 2)

	go func() {
		io.Copy(ssh, client)
		done <- struct{}{}
	}()

	go func() {
		io.Copy(client, ssh)
		done <- struct{}{}
	}()

	<-done
}

func main() {
	portStr := "2082"
	if len(os.Args) > 1 {
		portStr = os.Args[1]
	}

	sshAddr := "127.0.0.1:22"
	if len(os.Args) > 2 {
		sshAddr = os.Args[2]
	}

	listenAddr := "0.0.0.0:" + portStr

	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		fmt.Printf("Error binding to %s: %v\n", listenAddr, err)
		os.Exit(1)
	}
	defer listener.Close()

	fmt.Printf("Go WS-SSH Bridge listening on %s -> forwarding to %s\n", listenAddr, sshAddr)

	for {
		client, err := listener.Accept()
		if err != nil {
			continue
		}
		go handleClient(client, sshAddr)
	}
}
EOF

    # Compile the Go binary
    log_step "Compiling Go WS-SSH bridge..."
    go build -o /usr/local/bin/ws-ssh /tmp/ws-ssh.go
    chmod +x /usr/local/bin/ws-ssh
    rm -f /tmp/ws-ssh.go

    # Clean up Go compiler
    log_step "Cleaning up Go compiler..."
    apt-get remove -y -qq golang-go
    apt-get autoremove -y -qq

    cat > /etc/systemd/system/ws-ssh.service <<EOF
[Unit]
Description=SSH over WebSocket (Go)
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/ws-ssh $WS_PORT 127.0.0.1:$OPENSSH_PORT
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable ws-ssh
    systemctl restart ws-ssh
    log_info "WebSocket SSH (Go) on port $WS_PORT"

    # ── Stunnel4 ──
    log_step "Installing Stunnel4 (SSL tunnel)..."
    apt-get install -y -qq stunnel4
    echo -ne "  Stunnel SSL Port [default: 443]: "; read STL_PORT; STL_PORT=${STL_PORT:-443}

    if [ ! -f /etc/stunnel/stunnel.pem ]; then
        openssl req -x509 -nodes -newkey rsa:2048 \
            -keyout /etc/stunnel/stunnel.pem \
            -out /etc/stunnel/stunnel.pem \
            -days 3650 -subj "/CN=$(hostname)" 2>/dev/null
        log_info "Self-signed SSL cert generated"
    fi

    cat > /etc/stunnel/stunnel.conf <<EOF
pid = /var/run/stunnel4/stunnel4.pid
socket = a:SO_REUSEADDR=1
socket = l:TCP_NODELAY=1
socket = r:TCP_NODELAY=1

[dropbear-ssl]
accept  = $STL_PORT
connect = 127.0.0.1:$OPENSSH_PORT
cert    = /etc/stunnel/stunnel.pem

[ws-ssl]
accept  = 2083
connect = 127.0.0.1:$WS_PORT
cert    = /etc/stunnel/stunnel.pem
EOF

    sed -i 's/^ENABLED=.*/ENABLED=1/' /etc/default/stunnel4 2>/dev/null || echo "ENABLED=1" >> /etc/default/stunnel4
    systemctl enable stunnel4 2>/dev/null
    systemctl restart stunnel4 2>/dev/null
    log_info "Stunnel4 on SSL port $STL_PORT (SSH) and 2083 (WS)"

    echo ""
    echo -e "${GREEN}  ╔═════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}  ║${WHITE}          ✅  SSH INSTALLATION COMPLETE!                ${GREEN}║${NC}"
    echo -e "${GREEN}  ╠═════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}  ║${NC}  OpenSSH      : ${WHITE}Port $OPENSSH_PORT${NC}"
    echo -e "${GREEN}  ║${NC}  Dropbear     : ${WHITE}$DB_PORT1, $DB_PORT2, $DB_PORT3${NC}"
    echo -e "${GREEN}  ║${NC}  WebSocket    : ${WHITE}Port $WS_PORT${NC}"
    echo -e "${GREEN}  ║${NC}  SSL/Stunnel  : ${WHITE}Port $STL_PORT (SSH-SSL), 2083 (WS-SSL)${NC}"
    echo -e "${GREEN}  ╚═════════════════════════════════════════════════════════╝${NC}"
    press_enter
}

# ═══════════════════════════════════════════════════════════
#   BADVPN
# ═══════════════════════════════════════════════════════════
install_badvpn() {
    show_banner
    echo -e "${CYAN}  ══════════════════════════════════════════════════════${NC}"
    echo -e "${WHITE}              BADVPN UDP GATEWAY${NC}"
    echo -e "${CYAN}  ══════════════════════════════════════════════════════${NC}\n"

    log_step "Installing BadVPN UDP Gateway..."
    ARCH=$(uname -m)
    [[ "$ARCH" == "x86_64" ]] && BADVPN_URL="https://github.com/daybreakersx/premscript/raw/master/badvpn-udpgw64" \
        || BADVPN_URL="https://github.com/daybreakersx/premscript/raw/master/badvpn-udpgw"

    if ! wget -q -O /usr/bin/badvpn-udpgw "$BADVPN_URL" 2>/dev/null; then
        log_warn "Direct download failed, building from source..."
        apt-get install -y -qq cmake
        git clone https://github.com/ambrop72/badvpn.git /tmp/badvpn 2>/dev/null
        cd /tmp/badvpn && mkdir build && cd build
        cmake .. -DBUILD_NOTHING_BY_DEFAULT=1 -DBUILD_UDPGW=1 2>/dev/null
        make 2>/dev/null
        cp udpgw/badvpn-udpgw /usr/bin/
        cd / && rm -rf /tmp/badvpn
    fi

    chmod +x /usr/bin/badvpn-udpgw 2>/dev/null

    for PORT in 7300 7400 7500; do
        cat > /etc/systemd/system/badvpn-${PORT}.service <<EOF
[Unit]
Description=BadVPN UDP Gateway :$PORT
After=network.target
[Service]
Type=simple
ExecStart=/usr/bin/badvpn-udpgw --listen-addr 127.0.0.1:$PORT --max-clients 500 --max-connections-for-client 10
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
        systemctl daemon-reload
        systemctl enable badvpn-${PORT}
        systemctl restart badvpn-${PORT}
        log_info "BadVPN UDP Gateway running on port $PORT"
    done

    log_done "BadVPN installed! UDP ports: 7300, 7400, 7500"
    press_enter
}

# ═══════════════════════════════════════════════════════════
#   SSL CERTIFICATE
# ═══════════════════════════════════════════════════════════
install_ssl() {
    show_banner
    echo -e "${CYAN}  ══════════════════════════════════════════════════════${NC}"
    echo -e "${WHITE}           SSL CERTIFICATE (acme.sh)${NC}"
    echo -e "${CYAN}  ══════════════════════════════════════════════════════${NC}\n"

    echo -ne "  ${WHITE}Enter your domain (e.g. vpn.example.com): ${NC}"
    read DOMAIN
    [[ -z "$DOMAIN" ]] && log_error "Domain cannot be empty!" && press_enter && return

    log_step "Installing acme.sh..."
    apt-get install -y -qq socat
    [ ! -f /root/.acme.sh/acme.sh ] && curl -sS https://get.acme.sh | bash -s email=admin@${DOMAIN}

    systemctl stop nginx 2>/dev/null
    log_step "Issuing SSL certificate for $DOMAIN..."
    /root/.acme.sh/acme.sh --issue -d $DOMAIN --standalone --keylength ec-256 --server letsencrypt 2>&1 | tail -5

    if [ $? -eq 0 ]; then
        mkdir -p /root/cert/$DOMAIN
        /root/.acme.sh/acme.sh --install-cert -d $DOMAIN --ecc \
            --cert-file /root/cert/$DOMAIN/cert.pem \
            --key-file /root/cert/$DOMAIN/privkey.pem \
            --fullchain-file /root/cert/$DOMAIN/fullchain.pem
        log_done "SSL Certificate installed for $DOMAIN!"
    else
        log_error "Certificate issue failed! Check DNS & port 80."
    fi
    press_enter
}

# ═══════════════════════════════════════════════════════════
#   3X-UI
# ═══════════════════════════════════════════════════════════
install_3xui() {
    show_banner
    echo -e "${GREEN}  ╔═════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}  ║${WHITE}           📦  3X-UI PANEL INSTALLATION                 ${GREEN}║${NC}"
    echo -e "${GREEN}  ╚═════════════════════════════════════════════════════════╝${NC}\n"

    echo -e "  ${YELLOW}[!] This will install 3X-UI Xray panel.${NC}"
    echo -ne "  ${WHITE}Proceed? [y/N]: ${NC}"
    read CONFIRM
    [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]] && log_warn "Cancelled." && press_enter && return

    log_step "Updating system..."
    update_system
    log_step "Downloading and installing 3X-UI..."
    bash <(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh)

    if [ $? -eq 0 ]; then
        # Inject limits optimization in x-ui service file
        if [ -f /etc/systemd/system/x-ui.service ]; then
            if ! grep -q "LimitNOFILE" /etc/systemd/system/x-ui.service; then
                sed -i '/\[Service\]/a LimitNOFILE=1000000\nLimitNPROC=1000000' /etc/systemd/system/x-ui.service
                systemctl daemon-reload
                systemctl restart x-ui
            fi
        fi

        IP_NOW=$(curl -s4 ifconfig.me)
        echo ""
        echo -e "${GREEN}  ╔═════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}  ║${WHITE}          ✅  3X-UI INSTALLED SUCCESSFULLY!             ${GREEN}║${NC}"
        echo -e "${GREEN}  ╠═════════════════════════════════════════════════════════╣${NC}"
        echo -e "${GREEN}  ║${NC}  🌐 Panel URL : ${WHITE}http://${IP_NOW}:54321${NC}"
        echo -e "${GREEN}  ║${NC}  👤 Username  : ${WHITE}admin${NC}"
        echo -e "${GREEN}  ║${NC}  🔑 Password  : ${WHITE}admin${NC}"
        echo -e "${GREEN}  ║${NC}  ${YELLOW}⚠ Change default password after login!${NC}"
        echo -e "${GREEN}  ╚═════════════════════════════════════════════════════════╝${NC}"
    else
        log_error "3X-UI installation failed!"
    fi
    press_enter
}

# ═══════════════════════════════════════════════════════════
#   SERVICE STATUS
# ═══════════════════════════════════════════════════════════
show_status() {
    show_banner
    echo -e "${CYAN}  ══════════════════════════════════════════════════════${NC}"
    echo -e "${WHITE}                   SERVICE STATUS${NC}"
    echo -e "${CYAN}  ══════════════════════════════════════════════════════${NC}\n"

    SERVICES=("ssh" "dropbear" "ws-ssh" "stunnel4" "badvpn-7300" "badvpn-7400" "badvpn-7500" "x-ui" "ssh-panel")
    for svc in "${SERVICES[@]}"; do
        STATUS=$(systemctl is-active "$svc" 2>/dev/null)
        if [ "$STATUS" = "active" ]; then
            echo -e "  ${GREEN}●${NC} ${WHITE}${svc}${NC} → ${GREEN}Running${NC}"
        elif systemctl list-unit-files 2>/dev/null | grep -q "^${svc}"; then
            echo -e "  ${RED}●${NC} ${WHITE}${svc}${NC} → ${RED}Stopped${NC}"
        else
            echo -e "  ${DIM}○${NC} ${DIM}${svc}${NC} → ${DIM}Not installed${NC}"
        fi
    done

    echo ""
    echo -e "${CYAN}  ── Listening Ports ────────────────────────────────${NC}"
    ss -tlnp | grep LISTEN | awk '{print "  " $4}' | sort -t: -k2 -n
    press_enter
}

# ═══════════════════════════════════════════════════════════
#   RESTART SERVICES
# ═══════════════════════════════════════════════════════════
restart_services() {
    show_banner
    log_step "Restarting all services..."
    for svc in "ssh" "dropbear" "ws-ssh" "stunnel4" "badvpn-7300" "badvpn-7400" "badvpn-7500" "x-ui" "ssh-panel"; do
        if systemctl list-unit-files 2>/dev/null | grep -q "^${svc}"; then
            systemctl restart "$svc" 2>/dev/null
            STATUS=$(systemctl is-active "$svc" 2>/dev/null)
            [ "$STATUS" = "active" ] && log_info "$svc → Running" || log_warn "$svc → Stopped"
        fi
    done
    log_done "All services restarted!"
    press_enter
}

# ═══════════════════════════════════════════════════════════
#   INSTALL ALL
# ═══════════════════════════════════════════════════════════
install_all() {
    show_banner
    echo -e "${PURPLE}  ══════════════════════════════════════════════════════${NC}"
    echo -e "${WHITE}         FULL INSTALLATION: SSH + BadVPN + 3X-UI${NC}"
    echo -e "${PURPLE}  ══════════════════════════════════════════════════════${NC}\n"

    echo -ne "  ${WHITE}Install everything? [y/N]: ${NC}"
    read CONFIRM
    [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]] && log_warn "Cancelled." && press_enter && return

    install_ssh
    install_badvpn
    install_3xui
    
    # Install and enable SSH web panel as part of all installation
    install_ssh_ui

    
    log_done "Full installation complete!"
    press_enter
}

# ═══════════════════════════════════════════════════════════
#   CHANGE SERVICE PORTS
# ═══════════════════════════════════════════════════════════
change_ports() {
    while true; do
        show_banner
        echo -e "${CYAN}  ══════════════════════════════════════════════════════${NC}"
        echo -e "${WHITE}                 CHANGE SERVICE PORTS${NC}"
        echo -e "${CYAN}  ══════════════════════════════════════════════════════${NC}\n"

        # Read current ports
        SSH_PORT=$(grep "^Port" /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}')
        SSH_PORT=${SSH_PORT:-22}
        
        DB_PORTS=$(grep -oE '\-p [0-9]+' /etc/systemd/system/dropbear.service 2>/dev/null | awk '{print $2}' | tr '\n' ' ' | xargs)
        DB_PORTS=${DB_PORTS:-"144 109 50000"}

        WS_PORT=$(grep -oE 'ws-ssh [0-9]+' /etc/systemd/system/ws-ssh.service 2>/dev/null | awk '{print $2}')
        WS_PORT=${WS_PORT:-143}

        ST_DB_PORT=$(grep -A2 "\[dropbear-ssl\]" /etc/stunnel/stunnel.conf 2>/dev/null | grep "^accept" | awk '{print $3}')
        ST_DB_PORT=${ST_DB_PORT:-443}
        ST_WS_PORT=$(grep -A2 "\[ws-ssl\]" /etc/stunnel/stunnel.conf 2>/dev/null | grep "^accept" | awk '{print $3}')
        ST_WS_PORT=${ST_WS_PORT:-2083}

        echo -e "  Current Ports:"
        echo -e "  ${WHITE}• OpenSSH Port         :${NC} ${GREEN}${SSH_PORT}${NC}"
        echo -e "  ${WHITE}• Dropbear Ports       :${NC} ${GREEN}${DB_PORTS}${NC}"
        echo -e "  ${WHITE}• WebSocket SSH Port   :${NC} ${GREEN}${WS_PORT}${NC}"
        echo -e "  ${WHITE}• Stunnel Dropbear-SSL :${NC} ${GREEN}${ST_DB_PORT}${NC}"
        echo -e "  ${WHITE}• Stunnel WS-SSL       :${NC} ${GREEN}${ST_WS_PORT}${NC}"
        echo ""
        echo -e "  ${CYAN}[1]${NC} Change OpenSSH Port"
        echo -e "  ${CYAN}[2]${NC} Change Dropbear Ports"
        echo -e "  ${CYAN}[3]${NC} Change WebSocket SSH Port"
        echo -e "  ${CYAN}[4]${NC} Change Stunnel SSL Ports"
        echo -e "  ${RED}[0]${NC} Back to Main Menu"
        echo ""
        echo -ne "  ${WHITE}Enter choice [0-4]: ${NC}"
        read P_CHOICE

        case $P_CHOICE in
        1)
            echo -ne "\n  Enter New OpenSSH Port: "
            read NEW_SSH
            if [[ "$NEW_SSH" =~ ^[1-9][0-9]*$ ]]; then
                sed -i "s/^Port .*/Port $NEW_SSH/" /etc/ssh/sshd_config
                systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null
                log_done "OpenSSH Port updated to $NEW_SSH!"
            else
                log_error "Invalid port!"
            fi
            sleep 2
            ;;
        2)
            echo -ne "\n  Enter Dropbear Port 1: "
            read NEW_DB1
            echo -ne "  Enter Dropbear Port 2: "
            read NEW_DB2
            echo -ne "  Enter Dropbear Port 3: "
            read NEW_DB3
            if [[ "$NEW_DB1" =~ ^[1-9][0-9]*$ && "$NEW_DB2" =~ ^[1-9][0-9]*$ && "$NEW_DB3" =~ ^[1-9][0-9]*$ ]]; then
                cat > /etc/systemd/system/dropbear.service <<EOF
[Unit]
Description=Dropbear SSH server
After=network.target
[Service]
Type=simple
ExecStart=/usr/sbin/dropbear -F -p $NEW_DB1 -p $NEW_DB2 -p $NEW_DB3 -W 65536 -b /etc/issue.net
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
                sed -i "s/connect = 127.0.0.1:.*/connect = 127.0.0.1:$NEW_DB2/g" /etc/stunnel/stunnel.conf 2>/dev/null
                systemctl daemon-reload
                systemctl restart dropbear
                systemctl restart stunnel4 2>/dev/null
                
                # Update panel HTML ports
                sed -i "s/const port = [0-9]*;/const port = $NEW_DB1;/g" /etc/ssh-panel/templates/index.html 2>/dev/null
                
                log_done "Dropbear Ports updated to $NEW_DB1, $NEW_DB2, $NEW_DB3!"
            else
                log_error "Invalid ports!"
            fi
            sleep 2
            ;;
        3)
            echo -ne "\n  Enter New WebSocket SSH Port: "
            read NEW_WS
            if [[ "$NEW_WS" =~ ^[1-9][0-9]*$ ]]; then
                DEST_PORT=$(grep -oE 'ws-ssh [0-9]+ [0-9.]+:[0-9]+' /etc/systemd/system/ws-ssh.service 2>/dev/null | awk '{print $3}' | cut -d: -f2)
                DEST_PORT=${DEST_PORT:-109}

                cat > /etc/systemd/system/ws-ssh.service <<EOF
[Unit]
Description=SSH over WebSocket (Go)
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/ws-ssh $NEW_WS 127.0.0.1:$DEST_PORT
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
                ST_DB_VAL=$(grep -A2 "\[dropbear-ssl\]" /etc/stunnel/stunnel.conf 2>/dev/null | grep "^accept" | awk '{print $3}')
                ST_DB_VAL=${ST_DB_VAL:-443}
                ST_DB_CONN=$(grep -A2 "\[dropbear-ssl\]" /etc/stunnel/stunnel.conf 2>/dev/null | grep "^connect" | awk '{print $3}')
                ST_DB_CONN=${ST_DB_CONN:-"127.0.0.1:109"}
                ST_WS_VAL=$(grep -A2 "\[ws-ssl\]" /etc/stunnel/stunnel.conf 2>/dev/null | grep "^accept" | awk '{print $3}')
                ST_WS_VAL=${ST_WS_VAL:-2083}

                cat > /etc/stunnel/stunnel.conf <<EOF
pid = /var/run/stunnel4/stunnel4.pid
socket = a:SO_REUSEADDR=1
socket = l:TCP_NODELAY=1
socket = r:TCP_NODELAY=1

[dropbear-ssl]
accept  = $ST_DB_VAL
connect = $ST_DB_CONN
cert    = /etc/stunnel/stunnel.pem

[ws-ssl]
accept  = $ST_WS_VAL
connect = 127.0.0.1:$NEW_WS
cert    = /etc/stunnel/stunnel.pem
EOF

                systemctl daemon-reload
                systemctl restart ws-ssh
                systemctl restart stunnel4 2>/dev/null
                
                # Update panel HTML ports
                sed -i "s/const wsPort = [0-9]*;/const wsPort = $NEW_WS;/g" /etc/ssh-panel/templates/index.html 2>/dev/null
                
                log_done "WebSocket SSH Port updated to $NEW_WS!"
            else
                log_error "Invalid port!"
            fi
            sleep 2
            ;;
        4)
            echo -ne "\n  Enter Stunnel Dropbear-SSL Port (default: 443): "
            read NEW_ST_DB
            echo -ne "  Enter Stunnel WS-SSL Port (default: 2083): "
            read NEW_ST_WS
            if [[ "$NEW_ST_DB" =~ ^[1-9][0-9]*$ && "$NEW_ST_WS" =~ ^[1-9][0-9]*$ ]]; then
                DB_CONN=$(grep -A2 "\[dropbear-ssl\]" /etc/stunnel/stunnel.conf 2>/dev/null | grep "^connect" | awk '{print $3}')
                DB_CONN=${DB_CONN:-"127.0.0.1:109"}
                WS_CONN=$(grep -A2 "\[ws-ssl\]" /etc/stunnel/stunnel.conf 2>/dev/null | grep "^connect" | awk '{print $3}')
                WS_CONN=${WS_CONN:-"127.0.0.1:143"}

                cat > /etc/stunnel/stunnel.conf <<EOF
pid = /var/run/stunnel4/stunnel4.pid
socket = a:SO_REUSEADDR=1
socket = l:TCP_NODELAY=1
socket = r:TCP_NODELAY=1

[dropbear-ssl]
accept  = $NEW_ST_DB
connect = $DB_CONN
cert    = /etc/stunnel/stunnel.pem

[ws-ssl]
accept  = $NEW_ST_WS
connect = $WS_CONN
cert    = /etc/stunnel/stunnel.pem
EOF
                systemctl restart stunnel4
                
                # Update panel HTML ports
                sed -i "s/const sslPort = [0-9]*;/const sslPort = $NEW_ST_DB;/g" /etc/ssh-panel/templates/index.html 2>/dev/null
                sed -i "s/const sslWsPort = [0-9]*;/const sslWsPort = $NEW_ST_WS;/g" /etc/ssh-panel/templates/index.html 2>/dev/null
                
                log_done "Stunnel Ports updated to $NEW_ST_DB (Dropbear) and $NEW_ST_WS (WS)!"
            else
                log_error "Invalid ports!"
            fi
            sleep 2
            ;;
        0) break ;;
        esac
    done
}

# ═══════════════════════════════════════════════════════════
#   CHANGE SSH BANNER
# ═══════════════════════════════════════════════════════════
change_banner() {
    while true; do
        show_banner
        echo -e "${CYAN}  ══════════════════════════════════════════════════════${NC}"
        echo -e "${WHITE}                 CHANGE SSH BANNER${NC}"
        echo -e "${CYAN}  ══════════════════════════════════════════════════════${NC}\n"

        if [ -f /etc/issue.net ]; then
            echo -e "  ${YELLOW}Current Banner Content:${NC}"
            echo -e "  --------------------------------------------------"
            cat /etc/issue.net
            echo -e "  --------------------------------------------------"
        else
            echo -e "  ${RED}No current SSH banner found (/etc/issue.net does not exist).${NC}"
        fi
        echo ""
        echo -e "  ${CYAN}[1]${NC} Paste / Enter New SSH Banner (HTML/Text)"
        echo -e "  ${CYAN}[2]${NC} Restore Default Premium Template Banner"
        echo -e "  ${CYAN}[3]${NC} Clear Banner Content"
        echo -e "  ${RED}[0]${NC} Back to Main Menu"
        echo ""
        echo -ne "  ${WHITE}Enter choice [0-3]: ${NC}"
        read B_CHOICE

        case $B_CHOICE in
        1)
            echo ""
            echo -e "  Enter/Paste your new banner. When finished, type ${YELLOW}END${NC} on a new line and press Enter."
            echo -e "  --------------------------------------------------"
            new_banner=""
            while IFS= read -r line; do
                if [[ "$line" == "END" ]]; then
                    break
                fi
                new_banner+="$line"$'\n'
            done
            
            new_banner=$(echo -n "$new_banner")
            
            echo -e "$new_banner" > /etc/issue.net
            log_done "SSH Banner updated successfully!"
            
            sed -i "s|^#*Banner .*|Banner /etc/issue.net|g" /etc/ssh/sshd_config
            grep -q "^Banner" /etc/ssh/sshd_config || echo "Banner /etc/issue.net" >> /etc/ssh/sshd_config
            
            systemctl restart dropbear 2>/dev/null
            systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null
            sleep 2
            ;;
        2)
            cat > /etc/issue.net << 'EOF'
<center>
<font color="blue"><b>🌐 PREMIUM SERVER STATUS 🌐</b></font><br><br>

<font color="red">❌ NO DDOS</font><br>
<font color="green">🛡️ NO HACKING</font><br>
<font color="orange">🚫 NO MULTILOGIN</font><br>
<font color="red">⚠️ VIOLATION = AUTO BAN</font><br><br>

<b>👑 OWNER: FORIDUL ISLAM</b><br><br>

<a href="https://t.me/internetfor_al">📢 JOIN TELEGRAM CHANNEL</a>
</center>
EOF
            log_done "Default banner restored!"
            
            sed -i "s|^#*Banner .*|Banner /etc/issue.net|g" /etc/ssh/sshd_config
            grep -q "^Banner" /etc/ssh/sshd_config || echo "Banner /etc/issue.net" >> /etc/ssh/sshd_config
            
            systemctl restart dropbear 2>/dev/null
            systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null
            sleep 2
            ;;
        3)
            > /etc/issue.net
            log_done "Banner content cleared!"
            
            systemctl restart dropbear 2>/dev/null
            systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null
            sleep 2
            ;;
        0)
            break
            ;;
        esac
    done
}

# ═══════════════════════════════════════════════════════════
#   MAIN LOOP
# ═══════════════════════════════════════════════════════════
detect_os

while true; do
    show_main_menu
    read CHOICE
    case $CHOICE in
        1) install_ssh ;;
        2) install_badvpn ;;
        3) install_ssl ;;
        4) install_3xui ;;
        5) user_menu ;;
        6) setup_domain ;;
        7) panel_menu ;;
        8) show_status ;;
        9) restart_services ;;
        10) install_all ;;
        11) change_ports ;;
        12) change_banner ;;
        0) echo -e "\n  ${CYAN}Goodbye! 👋${NC}\n"; exit 0 ;;
        *) echo -e "\n  ${RED}[!] Invalid option! Please choose 0-12${NC}"; sleep 1 ;;
    esac
done
