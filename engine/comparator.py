import os
import hashlib
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Tuple, Callable

class FileStatus(str, Enum):
    IDENTICAL = "IDENTICAL"    # In both folders, exact same content & size
    MODIFIED = "MODIFIED"      # In both folders, but content or size differs
    A_ONLY = "A_ONLY"          # Present only in Folder A
    B_ONLY = "B_ONLY"          # Present only in Folder B

@dataclass
class FileEntry:
    rel_path: str
    abs_path_a: Optional[str] = None
    abs_path_b: Optional[str] = None
    size_a: int = 0
    size_b: int = 0
    mtime_a: float = 0.0
    mtime_b: float = 0.0
    hash_a: Optional[str] = None
    hash_b: Optional[str] = None
    status: FileStatus = FileStatus.IDENTICAL

@dataclass
class ComparisonResult:
    folder_a: str
    folder_b: str
    scan_time_seconds: float = 0.0
    total_scanned_a: int = 0
    total_scanned_b: int = 0
    total_bytes_a: int = 0
    total_bytes_b: int = 0
    identical_files: List[FileEntry] = field(default_factory=list)
    modified_files: List[FileEntry] = field(default_factory=list)
    a_only_files: List[FileEntry] = field(default_factory=list)
    b_only_files: List[FileEntry] = field(default_factory=list)
    identical_bytes_total: int = 0  # Total bytes that can be freed from duplicate copies

CHUNK_SIZE = 4 * 1024 * 1024  # 4MB streaming chunks for memory efficiency
SAMPLE_CHUNK = 64 * 1024      # 64KB for quick sample check

def quick_sample_hash(filepath: str, file_size: int) -> str:
    """Computes a fast sample hash using first 64KB and last 64KB of the file."""
    if file_size <= SAMPLE_CHUNK * 2:
        return full_file_hash(filepath)
    
    h = hashlib.blake2b(digest_size=20)
    with open(filepath, 'rb') as f:
        # First chunk
        h.update(f.read(SAMPLE_CHUNK))
        # Last chunk
        f.seek(file_size - SAMPLE_CHUNK)
        h.update(f.read(SAMPLE_CHUNK))
    return h.hexdigest()

def full_file_hash(filepath: str, progress_callback: Optional[Callable[[int], None]] = None) -> str:
    """Computes full Blake2b streaming hash with 4MB chunk buffers."""
    h = hashlib.blake2b(digest_size=20)
    with open(filepath, 'rb') as f:
        while True:
            chunk = f.read(CHUNK_SIZE)
            if not chunk:
                break
            h.update(chunk)
            if progress_callback:
                progress_callback(len(chunk))
    return h.hexdigest()

def scan_directory(root_dir: str) -> Tuple[Dict[str, Tuple[int, float]], int]:
    """
    Recursively scans a directory and returns a dictionary of:
    rel_path -> (size, mtime)
    """
    files_map: Dict[str, Tuple[int, float]] = {}
    total_bytes = 0
    root_dir = os.path.abspath(root_dir)

    for dirpath, _, filenames in os.walk(root_dir):
        for fname in filenames:
            abs_path = os.path.join(dirpath, fname)
            try:
                stat = os.stat(abs_path)
                rel_path = os.path.relpath(abs_path, root_dir).replace('\\', '/')
                files_map[rel_path] = (stat.st_size, stat.st_mtime)
                total_bytes += stat.st_size
            except (OSError, PermissionError):
                continue
    return files_map, total_bytes

def compare_file_pair(
    rel_path: str,
    path_a: str,
    path_b: str,
    size: int,
    mtime_a: float,
    mtime_b: float,
    progress_callback: Optional[Callable[[int, str], None]] = None
) -> FileEntry:
    entry = FileEntry(
        rel_path=rel_path,
        abs_path_a=path_a,
        abs_path_b=path_b,
        size_a=size,
        size_b=size,
        mtime_a=mtime_a,
        mtime_b=mtime_b
    )

    if size == 0:
        entry.status = FileStatus.IDENTICAL
        return entry

    # Fast check: sample head and tail
    try:
        sample_a = quick_sample_hash(path_a, size)
        sample_b = quick_sample_hash(path_b, size)
        if sample_a != sample_b:
            entry.status = FileStatus.MODIFIED
            if progress_callback:
                progress_callback(size, rel_path)
            return entry
    except Exception:
        entry.status = FileStatus.MODIFIED
        return entry

    # If file is small, quick sample was already a full hash
    if size <= SAMPLE_CHUNK * 2:
        entry.status = FileStatus.IDENTICAL if sample_a == sample_b else FileStatus.MODIFIED
        if progress_callback:
            progress_callback(size, rel_path)
        return entry

    # Full content comparison
    try:
        def on_chunk(bytes_read: int):
            if progress_callback:
                progress_callback(bytes_read, rel_path)

        hash_a = full_file_hash(path_a, progress_callback=on_chunk)
        hash_b = full_file_hash(path_b)  # Compare hash_b
        entry.hash_a = hash_a
        entry.hash_b = hash_b
        entry.status = FileStatus.IDENTICAL if hash_a == hash_b else FileStatus.MODIFIED
    except Exception:
        entry.status = FileStatus.MODIFIED

    return entry

