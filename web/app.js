// 页面交互脚本：负责拉取题目、提交猜测、渲染状态

const puzzleSelect = document.getElementById("puzzleSelect");
const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");
const guessInput = document.getElementById("guessInput");
const guessBtn = document.getElementById("guessBtn");
const hintBtn = document.getElementById("hintBtn");
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
const filterUnfinishedBtn = document.getElementById("filterUnfinishedBtn");
const loginBadge = document.getElementById("loginBadge");
const loginNotice = document.getElementById("loginNotice");
const loginNoticeBtn = document.getElementById("loginNoticeBtn");
const accountPanel = document.getElementById("accountPanel");
const aiAccessInput = document.getElementById("aiAccessInput");
const aiAccessSaveLocalBtn = document.getElementById("aiAccessSaveLocalBtn");
const aiAccessLocalHint = document.getElementById("aiAccessLocalHint");
const checkinBtn = document.getElementById("checkinBtn");
const checkinStatus = document.getElementById("checkinStatus");
const authorStatsList = document.getElementById("authorStatsList");
const authorStatsEmpty = document.getElementById("authorStatsEmpty");
const authorToggleBtn = document.getElementById("authorToggleBtn");
const authorStatsWrap = document.getElementById("authorStatsWrap");
const dailyStartBtn = document.getElementById("dailyStartBtn");
const dailyHint = document.getElementById("dailyHint");
const dailyBoardRefreshBtn = document.getElementById("dailyBoardRefreshBtn");
const dailyLeaderboardList = document.getElementById("dailyLeaderboardList");
const dailyLeaderboardEmpty = document.getElementById("dailyLeaderboardEmpty");
const dailyTrendBars = document.getElementById("dailyTrendBars");
const dailyBoardMeta = document.getElementById("dailyBoardMeta");
const difficultyPanel = document.getElementById("difficultyPanel");
const difficultyStatus = document.getElementById("difficultyStatus");
const difficultyToggleBtn = document.getElementById("difficultyToggleBtn");
const difficultyBoardWrap = document.getElementById("difficultyBoardWrap");
const difficultyBoardList = document.getElementById("difficultyBoardList");
const difficultyBoardEmpty = document.getElementById("difficultyBoardEmpty");
const overallToggleBtn = document.getElementById("overallToggleBtn");
const overallWrap = document.getElementById("overallWrap");
const overallList = document.getElementById("overallList");
const overallEmpty = document.getElementById("overallEmpty");

let puzzlesCache = [];
let currentState = null;
let aiRunning = false;
let aiLogs = [];
let currentUserInfo = null;
let aiLogExpanded = false;
let authorStatsExpanded = false;
let authorStatsCache = [];
let dailyPuzzleId = "";
let dailyDate = "";
let dailyIndex = 0;
let dailyCompletionCount = 0;
let filterUnfinishedOnly = false;
let difficultyBoardExpanded = false;
let difficultyBoardCache = [];
let overallExpanded = false;
let overallCache = [];
let currentDifficulty = "";
let lastDifficultyPuzzleId = "";
let freeHintCount = 0;

const SESSION_KEY = "guess_game_session_id";
const AI_ACCESS_KEY = "guess_ai_access_code";

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
    return {
      configured: Boolean(data.configured),
      access_configured: Boolean(data.access_configured),
    };
  } catch (error) {
    console.warn("[AI] 配置读取失败", error);
    return { configured: false, access_configured: false };
  }
}

function getLocalAiAccessCode() {
  return localStorage.getItem(AI_ACCESS_KEY) || "";
}

function setLocalAiAccessCode(code) {
  localStorage.setItem(AI_ACCESS_KEY, code);
}

