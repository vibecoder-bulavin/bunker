const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const cardsPath = path.join(__dirname, "data", "cards", "cards.json");
const cardPools = JSON.parse(fs.readFileSync(cardsPath, "utf-8"));

const players = new Map();
const cardKeys = [
  "profession",
  "health",
  "bio",
  "hobby",
  "phobia",
  "extra",
  "traits"
];

function randomFromArray(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function buildPlayerCard() {
  const card = {};
  for (const key of cardKeys) {
    card[key] = randomFromArray(cardPools[key] || []);
  }
  return card;
}

function publicPlayerState(player) {
  const result = {
    id: player.id,
    nickname: player.nickname,
    revealed: player.revealed
  };

  for (const key of cardKeys) {
    result[key] = player.revealed[key] ? player.card[key] : null;
  }

  return result;
}

function broadcastState() {
  const snapshot = Array.from(players.values()).map(publicPlayerState);
  io.emit("players:update", snapshot);
}

io.on("connection", (socket) => {
  socket.on("join", (nickname) => {
    const safeNickname = String(nickname || "").trim().slice(0, 24);
    if (!safeNickname) {
      socket.emit("join:error", "Введите корректный никнейм.");
      return;
    }

    const card = buildPlayerCard();
    const revealed = Object.fromEntries(cardKeys.map((key) => [key, false]));

    const player = {
      id: socket.id,
      nickname: safeNickname,
      card,
      revealed
    };

    players.set(socket.id, player);
    socket.emit("card:private", card);
    broadcastState();
  });

  socket.on("reveal:property", (propertyName) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (!cardKeys.includes(propertyName)) return;

    player.revealed[propertyName] = true;
    broadcastState();
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    broadcastState();
  });
});

app.use(express.static(path.join(__dirname, "public")));

server.listen(PORT, () => {
  console.log(`Bunker server started on http://localhost:${PORT}`);
});
