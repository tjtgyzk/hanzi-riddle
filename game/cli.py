# -*- coding: utf-8 -*-

import argparse
from typing import Optional

from .engine import Game
from .puzzles import PUZZLE_DIR, load_puzzles

# 命令行交互层：只负责展示和输入，不包含规则判断


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


def _render_state(state: dict) -> None:
    """将当前状态渲染为中文文本输出。"""
    wrong = "".join(state["guessed_wrong"]) if state["guessed_wrong"] else "无"
    print("\n标题:")
    print(state["title_masked"])
    print("\n正文:")
    print(state["body_masked"])
    print(f"\n已猜次数: {state['guess_count']}  错误字: {wrong}")


def main() -> int:
    """命令行入口：读取题目，循环接收用户输入。"""
    # 命令行参数：仅负责选择题目与列出题目
    parser = ChineseArgumentParser(description="单字猜谜游戏（命令行版）。", add_help=False)
    parser.add_argument("-h", "--help", action="help", help="显示帮助并退出。")
    parser.add_argument("--list", action="store_true", help="列出本地题目并退出。")
    parser.add_argument("--puzzle", help="选择题目 id（文件名）。")
    args = parser.parse_args()

    # 读取本地题目
    try:
        puzzles = load_puzzles(PUZZLE_DIR)
    except Exception as exc:
        print(f"读取题目失败：{exc}")
        return 1
    if args.list:
        for puzzle in puzzles:
            print(f"{puzzle.get('id')}: {puzzle.get('title')}")
        return 0

    # 初始化规则引擎，进入循环输入
    puzzle = _choose_puzzle(puzzles, args.puzzle)
    game = Game(title=puzzle["title"], body=puzzle["body"], puzzle_id=puzzle["id"])

    print("输入一个汉字进行猜测。命令: /quit 退出, /state 查看状态。")
    while True:
        state = game.get_state()
        _render_state(state)
        if state["is_complete"]:
            print("\n标题已全部猜出，游戏结束。")
            return 0

        raw = input("\n猜一个字> ").strip()
        if not raw:
            continue
        if raw in ("/quit", "/q"):
            print("已退出。")
            return 0
        if raw in ("/state", "/s"):
            continue

        # 将用户输入交给规则引擎进行判定
        result = game.guess(raw)
        if result.status == "correct":
            print("命中。")
        elif result.status == "wrong":
            print("猜错。")
        elif result.status == "repeat":
            print("已猜过，不计次数。")
        elif result.status == "finished":
            print("本局已完成，不再计次数。")
        else:
            print("请输入单个汉字、数字或字母。")


if __name__ == "__main__":
    raise SystemExit(main())
