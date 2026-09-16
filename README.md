# Folder Delta Compare, Deduplicator & GoFile Cloud Uploader

A high-performance Python application designed to compare two large folders (10GB+), safely delete duplicate/identical files from both folders while keeping modified and newly added files, create compressed ZIP archives of the remaining delta files, and upload them to **GoFile** (or other cloud storage).

---

## 🚀 Key Features

- **⚡ Fast 10GB+ Folder Comparison**:
  - Multi-threaded scanning and 3-stage comparison pipeline:
    1. Fast size filter
    2. Header/footer sample hash
    3. Full 4MB streaming chunk Blake2b hashing (low RAM usage `< 100MB` even for 100GB+ files)
  - Distinguishes between **Identical**, **Modified** (same path, differing content/size), **Unique to A**, and **Unique to B**.
- **🧹 Safe Deletion of Duplicates**:
  - Deletes identical files from **both Folder A and Folder B**.
  - **Preserves modified and newly added files in both folders.**
  - Includes **Dry-Run mode** to preview changes before deleting.
  - Automatically cleans empty leftover directories.
- **📦 Delta ZIP Archiving**:
  - Compresses the remaining delta files.
  - Supports **Single Combined ZIP** (structured into `Folder_A_Delta/` and `Folder_B_Delta/`) or **Two Separate ZIPs**.
  - Real-time animated compression progress bar with speed and ETA.
- **☁️ GoFile Cloud Upload**:
  - Native streaming upload to GoFile with real-time percentage progress bar.
  - Generates instant download link (`https://gofile.io/d/XXXXXX`).
  - Supports optional GoFile API tokens for account uploads or anonymous guest uploads.
  - Compatible with `alias goup='bash <(curl -s https://raw.githubusercontent.com/Sanjivns/GoFile-Upload/refs/heads/master/upload)'`.

---

## 🛠️ How to Run

### Option 1: Interactive Wizard (Recommended)

Simply double click `run.bat` or run:

```bash
python main.py
```

The interactive wizard will guide you through:
1. Entering or dragging & dropping Folder A and Folder B.
2. Comparing files with real-time progress.
3. Reviewing comparison summary.
4. Confirming deletion (or dry-run preview).
5. Zipping remaining delta files.
6. Uploading the ZIP archive to GoFile.

---

### Option 2: Command-Line (CLI Mode for Automation)

You can also run unattended batch jobs using CLI arguments:

```bash
python main.py -a "D:\Data\FolderA" -b "E:\Backup\FolderB" --delete --zip --upload-gofile
```

#### CLI Flags:
| Flag | Description |
| :--- | :--- |
| `-a, --folder-a <path>` | Path to Folder A |
| `-b, --folder-b <path>` | Path to Folder B |
| `--delete` | Automatically delete identical duplicate files from both folders |
| `--dry-run` | Simulate deletion without deleting files |
| `--zip` | Create ZIP archive of remaining delta files |
| `--zip-type combined\|separate` | Structure of ZIP archive (`combined` or `separate`, default: `combined`) |
| `--upload-gofile` | Upload created ZIP archive(s) to GoFile |
| `--gofile-token <token>` | (Optional) GoFile account API token |

---

## 🧪 Testing

To verify the comparison, deletion, archiving, and GoFile upload on your machine, run:

```bash
python test_workflow.py
```
