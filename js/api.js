// 로컬 서버와 통신하는 간단한 클라이언트
// - SSE(/api/events)로 실시간 상태를 받고
// - fetch()로 변경 요청을 보냅니다.

const target = new EventTarget();
let _state = { school: "", grades: 3, classesPerGrade: 10, games: {}, scores: {} };
let _conn = false;
let _es = null;

export function getState() { return _state; }
export function grades() { return Number(_state.grades || 3); }
export function classesPerGrade() { return Number(_state.classesPerGrade || 10); }
export function totalClasses() { return grades() * classesPerGrade(); }

// 모든 classId를 학년순으로 반환: ["1-1","1-2",...,"3-10"]
export function allClassIds() {
  const out = [];
  for (let g = 1; g <= grades(); g++) {
    for (let c = 1; c <= classesPerGrade(); c++) out.push(`${g}-${c}`);
  }
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

function startSSE() {
  try {
    if (_es) _es.close();
    _es = new EventSource("/api/events");
  } catch (e) {
    setTimeout(startSSE, 2000);
    return;
  }
  _es.onopen = () => setConn(true);
  _es.onmessage = (ev) => {
    setConn(true);
    try {
      _state = JSON.parse(ev.data);
      target.dispatchEvent(new Event("state"));
    } catch {}
  };
  _es.onerror = () => {
    setConn(false);
    // EventSource가 자동 재연결하지만, 닫혔으면 수동 재시도
    if (_es && _es.readyState === EventSource.CLOSED) {
      setTimeout(startSSE, 2000);
    }
  };
}

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
  setStructure: (grades, classesPerGrade) =>
    req("POST", "/api/structure", { grades, classesPerGrade }),
  addGame:    (name, scoreType) => req("POST", "/api/game", { name, scoreType }),
  renameGame: (gid, name) => req("PATCH", `/api/game/${encodeURIComponent(gid)}`, { name }),
  deleteGame: (gid) => req("DELETE", `/api/game/${encodeURIComponent(gid)}`),
  submitScore: (gameId, classId, value) =>
    req("POST", "/api/score", { gameId, classId, value }),
  deleteScore: (gameId, classId) =>
    req("DELETE", `/api/score?gameId=${encodeURIComponent(gameId)}&classId=${encodeURIComponent(classId)}`),
  resetAll:    () => req("POST", "/api/reset-all"),
  resetScores: () => req("POST", "/api/reset-scores"),
};

startSSE();
