import { api, getState, onState, onConnection, grades, classesForGrade, classesPerGradeMap, allClassIds } from "./api.js";
import { $, $$, el, toast, formatTime, scoreToText, confirmBox, formatClassId, gameScopeLabel } from "./common.js";
import { createWheel } from "./wheel.js";

/* ---------------- 상태 ---------------- */
const LS_KEY = "judge_class_id";   // "1-5" 같은 형식
const LS_INFO_KEY = "judge_info";  // {studentNo, name} JSON

function loadJudgeInfo() {
  try {
    const raw = localStorage.getItem(LS_INFO_KEY);
    if (!raw) return { studentNo: "", name: "" };
    const o = JSON.parse(raw);
    return { studentNo: String(o.studentNo || ""), name: String(o.name || "") };
  } catch (e) {
    return { studentNo: "", name: "" };
  }
}
function saveJudgeInfo(info) {
  try { localStorage.setItem(LS_INFO_KEY, JSON.stringify(info)); } catch (e) {}
}

const local = {
  classId: localStorage.getItem(LS_KEY) || "",
  currentGameId: null,
  info: loadJudgeInfo(),  // {studentNo, name}
};

/* ---------------- 공통 UI ---------------- */
onConnection((online) => {
  const t = document.getElementById("topSub");
  t.textContent = online ? "● 실시간 연결됨" : "● 연결 대기 중";
  t.style.color = online ? "#86efac" : "#fca5a5";
});

onState((s) => {
  updateTopBar();

  // 본부에서 "전체 초기화"를 했거나 현재 보고 있던 종목이 삭제됐을 때
  // → 종목 입력 화면을 자동으로 닫고 목록으로 돌려보냄
  if (local.currentGameId && (!s.games || !s.games[local.currentGameId])) {
    local.currentGameId = null;
    if (inScreen("points") || inScreen("time")) {
      stopTimer();
      showGameList();
      toast("본부에서 종목이 변경되어 목록으로 돌아갑니다");
    }
  }
  // 학년/반 구성이 줄어 내 반이 더 이상 유효하지 않을 때 → 반 선택으로 복귀
  if (local.classId) {
    const [g, c] = local.classId.split("-").map(Number);
    const cpg = (s.classesPerGrade && (s.classesPerGrade[String(g)] ?? s.classesPerGrade[g])) || 0;
    if (g > Number(s.grades || 0) || c > Number(cpg || 0)) {
      local.classId = "";
      localStorage.removeItem(LS_KEY);
      updateTopBar();
      showClassSelect();
    }
  }

  if (inScreen("games")) renderGameList();
  if (inScreen("class")) renderClassGroups();
});

function updateTopBar() {
  const title = document.getElementById("topTitle");
  const sub = document.getElementById("topSub");
  const pill = document.getElementById("topPill");
  const s = getState();
  if (local.classId) {
    title.textContent = `${formatClassId(local.classId)}`;
    if (local.info?.name || local.info?.studentNo) {
      const parts = [];
      if (local.info.name) parts.push(local.info.name);
      if (local.info.studentNo) parts.push(`#${local.info.studentNo}`);
      // sub는 연결 상태로 사용 중. 학교 + 심판 정보를 pill에 합쳐 표시
      pill.textContent = parts.join(" · ");
    } else {
      pill.textContent = s.school || "학교 미설정";
    }
  } else {
    title.textContent = "심판";
    pill.textContent = s.school || "";
  }
}

/* ---------------- 화면 전환 ---------------- */
const screens = ["class", "games", "points", "time"];
function showScreen(name) {
  for (const s of screens) {
    document.getElementById(`screen-${s}`).classList.toggle("hidden", s !== name);
  }
  const back = document.getElementById("topBack");
  back.onclick = (e) => {
    e.preventDefault();
    if (name === "class") location.href = "./index.html";
    else if (name === "games") { local.classId ? showClassSelect() : (location.href = "./index.html"); }
    else if (name === "points" || name === "time") showScreen("games");
  };
}
function inScreen(name) {
  return !document.getElementById(`screen-${name}`).classList.contains("hidden");
}

/* ---------------- 1. 반 선택 ---------------- */
function showClassSelect() {
  renderClassGroups();
  showScreen("class");
}

