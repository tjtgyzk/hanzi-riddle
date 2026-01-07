// 页面交互脚本：负责拉取题目、提交猜测、渲染状态

const puzzleSelect = document.getElementById("puzzleSelect");
const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");
const guessInput = document.getElementById("guessInput");
const guessBtn = document.getElementById("guessBtn");
const aiBtn = document.getElementById("aiBtn");
const contentMasked = document.getElementById("contentMasked");
const guessCount = document.getElementById("guessCount");
const titleRemaining = document.getElementById("titleRemaining");
const puzzleStatus = document.getElementById("puzzleStatus");
const wrongList = document.getElementById("wrongList");
const messageBox = document.getElementById("messageBox");
const aiLog = document.getElementById("aiLog");
const aiToggleBtn = document.getElementById("aiToggleBtn");
const aiTrace = document.querySelector(".ai-trace");
const progressSummary = document.getElementById("progressSummary");
const refreshBtn = document.getElementById("refreshBtn");
const nicknameInput = document.getElementById("nicknameInput");
const loginBtn = document.getElementById("loginBtn");
const currentUser = document.getElementById("currentUser");
const leaderboardSelect = document.getElementById("leaderboardSelect");
const leaderboardList = document.getElementById("leaderboardList");
const leaderboardEmpty = document.getElementById("leaderboardEmpty");
const loginBadge = document.getElementById("loginBadge");
const loginNotice = document.getElementById("loginNotice");
const loginNoticeBtn = document.getElementById("loginNoticeBtn");
const accountPanel = document.getElementById("accountPanel");

let puzzlesCache = [];
let currentState = null;
let aiRunning = false;
let aiLogs = [];
let currentUserInfo = null;
let aiLogExpanded = false;

const SESSION_KEY = "guess_game_session_id";

