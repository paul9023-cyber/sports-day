import { api, getState, onState, onConnection, grades, classesPerGradeMap, classesForGrade, allClassIds, classIdsForGrade, totalClasses } from "./api.js";
import { $, $$, el, toast, formatTime, scoreToText, computeRanks, computeScores, getScopeClassIds, gameScopeLabel, confirmBox, formatClassId, parseClassId } from "./common.js";
import { renderQRCode } from "./qr.js";

/* ---------------- 비밀번호 게이트 ---------------- */
if (sessionStorage.getItem("hq_auth_ok") !== "1") {
  // 인증 안 됐으면 홈으로 돌려보냄
  location.replace("./index.html");
}

/* ---------------- 연결 표시 ---------------- */
onConnection((online) => {
  const t = document.getElementById("connText");
  t.textContent = online ? "● 실시간 연결됨" : "● 연결 대기 중";
  t.style.color = online ? "#86efac" : "#fca5a5";
});

/* ---------------- 탭 ---------------- */
$$("#tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    $$("#tabs button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    ["setup","live","total"].forEach(t => {
      document.getElementById(`tab-${t}`).classList.toggle("hidden", t !== btn.dataset.tab);
    });
  });
});

/* ---------------- 상태 갱신 시 다시 그림 ---------------- */
onState((s) => {
  // 학교명
  const input = document.getElementById("schoolInput");
  if (document.activeElement !== input) input.value = s.school || "";
  document.getElementById("schoolPill").textContent = s.school || "학교 미설정";

  // 학년/반 구성 입력
  const gInput = document.getElementById("gradesInput");
  if (document.activeElement !== gInput) gInput.value = s.grades || 3;
  renderGradeClassInputs();
  updateStructureSummary();

  renderGameScopeGradeButtons();
  renderGameList();
  renderLive();
  renderTotal();
});

/* ---------------- 학년별 반 수 입력 UI ---------------- */
function renderGradeClassInputs() {
  const s = getState();
  const wrap = document.getElementById("gradeClassInputs");
  if (!wrap) return;
  const G = Number(document.getElementById("gradesInput").value || s.grades || 3);
  const cpg = s.classesPerGrade || {};
  // 기존 포커스 보존
  const active = document.activeElement;
  const activeGrade = active?.dataset?.grade;
  const activeVal = active?.value;

  wrap.innerHTML = "";
  const row = document.createElement("div");
  row.className = "row";
  row.style.flexWrap = "wrap";
  row.style.gap = "10px";
  for (let g = 1; g <= G; g++) {
    const val = cpg[String(g)] ?? 10;
    const cell = document.createElement("div");
    cell.style.flex = "1 1 110px";
    cell.innerHTML = `
      <div class="label">${g}학년 반 수</div>
      <input class="input grade-class-input" type="number" min="1" max="30" data-grade="${g}" value="${val}" />
    `;
    row.appendChild(cell);
  }
  wrap.appendChild(row);

  // 포커스 복원
  if (activeGrade) {
    const el2 = wrap.querySelector(`input[data-grade="${activeGrade}"]`);
    if (el2) { el2.focus(); if (activeVal != null) el2.value = activeVal; }
  }

  // 입력 시 요약 갱신
  wrap.querySelectorAll(".grade-class-input").forEach(inp => {
    inp.addEventListener("input", updateStructureSummary);
  });
}

function collectClassesPerGrade() {
  const G = Number(document.getElementById("gradesInput").value || 3);
  const out = {};
  for (let g = 1; g <= G; g++) {
    const inp = document.querySelector(`.grade-class-input[data-grade="${g}"]`);
    let v = Number(inp?.value || 10);
    if (!(v >= 1 && v <= 30)) v = 10;
    out[String(g)] = v;
  }
  return out;
}

function updateStructureSummary() {
  const G = Number(document.getElementById("gradesInput").value || 3);
  const m = collectClassesPerGrade();
  let total = 0;
  const parts = [];
  for (let g = 1; g <= G; g++) {
    const n = Number(m[String(g)] || 0);
    total += n;
    parts.push(`${g}학년 ${n}반`);
  }
  const el2 = document.getElementById("structureSummary");
  if (el2) el2.textContent = `${parts.join(", ")} → 총 ${total}개 반`;
}

