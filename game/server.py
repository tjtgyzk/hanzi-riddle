# -*- coding: utf-8 -*-

import argparse
import json
import os
import time
import hashlib
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Optional, Dict, List

from .engine import Game
from .ai_client import AIClient
from .db import (
    init_db,
    upsert_user,
    bind_session,
    get_user_by_session,
    get_user_id_by_session,
    record_result,
    get_leaderboard,
    get_leaderboard_between,
    get_completion_count_between,
    list_ai_profiles,
    upsert_ai_profile,
    delete_ai_profile,
    set_active_ai_profile,
    get_active_ai_config,
    set_setting,
    get_setting,
    clear_setting,
    list_users,
    get_puzzle_author_id,
    list_puzzle_ids_by_author,
    touch_puzzle_meta,
    delete_puzzle_meta,
    list_author_stats,
    record_puzzle_attempt,
    record_puzzle_guess,
    set_admin_difficulty,
    list_puzzle_admin_difficulties,
    set_daily_flag,
    list_daily_puzzle_ids,
    list_played_puzzle_ids,
    upsert_difficulty_vote,
    get_difficulty_vote,
    has_result,
    list_puzzle_difficulty_stats,
    list_overall_leaderboard,
    claim_daily_checkin,
    get_daily_checkin,
    consume_daily_hint,
)
from .puzzles import PUZZLE_DIR, load_puzzles

# 静态资源目录（前端页面）
WEB_DIR = Path(__file__).resolve().parents[1] / "web"
# 进度存档文件（按 session_id 保存）
SESSION_FILE = Path(__file__).resolve().parents[1] / "data" / "sessions.json"


class ChineseArgumentParser(argparse.ArgumentParser):
    """将 argparse 的默认英文提示替换为中文。"""

    def format_usage(self) -> str:
        return super().format_usage().replace("usage:", "用法:")

    def format_help(self) -> str:
        text = super().format_help()
        text = text.replace("usage:", "用法:")
        text = text.replace("optional arguments:", "可选参数:")
        text = text.replace("options:", "选项:")
        return text


def _choose_puzzle(puzzles: list, puzzle_id: Optional[str]) -> dict:
    """按 id 选择题目；不传 id 时默认第一个。"""
    if puzzle_id is None:
        return puzzles[0]
    for puzzle in puzzles:
        if puzzle.get("id") == puzzle_id:
            return puzzle
    raise ValueError(f"题目不存在: {puzzle_id}")


class GameStore:
    """当前游戏会话（单人本地试玩，支持多题目进度保存）。"""

    def __init__(self) -> None:
        # 所有题目的游戏实例（用于历史与进度）
        self.games: Dict[str, Game] = {}
        # 当前激活的题目 id
        self.current_id: Optional[str] = None
        # 每道题的 AI 上一步结果
        self.last_ai: Dict[str, dict] = {}

    def start(self, puzzle_id: Optional[str], mode: str) -> dict:
        """开始或恢复一局游戏。mode: resume/restart"""
        puzzles = load_puzzles(PUZZLE_DIR)
        puzzle = _choose_puzzle(puzzles, puzzle_id)
        puzzle_id = puzzle["id"]

        if mode == "resume" and puzzle_id in self.games:
            self.current_id = puzzle_id
            return self.games[puzzle_id].get_state()

        if mode not in ("resume", "restart"):
            raise ValueError("启动模式不支持，请使用 resume 或 restart。")

        game = Game(title=puzzle["title"], body=puzzle["body"], puzzle_id=puzzle_id)
        self.games[puzzle_id] = game
        self.current_id = puzzle_id
        self.last_ai.pop(puzzle_id, None)
        return game.get_state()

    def get_state(self) -> Optional[dict]:
        if self.current_id is None:
            return None
        game = self.games.get(self.current_id)
        if game is None:
            return None
        return game.get_state()

    def guess(self, ch: str) -> dict:
        if self.current_id is None:
            raise RuntimeError("当前没有进行中的游戏，请先开始游戏。")
        game = self.games.get(self.current_id)
        if game is None:
            raise RuntimeError("当前游戏状态已丢失，请重新开始。")
        result = game.guess(ch)
        return {"status": result.status, "reason": result.reason, "state": result.state}

    def list_puzzles(self, puzzles: List[dict]) -> List[dict]:
        """为题目列表附加进度状态。"""
        output = []
        for index, puzzle in enumerate(puzzles, start=1):
            puzzle_id = puzzle["id"]
            game = self.games.get(puzzle_id)
            if game is None:
                status = "未开始"
                guess_count = 0
                is_complete = False
            else:
                is_complete = game.is_complete()
                status = "已完成" if is_complete else "进行中"
                guess_count = game.guess_count
            output.append(
                {
                    "id": puzzle_id,
                    "index": index,
                    "status": status,
                    "guess_count": guess_count,
                    "is_complete": is_complete,
                    "is_current": puzzle_id == self.current_id,
                    "title": puzzle.get("title", ""),
                    "created_at": puzzle.get("created_at", ""),
                }
            )
        return output

    def ai_step(self, ai_config: Optional[dict]) -> dict:
        """执行一步最短解（使用标题字符的最短序列）。"""
        if self.current_id is None:
            raise RuntimeError("当前没有进行中的游戏，请先开始游戏。")
        game = self.games.get(self.current_id)
        if game is None:
            raise RuntimeError("当前游戏状态已丢失，请重新开始。")

        if game.is_complete():
            return {"done": True, "state": game.get_state()}

        previous_step = self.last_ai.get(self.current_id)
        client = AIClient(ai_config)
        attempts = 0
        last_reason = "未提供原因。"
        last_result = None
        last_guess = ""
        state = game.get_state()
        guessed_correct = set(state.get("guessed_correct", []) or [])
        guessed_wrong = set(state.get("guessed_wrong", []) or [])
        forbidden = guessed_correct | guessed_wrong

        while attempts < 3:
            attempts += 1
            ai_output = client.choose_next_guess(state, previous_step)
            next_char = str(ai_output.get("guess", "")).strip()
            reason = str(ai_output.get("reason", "")).strip() or "未提供原因。"
            if not next_char or len(next_char) != 1:
                previous_step = {"status": "invalid", "guess": next_char}
                last_reason = reason
                continue
            if next_char in forbidden:
                previous_step = {"status": "repeat", "guess": next_char}
                last_reason = reason
                continue
            result = game.guess(next_char)
            last_result = result
            last_reason = reason
            last_guess = next_char
            break

        if last_result is None:
            raise RuntimeError("AI 多次输出重复或非法字符，请稍后重试。")

        self.last_ai[self.current_id] = {
            "guess": last_guess,
            "reason": last_reason,
            "status": last_result.status,
        }
        return {
            "done": False,
            "guess": last_guess,
            "reason": last_reason,
            "result": {"status": last_result.status, "reason": last_result.reason, "state": last_result.state},
        }

    def use_hint(self, free: bool = False) -> dict:
        """揭示一个标题字符并返回结果。"""
        if self.current_id is None:
            raise RuntimeError("当前没有进行中的游戏，请先开始游戏。")
        game = self.games.get(self.current_id)
        if game is None:
            raise RuntimeError("当前游戏状态已丢失，请重新开始。")
        return game.reveal_hint(free=free)

    def to_persist_dict(self) -> dict:
        """导出当前会话的持久化数据。"""
        return {
            "current_id": self.current_id,
            "games": {puzzle_id: game.export_progress() for puzzle_id, game in self.games.items()},
        }

    def load_from_persist(self, data: dict, puzzle_map: Dict[str, dict]) -> None:
        """根据持久化数据恢复会话内的题目进度。"""
        self.current_id = data.get("current_id")
        games_data = data.get("games", {})
        for puzzle_id, progress in games_data.items():
            puzzle = puzzle_map.get(puzzle_id)
            if not puzzle:
                continue
            game = Game(title=puzzle["title"], body=puzzle["body"], puzzle_id=puzzle_id)
            game.apply_progress(progress)
            self.games[puzzle_id] = game


