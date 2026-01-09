// 管理后台脚本：管理员验证、AI 配置、题库管理

const adminPasswordInput = document.getElementById("adminPassword");
const adminLoginBtn = document.getElementById("adminLoginBtn");
const adminStatus = document.getElementById("adminStatus");
const adminGate = document.getElementById("adminGate");
const adminContent = document.getElementById("adminContent");
const adminNotice = document.getElementById("adminNotice");

const aiProfileSelect = document.getElementById("aiProfileSelect");
const aiProfileName = document.getElementById("aiProfileName");
const aiBaseUrl = document.getElementById("aiBaseUrl");
const aiModel = document.getElementById("aiModel");
const aiKey = document.getElementById("aiKey");
const aiSaveBtn = document.getElementById("aiSaveBtn");
const aiDeleteBtn = document.getElementById("aiDeleteBtn");
const aiAccessCode = document.getElementById("aiAccessCode");
const aiAccessSaveBtn = document.getElementById("aiAccessSaveBtn");
const aiAccessClearBtn = document.getElementById("aiAccessClearBtn");
const aiAccessStatus = document.getElementById("aiAccessStatus");
const newPuzzleId = document.getElementById("newPuzzleId");
const newPuzzleTitle = document.getElementById("newPuzzleTitle");
const aiStyleHint = document.getElementById("aiStyleHint");
const newPuzzleBody = document.getElementById("newPuzzleBody");
const overwriteCheck = document.getElementById("overwriteCheck");
const generatePuzzleBtn = document.getElementById("generatePuzzleBtn");
const savePuzzleBtn = document.getElementById("savePuzzleBtn");
const refreshPuzzleListBtn = document.getElementById("refreshPuzzleListBtn");
const dailyPuzzleList = document.getElementById("dailyPuzzleList");
const normalPuzzleList = document.getElementById("normalPuzzleList");
const refreshUserListBtn = document.getElementById("refreshUserListBtn");
const userList = document.getElementById("userList");
const refreshAuthorStatsBtn = document.getElementById("refreshAuthorStatsBtn");
const authorStatsList = document.getElementById("authorStatsList");
const authorStatsEmpty = document.getElementById("authorStatsEmpty");
const dailyAutoCheck = document.getElementById("dailyAutoCheck");
const dailyAutoSaveBtn = document.getElementById("dailyAutoSaveBtn");
const dailyAutoStatus = document.getElementById("dailyAutoStatus");
const puzzleSearchInput = document.getElementById("puzzleSearchInput");
const puzzleFilterSelect = document.getElementById("puzzleFilterSelect");

let adminToken = "";

const SESSION_KEY = "guess_game_session_id";

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

function getAdminToken() {
  return adminToken;
}

function setAdminToken(token) {
  adminToken = token;
}

function clearAdminToken() {
  adminToken = "";
}

function setAdminStatus(text) {
  adminStatus.textContent = text;
}

function setAdminNotice(text, type) {
  if (!text) {
    setHidden(adminNotice, true);
    adminNotice.textContent = "";
    return;
  }
  adminNotice.textContent = text;
  adminNotice.classList.remove("good", "bad");
  setHidden(adminNotice, false);
  if (type === "good") {
    adminNotice.classList.add("good");
  } else if (type === "bad") {
    adminNotice.classList.add("bad");
  }
}

async function requestJson(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-Session-Id": getSessionId(),
    ...(options.headers || {}),
  };
  const token = getAdminToken();
  if (token) {
    headers["X-Admin-Token"] = token;
  }
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

async function checkAdminToken(token) {
  try {
    await requestJson("/api/admin/check", {
      method: "GET",
      headers: {
        "X-Admin-Token": token,
      },
    });
    return true;
  } catch (error) {
    return false;
  }
}

function unlockAdmin() {
  setHidden(adminGate, true);
  setHidden(adminContent, false);
  setAdminStatus("已验证");
}

function setHidden(element, hidden) {
  if (!element) {
    return;
  }
  element.hidden = hidden;
  element.style.display = hidden ? "none" : "";
  if (hidden) {
    element.classList.add("is-hidden");
  } else {
    element.classList.remove("is-hidden");
  }
}

function lockAdmin() {
  setHidden(adminGate, false);
  setHidden(adminContent, true);
}

