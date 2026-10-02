# ⚡ Premium VPS & Cloud SSH Server (VPS & Railway.app Ready)

A lightweight, high-performance, and secure script & containerized suite to install and manage SSH services on Ubuntu VPS servers as well as cloud PaaS platforms like **Railway.app**. Fully optimized for SSH WebSocket tunneling, high-speed CDN connections, and zero connection drops.

[![Supported OS](https://img.shields.io/badge/OS-Ubuntu%2020.04%20%7C%2022.04%20%7C%2024.04-orange.svg)](#)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](#)

---

## 🚀 Deployment Options

### Option A: Deploy on Railway.app (Cloud Container)

You can deploy this entire suite directly on **Railway.app** in under 1 minute with automatic free SSL:

1. **Fork or Push** this repository to your GitHub account.
2. Go to [Railway.app](https://railway.app) and click **New Project** → **Deploy from GitHub repo**.
3. (Recommended) Under **Variables**, you can set:
   * `ADMIN_USER` (Default: `admin`)
   * `ADMIN_PASS` (Default: `admin123`)
   * `DEFAULT_USER` / `DEFAULT_PASS` (Optional initial SSH account)
4. (Recommended) Add a **Volume** mounted at `/data` so that user accounts and settings persist across container redeploys.
5. In your service settings, click **Generate Domain** to get your public HTTPS URL (e.g., `https://your-service.up.railway.app`).

#### 💡 Connection Details on Railway (Port 80 Non-SSL & Port 443 SSL):
* **Web Management Panel**: Access `http://your-service.up.railway.app` or `https://your-service.up.railway.app`
* **SSH WebSocket Tunnel (Non-SSL Port 80)**:
  * **Host / Remote**: `your-service.up.railway.app`
  * **Port**: `80` (HTTP / Non-SSL)
  * **Payload**: `GET / HTTP/1.1[crlf]Host: your-service.up.railway.app[crlf]Upgrade: websocket[crlf]Connection: Upgrade[crlf][crlf]`
* **SSH WebSocket Tunnel (SSL Port 443)**:
  * **Host / SNI**: `your-service.up.railway.app`
  * **Port**: `443` (WSS / TLS)
  * **Payload**: `GET / HTTP/1.1[crlf]Host: your-service.up.railway.app[crlf]Upgrade: websocket[crlf][crlf]`

---

### Option B: One-Line Install on Linux VPS (Ubuntu / Debian)

Run the following command as **root** on a fresh Ubuntu VPS:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/anewgmail26-stack/vps-setup/main/vps-setup.sh)"
```

After installation, simply run `./vps-setup.sh` to open the CLI management panel.

---

## ✨ Features

- 🔒 **Multi-Service SSH**: Clean installation of OpenSSH, Dropbear, WebSocket SSH, and Stunnel.
- 🚂 **Railway & Docker Ready**: Multi-stage Docker container with a Go multiplexer that routes Web Panel and SSH-WebSocket on a single public port `$PORT`.
- 🚀 **BBR & TCP Optimizations (VPS)**: Enables Google BBR congestion control and optimizes TCP window buffers for faster tunneling speeds.
- 🛡️ **Zero Rate-Limiting**: Custom `MaxStartups` settings to prevent dropped connections during heavy concurrency.
- 🔌 **Dynamic Port Management**: Modify service ports dynamically from the CLI menu without reinstalling.
- 🌐 **Acme.sh SSL Integration (VPS)**: Let's Encrypt SSL certificate issuance and installation.
- 🎮 **BadVPN UDP Gateway (VPS)**: BadVPN compilation and installation on UDP ports 7300, 7400, and 7500 for gaming and VoIP.
- 🖥️ **SSH-UI Web Panel**: A modern dark-mode Flask web panel to create, delete, monitor, and manage SSH users via a clean browser UI.
- 📝 **SSH Banner Manager**: Easily change, restore, or clear the HTML/Text welcome banner displayed during login.

---

## 🔌 Default VPS Port Configuration

| Service | Port | Protocol | Description | Forwarding Target |
| :--- | :--- | :--- | :--- | :--- |
| **OpenSSH** | `22` | TCP | Raw SSH connection | Local system shell |
| **Dropbear** | `109, 144, 50000` | TCP | Lightweight SSH daemon | Local system shell |
| **WebSocket SSH** | `143` | TCP | Go WebSocket SSH bridge | `127.0.0.1:22` (OpenSSH) |
| **Stunnel (SSH-SSL)** | `443` | TCP / TLS | SSL Tunnel wrapper | `127.0.0.1:22` (OpenSSH) |
| **Stunnel (WS-SSL)** | `2083` | TCP / TLS | SSL WebSocket wrapper | `127.0.0.1:143` (ws-ssh) |
| **BadVPN** | `7300, 7400, 7500` | UDP | BadVPN UDP gateway | Game/UDP traffic |
| **SSH-UI Panel** | `40460` | TCP | Flask Web Management Panel | Browser UI |

---

## 🎮 CLI Management Menu (VPS)

```text
  ╭─────────────────────────────────────────────────────────╮
  │                      MAIN MENU                          │
  ├─────────────────────────────────────────────────────────┤
  │
  │  [1]  SSH Server Setup (Dropbear + WS + Stunnel)
  │  [2]  BadVPN UDP Gateway
  │  [3]  SSL Certificate (acme.sh)
  │  [4]  3X-UI Panel (Xray/V2Ray)
  │
  ├─────────────────────────────────────────────────────────┤
  │  [5]  SSH User Management
  │  [6]  Domain / Hostname Setup
  │  [7]  SSH Web Panel Management (SSH-UI)
  │  [8]  Show Service Status
  │  [9]  Restart All Services
  │
  ├─────────────────────────────────────────────────────────┤
  │  [10] Install ALL (SSH + BadVPN + 3X-UI + SSH-UI)
  │  [11] Change Service Ports
  │  [12] Change SSH Banner
  │  [0]  Exit
  │
  ╰─────────────────────────────────────────────────────────╯
```

---

## 🖥️ SSH-UI Web Panel

Manage SSH accounts easily using the responsive Flask web panel:

- **Default Username**: `admin`
- **Default Password**: `admin123`

*(Change default credentials inside the panel settings immediately after logging in)*

---

## 🛡️ License

This project is licensed under the MIT License. Feel free to clone, edit, and share!
