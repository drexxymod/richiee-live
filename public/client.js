/* Richiee Live - client.js
   - New Partner label
   - Support + Abuse + Contribute
   - Admin mode (live + local)
*/

const socket = io();

/* ---------- Elements ---------- */
const statusEl = document.getElementById("status");

const youFlag = document.getElementById("youFlag");
const partnerFlag = document.getElementById("partnerFlag");
const youCountryEl = document.getElementById("youCountry");
const partnerCountryEl = document.getElementById("partnerCountry");

const countrySelect = document.getElementById("countrySelect");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

const startBtn = document.getElementById("startBtn");
const nextBtn = document.getElementById("nextBtn");
const stopBtn = document.getElementById("stopBtn");
const camBtn = document.getElementById("camBtn");
const micBtn = document.getElementById("micBtn");

const chatBox = document.getElementById("chatBox");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

/* Tabs */
const tabBtns = document.querySelectorAll(".tabBtn");
const tabPanels = document.querySelectorAll(".tabPanel");
const adminTabBtn = document.querySelector(".tabBtn.adminOnly");

/* Support */
const supportForm = document.getElementById("supportForm");
const supportCategory = document.getElementById("supportCategory");
const supportMessage = document.getElementById("supportMessage");
const supportStatus = document.getElementById("supportStatus");

/* Abuse */
const abuseForm = document.getElementById("abuseForm");
const abuseReason = document.getElementById("abuseReason");
const abuseDetails = document.getElementById("abuseDetails");
const abuseStatus = document.getElementById("abuseStatus");

/* Contribute */
const mpesaTill = document.getElementById("mpesaTill");
const copyTillBtn = document.getElementById("copyTillBtn");
const usdLink = document.getElementById("usdLink");
const openUsdBtn = document.getElementById("openUsdBtn");

/* Admin */
const adminTickets = document.getElementById("adminTickets");
const adminReports = document.getElementById("adminReports");
const clearTicketsBtn = document.getElementById("clearTicketsBtn");
const clearReportsBtn = document.getElementById("clearReportsBtn");
const maintenanceText = document.getElementById("maintenanceText");
const publishMaintenanceBtn = document.getElementById("publishMaintenanceBtn");

/* ---------- State ---------- */
let localStream = null;
let pc = null;
let matched = false;
let myRole = null;
let myCountryCode = "??";
let partnerCountryCode = "??";

/* live admin state from server */
let liveTickets = [];
let liveReports = [];

const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

/* ---------- Helpers ---------- */
function setStatus(msg) {
  statusEl.textContent = msg;
}

