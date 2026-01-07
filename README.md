# 单字猜谜（规则引擎 + 命令行）

本仓库包含一个规则引擎和一个简单的命令行交互版本，规则引擎以结构化状态输出，方便人类与 AI 共同使用。

运行需要 Python 3。

## 运行（命令行）

```sh
python3 -m game.cli --list
python3 -m game.cli --puzzle demo
```

## 运行（网页界面）

```sh
python3 -m game.server
```

浏览器打开 `http://127.0.0.1:8000` 即可游玩。

网页界面支持题目进度（未开始/进行中/已完成）与继续未完成的题目，题目不会直接展示标题内容。
进度会保存在 `data/sessions.json`，不同浏览器会话互不影响。

## 题目格式（txt 文件）

- 题目目录：`data/puzzles/`
- 每个 `.txt` 文件代表一道题
- **第一行**为标题
- **第二行起**为正文（可多行）

示例：

```txt
春风不问
春风吹过村庄，河岸边柳树轻摇。
孩子们在田埂上追逐，老人坐在门口晒太阳。
```

## 引擎用法

```python
from game.engine import Game

game = Game(title="春风不问", body="春风吹过村庄，河岸边柳树轻摇。")
state = game.get_state()
result = game.guess("春")
```

## 规则说明

- 仅允许猜测单个汉字、数字或字母（汉字：U+4E00–U+9FFF；数字：0-9；字母：A-Z/a-z）
- 标点与空白会直接显示，不需要猜
- 标题全部猜出后，正文全文展示

## 接口说明（本地服务）

- `GET /api/puzzles`：获取题目列表
- `POST /api/start`：开始游戏（参数：`puzzle_id` 可选，`mode` 为 `resume`/`restart`）
- `POST /api/guess`：提交猜测（参数：`ch`）
- `GET /api/state`：获取当前状态
- `POST /api/puzzles/create`：新增题目（参数：`puzzle_id`/`title`/`body`/`overwrite`）
- `POST /api/ai/step`：执行 AI 最短解的一步（可传 `ai_config`）

所有接口会读取请求头 `X-Session-Id` 作为会话编号，用于多用户进度隔离。

## AI 配置

网页上的 “AI 最短解” 在页面里配置并本地保存（便于对比不同模型）。
配置会随浏览器本地保存，不写入服务端磁盘。

如需默认值，也可使用环境变量（作为 UI 未配置时的兜底）：

```sh
export OPENAI_API_KEY="你的 Key"
export OPENAI_MODEL="gpt-4o-mini"
export OPENAI_BASE_URL="https://api.openai.com/v1/chat/completions"
```

调试 AI 请求/响应可在终端开启：

```sh
export AI_HTTP_DEBUG=1
```

该日志会输出完整 HTTP 请求与响应（密钥会被自动打码）。
