#!/usr/bin/env python3
import smtplib
import ssl
import sys
from email.message import EmailMessage
from pathlib import Path


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key.strip()] = value
    return values


if len(sys.argv) != 5:
    raise SystemExit("Usage: send-alert.py <app.env> <recipient> <subject> <body-file>")

env = load_env(Path(sys.argv[1]))
recipient = sys.argv[2]
subject = sys.argv[3]
body = Path(sys.argv[4]).read_text(encoding="utf-8")

host = env.get("SMTP_HOST", "")
port = int(env.get("SMTP_PORT", "587") or "587")
username = env.get("SMTP_USER", "")
password = env.get("SMTP_PASS", "")
sender = env.get("SMTP_FROM", "")
if not host or not sender or not recipient:
    raise SystemExit("SMTP_HOST, SMTP_FROM, and recipient are required for alerts")

message = EmailMessage()
message["From"] = sender
message["To"] = recipient
message["Subject"] = subject
message.set_content(body)

context = ssl.create_default_context()
if port == 465:
    with smtplib.SMTP_SSL(host, port, timeout=20, context=context) as client:
        if username:
            client.login(username, password)
        client.send_message(message)
else:
    with smtplib.SMTP(host, port, timeout=20) as client:
        client.ehlo()
        client.starttls(context=context)
        client.ehlo()
        if username:
            client.login(username, password)
        client.send_message(message)
