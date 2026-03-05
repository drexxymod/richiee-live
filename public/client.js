const socket = io();

const statusEl = document.getElementById("status");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

const youCountryEl = document.getElementById("youCountry");
const strangerCountryEl = document.getElementById("strangerCountry");

const youFlag = document.getElementById("youFlag");
const strangerFlag = document.getElementById("strangerFlag");

const countrySelect = document.getElementById("countrySelect");

const startBtn = document.getElementById("startBtn");
const nextBtn = document.getElementById("nextBtn");
const stopBtn = document.getElementById("stopBtn");
const camBtn = document.getElementById("camBtn");
const micBtn = document.getElementById("micBtn");

const chatBox = document.getElementById("chatBox");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

let localStream = null;
let pc = null;

let camEnabled = true;
let micEnabled = true;

const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

const COUNTRIES = [
  ["AF","Afghanistan"],["AL","Albania"],["DZ","Algeria"],["AS","American Samoa"],["AD","Andorra"],
  ["AO","Angola"],["AI","Anguilla"],["AG","Antigua and Barbuda"],["AR","Argentina"],["AM","Armenia"],
  ["AU","Australia"],["AT","Austria"],["AZ","Azerbaijan"],["BH","Bahrain"],["BD","Bangladesh"],
  ["BB","Barbados"],["BY","Belarus"],["BE","Belgium"],["BZ","Belize"],["BJ","Benin"],["BT","Bhutan"],
  ["BO","Bolivia"],["BA","Bosnia and Herzegovina"],["BW","Botswana"],["BR","Brazil"],["BN","Brunei"],
  ["BG","Bulgaria"],["BF","Burkina Faso"],["BI","Burundi"],["KH","Cambodia"],["CM","Cameroon"],["CA","Canada"],
  ["CV","Cape Verde"],["TD","Chad"],["CL","Chile"],["CN","China"],["CO","Colombia"],["KM","Comoros"],
  ["CG","Congo"],["CD","Congo (DRC)"],["CR","Costa Rica"],["CI","Côte d’Ivoire"],["HR","Croatia"],["CU","Cuba"],
  ["CY","Cyprus"],["CZ","Czechia"],["DK","Denmark"],["DJ","Djibouti"],["DO","Dominican Republic"],["EC","Ecuador"],
  ["EG","Egypt"],["SV","El Salvador"],["GQ","Equatorial Guinea"],["ER","Eritrea"],["EE","Estonia"],["ET","Ethiopia"],
  ["FJ","Fiji"],["FI","Finland"],["FR","France"],["GA","Gabon"],["GM","Gambia"],["GE","Georgia"],["DE","Germany"],
  ["GH","Ghana"],["GR","Greece"],["GL","Greenland"],["GT","Guatemala"],["GN","Guinea"],["HT","Haiti"],
  ["HN","Honduras"],["HK","Hong Kong"],["HU","Hungary"],["IS","Iceland"],["IN","India"],["ID","Indonesia"],
  ["IR","Iran"],["IQ","Iraq"],["IE","Ireland"],["IL","Israel"],["IT","Italy"],["JM","Jamaica"],["JP","Japan"],
  ["JO","Jordan"],["KZ","Kazakhstan"],["KE","Kenya"],["KR","South Korea"],["KW","Kuwait"],["KG","Kyrgyzstan"],
  ["LA","Laos"],["LV","Latvia"],["LB","Lebanon"],["LS","Lesotho"],["LR","Liberia"],["LY","Libya"],["LT","Lithuania"],
  ["LU","Luxembourg"],["MG","Madagascar"],["MW","Malawi"],["MY","Malaysia"],["MV","Maldives"],["ML","Mali"],
  ["MT","Malta"],["MU","Mauritius"],["MX","Mexico"],["MD","Moldova"],["MC","Monaco"],["MN","Mongolia"],["MA","Morocco"],
  ["MZ","Mozambique"],["MM","Myanmar"],["NA","Namibia"],["NP","Nepal"],["NL","Netherlands"],["NZ","New Zealand"],
  ["NE","Niger"],["NG","Nigeria"],["NO","Norway"],["OM","Oman"],["PK","Pakistan"],["PS","Palestine"],["PA","Panama"],
  ["PG","Papua New Guinea"],["PE","Peru"],["PH","Philippines"],["PL","Poland"],["PT","Portugal"],["QA","Qatar"],
  ["RO","Romania"],["RU","Russia"],["RW","Rwanda"],["SA","Saudi Arabia"],["SN","Senegal"],["RS","Serbia"],
  ["SC","Seychelles"],["SL","Sierra Leone"],["SG","Singapore"],["SK","Slovakia"],["SI","Slovenia"],["SO","Somalia"],
  ["ZA","South Africa"],["SS","South Sudan"],["ES","Spain"],["LK","Sri Lanka"],["SD","Sudan"],["SE","Sweden"],
  ["CH","Switzerland"],["SY","Syria"],["TW","Taiwan"],["TJ","Tajikistan"],["TZ","Tanzania"],["TH","Thailand"],
  ["TG","Togo"],["TN","Tunisia"],["TR","Turkey"],["UG","Uganda"],["UA","Ukraine"],["AE","United Arab Emirates"],
  ["GB","United Kingdom"],["US","United States"],["UY","Uruguay"],["UZ","Uzbekistan"],["VE","Venezuela"],["VN","Vietnam"],
  ["YE","Yemen"],["ZM","Zambia"],["ZW","Zimbabwe"]
];

