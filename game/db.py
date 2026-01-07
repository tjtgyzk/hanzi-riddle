# -*- coding: utf-8 -*-

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

DB_FILE = Path(__file__).resolve().parents[1] / "data" / "game.db"


def _now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_FILE))
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """初始化本地 SQLite 数据库（如不存在则创建表）。"""
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nickname TEXT UNIQUE NOT NULL,
                created_at TEXT NOT NULL,
                last_seen TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                user_id INTEGER,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                puzzle_id TEXT NOT NULL,
                guess_count INTEGER NOT NULL,
                completed_at TEXT NOT NULL,
                UNIQUE(user_id, puzzle_id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ai_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                base_url TEXT NOT NULL,
                model TEXT NOT NULL,
                api_key TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )


def upsert_user(nickname: str) -> Dict[str, object]:
    """创建或更新用户，并返回用户信息。"""
    now = _now_iso()
    with _connect() as conn:
        row = conn.execute("SELECT id FROM users WHERE nickname = ?", (nickname,)).fetchone()
        if row:
            conn.execute("UPDATE users SET last_seen = ? WHERE id = ?", (now, row["id"]))
            user_id = row["id"]
        else:
            cursor = conn.execute(
                "INSERT INTO users (nickname, created_at, last_seen) VALUES (?, ?, ?)",
                (nickname, now, now),
            )
            user_id = cursor.lastrowid
    return {"id": user_id, "nickname": nickname}


def bind_session(session_id: str, user_id: int) -> None:
    """将会话绑定到用户。"""
    now = _now_iso()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO sessions (session_id, user_id, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at
            """,
            (session_id, user_id, now),
        )


def get_user_by_session(session_id: str) -> Optional[Dict[str, object]]:
    """通过 session_id 获取用户信息。"""
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT users.id, users.nickname
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.session_id = ?
            """,
            (session_id,),
        ).fetchone()
        if not row:
            return None
        return {"id": row["id"], "nickname": row["nickname"]}


def get_user_id_by_session(session_id: str) -> Optional[int]:
    """通过 session_id 获取用户 id。"""
    with _connect() as conn:
        row = conn.execute(
            "SELECT user_id FROM sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        if not row or row["user_id"] is None:
            return None
        return int(row["user_id"])


def record_result(user_id: int, puzzle_id: str, guess_count: int) -> None:
    """记录成绩（仅在更优成绩时更新）。"""
    now = _now_iso()
    with _connect() as conn:
        row = conn.execute(
            "SELECT guess_count FROM results WHERE user_id = ? AND puzzle_id = ?",
            (user_id, puzzle_id),
        ).fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO results (user_id, puzzle_id, guess_count, completed_at) VALUES (?, ?, ?, ?)",
                (user_id, puzzle_id, guess_count, now),
            )
            return
        if guess_count < row["guess_count"]:
            conn.execute(
                "UPDATE results SET guess_count = ?, completed_at = ? WHERE user_id = ? AND puzzle_id = ?",
                (guess_count, now, user_id, puzzle_id),
            )


def get_leaderboard(puzzle_id: str, limit: int = 10) -> List[Dict[str, object]]:
    """获取单题排行榜。"""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT users.nickname, results.guess_count, results.completed_at
            FROM results
            JOIN users ON users.id = results.user_id
            WHERE results.puzzle_id = ?
            ORDER BY results.guess_count ASC, results.completed_at ASC
            LIMIT ?
            """,
            (puzzle_id, limit),
        ).fetchall()
        return [
            {"nickname": row["nickname"], "guess_count": row["guess_count"], "completed_at": row["completed_at"]}
            for row in rows
        ]


def list_ai_profiles(include_secret: bool = False) -> List[Dict[str, object]]:
    """获取 AI 配置列表。"""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT name, base_url, model, api_key, is_active, updated_at
            FROM ai_profiles
            ORDER BY is_active DESC, updated_at DESC
            """
        ).fetchall()
        output = []
        for row in rows:
            item = {
                "name": row["name"],
                "base_url": row["base_url"],
                "model": row["model"],
                "is_active": bool(row["is_active"]),
            }
            if include_secret:
                item["api_key"] = row["api_key"]
            output.append(item)
        return output


def set_active_ai_profile(name: str) -> None:
    """设置当前启用的 AI 配置。"""
    with _connect() as conn:
        conn.execute("UPDATE ai_profiles SET is_active = 0")
        conn.execute(
            "UPDATE ai_profiles SET is_active = 1, updated_at = ? WHERE name = ?",
            (_now_iso(), name),
        )


def upsert_ai_profile(name: str, base_url: str, model: str, api_key: str, set_active: bool = True) -> None:
    """新增或更新 AI 配置。"""
    now = _now_iso()
    with _connect() as conn:
        row = conn.execute("SELECT id FROM ai_profiles WHERE name = ?", (name,)).fetchone()
        if row:
            conn.execute(
                """
                UPDATE ai_profiles
                SET base_url = ?, model = ?, api_key = ?, updated_at = ?
                WHERE name = ?
                """,
                (base_url, model, api_key, now, name),
            )
        else:
            conn.execute(
                """
                INSERT INTO ai_profiles (name, base_url, model, api_key, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, ?, ?)
                """,
                (name, base_url, model, api_key, now, now),
            )
        if set_active:
            conn.execute("UPDATE ai_profiles SET is_active = 0")
            conn.execute(
                "UPDATE ai_profiles SET is_active = 1, updated_at = ? WHERE name = ?",
                (now, name),
            )


def delete_ai_profile(name: str) -> None:
    """删除 AI 配置。"""
    with _connect() as conn:
        row = conn.execute(
            "SELECT is_active FROM ai_profiles WHERE name = ?",
            (name,),
        ).fetchone()
        conn.execute("DELETE FROM ai_profiles WHERE name = ?", (name,))
        if row and row["is_active"]:
            next_row = conn.execute(
                "SELECT name FROM ai_profiles ORDER BY updated_at DESC LIMIT 1"
            ).fetchone()
            if next_row:
                conn.execute("UPDATE ai_profiles SET is_active = 0")
                conn.execute(
                    "UPDATE ai_profiles SET is_active = 1, updated_at = ? WHERE name = ?",
                    (_now_iso(), next_row["name"]),
                )


def get_active_ai_config() -> Optional[Dict[str, str]]:
    """获取当前启用的 AI 配置。"""
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT name, base_url, model, api_key
            FROM ai_profiles
            WHERE is_active = 1
            LIMIT 1
            """
        ).fetchone()
        if not row:
            return None
        return {
            "name": row["name"],
            "base_url": row["base_url"],
            "model": row["model"],
            "api_key": row["api_key"],
        }


def list_users(limit: int = 100) -> List[Dict[str, object]]:
    """获取用户列表（按最近活跃排序）。"""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, nickname, created_at, last_seen
            FROM users
            ORDER BY last_seen DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [
            {
                "id": row["id"],
                "nickname": row["nickname"],
                "created_at": row["created_at"],
                "last_seen": row["last_seen"],
            }
            for row in rows
        ]


def set_setting(key: str, value: str) -> None:
    """设置全局配置项。"""
    now = _now_iso()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (key, value, now),
        )


def get_setting(key: str) -> Optional[str]:
    """获取全局配置项。"""
    with _connect() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        if not row:
            return None
        return str(row["value"])


def clear_setting(key: str) -> None:
    """删除全局配置项。"""
    with _connect() as conn:
        conn.execute("DELETE FROM settings WHERE key = ?", (key,))
