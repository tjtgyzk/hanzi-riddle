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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS puzzle_meta (
                puzzle_id TEXT PRIMARY KEY,
                author_id INTEGER NOT NULL,
                is_daily INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(author_id) REFERENCES users(id)
            )
            """
        )
        try:
            conn.execute("ALTER TABLE puzzle_meta ADD COLUMN admin_difficulty TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE puzzle_meta ADD COLUMN is_daily INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS puzzle_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                puzzle_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                total_guesses INTEGER NOT NULL DEFAULT 0,
                correct_guesses INTEGER NOT NULL DEFAULT 0,
                first_started_at TEXT NOT NULL,
                last_started_at TEXT NOT NULL,
                UNIQUE(puzzle_id, user_id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        try:
            conn.execute("ALTER TABLE puzzle_attempts ADD COLUMN total_guesses INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE puzzle_attempts ADD COLUMN correct_guesses INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS puzzle_difficulty_votes (
                puzzle_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                difficulty INTEGER NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(puzzle_id, user_id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS daily_checkins (
                user_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                free_hints INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, date),
                FOREIGN KEY(user_id) REFERENCES users(id)
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


def get_leaderboard_between(
    puzzle_id: str, start_iso: str, end_iso: str, limit: int = 10
) -> List[Dict[str, object]]:
    """获取单题在时间范围内的排行榜。"""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT users.nickname, results.guess_count, results.completed_at
            FROM results
            JOIN users ON users.id = results.user_id
            WHERE results.puzzle_id = ? AND results.completed_at >= ? AND results.completed_at < ?
            ORDER BY results.guess_count ASC, results.completed_at ASC
            LIMIT ?
            """,
            (puzzle_id, start_iso, end_iso, limit),
        ).fetchall()
        return [
            {"nickname": row["nickname"], "guess_count": row["guess_count"], "completed_at": row["completed_at"]}
            for row in rows
        ]


def get_completion_count_between(puzzle_id: str, start_iso: str, end_iso: str) -> int:
    """统计时间范围内的通关次数。"""
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS total
            FROM results
            WHERE puzzle_id = ? AND completed_at >= ? AND completed_at < ?
            """,
            (puzzle_id, start_iso, end_iso),
        ).fetchone()
        if not row:
            return 0
        try:
            return int(row["total"])
        except (TypeError, ValueError):
            return 0


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


def get_puzzle_author_id(puzzle_id: str) -> Optional[int]:
    """获取题目作者 id。"""
    with _connect() as conn:
        row = conn.execute(
            "SELECT author_id FROM puzzle_meta WHERE puzzle_id = ?",
            (puzzle_id,),
        ).fetchone()
        if not row:
            return None
        return int(row["author_id"])


def list_puzzle_ids_by_author(author_id: int) -> List[str]:
    """列出指定作者创建的题目 id。"""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT puzzle_id
            FROM puzzle_meta
            WHERE author_id = ?
            ORDER BY updated_at DESC
            """,
            (author_id,),
        ).fetchall()
        return [str(row["puzzle_id"]) for row in rows]