// 학년 수가 바뀌면 반 입력 UI 재렌더
document.getElementById("gradesInput")?.addEventListener("input", () => {
  renderGradeClassInputs();
  updateStructureSummary();
  renderGameScopeGradeButtons();
});

/* ---------------- 학교명 저장 ---------------- */
document.getElementById("saveSchool").addEventListener("click", async () => {
  const v = document.getElementById("schoolInput").value.trim();
  if (!v) { toast("학교 이름을 입력하세요"); return; }
  try { await api.setSchool(v); toast("학교 이름 저장됨"); }
  catch (e) { toast("저장 실패"); }
});

/* ---------------- 학년/반 구성 저장 ---------------- */
document.getElementById("saveStructure").addEventListener("click", async () => {
  const g = Number(document.getElementById("gradesInput").value);
  if (!(g >= 1 && g <= 12)) {
    toast("학년 수는 1~12 범위로 입력하세요"); return;
  }
  const m = collectClassesPerGrade();
  for (let i = 1; i <= g; i++) {
    const n = Number(m[String(i)] || 0);
    if (!(n >= 1 && n <= 30)) {
      toast(`${i}학년 반 수는 1~30 범위로 입력하세요`); return;
    }
  }
  const s = getState();
  const prevMap = s.classesPerGrade || {};
  let shrink = g < Number(s.grades || g);
  if (!shrink) {
    for (let i = 1; i <= g; i++) {
      if (Number(m[String(i)] || 0) < Number(prevMap[String(i)] || 0)) { shrink = true; break; }
    }
  }
  if (shrink && Object.keys(s.scores || {}).length > 0) {
    const ok = await confirmBox(
      `구성을 줄이면 범위를 벗어난 반의 점수는 화면에서 사라집니다. 그대로 저장할까요?\n(데이터는 남지만 표시되지 않습니다)`
    );
    if (!ok) return;
  }
  try {
    await api.setStructure(g, m);
    toast("학년/반 구성 저장됨");
  } catch (e) { toast("저장 실패"); }
});

/* ---------------- 종목 추가 ---------------- */
let newGameType = "points";
let newGameScope = "all";
let newGameGrade = null;
let newGameOrder = "asc";

function updateGameFormVisibility() {
  document.getElementById("timeOptions").classList.toggle("hidden", newGameType !== "time");
  document.getElementById("gameGradePicker").classList.toggle("hidden",
    !(newGameType === "time" && newGameScope === "grade"));
}