async function handleAdminLogin() {
  const token = adminPasswordInput.value.trim();
  if (!token) {
    setAdminStatus("请输入密码");
    setAdminNotice("管理员密码不能为空。", "bad");
    lockAdmin();
    return;
  }
  const ok = await checkAdminToken(token);
  if (!ok) {
    clearAdminToken();
    setAdminStatus("验证失败");
    setAdminNotice("管理员密码错误或未设置。", "bad");
    lockAdmin();
    return;
  }
  setAdminToken(token);
  unlockAdmin();
  setAdminNotice("验证通过，欢迎进入管理后台。", "good");
  await fetchAiProfiles();
  renderAiProfiles();
  await fetchAiAccessStatus();
  renderAiAccessStatus();
  try {
    await fetchPuzzleList();
    renderPuzzleList();
  } catch (error) {
    setAdminNotice(`题目列表加载失败：${error.message}`, "bad");
  }
  try {
    await fetchUserList();
    renderUserList();
  } catch (error) {
    setAdminNotice(`用户列表加载失败：${error.message}`, "bad");
  }
  try {
    await fetchAuthorStats();
    renderAuthorStats();
  } catch (error) {
    setAdminNotice(`排行加载失败：${error.message}`, "bad");
  }
  try {
    await fetchDailyAuto();
    renderDailyAuto();
  } catch (error) {
    setAdminNotice(`每日题池规则读取失败：${error.message}`, "bad");
  }
}

let profilesCache = [];
let puzzlesCache = [];
let aiAccessConfigured = false;
let usersCache = [];
let authorStatsCache = [];
let dailyAutoEnabled = false;

async function fetchAiProfiles() {
  const data = await requestJson("/api/admin/ai/profiles");
  profilesCache = data.profiles || [];
  return profilesCache;
}

async function fetchAiAccessStatus() {
  const data = await requestJson("/api/admin/ai/access");
  aiAccessConfigured = Boolean(data.configured);
  if (aiAccessCode) {
    aiAccessCode.value = data.access_code ? String(data.access_code) : "";
  }
  return aiAccessConfigured;
}

function renderAiAccessStatus() {
  if (!aiAccessStatus) {
    return;
  }
  aiAccessStatus.textContent = aiAccessConfigured ? "已设置" : "未设置";
}

function renderAiProfiles() {
  const profiles = profilesCache || [];
  const activeProfile = profiles.find((profile) => profile.is_active) || profiles[0];
  const activeName = activeProfile ? activeProfile.name : "";
  aiProfileSelect.innerHTML = "";
  if (!profiles.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无配置";
    aiProfileSelect.appendChild(option);
    return;
  }
  profiles.forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile.name;
    option.textContent = profile.name;
    aiProfileSelect.appendChild(option);
  });
  if (activeName) {
    aiProfileSelect.value = activeName;
    applyProfileToForm(activeName);
  }
}

function applyProfileToForm(name) {
  const profile = (profilesCache || []).find((item) => item.name === name);
  if (!profile) {
    aiProfileName.value = "";
    aiBaseUrl.value = "";
    aiModel.value = "";
    aiKey.value = "";
    return;
  }
  aiProfileName.value = profile.name || "";
  aiBaseUrl.value = profile.base_url || "";
  aiModel.value = profile.model || "";
  aiKey.value = profile.api_key || "";
}

function saveAiProfile() {
  const name = aiProfileName.value.trim();
  if (!name) {
    setAdminNotice("请填写配置名称。", "bad");
    return;
  }
  const profile = {
    name,
    base_url: aiBaseUrl.value.trim(),
    model: aiModel.value.trim(),
    api_key: aiKey.value.trim(),
  };
  if (!profile.base_url || !profile.model || !profile.api_key) {
    setAdminNotice("请完整填写 Base URL、模型和 Key。", "bad");
    return;
  }
  requestJson("/api/admin/ai/profiles", {
    method: "POST",
    body: JSON.stringify({ ...profile, set_active: true }),
  })
    .then(async () => {
      await fetchAiProfiles();
      renderAiProfiles();
      setAdminNotice("AI 配置已保存。", "good");
    })
    .catch((error) => {
      setAdminNotice(`保存失败：${error.message}`, "bad");
    });
}

function deleteAiProfile() {
  const name = aiProfileSelect.value;
  if (!name) {
    setAdminNotice("没有可删除的配置。", "bad");
    return;
  }
  requestJson("/api/admin/ai/profiles", {
    method: "DELETE",
    body: JSON.stringify({ name }),
  })
    .then(async () => {
      await fetchAiProfiles();
      renderAiProfiles();
      setAdminNotice("已删除配置。", "good");
    })
    .catch((error) => {
      setAdminNotice(`删除失败：${error.message}`, "bad");
    });
}

