const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "richiee_goat";
const ADMIN_SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET || "change_this_secret_in_railway";

const ALLOWED_ORIGINS = [
  "https://www.richieelive.space",
  "https://richieelive.space",
  "https://richiee-live-production.up.railway.app",
  "http://localhost:3000"
];

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"]
  },
  pingTimeout: 30000,
  pingInterval: 25000
});

app.use(express.json({ limit: "200kb" }));
app.use(express.static("public"));

/* ---------------- MEMORY STATE ---------------- */

let waitingUsers = [];
let partners = {};
let countries = {};
let matchPreferences = {};
let supportTickets = [];
let abuseReports = [];
let maintenanceNotice = "";

const socketMeta = {};
const rateLimitMap = new Map();

/* ---------------- SESSION HELPERS ---------------- */

function createSessionToken() {
  const raw = `${ADMIN_USERNAME}:${Date.now()}:${ADMIN_SESSION_SECRET}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((cookie) => cookie.trim().split("="))
      .filter((parts) => parts.length === 2)
  );
}

let activeAdminToken = null;

function requireAdminSession(req, res, next) {
  const cookies = parseCookies(req);

  if (cookies.richiee_admin_session && cookies.richiee_admin_session === activeAdminToken) {
    return next();
  }

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({
      ok: false,
      message: "Unauthorized"
    });
  }

  return res.redirect("/admin/login");
}

/* ---------------- HELPERS ---------------- */

function nowISO() {
  return new Date().toISOString();
}

function removeFromQueue(socketId) {
  waitingUsers = waitingUsers.filter((id) => id !== socketId);
}

function safeEmit(to, event, payload) {
  const target = io.sockets.sockets.get(to);
  if (target) {
    io.to(to).emit(event, payload);
  }
}

function broadcastOnlineCount() {
  io.emit("online-count", {
    count: io.of("/").sockets.size,
    waiting: waitingUsers.length,
    activePairs: Math.floor(Object.keys(partners).length / 2)
  });
}

function getConnectedCountriesCount() {
  return new Set(
    Object.values(countries).filter(
      (country) => country && country !== "??" && country !== "--"
    )
  ).size;
}

function canMatch(socketIdA, socketIdB) {
  const prefA = matchPreferences[socketIdA] || "ANY";
  const prefB = matchPreferences[socketIdB] || "ANY";

  const actualA = countries[socketIdA] || "??";
  const actualB = countries[socketIdB] || "??";

  const aAcceptsB = prefA === "ANY" || actualB === prefA;
  const bAcceptsA = prefB === "ANY" || actualA === prefB;

  return aAcceptsB && bAcceptsA;
}

function isRateLimited(socketId, action, limitMs) {
  const key = `${socketId}:${action}`;
  const last = rateLimitMap.get(key) || 0;
  const current = Date.now();

  if (current - last < limitMs) {
    return true;
  }

  rateLimitMap.set(key, current);
  return false;
}

function cleanupSocket(socketId) {
  const partner = partners[socketId];

  if (partner) {
    safeEmit(partner, "partner-left");
    delete partners[partner];
  }

  delete partners[socketId];
  delete countries[socketId];
  delete matchPreferences[socketId];
  delete socketMeta[socketId];

  removeFromQueue(socketId);

  for (const key of rateLimitMap.keys()) {
    if (key.startsWith(`${socketId}:`)) {
      rateLimitMap.delete(key);
    }
  }
}

/* ---------------- ROUTES ---------------- */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "richiee-live",
    uptime: process.uptime(),
    time: nowISO()
  });
});

app.get("/admin/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-login.html"));
});

app.post("/api/admin/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      ok: false,
      message: "Invalid username or password"
    });
  }

  activeAdminToken = createSessionToken();

  res.setHeader(
    "Set-Cookie",
    `richiee_admin_session=${activeAdminToken}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`
  );

  return res.json({
    ok: true,
    message: "Logged in"
  });
});

app.post("/api/admin/logout", (req, res) => {
  activeAdminToken = null;

  res.setHeader(
    "Set-Cookie",
    "richiee_admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax"
  );

  res.json({ ok: true });
});

app.get("/admin", requireAdminSession, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/api/admin/summary", requireAdminSession, (req, res) => {
  res.json({
    onlineUsers: io.of("/").sockets.size,
    waitingUsers: waitingUsers.length,
    activePairs: Math.floor(Object.keys(partners).length / 2),
    countriesConnected: getConnectedCountriesCount(),
    maintenanceNotice,
    tickets: supportTickets,
    reports: abuseReports,
    users: Object.values(socketMeta)
  });
});

app.post("/api/admin/maintenance", requireAdminSession, (req, res) => {
  maintenanceNotice = String(req.body?.message || "").slice(0, 1000);

  io.emit("maintenance", {
    message: maintenanceNotice
  });

  res.json({
    ok: true,
    maintenanceNotice
  });
});

app.post("/api/admin/clear-tickets", requireAdminSession, (req, res) => {
  supportTickets = [];
  res.json({ ok: true });
});

app.post("/api/admin/clear-reports", requireAdminSession, (req, res) => {
  abuseReports = [];
  res.json({ ok: true });
});

/* ---------------- MATCHING ---------------- */

function matchUsers(socket) {
  removeFromQueue(socket.id);

  if (partners[socket.id]) return;

  let partnerId = null;

  for (let i = 0; i < waitingUsers.length; i++) {
    const candidate = waitingUsers[i];

    if (
      candidate !== socket.id &&
      io.sockets.sockets.get(candidate) &&
      !partners[candidate] &&
      canMatch(socket.id, candidate)
    ) {
      partnerId = candidate;
      waitingUsers.splice(i, 1);
      break;
    }
  }

  if (!partnerId) {
    if (!waitingUsers.includes(socket.id)) {
      waitingUsers.push(socket.id);
    }

    const pref = matchPreferences[socket.id] || "ANY";

    socket.emit("status", {
      message:
        pref === "ANY"
          ? "Waiting for new partner..."
          : `Waiting for new partner from ${pref}...`
    });

    broadcastOnlineCount();
    return;
  }

  partners[socket.id] = partnerId;
  partners[partnerId] = socket.id;

  if (socketMeta[socket.id]) socketMeta[socket.id].status = "IN_CALL";
  if (socketMeta[partnerId]) socketMeta[partnerId].status = "IN_CALL";

  socket.emit("matched", { role: "caller" });
  safeEmit(partnerId, "matched", { role: "callee" });

  const countryA = countries[socket.id] || "??";
  const countryB = countries[partnerId] || "??";

  socket.emit("geo", {
    you: countryA,
    stranger: countryB
  });

  safeEmit(partnerId, "geo", {
    you: countryB,
    stranger: countryA
  });

  if (maintenanceNotice) {
    socket.emit("maintenance", { message: maintenanceNotice });
    safeEmit(partnerId, "maintenance", { message: maintenanceNotice });
  }

  broadcastOnlineCount();
}

/* ---------------- SOCKETS ---------------- */

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  matchPreferences[socket.id] = "ANY";

  socketMeta[socket.id] = {
    id: socket.id,
    connectedAt: nowISO(),
    country: "??",
    preference: "ANY",
    status: "CONNECTED"
  };

  broadcastOnlineCount();

  socket.emit("status", {
    message: "Connected. Press Start."
  });

  socket.emit("online-count", {
    count: io.of("/").sockets.size,
    waiting: waitingUsers.length,
    activePairs: Math.floor(Object.keys(partners).length / 2)
  });

  if (maintenanceNotice) {
    socket.emit("maintenance", {
      message: maintenanceNotice
    });
  }

  socket.on("client-geo", ({ country }) => {
    const cleanCountry = String(country || "??").slice(0, 80);

    countries[socket.id] = cleanCountry;

    if (socketMeta[socket.id]) {
      socketMeta[socket.id].country = cleanCountry;
    }

    socket.emit("you-geo", {
      you: cleanCountry
    });
  });

  socket.on("set-country-filter", ({ country }) => {
    const cleanCountry = String(country || "ANY").slice(0, 80);

    matchPreferences[socket.id] = cleanCountry;

    if (socketMeta[socket.id]) {
      socketMeta[socket.id].preference = cleanCountry;
    }

    if (waitingUsers.includes(socket.id)) {
      removeFromQueue(socket.id);
      waitingUsers.push(socket.id);

      socket.emit("status", {
        message:
          cleanCountry === "ANY"
            ? "Waiting for new partner..."
            : `Waiting for new partner from ${cleanCountry}...`
      });
    }
  });

  socket.on("start", () => {
    if (isRateLimited(socket.id, "start", 800)) return;
    if (partners[socket.id]) return;

    if (socketMeta[socket.id]) {
      socketMeta[socket.id].status = "WAITING";
    }

    matchUsers(socket);
  });

  socket.on("next", () => {
    if (isRateLimited(socket.id, "next", 1000)) return;

    const partner = partners[socket.id];

    if (partner) {
      safeEmit(partner, "partner-left");

      delete partners[partner];
      delete partners[socket.id];

      if (socketMeta[partner]) socketMeta[partner].status = "CONNECTED";
      if (socketMeta[socket.id]) socketMeta[socket.id].status = "WAITING";
    }

    matchUsers(socket);
  });

  socket.on("stop", () => {
    const partner = partners[socket.id];

    if (partner) {
      safeEmit(partner, "partner-left");

      delete partners[partner];
      delete partners[socket.id];

      if (socketMeta[partner]) socketMeta[partner].status = "CONNECTED";
    } else {
      removeFromQueue(socket.id);
    }

    if (socketMeta[socket.id]) {
      socketMeta[socket.id].status = "STOPPED";
    }

    socket.emit("stopped");
    broadcastOnlineCount();
  });

  socket.on("signal", ({ type, data }) => {
    const partner = partners[socket.id];
    if (!partner) return;

    safeEmit(partner, "signal", { type, data });
  });

  socket.on("chat", ({ text }) => {
    if (isRateLimited(socket.id, "chat", 300)) return;

    const partner = partners[socket.id];
    if (!partner) return;

    const cleanText = String(text || "").slice(0, 500).trim();
    if (!cleanText) return;

    safeEmit(partner, "chat", {
      from: "partner",
      text: cleanText
    });

    socket.emit("chat", {
      from: "you",
      text: cleanText
    });
  });

  socket.on("support-ticket", (ticket) => {
    if (isRateLimited(socket.id, "support-ticket", 5000)) return;

    const cleanTicket = {
      id: `ticket_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      socketId: socket.id,
      time: ticket?.time || nowISO(),
      category: String(ticket?.category || "General").slice(0, 80),
      message: String(ticket?.message || "").slice(0, 1000),
      fromCountry: String(ticket?.fromCountry || countries[socket.id] || "??").slice(0, 80)
    };

    supportTickets.unshift(cleanTicket);
    supportTickets = supportTickets.slice(0, 100);

    console.log("Support ticket received:", cleanTicket);
  });

  socket.on("abuse-report", (report) => {
    if (isRateLimited(socket.id, "abuse-report", 5000)) return;

    const partner = partners[socket.id];

    const cleanReport = {
      id: `report_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      reporterSocketId: socket.id,
      reportedSocketId: partner || null,
      time: report?.time || nowISO(),
      reason: String(report?.reason || "Other").slice(0, 100),
      details: String(report?.details || "").slice(0, 1000),
      fromCountry: String(report?.fromCountry || countries[socket.id] || "??").slice(0, 80),
      partnerCountry: String(
        report?.partnerCountry || (partner ? countries[partner] : "??") || "??"
      ).slice(0, 80)
    };

    abuseReports.unshift(cleanReport);
    abuseReports = abuseReports.slice(0, 100);

    console.log("Abuse report received:", cleanReport);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    cleanupSocket(socket.id);
    broadcastOnlineCount();
  });
});

/* ---------------- START ---------------- */

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});