function setStatus(msg) { statusEl.textContent = msg; }

function countryName(code) {
  const c = (code || "??").toUpperCase();
  return COUNTRIES.find(x => x[0] === c)?.[1] || c;
}

function setFlagImg(imgEl, code) {
  const c = (code || "??").toLowerCase();
  if (!c || c === "??") {
    imgEl.removeAttribute("src");
    imgEl.style.display = "none";
    return;
  }
  imgEl.style.display = "inline-block";
  imgEl.src = `https://flagcdn.com/24x18/${c}.png`;
}

function populateCountrySelect() {
  while (countrySelect.options.length > 1) countrySelect.remove(1);
  const sorted = [...COUNTRIES].sort((a, b) => a[1].localeCompare(b[1]));
  for (const [code, name] of sorted) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `${code} — ${name}`;
    countrySelect.appendChild(opt);
  }
}

function addChat(kind, text) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.textContent = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function clearChat() { chatBox.innerHTML = ""; }

async function ensureMedia() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  localStream.getVideoTracks().forEach(t => (t.enabled = camEnabled));
  localStream.getAudioTracks().forEach(t => (t.enabled = micEnabled));
  camBtn.disabled = false;
  micBtn.disabled = false;
  return localStream;
}

function resetPeer() {
  if (pc) {
    try { pc.onicecandidate = null; pc.ontrack = null; pc.close(); } catch {}
    pc = null;
  }
  remoteVideo.srcObject = null;
}

async function createPeer() {
  resetPeer();
  pc = new RTCPeerConnection(RTC_CONFIG);

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit("signal", { type: "ice", data: e.candidate });
  };

  pc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
  };

  const stream = await ensureMedia();
  stream.getTracks().forEach(t => pc.addTrack(t, stream));
  return pc;
}

function setButtons(state) {
  const searching = state === "searching";
  startBtn.disabled = searching;
  nextBtn.disabled = !searching;
  stopBtn.disabled = !searching;
}

function sendPref() {
  socket.emit("set-pref", { pref: countrySelect.value });
}

countrySelect.addEventListener("change", () => {
  sendPref();
  setStatus(`Match: ${countrySelect.value}`);
});

startBtn.addEventListener("click", async () => {
  try {
    sendPref();
    setStatus("Requesting camera/mic…");
    await ensureMedia();
    clearChat();
    setButtons("searching");
    setStatus("Searching…");
    socket.emit("start");
  } catch (err) {
    console.error(err);
    setStatus("Camera/mic blocked. Allow permission then refresh.");
  }
});

