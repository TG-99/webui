#!/usr/bin/env python3
import os
import sys
import argparse
import datetime
from typing import List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engine.ui import (
    print_banner, print_header, print_info, print_success, print_warning,
    print_error, format_size, ProgressBar, prompt_choice, prompt_confirm, prompt_input,
    BOLD, RESET, GREEN, YELLOW, CYAN, MAGENTA, RED, DIM
)
from engine.comparator import compare_folders, FileStatus, ComparisonResult
from engine.cleaner import delete_identical_files, CleanupSummary
from engine.archiver import create_zip_archive, create_separate_zip_archives, ArchiveResult
from engine.uploader import upload_to_gofile, UploadResult

def clean_path_input(path_str: str) -> str:
    """Strips outer quotes and whitespace often added by drag-and-drop on Windows."""
    p = path_str.strip()
    if (p.startswith('"') and p.endswith('"')) or (p.startswith("'") and p.endswith("'")):
        p = p[1:-1].strip()
    return os.path.abspath(p)

def validate_directory_path(path_str: str):
    p = clean_path_input(path_str)
    if not os.path.exists(p):
        return False, f"Directory path does not exist: {p}"
    if not os.path.isdir(p):
        return False, f"Path is not a directory: {p}"
    return True, ""

def display_comparison_summary(res: ComparisonResult):
    print_header("Comparison Results")
    print(f"  {BOLD}Folder A:{RESET} {res.folder_a}")
    print(f"           Scanned: {res.total_scanned_a:,} files ({format_size(res.total_bytes_a)})")
    print(f"  {BOLD}Folder B:{RESET} {res.folder_b}")
    print(f"           Scanned: {res.total_scanned_b:,} files ({format_size(res.total_bytes_b)})")
    print(f"  {DIM}Scan completed in {res.scan_time_seconds:.2f}s{RESET}")
    print("\n" + "─" * 70)
    print(f"  {GREEN}{BOLD}Identical Files (In Both):{RESET}  {len(res.identical_files):>8,} files  (Redundant: {format_size(res.identical_bytes_total)})")
    print(f"  {YELLOW}{BOLD}Modified Files (Different):{RESET} {len(res.modified_files):>8,} files  (Preserved)")
    print(f"  {CYAN}{BOLD}Unique to Folder A:{RESET}         {len(res.a_only_files):>8,} files  (Preserved)")
    print(f"  {MAGENTA}{BOLD}Unique to Folder B:{RESET}         {len(res.b_only_files):>8,} files  (Preserved)")
    print("─" * 70)
    
    # Show sample modified files if any
    if res.modified_files:
        print(f"\n{YELLOW}{BOLD}Sample Modified Files (Differing content/size):{RESET}")
        for item in res.modified_files[:5]:
            print(f"  • {item.rel_path} (A: {format_size(item.size_a)} | B: {format_size(item.size_b)})")
        if len(res.modified_files) > 5:
            print(f"    ... and {len(res.modified_files) - 5} more modified files")

    # Show sample identical files if any
    if res.identical_files:
        print(f"\n{GREEN}{BOLD}Sample Identical Files (To be removed from both folders):{RESET}")
        for item in res.identical_files[:5]:
            print(f"  • {item.rel_path} ({format_size(item.size_a)})")
        if len(res.identical_files) > 5:
            print(f"    ... and {len(res.identical_files) - 5} more identical files")

def perform_comparison(folder_a: str, folder_b: str) -> ComparisonResult:
    print_info(f"Comparing Folder A and Folder B...")
    
    scan_bar = None
    def on_scan(msg: str, count: int):
        print(f"  {CYAN}▸{RESET} {msg}")

    hash_bar: Optional[ProgressBar] = None
    def on_hash(bytes_done: int, total_bytes: int, cur_file: str):
        nonlocal hash_bar
        if hash_bar is None and total_bytes > 0:
            hash_bar = ProgressBar(total=total_bytes, prefix="  Comparing Hashes", is_bytes=True)
        if hash_bar:
            hash_bar.update(bytes_done, extra_info=os.path.basename(cur_file))

    res = compare_folders(
        folder_a,
        folder_b,
        on_scan_progress=on_scan,
        on_hash_progress=on_hash
    )

    if hash_bar:
        hash_bar.finish("Hash verification completed.")

    return res

def perform_deletion(res: ComparisonResult, dry_run: bool = False) -> CleanupSummary:
    action_str = "Simulating Deletion (Dry Run)" if dry_run else "Deleting Identical Files from Both Folders"
    print_header(action_str)

    del_bar = ProgressBar(
        total=max(1, len(res.identical_files) * 2),
        prefix="  Removing Duplicates",
        unit="files"
    )

    def on_del(cur_op: int, total_ops: int, cur_item: str):
        del_bar.update(cur_op, extra_info=cur_item)

    summary = delete_identical_files(
        res,
        dry_run=dry_run,
        clean_empty_dirs=True,
        progress_callback=on_del
    )
    del_bar.finish("Duplicate deletion finished.")

    print(f"\n  {BOLD}Deletion Summary:{RESET}")
    print(f"  • Deleted from Folder A: {summary.deleted_from_a:,} files ({format_size(summary.bytes_freed_a)} freed)")
    print(f"  • Deleted from Folder B: {summary.deleted_from_b:,} files ({format_size(summary.bytes_freed_b)} freed)")
    print(f"  • Total Space Reclaimed: {format_size(summary.bytes_freed_a + summary.bytes_freed_b)}")
    if summary.empty_dirs_removed > 0:
        print(f"  • Empty folders pruned : {summary.empty_dirs_removed:,}")

    if summary.failed_files:
        print_warning(f"{len(summary.failed_files)} files could not be deleted:")
        for err in summary.failed_files[:5]:
            print(f"    - {err}")

    return summary

