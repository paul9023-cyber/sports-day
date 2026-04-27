import { api, getState, onState, onConnection, grades, classesForGrade, classesPerGradeMap, allClassIds } from "./api.js";
import { $, $$, el, toast, formatTime, scoreToText, confirmBox, formatClassId, gameScopeLabel } from "./common.js";
import { createWheel } from "./wheel.js";

/* ---------------- 상태 ---------------- */
const LS_KEY = "judge_class_id";   // "1-5" 같은 형식
const local = {
  classId: localStorage.getItem(LS_KEY) || "",
  currentGameId: null,
};

/* ---------------- 공통 UI ---------------- */
onConnection((online) => {
  const t = document.getElementById("topSub");
  t.textContent = online ? "● 실시간 연결됨" : "● 연결 대기 중";
  t.style.color = online ? "#86efac" : "#fca5a5";
});

onState(() => {
  updateTopBar();
  if (inScreen("games")) renderGameList();
  if (inScreen("class")) renderClassGroups();
});

function updateTopBar() {
  const title = document.getElementById("topTitle");
  const pill = document.getElementById("topPill");
  const s = getState();
  if (local.classId) {
    title.textContent = `심판 · ${formatClassId(local.classId)}`;
    pill.textContent = s.school || "학교 미설정";
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
        onclick: () => {
          local.classId = cid;
          localStorage.setItem(LS_KEY, cid);
          updateTopBar();
          showGameList();
        }
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
  document.getElementById("tReset").onclick = resetTimer;
  document.getElementById("tBack").onclick = () => { stopTimer(); showGameList(); };
  document.getElementById("tSubmit").onclick = () => submitTime(gid);
  document.getElementById("tDelete").onclick = () => deleteMyScore(gid);
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
  showGameList();
} else {
  local.classId = "";
  showClassSelect();
}