class SessionManager:
    """多用户会话管理：按 user_id 区分游戏进度。"""

    def __init__(self, storage_path: Path) -> None:
        self.storage_path = storage_path
        self.user_stores: Dict[str, GameStore] = {}
        self._load_from_disk()

    def _load_from_disk(self) -> None:
        """加载历史存档到内存。"""
        if not self.storage_path.exists():
            return
        try:
            raw = self.storage_path.read_text(encoding="utf-8")
            data = json.loads(raw) if raw.strip() else {}
        except Exception:
            return

        try:
            puzzles = load_puzzles(PUZZLE_DIR)
        except Exception:
            puzzles = []
        puzzle_map = {puzzle["id"]: puzzle for puzzle in puzzles}

        users_data = data.get("users")
        if isinstance(users_data, dict) and users_data:
            for user_id, session_data in users_data.items():
                store = GameStore()
                store.load_from_persist(session_data, puzzle_map)
                self.user_stores[str(user_id)] = store
            return

        for session_id, session_data in data.get("sessions", {}).items():
            user_id = get_user_id_by_session(session_id)
            if not user_id:
                continue
            user_key = str(user_id)
            if user_key in self.user_stores:
                continue
            store = GameStore()
            store.load_from_persist(session_data, puzzle_map)
            self.user_stores[user_key] = store

    def save(self) -> None:
        """将当前内存状态写回磁盘。"""
        data = {"users": {}}
        for user_id, store in self.user_stores.items():
            data["users"][str(user_id)] = store.to_persist_dict()
        _write_json_file(self.storage_path, data)

    def get_store_for_user(self, user_id: int) -> GameStore:
        """获取指定用户的存档实例，不存在则创建。"""
        user_key = str(user_id)
        store = self.user_stores.get(user_key)
        if store is None:
            store = GameStore()
            self.user_stores[user_key] = store
        return store

    def remove_puzzle(self, puzzle_id: str) -> None:
        """当题目被覆盖时，移除所有会话中的旧进度。"""
        changed = False
        for store in self.user_stores.values():
            if puzzle_id in store.games:
                store.games.pop(puzzle_id, None)
                if store.current_id == puzzle_id:
                    store.current_id = None
                changed = True
        if changed:
            self.save()


def _is_safe_filename_char(ch: str) -> bool:
    """允许的文件名字符：字母数字、下划线、短横线、汉字。"""
    if ch.isalnum():
        return True
    if ch in ("_", "-"):
        return True
    return "\u4e00" <= ch <= "\u9fff"


def _sanitize_puzzle_id(raw: str) -> Optional[str]:
    """清理题目 id，避免路径注入。"""
    if not raw:
        return None
    cleaned = "".join(ch for ch in raw if _is_safe_filename_char(ch))
    return cleaned or None


def _validate_puzzle_id(raw: str) -> Optional[str]:
    """校验题目 id 是否安全合法。"""
    raw = (raw or "").strip()
    if not raw:
        return None
    cleaned = _sanitize_puzzle_id(raw)
    if not cleaned or cleaned != raw:
        return None
    return cleaned