// 生成本地会话编号，保证多用户隔离
function createSessionId() {
  if (window.crypto && window.crypto.getRandomValues) {
    const buf = new Uint8Array(12);
    window.crypto.getRandomValues(buf);
    return Array.from(buf)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

function getSessionId() {
  let sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = createSessionId();
    localStorage.setItem(SESSION_KEY, sessionId);
  }
  return sessionId;
}

async function hasAiConfig() {
  try {
    const data = await requestJson("/api/ai/config");
    return Boolean(data.configured);
  } catch (error) {
    console.warn("[AI] 配置读取失败", error);
    return false;
  }
}

// 状态提示：统一处理提示文案与颜色样式
function setMessage(text, type) {
  messageBox.textContent = text;
  messageBox.classList.remove("good", "bad");
  if (type === "good") {
    messageBox.classList.add("good");
  } else if (type === "bad") {
    messageBox.classList.add("bad");
  }
}

function renderCurrentUser(user) {
  if (user && user.nickname) {
    currentUser.textContent = `当前：${user.nickname}`;
  } else {
    currentUser.textContent = "当前：未登录";
  }
  if (loginBadge) {
    if (user && user.nickname) {
      loginBadge.textContent = `已登录：${user.nickname}`;
      loginBadge.classList.remove("is-guest");
      loginBadge.classList.add("is-user");
    } else {
      loginBadge.textContent = "未登录";
      loginBadge.classList.remove("is-user");
      loginBadge.classList.add("is-guest");
    }
  }
}

function applyLoginState(user) {
  currentUserInfo = user || null;
  renderCurrentUser(user);
  const loggedIn = isLoggedIn();
  if (loginNotice) {
    loginNotice.classList.toggle("is-hidden", loggedIn);
  }
  if (accountPanel) {
    accountPanel.classList.toggle("needs-login", !loggedIn);
  }
  setDisabled(startBtn, !loggedIn);
  setDisabled(restartBtn, !loggedIn);
  setDisabled(aiBtn, !loggedIn);
  setInputEnabled(currentState && !currentState.is_complete);
  if (!loggedIn) {
    setMessage("先在右侧账号区输入昵称并点击登录，即可开始游戏。", "bad");
  }
}

function requireLogin() {
  if (isLoggedIn()) {
    return true;
  }
  setMessage("需要先登录：在右侧账号区输入昵称并点击登录即可开始。", "bad");
  return false;
}

function formatTimestamp(raw) {
  if (!raw) {
    return "";
  }
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    const ts = parsed + 8 * 60 * 60 * 1000;
    const date = new Date(ts);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    const seconds = String(date.getUTCSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
  return String(raw).replace("T", " ").replace("Z", "");
}

function formatDateOnly(raw) {
  if (!raw) {
    return "";
  }
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    const ts = parsed + 8 * 60 * 60 * 1000;
    const date = new Date(ts);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return "";
}

function setLeaderboardHint(text) {
  leaderboardEmpty.textContent = text;
  leaderboardEmpty.style.display = "block";
  leaderboardList.innerHTML = "";
}

function renderLeaderboard(entries) {
  leaderboardList.innerHTML = "";
  if (!entries || !entries.length) {
    setLeaderboardHint("暂无成绩");
    return;
  }
  leaderboardEmpty.style.display = "none";
  entries.forEach((entry, index) => {
    const item = document.createElement("li");
    item.className = "leaderboard-item";
    if (index === 0) {
      item.classList.add("leaderboard-gold");
    } else if (index === 1) {
      item.classList.add("leaderboard-silver");
    } else if (index === 2) {
      item.classList.add("leaderboard-bronze");
    }
    const row = document.createElement("div");
    row.className = "leaderboard-row";
    const rank = document.createElement("span");
    rank.className = "rank-badge";
    if (index === 0) {
      rank.textContent = "冠军";
    } else if (index === 1) {
      rank.textContent = "亚军";
    } else if (index === 2) {
      rank.textContent = "季军";
    } else {
      rank.textContent = `#${index + 1}`;
    }
    const name = document.createElement("span");
    name.className = "leaderboard-name";
    name.textContent = entry.nickname;
    const attempts = document.createElement("span");
    attempts.className = "leaderboard-attempts";
    attempts.textContent = `${entry.guess_count} 次`;
    row.append(rank, name, attempts);
    const timeText = formatTimestamp(entry.completed_at);
    if (timeText) {
      const time = document.createElement("div");
      time.className = "leaderboard-time";
      const icon = document.createElement("span");
      icon.className = "time-icon";
      icon.textContent = "🕒";
      const text = document.createElement("span");
      text.textContent = `完成时间 ${timeText}`;
      time.append(icon, text);
      item.append(row, time);
    } else {
      item.append(row);
    }
    leaderboardList.appendChild(item);
  });
}

async function loadLeaderboard(puzzleId) {
  if (!puzzleId) {
    setLeaderboardHint("请选择题目");
    return;
  }
  try {
    const data = await requestJson(`/api/leaderboard?puzzle_id=${encodeURIComponent(puzzleId)}`);
    renderLeaderboard(data.entries || []);
  } catch (error) {
    console.error("[leaderboard] 读取失败", error);
    setLeaderboardHint(`排行榜读取失败：${error.message}`);
  }
}

// 控制输入区可用状态
function isLoggedIn() {
  return Boolean(currentUserInfo && currentUserInfo.nickname);
}

function setDisabled(element, disabled) {
  if (element) {
    element.disabled = disabled;
  }
}

function isValidGuessInput(value) {
  const trimmed = (value || "").trim();
  return trimmed.length === 1 && isGuessableChar(trimmed);
}

function updateGuessButtonState() {
  if (guessInput.disabled) {
    guessBtn.disabled = true;
    return;
  }
  guessBtn.disabled = !isValidGuessInput(guessInput.value);
}

function setInputEnabled(enabled) {
  const allow = enabled && isLoggedIn();
  guessInput.disabled = !allow;
  updateGuessButtonState();
}

// AI 模式下锁定部分按钮，避免冲突
function setAiControlsEnabled(enabled) {
  setDisabled(startBtn, !enabled);
  setDisabled(restartBtn, !enabled);
  setDisabled(refreshBtn, !enabled);
  setDisabled(puzzleSelect, !enabled);
  setDisabled(leaderboardSelect, !enabled);
  setDisabled(loginBtn, !enabled);
  setDisabled(nicknameInput, !enabled);
}

// 简单的 HTML 转义，避免渲染时被当作标签
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 判断是否为可猜字符（与规则引擎保持一致）
function isGuessableChar(ch) {
  const isCjk = ch >= "\u4e00" && ch <= "\u9fff";
  const isDigit = ch >= "0" && ch <= "9";
  const isLetter = (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z");
  return isCjk || isDigit || isLetter;
}

// 将遮罩文本渲染到页面，并保持占位与真实字符等宽
function renderMaskedText(target, text, placeholder, guessedList) {
  if (!text) {
    target.textContent = "";
    return;
  }
  const guessedSet = new Set(guessedList || []);
  let html = "";
  for (const ch of text) {
    if (ch === "\n") {
      html += "<br />";
      continue;
    }
    if (placeholder && ch === placeholder) {
      html += '<span class="char-cell mask" aria-hidden="true">&nbsp;</span>';
      continue;
    }
    if (isGuessableChar(ch)) {
      if (guessedSet.has(ch)) {
        html += `<span class="char-cell hit">${escapeHtml(ch)}</span>`;
      } else {
        html += `<span class="char-cell plain">${escapeHtml(ch)}</span>`;
      }
      continue;
    }
    html += escapeHtml(ch);
  }
  target.innerHTML = html;
}

// 更新题库总体进度概览
function updateProgressSummary() {
  const counts = { 未开始: 0, 进行中: 0, 已完成: 0 };
  puzzlesCache.forEach((puzzle) => {
    const status = puzzle.status || "未开始";
    if (counts[status] !== undefined) {
      counts[status] += 1;
    }
  });
  progressSummary.textContent = `历史：未开始 ${counts["未开始"]} / 进行中 ${counts["进行中"]} / 已完成 ${counts["已完成"]}`;
}

// 重新渲染题目选择列表
function updatePuzzleOptions() {
  const currentValue = puzzleSelect.value;
  puzzleSelect.innerHTML = "";
  puzzlesCache.forEach((puzzle, index) => {
    const option = document.createElement("option");
    option.value = puzzle.id;
    const displayIndex = puzzle.index || index + 1;
    const displayStatus = puzzle.status || "未开始";
    const createdAt = formatDateOnly(puzzle.created_at);
    if (displayStatus === "已完成" && puzzle.title) {
      option.textContent = `第${displayIndex}题 · ${puzzle.title}（已完成）${createdAt ? ` · ${createdAt}` : ""}`;
    } else {
      option.textContent = `第${displayIndex}题（${displayStatus}）${createdAt ? ` · ${createdAt}` : ""}`;
    }
    puzzleSelect.appendChild(option);
  });
  if (currentValue) {
    puzzleSelect.value = currentValue;
  } else {
    const currentPuzzle = puzzlesCache.find((puzzle) => puzzle.is_current);
    if (currentPuzzle) {
      puzzleSelect.value = currentPuzzle.id;
    }
  }
  updateStartLabel();
  updateProgressSummary();
  updateLeaderboardOptions();
}

// 根据题目状态调整“开始/继续”按钮文案
function updateStartLabel() {
  const selected = puzzlesCache.find((puzzle) => puzzle.id === puzzleSelect.value);
  if (!selected) {
    startBtn.textContent = "开始游戏";
    return;
  }
  const status = selected.status || "未开始";
  if (status === "进行中") {
    startBtn.textContent = "继续游戏";
  } else if (status === "已完成") {
    startBtn.textContent = "查看结果";
  } else {
    startBtn.textContent = "开始游戏";
  }
}

function updateLeaderboardOptions() {
  const currentValue = leaderboardSelect.value;
  leaderboardSelect.innerHTML = "";
  if (!puzzlesCache.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无题目";
    leaderboardSelect.appendChild(option);
    leaderboardSelect.disabled = true;
    setLeaderboardHint("暂无题目");
    return;
  }

  puzzlesCache.forEach((puzzle, index) => {
    const option = document.createElement("option");
    option.value = puzzle.id;
    const displayIndex = puzzle.index || index + 1;
    const createdAt = formatDateOnly(puzzle.created_at);
    option.textContent = `第${displayIndex}题${createdAt ? ` · ${createdAt}` : ""}`;
    leaderboardSelect.appendChild(option);
  });

  leaderboardSelect.disabled = false;
  let nextValue = currentValue;
  if (!nextValue || !puzzlesCache.find((puzzle) => puzzle.id === nextValue)) {
    const currentPuzzle = puzzlesCache.find((puzzle) => puzzle.is_current) || puzzlesCache[0];
    nextValue = currentPuzzle ? currentPuzzle.id : "";
  }
  leaderboardSelect.value = nextValue;
  if (nextValue && nextValue !== currentValue) {
    loadLeaderboard(nextValue);
  }
}

function refreshLeaderboardIfComplete(state) {
  if (!state || !state.is_complete) {
    return;
  }
  const selectedId = leaderboardSelect.value;
  if (selectedId && state.puzzle_id === selectedId) {
    loadLeaderboard(selectedId);
  }
}

// 根据服务端状态渲染游戏内容与进度
function renderState(state) {
  currentState = state;
  if (!state) {
    renderMaskedText(contentMasked, "尚未开始\n请选择题目并开始。", "");
    guessCount.textContent = "0";
    titleRemaining.textContent = "0";
    wrongList.textContent = "无";
    puzzleStatus.textContent = "未开始";
    setInputEnabled(false);
    aiLogs = [];
    renderAiLog();
    if (aiLogs.length === 0) {
      aiLogExpanded = false;
      updateAiLogVisibility();
    }
    return;
  }

  const contentText = state.body_masked
    ? `${state.title_masked}\n${state.body_masked}`
    : state.title_masked || "";
  renderMaskedText(contentMasked, contentText, state.placeholder, state.guessed_correct);
  guessCount.textContent = String(state.guess_count);
  titleRemaining.textContent = String(state.title_remaining);
  wrongList.textContent = state.guessed_wrong && state.guessed_wrong.length
    ? state.guessed_wrong.join("、")
    : "无";

  const statusItem = puzzlesCache.find((puzzle) => puzzle.id === state.puzzle_id);
  if (statusItem) {
    puzzleStatus.textContent = statusItem.status || "未开始";
  } else {
    puzzleStatus.textContent = state.is_complete ? "已完成" : "进行中";
  }

  if (state.is_complete) {
    setInputEnabled(false);
    setMessage(`恭喜你完成本题！最终次数：${state.guess_count}。`, "good");
  } else {
    if (!aiRunning) {
      setInputEnabled(true);
    }
  }
}

// 统一的 JSON 请求封装
async function requestJson(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-Session-Id": getSessionId(),
    ...(options.headers || {}),
  };
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.message || "请求失败");
  }
  return data;
}

