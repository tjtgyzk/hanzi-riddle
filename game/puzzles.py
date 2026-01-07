# -*- coding: utf-8 -*-

from datetime import datetime
from pathlib import Path
from typing import List, Dict

# 默认题目文件夹（每个 .txt 文件即一道题）
PUZZLE_DIR = Path(__file__).resolve().parents[1] / "data" / "puzzles"


def parse_puzzle_file(path: Path) -> Dict[str, str]:
    """解析单个题目文件：首行标题，其余为正文。"""
    content = path.read_text(encoding="utf-8").lstrip("\ufeff")
    lines = content.splitlines()
    if not lines:
        raise ValueError(f"题目文件为空: {path.name}")

    title = lines[0].strip()
    if not title:
        raise ValueError(f"题目标题为空: {path.name}")

    body = "\n".join(lines[1:]).lstrip("\n")
    created_at = datetime.utcfromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds") + "Z"
    return {"id": path.stem, "title": title, "body": body, "created_at": created_at}


def load_puzzles(path: Path = PUZZLE_DIR) -> List[Dict[str, str]]:
    """从固定文件夹读取全部题目。"""
    if not path.exists():
        raise FileNotFoundError(f"题目文件夹不存在: {path}")
    files = sorted(path.glob("*.txt"))
    if not files:
        raise FileNotFoundError(f"题目文件夹为空: {path}")
    return [parse_puzzle_file(file_path) for file_path in files]