def _create_puzzle_file(puzzle_id: Optional[str], title: str, body: str, overwrite: bool) -> dict:
    """创建题目文件并返回题目元信息。"""
    if not title or not title.strip():
        raise ValueError("标题不能为空。")
    safe_id = _sanitize_puzzle_id(puzzle_id or "")
    if not safe_id:
        safe_id = f"puzzle_{int(time.time())}"
    file_path = PUZZLE_DIR / f"{safe_id}.txt"
    existed = file_path.exists()
    if existed and not overwrite:
        raise ValueError("题目文件已存在，请更换文件名或勾选覆盖。")

    PUZZLE_DIR.mkdir(parents=True, exist_ok=True)
    content = title.strip() + "\n" + (body or "").rstrip() + "\n"
    file_path.write_text(content, encoding="utf-8")
    return {"id": safe_id, "title": title.strip(), "body": body or "", "overwrote": existed}


def _write_json_file(path: Path, data: dict) -> None:
    """安全写入 JSON 文件，避免中途写坏。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    content = json.dumps(data, ensure_ascii=False, indent=2)
    tmp_path.write_text(content, encoding="utf-8")
    tmp_path.replace(path)


def _safe_ai_config_info(ai_config: Optional[dict]) -> str:
    """输出可用于排查的 AI 配置信息（不包含密钥）。"""
    if not isinstance(ai_config, dict):
        return "AI 配置为空"
    base_url = ai_config.get("base_url", "")
    model = ai_config.get("model", "")
    return f"base_url={base_url} model={model}"


def _get_admin_password() -> str:
    return os.environ.get("ADMIN_PASSWORD", "") or "admin"


def _is_admin_token(token: str) -> bool:
    password = _get_admin_password()
    if not password:
        return False
    return token == password


def _get_ai_access_code() -> str:
    return get_setting("ai_access_code") or ""


def _is_default_admin_user(user: Optional[Dict[str, object]]) -> bool:
    if not isinstance(user, dict):
        return False
    return str(user.get("nickname", "")) == "Admin"


def _today_local_str() -> str:
    now = datetime.utcnow() + timedelta(hours=8)
    return now.strftime("%Y-%m-%d")


def _pick_daily_puzzle_id(puzzles: List[dict], date_str: str) -> str:
    if not puzzles:
        raise ValueError("题库为空，无法生成每日挑战。")
    seed = int(hashlib.md5(date_str.encode("utf-8")).hexdigest(), 16)
    index = seed % len(puzzles)
    return puzzles[index]["id"]


def _load_daily_history() -> List[Dict[str, str]]:
    raw = get_setting("daily_puzzle_history") or "[]"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    history = []
    for item in data:
        if isinstance(item, dict):
            puzzle_id = str(item.get("puzzle_id", "")).strip()
            date_str = str(item.get("date", "")).strip()
            if puzzle_id:
                history.append({"puzzle_id": puzzle_id, "date": date_str})
        else:
            puzzle_id = str(item).strip()
            if puzzle_id:
                history.append({"puzzle_id": puzzle_id, "date": ""})
    return history


def _save_daily_history(history: List[Dict[str, str]]) -> None:
    set_setting("daily_puzzle_history", json.dumps(history, ensure_ascii=False))


def _daily_pool_ids(puzzles: List[dict]) -> List[str]:
    puzzle_ids = [puzzle["id"] for puzzle in puzzles if puzzle.get("id")]
    daily_ids = set(list_daily_puzzle_ids())
    pool = set(daily_ids) if daily_ids else set(puzzle_ids)
    if get_setting("daily_auto_unplayed") == "1":
        played = set(list_played_puzzle_ids())
        unplayed = {pid for pid in puzzle_ids if pid not in played}
        pool |= unplayed
    return [pid for pid in puzzle_ids if pid in pool]


def _demote_daily_if_played(puzzle_id: str) -> None:
    if not puzzle_id:
        return
    daily_ids = set(list_daily_puzzle_ids())
    if puzzle_id in daily_ids:
        set_daily_flag(puzzle_id, False)


def _get_daily_puzzle_id(puzzles: List[dict]) -> Dict[str, str]:
    date_str = _today_local_str()
    stored_date = get_setting("daily_puzzle_date")
    stored_id = get_setting("daily_puzzle_id")
    puzzle_ids = {puzzle.get("id") for puzzle in puzzles if puzzle.get("id")}
    if stored_date == date_str and stored_id:
        if stored_id in puzzle_ids:
            return {"date": date_str, "puzzle_id": stored_id}

    pool_ids = _daily_pool_ids(puzzles)
    if not pool_ids:
        raise ValueError("每日题库为空，请管理员补充每日题。")

    history = _load_daily_history()
    used_ids = {item.get("puzzle_id") for item in history if item.get("puzzle_id")}
    unused = [pid for pid in pool_ids if pid not in used_ids]
    if not unused:
        raise ValueError("每日题已用尽，请管理员补充每日题。")
    seed = int(hashlib.md5(date_str.encode("utf-8")).hexdigest(), 16)
    puzzle_id = unused[seed % len(unused)]
    history = [item for item in history if item.get("date") != date_str]
    history.append({"date": date_str, "puzzle_id": puzzle_id})
    _save_daily_history(history)
    if puzzle_id in set(list_daily_puzzle_ids()):
        set_daily_flag(puzzle_id, False)
    set_setting("daily_puzzle_date", date_str)
    set_setting("daily_puzzle_id", puzzle_id)
    return {"date": date_str, "puzzle_id": puzzle_id}


def _local_day_range_utc(date_str: str) -> Dict[str, str]:
    local_date = datetime.strptime(date_str, "%Y-%m-%d")
    start_local = datetime(local_date.year, local_date.month, local_date.day)
    start_utc = start_local - timedelta(hours=8)
    end_utc = start_utc + timedelta(days=1)
    return {
        "start": start_utc.isoformat(timespec="seconds") + "Z",
        "end": end_utc.isoformat(timespec="seconds") + "Z",
    }


def _daily_history_map() -> Dict[str, str]:
    history = _load_daily_history()
    mapping = {}
    for item in history:
        date_str = item.get("date", "")
        puzzle_id = item.get("puzzle_id", "")
        if date_str and puzzle_id:
            mapping[date_str] = puzzle_id
    return mapping


init_db()
SESSION_MANAGER = SessionManager(SESSION_FILE)


class RequestHandler(BaseHTTPRequestHandler):
    """简单的本地 HTTP 服务：提供静态页面与 JSON 接口。"""

    def _send_json(self, payload: dict, status_code: int = 200) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, file_path: Path, content_type: str) -> None:
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        if not raw.strip():
            return {}
        return json.loads(raw)

    def _get_session_id(self) -> Optional[str]:
        """从请求头读取 session_id。"""
        raw = self.headers.get("X-Session-Id", "")
        if not raw:
            return None
        cleaned = "".join(ch for ch in raw if ch.isalnum() or ch in ("-", "_"))
        return cleaned or None

    def _require_session_id(self) -> Optional[str]:
        """确保请求携带有效的 session_id。"""
        session_id = self._get_session_id()
        if not session_id:
            self._send_json({"ok": False, "message": "缺少会话编号，请刷新页面重试。"}, status_code=400)
            return None
        return session_id

    def _get_admin_token(self) -> str:
        return self.headers.get("X-Admin-Token", "")

    def _require_admin(self) -> bool:
        if not _get_admin_password():
            self._send_json({"ok": False, "message": "管理员密码未设置。"}, status_code=401)
            return False
        token = self._get_admin_token()
        if not token or not _is_admin_token(token):
            self._send_json({"ok": False, "message": "管理员验证失败。"}, status_code=401)
            return False
        return True

    def _require_user(self) -> Optional[Dict[str, object]]:
        session_id = self._require_session_id()
        if not session_id:
            return None
        user = get_user_by_session(session_id)
        if not user:
            self._send_json({"ok": False, "message": "请先登录，再开始游戏。"}, status_code=401)
            return None
        return user

    def _require_admin_user(self) -> Optional[Dict[str, object]]:
        session_id = self._require_session_id()
        if not session_id:
            return None
        user = get_user_by_session(session_id)
        if not user:
            self._send_json({"ok": False, "message": "请先在游戏页面登录昵称。"}, status_code=401)
            return None
        return user

    def _require_ai_access(self) -> bool:
        access_code = _get_ai_access_code()
        if not access_code:
            self._send_json({"ok": False, "message": "AI 访问码未配置，请联系管理员。"}, status_code=403)
            return False
        provided = self.headers.get("X-AI-Access-Code", "").strip()
        if not provided or provided != access_code:
            self._send_json({"ok": False, "message": "AI 访问码无效。"}, status_code=403)
            return False
        return True

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        # 静态资源路由
        if path == "/":
            return self._send_file(WEB_DIR / "index.html", "text/html; charset=utf-8")
        if path in ("/admin", "/admin/"):
            return self._send_file(WEB_DIR / "admin.html", "text/html; charset=utf-8")
        if path == "/style.css":
            return self._send_file(WEB_DIR / "style.css", "text/css; charset=utf-8")
        if path == "/app.js":
            return self._send_file(WEB_DIR / "app.js", "application/javascript; charset=utf-8")
        if path == "/admin.js":
            return self._send_file(WEB_DIR / "admin.js", "application/javascript; charset=utf-8")

        # JSON 接口
        if path == "/api/puzzles":
            try:
                session_id = self._require_session_id()
                if not session_id:
                    return None
                puzzles = load_puzzles(PUZZLE_DIR)
                user = get_user_by_session(session_id)
                if user:
                    store = SESSION_MANAGER.get_store_for_user(int(user["id"]))
                else:
                    store = GameStore()
                data = store.list_puzzles(puzzles)
                return self._send_json({"ok": True, "puzzles": data})
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=500)

        if path == "/api/state":
            user = self._require_user()
            if not user:
                return None
            store = SESSION_MANAGER.get_store_for_user(int(user["id"]))
            return self._send_json({"ok": True, "state": store.get_state()})

        if path == "/api/me":
            session_id = self._require_session_id()
            if not session_id:
                return None
            user = get_user_by_session(session_id)
            return self._send_json({"ok": True, "user": user})

        if path == "/api/checkin":
            user = self._require_user()
            if not user:
                return None
            date_str = _today_local_str()
            info = get_daily_checkin(int(user["id"]), date_str)
            if not info:
                return self._send_json({"ok": True, "date": date_str, "claimed": False, "free_hints": 0})
            return self._send_json(
                {
                    "ok": True,
                    "date": date_str,
                    "claimed": True,
                    "free_hints": info.get("free_hints", 0),
                }
            )

        if path == "/api/admin/check":
            if not _get_admin_password():
                return self._send_json({"ok": False, "message": "管理员密码未设置。"}, status_code=401)
            token = self._get_admin_token()
            if token and _is_admin_token(token):
                return self._send_json({"ok": True})
            return self._send_json({"ok": False, "message": "管理员验证失败。"}, status_code=401)

        if path == "/api/admin/ai/profiles":
            if not self._require_admin():
                return None
            profiles = list_ai_profiles(include_secret=True)
            return self._send_json({"ok": True, "profiles": profiles})

        if path == "/api/admin/ai/access":
            if not self._require_admin():
                return None
            access_code = _get_ai_access_code()
            if not access_code:
                return self._send_json({"ok": True, "configured": False})
            return self._send_json(
                {"ok": True, "configured": True, "length": len(access_code), "access_code": access_code}
            )

        if path == "/api/admin/puzzles":
            if not self._require_admin():
                return None
            user = self._require_admin_user()
            if not user:
                return None
            owned_ids = set(list_puzzle_ids_by_author(int(user["id"])))
            admin_difficulties = list_puzzle_admin_difficulties()
            daily_pool = set(list_daily_puzzle_ids())
            played_ids = set(list_played_puzzle_ids())
            demote_ids = daily_pool & played_ids
            if demote_ids:
                for puzzle_id in demote_ids:
                    set_daily_flag(puzzle_id, False)
                daily_pool -= demote_ids
            puzzles = load_puzzles(PUZZLE_DIR)
            data = []
            for puzzle in puzzles:
                puzzle_id = puzzle.get("id")
                if puzzle_id not in owned_ids:
                    if not _is_default_admin_user(user):
                        continue
                    author_id = get_puzzle_author_id(str(puzzle_id))
                    if author_id is not None:
                        continue
                data.append(
                    {
                        "id": puzzle_id,
                        "title": puzzle.get("title", ""),
                        "body": puzzle.get("body", ""),
                        "admin_difficulty": admin_difficulties.get(str(puzzle_id), ""),
                        "is_daily": puzzle_id in daily_pool,
                        "is_played": puzzle_id in played_ids,
                    }
                )
            return self._send_json({"ok": True, "puzzles": data})

        if path == "/api/admin/users":
            if not self._require_admin():
                return None
            limit_raw = (query.get("limit") or ["100"])[0]
            try:
                limit = max(1, min(500, int(limit_raw)))
            except (TypeError, ValueError):
                limit = 100
            users = list_users(limit=limit)
            return self._send_json({"ok": True, "users": users})

        if path == "/api/admin/daily/auto":
            if not self._require_admin():
                return None
            enabled = get_setting("daily_auto_unplayed") == "1"
            return self._send_json({"ok": True, "enabled": enabled})

        if path == "/api/admin/author_stats":
            if not self._require_admin():
                return None
            limit_raw = (query.get("limit") or ["50"])[0]
            try:
                limit = max(1, min(200, int(limit_raw)))
            except (TypeError, ValueError):
                limit = 50
            stats = list_author_stats(limit=limit)
            return self._send_json({"ok": True, "stats": stats})

        if path == "/api/ai/config":
            config = get_active_ai_config()
            access_configured = bool(_get_ai_access_code())
            if not config:
                return self._send_json(
                    {"ok": True, "configured": False, "access_configured": access_configured}
                )
            return self._send_json(
                {
                    "ok": True,
                    "configured": True,
                    "access_configured": access_configured,
                    "name": config.get("name", ""),
                    "base_url": config.get("base_url", ""),
                    "model": config.get("model", ""),
                }
            )

        if path == "/api/daily":
            try:
                puzzles = load_puzzles(PUZZLE_DIR)
                daily = _get_daily_puzzle_id(puzzles)
                index_map = {puzzle["id"]: idx for idx, puzzle in enumerate(puzzles, start=1)}
                created_map = {puzzle["id"]: puzzle.get("created_at", "") for puzzle in puzzles}
                puzzle_id = daily["puzzle_id"]
                return self._send_json(
                    {
                        "ok": True,
                        "date": daily["date"],
                        "puzzle_id": puzzle_id,
                        "index": index_map.get(puzzle_id),
                        "created_at": created_map.get(puzzle_id, ""),
                    }
                )
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if path == "/api/daily/leaderboard":
            limit_raw = (query.get("limit") or ["5"])[0]
            try:
                limit = max(1, min(50, int(limit_raw)))
            except (TypeError, ValueError):
                limit = 5
            try:
                puzzles = load_puzzles(PUZZLE_DIR)
                daily = _get_daily_puzzle_id(puzzles)
                time_range = _local_day_range_utc(daily["date"])
                entries = get_leaderboard_between(
                    daily["puzzle_id"], time_range["start"], time_range["end"], limit=limit
                )
                count = get_completion_count_between(
                    daily["puzzle_id"], time_range["start"], time_range["end"]
                )
                return self._send_json(
                    {
                        "ok": True,
                        "date": daily["date"],
                        "puzzle_id": daily["puzzle_id"],
                        "entries": entries,
                        "count": count,
                    }
                )
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if path == "/api/daily/trend":
            days_raw = (query.get("days") or ["7"])[0]
            try:
                days = max(1, min(14, int(days_raw)))
            except (TypeError, ValueError):
                days = 7
            try:
                puzzles = load_puzzles(PUZZLE_DIR)
                daily = _get_daily_puzzle_id(puzzles)
                history_map = _daily_history_map()
                today = datetime.strptime(daily["date"], "%Y-%m-%d")
                output = []
                for offset in range(days - 1, -1, -1):
                    day = today - timedelta(days=offset)
                    day_str = day.strftime("%Y-%m-%d")
                    puzzle_id = history_map.get(day_str)
                    if day_str == daily["date"]:
                        puzzle_id = daily["puzzle_id"]
                    if puzzle_id:
                        time_range = _local_day_range_utc(day_str)
                        count = get_completion_count_between(
                            puzzle_id, time_range["start"], time_range["end"]
                        )
                    else:
                        count = 0
                    output.append({"date": day_str, "puzzle_id": puzzle_id or "", "count": count})
                return self._send_json({"ok": True, "items": output})
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if path == "/api/difficulty/board":
            limit_raw = (query.get("limit") or ["50"])[0]
            try:
                limit = max(1, min(200, int(limit_raw)))
            except (TypeError, ValueError):
                limit = 50
            try:
                puzzles = load_puzzles(PUZZLE_DIR)
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)
            index_map = {puzzle["id"]: idx for idx, puzzle in enumerate(puzzles, start=1)}
            created_map = {puzzle["id"]: puzzle.get("created_at", "") for puzzle in puzzles}
            stats = list_puzzle_difficulty_stats(limit=limit)
            data = []
            for stat in stats:
                puzzle_id = stat.get("puzzle_id")
                data.append(
                    {
                        **stat,
                        "index": index_map.get(puzzle_id),
                        "created_at": created_map.get(puzzle_id, ""),
                    }
                )
            return self._send_json({"ok": True, "stats": data})

        if path == "/api/difficulty/mine":
            user = self._require_user()
            if not user:
                return None
            puzzle_id = _validate_puzzle_id((query.get("puzzle_id") or [""])[0])
            if not puzzle_id:
                return self._send_json({"ok": False, "message": "缺少 puzzle_id。"}, status_code=400)
            vote = get_difficulty_vote(int(user["id"]), puzzle_id)
            return self._send_json({"ok": True, "difficulty": vote})

        if path == "/api/overall_leaderboard":
            limit_raw = (query.get("limit") or ["50"])[0]
            try:
                limit = max(1, min(200, int(limit_raw)))
            except (TypeError, ValueError):
                limit = 50
            stats = list_overall_leaderboard(limit=limit)
            return self._send_json({"ok": True, "stats": stats})

        if path == "/api/author_stats":
            limit_raw = (query.get("limit") or ["50"])[0]
            try:
                limit = max(1, min(200, int(limit_raw)))
            except (TypeError, ValueError):
                limit = 50
            stats = list_author_stats(limit=limit)
            return self._send_json({"ok": True, "stats": stats})

        if path == "/api/leaderboard":
            puzzle_id = (query.get("puzzle_id") or [""])[0]
            if not puzzle_id:
                return self._send_json({"ok": False, "message": "缺少 puzzle_id。"}, status_code=400)
            limit_raw = (query.get("limit") or ["10"])[0]
            try:
                limit = max(1, min(50, int(limit_raw)))
            except (TypeError, ValueError):
                limit = 10
            entries = get_leaderboard(puzzle_id, limit=limit)
            return self._send_json({"ok": True, "entries": entries})

        return self._send_json({"ok": False, "message": "未找到对应的接口。"}, status_code=404)

    def do_POST(self) -> None:
        try:
            payload = self._read_json_body()
        except Exception:
            return self._send_json({"ok": False, "message": "请求体不是合法的 JSON。"}, status_code=400)

        if self.path == "/api/start":
            user = self._require_user()
            if not user:
                return None
            puzzle_id = payload.get("puzzle_id")
            mode = payload.get("mode", "resume")
            try:
                store = SESSION_MANAGER.get_store_for_user(int(user["id"]))
                existed = bool(puzzle_id and puzzle_id in store.games)
                state = store.start(puzzle_id, mode)
                if mode == "restart" or not existed:
                    record_puzzle_attempt(int(user["id"]), str(state["puzzle_id"]))
                    _demote_daily_if_played(str(state["puzzle_id"]))
                SESSION_MANAGER.save()
                return self._send_json({"ok": True, "state": state})
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if self.path == "/api/guess":
            user = self._require_user()
            if not user:
                return None
            guess_char = payload.get("ch", "")
            try:
                store = SESSION_MANAGER.get_store_for_user(int(user["id"]))
                result = store.guess(guess_char)
                if result.get("state"):
                    record_puzzle_guess(
                        int(user["id"]),
                        str(result["state"]["puzzle_id"]),
                        str(result.get("status", "")),
                    )
                if result["state"].get("is_complete"):
                    record_result(user["id"], result["state"]["puzzle_id"], result["state"]["guess_count"])
                SESSION_MANAGER.save()
                return self._send_json({"ok": True, "result": result})
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if self.path == "/api/hint":
            user = self._require_user()
            if not user:
                return None
            try:
                date_str = _today_local_str()
                free_used = consume_daily_hint(int(user["id"]), date_str)
                store = SESSION_MANAGER.get_store_for_user(int(user["id"]))
                result = store.use_hint(free=free_used)
                state = result.get("state")
                if state and state.get("is_complete"):
                    record_result(user["id"], state["puzzle_id"], state["guess_count"])
                SESSION_MANAGER.save()
                return self._send_json(
                    {
                        "ok": True,
                        "revealed": result.get("revealed"),
                        "penalty": result.get("penalty", 0),
                        "free_used": free_used,
                        "state": state,
                    }
                )
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if self.path == "/api/checkin":
            user = self._require_user()
            if not user:
                return None
            date_str = _today_local_str()
            try:
                info = claim_daily_checkin(int(user["id"]), date_str, reward=1)
                return self._send_json(
                    {
                        "ok": True,
                        "date": date_str,
                        "claimed": True,
                        "free_hints": info.get("free_hints", 0),
                    }
                )
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if self.path == "/api/ai/step":
            user = self._require_user()
            if not user:
                return None
            if not self._require_ai_access():
                return None
            try:
                store = SESSION_MANAGER.get_store_for_user(int(user["id"]))
                ai_config = get_active_ai_config()
                if not ai_config:
                    raise RuntimeError("AI 尚未配置，请在管理员页面设置。")
                result = store.ai_step(ai_config)
                if result.get("result", {}).get("state", {}).get("is_complete"):
                    state = result["result"]["state"]
                    record_result(user["id"], state["puzzle_id"], state["guess_count"])
                status = result.get("result", {}).get("status")
                state = result.get("result", {}).get("state")
                if state and status:
                    record_puzzle_guess(int(user["id"]), str(state["puzzle_id"]), str(status))
                guess = result.get("guess")
                reason = result.get("reason")
                print(f"[AI] 猜测={guess} 状态={status} 理由={reason}")
                SESSION_MANAGER.save()
                return self._send_json({"ok": True, **result})
            except Exception as exc:
                info = _safe_ai_config_info(ai_config if isinstance(ai_config, dict) else None)
                print(f"[AI] 调用失败: {exc} | {info}")
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if self.path == "/api/login":
            session_id = self._require_session_id()
            if not session_id:
                return None
            nickname = str(payload.get("nickname", "")).strip()
            if not nickname:
                return self._send_json({"ok": False, "message": "昵称不能为空。"}, status_code=400)
            if len(nickname) > 20:
                return self._send_json({"ok": False, "message": "昵称长度不能超过 20。"}, status_code=400)
            try:
                user = upsert_user(nickname)
                bind_session(session_id, int(user["id"]))
                return self._send_json({"ok": True, "user": user})
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if self.path == "/api/puzzles/create":
            if not self._require_admin():
                return None
            user = self._require_admin_user()
            if not user:
                return None
            try:
                puzzle_id = payload.get("puzzle_id")
                title = payload.get("title", "")
                body = payload.get("body", "")
                overwrite = bool(payload.get("overwrite", False))
                safe_id = _sanitize_puzzle_id(str(puzzle_id or ""))
                if safe_id:
                    author_id = get_puzzle_author_id(safe_id)
                    if author_id and author_id != int(user["id"]):
                        return self._send_json(
                            {"ok": False, "message": "只能编辑自己创建的题目。"},
                            status_code=403,
                        )
                    if author_id is None and not _is_default_admin_user(user):
                        file_path = PUZZLE_DIR / f"{safe_id}.txt"
                        if file_path.exists():
                            return self._send_json(
                                {"ok": False, "message": "该题目未归属，只能由 Admin 认领或修改。"},
                                status_code=403,
                            )
                puzzle = _create_puzzle_file(puzzle_id, title, body, overwrite)
                if overwrite and puzzle.get("overwrote"):
                    SESSION_MANAGER.remove_puzzle(puzzle["id"])
                SESSION_MANAGER.save()
                touch_puzzle_meta(puzzle["id"], int(user["id"]))
                return self._send_json({"ok": True, "puzzle": {"id": puzzle["id"]}})
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if self.path == "/api/difficulty/vote":
            user = self._require_user()
            if not user:
                return None
            puzzle_id = _validate_puzzle_id(str(payload.get("puzzle_id", "")))
            if not puzzle_id:
                return self._send_json({"ok": False, "message": "题目 id 不合法。"}, status_code=400)
            difficulty_raw = str(payload.get("difficulty", "")).strip().lower()
            mapping = {"easy": 1, "medium": 2, "hard": 3, "1": 1, "2": 2, "3": 3}
            if difficulty_raw not in mapping:
                return self._send_json({"ok": False, "message": "难度参数不合法。"}, status_code=400)
            if not has_result(int(user["id"]), puzzle_id):
                return self._send_json({"ok": False, "message": "通关后才能评价难度。"}, status_code=403)
            try:
                upsert_difficulty_vote(int(user["id"]), puzzle_id, mapping[difficulty_raw])
                return self._send_json({"ok": True})
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if self.path == "/api/admin/puzzles/difficulty":
            if not self._require_admin():
                return None
            user = self._require_admin_user()
            if not user:
                return None
            puzzle_id = _validate_puzzle_id(str(payload.get("puzzle_id", "")))
            if not puzzle_id:
                return self._send_json({"ok": False, "message": "题目 id 不合法。"}, status_code=400)
            difficulty_raw = str(payload.get("difficulty", "")).strip().lower()
            allowed = {"", "easy", "medium", "hard"}
            if difficulty_raw not in allowed:
                return self._send_json({"ok": False, "message": "难度参数不合法。"}, status_code=400)
            author_id = get_puzzle_author_id(puzzle_id)
            if author_id and author_id != int(user["id"]):
                return self._send_json(
                    {"ok": False, "message": "只能为自己创建的题目标注难度。"},
                    status_code=403,
                )
            if author_id is None and not _is_default_admin_user(user):
                return self._send_json(
                    {"ok": False, "message": "该题目未归属，只能由 Admin 标注难度。"},
                    status_code=403,
                )
            try:
                if author_id is None:
                    touch_puzzle_meta(puzzle_id, int(user["id"]))
                value = difficulty_raw or None
                set_admin_difficulty(puzzle_id, value)
                return self._send_json({"ok": True})
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if self.path == "/api/admin/puzzles/daily":
            if not self._require_admin():
                return None
            user = self._require_admin_user()
            if not user:
                return None
            puzzle_id = _validate_puzzle_id(str(payload.get("puzzle_id", "")))
            if not puzzle_id:
                return self._send_json({"ok": False, "message": "题目 id 不合法。"}, status_code=400)
            is_daily = bool(payload.get("is_daily", False))
            author_id = get_puzzle_author_id(puzzle_id)
            if author_id and author_id != int(user["id"]):
                return self._send_json(
                    {"ok": False, "message": "只能为自己创建的题目标记每日题。"},
                    status_code=403,
                )
            if author_id is None and not _is_default_admin_user(user):
                return self._send_json(
                    {"ok": False, "message": "该题目未归属，只能由 Admin 标记每日题。"},
                    status_code=403,
                )
            try:
                if is_daily:
                    played_ids = set(list_played_puzzle_ids())
                    if puzzle_id in played_ids:
                        current_daily = set(list_daily_puzzle_ids())
                        if puzzle_id not in current_daily:
                            return self._send_json(
                                {"ok": False, "message": "该题已被游玩，不能加入每日题池。"},
                                status_code=400,
                            )
                if author_id is None:
                    touch_puzzle_meta(puzzle_id, int(user["id"]))
                set_daily_flag(puzzle_id, is_daily)
                return self._send_json({"ok": True})
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if self.path == "/api/admin/daily/auto":
            if not self._require_admin():
                return None
            enabled = bool(payload.get("enabled", False))
            try:
                set_setting("daily_auto_unplayed", "1" if enabled else "0")
                return self._send_json({"ok": True, "enabled": enabled})
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if self.path == "/api/admin/puzzles/generate":
            if not self._require_admin():
                return None
            title = str(payload.get("title", "")).strip()
            style_hint = str(payload.get("style_hint", "")).strip()
            if not title:
                return self._send_json({"ok": False, "message": "标题不能为空。"}, status_code=400)
            if len(title) > 40:
                return self._send_json({"ok": False, "message": "标题长度过长。"}, status_code=400)
            try:
                access_code = _get_ai_access_code()
                if not access_code:
                    raise RuntimeError("AI 访问码未配置，请先设置。")
                ai_config = get_active_ai_config()
                if not ai_config:
                    raise RuntimeError("AI 尚未配置，请在管理员页面设置。")
                client = AIClient(ai_config)
                body = client.generate_puzzle_body(title, style_hint)
                return self._send_json({"ok": True, "title": title, "body": body})
            except Exception as exc:
                info = _safe_ai_config_info(ai_config if isinstance(ai_config, dict) else None)
                print(f"[AI] 生成题目失败: {exc} | {info}")
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if self.path == "/api/admin/ai/profiles":
            if not self._require_admin():
                return None
            name = str(payload.get("name", "")).strip()
            base_url = str(payload.get("base_url", "")).strip()
            model = str(payload.get("model", "")).strip()
            api_key = str(payload.get("api_key", "")).strip()
            set_active = bool(payload.get("set_active", True))
            if not name or not base_url or not model or not api_key:
                return self._send_json({"ok": False, "message": "请完整填写 AI 配置。"}, status_code=400)
            try:
                upsert_ai_profile(name, base_url, model, api_key, set_active=set_active)
                return self._send_json({"ok": True})
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if self.path == "/api/admin/ai/active":
            if not self._require_admin():
                return None
            name = str(payload.get("name", "")).strip()
            if not name:
                return self._send_json({"ok": False, "message": "缺少配置名称。"}, status_code=400)
            try:
                set_active_ai_profile(name)
                return self._send_json({"ok": True})
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if self.path == "/api/admin/ai/access":
            if not self._require_admin():
                return None
            access_code = str(payload.get("access_code", "")).strip()
            if not access_code:
                return self._send_json({"ok": False, "message": "访问码不能为空。"}, status_code=400)
            if len(access_code) > 64:
                return self._send_json({"ok": False, "message": "访问码过长。"}, status_code=400)
            try:
                set_setting("ai_access_code", access_code)
                return self._send_json({"ok": True})
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        return self._send_json({"ok": False, "message": "未找到对应的接口。"}, status_code=404)

    def do_DELETE(self) -> None:
        try:
            payload = self._read_json_body()
        except Exception:
            return self._send_json({"ok": False, "message": "请求体不是合法的 JSON。"}, status_code=400)

        if self.path == "/api/admin/puzzles":
            if not self._require_admin():
                return None
            user = self._require_admin_user()
            if not user:
                return None
            puzzle_id = _validate_puzzle_id(str(payload.get("puzzle_id", "")))
            if not puzzle_id:
                return self._send_json({"ok": False, "message": "题目 id 不合法。"}, status_code=400)
            try:
                author_id = get_puzzle_author_id(puzzle_id)
                if author_id and author_id != int(user["id"]):
                    return self._send_json(
                        {"ok": False, "message": "只能删除自己创建的题目。"},
                        status_code=403,
                    )
                if author_id is None and not _is_default_admin_user(user):
                    return self._send_json(
                        {"ok": False, "message": "该题目未归属，只能由 Admin 删除。"},
                        status_code=403,
                    )
                file_path = PUZZLE_DIR / f"{puzzle_id}.txt"
                if not file_path.exists():
                    return self._send_json({"ok": False, "message": "题目不存在。"}, status_code=404)
                file_path.unlink()
                SESSION_MANAGER.remove_puzzle(puzzle_id)
                SESSION_MANAGER.save()
                delete_puzzle_meta(puzzle_id)
                return self._send_json({"ok": True})
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        if self.path == "/api/admin/ai/access":
            if not self._require_admin():
                return None
            clear_setting("ai_access_code")
            return self._send_json({"ok": True})

        if self.path == "/api/admin/ai/profiles":
            if not self._require_admin():
                return None
            name = str(payload.get("name", "")).strip()
            if not name:
                return self._send_json({"ok": False, "message": "缺少配置名称。"}, status_code=400)
            try:
                delete_ai_profile(name)
                return self._send_json({"ok": True})
            except Exception as exc:
                return self._send_json({"ok": False, "message": str(exc)}, status_code=400)

        return self._send_json({"ok": False, "message": "未找到对应的接口。"}, status_code=404)

    def log_message(self, format: str, *args) -> None:
        # 保持安静，避免刷屏；需要时可自行打开
        return


def main() -> int:
    parser = ChineseArgumentParser(description="单字猜谜本地服务。", add_help=False)
    parser.add_argument("-h", "--help", action="help", help="显示帮助并退出。")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址（默认 127.0.0.1）。")
    parser.add_argument("--port", type=int, default=8000, help="监听端口（默认 8000）。")
    args = parser.parse_args()

    server = HTTPServer((args.host, args.port), RequestHandler)
    print(f"本地服务已启动：http://{args.host}:{args.port}")
    print("按 Ctrl+C 结束。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