function renderAiAccessHint() {
  if (!aiAccessLocalHint) {
    return;
  }
  const code = getLocalAiAccessCode();
  aiAccessLocalHint.textContent = code ? "已填写" : "未填写";
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
  updateHintButtonState();
  if (!loggedIn) {
    freeHintCount = 0;
    setCheckinStatus("未登录");
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

function renderLeaderboardItems(entries, listEl, emptyEl, maxItems = null) {
  if (!listEl || !emptyEl) {
    return;
  }
  listEl.innerHTML = "";
  if (!entries || !entries.length) {
    emptyEl.textContent = "暂无成绩";
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";
  const list = maxItems ? entries.slice(0, maxItems) : entries;
  list.forEach((entry, index) => {
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
    listEl.appendChild(item);
  });
}

function renderLeaderboard(entries) {
  renderLeaderboardItems(entries, leaderboardList, leaderboardEmpty);
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

function updateHintButtonLabel() {
  if (!hintBtn) {
    return;
  }
  if (freeHintCount > 0) {
    hintBtn.textContent = "提示（免费）";
    return;
  }
  const paidHints = currentState ? Number(currentState.paid_hints_used) || 0 : 0;
  const penalty = 2 + paidHints;
  hintBtn.textContent = `提示（+${penalty}）`;
}

function updateHintButtonState() {
  if (!hintBtn) {
    return;
  }
  const allow = isLoggedIn() && currentState && !currentState.is_complete && !aiRunning;
  hintBtn.disabled = !allow;
  updateHintButtonLabel();
}

function setCheckinStatus(text) {
  if (!checkinStatus) {
    return;
  }
  checkinStatus.textContent = text;
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
  setDisabled(hintBtn, !enabled);
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

function updateFilterUnfinishedState() {
  if (!filterUnfinishedBtn) {
    return;
  }
  filterUnfinishedBtn.classList.toggle("is-active", filterUnfinishedOnly);
  filterUnfinishedBtn.setAttribute("aria-pressed", String(filterUnfinishedOnly));
  filterUnfinishedBtn.textContent = filterUnfinishedOnly ? "只看未完成：开" : "只看未完成";
}

function getPuzzleDisplayList() {
  let list = puzzlesCache.slice();
  if (filterUnfinishedOnly) {
    list = list.filter((puzzle) => (puzzle.status || "未开始") !== "已完成");
  }
  if (dailyPuzzleId) {
    const dailyItem = list.find((puzzle) => puzzle.id === dailyPuzzleId);
    if (dailyItem) {
      return [dailyItem, ...list.filter((puzzle) => puzzle.id !== dailyPuzzleId)];
    }
  }
  return list;
}

// 重新渲染题目选择列表
function updatePuzzleOptions() {
  const currentValue = puzzleSelect.value;
  puzzleSelect.innerHTML = "";
  const displayList = getPuzzleDisplayList();
  displayList.forEach((puzzle, index) => {
    const option = document.createElement("option");
    option.value = puzzle.id;
    const displayIndex = puzzle.index || index + 1;
    const displayStatus = puzzle.status || "未开始";
    const createdAt = formatDateOnly(puzzle.created_at);
    const isDaily = dailyPuzzleId && puzzle.id === dailyPuzzleId;
    const tags = [];
    if (isDaily) {
      tags.push("今日挑战");
    }
    if (displayStatus === "已完成") {
      tags.push("已完成");
    } else if (displayStatus === "进行中") {
      tags.push("进行中");
    }
    if (isDaily) {
      option.style.color = "#c8643c";
      option.style.fontWeight = "600";
    } else if (displayStatus === "已完成") {
      option.style.color = "#1f7b6f";
    } else if (displayStatus === "进行中") {
      option.style.color = "#9a4b2d";
    }
    const baseTitle = displayStatus === "已完成" && puzzle.title
      ? `第${displayIndex}题 · ${puzzle.title}`
      : `第${displayIndex}题`;
    const timeLabel = createdAt ? ` · ${createdAt}` : "";
    const tagLabel = tags.length ? ` · ${tags.join(" · ")}` : "";
    option.textContent = `${baseTitle}${timeLabel}${tagLabel}`;
    puzzleSelect.appendChild(option);
  });
  if (currentValue && displayList.find((puzzle) => puzzle.id === currentValue)) {
    puzzleSelect.value = currentValue;
  } else {
    const dailyItem = displayList.find((puzzle) => puzzle.id === dailyPuzzleId);
    const currentPuzzle = displayList.find((puzzle) => puzzle.is_current);
    const nextPuzzle = dailyItem || currentPuzzle || displayList[0];
    if (nextPuzzle) {
      puzzleSelect.value = nextPuzzle.id;
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
    const isDaily = dailyPuzzleId && puzzle.id === dailyPuzzleId;
    const dailyTag = isDaily ? " · 今日挑战" : "";
    option.textContent = `第${displayIndex}题${createdAt ? ` · ${createdAt}` : ""}${dailyTag}`;
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
  if (dailyPuzzleId && state.puzzle_id === dailyPuzzleId) {
    loadDailyLeaderboard();
    loadDailyTrend();
  }
  loadAuthorStats();
  loadDifficultyBoard();
  loadOverallLeaderboard();
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
    updateDifficultyPanel(null);
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
  updateDifficultyPanel(state);
  updateHintButtonState();
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
    loadDailyChallenge();
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
      await loadCheckinStatus();
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
    await loadCheckinStatus();
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

function formatRate(numerator, denominator) {
  const base = Number(denominator) || 0;
  if (!base) {
    return "—";
  }
  const rate = (Number(numerator) || 0) / base;
  return `${Math.round(rate * 100)}%`;
}

function formatFixed(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "—";
  }
  return num.toFixed(digits);
}

function appendBoardKpi(container, label, value) {
  const item = document.createElement("span");
  item.className = "board-kpi";
  const kLabel = document.createElement("span");
  kLabel.className = "board-kpi-label";
  kLabel.textContent = label;
  const kValue = document.createElement("span");
  kValue.className = "board-kpi-value";
  kValue.textContent = String(value);
  item.append(kLabel, kValue);
  container.appendChild(item);
}

function updateAuthorStatsVisibility() {
  if (!authorStatsWrap || !authorToggleBtn) {
    return;
  }
  authorStatsWrap.classList.toggle("is-collapsed", !authorStatsExpanded);
  authorToggleBtn.textContent = authorStatsExpanded ? "收起" : "展开";
}

async function loadAuthorStats() {
  if (!authorStatsList || !authorStatsEmpty) {
    return;
  }
  try {
    const data = await requestJson("/api/author_stats");
    authorStatsCache = data.stats || [];
    renderAuthorStats();
  } catch (error) {
    authorStatsList.innerHTML = "";
    authorStatsEmpty.textContent = "加载失败";
    authorStatsEmpty.classList.remove("is-hidden");
  }
}

function renderAuthorStats() {
  if (!authorStatsList || !authorStatsEmpty) {
    return;
  }
  authorStatsList.innerHTML = "";
  if (!authorStatsCache.length) {
    authorStatsEmpty.textContent = "暂无数据";
    authorStatsEmpty.classList.remove("is-hidden");
    return;
  }
  authorStatsEmpty.classList.add("is-hidden");
  authorStatsCache.forEach((stat, index) => {
    const item = document.createElement("li");
    item.className = "leaderboard-item board-item";
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
    const nameWrap = document.createElement("div");
    nameWrap.className = "leaderboard-name board-name";
    const title = document.createElement("div");
    title.className = "board-title";
    title.textContent = stat.author_name || "(未命名)";
    const startedRaw = Number(stat.started_players) || 0;
    const completed = Number(stat.completion_count) || 0;
    const started = Math.max(startedRaw, completed);
    const sub = document.createElement("div");
    sub.className = "board-sub";
    sub.textContent = `通关 ${completed} · 完成率 ${formatRate(completed, started)} · 放弃率 ${formatRate(
      started - completed,
      started
    )}`;
    nameWrap.append(title, sub);
    const metric = document.createElement("div");
    metric.className = "board-metric";
    metric.textContent = `出题 ${stat.puzzle_count ?? 0}`;
    row.append(rank, nameWrap, metric);

    const kpis = document.createElement("div");
    kpis.className = "board-kpis";
    appendBoardKpi(kpis, "开局", started);
    appendBoardKpi(kpis, "尝试", stat.attempt_count ?? 0);
    appendBoardKpi(kpis, "平均猜测", formatFixed(stat.avg_guesses, 1));

    const foot = document.createElement("div");
    foot.className = "board-foot";
    foot.textContent = `最近通关：${formatTimestamp(stat.last_completed) || "暂无"}`;

    item.append(row, kpis, foot);
    authorStatsList.appendChild(item);
  });
}

function formatDuration(seconds) {
  const num = Number(seconds);
  if (!Number.isFinite(num)) {
    return "—";
  }
  const total = Math.max(0, Math.round(num));
  if (total < 60) {
    return `${total}s`;
  }
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  if (minutes < 60) {
    return `${minutes}m${String(remain).padStart(2, "0")}s`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h${String(mins).padStart(2, "0")}m`;
}

function mapDifficultyLabel(value) {
  if (value === "easy" || value === 1) {
    return "简单";
  }
  if (value === "medium" || value === 2) {
    return "中等";
  }
  if (value === "hard" || value === 3) {
    return "困难";
  }
  return "未设置";
}

function mapDifficultyValue(raw) {
  if (raw === 1 || raw === "1") {
    return "easy";
  }
  if (raw === 2 || raw === "2") {
    return "medium";
  }
  if (raw === 3 || raw === "3") {
    return "hard";
  }
  return "";
}

function updateDifficultyBoardVisibility() {
  if (!difficultyBoardWrap || !difficultyToggleBtn) {
    return;
  }
  difficultyBoardWrap.classList.toggle("is-collapsed", !difficultyBoardExpanded);
  difficultyToggleBtn.textContent = difficultyBoardExpanded ? "收起" : "展开";
}

async function loadDifficultyBoard() {
  if (!difficultyBoardList || !difficultyBoardEmpty) {
    return;
  }
  try {
    const data = await requestJson("/api/difficulty/board");
    difficultyBoardCache = data.stats || [];
    renderDifficultyBoard();
  } catch (error) {
    difficultyBoardList.innerHTML = "";
    difficultyBoardEmpty.textContent = "加载失败";
    difficultyBoardEmpty.classList.remove("is-hidden");
  }
}

function renderDifficultyBoard() {
  if (!difficultyBoardList || !difficultyBoardEmpty) {
    return;
  }
  difficultyBoardList.innerHTML = "";
  if (!difficultyBoardCache.length) {
    difficultyBoardEmpty.textContent = "暂无数据";
    difficultyBoardEmpty.classList.remove("is-hidden");
    return;
  }
  difficultyBoardEmpty.classList.add("is-hidden");
  difficultyBoardCache.forEach((stat, index) => {
    const item = document.createElement("li");
    item.className = "leaderboard-item board-item";
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
    const nameWrap = document.createElement("div");
    nameWrap.className = "leaderboard-name board-name";
    const title = document.createElement("div");
    title.className = "board-title";
    const indexLabel = stat.index ? `第${stat.index}题` : "未编号";
    title.textContent = `${indexLabel} · ${mapDifficultyLabel(stat.admin_difficulty)}`;
    const avgDifficulty = formatFixed(stat.avg_difficulty, 2);
    const sub = document.createElement("div");
    sub.className = "board-sub";
    sub.textContent = `玩家评分 ${avgDifficulty} · 评价 ${stat.vote_count ?? 0} · 尝试 ${stat.attempt_count ?? 0}`;
    nameWrap.append(title, sub);
    const metric = document.createElement("div");
    metric.className = "board-metric";
    metric.textContent = `评分 ${avgDifficulty}`;
    row.append(rank, nameWrap, metric);

    const startedRaw = Number(stat.started_players) || 0;
    const completed = Number(stat.completion_count) || 0;
    const started = Math.max(startedRaw, completed);
    const totalGuesses = Number(stat.total_guesses) || 0;
    const correctGuesses = Number(stat.correct_guesses) || 0;

    const kpis = document.createElement("div");
    kpis.className = "board-kpis";
    appendBoardKpi(kpis, "完成率", formatRate(completed, started));
    appendBoardKpi(kpis, "平均猜测", formatFixed(stat.avg_guesses, 1));
    appendBoardKpi(kpis, "平均用时", formatDuration(stat.avg_duration));
    appendBoardKpi(kpis, "命中率", formatRate(correctGuesses, totalGuesses));

    const foot = document.createElement("div");
    foot.className = "board-foot";
    foot.textContent = `创建时间：${formatDateOnly(stat.created_at) || "未知"}`;
    item.append(row, kpis, foot);
    difficultyBoardList.appendChild(item);
  });
}

function updateOverallVisibility() {
  if (!overallWrap || !overallToggleBtn) {
    return;
  }
  overallWrap.classList.toggle("is-collapsed", !overallExpanded);
  overallToggleBtn.textContent = overallExpanded ? "收起" : "展开";
}

async function loadOverallLeaderboard() {
  if (!overallList || !overallEmpty) {
    return;
  }
  try {
    const data = await requestJson("/api/overall_leaderboard");
    overallCache = data.stats || [];
    renderOverallLeaderboard();
  } catch (error) {
    overallList.innerHTML = "";
    overallEmpty.textContent = "加载失败";
    overallEmpty.classList.remove("is-hidden");
  }
}

function renderOverallLeaderboard() {
  if (!overallList || !overallEmpty) {
    return;
  }
  overallList.innerHTML = "";
  if (!overallCache.length) {
    overallEmpty.textContent = "暂无数据";
    overallEmpty.classList.remove("is-hidden");
    return;
  }
  overallEmpty.classList.add("is-hidden");
  overallCache.forEach((stat, index) => {
    const item = document.createElement("li");
    item.className = "leaderboard-item board-item";
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
    const nameWrap = document.createElement("div");
    nameWrap.className = "leaderboard-name board-name";
    const title = document.createElement("div");
    title.className = "board-title";
    title.textContent = stat.nickname || "(未命名)";
    const totalGuesses = Number(stat.total_guesses) || 0;
    const correctGuesses = Number(stat.correct_guesses) || 0;
    const avgGuesses = formatFixed(stat.avg_guesses, 1);
    const sub = document.createElement("div");
    sub.className = "board-sub";
    sub.textContent = `平均猜测 ${avgGuesses} · 平均用时 ${formatDuration(stat.avg_duration)} · 命中率 ${formatRate(
      correctGuesses,
      totalGuesses
    )}`;
    nameWrap.append(title, sub);
    const metric = document.createElement("div");
    metric.className = "board-metric";
    metric.textContent = `通关 ${stat.completion_count ?? 0}`;
    row.append(rank, nameWrap, metric);

    const kpis = document.createElement("div");
    kpis.className = "board-kpis";
    appendBoardKpi(kpis, "总猜测", totalGuesses);
    appendBoardKpi(kpis, "正确", correctGuesses);

    item.append(row, kpis);
    overallList.appendChild(item);
  });
}

function updateDailyBoardMeta() {
  if (!dailyBoardMeta) {
    return;
  }
  const countLabel = `今日完成 ${dailyCompletionCount}`;
  const indexLabel = dailyIndex ? `第${dailyIndex}题` : "今日题目";
  dailyBoardMeta.textContent = `${countLabel} · ${indexLabel}`;
}

async function loadDailyChallenge() {
  if (!dailyHint) {
    return;
  }
  try {
    const data = await requestJson("/api/daily");
    const prevDate = dailyDate;
    dailyPuzzleId = data.puzzle_id || "";
    dailyDate = data.date || "";
    dailyIndex = data.index || 0;
    if (prevDate && dailyDate !== prevDate) {
      dailyCompletionCount = 0;
    }
    const indexLabel = data.index ? `第${data.index}题` : "今日题目";
    const createdAt = formatDateOnly(data.created_at);
    dailyHint.textContent = `${dailyDate} · ${indexLabel}${createdAt ? ` · ${createdAt}` : ""}`;
    updateDailyBoardMeta();
    updatePuzzleOptions();
    loadDailyLeaderboard();
    loadDailyTrend();
  } catch (error) {
    dailyHint.textContent = String(error.message || "今日挑战加载失败");
  }
}

async function loadDailyLeaderboard() {
  if (!dailyLeaderboardList || !dailyLeaderboardEmpty) {
    return;
  }
  try {
    const data = await requestJson("/api/daily/leaderboard?limit=5");
    dailyPuzzleId = data.puzzle_id || dailyPuzzleId;
    dailyDate = data.date || dailyDate;
    dailyCompletionCount = Number(data.count) || 0;
    updateDailyBoardMeta();
    renderLeaderboardItems(data.entries || [], dailyLeaderboardList, dailyLeaderboardEmpty, 5);
  } catch (error) {
    dailyCompletionCount = 0;
    updateDailyBoardMeta();
    dailyLeaderboardEmpty.textContent = String(error.message || "加载失败");
    dailyLeaderboardEmpty.style.display = "block";
    dailyLeaderboardList.innerHTML = "";
  }
}

async function loadDailyTrend() {
  if (!dailyTrendBars) {
    return;
  }
  try {
    const data = await requestJson("/api/daily/trend?days=7");
    const items = data.items || [];
    const counts = items.map((item) => Number(item.count) || 0);
    const maxCount = Math.max(1, ...counts);
    dailyTrendBars.innerHTML = "";
    items.forEach((item) => {
      const wrap = document.createElement("div");
      wrap.className = "trend-item";
      const bar = document.createElement("div");
      bar.className = "trend-bar";
      const height = Math.round((Number(item.count) || 0) / maxCount * 28) + 6;
      bar.style.height = `${height}px`;
      bar.title = `${item.date} · ${item.count} 完成`;
      const label = document.createElement("div");
      label.className = "trend-label";
      label.textContent = (item.date || "").slice(5);
      wrap.append(bar, label);
      dailyTrendBars.appendChild(wrap);
    });
  } catch (error) {
    dailyTrendBars.innerHTML = "";
  }
}

async function loadCheckinStatus() {
  if (!isLoggedIn()) {
    freeHintCount = 0;
    setCheckinStatus("未登录");
    updateHintButtonState();
    return;
  }
  try {
    const data = await requestJson("/api/checkin");
    freeHintCount = Number(data.free_hints) || 0;
    if (data.claimed) {
      setCheckinStatus(freeHintCount > 0 ? `已签到 · 剩余 ${freeHintCount}` : "已签到 · 已使用");
    } else {
      setCheckinStatus("未签到");
    }
  } catch (error) {
    setCheckinStatus("签到状态异常");
  }
  updateHintButtonState();
}

async function claimCheckin() {
  if (!requireLogin()) {
    return;
  }
  try {
    const data = await requestJson("/api/checkin", { method: "POST", body: JSON.stringify({}) });
    freeHintCount = Number(data.free_hints) || 0;
    setCheckinStatus(freeHintCount > 0 ? `已签到 · 剩余 ${freeHintCount}` : "已签到");
    updateHintButtonState();
    setMessage("签到成功，已获得提示卡。", "good");
  } catch (error) {
    setMessage(`签到失败：${error.message}`, "bad");
  }
}

async function useHint() {
  if (!requireLogin()) {
    return;
  }
  if (!currentState) {
    setMessage("请先开始游戏。", "bad");
    return;
  }
  if (currentState.is_complete) {
    setMessage("本题已完成，无需提示。", "good");
    return;
  }
  try {
    const data = await requestJson("/api/hint", { method: "POST", body: JSON.stringify({}) });
    renderState(data.state);
    refreshLeaderboardIfComplete(data.state);
    if (data.free_used) {
      freeHintCount = Math.max(0, freeHintCount - 1);
      setCheckinStatus(freeHintCount > 0 ? `已签到 · 剩余 ${freeHintCount}` : "已签到 · 已使用");
      setMessage(`揭示正文字：${data.revealed}（免费提示）`, "good");
    } else {
      setMessage(`揭示正文字：${data.revealed}（扣 ${data.penalty} 分）`, "bad");
    }
    updateHintButtonState();
  } catch (error) {
    setMessage(`提示失败：${error.message}`, "bad");
  }
}

function setDifficultyStatus(text) {
  if (!difficultyStatus) {
    return;
  }
  difficultyStatus.textContent = text;
}

function updateDifficultyPanel(state) {
  if (!difficultyPanel) {
    return;
  }
  if (!state || !state.is_complete) {
    difficultyPanel.classList.add("is-hidden");
    lastDifficultyPuzzleId = "";
    currentDifficulty = "";
    setDifficultyStatus("未评价");
    return;
  }
  difficultyPanel.classList.remove("is-hidden");
  if (state.puzzle_id && state.puzzle_id !== lastDifficultyPuzzleId) {
    lastDifficultyPuzzleId = state.puzzle_id;
    loadMyDifficulty(state.puzzle_id);
  }
}

async function loadMyDifficulty(puzzleId) {
  if (!puzzleId) {
    return;
  }
  try {
    const data = await requestJson(`/api/difficulty/mine?puzzle_id=${encodeURIComponent(puzzleId)}`);
    currentDifficulty = mapDifficultyValue(data.difficulty);
  } catch (error) {
    currentDifficulty = "";
  }
  setDifficultyStatus(currentDifficulty ? `已评价：${mapDifficultyLabel(currentDifficulty)}` : "未评价");
}

async function submitDifficulty(puzzleId, difficulty) {
  if (!puzzleId) {
    return;
  }
  try {
    await requestJson("/api/difficulty/vote", {
      method: "POST",
      body: JSON.stringify({ puzzle_id: puzzleId, difficulty }),
    });
    currentDifficulty = difficulty;
    setDifficultyStatus(`已评价：${mapDifficultyLabel(difficulty)}`);
    loadDifficultyBoard();
  } catch (error) {
    setMessage(`难度评价失败：${error.message}`, "bad");
  }
}

async function aiStep() {
  const accessCode = getLocalAiAccessCode();
  const data = await requestJson("/api/ai/step", {
    method: "POST",
    headers: accessCode ? { "X-AI-Access-Code": accessCode } : {},
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
  const configStatus = await hasAiConfig();
  if (!configStatus.configured) {
    setMessage("请先在管理员页面配置 AI（Base URL/模型/Key）。", "bad");
    return;
  }
  if (!configStatus.access_configured) {
    setMessage("AI 访问码尚未设置，请联系管理员。", "bad");
    return;
  }
  if (!getLocalAiAccessCode()) {
    setMessage("请输入 AI 访问码后再使用 AI。", "bad");
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

if (filterUnfinishedBtn) {
  filterUnfinishedBtn.addEventListener("click", () => {
    filterUnfinishedOnly = !filterUnfinishedOnly;
    updateFilterUnfinishedState();
    updatePuzzleOptions();
  });
}

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

if (aiAccessSaveLocalBtn) {
  aiAccessSaveLocalBtn.addEventListener("click", () => {
    if (!aiAccessInput) {
      return;
    }
    const code = aiAccessInput.value.trim();
    if (!code) {
      setMessage("AI 访问码不能为空。", "bad");
      return;
    }
    setLocalAiAccessCode(code);
    aiAccessInput.value = "";
    renderAiAccessHint();
    setMessage("AI 访问码已保存。", "good");
  });
}

if (hintBtn) {
  hintBtn.addEventListener("click", () => {
    useHint();
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

if (authorToggleBtn) {
  authorToggleBtn.addEventListener("click", () => {
    authorStatsExpanded = !authorStatsExpanded;
    updateAuthorStatsVisibility();
  });
}

if (difficultyToggleBtn) {
  difficultyToggleBtn.addEventListener("click", () => {
    difficultyBoardExpanded = !difficultyBoardExpanded;
    updateDifficultyBoardVisibility();
  });
}

if (overallToggleBtn) {
  overallToggleBtn.addEventListener("click", () => {
    overallExpanded = !overallExpanded;
    updateOverallVisibility();
  });
}

if (dailyStartBtn) {
  dailyStartBtn.addEventListener("click", () => {
    if (!dailyPuzzleId) {
      setMessage("今日挑战加载中，请稍后重试。", "bad");
      return;
    }
    if (!puzzlesCache.find((puzzle) => puzzle.id === dailyPuzzleId)) {
      setMessage("今日挑战题目不存在，请刷新题库。", "bad");
      return;
    }
    puzzleSelect.value = dailyPuzzleId;
    leaderboardSelect.value = dailyPuzzleId;
    loadLeaderboard(dailyPuzzleId);
    startGame();
  });
}

if (dailyBoardRefreshBtn) {
  dailyBoardRefreshBtn.addEventListener("click", () => {
    loadDailyChallenge();
  });
}

if (checkinBtn) {
  checkinBtn.addEventListener("click", () => {
    claimCheckin();
  });
}

if (difficultyPanel) {
  difficultyPanel.querySelectorAll("button[data-difficulty]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!currentState || !currentState.is_complete) {
        setMessage("通关后才能评价难度。", "bad");
        return;
      }
      const level = button.getAttribute("data-difficulty");
      if (!level) {
        return;
      }
      submitDifficulty(currentState.puzzle_id, level);
    });
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
renderAiAccessHint();
updateAuthorStatsVisibility();
loadAuthorStats();
updateDifficultyBoardVisibility();
updateOverallVisibility();
loadDifficultyBoard();
loadOverallLeaderboard();
loadDailyChallenge();
loadDailyTrend();
updateFilterUnfinishedState();