def touch_puzzle_meta(puzzle_id: str, author_id: int) -> None:
    """记录题目作者信息；已存在则仅更新更新时间。"""
    now = _now_iso()
    with _connect() as conn:
        row = conn.execute(
            "SELECT author_id FROM puzzle_meta WHERE puzzle_id = ?",
            (puzzle_id,),
        ).fetchone()
        if row:
            if int(row["author_id"]) != int(author_id):
                return
            conn.execute(
                "UPDATE puzzle_meta SET updated_at = ? WHERE puzzle_id = ?",
                (now, puzzle_id),
            )
            return
        conn.execute(
            """
            INSERT INTO puzzle_meta (puzzle_id, author_id, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            (puzzle_id, author_id, now, now),
        )


def delete_puzzle_meta(puzzle_id: str) -> None:
    """删除题目作者记录。"""
    with _connect() as conn:
        conn.execute("DELETE FROM puzzle_meta WHERE puzzle_id = ?", (puzzle_id,))


def record_puzzle_attempt(user_id: int, puzzle_id: str) -> None:
    """记录一次开局尝试。"""
    now = _now_iso()
    with _connect() as conn:
        row = conn.execute(
            "SELECT attempts FROM puzzle_attempts WHERE puzzle_id = ? AND user_id = ?",
            (puzzle_id, user_id),
        ).fetchone()
        if row:
            attempts = int(row["attempts"]) + 1
            conn.execute(
                """
                UPDATE puzzle_attempts
                SET attempts = ?, last_started_at = ?
                WHERE puzzle_id = ? AND user_id = ?
                """,
                (attempts, now, puzzle_id, user_id),
            )
            return
        conn.execute(
            """
            INSERT INTO puzzle_attempts (puzzle_id, user_id, attempts, first_started_at, last_started_at)
            VALUES (?, ?, 1, ?, ?)
            """,
            (puzzle_id, user_id, now, now),
        )


def record_puzzle_guess(user_id: int, puzzle_id: str, status: str) -> None:
    """记录一次有效猜测的命中情况。"""
    if status not in ("correct", "wrong"):
        return
    now = _now_iso()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT total_guesses, correct_guesses
            FROM puzzle_attempts
            WHERE puzzle_id = ? AND user_id = ?
            """,
            (puzzle_id, user_id),
        ).fetchone()
        if row:
            total = int(row["total_guesses"]) + 1
            correct = int(row["correct_guesses"]) + (1 if status == "correct" else 0)
            conn.execute(
                """
                UPDATE puzzle_attempts
                SET total_guesses = ?, correct_guesses = ?
                WHERE puzzle_id = ? AND user_id = ?
                """,
                (total, correct, puzzle_id, user_id),
            )
            return
        conn.execute(
            """
            INSERT INTO puzzle_attempts
            (puzzle_id, user_id, attempts, total_guesses, correct_guesses, first_started_at, last_started_at)
            VALUES (?, ?, 0, 1, ?, ?, ?)
            """,
            (puzzle_id, user_id, 1 if status == "correct" else 0, now, now),
        )


def get_daily_checkin(user_id: int, date_str: str) -> Optional[Dict[str, int]]:
    """获取用户当天签到信息。"""
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT free_hints FROM daily_checkins
            WHERE user_id = ? AND date = ?
            """,
            (user_id, date_str),
        ).fetchone()
        if not row:
            return None
        try:
            free_hints = int(row["free_hints"])
        except (TypeError, ValueError):
            free_hints = 0
        return {"free_hints": max(0, free_hints)}


def claim_daily_checkin(user_id: int, date_str: str, reward: int = 1) -> Dict[str, int]:
    """签到领取提示卡，已领取则返回原值。"""
    now = _now_iso()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT free_hints FROM daily_checkins
            WHERE user_id = ? AND date = ?
            """,
            (user_id, date_str),
        ).fetchone()
        if row:
            try:
                free_hints = int(row["free_hints"])
            except (TypeError, ValueError):
                free_hints = 0
            return {"free_hints": max(0, free_hints)}
        free_hints = max(0, int(reward))
        conn.execute(
            """
            INSERT INTO daily_checkins (user_id, date, free_hints, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, date_str, free_hints, now),
        )
        return {"free_hints": free_hints}


def consume_daily_hint(user_id: int, date_str: str) -> bool:
    """消费一张提示卡，成功返回 True。"""
    now = _now_iso()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT free_hints FROM daily_checkins
            WHERE user_id = ? AND date = ?
            """,
            (user_id, date_str),
        ).fetchone()
        if not row:
            return False
        try:
            free_hints = int(row["free_hints"])
        except (TypeError, ValueError):
            free_hints = 0
        if free_hints <= 0:
            return False
        conn.execute(
            """
            UPDATE daily_checkins
            SET free_hints = ?, updated_at = ?
            WHERE user_id = ? AND date = ?
            """,
            (free_hints - 1, now, user_id, date_str),
        )
        return True


