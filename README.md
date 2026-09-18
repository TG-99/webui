# Keybox Checker & Pool Manager

A standalone modern web application for verifying Android Attestation Keyboxes (`keybox.xml`), checking real-time Google attestation revocation lists (CRL), and monitoring raw URL sources (GitHub, Gists, Pastebin) for automated keybox scraping and database pool synchronization.

---

## 🚀 Features

- **Keybox Attestation Verifier**: Parse and validate EC & RSA certificates with **Strong / SoftBan / Revoked** classification.
- **Hardware vs Software Roots**: Distinguishes Google Hardware Root CA (`Strong`) from AOSP Software Root CAs (`Device / SoftBan`).
- **Specter Softban Catalog**: Flags softbanned certificate serial numbers that fail Google Play Integrity Strong checks.
- **Real-Time Revocation Checks**: Automatically downloads and checks certificate serial numbers against Google's official CRL.
- **Active Keybox Pool**: Maintains all stored keyboxes in MongoDB with automatic prioritization for `STRONG` and `SOFTBAN` keyboxes.
- **Raw URL Sources Scraper**: Background worker + on-demand scraper monitoring raw URLs (GitHub, Gists, Pastebin, direct XMLs) for keybox extraction and verification.
- **Modern Glassmorphism UI**: Fast, responsive dark/light theme dashboard with instant XML drag-and-drop.

---

## 📦 Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment

Create or edit `.env`:

```env
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net
MONGO_DB_NAME=keybox
PORT=8000
```

### 3. Run Locally

```bash
python main.py
```

Open `http://localhost:8000` in your browser.

---

## 🐳 Docker Deployment

### Docker Run

```bash
docker build -t keybox-checker .
docker run -p 8000:8000 --env-file .env keybox-checker
```

### Docker Compose

```bash
docker-compose up -d --build
```