def perform_zipping(folder_a: str, folder_b: str, zip_mode: str = "combined") -> List[str]:
    print_header("Creating ZIP Archive of Remaining Delta Files")
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    
    zip_paths = []

    if zip_mode == "combined":
        out_zip = os.path.join(os.getcwd(), f"Delta_Archive_{timestamp}.zip")
        print_info(f"Target archive: {out_zip}")
        
        base_a = os.path.basename(os.path.normpath(folder_a)) or "Folder_A"
        base_b = os.path.basename(os.path.normpath(folder_b)) or "Folder_B"

        sources = [
            (folder_a, f"{base_a}_Delta"),
            (folder_b, f"{base_b}_Delta")
        ]

        zip_bar: Optional[ProgressBar] = None
        def on_zip(bytes_done: int, total_bytes: int, item_name: str):
            nonlocal zip_bar
            if zip_bar is None and total_bytes > 0:
                zip_bar = ProgressBar(total=total_bytes, prefix="  Compressing", is_bytes=True)
            if zip_bar:
                zip_bar.update(bytes_done, extra_info=os.path.basename(item_name))

        result = create_zip_archive(sources, out_zip, compression_level=6, progress_callback=on_zip)
        if zip_bar:
            zip_bar.finish("Compression completed.")
        
        print_success(f"Created ZIP: {result.archive_path}")
        print(f"  • Files archived   : {result.file_count:,}")
        print(f"  • Uncompressed size: {format_size(result.uncompressed_bytes)}")
        print(f"  • Compressed size  : {format_size(result.compressed_bytes)}")
        if result.uncompressed_bytes > 0:
            ratio = (1 - (result.compressed_bytes / result.uncompressed_bytes)) * 100
            print(f"  • Space saved by ZIP: {ratio:.1f}%")
        zip_paths.append(out_zip)

    else:
        out_dir = os.path.join(os.getcwd(), f"Delta_Archives_{timestamp}")
        print_info(f"Target directory: {out_dir}")
        zip_bar: Optional[ProgressBar] = None
        def on_zip(bytes_done: int, total_bytes: int, item_name: str):
            nonlocal zip_bar
            if zip_bar is None and total_bytes > 0:
                zip_bar = ProgressBar(total=total_bytes, prefix="  Compressing", is_bytes=True)
            if zip_bar:
                zip_bar.update(bytes_done, extra_info=os.path.basename(item_name))

        results = create_separate_zip_archives(folder_a, folder_b, out_dir, compression_level=6, progress_callback=on_zip)
        if zip_bar:
            zip_bar.finish("Compression completed.")
        for r in results:
            print_success(f"Created ZIP: {r.archive_path} ({format_size(r.compressed_bytes)})")
            zip_paths.append(r.archive_path)

    return zip_paths

def perform_gofile_upload(zip_paths: List[str], token: Optional[str] = None):
    print_header("Uploading to GoFile")
    for zpath in zip_paths:
        fname = os.path.basename(zpath)
        fsize = os.path.getsize(zpath) if os.path.exists(zpath) else 0
        print_info(f"Uploading {fname} ({format_size(fsize)}) to GoFile...")

        upload_bar = ProgressBar(total=fsize, prefix="  Uploading to GoFile", is_bytes=True)
        def on_upload(bytes_done: int, total_bytes: int, item_name: str):
            upload_bar.update(bytes_done, extra_info=item_name)

        result: UploadResult = upload_to_gofile(
            zpath,
            token=token,
            progress_callback=on_upload
        )
        upload_bar.finish("Upload finished.")

        if result.success and result.download_url:
            print("\n" + "═" * 70)
            print(f"{GREEN}{BOLD}🎉 GOFILE UPLOAD SUCCESSFUL!{RESET}")
            print(f"  {BOLD}File:{RESET} {fname}")
            print(f"  {BOLD}Download Link:{RESET} {CYAN}{BOLD}{result.download_url}{RESET}")
            print("═" * 70 + "\n")
        else:
            print_error(f"GoFile upload failed: {result.error_message}")

