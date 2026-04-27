// 공통 유틸리티

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (v === false || v == null) continue;
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, v);
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}

let toastTimer;
export function toast(msg) {
  let wrap = document.querySelector(".toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }
  wrap.innerHTML = "";
  const t = el("div", { class: "toast" }, msg);
  wrap.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { wrap.innerHTML = ""; }, 2400);
}

// 타임랩 ms → "mm:ss.SS" (소수점 2자리)
export function formatTime(ms) {
  if (ms == null || isNaN(ms)) return "--:--.--";
  const totalCentis = Math.round(ms / 10);
  const mm = Math.floor(totalCentis / 6000);
  const ss = Math.floor((totalCentis % 6000) / 100);
  const cc = totalCentis % 100;
  return `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}.${String(cc).padStart(2,"0")}`;
}

// 스코어 값을 표시용 텍스트로
export function scoreToText(scoreType, value) {
  if (value == null) return "-";
  if (scoreType === "time") return formatTime(value);
  return `${value}점`;
}

// classId "1-5" → "1학년 5반"
export function formatClassId(cid) {
  if (!cid) return "";
  const [g, c] = String(cid).split("-");
  return `${g}학년 ${c}반`;
}

// classId "1-5" → {grade:1, classNum:5}
export function parseClassId(cid) {
  const [g, c] = String(cid).split("-").map(Number);
  return { grade: g, classNum: c };
}

// 등수 계산
// game: {scoreType, timeOrder?}  — timeOrder는 time 전용 ("asc"=짧은게 1등 / "desc"=긴게 1등)
// points 게임은 "항상 높을수록 좋음"
export function computeRanks(entries, game) {
  // 이전 버전 호환: scoreType 문자열만 넘어온 경우
  let scoreType, timeOrder;
  if (typeof game === "string") { scoreType = game; timeOrder = "asc"; }
  else { scoreType = game.scoreType; timeOrder = game.timeOrder || "asc"; }

  const valid = entries.filter(e => e.value != null);
  valid.sort((a, b) => {
    if (scoreType === "time") {
      return timeOrder === "desc" ? (b.value - a.value) : (a.value - b.value);
    }
    return b.value - a.value;
  });
  let prev = null, rank = 0, realIdx = 0;
  for (const e of valid) {
    realIdx++;
    if (prev === null || e.value !== prev) { rank = realIdx; }
    e.rank = rank;
    prev = e.value;
  }
  return valid;
}

/**
 * 등수를 "획득 점수"로 환산.
 * - points 게임: 사용자가 입력한 값을 그대로 점수로 사용 (rawValue 사용)
 * - time 게임 + scope="grade": 해당 학년의 반 수 N → 1등=N*10, N등=10 (간격 10)
 * - time 게임 + scope="all" : 1등=180, 2등=170, …, 18등=10 (고정 테이블, 바닥 10)
 * 존재하지 않는 반/기록 없음 → 최저점(10점) 또는 0점은 호출자가 결정
 */
export function rankToScore(rank, game, ctx = {}) {
  if (!game) return 0;
  if (game.scoreType !== "time") {
    // points 게임: 입력한 값 자체가 점수 (rawValue 전달 필요)
    return Number(ctx.rawValue || 0);
  }
  if (game.scope === "grade") {
    const N = Math.max(1, Number(ctx.classesInGrade || 10));
    const s = (N - Number(rank) + 1) * 10;
    return Math.max(10, s);
  }
  // scope === "all" : 18칸 고정 테이블
  const s = (19 - Number(rank)) * 10;
  return Math.max(10, Math.min(180, s));
}

/**
 * 주어진 게임에서 각 반이 받는 "최종 점수"를 계산해 Map으로 반환.
 * key=classId, value=점수(없으면 0 또는 최저점)
 * opts: { classIdsInScope: string[] (선택), classesPerGradeMap: {g: N} }
 * tieRule: "last" → 미제출 반은 최저점 10 부여, "none" → 0 부여
 */
export function computeScores(game, scoresObj, allIdsInScope, cpgMap, tieRule = "last") {
  const submitted = [];
  for (const cid of allIdsInScope) {
    const v = scoresObj?.[cid]?.value;
    if (v != null) submitted.push({ classId: cid, value: v });
  }
  const ranked = computeRanks(submitted, game);
  const map = {};

  if (game.scoreType === "points") {
    for (const r of ranked) {
      map[r.classId] = Number(r.value || 0);
    }
    // 미제출: 0 (points는 꼬리 등수 개념 안 씀)
    for (const cid of allIdsInScope) if (!(cid in map)) map[cid] = 0;
    return { scoreMap: map, ranked };
  }

  // time 게임
  let classesInGrade = 10;
  if (game.scope === "grade" && game.gradeNum) {
    classesInGrade = Number(cpgMap?.[String(game.gradeNum)] || 10);
  }
  for (const r of ranked) {
    map[r.classId] = rankToScore(r.rank, game, { classesInGrade });
  }
  // 미제출 반 처리
  const lastScore = tieRule === "last" ? 10 : 0;
  for (const cid of allIdsInScope) {
    if (!(cid in map)) map[cid] = lastScore;
  }
  return { scoreMap: map, ranked };
}

// 게임이 어떤 반들을 대상으로 하는지 반환
// - points 또는 time/all: 모든 반
// - time/grade: 해당 학년의 반들만
export function getScopeClassIds(game, allIds) {
  if (game.scope === "grade" && game.gradeNum) {
    const g = Number(game.gradeNum);
    return allIds.filter(cid => Number(cid.split("-")[0]) === g);
  }
  return allIds.slice();
}

// 게임 설명 라벨
export function gameScopeLabel(game) {
  if (game.scope === "grade" && game.gradeNum) return `${game.gradeNum}학년`;
  return "전체";
}

export function roleLabel(role) {
  return role === "hq" ? "본부" : "심판";
}

export function confirmBox(msg) {
  return new Promise((resolve) => {
    const backdrop = el("div", { class: "modal-backdrop" });
    const modal = el("div", { class: "modal" }, [
      el("h3", {}, "확인"),
      el("p", { style: "color:#cbd5e1" }, msg),
      el("div", { class: "row", style: "margin-top:16px" }, [
        el("button", { class: "btn btn-ghost", onclick: () => close(false) }, "취소"),
        el("button", { class: "btn btn-danger", onclick: () => close(true) }, "확인"),
      ]),
    ]);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    function close(v) { backdrop.remove(); resolve(v); }
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(false); });
  });
}
