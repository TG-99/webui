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
            # Extract data fields
            balance = inner_data.get("balance")
            reading_time = inner_data.get("readingTime")
            monthly_consumption = inner_data.get("currentMonthConsumption")

            # Print nicely formatted output
            print(
                f"✅ Fetched Balance: {balance} Tk\n"
                f"✅ Fetched Reading Time: {reading_time}\n"
                f"✅ Fetched Monthly Consumption: {monthly_consumption} Tk"
            )

            return {
                "balance": balance,
                "readingTime": reading_time,
                "currentMonthConsumption": monthly_consumption
            }
        else:
            print("❌ No balance data found in response.")
            return None

    except Exception as err:
        print(f"❌ Could not fetch data: {err}")
        return None


def telegram_notify(balance, reading_time, monthly_consumption):
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")

    if not token or not chat_id:
        return False, "Telegram not configured (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID)"

    url = f"https://api.telegram.org/bot{token}/sendMessage"

    # Format message neatly
    message = (
        "📢 *DESCO Account Update*\n\n"
        f"💰 *Balance:* {balance} Tk\n"
        f"🕒 *Reading Time:* {reading_time}\n"
        f"⚡ *Monthly Consumption:* {monthly_consumption} Tk\n\n"
        "— DESCO Monitor Bot"
    )

    try:
        r = requests.post(
            url,
            json={
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "Markdown"
            },
            timeout=20
        )

        if r.status_code == 200 and r.json().get("ok"):
            print("✅ Telegram notification sent successfully!")
            return True, "Notification sent"
        else:
            print(f"⚠️ Telegram API error: {r.text}")
            return False, f"Telegram error: {r.text}"

    except Exception as e:
        print(f"❌ Telegram send failed: {e}")
        return False, str(e)


def send_notification(balance, reading_time, monthly_consumption):
    res = telegram_notify(balance, reading_time, monthly_consumption)
    print(res)


def main():
    data = fetch_data()
    if data is not None:
        send_notification(
            data["balance"],
            data["readingTime"],
            data["currentMonthConsumption"]
        )
    else:
        print("⚠️ Skipping Telegram notification due to missing data.")


if __name__ == "__main__":
    while True:
        print("\n⏰ Running DESCO balance check...")
        main()
        print("✅ Done. Sleeping for 24 hours...")
        time.sleep(24 * 60 * 60)  # Sleep for 24 hours (86,400 seconds)