def run_interactive():
    print_banner()
    
    # 1. Input Folders
    print_header("Step 1: Select Folders to Compare")
    print(f"{DIM}Tip: You can drag and drop folders directly into this terminal window.{RESET}\n")

    folder_a = prompt_input("Enter Path for Folder A", validator=validate_directory_path)
    folder_a = clean_path_input(folder_a)

    folder_b = prompt_input("Enter Path for Folder B", validator=validate_directory_path)
    folder_b = clean_path_input(folder_b)

    if os.path.abspath(folder_a) == os.path.abspath(folder_b):
        print_error("Folder A and Folder B cannot be the exact same directory!")
        return

    # 2. Compare Folders
    print_header("Step 2: Scanning & Comparing Files")
    res = perform_comparison(folder_a, folder_b)
    display_comparison_summary(res)

    if len(res.identical_files) == 0:
        print_info("No identical files found between Folder A and Folder B. Nothing to delete.")
    else:
        # 3. Deletion Option
        print_header("Step 3: Delete Identical Duplicate Files")
        print(f"Identical files to be deleted: {BOLD}{len(res.identical_files):,} files{RESET}")
        print(f"Disk space that will be freed: {BOLD}{format_size(res.identical_bytes_total)}{RESET}")
        print(f"{YELLOW}Note: Modified and newly added files in both folders will be kept completely intact.{RESET}\n")

        del_options = [
            "Delete identical files now (from both Folder A and Folder B)",
            "Run Dry Run first (simulate deletion without deleting)",
            "Skip deletion"
        ]
        choice = prompt_choice("How would you like to proceed?", del_options, default_idx=0)

        if choice == 1:
            perform_deletion(res, dry_run=True)
            if prompt_confirm("Do you want to execute the actual deletion now?", default=True):
                perform_deletion(res, dry_run=False)
        elif choice == 0:
            if prompt_confirm("Are you sure you want to permanently delete these duplicate files from both folders?", default=True):
                perform_deletion(res, dry_run=False)
            else:
                print_info("Deletion cancelled by user.")
        else:
            print_info("Skipped deletion.")

    # 4. Zip Option
    print_header("Step 4: Create ZIP Archive of Remaining Files")
    if prompt_confirm("Do you want to create a ZIP archive of the modified/unique delta files?", default=True):
        zip_options = [
            "Single Combined ZIP (Contains Folder_A_Delta/ and Folder_B_Delta/)",
            "Two Separate ZIPs (One for Folder A, one for Folder B)"
        ]
        zip_choice = prompt_choice("Select ZIP structure:", zip_options, default_idx=0)
        zip_mode = "combined" if zip_choice == 0 else "separate"
        
        created_zips = perform_zipping(folder_a, folder_b, zip_mode=zip_mode)

        # 5. Cloud Upload Option (GoFile)
        print_header("Step 5: Upload to Cloud (GoFile)")
        if prompt_confirm("Do you want to upload the created ZIP archive(s) to GoFile?", default=True):
            has_token = prompt_confirm("Do you have a GoFile account API token? (Optional - select No for guest upload)", default=False)
            token = None
            if has_token:
                token = prompt_input("Enter your GoFile API token").strip()
            
            perform_gofile_upload(created_zips, token=token)
        else:
            print_info("Skipped cloud upload.")
    else:
        print_info("Skipped ZIP archive creation.")

    print_header("All Operations Completed")
    print_success("Process finished successfully.")

def run_cli(args):
    folder_a = clean_path_input(args.folder_a)
    folder_b = clean_path_input(args.folder_b)

    val_a, err_a = validate_directory_path(folder_a)
    if not val_a:
        print_error(err_a)
        sys.exit(1)

    val_b, err_b = validate_directory_path(folder_b)
    if not val_b:
        print_error(err_b)
        sys.exit(1)

    res = perform_comparison(folder_a, folder_b)
    display_comparison_summary(res)

    if args.delete and res.identical_files:
        perform_deletion(res, dry_run=args.dry_run)

    created_zips = []
    if args.zip:
        created_zips = perform_zipping(folder_a, folder_b, zip_mode=args.zip_type)

    if args.upload_gofile and created_zips:
        perform_gofile_upload(created_zips, token=args.gofile_token)

def main():
    parser = argparse.ArgumentParser(
        description="High-Performance 10GB+ Folder Comparator, Cleaner, Archiver and GoFile Uploader"
    )
    parser.add_argument("-a", "--folder-a", help="Path to Folder A")
    parser.add_argument("-b", "--folder-b", help="Path to Folder B")
    parser.add_argument("--delete", action="store_true", help="Automatically delete identical files from both folders")
    parser.add_argument("--dry-run", action="store_true", help="Perform simulated deletion without removing files")
    parser.add_argument("--zip", action="store_true", help="Create ZIP archive of remaining files")
    parser.add_argument("--zip-type", choices=["combined", "separate"], default="combined", help="ZIP archive type")
    parser.add_argument("--upload-gofile", action="store_true", help="Upload created ZIP archive(s) to GoFile")
    parser.add_argument("--gofile-token", help="Optional GoFile API token for account upload")

    if len(sys.argv) == 1:
        # No CLI arguments provided, launch interactive wizard
        try:
            run_interactive()
        except KeyboardInterrupt:
            print("\n" + YELLOW + "Operation cancelled by user." + RESET)
            sys.exit(0)
    else:
        args = parser.parse_args()
        if not args.folder_a or not args.folder_b:
            parser.print_help()
            sys.exit(1)
        run_cli(args)

if __name__ == "__main__":
    main()