function renderClassGroups() {
  const wrap = document.getElementById("classGroupList");
  wrap.innerHTML = "";

  const s = getState();
  const G = grades();

  // 각 반이 "참여 가능한 게임" 수 계산 (scope=grade 게임은 해당 학년만 카운트)
  const gamesPerGrade = {};
  for (let g = 1; g <= G; g++) gamesPerGrade[g] = 0;
  for (const [gid, game] of Object.entries(s.games || {})) {
    if (game.scope === "grade" && game.gradeNum) {
      const gn = Number(game.gradeNum);
      if (gamesPerGrade[gn] != null) gamesPerGrade[gn]++;
    } else {
      for (let g = 1; g <= G; g++) gamesPerGrade[g]++;
    }
  }

  // 제출 수 계산
  const submittedCount = {};
  for (const gid of Object.keys(s.games || {})) {
    const scs = s.scores[gid] || {};
    for (const cid of Object.keys(scs)) {
      submittedCount[cid] = (submittedCount[cid] || 0) + 1;
    }
  }

  for (let gr = 1; gr <= G; gr++) {
    wrap.appendChild(el("div", {
      style: "margin:14px 0 8px;font-weight:800;color:#cfe0ff;font-size:15px;",
    }, `${gr}학년`));

    const grid = el("div", { class: "class-grid" });
    const CPG = classesForGrade(gr);
    const total = gamesPerGrade[gr] || 0;
    for (let c = 1; c <= CPG; c++) {
      const cid = `${gr}-${c}`;
      const done = submittedCount[cid] || 0;
      const btn = el("button", {
        class: `class-btn ${local.classId === cid ? "selected" : ""}`,
        onclick: () => onSelectClass(cid),
      }, [
        el("div", {}, `${c}반`),
        total > 0 ? el("div", { class: "submitted" },
          `${done}/${total}`) : null,
      ]);
      grid.appendChild(btn);
    }
    wrap.appendChild(grid);
  }
}

/* ---------------- 2. 종목 리스트 ---------------- */
function showGameList() {
  renderGameList();
  renderJudgeWho();
  showScreen("games");
}

function renderGameList() {
  const wrap = document.getElementById("judgeGameList");
  wrap.innerHTML = "";
  const s = getState();
  const myGrade = Number((local.classId || "").split("-")[0] || 0);

  // 내 학년에 해당하는 게임만 표시
  const allEntries = Object.entries(s.games).sort((a, b) =>
    (a[1].createdAt || 0) - (b[1].createdAt || 0));
  const entries = allEntries.filter(([_, g]) => {
    if (g.scope === "grade" && g.gradeNum) {
      return Number(g.gradeNum) === myGrade;
    }
    return true;
  });

  if (allEntries.length === 0) {
    wrap.appendChild(el("div", { class: "empty" }, "등록된 종목이 없습니다. 본부에서 추가해 주세요."));
    return;
  }
  if (entries.length === 0) {
    wrap.appendChild(el("div", { class: "empty" },
      `${myGrade}학년이 참가하는 종목이 아직 없습니다.`));
    return;
  }

  for (const [gid, g] of entries) {
    const sc = (s.scores[gid] || {})[local.classId];
    const submitted = sc != null;
    const scopePill = el("span", {
      class: "pill",
      style: g.scope === "grade"
        ? "background:#f59e0b22;color:#fbbf24;margin-left:4px"
        : "background:#38bdf822;color:#93c5fd;margin-left:4px",
    }, gameScopeLabel(g));
    const item = el("div", {
      class: "judge-game-item",
      onclick: () => openGame(gid, g),
    }, [
      el("div", { class: "jg-name" }, [
        document.createTextNode(g.name + " "),
        el("span", { class: `pill ${g.scoreType === "time" ? "pill-time" : "pill-point"}` },
          g.scoreType === "time" ? "타임" : "점수"),
        scopePill,
        submitted
          ? el("div", { class: "small muted", style: "margin-top:4px" },
              `기록: ${scoreToText(g.scoreType, sc.value)} (수정 가능)`)
          : el("div", { class: "small muted", style: "margin-top:4px" }, "아직 기록되지 않음"),
      ]),
      submitted
        ? el("div", { class: "jg-done" }, "완료")
        : el("div", { class: "jg-todo" }, "입력"),
    ]);
    wrap.appendChild(item);
  }
}

document.getElementById("changeClassBtn").addEventListener("click", () => {
  showClassSelect();
});

document.getElementById("editInfoBtn")?.addEventListener("click", () => {
  if (!local.classId) return;
  _pendingClassId = local.classId;
  openJudgeInfoModal(local.classId, true);
});

function renderJudgeWho() {
  const wrap = document.getElementById("judgeWho");
  if (!wrap) return;
  if (local.info?.name || local.info?.studentNo) {
    const parts = [];
    if (local.info.name) parts.push(local.info.name);
    if (local.info.studentNo) parts.push(`학번 ${local.info.studentNo}`);
    wrap.textContent = `심판자: ${parts.join(" · ")}`;
  } else {
    wrap.textContent = "";
  }
}