async function createPuzzle() {
  const title = newPuzzleTitle.value.trim();
  const body = newPuzzleBody.value;
  const puzzleId = newPuzzleId.value.trim();
  if (!title) {
    setAdminNotice("标题不能为空。", "bad");
    return;
  }
  try {
    await requestJson("/api/puzzles/create", {
      method: "POST",
      body: JSON.stringify({
        puzzle_id: puzzleId || null,
        title,
        body,
        overwrite: overwriteCheck.checked,
      }),
    });
    setAdminNotice("题目已保存。", "good");
    newPuzzleId.value = "";
    newPuzzleTitle.value = "";
    newPuzzleBody.value = "";
    overwriteCheck.checked = false;
    await fetchPuzzleList();
    renderPuzzleList();
  } catch (error) {
    setAdminNotice(`保存失败：${error.message}`, "bad");
  }
}

async function fetchPuzzleList() {
  const data = await requestJson("/api/admin/puzzles");
  puzzlesCache = data.puzzles || [];
  return puzzlesCache;
}

function renderPuzzleList() {
  if (!dailyPuzzleList || !normalPuzzleList) {
    return;
  }
  dailyPuzzleList.innerHTML = "";
  normalPuzzleList.innerHTML = "";
  const keyword = (puzzleSearchInput ? puzzleSearchInput.value : "").trim().toLowerCase();
  const filter = puzzleFilterSelect ? puzzleFilterSelect.value : "all";
  const filtered = puzzlesCache.filter((puzzle) => {
    const title = String(puzzle.title || "").toLowerCase();
    const pid = String(puzzle.id || "").toLowerCase();
    const body = String(puzzle.body || "").toLowerCase();
    if (keyword && !title.includes(keyword) && !pid.includes(keyword) && !body.includes(keyword)) {
      return false;
    }
    const isDaily = Boolean(puzzle.is_daily);
    const isPlayed = Boolean(puzzle.is_played);
    if (filter === "daily") {
      return isDaily;
    }
    if (filter === "normal") {
      return !isDaily;
    }
    if (filter === "played") {
      return isPlayed;
    }
    if (filter === "unplayed") {
      return !isPlayed;
    }
    return true;
  });
  const dailyItems = filtered.filter((puzzle) => puzzle.is_daily);
  const normalItems = filtered.filter((puzzle) => !puzzle.is_daily);
  const emptyPrefix = filter === "all" ? "暂无" : "筛选后暂无";
  renderPuzzleGroup(dailyPuzzleList, dailyItems, `${emptyPrefix}每日题`);
  renderPuzzleGroup(normalPuzzleList, normalItems, `${emptyPrefix}普通题目`);
}

