# -*- coding: utf-8 -*-

import json
import os
import urllib.error
import urllib.request
from typing import Dict, Optional


class AIClient:
    """调用外部大模型进行猜字决策。"""

    def __init__(self, config: Optional[Dict[str, str]] = None) -> None:
        config = config or {}
        self.api_key = config.get("api_key") or os.getenv("OPENAI_API_KEY", "")
        self.base_url = config.get("base_url") or os.getenv(
            "OPENAI_BASE_URL", "https://api.openai.com/v1/chat/completions"
        )
        self.model = config.get("model") or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        temperature_raw = config.get("temperature") or os.getenv("OPENAI_TEMPERATURE", "0.2")
        try:
            self.temperature = float(temperature_raw)
        except (TypeError, ValueError):
            self.temperature = 0.2
        self.debug_http = os.getenv("AI_HTTP_DEBUG", "1").strip().lower() in ("1", "true", "yes")

    def _log_request(self, url: str, headers: dict, body: bytes) -> None:
        """打印完整 HTTP 请求（不包含密钥）。"""
        if not self.debug_http:
            return
        safe_headers = {}
        for key, value in headers.items():
            if key.lower() == "authorization":
                safe_headers[key] = "Bearer <redacted>"
            else:
                safe_headers[key] = value
        body_text = body.decode("utf-8", errors="ignore")
        print("[AI HTTP] 请求 URL:", url)
        print("[AI HTTP] 请求头:", safe_headers)
        print("[AI HTTP] 请求体:", body_text)

    def _log_response(self, status_code: int, headers: dict, body: str) -> None:
        """打印完整 HTTP 响应。"""
        if not self.debug_http:
            return
        print("[AI HTTP] 响应状态:", status_code)
        print("[AI HTTP] 响应头:", dict(headers))
        print("[AI HTTP] 响应体:", body)

    def _build_prompt(self, state: Dict[str, object], previous_step: Optional[dict]) -> list:
        """构造模型输入消息。"""
        rules = (
            "你在玩单字猜谜游戏。必须严格遵守规则：\n"
            "1) 每次只能猜一个简体汉字、数字或英文字母。\n"
            "2) 不能猜已经猜过的字（已猜对/已猜错/forbidden_chars）。\n"
            "3) 不能猜除汉字/数字/字母以外的字符或多字符。\n"
            "4) 如果 previous_step 标记为 repeat/invalid，绝对不能再输出同一个 guess。\n"
            "5) 目标是在规则内尽量少的步数猜出标题全部字。\n"
            "请结合遮罩内容、已出现字、错字列表进行发散且合理的推断，"
            "可参考常见词语搭配、语法结构、语义连贯性和词频习惯。"
            "在输出前自检：guess 必须是 1 个字符（汉字/数字/字母）且不在 guessed_correct/"
            "guessed_wrong/forbidden_chars 中。\n"
            "如果 previous_step 显示你刚刚重复或非法，必须换一个新字。\n"
            "若输出重复/非法，会被系统拒绝并重试；请务必避免。\n"
            "请只输出 JSON，格式为 {\"guess\":\"字\",\"reason\":\"简短理由\"}。"
            "reason 不要超过 30 个汉字，不要输出推理过程。"
        )

        forbidden_chars = []
        if isinstance(state, dict):
            forbidden_chars.extend(state.get("guessed_correct", []) or [])
            forbidden_chars.extend(state.get("guessed_wrong", []) or [])

        payload = {
            "state": state,
            "previous_step": previous_step or {},
            "forbidden_chars": forbidden_chars,
            "rules": {
                "no_repeat": True,
                "single_char_only": True,
                "minimize_steps": True,
            },
        }

        return [
            {"role": "system", "content": rules},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ]

    def _extract_json(self, text: str) -> dict:
        """从模型输出中提取 JSON。"""
        text = text.strip()
        decoder = json.JSONDecoder()
        try:
            value, _ = decoder.raw_decode(text)
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            pass

        if text.startswith("{") and text.endswith("}"):
            return json.loads(text)

        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("模型输出不是 JSON。")
        sliced = text[start : end + 1]
        value, _ = decoder.raw_decode(sliced)
        if isinstance(value, dict):
            return value
        raise ValueError("模型输出不是 JSON 对象。")

    def choose_next_guess(self, state: Dict[str, object], previous_step: Optional[dict]) -> dict:
        """调用模型并返回 guess + reason。"""
        if not self.api_key:
            raise RuntimeError("未配置 OPENAI_API_KEY，无法调用 AI。")

        messages = self._build_prompt(state, previous_step)
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
            "response_format": {"type": "json_object"},
        }

        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        request = urllib.request.Request(self.base_url, data=data, headers=headers, method="POST")
        self._log_request(self.base_url, headers, data)

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read().decode("utf-8")
                self._log_response(response.getcode(), response.headers, raw)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="ignore")
            self._log_response(exc.code, exc.headers, body)
            raise RuntimeError(f"AI 接口 HTTP 错误：{exc.code}，返回：{body[:200]}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"AI 接口无法连接：{exc.reason}") from exc

        if not raw.strip():
            raise RuntimeError("AI 接口返回空内容，请检查 Base URL/网络/Key。")
        try:
            result = json.loads(raw)
        except json.JSONDecodeError as exc:
            snippet = raw[:200].strip()
            raise RuntimeError(f"AI 接口返回非 JSON：{snippet}") from exc

        if isinstance(result, dict) and result.get("error"):
            message = result.get("error", {}).get("message", "未知错误")
            raise RuntimeError(f"AI 接口错误：{message}")

        content = ""
        if isinstance(result, dict):
            choices = result.get("choices", [])
            if choices:
                content = choices[0].get("message", {}).get("content", "")

        if not content:
            raise RuntimeError("模型返回为空。")

        data = self._extract_json(content)
        guess = str(data.get("guess", "")).strip()
        reason = str(data.get("reason", "")).strip()
        return {"guess": guess, "reason": reason}

    def generate_puzzle_body(self, title: str, style_hint: str = "") -> str:
        """生成题目正文（不包含标题行）。"""
        if not self.api_key:
            raise RuntimeError("未配置 OPENAI_API_KEY，无法调用 AI。")
        title = str(title or "").strip()
        if not title:
            raise RuntimeError("标题不能为空。")

        rules = (
            "你是中文百科短文写作者。请根据给定标题生成题目正文，"
            "用于单字猜谜游戏。\n"
            "要求：\n"
            "1) 只输出正文，不要重复输出标题。\n"
            "2) 使用中性、客观、简洁的百科风格。\n"
            "3) 2-3 段，每段 1-3 句，总长度约 160-320 个汉字。\n"
            "4) 可包含时间/数字/地名等事实性信息，避免编造过于精确且无法证实的数据。\n"
            "5) 不要列表、不要 Markdown、不要表情。\n"
            "6) 若提供风格补充，请在不偏离百科风格的前提下适度采纳。\n"
            "7) 若标题是人名或冷门专有名词、缺乏客观事实：不要编造履历或社会分布，"
            "改为解释名称构成与字义，用常见词语举例帮助猜字；"
            "标题中的每个汉字至少出现一次，并给出对应含义或例词。\n"
            "请只输出 JSON，格式为 {\"body\":\"正文\"}。"
        )

        payload = {"title": title, "style_hint": style_hint.strip() if style_hint else ""}
        messages = [
            {"role": "system", "content": rules},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ]
        request_payload = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
            "response_format": {"type": "json_object"},
        }

        data = json.dumps(request_payload, ensure_ascii=False).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        request = urllib.request.Request(self.base_url, data=data, headers=headers, method="POST")
        self._log_request(self.base_url, headers, data)

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read().decode("utf-8")
                self._log_response(response.getcode(), response.headers, raw)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="ignore")
            self._log_response(exc.code, exc.headers, body)
            raise RuntimeError(f"AI 接口 HTTP 错误：{exc.code}，返回：{body[:200]}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"AI 接口无法连接：{exc.reason}") from exc

        if not raw.strip():
            raise RuntimeError("AI 接口返回空内容，请检查 Base URL/网络/Key。")
        try:
            result = json.loads(raw)
        except json.JSONDecodeError as exc:
            snippet = raw[:200].strip()
            raise RuntimeError(f"AI 接口返回非 JSON：{snippet}") from exc

        if isinstance(result, dict) and result.get("error"):
            message = result.get("error", {}).get("message", "未知错误")
            raise RuntimeError(f"AI 接口错误：{message}")

        content = ""
        if isinstance(result, dict):
            choices = result.get("choices", [])
            if choices:
                content = choices[0].get("message", {}).get("content", "")
        if not content:
            raise RuntimeError("模型返回为空。")

        data = self._extract_json(content)
        body = str(data.get("body", "")).strip()
        if not body:
            raise RuntimeError("模型返回正文为空。")
        return body
