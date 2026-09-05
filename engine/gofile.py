import os
import sys
import time
import json
import shutil
import subprocess
from dataclasses import dataclass
from typing import Optional, Callable
import httpx

@dataclass
class GoFileResult:
    success: bool
    download_page: Optional[str] = None
    file_id: Optional[str] = None
    file_name: Optional[str] = None
    file_size: int = 0
    md5: Optional[str] = None
    guest_token: Optional[str] = None
    error_message: Optional[str] = None

class ProgressFileReader:
    """A file-like object that streams file chunks and updates an upload progress callback."""
    def __init__(self, filepath: str, progress_callback: Optional[Callable[[int, int, str], None]] = None):
        self.filepath = filepath
        self.file_size = os.path.getsize(filepath)
        self.filename = os.path.basename(filepath)
        self.progress_callback = progress_callback
        self.bytes_read = 0
        self._file = open(filepath, 'rb')

    def read(self, size=-1):
        chunk = self._file.read(size)
        if chunk:
            self.bytes_read += len(chunk)
            if self.progress_callback:
                self.progress_callback(self.bytes_read, self.file_size, self.filename)
        return chunk

    def seek(self, offset, whence=0):
        res = self._file.seek(offset, whence)
        self.bytes_read = self._file.tell()
        return res

    def tell(self):
        return self._file.tell()

    def close(self):
        self._file.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

def get_best_gofile_server() -> str:
    """Queries GoFile API to get the best active upload server."""
    with httpx.Client(timeout=30.0) as client:
        resp = client.get("https://api.gofile.io/servers")
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") == "ok" and "data" in data:
            servers = data["data"].get("servers", [])
            if servers:
                return servers[0]["name"]
    return "store3" # Fallback server

def upload_to_gofile_api(
    filepath: str,
    token: Optional[str] = None,
    folder_id: Optional[str] = None,
    progress_callback: Optional[Callable[[int, int, str], None]] = None
) -> GoFileResult:
    """
    Uploads a file to GoFile using the official GoFile REST API with streaming upload.
    """
    filepath = os.path.abspath(filepath)
    if not os.path.isfile(filepath):
        return GoFileResult(success=False, error_message=f"File not found: {filepath}")

    file_size = os.path.getsize(filepath)
    filename = os.path.basename(filepath)

    try:
        server = get_best_gofile_server()
        upload_url = f"https://{server}.gofile.io/contents/uploadfile"

        data_fields = {}
        if token:
            data_fields["token"] = token
        if folder_id:
            data_fields["folderId"] = folder_id

        # Stream the file with progress
        with ProgressFileReader(filepath, progress_callback) as stream_reader:
            files = {
                "file": (filename, stream_reader, "application/octet-stream")
            }

            # Set a generous timeout for large files (e.g. 2 hours max for 10GB+)
            timeout = httpx.Timeout(connect=60.0, read=7200.0, write=7200.0, pool=60.0)
            with httpx.Client(timeout=timeout) as client:
                response = client.post(upload_url, data=data_fields, files=files)

        if response.status_code != 200:
            return GoFileResult(
                success=False,
                error_message=f"HTTP {response.status_code}: {response.text}"
            )

        resp_json = response.json()
        if resp_json.get("status") == "ok":
            res_data = resp_json.get("data", {})
            return GoFileResult(
                success=True,
                download_page=res_data.get("downloadPage"),
                file_id=res_data.get("id") or res_data.get("fileId"),
                file_name=res_data.get("name") or filename,
                file_size=res_data.get("size") or file_size,
                md5=res_data.get("md5"),
                guest_token=res_data.get("guestToken")
            )
        else:
            return GoFileResult(
                success=False,
                error_message=f"GoFile API error: {resp_json.get('status', 'unknown')}"
            )

    except Exception as ex:
        return GoFileResult(
            success=False,
            error_message=f"Upload failed: {str(ex)}"
        )

def upload_to_gofile_bash(filepath: str) -> GoFileResult:
    """
    Uploads via the requested bash script:
    alias goup='bash <(curl -s https://raw.githubusercontent.com/Sanjivns/GoFile-Upload/refs/heads/master/upload)'
    """
    filepath = os.path.abspath(filepath)
    if not os.path.isfile(filepath):
        return GoFileResult(success=False, error_message=f"File not found: {filepath}")

    # Check if bash is available
    bash_path = shutil.which("bash")
    if not bash_path:
        # Fall back to native API
        return upload_to_gofile_api(filepath)

    try:
        # Run bash command
        cmd = [
            bash_path,
            "-c",
            f'bash <(curl -s https://raw.githubusercontent.com/Sanjivns/GoFile-Upload/refs/heads/master/upload) "{filepath}"'
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        output = proc.stdout + "\n" + proc.stderr
        
        # Look for download link in output
        download_link = None
        for line in output.splitlines():
            if "gofile.io/d/" in line:
                parts = line.strip().split()
                for p in parts:
                    if "gofile.io/d/" in p:
                        download_link = p.strip()
                        break

        if proc.returncode == 0 and download_link:
            return GoFileResult(
                success=True,
                download_page=download_link,
                file_name=os.path.basename(filepath),
                file_size=os.path.getsize(filepath)
            )
        elif proc.returncode == 0:
            return GoFileResult(
                success=True,
                download_page=output.strip(),
                file_name=os.path.basename(filepath)
            )
        else:
            # Fall back to native API upload
            return upload_to_gofile_api(filepath)
    except Exception:
        # Fallback to python native API
        return upload_to_gofile_api(filepath)
