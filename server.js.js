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

const chatBtn = document.getElementById("chatBtn");
const supportBtn = document.getElementById("supportBtn");
const abuseBtn = document.getElementById("abuseBtn");
const contributeBtn = document.getElementById("contributeBtn");

const modalBackdrop = document.getElementById("modalBackdrop");
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalClose = document.getElementById("modalClose");

/* ---------- State ---------- */
let localStream = null;
let pc = null;
let matched = false;
let myRole = null;
let myCountryCode = "??";
let partnerCountryCode = "??";

let liveTickets = [];
let liveReports = [];

const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

/* ---------- Helpers ---------- */
function setStatus(msg) {
  statusEl.textContent = msg;
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

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

/* ---------- Modal ---------- */
function openModal(title, html) {
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modalBackdrop.classList.remove("hidden");
  modal.classList.remove("hidden");
}

function closeModal() {
  modalBackdrop.classList.add("hidden");
  modal.classList.add("hidden");
  modalBody.innerHTML = "";
}

modalBackdrop.addEventListener("click", closeModal);
modalClose.addEventListener("click", closeModal);

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
    setStatus("Camera/mic blocked. Allow permission then refresh.");
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

/* ---------- Country ---------- */
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
  stopBtn.disabled = false;
  nextBtn.disabled = true;

  try {
    await ensureMedia();
    socket.emit("start");
    setStatus("Finding a New Partner…");
  } catch {
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
});

nextBtn.addEventListener("click", () => {
  cleanupPeer();
  socket.emit("next");
  nextBtn.disabled = true;
  stopBtn.disabled = false;
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

/* ---------- Popups ---------- */
chatBtn.addEventListener("click", () => {
  const tpl = document.getElementById("chatTemplate").innerHTML;
  openModal("Chat", tpl);

  const chatBoxPopup = document.getElementById("chatBoxPopup");
  const chatFormPopup = document.getElementById("chatFormPopup");
  const chatInputPopup = document.getElementById("chatInputPopup");

  chatBoxPopup.innerHTML = chatBox.innerHTML;

  chatFormPopup.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = (chatInputPopup.value || "").trim();
    if (!text) return;
    socket.emit("chat", { text });
    chatInputPopup.value = "";
  });
});

supportBtn.addEventListener("click", () => {
  const tpl = document.getElementById("supportTemplate").innerHTML;
  openModal("Support", tpl);

  const form = document.getElementById("supportFormPopup");
  const category = document.getElementById("supportCategoryPopup");
  const message = document.getElementById("supportMessagePopup");
  const status = document.getElementById("supportStatusPopup");

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const ticket = {
      time: new Date().toLocaleString(),
      category: category.value,
      message: (message.value || "").trim(),
      fromCountry: myCountryCode
    };

    if (!ticket.message) {
      status.textContent = "Type a message first.";
      return;
    }

    saveLocalList("rl_tickets", ticket);
    socket.emit("support-ticket", ticket);
    message.value = "";
    status.textContent = "Sent ✅";
  });
});

abuseBtn.addEventListener("click", () => {
  const tpl = document.getElementById("abuseTemplate").innerHTML;
  openModal("Report issue", tpl);

  const form = document.getElementById("abuseFormPopup");
  const reason = document.getElementById("abuseReasonPopup");
  const details = document.getElementById("abuseDetailsPopup");
  const status = document.getElementById("abuseStatusPopup");

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const report = {
      time: new Date().toLocaleString(),
      reason: reason.value,
      details: (details.value || "").trim(),
      fromCountry: myCountryCode,
      partnerCountry: partnerCountryCode
    };

    saveLocalList("rl_reports", report);
    socket.emit("abuse-report", report);
    details.value = "";
    status.textContent = "Report submitted ✅";
  });
});

contributeBtn.addEventListener("click", () => {
  const tpl = document.getElementById("contributeTemplate").innerHTML;
  openModal("Contribute", tpl);

  const till = document.getElementById("mpesaTillPopup");
  const copyBtn = document.getElementById("copyTillBtnPopup");
  const usd = document.getElementById("usdLinkPopup");
  const openBtn = document.getElementById("openUsdBtnPopup");

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(till.textContent.trim());
      copyBtn.textContent = "Copied ✅";
      setTimeout(() => (copyBtn.textContent = "Copy Till"), 1200);
    } catch {
      alert("Copy failed. Till: " + till.textContent.trim());
    }
  });

  openBtn.addEventListener("click", () => {
    const link = (usd.value || "").trim();
    if (!link) return alert("Paste your USD link first.");
    window.open(link, "_blank", "noopener,noreferrer");
  });
});

/* ---------- Socket ---------- */
socket.on("status", ({ message }) => {
  setStatus(message || "");
});

socket.on("you-geo", ({ you }) => {
  myCountryCode = (you || "??").toUpperCase();
  setCountryUI();
});

socket.on("geo", ({ you, stranger, partner }) => {
  myCountryCode = (you || "??").toUpperCase();
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
  const box = modalBody.querySelector("#chatBoxPopup");
  const line = document.createElement("div");
  line.className = "chatLine " + (from === "you" ? "me" : "them");
  line.textContent = (from === "you" ? "You: " : "New Partner: ") + text;

  chatBox.appendChild(line);
  chatBox.scrollTop = chatBox.scrollHeight;

  if (box) {
    box.appendChild(line.cloneNode(true));
    box.scrollTop = box.scrollHeight;
  }
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
  setStatus("Maintenance: " + message);
});

/* ---------- Boot ---------- */
(function boot() {
  setCountryUI();
  populateCountries();
  detectCountry();

  nextBtn.disabled = true;
  stopBtn.disabled = true;
})();