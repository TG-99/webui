import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import time
import requests
import threading
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from db import users_col, todos_col, settings_col

# Load env
load_dotenv()

# Timezone offset for Telegram messages (configurable via env, default UTC+6 for BST)
TZ_OFFSET_HOURS = int(os.getenv("TZ_OFFSET_HOURS", "6"))
TZ_LABEL = os.getenv("TZ_LABEL", "BST")

def utc_now() -> datetime:
    """Returns current UTC time as a naive datetime (for MongoDB compatibility)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)

def get_telegram_bot_token():
    """Retrieves the bot token from DB settings or falls back to env variable."""
    try:
        token_setting = settings_col.find_one({"key": "telegram_bot_token"})
        if token_setting and token_setting.get("value"):
            return token_setting["value"]
    except Exception as e:
        print(f"Error fetching bot token from settings: {e}")
    return os.getenv("TELEGRAM_BOT_TOKEN", "")

def send_telegram_message(token, chat_id, text):
    """Sends a Telegram HTML message to the specified chat ID."""
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }
    try:
        response = requests.post(url, json=payload, timeout=10)
        if response.status_code == 200:
            return True
        else:
            print(f"Telegram API Error: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        print(f"Failed to send Telegram message: {e}")
        return False

def check_and_notify_todos():
    """Main check iteration to find todos that need notifications sent."""
    global_bot_token = get_telegram_bot_token()
    now = utc_now()
    
    try:
        # Find all incomplete todos
        incomplete_todos = list(todos_col.find({"completed": False}))
        
        if not incomplete_todos:
            return
        
        # Batch-load all users who own these todos (fixes N+1 query)
        user_ids = list(set(todo["user_id"] for todo in incomplete_todos))
        users_list = list(users_col.find({"_id": {"$in": user_ids}}))
        users_map = {u["_id"]: u for u in users_list}
        
        for todo in incomplete_todos:
            user = users_map.get(todo["user_id"])
            if not user or not user.get("telegram_chat_id"):
                continue

            chat_id = user["telegram_chat_id"]
            bot_token = user.get("telegram_bot_token") or global_bot_token
            if not bot_token:
                continue
            deadline = todo.get("deadline")
            
            # If no deadline, skip notifications
            if not deadline:
                continue

            # Ensure deadline is datetime object
            if isinstance(deadline, str):
                try:
                    deadline = datetime.fromisoformat(deadline.replace("Z", "+00:00")).replace(tzinfo=None)
                except ValueError:
                    continue

            # Check if overdue or within 24 hours of deadline
            is_overdue = now > deadline
            is_approaching = (deadline - now) <= timedelta(hours=24) and now < deadline

            # Determine dynamic notification interval:
            # - If the task is overdue or the deadline is less than 24 hours away, 
            #   manual overrides are strictly disallowed. We force the escalation path:
            #   * Overdue: 1 min
            #   * Before 1 hour: 1 min
            #   * Before 2 hours: 5 mins
            #   * Before 6 hours: 30 mins
            #   * Before 24 hours: 1 hour (60 mins)
            # - Otherwise (more than 24 hours remaining), we allow and respect the user's manual setting.
            if is_overdue:
                # Overdue: force 1m alerts, but respect if user set an even faster interval
                user_interval = todo.get("notification_interval", 60)
                interval_mins = min(user_interval, 1)
            else:
                time_remaining = deadline - now
                if time_remaining <= timedelta(hours=24):
                    # Less than 24 hours from deadline: force automatic escalation path
                    auto_interval = 60
                    if time_remaining <= timedelta(hours=1):
                        auto_interval = 1
                    elif time_remaining <= timedelta(hours=2):
                        auto_interval = 5
                    elif time_remaining <= timedelta(hours=6):
                        auto_interval = 30
                    
                    # Take the minimum (most urgent) between user manual interval and auto-escalation interval
                    user_interval = todo.get("notification_interval", 60)
                    interval_mins = min(user_interval, auto_interval)
                else:
                    # More than 24 hours from deadline: respect manual setting
                    interval_mins = todo.get("notification_interval", 60)

            last_notified = todo.get("last_notified_at")

            if last_notified:
                if isinstance(last_notified, str):
                    try:
                        last_notified = datetime.fromisoformat(last_notified.replace("Z", "+00:00")).replace(tzinfo=None)
                    except ValueError:
                        last_notified = None

            should_notify = False
            if not last_notified:
                should_notify = True
            else:
                elapsed_mins = (now - last_notified).total_seconds() / 60
                if elapsed_mins >= interval_mins:
                    should_notify = True

            if should_notify:
                # Construct HTML formatted Telegram message
                priority_emoji = "🔴" if todo.get("priority") == "high" else ("🟡" if todo.get("priority") == "medium" else "🟢")
                status_header = "🚨 <b>OVERDUE TASK WARNING!</b>" if is_overdue else "⏰ <b>UPCOMING TASK REMINDER</b>"
                
                # Convert UTC deadline to configured timezone
                local_deadline = deadline + timedelta(hours=TZ_OFFSET_HOURS)
                deadline_str = local_deadline.strftime(f"%Y-%m-%d %H:%M {TZ_LABEL}")
                
                message = (
                    f"{status_header}\n\n"
                    f"📝 <b>Task:</b> {todo.get('title')}\n"
                    f"📝 <b>Description:</b> {todo.get('description', 'No description')}\n"
                    f"⚡ <b>Priority:</b> {priority_emoji} {todo.get('priority', 'medium').capitalize()}\n"
                    f"📅 <b>Deadline:</b> <code>{deadline_str}</code>\n\n"
                    f"⚠️ This task is incomplete! You will receive continuous notifications "
                    f"every {interval_mins} minute(s) until it is completed.\n\n"
                    f"👉 Please log in to complete this task and stop notifications."
                )

                print(f"Sending telegram notification for task '{todo.get('title')}' to user '{user.get('username')}'")
                success = send_telegram_message(bot_token, chat_id, message)
                if success:
                    # Update database with last notified timestamp
                    todos_col.update_one(
                        {"_id": todo["_id"]},
                        {"$set": {"last_notified_at": now}}
                    )

    except Exception as e:
        print(f"Error in scheduler check loop: {e}")

def start_scheduler_thread():
    """Starts the background scheduler loop in a daemon thread."""
    def scheduler_loop():
        print("Telegram notifications background scheduler started...")
        while True:
            try:
                check_and_notify_todos()
            except Exception as e:
                print(f"Exception in scheduler thread loop: {e}")
            time.sleep(60) # check every 60 seconds

    thread = threading.Thread(target=scheduler_loop, daemon=True)
    thread.start()
    return thread
