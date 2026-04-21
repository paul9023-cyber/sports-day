import { api, onState, onConnection } from "./api.js";
import { renderQRCode } from "./qr.js";

document.querySelectorAll(".role-card").forEach((btn) => {
  btn.addEventListener("click", () => {
    const role = btn.dataset.role;
    if (role === "hq") location.href = "./hq.html";
    else location.href = "./judge.html";
  });
});

/* ---------- 휴대폰 접속 QR 모달 ---------- */
const showBtn = document.getElementById("showConnectBtn");
const modal = document.getElementById("connectModal");
const closeBtn = document.getElementById("closeConnectBtn");

let pollTimer = null;
let lastInfo = null;

function applyInfo(info) {
  lastInfo = info;
  // 클라우드 모드: 탭 숨기고 한 가지 URL만 표시
  const isCloud = !!info.isCloud;
  const tabs = document.getElementById("connTabs");
  const localPanel = document.getElementById("cpanel-local");
  if (isCloud) {
    if (tabs) tabs.style.display = "none";
    if (localPanel) localPanel.classList.add("hidden");
  }
  const localUrl = info.localUrl;
  document.getElementById("localUrl").textContent = localUrl;
  const qrLocal = document.getElementById("qrWrapLocal");
  if (qrLocal && (!qrLocal.dataset.url || qrLocal.dataset.url !== localUrl)) {
    renderQRCode(qrLocal, localUrl, 10, 4);
    qrLocal.dataset.url = localUrl;
  }

  // 터널 패널
  const statusText = document.getElementById("tunnelStatusText");
  const loading = document.getElementById("tunnelLoading");
  const ready = document.getElementById("tunnelReady");
  const error = document.getElementById("tunnelError");

  if (info.tunnelStatus === "ready" && info.tunnelUrl) {
    loading.classList.add("hidden");
    error.classList.add("hidden");
    ready.classList.remove("hidden");
    document.getElementById("tunnelUrl").textContent = info.tunnelUrl;
    const qr = document.getElementById("qrWrap");
    if (qr.dataset.url !== info.tunnelUrl) {
      renderQRCode(qr, info.tunnelUrl, 10, 4);
      qr.dataset.url = info.tunnelUrl;
    }
  } else if (info.tunnelStatus === "error" || info.tunnelStatus === "disabled") {
    loading.classList.add("hidden");
    ready.classList.add("hidden");
    error.classList.remove("hidden");
    document.getElementById("tunnelErrorMsg").textContent =
      info.tunnelMessage || "";
  } else {
    // starting / downloading
    ready.classList.add("hidden");
    error.classList.add("hidden");
    loading.classList.remove("hidden");
    const msgMap = {
      downloading: "cloudflared.exe 다운로드 중... (최초 1회, 약 40MB)",
      starting: "공개 주소 생성 중... (보통 5~20초)",
    };
    statusText.textContent = msgMap[info.tunnelStatus] || (info.tunnelMessage || "준비 중...");
  }
}

async function fetchInfo() {
  try {
    const res = await fetch("/api/info");
    const info = await res.json();
    applyInfo(info);
    // 아직 준비 중이면 폴링 지속
    if (info.tunnelStatus === "starting" || info.tunnelStatus === "downloading") {
      pollTimer = setTimeout(fetchInfo, 2000);
    } else {
      pollTimer = null;
    }
  } catch (e) {
    pollTimer = setTimeout(fetchInfo, 3000);
  }
}

function openConnectModal() {
  modal.classList.remove("hidden");
  // 탭 초기 상태
  selectConnTab("tunnel");
  fetchInfo();
}

function closeConnectModal() {
  modal.classList.add("hidden");
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

function selectConnTab(which) {
  document.querySelectorAll("#connTabs button").forEach(b => {
    b.classList.toggle("active", b.dataset.ctab === which);
  });
  document.getElementById("cpanel-tunnel").classList.toggle("hidden", which !== "tunnel");
  document.getElementById("cpanel-local").classList.toggle("hidden", which !== "local");
}

document.querySelectorAll("#connTabs button").forEach(b => {
  b.addEventListener("click", () => selectConnTab(b.dataset.ctab));
});

showBtn?.addEventListener("click", openConnectModal);
closeBtn?.addEventListener("click", closeConnectModal);
modal?.addEventListener("click", (e) => { if (e.target === modal) closeConnectModal(); });

const dot = document.getElementById("connectionStatus");
onConnection((online) => {
  if (online) {
    dot.textContent = "실시간 연결됨";
    dot.classList.remove("conn-off"); dot.classList.add("conn-on");
  } else {
    dot.textContent = "연결 대기 중…";
    dot.classList.remove("conn-on"); dot.classList.add("conn-off");
  }
});

const schoolEl = document.getElementById("homeSchool");
onState((s) => {
  schoolEl.textContent = s.school
    ? s.school
    : "학교명 미등록 — 본부에서 설정하세요";
});