nextBtn.addEventListener("click", () => {
  clearChat();
  setStatus("Finding next…");
  resetPeer();
  socket.emit("next");
});

stopBtn.addEventListener("click", async () => {
  socket.emit("stop");
  resetPeer();
  try { await ensureMedia(); } catch {}
  setButtons("idle");
  setStatus("Stopped. Click Start to search again.");
});

camBtn.addEventListener("click", async () => {
  await ensureMedia();
  camEnabled = !camEnabled;
  localStream.getVideoTracks().forEach(t => (t.enabled = camEnabled));
  camBtn.textContent = camEnabled ? "Camera Off" : "Camera On";
});

micBtn.addEventListener("click", async () => {
  await ensureMedia();
  micEnabled = !micEnabled;
  localStream.getAudioTracks().forEach(t => (t.enabled = micEnabled));
  micBtn.textContent = micEnabled ? "Mute" : "Unmute";
});

/* ✅ FIXED CHAT:
   - Show your message instantly in chatBox
   - Send to server so stranger gets it
*/
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  addChat("you", `You: ${text}`);      // ✅ show instantly
  socket.emit("chat", { text });      // ✅ send to server
  chatInput.value = "";
  chatInput.focus();
});

socket.on("status", ({ message }) => setStatus(message));

socket.on("you-geo", ({ you }) => {
  const code = (you || "??").toUpperCase();
  youCountryEl.textContent = code === "??" ? "--" : `${code} — ${countryName(code)}`;
  setFlagImg(youFlag, code);
});

socket.on("geo", ({ you, stranger }) => {
  const y = (you || "??").toUpperCase();
  const s = (stranger || "??").toUpperCase();

  youCountryEl.textContent = y === "??" ? "--" : `${y} — ${countryName(y)}`;
  strangerCountryEl.textContent = s === "??" ? "--" : `${s} — ${countryName(s)}`;

  setFlagImg(youFlag, y);
  setFlagImg(strangerFlag, s);
});

// ✅ Stranger messages appear
socket.on("chat", ({ from, text }) => {
  if (from === "stranger") addChat("stranger", `Stranger: ${text}`);
});

socket.on("matched", async ({ role }) => {
  setStatus("Matched! Connecting…");
  await createPeer();

  if (role === "caller") {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", { type: "offer", data: offer });
  }
});

socket.on("partner-left", async () => {
  resetPeer();
  setStatus("Stranger left. Click Next or Start.");
  try { await ensureMedia(); } catch {}
});

socket.on("stopped", async () => {
  resetPeer();
  try { await ensureMedia(); } catch {}
});

socket.on("signal", async ({ type, data }) => {
  try {
    if (!pc) await createPeer();

    if (type === "offer") {
      await pc.setRemoteDescription(data);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { type: "answer", data: answer });
      setStatus("Connected ✅");
      return;
    }

    if (type === "answer") {
      await pc.setRemoteDescription(data);
      setStatus("Connected ✅");
      return;
    }

    if (type === "ice") {
      await pc.addIceCandidate(data);
    }
  } catch (err) {
    console.error(err);
    setStatus("Connection error. Click Next.");
    resetPeer();
  }
});

// ✅ Browser-based country detection so localhost works
async function detectMyCountryAndSend() {
  try {
    const res = await fetch("https://ipinfo.io/json");
    const data = await res.json();
    if (data && data.country && String(data.country).length === 2) {
      const code = String(data.country).toUpperCase();
      youCountryEl.textContent = `${code} — ${countryName(code)}`;
      setFlagImg(youFlag, code);
      socket.emit("client-geo", { country: code });
    }
  } catch {}
}

populateCountrySelect();
sendPref();
setButtons("idle");
camBtn.disabled = true;
micBtn.disabled = true;

youFlag.style.display = "none";
strangerFlag.style.display = "none";

detectMyCountryAndSend();