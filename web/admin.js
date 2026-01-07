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
const puzzleList = document.getElementById("puzzleList");
const refreshUserListBtn = document.getElementById("refreshUserListBtn");
const userList = document.getElementById("userList");

let adminToken = "";

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
}

let profilesCache = [];
let puzzlesCache = [];
let aiAccessConfigured = false;
let usersCache = [];

async function fetchAiProfiles() {
  const data = await requestJson("/api/admin/ai/profiles");
  profilesCache = data.profiles || [];
  return profilesCache;
}

async function fetchAiAccessStatus() {
  const data = await requestJson("/api/admin/ai/access");
  aiAccessConfigured = Boolean(data.configured);
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
  if (!puzzleList) {
    return;
  }
  puzzleList.innerHTML = "";
  if (!puzzlesCache.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "暂无题目";
    puzzleList.appendChild(empty);
    return;
  }
  puzzlesCache.forEach((puzzle) => {
    const item = document.createElement("div");
    item.className = "puzzle-item";
    const header = document.createElement("div");
    header.className = "puzzle-header";
    const title = document.createElement("div");
    title.className = "puzzle-title";
    title.textContent = puzzle.title || "(无标题)";
    const meta = document.createElement("div");
    meta.className = "puzzle-meta";
    meta.textContent = `ID: ${puzzle.id}`;
    header.append(title, meta);
    const body = document.createElement("div");
    body.className = "puzzle-body";
    body.textContent = puzzle.body || "";
    body.addEventListener("click", () => {
      body.classList.toggle("is-expanded");
    });
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
    item.append(header, body, actions);
    puzzleList.appendChild(item);
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
    aiAccessCode.value = "";
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

if (refreshUserListBtn) {
  refreshUserListBtn.addEventListener("click", async () => {
    await fetchUserList();
    renderUserList();
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
  await fetchPuzzleList();
  renderPuzzleList();
  await fetchUserList();
  renderUserList();
}

initAdmin();