// 拉取题目列表并刷新选择框与统计
async function loadPuzzles() {
  try {
    const data = await requestJson("/api/puzzles");
    puzzlesCache = data.puzzles || [];
    updatePuzzleOptions();
    if (!puzzlesCache.length) {
      setMessage("没有可用题目，请先在 data/puzzles/ 中添加。", "bad");
    }
  } catch (error) {
    setMessage(`读取题目失败：${error.message}`, "bad");
  }
}

// 开始或继续当前选中的题目
async function startGame() {
  if (!requireLogin()) {
    return;
  }
  const puzzleId = puzzleSelect.value || null;
  if (!puzzleId) {
    setMessage("没有可用题目，请先添加题目。", "bad");
    return;
  }
  const selected = puzzlesCache.find((puzzle) => puzzle.id === puzzleId);
  if (selected && selected.status === "已完成" && currentState && currentState.puzzle_id === puzzleId) {
    setMessage("本题已完成，如需重玩请点击重新开始。", "good");
    return;
  }
  try {
    const data = await requestJson("/api/start", {
      method: "POST",
      body: JSON.stringify({ puzzle_id: puzzleId, mode: "resume" }),
    });
    aiLogs = [];
    renderAiLog();
    renderState(data.state);
    if (selected && selected.status === "已完成") {
      setMessage("本题已完成，如需重玩请点击重新开始。", "good");
    } else {
      setMessage("游戏已开始，祝你猜对！", "good");
    }
    guessInput.value = "";
    guessInput.focus();
    await loadPuzzles();
  } catch (error) {
    setMessage(`开始失败：${error.message}`, "bad");
  }
}