def set_admin_difficulty(puzzle_id: str, difficulty: Optional[str]) -> None:
    """设置管理员题目难度。"""
    now = _now_iso()
    with _connect() as conn:
        conn.execute(
            """
            UPDATE puzzle_meta
            SET admin_difficulty = ?, updated_at = ?
            WHERE puzzle_id = ?
            """,
            (difficulty, now, puzzle_id),
        )


def set_daily_flag(puzzle_id: str, is_daily: bool) -> None:
    """设置题目是否作为每日题。"""
    now = _now_iso()
    with _connect() as conn:
        conn.execute(
            """
            UPDATE puzzle_meta
            SET is_daily = ?, updated_at = ?
            WHERE puzzle_id = ?
            """,
            (1 if is_daily else 0, now, puzzle_id),
        )


def list_daily_puzzle_ids() -> List[str]:
    """获取所有标记为每日题的题目 id。"""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT puzzle_id FROM puzzle_meta
            WHERE is_daily = 1
            """
        ).fetchall()
        return [str(row["puzzle_id"]) for row in rows]


def list_played_puzzle_ids() -> List[str]:
    """获取曾被游玩过的题目 id（开局或通关）。"""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT puzzle_id FROM puzzle_attempts
            UNION
            SELECT puzzle_id FROM results
            """
        ).fetchall()
        return [str(row["puzzle_id"]) for row in rows]


def list_puzzle_admin_difficulties() -> Dict[str, str]:
    """获取管理员标注的题目难度。"""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT puzzle_id, admin_difficulty
            FROM puzzle_meta
            WHERE admin_difficulty IS NOT NULL AND admin_difficulty != ''
            """
        ).fetchall()
        return {str(row["puzzle_id"]): str(row["admin_difficulty"]) for row in rows}


def upsert_difficulty_vote(user_id: int, puzzle_id: str, difficulty: int) -> None:
    """记录玩家难度评价。"""
    now = _now_iso()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO puzzle_difficulty_votes (puzzle_id, user_id, difficulty, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(puzzle_id, user_id)
            DO UPDATE SET difficulty = excluded.difficulty, updated_at = excluded.updated_at
            """,
            (puzzle_id, user_id, difficulty, now),
        )