/* ---------------- 심판자 정보 입력 ---------------- */
let _pendingClassId = null;

function onSelectClass(cid) {
  // 같은 반을 다시 누르고 이미 정보가 입력되어 있으면 바로 진행
  const sameClass = (cid === local.classId);
  const hasInfo = !!(local.info?.name && local.info?.studentNo);
  if (sameClass && hasInfo) {
    showGameList();
    return;
  }
  // 다른 반을 선택하면 무조건 정보 다시 입력
  _pendingClassId = cid;
  openJudgeInfoModal(cid, sameClass);
}

function openJudgeInfoModal(cid, prefill) {
  const modal = document.getElementById("judgeInfoModal");
  const noInp = document.getElementById("judgeStudentNo");
  const nameInp = document.getElementById("judgeStudentName");
  const sub = document.getElementById("judgeInfoSubtitle");
  const err = document.getElementById("judgeInfoError");

  sub.textContent = `${formatClassId(cid)} 담당 심판 정보`;
  err.textContent = "";

  if (prefill && local.info) {
    noInp.value = local.info.studentNo || "";
    nameInp.value = local.info.name || "";
  } else {
    noInp.value = "";
    nameInp.value = "";
  }
  modal.classList.remove("hidden");
  setTimeout(() => noInp.focus(), 50);
}

function closeJudgeInfoModal() {
  document.getElementById("judgeInfoModal").classList.add("hidden");
  _pendingClassId = null;
}

function submitJudgeInfo() {
  const no = document.getElementById("judgeStudentNo").value.trim();
  const name = document.getElementById("judgeStudentName").value.trim();
  const err = document.getElementById("judgeInfoError");

  if (!no) { err.textContent = "학번을 입력하세요"; document.getElementById("judgeStudentNo").focus(); return; }
  if (!name) { err.textContent = "이름을 입력하세요"; document.getElementById("judgeStudentName").focus(); return; }

  local.info = { studentNo: no, name };
  saveJudgeInfo(local.info);

  if (_pendingClassId) {
    local.classId = _pendingClassId;
    localStorage.setItem(LS_KEY, _pendingClassId);
    _pendingClassId = null;
  }
  closeJudgeInfoModal();
  updateTopBar();
  showGameList();
  toast("심판자 정보가 저장되었습니다");
}

document.getElementById("judgeInfoOk")?.addEventListener("click", submitJudgeInfo);
document.getElementById("judgeInfoCancel")?.addEventListener("click", closeJudgeInfoModal);
document.getElementById("judgeStudentName")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitJudgeInfo();
});
document.getElementById("judgeInfoModal")?.addEventListener("click", (e) => {
  if (e.target.id === "judgeInfoModal") closeJudgeInfoModal();
});

/* ---------------- 3. 종목 열기 ---------------- */
function openGame(gid, g) {
  local.currentGameId = gid;
  if (g.scoreType === "points") openPoints(gid, g);
  else openTime(gid, g);
}

/* ---------------- 3-a. 점수 휠 ---------------- */
let wheelInst = null;
const POINT_VALUES = [];
for (let v = 10; v <= 180; v += 10) POINT_VALUES.push(v);

function openPoints(gid, g) {
  document.getElementById("pGameName").textContent = g.name;
  showScreen("points");

  const sc = (getState().scores[gid] || {})[local.classId];
  requestAnimationFrame(() => {
    wheelInst = createWheel({
      scrollEl: document.getElementById("wheelScroll"),
      values: POINT_VALUES,
      itemHeight: 56,
      onChange: () => { try { navigator.vibrate && navigator.vibrate(2); } catch(e){} },
    });
    const startVal = (sc?.value != null && POINT_VALUES.includes(sc.value)) ? sc.value : 100;
    setTimeout(() => wheelInst.setValue(startVal, false), 20);
  });

  document.getElementById("pDelete").classList.toggle("hidden", !sc);
  document.getElementById("pBack").onclick = () => showGameList();
  document.getElementById("pSubmit").onclick = () => submitPoint(gid);
  document.getElementById("pDelete").onclick = () => deleteMyScore(gid);
}

async function submitPoint(gid) {
  if (!wheelInst) return;
  const v = wheelInst.getValue();
  try {
    await api.submitScore(gid, local.classId, v);
    toast(`${v}점 제출됨`);
    showGameList();
  } catch (e) { toast("제출 실패"); }
}

/* ---------------- 3-b. 타임랩 ---------------- */
let timerState = { startAt: 0, elapsed: 0, running: false, raf: null };

