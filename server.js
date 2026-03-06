const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

/* ---------------- ADMIN LOGIN ---------------- */

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "richiee_goat";

function requireAdminAuth(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Richiee Admin"');
    return res.status(401).send("Authentication required.");
  }

  const base64 = auth.split(" ")[1];
  const decoded = Buffer.from(base64, "base64").toString("utf8");
  const [username, password] = decoded.split(":");

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return next();
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="Richiee Admin"');
  return res.status(401).send("Invalid credentials.");
}

/* ---------------- USERS ---------------- */

let waitingUsers = [];
let partners = {};
let countries = {};
let matchPreferences = {};

/* ---------------- SUPPORT / REPORT / MAINTENANCE ---------------- */

let supportTickets = [];
let abuseReports = [];
let maintenanceNotice = "";

/* ---------------- HELPERS ---------------- */

function removeFromQueue(socketId) {
  waitingUsers = waitingUsers.filter((id) => id !== socketId);
}

function safeEmit(to, event, payload) {
  io.to(to).emit(event, payload);
}

function broadcastOnlineCount() {
  const count = io.of("/").sockets.size;
  io.emit("online-count", { count });
}

function getWaitingCount() {
  return waitingUsers.length;
}

function getConnectedCountriesCount() {
  const uniqueCountries = new Set(
    Object.values(countries).filter(
      (country) => country && country !== "??" && country !== "--"
    )
  );
  return uniqueCountries.size;
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

/* ---------------- ADMIN ROUTES ---------------- */

app.get("/admin", requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/api/admin/summary", requireAdminAuth, (req, res) => {
  res.json({
    onlineUsers: io.of("/").sockets.size,
    waitingUsers: getWaitingCount(),
    countriesConnected: getConnectedCountriesCount(),
    maintenanceNotice,
    tickets: supportTickets,
    reports: abuseReports
  });
});

app.post("/api/admin/maintenance", requireAdminAuth, (req, res) => {
  const message = String(req.body?.message || "").slice(0, 1000);
  maintenanceNotice = message;

  io.emit("maintenance", { message: maintenanceNotice });

  res.json({
    ok: true,
    maintenanceNotice
  });
});

app.post("/api/admin/clear-tickets", requireAdminAuth, (req, res) => {
  supportTickets = [];
  res.json({ ok: true });
});

app.post("/api/admin/clear-reports", requireAdminAuth, (req, res) => {
  abuseReports = [];
  res.json({ ok: true });
});

/* ---------------- MATCH USERS ---------------- */

function matchUsers(socket) {
  removeFromQueue(socket.id);

  if (waitingUsers.length === 0) {
    waitingUsers.push(socket.id);

    const pref = matchPreferences[socket.id] || "ANY";
    socket.emit("status", {
      message:
        pref === "ANY"
          ? "Waiting for new partner..."
          : `Waiting for new partner from ${pref}...`
    });

    return;
  }

  let partnerId = null;

  for (let i = 0; i < waitingUsers.length; i++) {
    const candidate = waitingUsers[i];

    if (
      candidate !== socket.id &&
      io.sockets.sockets.get(candidate) &&
      canMatch(socket.id, candidate)
    ) {
      partnerId = candidate;
      waitingUsers.splice(i, 1);
      break;
    }
  }

  if (!partnerId) {
    waitingUsers.push(socket.id);

    const pref = matchPreferences[socket.id] || "ANY";
    socket.emit("status", {
      message:
        pref === "ANY"
          ? "Waiting for new partner..."
          : `Waiting for new partner from ${pref}...`
    });

    return;
  }

  partners[socket.id] = partnerId;
  partners[partnerId] = socket.id;

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
}

/* ---------------- SOCKET CONNECTION ---------------- */

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  matchPreferences[socket.id] = "ANY";
  broadcastOnlineCount();

  socket.emit("status", {
    message: "Connected. Press Start."
  });

  socket.emit("online-count", {
    count: io.of("/").sockets.size
  });

  socket.on("client-geo", ({ country }) => {
    countries[socket.id] = country || "??";

    socket.emit("you-geo", {
      you: countries[socket.id]
    });
  });

  socket.on("set-country-filter", ({ country }) => {
    matchPreferences[socket.id] = country || "ANY";

    if (waitingUsers.includes(socket.id)) {
      removeFromQueue(socket.id);
      waitingUsers.push(socket.id);

      socket.emit("status", {
        message:
          matchPreferences[socket.id] === "ANY"
            ? "Waiting for new partner..."
            : `Waiting for new partner from ${matchPreferences[socket.id]}...`
      });
    }
  });

  socket.on("start", () => {
    if (partners[socket.id]) return;
    matchUsers(socket);
  });

  socket.on("next", () => {
    const partner = partners[socket.id];

    if (partner) {
      safeEmit(partner, "partner-left");
      delete partners[partner];
      delete partners[socket.id];
    }

    matchUsers(socket);
  });

  socket.on("stop", () => {
    const partner = partners[socket.id];

    if (partner) {
      safeEmit(partner, "partner-left");
      delete partners[partner];
      delete partners[socket.id];
    } else {
      removeFromQueue(socket.id);
    }

    socket.emit("stopped");
  });

  socket.on("signal", ({ type, data }) => {
    const partner = partners[socket.id];
    if (!partner) return;

    safeEmit(partner, "signal", { type, data });
  });

  socket.on("chat", ({ text }) => {
    const partner = partners[socket.id];
    if (!partner) return;

    safeEmit(partner, "chat", {
      from: "partner",
      text
    });

    socket.emit("chat", {
      from: "you",
      text
    });
  });

  socket.on("support-ticket", (ticket) => {
    const cleanTicket = {
      id: `ticket_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      time: ticket?.time || new Date().toLocaleString(),
      category: ticket?.category || "General",
      message: String(ticket?.message || "").slice(0, 1000),
      fromCountry: ticket?.fromCountry || "??"
    };

    supportTickets.unshift(cleanTicket);
    console.log("Support ticket received:", cleanTicket);
  });

  socket.on("abuse-report", (report) => {
    const cleanReport = {
      id: `report_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      time: report?.time || new Date().toLocaleString(),
      reason: report?.reason || "Other",
      details: String(report?.details || "").slice(0, 1000),
      fromCountry: report?.fromCountry || "??",
      partnerCountry: report?.partnerCountry || "??"
    };

    abuseReports.unshift(cleanReport);
    console.log("Abuse report received:", cleanReport);
  });

  socket.on("maintenance", ({ message }) => {
    maintenanceNotice = String(message || "").slice(0, 1000);

    io.emit("maintenance", {
      message: maintenanceNotice
    });

    console.log("Maintenance updated:", maintenanceNotice);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    const partner = partners[socket.id];

    if (partner) {
      safeEmit(partner, "partner-left");
      delete partners[partner];
    }

    delete partners[socket.id];
    delete countries[socket.id];
    delete matchPreferences[socket.id];

    removeFromQueue(socket.id);
    broadcastOnlineCount();
  });
});

/* ---------------- START SERVER ---------------- */

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});