def get_difficulty_vote(user_id: int, puzzle_id: str) -> Optional[int]:
    """读取玩家对单题的难度评价。"""
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT difficulty FROM puzzle_difficulty_votes
            WHERE puzzle_id = ? AND user_id = ?
            """,
            (puzzle_id, user_id),
        ).fetchone()
        if not row:
            return None
        try:
            return int(row["difficulty"])
        except (TypeError, ValueError):
            return None


def has_result(user_id: int, puzzle_id: str) -> bool:
    """判断用户是否通关题目。"""
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM results WHERE user_id = ? AND puzzle_id = ?",
            (user_id, puzzle_id),
        ).fetchone()
        return bool(row)


def list_puzzle_difficulty_stats(limit: int = 50) -> List[Dict[str, object]]:
    """获取题目难度排行榜数据。"""
    with _connect() as conn:
        rows = conn.execute(
            """
            WITH attempt_stats AS (
                SELECT
                    puzzle_attempts.puzzle_id AS puzzle_id,
                    COUNT(puzzle_attempts.id) AS started_players,
                    COALESCE(SUM(attempts), 0) AS attempt_count,
                    COALESCE(SUM(total_guesses), 0) AS total_guesses,
                    COALESCE(SUM(correct_guesses), 0) AS correct_guesses
                FROM puzzle_attempts
                GROUP BY puzzle_attempts.puzzle_id
            ),
            result_stats AS (
                SELECT
                    results.puzzle_id AS puzzle_id,
                    COUNT(results.id) AS completion_count,
                    COUNT(DISTINCT results.user_id) AS player_count,
                    AVG(results.guess_count) AS avg_guesses,
                    AVG(
                        (julianday(replace(replace(results.completed_at, 'T', ' '), 'Z', '')) -
                         julianday(replace(replace(pa.first_started_at, 'T', ' '), 'Z', ''))) * 86400
                    ) AS avg_duration
                FROM results
                LEFT JOIN puzzle_attempts pa
                    ON pa.user_id = results.user_id AND pa.puzzle_id = results.puzzle_id
                GROUP BY results.puzzle_id
            ),
            vote_stats AS (
                SELECT
                    puzzle_difficulty_votes.puzzle_id AS puzzle_id,
                    AVG(difficulty) AS avg_difficulty,
                    COUNT(*) AS vote_count
                FROM puzzle_difficulty_votes
                GROUP BY puzzle_difficulty_votes.puzzle_id
            )
            SELECT
                puzzle_meta.puzzle_id AS puzzle_id,
                puzzle_meta.admin_difficulty AS admin_difficulty,
                COALESCE(attempt_stats.started_players, 0) AS started_players,
                COALESCE(attempt_stats.attempt_count, 0) AS attempt_count,
                COALESCE(attempt_stats.total_guesses, 0) AS total_guesses,
                COALESCE(attempt_stats.correct_guesses, 0) AS correct_guesses,
                COALESCE(result_stats.completion_count, 0) AS completion_count,
                COALESCE(result_stats.player_count, 0) AS player_count,
                result_stats.avg_guesses AS avg_guesses,
                result_stats.avg_duration AS avg_duration,
                vote_stats.avg_difficulty AS avg_difficulty,
                COALESCE(vote_stats.vote_count, 0) AS vote_count
            FROM puzzle_meta
            LEFT JOIN attempt_stats ON attempt_stats.puzzle_id = puzzle_meta.puzzle_id
            LEFT JOIN result_stats ON result_stats.puzzle_id = puzzle_meta.puzzle_id
            LEFT JOIN vote_stats ON vote_stats.puzzle_id = puzzle_meta.puzzle_id
            ORDER BY vote_stats.avg_difficulty IS NULL, vote_stats.avg_difficulty DESC, result_stats.avg_guesses DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        output = []
        for row in rows:
            output.append(
                {
                    "puzzle_id": row["puzzle_id"],
                    "admin_difficulty": row["admin_difficulty"],
                    "started_players": row["started_players"],
                    "attempt_count": row["attempt_count"],
                    "total_guesses": row["total_guesses"],
                    "correct_guesses": row["correct_guesses"],
                    "completion_count": row["completion_count"],
                    "player_count": row["player_count"],
                    "avg_guesses": row["avg_guesses"],
                    "avg_duration": row["avg_duration"],
                    "avg_difficulty": row["avg_difficulty"],
                    "vote_count": row["vote_count"],
                }
            )
        return output