function renderPuzzleGroup(container, puzzles, emptyText) {
  if (!container) {
    return;
  }
  if (!puzzles.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  puzzles.forEach((puzzle) => {
    const item = document.createElement("div");
    item.className = "puzzle-item";
    const header = document.createElement("div");
    header.className = "puzzle-header";
    const title = document.createElement("div");
    title.className = "puzzle-title";
    title.textContent = puzzle.title || "(无标题)";
    const meta = document.createElement("div");
    meta.className = "puzzle-meta";
    const playedLabel = puzzle.is_played ? " · 已游玩" : "";
    meta.textContent = `ID: ${puzzle.id}${playedLabel}`;
    header.append(title, meta);
    const body = document.createElement("div");
    body.className = "puzzle-body";
    body.textContent = puzzle.body || "";
    body.addEventListener("click", () => {
      body.classList.toggle("is-expanded");
    });
    const difficultyRow = document.createElement("div");
    difficultyRow.className = "puzzle-difficulty-row";
    const difficultyLabel = document.createElement("div");
    difficultyLabel.className = "puzzle-meta";
    difficultyLabel.textContent = "管理员难度";
    const difficultySelect = document.createElement("select");
    difficultySelect.className = "puzzle-difficulty-select";
    const difficultyOptions = [
      { value: "", label: "未设置" },
      { value: "easy", label: "简单" },
      { value: "medium", label: "中等" },
      { value: "hard", label: "困难" },
    ];
    difficultyOptions.forEach((optionItem) => {
      const option = document.createElement("option");
      option.value = optionItem.value;
      option.textContent = optionItem.label;
      difficultySelect.appendChild(option);
    });
    difficultySelect.value = puzzle.admin_difficulty || "";
    const difficultyBtn = document.createElement("button");
    difficultyBtn.className = "btn ghost small";
    difficultyBtn.textContent = "保存难度";
    difficultyBtn.addEventListener("click", async () => {
      try {
        await requestJson("/api/admin/puzzles/difficulty", {
          method: "POST",
          body: JSON.stringify({
            puzzle_id: puzzle.id,
            difficulty: difficultySelect.value,
          }),
        });
        setAdminNotice("难度已保存。", "good");
      } catch (error) {
        setAdminNotice(`保存难度失败：${error.message}`, "bad");
      }
    });
    difficultyRow.append(difficultyLabel, difficultySelect, difficultyBtn);
    const dailyRow = document.createElement("div");
    dailyRow.className = "puzzle-difficulty-row";
    const dailyLabel = document.createElement("div");
    dailyLabel.className = "puzzle-meta";
    dailyLabel.textContent = "每日题";
    const dailyLocked = Boolean(puzzle.is_played) && !puzzle.is_daily;
    if (dailyLocked) {
      const lock = document.createElement("div");
      lock.className = "puzzle-lock";
      lock.textContent = "已游玩，不可加入每日题池";
      dailyRow.append(dailyLabel, lock);
    } else {
      const dailyCheck = document.createElement("input");
      dailyCheck.type = "checkbox";
      dailyCheck.checked = Boolean(puzzle.is_daily);
      const dailyBtn = document.createElement("button");
      dailyBtn.className = "btn ghost small";
      dailyBtn.textContent = "保存每日题";
      dailyBtn.addEventListener("click", async () => {
        try {
          await requestJson("/api/admin/puzzles/daily", {
            method: "POST",
            body: JSON.stringify({
              puzzle_id: puzzle.id,
              is_daily: dailyCheck.checked,
            }),
          });
          setAdminNotice("每日题设置已保存。", "good");
          await fetchPuzzleList();
          renderPuzzleList();
        } catch (error) {
          setAdminNotice(`保存每日题失败：${error.message}`, "bad");
        }
      });
      dailyRow.append(dailyLabel, dailyCheck, dailyBtn);
    }
    const actions = document.createElement("div");
    actions.className = "form-actions";
    const fillBtn = document.createElement("button");
    fillBtn.className = "btn ghost";
    fillBtn.textContent = "填入编辑区";
    fillBtn.addEventListener("click", () => {
      newPuzzleId.value = puzzle.id || "";
      newPuzzleTitle.value = puzzle.title || "";
      newPuzzleBody.value = puzzle.body || "";
      overwriteCheck.checked = false;
      setAdminNotice("已填入编辑区，可修改后保存。", "good");
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn danger";
    deleteBtn.textContent = "删除";
    deleteBtn.addEventListener("click", async () => {
      const ok = window.confirm(`确定删除题目“${puzzle.title}”？该操作不可撤销。`);
      if (!ok) {
        return;
      }
      try {
        await requestJson("/api/admin/puzzles", {
          method: "DELETE",
          body: JSON.stringify({ puzzle_id: puzzle.id }),
        });
        setAdminNotice("题目已删除。", "good");
        await fetchPuzzleList();
        renderPuzzleList();
      } catch (error) {
        setAdminNotice(`删除失败：${error.message}`, "bad");
      }
    });
    actions.append(fillBtn, deleteBtn);
    item.append(header, body, difficultyRow, dailyRow, actions);
    container.appendChild(item);
  });
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
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }
  return String(raw).replace("T", " ").replace("Z", "");
}

async function fetchUserList() {
  const data = await requestJson("/api/admin/users");
  usersCache = data.users || [];
  return usersCache;
}

async function fetchAuthorStats() {
  const data = await requestJson("/api/admin/author_stats");
  authorStatsCache = data.stats || [];
  return authorStatsCache;
}

async function fetchDailyAuto() {
  const data = await requestJson("/api/admin/daily/auto");
  dailyAutoEnabled = Boolean(data.enabled);
  return dailyAutoEnabled;
}

function renderUserList() {
  if (!userList) {
    return;
  }
  userList.innerHTML = "";
  if (!usersCache.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "暂无用户";
    userList.appendChild(empty);
    return;
  }
  usersCache.forEach((user) => {
    const item = document.createElement("div");
    item.className = "user-item";
    const header = document.createElement("div");
    header.className = "user-header";
    const name = document.createElement("div");
    name.className = "user-name";
    name.textContent = user.nickname || "(未命名)";
    const meta = document.createElement("div");
    meta.className = "user-meta";
    meta.textContent = `ID: ${user.id}`;
    header.append(name, meta);
    const lastSeen = document.createElement("div");
    lastSeen.className = "user-time";
    lastSeen.textContent = `最后登录：${formatTimestamp(user.last_seen) || "未知"}`;
    const createdAt = document.createElement("div");
    createdAt.className = "user-time";
    createdAt.textContent = `创建时间：${formatTimestamp(user.created_at) || "未知"}`;
    item.append(header, lastSeen, createdAt);
    userList.appendChild(item);
  });
}

function formatRate(numerator, denominator) {
  const base = Number(denominator) || 0;
  if (!base) {
    return "—";
  }
  const rate = (Number(numerator) || 0) / base;
  return `${Math.round(rate * 100)}%`;
}

function renderAuthorStats() {
  if (!authorStatsList || !authorStatsEmpty) {
    return;
  }
  authorStatsList.innerHTML = "";
  if (!authorStatsCache.length) {
    authorStatsEmpty.classList.remove("is-hidden");
    return;
  }
  authorStatsEmpty.classList.add("is-hidden");
  authorStatsCache.forEach((stat, index) => {
    const item = document.createElement("li");
    item.className = "author-stats-item";
    if (index === 0) {
      item.classList.add("is-gold");
    } else if (index === 1) {
      item.classList.add("is-silver");
    } else if (index === 2) {
      item.classList.add("is-bronze");
    }

    const header = document.createElement("div");
    header.className = "author-stats-header";
    const rank = document.createElement("span");
    rank.className = "author-rank";
    rank.textContent = `#${index + 1}`;
    const name = document.createElement("span");
    name.className = "author-name";
    name.textContent = stat.author_name || "(未命名)";
    header.append(rank, name);

    const meta = document.createElement("div");
    meta.className = "author-stats-meta";
    const startedRaw = Number(stat.started_players) || 0;
    const completed = Number(stat.completion_count) || 0;
    const started = Math.max(startedRaw, completed);
    const items = [
      { label: "出题", value: stat.puzzle_count ?? 0 },
      { label: "开局", value: started },
      { label: "通关", value: completed },
      { label: "完成率", value: formatRate(completed, started) },
      { label: "放弃率", value: formatRate(started - completed, started) },
      { label: "尝试", value: stat.attempt_count ?? 0 },
    ];
    items.forEach((entry) => {
      const box = document.createElement("div");
      box.className = "author-meta-item";
      const label = document.createElement("div");
      label.className = "author-meta-label";
      label.textContent = entry.label;
      const value = document.createElement("div");
      value.className = "author-meta-value";
      value.textContent = String(entry.value);
      box.append(label, value);
      meta.appendChild(box);
    });

    const foot = document.createElement("div");
    foot.className = "author-stats-foot";
    const lastCompleted = formatTimestamp(stat.last_completed);
    foot.textContent = `最近通关：${lastCompleted || "暂无"}`;

    item.append(header, meta, foot);
    authorStatsList.appendChild(item);
  });
}

function renderDailyAuto() {
  if (!dailyAutoCheck || !dailyAutoStatus) {
    return;
  }
  dailyAutoCheck.checked = dailyAutoEnabled;
  dailyAutoStatus.textContent = dailyAutoEnabled ? "已开启" : "未开启";
}

async function generatePuzzleBody() {
  const title = newPuzzleTitle.value.trim();
  const styleHint = aiStyleHint.value.trim();
  if (!title) {
    setAdminNotice("请先填写标题。", "bad");
    return;
  }
  generatePuzzleBtn.disabled = true;
  setAdminNotice("AI 正在生成题目正文，请稍等...", "good");
  try {
    const data = await requestJson("/api/admin/puzzles/generate", {
      method: "POST",
      body: JSON.stringify({ title, style_hint: styleHint }),
    });
    newPuzzleBody.value = data.body || "";
    setAdminNotice("AI 已生成正文，可编辑后保存。", "good");
  } catch (error) {
    setAdminNotice(`生成失败：${error.message}`, "bad");
  } finally {
    generatePuzzleBtn.disabled = false;
  }
}

adminLoginBtn.addEventListener("click", () => {
  handleAdminLogin();
});

adminPasswordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    handleAdminLogin();
  }
});

