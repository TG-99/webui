import os
from dataclasses import dataclass
from typing import Optional, Callable
from engine.gofile import upload_to_gofile_api, upload_to_gofile_bash, GoFileResult

@dataclass
class UploadResult:
    success: bool
    provider: str
    download_url: Optional[str] = None
    remote_path: Optional[str] = None
    bytes_uploaded: int = 0
    error_message: Optional[str] = None

def upload_to_gofile(
    filepath: str,
    token: Optional[str] = None,
    use_bash_if_available: bool = False,
    progress_callback: Optional[Callable[[int, int, str], None]] = None
) -> UploadResult:
    """Uploads file to GoFile and returns download URL."""
    if use_bash_if_available:
        res: GoFileResult = upload_to_gofile_bash(filepath)
    else:
        res: GoFileResult = upload_to_gofile_api(filepath, token=token, progress_callback=progress_callback)

    return UploadResult(
        success=res.success,
        provider="GoFile",
        download_url=res.download_page,
        remote_path=res.file_id,
        bytes_uploaded=res.file_size,
        error_message=res.error_message
    )