function addChatLine(from, text) {
  const line = document.createElement("div");
  line.className = "chatLine " + (from === "you" ? "me" : "them");
  line.textContent = (from === "you" ? "You: " : "New Partner: ") + text;
  chatBox.appendChild(line);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function countryFlagUrl(code) {
  if (!code || code === "??" || code === "--") return "";
  return `https://flagcdn.com/w40/${code.toLowerCase()}.png`;
}

function setCountryUI() {
  youCountryEl.textContent = myCountryCode || "??";
  partnerCountryEl.textContent = partnerCountryCode || "--";

  const yourFlagUrl = countryFlagUrl(myCountryCode);
  const partnerFlagUrl = countryFlagUrl(partnerCountryCode);

  if (yourFlagUrl) {
    youFlag.src = yourFlagUrl;
    youFlag.style.display = "inline-block";
  } else {
    youFlag.removeAttribute("src");
    youFlag.style.display = "none";
  }

  if (partnerFlagUrl) {
    partnerFlag.src = partnerFlagUrl;
    partnerFlag.style.display = "inline-block";
  } else {
    partnerFlag.removeAttribute("src");
    partnerFlag.style.display = "none";
  }
}

function isAdminMode() {
  const url = new URL(window.location.href);
  return url.searchParams.get("admin") === "1" || localStorage.getItem("rl_admin") === "1";
}

function enableAdminUI() {
  if (!adminTabBtn) return;
  adminTabBtn.style.display = "inline-block";
}

function saveLocalList(key, item) {
  const arr = JSON.parse(localStorage.getItem(key) || "[]");
  arr.unshift(item);
  localStorage.setItem(key, JSON.stringify(arr));
  return arr;
}

function loadLocalList(key) {
  return JSON.parse(localStorage.getItem(key) || "[]");
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderAdminLists() {
  const localTickets = loadLocalList("rl_tickets");
  const localReports = loadLocalList("rl_reports");

  const mergedTickets = [...liveTickets];
  for (const t of localTickets) {
    if (!mergedTickets.some(x => x.time === t.time && x.message === t.message)) {
      mergedTickets.push(t);
    }
  }

  const mergedReports = [...liveReports];
  for (const r of localReports) {
    if (!mergedReports.some(x => x.time === r.time && x.details === r.details && x.reason === r.reason)) {
      mergedReports.push(r);
    }
  }

  adminTickets.innerHTML = mergedTickets.length
    ? mergedTickets.map(t => `
      <div class="adminItem">
        <b>${escapeHtml(t.category || "General")}</b> • ${escapeHtml(t.time || "")}
        ${t.fromCountry ? ` • ${escapeHtml(t.fromCountry)}` : ""}
        <br/>${escapeHtml(t.message || "")}
      </div>
    `).join("")
    : `<div class="muted">No tickets yet.</div>`;

  adminReports.innerHTML = mergedReports.length
    ? mergedReports.map(r => `
      <div class="adminItem">
        <b>${escapeHtml(r.reason || "Other")}</b> • ${escapeHtml(r.time || "")}
        ${r.fromCountry ? ` • ${escapeHtml(r.fromCountry)}` : ""}
        ${r.partnerCountry ? ` → ${escapeHtml(r.partnerCountry)}` : ""}
        <br/>${escapeHtml(r.details || "")}
      </div>
    `).join("")
    : `<div class="muted">No reports yet.</div>`;
}

/* ---------- Tabs ---------- */
tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    tabBtns.forEach(b => b.classList.remove("active"));
    tabPanels.forEach(p => p.classList.remove("active"));

    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

/* ---------- Media ---------- */
async function ensureMedia() {
  if (localStream) return localStream;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    localVideo.srcObject = localStream;

    camBtn.disabled = false;
    micBtn.disabled = false;

    setCamEnabled(true);
    setMicEnabled(true);

    return localStream;
  } catch (err) {
    console.error(err);
    setStatus("Camera/mic blocked. Click the lock icon → allow Camera + Microphone → refresh.");
    throw err;
  }
}

function setCamEnabled(on) {
  if (!localStream) return;
  localStream.getVideoTracks().forEach(t => (t.enabled = on));
  camBtn.textContent = on ? "Camera Off" : "Camera On";
}

function setMicEnabled(on) {
  if (!localStream) return;
  localStream.getAudioTracks().forEach(t => (t.enabled = on));
  micBtn.textContent = on ? "Mute" : "Unmute";
}

/* ---------- WebRTC ---------- */
async function createPeerConnection() {
  if (pc) {
    try { pc.close(); } catch {}
    pc = null;
  }

  pc = new RTCPeerConnection(RTC_CONFIG);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", { type: "ice", data: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  const stream = await ensureMedia();
  stream.getTracks().forEach(track => pc.addTrack(track, stream));
}

async function startAsCaller() {
  await createPeerConnection();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { type: "offer", data: offer });
}

async function handleOffer(offer) {
  await createPeerConnection();
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("signal", { type: "answer", data: answer });
}

async function handleAnswer(answer) {
  if (!pc) return;
  await pc.setRemoteDescription(answer);
}

async function handleIce(candidate) {
  if (!pc) return;
  try {
    await pc.addIceCandidate(candidate);
  } catch (e) {
    console.warn("ICE add failed:", e);
  }
}

function cleanupPeer() {
  matched = false;
  myRole = null;
  partnerCountryCode = "--";
  setCountryUI();

  remoteVideo.srcObject = null;

  if (pc) {
    try { pc.close(); } catch {}
    pc = null;
  }
}

/* ---------- Country detect + dropdown ---------- */
async function detectCountry() {
  try {
    const res = await fetch("https://ipapi.co/json/");
    const data = await res.json();
    if (data && data.country_code) {
      myCountryCode = data.country_code.toUpperCase();
      socket.emit("client-geo", { country: myCountryCode });
      setCountryUI();
    }
  } catch {
    // ignore
  }
}

function populateCountries() {
  if (window.COUNTRIES && Array.isArray(window.COUNTRIES)) {
    for (const c of window.COUNTRIES) {
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = c.name;
      countrySelect.appendChild(opt);
    }
  }
}

/* ---------- Buttons ---------- */
startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;

  try {
    await ensureMedia();
    socket.emit("start");
    setStatus("Finding a New Partner…");
  } catch {
    startBtn.disabled = false;
  }
});

nextBtn.addEventListener("click", () => {
  cleanupPeer();
  socket.emit("next");
  setStatus("Finding a New Partner…");
});

stopBtn.addEventListener("click", () => {
  cleanupPeer();
  socket.emit("stop");
  setStatus("Stopped.");
  startBtn.disabled = false;
  nextBtn.disabled = true;
  stopBtn.disabled = true;
});

camBtn.addEventListener("click", () => {
  if (!localStream) return;
  const on = localStream.getVideoTracks().some(t => t.enabled);
  setCamEnabled(!on);
});

micBtn.addEventListener("click", () => {
  if (!localStream) return;
  const on = localStream.getAudioTracks().some(t => t.enabled);
  setMicEnabled(!on);
});

/* ---------- Chat ---------- */
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = (chatInput.value || "").trim();
  if (!text) return;

  socket.emit("chat", { text });
  chatInput.value = "";
});