// 强制重开当前题目
async function restartGame() {
  if (!requireLogin()) {
    return;
  }
  if (!puzzleSelect.value) {
    setMessage("请先选择题目。", "bad");
    return;
  }
  try {
    const data = await requestJson("/api/start", {
      method: "POST",
      body: JSON.stringify({ puzzle_id: puzzleSelect.value, mode: "restart" }),
    });
    aiLogs = [];
    renderAiLog();
    renderState(data.state);
    setMessage("已重新开始本题。", "good");
    guessInput.value = "";
    guessInput.focus();
    await loadPuzzles();
  } catch (error) {
    setMessage(`重开失败：${error.message}`, "bad");
  }
}

// 提交一个猜测字
async function submitGuess() {
  if (!requireLogin()) {
    return;
  }
  if (!currentState) {
    setMessage("请先开始游戏。", "bad");
    return;
  }
  if (currentState.is_complete) {
    setMessage("本局已完成，可重新开始。", "good");
    return;
  }

  const raw = guessInput.value.trim();
  if (!isValidGuessInput(raw)) {
    setMessage("请输入单个汉字、数字或字母。", "bad");
    return;
  }

  try {
    const data = await requestJson("/api/guess", {
      method: "POST",
      body: JSON.stringify({ ch: raw }),
    });
    const result = data.result;
    renderState(result.state);
    if (result.state && result.state.is_complete) {
      setMessage(`恭喜你完成本题！最终次数：${result.state.guess_count}。`, "good");
      refreshLeaderboardIfComplete(result.state);
    } else if (result.status === "correct") {
      setMessage("命中！继续加油。", "good");
    } else if (result.status === "wrong") {
      setMessage("猜错了，换个字试试。", "bad");
    } else if (result.status === "repeat") {
      setMessage("这个字已经猜过了，不计次数。", "bad");
    } else if (result.status === "finished") {
      setMessage("本局已完成，次数已固定。", "good");
    } else {
      setMessage("请输入单个汉字、数字或字母。", "bad");
    }
    guessInput.value = "";
    guessInput.focus();
    updateGuessButtonState();
    await loadPuzzles();
  } catch (error) {
    setMessage(`提交失败：${error.message}`, "bad");
  }
}

