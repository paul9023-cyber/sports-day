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

// 등수 계산 (scoreType: "time"→낮을수록 좋음, "points"→높을수록 좋음)
export function computeRanks(entries, scoreType) {
  const valid = entries.filter(e => e.value != null);
  valid.sort((a, b) => {
    if (scoreType === "time") return a.value - b.value;
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