$$("#gameTypeSeg button").forEach(b => {
  b.addEventListener("click", () => {
    $$("#gameTypeSeg button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    newGameType = b.dataset.type;
    updateGameFormVisibility();
  });
});

$$("#gameScopeSeg button").forEach(b => {
  b.addEventListener("click", () => {
    $$("#gameScopeSeg button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    newGameScope = b.dataset.scope;
    if (newGameScope === "grade" && !newGameGrade) newGameGrade = 1;
    updateGameFormVisibility();
    renderGameScopeGradeButtons();
  });
});

$$("#gameOrderSeg button").forEach(b => {
  b.addEventListener("click", () => {
    $$("#gameOrderSeg button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    newGameOrder = b.dataset.order;
  });
});

function renderGameScopeGradeButtons() {
  const G = Number(document.getElementById("gradesInput").value || grades());
  const wrap = document.getElementById("gameGradeSeg");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (newGameGrade == null || newGameGrade > G) newGameGrade = 1;
  for (let g = 1; g <= G; g++) {
    const btn = document.createElement("button");
    btn.textContent = `${g}학년`;
    if (g === newGameGrade) btn.classList.add("active");
    btn.addEventListener("click", () => {
      newGameGrade = g;
      renderGameScopeGradeButtons();
    });
    wrap.appendChild(btn);
  }
}

document.getElementById("addGame").addEventListener("click", async () => {
  const name = document.getElementById("gameName").value.trim();
  if (!name) { toast("종목 이름을 입력하세요"); return; }
  const opts = {};
  if (newGameType === "time") {
    opts.scope = newGameScope;
    opts.gradeNum = newGameScope === "grade" ? newGameGrade : null;
    opts.timeOrder = newGameOrder;
  } else {
    // points 게임은 항상 전체
    opts.scope = "all"; opts.gradeNum = null;
  }
  try {
    await api.addGame(name, newGameType, opts);
    document.getElementById("gameName").value = "";
    toast("종목 추가됨");
  } catch (e) { toast("추가 실패"); }
});

/* ---------------- 등록된 종목 리스트 ---------------- */
function sortedGames() {
  return Object.entries(getState().games).sort(
    (a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0)
  );
}

function renderGameList() {
  const wrap = document.getElementById("gameList");
  const entries = sortedGames();
  wrap.innerHTML = "";
  if (entries.length === 0) {
    wrap.appendChild(el("div", { class: "empty" }, "등록된 종목이 없습니다. 위에서 추가해 보세요."));
    return;
  }
  const allIds = allClassIds();
  for (const [gid, g] of entries) {
    const scoresObj = getState().scores[gid] || {};
    const scopeIds = getScopeClassIds(g, allIds);
    const count = scopeIds.filter(cid => scoresObj[cid] != null).length;
    const typePill = el("span", {
      class: `pill ${g.scoreType === "time" ? "pill-time" : "pill-point"}`
    }, g.scoreType === "time" ? "스톱워치" : "점수");
    const scopePill = el("span", {
      class: "pill",
      style: g.scope === "grade"
        ? "background:#f59e0b22;color:#fbbf24;margin-left:4px"
        : "background:#38bdf822;color:#93c5fd;margin-left:4px",
    }, gameScopeLabel(g));
    const orderNote = (g.scoreType === "time")
      ? ` · ${g.timeOrder === "desc" ? "느린 순 1등" : "빠른 순 1등"}`
      : "";
    const item = el("div", { class: "game-item" }, [
      el("div", { class: "g-name" }, [
        document.createTextNode(g.name + " "),
        typePill,
        scopePill,
        el("div", { class: "small muted", style: "margin-top:4px" },
          `입력 ${count}/${scopeIds.length}반${orderNote}`),
      ]),
      el("div", { class: "g-actions" }, [
        el("button", { class: "icon-btn", title: "이름 수정",
          onclick: () => renameGame(gid, g.name) }, "✎"),
        el("button", { class: "icon-btn delete", title: "삭제",
          onclick: () => deleteGame(gid, g.name) }, "✕"),
      ]),
    ]);
    wrap.appendChild(item);
  }
}

async function renameGame(gid, oldName) {
  const nm = prompt("종목 이름 수정", oldName);
  if (!nm || nm.trim() === "" || nm === oldName) return;
  try { await api.renameGame(gid, nm.trim()); toast("수정됨"); }
  catch (e) { toast("수정 실패"); }
}

async function deleteGame(gid, name) {
  const ok = await confirmBox(`"${name}" 종목을 삭제할까요? 입력된 점수도 함께 삭제됩니다.`);
  if (!ok) return;
  try { await api.deleteGame(gid); toast("삭제됨"); }
  catch (e) { toast("삭제 실패"); }
}

/* ---------------- 실시간 현황 ---------------- */
function renderLive() {
  const wrap = document.getElementById("liveList");
  const entries = sortedGames();
  wrap.innerHTML = "";
  if (entries.length === 0) {
    wrap.appendChild(el("div", { class: "card empty" }, "등록된 종목이 없습니다."));
    return;
  }
  const G = grades();
  const allIds = allClassIds();
  const cpgMap = classesPerGradeMap();

  for (const [gid, g] of entries) {
    const scoresObj = getState().scores[gid] || {};
    const scopeIds = getScopeClassIds(g, allIds);
    const list = scopeIds.map((cid) => ({
      classId: cid,
      value: scoresObj[cid]?.value ?? null,
    }));
    const ranked = computeRanks(list.filter(x => x.value != null), g);

    // 각 반이 실제로 얻는 점수 계산 (타임랩은 자동환산, 포인트는 입력값)
    const { scoreMap } = computeScores(g, scoresObj, scopeIds, cpgMap, "last");

    const card = el("div", { class: "card" });
    const scopeBadge = el("span", {
      class: "pill",
      style: g.scope === "grade"
        ? "background:#f59e0b22;color:#fbbf24"
        : "background:#38bdf822;color:#93c5fd",
    }, gameScopeLabel(g));
    card.appendChild(el("div", {
      style: "display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap"
    }, [
      el("h2", { style: "margin:0;flex:1;min-width:140px" }, g.name),
      el("span", { class: `pill ${g.scoreType === "time" ? "pill-time" : "pill-point"}` },
        g.scoreType === "time" ? "스톱워치" : "점수"),
      scopeBadge,
    ]));
    if (g.scoreType === "time") {
      card.appendChild(el("div", { class: "small muted", style: "margin-bottom:6px" },
        g.scope === "grade"
          ? `1등=${(cpgMap[String(g.gradeNum)]||10)*10}점 … 10점 간격 · ${g.timeOrder === "desc" ? "느린 순" : "빠른 순"} 1등`
          : `1등=180점 … 18등=10점 고정 · ${g.timeOrder === "desc" ? "느린 순" : "빠른 순"} 1등`
      ));
    }

    // 입력 현황 — 학년별로 그룹핑 (scope=grade면 그 학년만)
    const showGrades = (g.scope === "grade" && g.gradeNum) ? [Number(g.gradeNum)] : [];
    if (showGrades.length === 0) for (let i = 1; i <= G; i++) showGrades.push(i);

    for (const gr of showGrades) {
      card.appendChild(el("div", {
        class: "small muted",
        style: "margin:8px 0 4px;font-weight:700;color:#cfe0ff",
      }, `${gr}학년`));
      const grid = el("div", { class: "progress-grid" });
      const CPG = Number(cpgMap[String(gr)] || 10);
      for (let c = 1; c <= CPG; c++) {
        const cid = `${gr}-${c}`;
        const done = scoresObj[cid] != null;
        grid.appendChild(el("div", { class: `progress-cell ${done ? "done" : ""}` }, `${c}반`));
      }
      card.appendChild(grid);
    }

    // 등수 테이블
    if (ranked.length === 0) {
      card.appendChild(el("div", { class: "rank-empty" }, "아직 입력된 기록이 없습니다."));
    } else {
      const table = el("table", { class: "rank-table", style: "margin-top:10px" });
      const headCols = [
        el("th", {}, "등수"),
        el("th", {}, "반"),
        el("th", {}, g.scoreType === "time" ? "기록" : "점수"),
      ];
      if (g.scoreType === "time") headCols.push(el("th", {}, "획득점수"));
      table.appendChild(el("thead", {}, el("tr", {}, headCols)));
      const tbody = el("tbody");
      for (const r of ranked) {
        const cols = [
          el("td", { class: `rank rank-${r.rank <= 3 ? r.rank : ""}` }, `${r.rank}위`),
          el("td", {}, formatClassId(r.classId)),
          el("td", {}, scoreToText(g.scoreType, r.value)),
        ];
        if (g.scoreType === "time") {
          cols.push(el("td", { style: "font-weight:800" }, `${scoreMap[r.classId] ?? 0}점`));
        }
        tbody.appendChild(el("tr", {}, cols));
      }
      table.appendChild(tbody);
      card.appendChild(table);
    }
    wrap.appendChild(card);
  }
}

/* ---------------- 종합 등수 ---------------- */
function renderTotal() {
  const wrap = document.getElementById("totalRank");
  const games = sortedGames();
  const ids = allClassIds();
  const cpgMap = classesPerGradeMap();

  const totals = {};
  for (const cid of ids) totals[cid] = { classId: cid, total: 0, details: [] };

  for (const [gid, g] of games) {
    const scoresObj = getState().scores[gid] || {};
    const scopeIds = getScopeClassIds(g, ids);
    const { scoreMap, ranked } = computeScores(g, scoresObj, scopeIds, cpgMap, "last");
    const rankMap = {};
    for (const r of ranked) rankMap[r.classId] = r.rank;

    for (const cid of scopeIds) {
      if (!(cid in totals)) continue;
      const pts = scoreMap[cid] ?? 0;
      totals[cid].total += pts;
      if (pts > 0) {
        totals[cid].details.push({
          game: g.name,
          rank: rankMap[cid] || null,
          pts,
          type: g.scoreType,
        });
      }
    }
  }

  const arr = Object.values(totals).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    const pa = parseClassId(a.classId), pb = parseClassId(b.classId);
    return pa.grade - pb.grade || pa.classNum - pb.classNum;
  });
  let prev = null, rk = 0, idx = 0;
  for (const t of arr) {
    idx++;
    if (prev === null || t.total !== prev) rk = idx;
    t.rank = rk;
    prev = t.total;
  }

  wrap.innerHTML = "";
  if (games.length === 0) {
    wrap.appendChild(el("div", { class: "empty" }, "등록된 종목이 없습니다."));
    return;
  }

  const table = el("table", { class: "rank-table" });
  table.appendChild(el("thead", {}, el("tr", {}, [
    el("th", {}, "등수"),
    el("th", {}, "반"),
    el("th", {}, "종합점수"),
    el("th", {}, "세부"),
  ])));
  const tbody = el("tbody");
  for (const t of arr) {
    const detail = t.details.length
      ? t.details.map(d => d.rank ? `${d.game} ${d.rank}위(+${d.pts})` : `${d.game}(+${d.pts})`).join(", ")
      : "-";
    tbody.appendChild(el("tr", {}, [
      el("td", { class: `rank rank-${t.rank <= 3 ? t.rank : ""}` }, `${t.rank}위`),
      el("td", {}, formatClassId(t.classId)),
      el("td", { style: "font-weight:800" }, `${t.total}점`),
      el("td", { class: "small muted" }, detail),
    ]));
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
}

/* ---------------- 데이터 초기화 버튼 ---------------- */
const HQ_PASSWORD = "5350";

// 비밀번호를 입력받는 prompt 모달 (CSS 모달 재사용 없이 직접 만들어 띄움)
function passwordPrompt(message) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.style.alignItems = "center";
    wrap.innerHTML = `
      <div class="modal" style="max-width:340px;text-align:center;">
        <h3 style="margin:0 0 6px">⚠ 본부 비밀번호 확인</h3>
        <p class="small muted" style="margin:0 0 12px;white-space:pre-line">${message || ""}</p>
        <input type="password" inputmode="numeric" autocomplete="off" maxlength="16"
               class="input" placeholder="비밀번호"
               style="text-align:center;font-size:20px;letter-spacing:6px;" />
        <div class="small" style="color:#fca5a5;min-height:18px;margin-top:6px" data-err></div>
        <div class="spacer"></div>
        <div class="row">
          <button class="btn btn-ghost" data-cancel>취소</button>
          <button class="btn btn-danger" data-ok>확인</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const inp = wrap.querySelector("input");
    const err = wrap.querySelector("[data-err]");
    const close = (val) => { wrap.remove(); resolve(val); };
    setTimeout(() => inp.focus(), 50);
    wrap.querySelector("[data-cancel]").addEventListener("click", () => close(false));
    wrap.querySelector("[data-ok]").addEventListener("click", () => {
      if (inp.value === HQ_PASSWORD) close(true);
      else { err.textContent = "비밀번호가 올바르지 않습니다"; inp.value = ""; inp.focus(); }
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") wrap.querySelector("[data-ok]").click();
      if (e.key === "Escape") close(false);
    });
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(false); });
  });
}

document.getElementById("resetScoresBtn")?.addEventListener("click", async () => {
  const ok = await confirmBox(
    "모든 점수/기록을 삭제할까요?\n(종목 목록은 그대로 남습니다)\n\n이 작업은 되돌릴 수 없습니다."
  );
  if (!ok) return;
  const pwOk = await passwordPrompt("점수 초기화를 위해\n본부 비밀번호를 입력하세요.");
  if (!pwOk) return;
  try { await api.resetScores(); toast("점수가 초기화되었습니다"); }
  catch (e) { toast("실패"); }
});

document.getElementById("resetAllBtn")?.addEventListener("click", async () => {
  const ok = await confirmBox(
    "⚠️ 전체 초기화\n\n모든 종목과 모든 점수가 완전히 삭제됩니다.\n학교 이름과 학년/반 구성만 남고 나머지는 사라집니다.\n\n정말 진행할까요?"
  );
  if (!ok) return;
  const pwOk = await passwordPrompt("전체 초기화를 위해\n본부 비밀번호를 입력하세요.");
  if (!pwOk) return;
  try { await api.resetAll(); toast("전체 초기화 완료"); }
  catch (e) { toast("실패"); }
});

/* ---------------- 심판 초대 QR 모달 ---------------- */
const hqShareBtn = document.getElementById("hqShareBtn");
const hqModal = document.getElementById("hqConnectModal");
const hqCloseBtn = document.getElementById("hqCloseConnectBtn");
let hqPollTimer = null;

function hqApplyInfo(info) {
  const isCloud = !!info.isCloud;
  const tabs = document.getElementById("hqConnTabs");
  const localPanel = document.getElementById("hqcpanel-local");
  if (isCloud) {
    if (tabs) tabs.style.display = "none";
    if (localPanel) localPanel.classList.add("hidden");
  }
  const localUrl = info.localUrl;
  document.getElementById("hqLocalUrl").textContent = localUrl;
  const qrLocal = document.getElementById("hqQrWrapLocal");
  if (qrLocal && (!qrLocal.dataset.url || qrLocal.dataset.url !== localUrl)) {
    renderQRCode(qrLocal, localUrl, 10, 4);
    qrLocal.dataset.url = localUrl;
  }

  const loading = document.getElementById("hqTunnelLoading");
  const ready = document.getElementById("hqTunnelReady");
  const error = document.getElementById("hqTunnelError");
  const statusText = document.getElementById("hqTunnelStatusText");

  if (info.tunnelStatus === "ready" && info.tunnelUrl) {
    loading.classList.add("hidden");
    error.classList.add("hidden");
    ready.classList.remove("hidden");
    document.getElementById("hqTunnelUrl").textContent = info.tunnelUrl;
    const qr = document.getElementById("hqQrWrap");
    if (qr.dataset.url !== info.tunnelUrl) {
      renderQRCode(qr, info.tunnelUrl, 10, 4);
      qr.dataset.url = info.tunnelUrl;
    }
  } else if (info.tunnelStatus === "error" || info.tunnelStatus === "disabled") {
    loading.classList.add("hidden");
    ready.classList.add("hidden");
    error.classList.remove("hidden");
    document.getElementById("hqTunnelErrorMsg").textContent = info.tunnelMessage || "";
  } else {
    ready.classList.add("hidden");
    error.classList.add("hidden");
    loading.classList.remove("hidden");
    const msgMap = {
      downloading: "cloudflared.exe 다운로드 중... (최초 1회, 약 40MB)",
      starting: "공개 주소 생성 중...",
    };
    statusText.textContent = msgMap[info.tunnelStatus] || (info.tunnelMessage || "준비 중...");
  }
}

async function hqFetchInfo() {
  try {
    const res = await fetch("/api/info");
    const info = await res.json();
    hqApplyInfo(info);
    if (info.tunnelStatus === "starting" || info.tunnelStatus === "downloading") {
      hqPollTimer = setTimeout(hqFetchInfo, 2000);
    } else {
      hqPollTimer = null;
    }
  } catch (e) {
    hqPollTimer = setTimeout(hqFetchInfo, 3000);
  }
}

function hqSelectTab(which) {
  $$("#hqConnTabs button").forEach(b => {
    b.classList.toggle("active", b.dataset.htab === which);
  });
  document.getElementById("hqcpanel-tunnel").classList.toggle("hidden", which !== "tunnel");
  document.getElementById("hqcpanel-local").classList.toggle("hidden", which !== "local");
}

$$("#hqConnTabs button").forEach(b => {
  b.addEventListener("click", () => hqSelectTab(b.dataset.htab));
});

function hqOpenModal() {
  hqModal.classList.remove("hidden");
  hqSelectTab("tunnel");
  hqFetchInfo();
}
function hqCloseModal() {
  hqModal.classList.add("hidden");
  if (hqPollTimer) { clearTimeout(hqPollTimer); hqPollTimer = null; }
}

hqShareBtn?.addEventListener("click", hqOpenModal);
hqCloseBtn?.addEventListener("click", hqCloseModal);
hqModal?.addEventListener("click", (e) => { if (e.target === hqModal) hqCloseModal(); });
