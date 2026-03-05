const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

/* ---------------- USERS ---------------- */

let waitingUsers = [];
let partners = {};
let countries = {};

/* ---------------- MATCH USERS ---------------- */

function matchUsers(socket) {

    if (waitingUsers.length === 0) {

        waitingUsers.push(socket.id);

        socket.emit("status", {
            message: "Waiting for stranger..."
        });

        return;
    }

    const partnerId = waitingUsers.shift();

    partners[socket.id] = partnerId;
    partners[partnerId] = socket.id;

    socket.emit("matched", { role: "caller" });
    io.to(partnerId).emit("matched", { role: "callee" });

    const countryA = countries[socket.id] || "??";
    const countryB = countries[partnerId] || "??";

    socket.emit("geo", {
        you: countryA,
        stranger: countryB
    });

    io.to(partnerId).emit("geo", {
        you: countryB,
        stranger: countryA
    });

}

/* ---------------- SOCKET CONNECTION ---------------- */

io.on("connection", (socket) => {

    console.log("User connected:", socket.id);

    socket.emit("status", {
        message: "Connected. Press Start."
    });

    socket.on("client-geo", ({ country }) => {

        countries[socket.id] = country;

        socket.emit("you-geo", {
            you: country
        });

    });

    socket.on("start", () => {

        matchUsers(socket);

    });

    socket.on("next", () => {

        const partner = partners[socket.id];

        if (partner) {

            io.to(partner).emit("partner-left");

            delete partners[partner];
            delete partners[socket.id];

        }

        matchUsers(socket);

    });

    socket.on("stop", () => {

        const partner = partners[socket.id];

        if (partner) {

            io.to(partner).emit("partner-left");

            delete partners[partner];
            delete partners[socket.id];

        }

        socket.emit("stopped");

    });

    socket.on("signal", ({ type, data }) => {

        const partner = partners[socket.id];

        if (!partner) return;

        io.to(partner).emit("signal", { type, data });

    });

    socket.on("chat", ({ text }) => {

        const partner = partners[socket.id];

        if (!partner) return;

        io.to(partner).emit("chat", {
            from: "stranger",
            text
        });

        socket.emit("chat", {
            from: "you",
            text
        });

    });

    socket.on("disconnect", () => {

        console.log("User disconnected:", socket.id);

        const partner = partners[socket.id];

        if (partner) {

            io.to(partner).emit("partner-left");

            delete partners[partner];

        }

        delete partners[socket.id];

        waitingUsers = waitingUsers.filter(id => id !== socket.id);

    });

});

/* ---------------- START SERVER ---------------- */

server.listen(PORT, "0.0.0.0", () => {

    console.log(`Server running on http://localhost:${PORT}`);

});