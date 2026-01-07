# -*- coding: utf-8 -*-

from dataclasses import dataclass
from typing import Dict, List, Optional


def _is_cjk_char(ch: str) -> bool:
    """判断是否为单个汉字（Unicode CJK 基本区）。"""
    if len(ch) != 1:
        return False
    return "\u4e00" <= ch <= "\u9fff"

def _is_digit_char(ch: str) -> bool:
    """判断是否为单个数字字符（0-9）。"""
    return len(ch) == 1 and "0" <= ch <= "9"


def _is_letter_char(ch: str) -> bool:
    """判断是否为单个英文字母（A-Z / a-z）。"""
    return len(ch) == 1 and (("A" <= ch <= "Z") or ("a" <= ch <= "z"))


def _is_guessable_char(ch: str) -> bool:
    """当前规则下可猜的字符：单个汉字、数字或字母。"""
    return _is_cjk_char(ch) or _is_digit_char(ch) or _is_letter_char(ch)


@dataclass
class GuessResult:
    """一次猜测的结果与更新后的游戏状态。

    status 取值：
    - correct: 命中
    - wrong: 未命中
    - repeat: 重复猜测（不计次数）
    - invalid: 非法输入
    - finished: 已完成（不再计次数）

    reason 取值：
    - hit / miss / already_guessed / not_single_char / not_guessable / completed
    """
    status: str
    reason: str
    state: Dict[str, object]


class Game:
    """游戏规则引擎：维护状态、处理猜测、输出结构化结果。"""

    def __init__(self, title: str, body: str, puzzle_id: str = "local", placeholder: str = "□") -> None:
        # 基础题面信息
        self.puzzle_id = puzzle_id
        self.title = title
        self.body = body
        self.placeholder = placeholder

        # 计数与已猜记录（保持顺序输出给 UI/AI）
        self.guess_count = 0
        self.guessed_correct: List[str] = []
        self.guessed_wrong: List[str] = []
        # 用于快速判重的集合
        self._guessed_correct_set = set()
        self._guessed_wrong_set = set()

        # 标题与全文中所有可猜字符集合
        self._title_chars = self._extract_guessable_chars(self.title)
        self._all_chars = self._extract_guessable_chars(self.title + self.body)

    def _extract_guessable_chars(self, text: str) -> set:
        """提取文本中所有可猜字符集合。"""
        return {ch for ch in text if _is_guessable_char(ch)}

    def _mask_text(self, text: str, reveal_all: bool) -> str:
        """根据当前已猜结果生成遮罩文本。"""
        if reveal_all:
            return text
        output = []
        for ch in text:
            if _is_guessable_char(ch):
                # 汉字未猜中则用方块遮挡，猜中过则显示原字
                output.append(ch if ch in self._guessed_correct_set else self.placeholder)
            else:
                # 标点符号、空格等直接显示
                output.append(ch)
        return "".join(output)

    def is_complete(self) -> bool:
        """标题全部猜出即视为完成。"""
        return self._title_chars.issubset(self._guessed_correct_set)

    def get_state(self) -> Dict[str, object]:
        """返回当前状态，供 UI/AI 直接读取。"""
        complete = self.is_complete()
        title_display = self._mask_text(self.title, reveal_all=complete)
        body_display = self._mask_text(self.body, reveal_all=complete)
        return {
            "puzzle_id": self.puzzle_id,
            "title_masked": title_display,
            "body_masked": body_display,
            "guessed_correct": list(self.guessed_correct),
            "guessed_wrong": list(self.guessed_wrong),
            "guess_count": self.guess_count,
            "title_total": len(self._title_chars),
            "title_remaining": len(self._title_chars - self._guessed_correct_set),
            "is_complete": complete,
            "placeholder": self.placeholder,
        }

    def export_progress(self) -> Dict[str, object]:
        """导出可持久化的进度数据（不含题面内容）。"""
        return {
            "guess_count": self.guess_count,
            "guessed_correct": list(self.guessed_correct),
            "guessed_wrong": list(self.guessed_wrong),
        }

    def apply_progress(self, data: Dict[str, object]) -> None:
        """恢复持久化进度数据。"""
        guessed_correct = data.get("guessed_correct", [])
        guessed_wrong = data.get("guessed_wrong", [])
        guess_count = data.get("guess_count", 0)

        # 只保留合法的单字记录，避免脏数据影响
        self.guessed_correct = [ch for ch in guessed_correct if _is_guessable_char(ch)]
        self.guessed_wrong = [ch for ch in guessed_wrong if _is_guessable_char(ch)]
        self._guessed_correct_set = set(self.guessed_correct)
        self._guessed_wrong_set = set(self.guessed_wrong)

        # 计数为非负整数
        try:
            guess_count = int(guess_count)
        except (TypeError, ValueError):
            guess_count = 0
        self.guess_count = max(0, guess_count)

    def guess(self, ch: str) -> GuessResult:
        """处理一次猜测，返回结果与最新状态。"""
        if self.is_complete():
            return GuessResult(
                status="finished",
                reason="completed",
                state=self.get_state(),
            )
        if not ch or len(ch) != 1:
            return GuessResult(
                status="invalid",
                reason="not_single_char",
                state=self.get_state(),
            )
        if not _is_guessable_char(ch):
            return GuessResult(
                status="invalid",
                reason="not_guessable",
                state=self.get_state(),
            )
        if ch in self._guessed_correct_set or ch in self._guessed_wrong_set:
            return GuessResult(
                status="repeat",
                reason="already_guessed",
                state=self.get_state(),
            )

        if ch in self._all_chars:
            # 命中：记录为正确并加入显示
            self.guessed_correct.append(ch)
            self._guessed_correct_set.add(ch)
            status = "correct"
            reason = "hit"
        else:
            # 未命中：记录为错误并加入排除列表
            self.guessed_wrong.append(ch)
            self._guessed_wrong_set.add(ch)
            status = "wrong"
            reason = "miss"

        # 只有新猜测才计次数
        self.guess_count += 1
        return GuessResult(status=status, reason=reason, state=self.get_state())

    def next_optimal_guess(self) -> Optional[str]:
        """基于标题内容返回下一步最短解字符。"""
        seen = set()
        for ch in self.title:
            if not _is_guessable_char(ch):
                continue
            if ch in seen:
                continue
            seen.add(ch)
            if ch in self._guessed_correct_set or ch in self._guessed_wrong_set:
                continue
            return ch
        return None