aiProfileSelect.addEventListener("change", () => {
  const name = aiProfileSelect.value;
  applyProfileToForm(name);
  if (!name) {
    return;
  }
  requestJson("/api/admin/ai/active", {
    method: "POST",
    body: JSON.stringify({ name }),
  }).catch((error) => {
    setAdminNotice(`切换失败：${error.message}`, "bad");
  });
});

aiSaveBtn.addEventListener("click", () => {
  saveAiProfile();
});

aiDeleteBtn.addEventListener("click", () => {
  deleteAiProfile();
});

aiAccessSaveBtn.addEventListener("click", async () => {
  const code = aiAccessCode.value.trim();
  if (!code) {
    setAdminNotice("访问码不能为空。", "bad");
    return;
  }
  try {
    await requestJson("/api/admin/ai/access", {
      method: "POST",
      body: JSON.stringify({ access_code: code }),
    });
    await fetchAiAccessStatus();
    renderAiAccessStatus();
    setAdminNotice("AI 访问码已保存。", "good");
  } catch (error) {
    setAdminNotice(`保存失败：${error.message}`, "bad");
  }
});

aiAccessClearBtn.addEventListener("click", async () => {
  try {
    await requestJson("/api/admin/ai/access", {
      method: "DELETE",
      body: JSON.stringify({}),
    });
    await fetchAiAccessStatus();
    renderAiAccessStatus();
    setAdminNotice("AI 访问码已清除。", "good");
  } catch (error) {
    setAdminNotice(`清除失败：${error.message}`, "bad");
  }
});

