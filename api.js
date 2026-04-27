// 로컬 서버와 통신하는 간단한 클라이언트
// - SSE(/api/events)로 실시간 상태를 받고
// - fetch()로 변경 요청을 보냅니다.

const target = new EventTarget();
let _state = { school: "", grades: 3, classesPerGrade: { "1": 10, "2": 10, "3": 10 }, games: {}, scores: {} };
let _conn = false;
let _es = null;

export function getState() { return _state; }
export function grades() { return Number(_state.grades || 3); }

// 이전 버전 호환: classesPerGrade가 숫자로 들어올 수도 있으므로 dict로 변환
function _cpgDict() {
  const raw = _state.classesPerGrade;
  const g = grades();
  const out = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (let i = 1; i <= g; i++) {
      const v = Number(raw[i] ?? raw[String(i)] ?? 10);
      out[String(i)] = Math.max(1, Math.min(30, v || 10));
    }
  } else {
    const n = Math.max(1, Math.min(30, Number(raw) || 10));
    for (let i = 1; i <= g; i++) out[String(i)] = n;
  }
  return out;
}

export function classesPerGradeMap() { return _cpgDict(); }
export function classesForGrade(gr) {
  const m = _cpgDict();
  return Number(m[String(gr)] || 10);
}
export function totalClasses() {
  const m = _cpgDict();
  let sum = 0;
  for (const k of Object.keys(m)) sum += Number(m[k] || 0);
  return sum;
}

// 모든 classId를 학년순으로 반환: ["1-1","1-2",...,"3-10"]
export function allClassIds() {
  const out = [];
  const m = _cpgDict();
  for (let g = 1; g <= grades(); g++) {
    const cpg = Number(m[String(g)] || 10);
    for (let c = 1; c <= cpg; c++) out.push(`${g}-${c}`);
  }
  return out;
}

// 특정 학년의 classId만
export function classIdsForGrade(gr) {
  const out = [];
  const cpg = classesForGrade(gr);
  for (let c = 1; c <= cpg; c++) out.push(`${gr}-${c}`);
  return out;
}

export function onState(cb) {
  target.addEventListener("state", () => cb(_state));
  // 즉시 1회 호출
  cb(_state);
}

export function onConnection(cb) {
  target.addEventListener("conn", (e) => cb(e.detail));
  cb(_conn);
}

function setConn(v) {
  if (_conn === v) return;
  _conn = v;
  target.dispatchEvent(new CustomEvent("conn", { detail: v }));
}

// 직접 fetch로 최신 state를 받아오는 보조 수단
// (SSE 연결이 끊겼거나 모바일이 백그라운드에서 깨어났을 때 사용)
async function refreshState() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) return;
    const fresh = await res.json();
    _state = fresh;
    target.dispatchEvent(new Event("state"));
    setConn(true);
  } catch (e) {
    setConn(false);
  }
}

let _lastEventAt = 0;

function startSSE() {
  try {
    if (_es) _es.close();
    _es = new EventSource("/api/events");
  } catch (e) {
    setTimeout(startSSE, 2000);
    return;
  }
  _es.onopen = () => { setConn(true); _lastEventAt = Date.now(); };
  _es.onmessage = (ev) => {
    setConn(true);
    _lastEventAt = Date.now();
    try {
      _state = JSON.parse(ev.data);
      target.dispatchEvent(new Event("state"));
    } catch {}
  };
  _es.onerror = () => {
    setConn(false);
    if (_es && _es.readyState === EventSource.CLOSED) {
      setTimeout(startSSE, 2000);
    }
  };
}

// 모바일에서 화면이 다시 켜지거나 탭이 다시 활성화되면
// 1) 즉시 최신 상태를 직접 받아오고
// 2) SSE 연결이 죽었을 가능성이 높으면 재연결
function _onWakeUp() {
  refreshState();
  const stale = (Date.now() - _lastEventAt) > 30_000;
  if (!_es || _es.readyState === EventSource.CLOSED || stale) {
    startSSE();
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") _onWakeUp();
});
window.addEventListener("focus", _onWakeUp);
window.addEventListener("online", _onWakeUp);

// 안전망: 30초마다 SSE 메시지가 없으면 직접 갱신
setInterval(() => {
  if (Date.now() - _lastEventAt > 30_000) {
    refreshState();
  }
}, 15_000);

async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

export const api = {
  setSchool:    (name) => req("POST", "/api/school", { name }),
  // classesPerGrade는 {"1":10,"2":8,...} 형태의 dict
  setStructure: (grades, classesPerGrade) =>
    req("POST", "/api/structure", { grades, classesPerGrade }),
  addGame:    (name, scoreType, opts = {}) =>
    req("POST", "/api/game", {
      name, scoreType,
      scope: opts.scope || "all",
      gradeNum: opts.gradeNum ?? null,
      timeOrder: opts.timeOrder || "asc",
    }),
  renameGame: (gid, name) => req("PATCH", `/api/game/${encodeURIComponent(gid)}`, { name }),
  deleteGame: (gid) => req("DELETE", `/api/game/${encodeURIComponent(gid)}`),
  submitScore: (gameId, classId, value) =>
    req("POST", "/api/score", { gameId, classId, value }),
  deleteScore: (gameId, classId) =>
    req("DELETE", `/api/score?gameId=${encodeURIComponent(gameId)}&classId=${encodeURIComponent(classId)}`),
  resetAll:    () => req("POST", "/api/reset-all"),
  resetScores: () => req("POST", "/api/reset-scores"),
};

// 페이지 진입 즉시 최신 상태를 받아오고 (SSE 첫 메시지 기다리지 않음)
refreshState();
startSSE();
