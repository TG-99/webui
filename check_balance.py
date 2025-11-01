import requests
import os
import time

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


def fetch_data():
    ACCOUNT_NO = os.getenv("ACCOUNT_NO")
    if not ACCOUNT_NO:
        print("⚠️ ACCOUNT_NO environment variable not set.")
        return None

    URL = "https://prepaid.desco.org.bd/api/unified/customer/getBalance"
    params = {'accountNo': ACCOUNT_NO}

    try:
        res = requests.get(url=URL, params=params, verify=False, timeout=30)
        data = res.json()
        inner_data = data.get("data")
        if inner_data is not None:
            balance = inner_data.get("balance")
            print(f"✅ Fetched balance: {balance}")
            return balance
        else:
            print("❌ No balance data found in response.")
            return None
    except Exception as err:
        print(f"Could not fetch data: {err}")
        return None


def telegram_notify(balance):
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return False, "Telegram not configured (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID)"
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        r = requests.post(url, json={
            "chat_id": chat_id,
            "text": f"The current DESCO balance is {balance}"
        }, timeout=20)
        if r.ok:
            return True, "✅ Telegram message sent."
        return False, f"Telegram failed: HTTP {r.status_code} {r.text}"
    except Exception as e:
        return False, f"Telegram failed: {e}"


def send_notification(balance):
    res = telegram_notify(balance)
    print(res)


def main():
    balance = fetch_data()
    if balance is not None:
        send_notification(balance)
    else:
        print("Skipping Telegram notification due to missing balance.")


if __name__ == "__main__":
    while True:
        print("\n⏰ Running DESCO balance check...")
        main()
        print("✅ Done. Sleeping for 24 hours...")
        time.sleep(24 * 60 * 60)  # Sleep for 24 hours (86,400 seconds)
