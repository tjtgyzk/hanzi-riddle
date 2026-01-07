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
const newPuzzleId = document.getElementById("newPuzzleId");
const newPuzzleTitle = document.getElementById("newPuzzleTitle");
const aiStyleHint = document.getElementById("aiStyleHint");
const newPuzzleBody = document.getElementById("newPuzzleBody");
const overwriteCheck = document.getElementById("overwriteCheck");
const generatePuzzleBtn = document.getElementById("generatePuzzleBtn");
const savePuzzleBtn = document.getElementById("savePuzzleBtn");
const refreshPuzzleListBtn = document.getElementById("refreshPuzzleListBtn");
const puzzleList = document.getElementById("puzzleList");

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

async function fetchAiProfiles() {
  const data = await requestJson("/api/admin/ai/profiles");
  profilesCache = data.profiles || [];
  return profilesCache;
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

savePuzzleBtn.addEventListener("click", () => {
  createPuzzle();
});

generatePuzzleBtn.addEventListener("click", () => {
  generatePuzzleBody();
});

refreshPuzzleListBtn.addEventListener("click", async () => {
  await fetchPuzzleList();
  renderPuzzleList();
});

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
  await fetchPuzzleList();
  renderPuzzleList();
}

initAdmin();