/* ---------- Support + Abuse + Contribute ---------- */
supportForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const ticket = {
    time: new Date().toLocaleString(),
    category: supportCategory.value,
    message: (supportMessage.value || "").trim(),
    fromCountry: myCountryCode
  };

  if (!ticket.message) {
    supportStatus.textContent = "Type a message first.";
    return;
  }

  saveLocalList("rl_tickets", ticket);
  renderAdminLists();

  socket.emit("support-ticket", ticket);

  supportMessage.value = "";
  supportStatus.textContent = "Sent ✅ (Support will review)";
});

abuseForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const report = {
    time: new Date().toLocaleString(),
    reason: abuseReason.value,
    details: (abuseDetails.value || "").trim(),
    fromCountry: myCountryCode,
    partnerCountry: partnerCountryCode
  };

  saveLocalList("rl_reports", report);
  renderAdminLists();

  socket.emit("abuse-report", report);

  abuseDetails.value = "";
  abuseStatus.textContent = "Report submitted ✅";
});

copyTillBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(mpesaTill.textContent.trim());
    copyTillBtn.textContent = "Copied ✅";
    setTimeout(() => (copyTillBtn.textContent = "Copy Till"), 1200);
  } catch {
    alert("Copy failed. Till: " + mpesaTill.textContent.trim());
  }
});

openUsdBtn.addEventListener("click", () => {
  const link = (usdLink.value || "").trim();
  if (!link) return alert("Paste your USD link first (PayPal/Stripe/etc).");
  window.open(link, "_blank", "noopener,noreferrer");
});

/* ---------- Admin ---------- */
clearTicketsBtn?.addEventListener("click", () => {
  localStorage.removeItem("rl_tickets");
  liveTickets = [];
  renderAdminLists();
});

clearReportsBtn?.addEventListener("click", () => {
  localStorage.removeItem("rl_reports");
  liveReports = [];
  renderAdminLists();
});

publishMaintenanceBtn?.addEventListener("click", () => {
  const msg = (maintenanceText.value || "").trim();
  if (!msg) return alert("Type a maintenance notice first.");

  localStorage.setItem("rl_maintenance", msg);
  socket.emit("maintenance", { message: msg });
  setStatus("Maintenance published ✅");
});

/* ---------- Socket events ---------- */
socket.on("status", ({ message }) => {
  setStatus(message || "");
});

socket.on("you-geo", ({ you }) => {
  myCountryCode = (you || "??").toUpperCase();
  setCountryUI();
});

socket.on("geo", ({ you, stranger, partner }) => {
  myCountryCode = (you || "??").toUpperCase();

  // supports either "stranger" or "partner" from server
  const other = partner || stranger || "--";
  partnerCountryCode = (other || "--").toUpperCase();

  setCountryUI();
});

socket.on("matched", async ({ role }) => {
  matched = true;
  myRole = role;

  nextBtn.disabled = false;
  stopBtn.disabled = false;

  setStatus("Matched ✅ Starting call…");

  if (myRole === "caller") {
    try {
      await startAsCaller();
    } catch (e) {
      console.error(e);
      setStatus("Call failed. Try Next.");
    }
  }
});

socket.on("partner-left", () => {
  cleanupPeer();
  nextBtn.disabled = false;
  stopBtn.disabled = false;
  setStatus("New Partner left. Press Next.");
});

socket.on("stopped", () => {
  cleanupPeer();
  setStatus("Stopped.");
  startBtn.disabled = false;
  nextBtn.disabled = true;
  stopBtn.disabled = true;
});

socket.on("chat", ({ from, text }) => {
  if (from === "you") {
    addChatLine("you", text);
    return;
  }

  if (from === "partner" || from === "stranger") {
    addChatLine("partner", text);
    return;
  }

  addChatLine("partner", text);
});

socket.on("signal", async ({ type, data }) => {
  try {
    if (type === "offer") await handleOffer(data);
    if (type === "answer") await handleAnswer(data);
    if (type === "ice") await handleIce(data);
  } catch (e) {
    console.error("Signal error:", e);
  }
});

socket.on("maintenance", ({ message }) => {
  if (!message) return;
  maintenanceText.value = message;
  setStatus("Maintenance: " + message);
});

/* ---------- Live Admin Updates ---------- */
socket.on("admin-support-update", (tickets) => {
  liveTickets = Array.isArray(tickets) ? tickets : [];
  renderAdminLists();
});

socket.on("admin-report-update", (reports) => {
  liveReports = Array.isArray(reports) ? reports : [];
  renderAdminLists();
});

/* ---------- Boot ---------- */
(function boot() {
  setCountryUI();
  populateCountries();
  detectCountry();

  if (isAdminMode()) {
    enableAdminUI();
    renderAdminLists();
    socket.emit("request-admin-data");
    setStatus("Admin mode enabled ✅");
  }

  const savedMaint = localStorage.getItem("rl_maintenance");
  if (savedMaint && !maintenanceText.value) {
    maintenanceText.value = savedMaint;
  }
})();