def list_overall_leaderboard(limit: int = 50) -> List[Dict[str, object]]:
    """获取玩家总榜数据。"""
    with _connect() as conn:
        rows = conn.execute(
            """
            WITH durations AS (
                SELECT
                    results.user_id AS user_id,
                    results.puzzle_id AS puzzle_id,
                    (julianday(replace(replace(results.completed_at, 'T', ' '), 'Z', '')) -
                     julianday(replace(replace(pa.first_started_at, 'T', ' '), 'Z', ''))) * 86400 AS duration_sec
                FROM results
                LEFT JOIN puzzle_attempts pa
                  ON pa.user_id = results.user_id AND pa.puzzle_id = results.puzzle_id
            )
            SELECT
                users.id AS user_id,
                users.nickname AS nickname,
                COUNT(results.id) AS completion_count,
                AVG(results.guess_count) AS avg_guesses,
                AVG(durations.duration_sec) AS avg_duration,
                COALESCE(SUM(pa.total_guesses), 0) AS total_guesses,
                COALESCE(SUM(pa.correct_guesses), 0) AS correct_guesses
            FROM users
            JOIN results ON results.user_id = users.id
            LEFT JOIN puzzle_attempts pa
              ON pa.user_id = users.id AND pa.puzzle_id = results.puzzle_id
            LEFT JOIN durations ON durations.user_id = results.user_id AND durations.puzzle_id = results.puzzle_id
            GROUP BY users.id, users.nickname
            ORDER BY completion_count DESC, avg_guesses ASC, avg_duration ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        output = []
        for row in rows:
            output.append(
                {
                    "user_id": row["user_id"],
                    "nickname": row["nickname"],
                    "completion_count": row["completion_count"],
                    "avg_guesses": row["avg_guesses"],
                    "avg_duration": row["avg_duration"],
                    "total_guesses": row["total_guesses"],
                    "correct_guesses": row["correct_guesses"],
                }
            )
        return output

def list_author_stats(limit: int = 50) -> List[Dict[str, object]]:
    """出题排行榜数据。"""
    with _connect() as conn:
        rows = conn.execute(
            """
            WITH attempt_stats AS (
                SELECT
                    puzzle_meta.author_id AS author_id,
                    COUNT(puzzle_attempts.id) AS started_players,
                    COALESCE(SUM(puzzle_attempts.attempts), 0) AS attempt_count
                FROM puzzle_meta
                LEFT JOIN puzzle_attempts ON puzzle_attempts.puzzle_id = puzzle_meta.puzzle_id
                GROUP BY puzzle_meta.author_id
            ),
            result_stats AS (
                SELECT
                    puzzle_meta.author_id AS author_id,
                    COUNT(results.id) AS completion_count,
                    COUNT(DISTINCT results.user_id) AS player_count,
                    AVG(results.guess_count) AS avg_guesses,
                    MAX(results.completed_at) AS last_completed
                FROM puzzle_meta
                LEFT JOIN results ON results.puzzle_id = puzzle_meta.puzzle_id
                GROUP BY puzzle_meta.author_id
            )
            SELECT
                users.id AS author_id,
                users.nickname AS author_name,
                COUNT(DISTINCT puzzle_meta.puzzle_id) AS puzzle_count,
                COALESCE(attempt_stats.started_players, 0) AS started_players,
                COALESCE(attempt_stats.attempt_count, 0) AS attempt_count,
                COALESCE(result_stats.completion_count, 0) AS completion_count,
                COALESCE(result_stats.player_count, 0) AS player_count,
                result_stats.avg_guesses AS avg_guesses,
                result_stats.last_completed AS last_completed
            FROM puzzle_meta
            JOIN users ON users.id = puzzle_meta.author_id
            LEFT JOIN attempt_stats ON attempt_stats.author_id = puzzle_meta.author_id
            LEFT JOIN result_stats ON result_stats.author_id = puzzle_meta.author_id
            GROUP BY users.id, users.nickname, attempt_stats.started_players, attempt_stats.attempt_count,
                     result_stats.completion_count, result_stats.player_count, result_stats.avg_guesses,
                     result_stats.last_completed
            ORDER BY puzzle_count DESC, completion_count DESC, avg_guesses IS NULL, avg_guesses ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        output = []
        for row in rows:
            output.append(
                {
                    "author_id": row["author_id"],
                    "author_name": row["author_name"],
                    "puzzle_count": row["puzzle_count"],
                    "started_players": row["started_players"],
                    "attempt_count": row["attempt_count"],
                    "completion_count": row["completion_count"],
                    "player_count": row["player_count"],
                    "avg_guesses": row["avg_guesses"],
                    "last_completed": row["last_completed"],
                }
            )
        return output


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