// 获取当前题目状态（刷新页面时使用）
async function refreshState() {
  if (!isLoggedIn()) {
    renderState(null);
    return;
  }
  try {
    const data = await requestJson("/api/state");
    renderState(data.state);
    refreshLeaderboardIfComplete(data.state);
  } catch (error) {
    if (String(error.message).includes("登录")) {
      renderState(null);
      setMessage(error.message, "bad");
      return;
    }
    setMessage(`读取状态失败：${error.message}`, "bad");
  }
}

async function loadCurrentUser() {
  try {
    const data = await requestJson("/api/me");
    applyLoginState(data.user);
    if (data.user && data.user.nickname && !nicknameInput.value.trim()) {
      nicknameInput.value = data.user.nickname;
    }
    if (isLoggedIn()) {
      await refreshState();
    }
  } catch (error) {
    console.warn("[account] 获取当前用户失败", error);
    applyLoginState(null);
  }
}

async function login() {
  const nickname = nicknameInput.value.trim();
  if (!nickname) {
    setMessage("昵称不能为空。", "bad");
    return;
  }
  if (nickname.length > 20) {
    setMessage("昵称长度不能超过 20。", "bad");
    return;
  }
  try {
    const data = await requestJson("/api/login", {
      method: "POST",
      body: JSON.stringify({ nickname }),
    });
    applyLoginState(data.user);
    nicknameInput.value = data.user.nickname || nickname;
    setMessage(`已登录：${data.user.nickname}`, "good");
    await loadPuzzles();
    await refreshState();
    if (leaderboardSelect.value) {
      loadLeaderboard(leaderboardSelect.value);
    }
  } catch (error) {
    console.error("[account] 登录失败", error);
    setMessage(`登录失败：${error.message}`, "bad");
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderAiLog() {
  if (!aiLogs.length) {
    aiLog.textContent = "暂无";
    return;
  }
  aiLog.textContent = "";
  aiLogs.forEach((item, index) => {
    let statusText = item.status;
    if (item.status === "correct") {
      statusText = "命中";
    } else if (item.status === "wrong") {
      statusText = "未命中";
    } else if (item.status === "repeat") {
      statusText = "重复";
    } else if (item.status === "invalid") {
      statusText = "非法";
    }
    const line = document.createElement("div");
    line.className = "ai-log-line";
    line.textContent = `第${index + 1}步：猜“${item.guess}” - ${statusText}。理由：${item.reason}`;
    aiLog.appendChild(line);
  });
}

function updateAiLogVisibility() {
  if (!aiTrace || !aiToggleBtn) {
    return;
  }
  aiTrace.classList.toggle("is-collapsed", !aiLogExpanded);
  aiToggleBtn.textContent = aiLogExpanded ? "收起" : "展开";
}

async function aiStep(aiConfig) {
  const data = await requestJson("/api/ai/step", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (data.done) {
    renderState(data.state);
    refreshLeaderboardIfComplete(data.state);
    setMessage("AI 已完成最短解。", "good");
    return false;
  }
  const result = data.result;
  renderState(result.state);
  aiLogs.push({
    guess: data.guess,
    reason: data.reason || "未提供原因。",
    status: result.status,
  });
  renderAiLog();
  console.log("[AI] 猜测", data.guess, result.status, data.reason);
  refreshLeaderboardIfComplete(result.state);
  if (result.status === "correct") {
    setMessage(`AI 猜测：${data.guess}（命中）`, "good");
  } else if (result.status === "wrong") {
    setMessage(`AI 猜测：${data.guess}（未命中）`, "bad");
  } else if (result.status === "repeat") {
    setMessage(`AI 猜测：${data.guess}（重复，不计次数）`, "bad");
  } else if (result.status === "invalid") {
    setMessage(`AI 猜测：${data.guess}（非法，不计次数）`, "bad");
  } else {
    setMessage(`AI 猜测：${data.guess}`, "good");
  }
  await loadPuzzles();
  return true;
}

async function runAiAuto() {
  if (!requireLogin()) {
    return;
  }
  if (!currentState) {
    setMessage("请先开始游戏。", "bad");
    return;
  }
  if (currentState.is_complete) {
    setMessage("本题已完成。", "good");
    return;
  }
  const configured = await hasAiConfig();
  if (!configured) {
    setMessage("请先在管理员页面配置 AI（Base URL/模型/Key）。", "bad");
    return;
  }
  if (aiRunning) {
    aiRunning = false;
    aiBtn.textContent = "AI 最短解";
    setAiControlsEnabled(true);
    if (currentState && !currentState.is_complete) {
      setInputEnabled(true);
    }
    setMessage("AI 已停止。", "bad");
    return;
  }

  aiRunning = true;
  aiBtn.textContent = "停止 AI";
  setInputEnabled(false);
  setAiControlsEnabled(false);

  while (aiRunning) {
    try {
      const keepGoing = await aiStep();
      if (!keepGoing) {
        break;
      }
      await delay(350);
    } catch (error) {
      console.error("[AI] 运行失败", error);
      setMessage(`AI 运行失败：${error.message}`, "bad");
      break;
    }
  }

  aiRunning = false;
  aiBtn.textContent = "AI 最短解";
  setAiControlsEnabled(true);
  if (currentState && !currentState.is_complete) {
    setInputEnabled(true);
  }
}

startBtn.addEventListener("click", () => {
  startGame();
});

restartBtn.addEventListener("click", () => {
  restartGame();
});

refreshBtn.addEventListener("click", () => {
  loadPuzzles();
});

loginBtn.addEventListener("click", () => {
  login();
});

if (loginNoticeBtn) {
  loginNoticeBtn.addEventListener("click", () => {
    if (accountPanel) {
      accountPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (nicknameInput) {
      nicknameInput.focus();
    }
  });
}

guessBtn.addEventListener("click", () => {
  submitGuess();
});

aiBtn.addEventListener("click", () => {
  runAiAuto();
});

if (aiToggleBtn) {
  aiToggleBtn.addEventListener("click", () => {
    aiLogExpanded = !aiLogExpanded;
    updateAiLogVisibility();
  });
}

nicknameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    login();
  }
});

leaderboardSelect.addEventListener("change", () => {
  loadLeaderboard(leaderboardSelect.value);
});
guessInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    submitGuess();
  }
});

guessInput.addEventListener("input", () => {
  updateGuessButtonState();
});

puzzleSelect.addEventListener("change", () => {
  updateStartLabel();
  const selectedId = puzzleSelect.value;
  if (selectedId) {
    leaderboardSelect.value = selectedId;
    loadLeaderboard(selectedId);
    startGame();
  }
});

// 页面初始化：加载题目并尝试恢复状态
applyLoginState(null);
loadPuzzles().then(() => loadCurrentUser());
updateAiLogVisibility();
