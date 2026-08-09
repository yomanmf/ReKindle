#!/usr/bin/env python3
from __future__ import annotations

import concurrent.futures
import json
import os
import sqlite3
import subprocess
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Target:
    name: str
    host: str
    command: str


TARGETS = (
    Target(
        "Manga Kindle",
        os.getenv("MANGA_E2E_HOST", "103.76.52.249"),
        "container=$(sudo -n docker ps -q --filter label=com.docker.compose.service=manga-bot-worker | head -n1); "
        "test -n \"$container\"; sudo -n docker exec \"$container\" node src/e2e.mjs",
    ),
    Target(
        "Books Kindle",
        os.getenv("BOOKS_E2E_HOST", "10.42.0.6"),
        "sudo -n docker exec flibusta-kindle-bot flibusta-kindle-e2e",
    ),
    Target(
        "Digest",
        os.getenv("DIGEST_E2E_HOST", "10.42.0.32"),
        "sudo -n docker exec telegram-articles-kindle-bot node dist/src/e2e.js",
    ),
)


def parse_result(output: str) -> dict[str, object]:
    for line in reversed(output.splitlines()):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and value.get("ok") is True:
            return value
    raise ValueError("E2E did not return a successful JSON result")


def run_target(target: Target) -> tuple[Target, dict[str, object] | None, str | None]:
    key = os.getenv("E2E_SSH_KEY", "/root/.ssh/vmwatch_deployer")
    user = os.getenv("E2E_SSH_USER", "vmwatch")
    try:
        completed = subprocess.run(
            [
                "ssh",
                "-i", key,
                "-o", "BatchMode=yes",
                "-o", "ConnectTimeout=15",
                "-o", "IdentitiesOnly=yes",
                "-o", "StrictHostKeyChecking=accept-new",
                f"{user}@{target.host}",
                target.command,
            ],
            capture_output=True,
            text=True,
            timeout=30 * 60,
            check=False,
        )
        if completed.returncode == 0:
            return target, parse_result(completed.stdout), None
        detail = (completed.stderr or completed.stdout).strip().splitlines()
        return target, None, (detail[-1] if detail else f"exit {completed.returncode}")[:300]
    except (OSError, subprocess.TimeoutExpired, ValueError) as error:
        return target, None, str(error)[:300]


def format_report(results: list[tuple[Target, dict[str, object] | None, str | None]]) -> str:
    timestamp = datetime.now(ZoneInfo("Europe/Moscow")).strftime("%d.%m.%Y %H:%M MSK")
    lines = [f"Kindle E2E - {timestamp}"]
    for target, result, error in results:
        if error:
            lines.append(f"FAIL {target.name}: {error}")
            continue
        assert result is not None
        count = result.get("articles") or result.get("chapter") or result.get("format") or "готово"
        size = int(result.get("sizeBytes") or result.get("messageSizeBytes") or 0)
        lines.append(f"OK {target.name}: {count}, {size / 1_000_000:.1f} MB")
    lines.append("Отправка на Kindle: пропущена во всех сценариях.")
    return "\n".join(lines)


def subscribers() -> list[int]:
    database = os.getenv("DB_PATH", "/var/lib/vmwatch/state.db")
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
        return [int(row[0]) for row in connection.execute("SELECT chat_id FROM subscribers")]


def notify(text: str) -> None:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    for chat_id in subscribers():
        request = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode(),
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            if json.load(response).get("ok") is not True:
                raise RuntimeError("Telegram rejected the E2E report")


def main() -> int:
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(TARGETS)) as executor:
        results = list(executor.map(run_target, TARGETS))
    notify(format_report(results))
    return 1 if any(error for _, _, error in results) else 0


if __name__ == "__main__":
    sys.exit(main())
