import os
import shutil
from dataclasses import dataclass, field
from typing import List, Optional, Callable
from engine.comparator import ComparisonResult, FileEntry

@dataclass
class CleanupSummary:
    deleted_from_a: int = 0
    deleted_from_b: int = 0
    bytes_freed_a: int = 0
    bytes_freed_b: int = 0
    empty_dirs_removed: int = 0
    failed_files: List[str] = field(default_factory=list)
    is_dry_run: bool = False

def remove_empty_folders(root_dir: str) -> int:
    """Removes empty directories recursively under root_dir."""
    removed_count = 0
    for dirpath, dirnames, filenames in os.walk(root_dir, topdown=False):
        if dirpath == root_dir:
            continue
        try:
            if not os.listdir(dirpath):
                os.rmdir(dirpath)
                removed_count += 1
        except Exception:
            pass
    return removed_count

def delete_identical_files(
    comp_result: ComparisonResult,
    dry_run: bool = False,
    clean_empty_dirs: bool = True,
    progress_callback: Optional[Callable[[int, int, str], None]] = None
) -> CleanupSummary:
    """
    Deletes identical duplicate files from BOTH Folder A and Folder B.
    Keeps all modified and unique (newly added) files.
    """
    summary = CleanupSummary(is_dry_run=dry_run)
    identical_list = comp_result.identical_files
    total_ops = len(identical_list) * 2  # 1 deletion for A, 1 deletion for B

    current_op = 0

    for item in identical_list:
        # Delete from Folder A
        if item.abs_path_a and os.path.isfile(item.abs_path_a):
            current_op += 1
            if progress_callback:
                progress_callback(current_op, total_ops, f"Folder A: {item.rel_path}")
            if not dry_run:
                try:
                    os.remove(item.abs_path_a)
                    summary.deleted_from_a += 1
                    summary.bytes_freed_a += item.size_a
                except Exception as ex:
                    summary.failed_files.append(f"[Folder A] {item.abs_path_a}: {str(ex)}")
            else:
                summary.deleted_from_a += 1
                summary.bytes_freed_a += item.size_a

        # Delete from Folder B
        if item.abs_path_b and os.path.isfile(item.abs_path_b):
            current_op += 1
            if progress_callback:
                progress_callback(current_op, total_ops, f"Folder B: {item.rel_path}")
            if not dry_run:
                try:
                    os.remove(item.abs_path_b)
                    summary.deleted_from_b += 1
                    summary.bytes_freed_b += item.size_b
                except Exception as ex:
                    summary.failed_files.append(f"[Folder B] {item.abs_path_b}: {str(ex)}")
            else:
                summary.deleted_from_b += 1
                summary.bytes_freed_b += item.size_b

    # Clean empty directories
    if clean_empty_dirs and not dry_run:
        summary.empty_dirs_removed += remove_empty_folders(comp_result.folder_a)
        summary.empty_dirs_removed += remove_empty_folders(comp_result.folder_b)

    return summary
