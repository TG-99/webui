import os
import sys
import time
import shutil
from typing import Optional, List

# Enable ANSI escape sequences on Windows terminal
if os.name == 'nt':
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-11) # STD_OUTPUT_HANDLE
        mode = ctypes.c_ulong()
        kernel32.GetConsoleMode(handle, ctypes.byref(mode))
        mode.value |= 0x0004 # ENABLE_VIRTUAL_TERMINAL_PROCESSING
        kernel32.SetConsoleMode(handle, mode)
    except Exception:
        pass

# Color codes
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
ITALIC = "\033[3m"
UNDERLINE = "\033[4m"

BLACK = "\033[30m"
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
BLUE = "\033[34m"
MAGENTA = "\033[35m"
CYAN = "\033[36m"
WHITE = "\033[37m"

def print_banner():
    banner = f"""
{CYAN}{BOLD}╔═══════════════════════════════════════════════════════════════════════════╗
║                   FOLDER COMPARE & DELTA CLOUD SYNC                       ║
║        High-Performance 10GB+ Folder Comparator, Cleaner & Uploader       ║
╚═══════════════════════════════════════════════════════════════════════════╝{RESET}
"""
    print(banner)

def print_header(title: str):
    term_width = min(shutil.get_terminal_size((80, 20)).columns, 80)
    line = "━" * max(0, term_width - len(title) - 4)
    print(f"\n{BLUE}{BOLD}━━ {title} {line}{RESET}")

def print_info(msg: str):
    print(f"{CYAN}ℹ {msg}{RESET}")

def print_success(msg: str):
    print(f"{GREEN}{BOLD}✔ {msg}{RESET}")

def print_warning(msg: str):
    print(f"{YELLOW}{BOLD}⚠ {msg}{RESET}")

def print_error(msg: str):
    print(f"{RED}{BOLD}✖ {msg}{RESET}")

def format_size(bytes_val: int) -> str:
    """Format bytes to human readable format (KB, MB, GB, TB)."""
    if bytes_val < 0:
        return "0 B"
    val = float(bytes_val)
    for unit in ['B', 'KB', 'MB', 'GB', 'TB', 'PB']:
        if val < 1024.0:
            if unit == 'B':
                return f"{int(val)} B"
            return f"{val:.2f} {unit}"
        val /= 1024.0
    return f"{val:.2f} PB"

def format_time(seconds: float) -> str:
    """Format seconds into HH:MM:SS or MM:SS."""
    if seconds < 0 or seconds > 3600 * 24 * 7:
        return "--:--"
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"

class ProgressBar:
    """A smooth, flicker-free terminal progress bar."""
    def __init__(self, total: int, prefix: str = "", unit: str = "items", is_bytes: bool = False):
        self.total = max(1, total)
        self.current = 0
        self.prefix = prefix
        self.unit = unit
        self.is_bytes = is_bytes
        self.start_time = time.time()
        self.last_update = 0
        self.bar_len = 28

    def update(self, current: int, extra_info: str = ""):
        self.current = min(self.total, max(0, current))
        now = time.time()
        # Throttle updates to ~20 FPS unless finished
        if now - self.last_update < 0.05 and self.current < self.total:
            return
        self.last_update = now

        elapsed = now - self.start_time
        pct = min(100.0, (self.current / self.total) * 100.0)
        filled = int(self.bar_len * self.current / self.total)
        bar = f"{GREEN}{'━' * filled}{RESET}{DIM}{'─' * (self.bar_len - filled)}{RESET}"

        rate = self.current / elapsed if elapsed > 0 else 0
        eta = (self.total - self.current) / rate if rate > 0 else 0

        if self.is_bytes:
            cur_str = format_size(self.current)
            tot_str = format_size(self.total)
            rate_str = f"{format_size(int(rate))}/s"
        else:
            cur_str = f"{self.current:,}"
            tot_str = f"{self.total:,}"
            rate_str = f"{rate:.1f} {self.unit}/s"

        eta_str = format_time(eta)
        msg = f"\r{self.prefix} [{bar}] {pct:>5.1f}% | {cur_str}/{tot_str} | {rate_str} | ETA {eta_str}"
        if extra_info:
            msg += f" | {DIM}{extra_info[:25]}{RESET}"

        term_width = shutil.get_terminal_size((80, 20)).columns
        if len(msg) > term_width:
            msg = msg[:term_width]
        sys.stdout.write(msg.ljust(term_width - 1))
        sys.stdout.flush()

    def finish(self, message: str = ""):
        self.current = self.total
        self.update(self.total)
        sys.stdout.write("\n")
        sys.stdout.flush()
        if message:
            print_success(message)

def prompt_input(prompt: str, default: Optional[str] = None, validator=None) -> str:
    while True:
        if default is not None:
            full_prompt = f"{BOLD}{prompt}{RESET} [{CYAN}{default}{RESET}]: "
        else:
            full_prompt = f"{BOLD}{prompt}{RESET}: "
        val = input(full_prompt).strip()
        if not val and default is not None:
            val = default
        if not val:
            print_warning("Input cannot be empty. Please try again.")
            continue
        if validator:
            valid, err = validator(val)
            if not valid:
                print_error(err or "Invalid input. Please try again.")
                continue
        return val

def prompt_confirm(prompt: str, default: bool = True) -> bool:
    hint = "Y/n" if default else "y/N"
    full_prompt = f"{BOLD}{prompt}{RESET} [{CYAN}{hint}{RESET}]: "
    val = input(full_prompt).strip().lower()
    if not val:
        return default
    return val in ['y', 'yes', 'true', '1']

def prompt_choice(prompt: str, options: List[str], default_idx: int = 0) -> int:
    print(f"\n{BOLD}{prompt}{RESET}")
    for idx, opt in enumerate(options):
        prefix = f"{GREEN}●{RESET}" if idx == default_idx else "○"
        print(f"  {prefix} [{CYAN}{idx + 1}{RESET}] {opt}")
    while True:
        choice = input(f"Select option [1-{len(options)}] (default {default_idx + 1}): ").strip()
        if not choice:
            return default_idx
        if choice.isdigit():
            i = int(choice) - 1
            if 0 <= i < len(options):
                return i
        print_warning(f"Please enter a number between 1 and {len(options)}.")
