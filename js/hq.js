import { api, getState, onState, onConnection, grades, classesPerGrade, allClassIds, totalClasses } from "./api.js";
import { $, $$, el, toast, formatTime, scoreToText, computeRanks, confirmBox, formatClassId, parseClassId } from "./common.js";
import { renderQRCode } from "./qr.js";

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
  const cInput = document.getElementById("classesPerGradeInput");
  if (document.activeElement !== gInput) gInput.value = s.grades || 3;
  if (document.activeElement !== cInput) cInput.value = s.classesPerGrade || 10;
  document.getElementById("structureSummary").textContent =
    `현재: ${s.grades}학년 × 각 ${s.classesPerGrade}반 = 총 ${(s.grades||0)*(s.classesPerGrade||0)}개 반`;

  renderGameList();
  renderLive();
  renderTotal();
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
  const c = Number(document.getElementById("classesPerGradeInput").value);
  if (!(g >= 1 && g <= 12) || !(c >= 1 && c <= 30)) {
    toast("학년 1~12, 반 1~30 범위로 입력하세요"); return;
  }
  const s = getState();
  if ((g < s.grades || c < s.classesPerGrade) && Object.keys(s.scores).length > 0) {
    const ok = await confirmBox(
      `구성을 줄이면 범위를 벗어난 반의 점수는 화면에서 사라집니다. 그대로 저장할까요?\n(데이터는 남지만 표시되지 않습니다)`
    );
    if (!ok) return;
  }
  try { await api.setStructure(g, c); toast(`${g}학년 × ${c}반 으로 저장됨`); }
  catch (e) { toast("저장 실패"); }
});

/* ---------------- 종목 추가 ---------------- */
let newGameType = "points";
$$("#gameTypeSeg button").forEach(b => {
  b.addEventListener("click", () => {
    $$("#gameTypeSeg button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    newGameType = b.dataset.type;
  });
});

document.getElementById("addGame").addEventListener("click", async () => {
  const name = document.getElementById("gameName").value.trim();
  if (!name) { toast("종목 이름을 입력하세요"); return; }
  try {
    await api.addGame(name, newGameType);
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
  const TC = totalClasses();
  for (const [gid, g] of entries) {
    const scoresObj = getState().scores[gid] || {};
    const count = Object.keys(scoresObj).length;
    const pill = el("span", {
      class: `pill ${g.scoreType === "time" ? "pill-time" : "pill-point"}`
    }, g.scoreType === "time" ? "타임" : "점수");
    const item = el("div", { class: "game-item" }, [
      el("div", { class: "g-name" }, [
        document.createTextNode(g.name + " "),
        pill,
        el("div", { class: "small muted", style: "margin-top:4px" }, `입력 ${count}/${TC}반`),
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
  const CPG = classesPerGrade();

  for (const [gid, g] of entries) {
    const scoresObj = getState().scores[gid] || {};
    const list = allClassIds().map((cid) => ({
      classId: cid,
      value: scoresObj[cid]?.value ?? null,
    }));
    const ranked = computeRanks(list.filter(x => x.value != null), g.scoreType);

    const card = el("div", { class: "card" });
    card.appendChild(el("div", {
      style: "display:flex;align-items:center;gap:8px;margin-bottom:8px;"
    }, [
      el("h2", { style: "margin:0;flex:1" }, g.name),
      el("span", { class: `pill ${g.scoreType === "time" ? "pill-time" : "pill-point"}` },
        g.scoreType === "time" ? "타임" : "점수"),
    ]));

    // 입력 현황 — 학년별로 그룹핑
    for (let gr = 1; gr <= G; gr++) {
      card.appendChild(el("div", {
        class: "small muted",
        style: "margin:8px 0 4px;font-weight:700;color:#cfe0ff",
      }, `${gr}학년`));
      const grid = el("div", { class: "progress-grid" });
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
      table.appendChild(el("thead", {}, el("tr", {}, [
        el("th", {}, "등수"),
        el("th", {}, "반"),
        el("th", {}, g.scoreType === "time" ? "기록" : "점수"),
      ])));
      const tbody = el("tbody");
      for (const r of ranked) {
        tbody.appendChild(el("tr", {}, [
          el("td", { class: `rank rank-${r.rank <= 3 ? r.rank : ""}` }, `${r.rank}위`),
          el("td", {}, formatClassId(r.classId)),
          el("td", {}, scoreToText(g.scoreType, r.value)),
        ]));
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
  const TC = ids.length;

  const totals = {};
  for (const cid of ids) totals[cid] = { classId: cid, total: 0, details: [] };

  for (const [gid, g] of games) {
    const scoresObj = getState().scores[gid] || {};
    const list = ids.map((cid) => ({
      classId: cid,
      value: scoresObj[cid]?.value ?? null,
    }));
    const ranked = computeRanks(list.filter(x => x.value != null), g.scoreType);
    for (const r of ranked) {
      const awarded = Math.max(0, TC - r.rank + 1);
      totals[r.classId].total += awarded;
      totals[r.classId].details.push({ game: g.name, rank: r.rank, pts: awarded });
    }
  }

  const arr = Object.values(totals).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    // 동점은 학년-반 오름차순
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
      ? t.details.map(d => `${d.game} ${d.rank}위(+${d.pts})`).join(", ")
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
document.getElementById("resetScoresBtn")?.addEventListener("click", async () => {
  const ok = await confirmBox("모든 점수/기록을 삭제할까요? (종목은 남습니다)");
  if (!ok) return;
  try { await api.resetScores(); toast("점수가 초기화되었습니다"); }
  catch (e) { toast("실패"); }
});
document.getElementById("resetAllBtn")?.addEventListener("click", async () => {
  const ok = await confirmBox("⚠️ 모든 종목과 점수를 완전히 삭제합니다. 진행할까요?");
  if (!ok) return;
  try { await api.resetAll(); toast("초기화 완료"); }
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