def compare_folders(
    folder_a: str,
    folder_b: str,
    on_scan_progress: Optional[Callable[[str, int], None]] = None,
    on_hash_progress: Optional[Callable[[int, int, str], None]] = None,
    max_workers: int = 8
) -> ComparisonResult:
    """
    Compares Folder A and Folder B completely:
    - Scans all files and sizes
    - Compares identical candidates via streaming hash
    - Identifies Identical, Modified, Unique to A, Unique to B
    """
    start_time = time.time()
    folder_a = os.path.abspath(folder_a)
    folder_b = os.path.abspath(folder_b)

    if not os.path.isdir(folder_a):
        raise ValueError(f"Folder A does not exist or is not a directory: {folder_a}")
    if not os.path.isdir(folder_b):
        raise ValueError(f"Folder B does not exist or is not a directory: {folder_b}")

    if on_scan_progress:
        on_scan_progress(f"Scanning Folder A: {folder_a}...", 0)
    files_a, total_bytes_a = scan_directory(folder_a)

    if on_scan_progress:
        on_scan_progress(f"Scanning Folder B: {folder_b}...", len(files_a))
    files_b, total_bytes_b = scan_directory(folder_b)

    all_keys = set(files_a.keys()).union(set(files_b.keys()))

    res = ComparisonResult(
        folder_a=folder_a,
        folder_b=folder_b,
        total_scanned_a=len(files_a),
        total_scanned_b=len(files_b),
        total_bytes_a=total_bytes_a,
        total_bytes_b=total_bytes_b
    )

    candidates_to_hash: List[Tuple[str, str, str, int, float, float]] = []

    for rel_path in all_keys:
        in_a = rel_path in files_a
        in_b = rel_path in files_b

        if in_a and not in_b:
            size_a, mtime_a = files_a[rel_path]
            res.a_only_files.append(FileEntry(
                rel_path=rel_path,
                abs_path_a=os.path.join(folder_a, os.path.normpath(rel_path)),
                size_a=size_a,
                mtime_a=mtime_a,
                status=FileStatus.A_ONLY
            ))
        elif in_b and not in_a:
            size_b, mtime_b = files_b[rel_path]
            res.b_only_files.append(FileEntry(
                rel_path=rel_path,
                abs_path_b=os.path.join(folder_b, os.path.normpath(rel_path)),
                size_b=size_b,
                mtime_b=mtime_b,
                status=FileStatus.B_ONLY
            ))
        else:
            # Present in both
            size_a, mtime_a = files_a[rel_path]
            size_b, mtime_b = files_b[rel_path]
            path_a = os.path.join(folder_a, os.path.normpath(rel_path))
            path_b = os.path.join(folder_b, os.path.normpath(rel_path))

            if size_a != size_b:
                res.modified_files.append(FileEntry(
                    rel_path=rel_path,
                    abs_path_a=path_a,
                    abs_path_b=path_b,
                    size_a=size_a,
                    size_b=size_b,
                    mtime_a=mtime_a,
                    mtime_b=mtime_b,
                    status=FileStatus.MODIFIED
                ))
            else:
                candidates_to_hash.append((rel_path, path_a, path_b, size_a, mtime_a, mtime_b))

    # Calculate total bytes to verify
    total_verify_bytes = sum(item[3] for item in candidates_to_hash)
    verified_bytes = 0

    def on_file_chunk(bytes_done: int, cur_file: str):
        nonlocal verified_bytes
        verified_bytes += bytes_done
        if on_hash_progress:
            on_hash_progress(verified_bytes, total_verify_bytes, cur_file)

    # Process identical candidates
    if candidates_to_hash:
        workers = max(1, min(max_workers, len(candidates_to_hash)))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            future_to_file = {
                executor.submit(
                    compare_file_pair,
                    rel_path, path_a, path_b, size, mtime_a, mtime_b, on_file_chunk
                ): rel_path
                for rel_path, path_a, path_b, size, mtime_a, mtime_b in candidates_to_hash
            }

            for future in as_completed(future_to_file):
                entry = future.result()
                if entry.status == FileStatus.IDENTICAL:
                    res.identical_files.append(entry)
                    # Count redundant bytes (2x because it exists in both A and B)
                    res.identical_bytes_total += (entry.size_a * 2)
                else:
                    res.modified_files.append(entry)

    # Sort lists by relative path
    res.identical_files.sort(key=lambda x: x.rel_path)
    res.modified_files.sort(key=lambda x: x.rel_path)
    res.a_only_files.sort(key=lambda x: x.rel_path)
    res.b_only_files.sort(key=lambda x: x.rel_path)

    res.scan_time_seconds = time.time() - start_time
    return res
