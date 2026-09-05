import os
import zipfile
import time
from dataclasses import dataclass
from typing import List, Optional, Callable

@dataclass
class ArchiveResult:
    archive_path: str
    file_count: int
    uncompressed_bytes: int
    compressed_bytes: int
    elapsed_seconds: float

def collect_remaining_files(folder_path: str) -> List[tuple[str, str, int]]:
    """
    Collects all files currently existing in folder_path.
    Returns list of (abs_path, arcname, size)
    """
    items = []
    folder_path = os.path.abspath(folder_path)
    for dirpath, _, filenames in os.walk(folder_path):
        for fname in filenames:
            abs_p = os.path.join(dirpath, fname)
            try:
                size = os.path.getsize(abs_p)
                rel_p = os.path.relpath(abs_p, folder_path).replace('\\', '/')
                items.append((abs_p, rel_p, size))
            except (OSError, PermissionError):
                continue
    return items

def create_zip_archive(
    source_folders: List[tuple[str, str]], # List of (folder_path, archive_prefix)
    output_zip_path: str,
    compression_level: int = 6,
    progress_callback: Optional[Callable[[int, int, str], None]] = None
) -> ArchiveResult:
    """
    Creates a single zip archive from one or multiple folders with prefixes.
    e.g. source_folders = [(folder_a, 'Folder_A_Delta'), (folder_b, 'Folder_B_Delta')]
    """
    start_time = time.time()
    output_zip_path = os.path.abspath(output_zip_path)
    os.makedirs(os.path.dirname(output_zip_path), exist_ok=True)

    all_files = []
    total_uncompressed_bytes = 0

    for folder_path, prefix in source_folders:
        folder_files = collect_remaining_files(folder_path)
        for abs_p, rel_p, size in folder_files:
            arc_name = f"{prefix}/{rel_p}" if prefix else rel_p
            all_files.append((abs_p, arc_name, size))
            total_uncompressed_bytes += size

    bytes_processed = 0

    with zipfile.ZipFile(
        output_zip_path,
        'w',
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=compression_level,
        allowZip64=True
    ) as zf:
        for abs_p, arc_name, size in all_files:
            if progress_callback:
                progress_callback(bytes_processed, total_uncompressed_bytes, arc_name)
            try:
                zf.write(abs_p, arcname=arc_name)
                bytes_processed += size
            except Exception:
                pass

    compressed_size = os.path.getsize(output_zip_path) if os.path.exists(output_zip_path) else 0

    return ArchiveResult(
        archive_path=output_zip_path,
        file_count=len(all_files),
        uncompressed_bytes=total_uncompressed_bytes,
        compressed_bytes=compressed_size,
        elapsed_seconds=time.time() - start_time
    )

def create_separate_zip_archives(
    folder_a: str,
    folder_b: str,
    output_dir: str,
    compression_level: int = 6,
    progress_callback: Optional[Callable[[int, int, str], None]] = None
) -> List[ArchiveResult]:
    """Creates two separate zip archives for folder A and folder B."""
    os.makedirs(output_dir, exist_ok=True)
    base_a = os.path.basename(os.path.normpath(folder_a)) or "Folder_A"
    base_b = os.path.basename(os.path.normpath(folder_b)) or "Folder_B"

    zip_a_path = os.path.join(output_dir, f"{base_a}_Delta.zip")
    zip_b_path = os.path.join(output_dir, f"{base_b}_Delta.zip")

    res_a = create_zip_archive(
        [(folder_a, "")],
        zip_a_path,
        compression_level=compression_level,
        progress_callback=progress_callback
    )

    res_b = create_zip_archive(
        [(folder_b, "")],
        zip_b_path,
        compression_level=compression_level,
        progress_callback=progress_callback
    )

    return [res_a, res_b]