function openTime(gid, g) {
  document.getElementById("tGameName").textContent = g.name;
  showScreen("time");

  const sc = (getState().scores[gid] || {})[local.classId];
  resetTimer();
  if (sc?.value != null) {
    timerState.elapsed = sc.value;
    renderTimer();
    document.getElementById("tSubmit").disabled = false;
    const btn = document.getElementById("tStart");
    btn.textContent = "다시 측정";
    btn.disabled = false;
    document.getElementById("tReset").classList.remove("hidden");
  }

  document.getElementById("tDelete").classList.toggle("hidden", !sc);
  document.getElementById("tStart").onclick = toggleTimer;
  document.getElementById("tReset").onclick = confirmResetTimer;
  document.getElementById("tBack").onclick = () => { stopTimer(); showGameList(); };
  document.getElementById("tSubmit").onclick = () => submitTime(gid);
  document.getElementById("tDelete").onclick = () => deleteMyScore(gid);
}

async function confirmResetTimer() {
  // 이미 0이면 확인 없이 그대로
  if (!timerState.running && timerState.elapsed === 0) return;
  const ok = await confirmBox("정말 초기화할까요?\n현재 측정된 기록이 모두 사라집니다.");
  if (!ok) return;
  resetTimer();
  toast("초기화되었습니다");
}

function toggleTimer() {
  const btn = document.getElementById("tStart");
  if (!timerState.running) {
    if (timerState.elapsed > 0 && btn.textContent === "다시 측정") {
      timerState.elapsed = 0;
      renderTimer();
    }
    timerState.startAt = performance.now() - timerState.elapsed;
    timerState.running = true;
    btn.textContent = "끝";
    btn.classList.add("stop");
    document.getElementById("tReset").classList.add("hidden");
    document.getElementById("tSubmit").disabled = true;
    loop();
    try { navigator.vibrate && navigator.vibrate(20); } catch(e){}
  } else {
    stopTimer();
    btn.textContent = "제출 대기";
    btn.classList.remove("stop");
    btn.disabled = true;
    document.getElementById("tReset").classList.remove("hidden");
    document.getElementById("tSubmit").disabled = false;
    try { navigator.vibrate && navigator.vibrate([20,30,20]); } catch(e){}
  }
}

function stopTimer() {
  if (timerState.running) {
    timerState.elapsed = performance.now() - timerState.startAt;
    timerState.running = false;
  }
  if (timerState.raf) cancelAnimationFrame(timerState.raf);
  timerState.raf = null;
}

function resetTimer() {
  stopTimer();
  timerState.elapsed = 0;
  renderTimer();
  const btn = document.getElementById("tStart");
  btn.textContent = "시작";
  btn.classList.remove("stop");
  btn.disabled = false;
  document.getElementById("tReset").classList.add("hidden");
  document.getElementById("tSubmit").disabled = true;
}

function loop() {
  timerState.raf = requestAnimationFrame(() => {
    if (!timerState.running) return;
    timerState.elapsed = performance.now() - timerState.startAt;
    renderTimer();
    loop();
  });
}

function renderTimer() {
  const ms = Math.max(0, timerState.elapsed);
  const totalCentis = Math.floor(ms / 10);
  const mm = Math.floor(totalCentis / 6000);
  const ss = Math.floor((totalCentis % 6000) / 100);
  const cc = totalCentis % 100;
  document.getElementById("tDisplay").innerHTML =
    `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}.<span class="ms">${String(cc).padStart(2,"0")}</span>`;
}

async function submitTime(gid) {
  const ms = Math.round(timerState.elapsed);
  if (ms <= 0) { toast("기록이 없습니다"); return; }
  try {
    await api.submitScore(gid, local.classId, ms);
    toast(`${formatTime(ms)} 제출됨`);
    showGameList();
  } catch (e) { toast("제출 실패"); }
}

/* ---------------- 공용: 내 반 기록 삭제 ---------------- */
async function deleteMyScore(gid) {
  const ok = await confirmBox(`${formatClassId(local.classId)}의 이 종목 기록을 삭제할까요?`);
  if (!ok) return;
  try { await api.deleteScore(gid, local.classId); toast("삭제됨"); showGameList(); }
  catch (e) { toast("삭제 실패"); }
}

/* ---------------- 초기 진입 ---------------- */
if (local.classId && /^\d+-\d+$/.test(local.classId)) {
  updateTopBar();
  // 학번/이름이 비어 있으면 입력 요청
  if (!local.info?.name || !local.info?.studentNo) {
    _pendingClassId = local.classId;
    showClassSelect();
    setTimeout(() => openJudgeInfoModal(local.classId, false), 100);
  } else {
    showGameList();
  }
} else {
  local.classId = "";
  showClassSelect();
}