savePuzzleBtn.addEventListener("click", () => {
  createPuzzle();
});

generatePuzzleBtn.addEventListener("click", () => {
  generatePuzzleBody();
});

if (refreshPuzzleListBtn) {
  refreshPuzzleListBtn.addEventListener("click", async () => {
    await fetchPuzzleList();
    renderPuzzleList();
  });
}

if (puzzleSearchInput) {
  puzzleSearchInput.addEventListener("input", () => {
    renderPuzzleList();
  });
}

if (puzzleFilterSelect) {
  puzzleFilterSelect.addEventListener("change", () => {
    renderPuzzleList();
  });
}

if (refreshUserListBtn) {
  refreshUserListBtn.addEventListener("click", async () => {
    await fetchUserList();
    renderUserList();
  });
}

if (refreshAuthorStatsBtn) {
  refreshAuthorStatsBtn.addEventListener("click", async () => {
    await fetchAuthorStats();
    renderAuthorStats();
  });
}

if (dailyAutoSaveBtn) {
  dailyAutoSaveBtn.addEventListener("click", async () => {
    try {
      const enabled = Boolean(dailyAutoCheck && dailyAutoCheck.checked);
      await requestJson("/api/admin/daily/auto", {
        method: "POST",
        body: JSON.stringify({ enabled }),
      });
      dailyAutoEnabled = enabled;
      renderDailyAuto();
      setAdminNotice("每日题池规则已保存。", "good");
    } catch (error) {
      setAdminNotice(`保存规则失败：${error.message}`, "bad");
    }
  });
}

async function initAdmin() {
  const token = getAdminToken();
  if (!token) {
    setAdminStatus("未验证");
    lockAdmin();
    return;
  }
  const ok = await checkAdminToken(token);
  if (!ok) {
    clearAdminToken();
    setAdminStatus("未验证");
    lockAdmin();
    return;
  }
  unlockAdmin();
  await fetchAiProfiles();
  renderAiProfiles();
  await fetchAiAccessStatus();
  renderAiAccessStatus();
  try {
    await fetchPuzzleList();
    renderPuzzleList();
  } catch (error) {
    setAdminNotice(`题目列表加载失败：${error.message}`, "bad");
  }
  try {
    await fetchUserList();
    renderUserList();
  } catch (error) {
    setAdminNotice(`用户列表加载失败：${error.message}`, "bad");
  }
  try {
    await fetchAuthorStats();
    renderAuthorStats();
  } catch (error) {
    setAdminNotice(`排行加载失败：${error.message}`, "bad");
  }
  try {
    await fetchDailyAuto();
    renderDailyAuto();
  } catch (error) {
    setAdminNotice(`每日题池规则读取失败：${error.message}`, "bad");
  }
}

initAdmin();
