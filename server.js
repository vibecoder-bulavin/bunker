const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const cardKeys = ["profession", "health", "bio", "hobby", "phobia", "extra", "traits", "fact", "secret"];
const packDir = path.join(__dirname, "data", "packs");
const worldDir = path.join(__dirname, "data", "world");
const actionsPath = path.join(__dirname, "data", "actions", "actions.json");

const availablePacks = loadPacks();
const actionCardsPool = loadJson(actionsPath);
const worldData = {
  locations: loadJson(path.join(worldDir, "locations.json")),
  supplies: loadJson(path.join(worldDir, "supplies.json")),
  apocalypses: loadJson(path.join(worldDir, "apocalypses.json"))
};

const state = {
  roomId: "main",
  phase: "lobby",
  roundMode: "reveal",
  hostId: null,
  selectedPacks: ["classic"],
  players: new Map(),
  turnOrder: [],
  currentTurnIndex: 0,
  currentSpeakerId: null,
  turnRevealCount: 0,
  world: null,
  voting: { active: false, endsAt: null, votes: {} },
  globalTimer: { active: false, endsAt: null, durationSec: null },
  lastReveal: null,
  lastPublicAction: null,
  actionLog: [],
  roundHint: ""
};

let votingTimeout = null;
let globalTimerTimeout = null;

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function loadPacks() {
  const packs = {};
  const files = fs.readdirSync(packDir).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    const name = path.basename(file, ".json");
    packs[name] = loadJson(path.join(packDir, file));
  }
  return packs;
}

function randomFromArray(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function getMergedPool(packNames) {
  const merged = Object.fromEntries(cardKeys.map((key) => [key, []]));
  for (const packName of packNames) {
    const pack = availablePacks[packName];
    if (!pack) continue;
    for (const key of cardKeys) {
      merged[key].push(...(pack[key] || []));
    }
  }
  return merged;
}

function buildPlayerCard(selectedPacks) {
  const pool = getMergedPool(selectedPacks);
  const card = {};
  for (const key of cardKeys) {
    card[key] = randomFromArray(pool[key] || []);
  }
  return card;
}

function buildActionCard() {
  return randomFromArray(actionCardsPool);
}

function createPlayer(socketId, nickname, avatarUrl) {
  return {
    id: socketId,
    nickname,
    avatarUrl: avatarUrl || null,
    card: null,
    revealed: Object.fromEntries(cardKeys.map((key) => [key, false])),
    revealedAt: Object.fromEntries(cardKeys.map((key) => [key, null])),
    isAlive: true,
    canUndoUntil: {},
    actionCard: null,
    actionUsed: false,
    actionCancelled: false,
    mutedForCircle: false,
    bonusRevealCredits: 0,
    blockedProperties: {},
    mustForgetProperty: false,
    doubleVoteThisPoll: false,
    votingImmunityThisPoll: false,
    flipVotesActive: false,
    protectPartnerId: null,
    speakInsteadTargetId: null,
    sacrificeVoteBonus: false,
    unoMarked: false
  };
}

function resetPlayerForGame(player) {
  player.revealed = Object.fromEntries(cardKeys.map((key) => [key, false]));
  player.revealedAt = Object.fromEntries(cardKeys.map((key) => [key, null]));
  player.revealed.profession = true;
  player.revealedAt.profession = Date.now();
  player.isAlive = true;
  player.canUndoUntil = {};
  player.actionCard = buildActionCard();
  player.actionUsed = false;
  player.actionCancelled = false;
  player.mutedForCircle = false;
  player.bonusRevealCredits = 0;
  player.blockedProperties = {};
  player.mustForgetProperty = false;
  player.doubleVoteThisPoll = false;
  player.votingImmunityThisPoll = false;
  player.flipVotesActive = false;
  player.protectPartnerId = null;
  player.speakInsteadTargetId = null;
  player.sacrificeVoteBonus = false;
  player.unoMarked = false;
}

function setBioAge(player, age) {
  player.card.bio = `${age} лет`;
}

function getActionDef(actionId) {
  return actionCardsPool.find((a) => a.id === actionId);
}

function computeRoundHint(playerCount) {
  const map = {
    4: "Круги (4): 2 -> 2 + kick -> 1 + kick",
    5: "Круги (5): 2 + kick -> 2 + kick -> 1 + kick",
    6: "Круги (6): 2 -> 2 + kick -> 1 + kick -> 1 + kick",
    7: "Круги (7): 1 -> 1 -> 2 + kick -> 2 + kick -> 1 + kick",
    8: "Круги (8): 1 -> 1 -> 1 + kick -> 1 + kick -> 2 + kick -> 1 + kick"
  };
  return map[playerCount] || `Игроков ${playerCount}.`;
}

function circleStatusLabel() {
  if (state.phase === "lobby") return "";
  if (state.roundMode === "discussion" || state.phase === "voting") {
    return "2. Обсуждение и исключение";
  }
  return "1. Вскрытие характеристик";
}

function getPlayerView(player) {
  const result = {
    id: player.id,
    nickname: player.nickname,
    avatarUrl: player.avatarUrl,
    isHost: player.id === state.hostId,
    isAlive: player.isAlive,
    revealedAt: player.revealedAt,
    revealed: player.revealed,
    canUndoUntil: player.canUndoUntil,
    actionUsed: player.actionUsed,
    mutedForCircle: player.mutedForCircle,
    bonusRevealCredits: player.bonusRevealCredits,
    mustForgetProperty: player.mustForgetProperty,
    blockedProperties: player.blockedProperties,
    protectPartnerId: player.protectPartnerId,
    votingImmunityThisPoll: player.votingImmunityThisPoll
  };

  for (const key of cardKeys) {
    result[key] = player.revealed[key] ? player.card[key] : null;
  }

  return result;
}

function publicStateFor(socketId) {
  return {
    roomId: state.roomId,
    phase: state.phase,
    roundMode: state.roundMode,
    circleStatus: circleStatusLabel(),
    hostId: state.hostId,
    meId: socketId,
    selectedPacks: state.selectedPacks,
    availablePacks: Object.keys(availablePacks),
    players: Array.from(state.players.values()).map(getPlayerView),
    turnOrder: state.turnOrder,
    currentSpeakerId: state.currentSpeakerId,
    world: state.world,
    voting: state.voting,
    globalTimer: state.globalTimer,
    lastReveal: state.lastReveal,
    lastPublicAction: state.lastPublicAction,
    actionLog: state.actionLog,
    roundHint: state.roundHint,
    turnRevealCount: state.turnRevealCount
  };
}

function broadcastState() {
  for (const [socketId] of state.players) {
    io.to(socketId).emit("state:update", publicStateFor(socketId));
  }
}

function sendPrivateCards(player) {
  io.to(player.id).emit("card:private", player.card);
  io.to(player.id).emit("action:private", player.actionCard);
}

function assertHost(socket, actionName) {
  if (socket.id !== state.hostId) {
    socket.emit("action:error", `Только хост может: ${actionName}`);
    return false;
  }
  return true;
}

function pickWorld() {
  return {
    location: randomFromArray(worldData.locations),
    supplies: randomFromArray(worldData.supplies),
    apocalypse: randomFromArray(worldData.apocalypses)
  };
}

function alivePlayers() {
  return Array.from(state.players.values()).filter((p) => p.isAlive);
}

function setupTurns() {
  const ids = alivePlayers().map((p) => p.id);
  state.turnOrder = ids;
  state.currentTurnIndex = 0;
  state.currentSpeakerId = ids[0] || null;
  state.turnRevealCount = 0;
  applySpeakerOverride();
}

function applySpeakerOverride() {
  const speaker = state.players.get(state.currentSpeakerId);
  if (!speaker) return;
  for (const p of state.players.values()) {
    if (p.speakInsteadTargetId === speaker.id && p.isAlive) {
      state.currentSpeakerId = p.id;
      break;
    }
  }
}

function clearCircleMutes() {
  for (const p of state.players.values()) {
    p.mutedForCircle = false;
  }
}

function tallyVotes() {
  const voteCounts = {};
  for (const [voterId, targetId] of Object.entries(state.voting.votes)) {
    const voter = state.players.get(voterId);
    if (!voter || !voter.isAlive) continue;
    let weight = 1;
    if (voter.doubleVoteThisPoll) weight = 2;
    voteCounts[targetId] = (voteCounts[targetId] || 0) + weight;
  }
  for (const p of state.players.values()) {
    if (p.sacrificeVoteBonus && p.isAlive) {
      voteCounts[p.id] = (voteCounts[p.id] || 0) + 1;
    }
  }
  return voteCounts;
}

function findEliminationTarget(voteCounts) {
  let maxVotes = 0;
  let leaders = [];
  for (const [targetId, count] of Object.entries(voteCounts)) {
    const target = state.players.get(targetId);
    if (!target || !target.isAlive) continue;
    if (count > maxVotes) {
      maxVotes = count;
      leaders = [targetId];
    } else if (count === maxVotes) {
      leaders.push(targetId);
    }
  }
  if (!leaders.length || maxVotes === 0) return null;
  if (leaders.length > 1) return null;

  let eliminateId = leaders[0];
  const leaderPlayer = state.players.get(eliminateId);
  if (leaderPlayer?.votingImmunityThisPoll) return null;

  const flipOwner = Array.from(state.players.values()).find(
    (p) => p.flipVotesActive && p.isAlive && eliminateId === p.id
  );
  if (flipOwner) {
    let minVotes = Infinity;
    let minTarget = null;
    let minTie = false;
    for (const [targetId, count] of Object.entries(voteCounts)) {
      const t = state.players.get(targetId);
      if (!t || !t.isAlive) continue;
      if (count < minVotes) {
        minVotes = count;
        minTarget = targetId;
        minTie = false;
      } else if (count === minVotes) {
        minTie = true;
      }
    }
    flipOwner.flipVotesActive = false;
    if (minTarget && !minTie && minVotes > 0) eliminateId = minTarget;
  }

  return eliminateId;
}

function endVoting() {
  if (!state.voting.active) return;
  state.voting.active = false;
  state.voting.endsAt = null;
  clearVotingTimer();

  const voteCounts = tallyVotes();
  const eliminateId = findEliminationTarget(voteCounts);

  if (eliminateId) {
    const eliminated = state.players.get(eliminateId);
    if (eliminated) {
      if (eliminated.votingImmunityThisPoll) {
        // skip
      } else if (eliminated.protectPartnerId) {
        const partner = state.players.get(eliminated.protectPartnerId);
        if (partner?.isAlive) {
          // обмен телами — не выбываем в этом круге
        } else {
          eliminated.isAlive = false;
        }
      } else {
        eliminated.isAlive = false;
      }
    }
  }

  for (const p of state.players.values()) {
    p.doubleVoteThisPoll = false;
    p.sacrificeVoteBonus = false;
    p.votingImmunityThisPoll = false;
    p.protectPartnerId = null;
  }

  state.voting.votes = {};
  state.phase = "in_game";
  state.roundMode = "reveal";
  clearCircleMutes();
  setupTurns();
  broadcastState();
}

function recordPublicAction(actor, target, actionDef, extra = {}) {
  const entry = {
    at: Date.now(),
    actorName: actor.nickname,
    targetName: target ? target.nickname : null,
    actionTitle: actionDef.title,
    actionId: actionDef.id,
    description: actionDef.description,
    ...extra
  };
  state.lastPublicAction = entry;
  state.actionLog.unshift(entry);
  if (state.actionLog.length > 40) state.actionLog.length = 40;
}

function applyAction(actor, target, propertyKey) {
  const def = actor.actionCard;
  if (!def) return "Нет карты действия.";

  switch (def.id) {
    case "silence_mouth":
      target.mutedForCircle = true;
      break;
    case "swap_property": {
      const swappable = cardKeys.filter((k) => k !== "profession");
      if (!swappable.includes(propertyKey)) return "Выбери характеристику для обмена.";
      const tmp = actor.card[propertyKey];
      actor.card[propertyKey] = target.card[propertyKey];
      target.card[propertyKey] = tmp;
      break;
    }
    case "gangrene":
      target.card.health = "Гангрена";
      break;
    case "cancel_action":
      if (target.actionUsed) return "Действие цели уже использовано.";
      target.actionCancelled = true;
      target.actionUsed = true;
      break;
    case "extra_vote":
      actor.doubleVoteThisPoll = true;
      break;
    case "force_reveal":
      target.bonusRevealCredits += 1;
      break;
    case "forget_property":
      target.mustForgetProperty = true;
      break;
    case "youth_elixir":
      setBioAge(target, 30);
      break;
    case "old_elixir":
      setBioAge(target, 70);
      break;
    case "baby_elixir":
    case "teen_elixir":
      setBioAge(target, 14);
      break;
    case "copy_profession":
      actor.card.profession = target.card.profession;
      actor.revealed.profession = true;
      actor.revealedAt.profession = Date.now();
      break;
    case "job_cut":
      target.card.profession = "Безработный";
      target.card.extra = "Потерял все знания профессии";
      break;
    case "heal":
      if (target.card.health && !target.card.health.includes("здоров")) {
        target.card.health = "Полностью здоров";
      }
      break;
    case "steal_mic":
      actor.speakInsteadTargetId = target.id;
      break;
    case "sacrifice":
      target.sacrificeVoteBonus = true;
      actor.votingImmunityThisPoll = true;
      break;
    case "body_swap":
      actor.protectPartnerId = target.id;
      target.protectPartnerId = actor.id;
      actor.votingImmunityThisPoll = true;
      target.votingImmunityThisPoll = true;
      break;
    case "flip_vote":
      actor.flipVotesActive = true;
      break;
    case "interrogation":
      break;
    case "anesthesia":
      target.card.phobia = "Нет фобий";
      target.revealed.phobia = true;
      target.revealedAt.phobia = Date.now();
      break;
    case "uno":
      target.unoMarked = true;
      break;
    default:
      return "Неизвестное действие.";
  }
  return null;
}

io.on("connection", (socket) => {
  socket.on("join", (payload) => {
    const nickname = String(payload?.nickname || "").trim().slice(0, 24);
    const avatarUrl = String(payload?.avatarUrl || "").trim().slice(0, 512);
    if (!nickname) {
      socket.emit("join:error", "Введите корректный никнейм.");
      return;
    }
    if (state.players.has(socket.id)) return;

    const player = createPlayer(socket.id, nickname, avatarUrl);
    state.players.set(socket.id, player);
    ensureValidHost();
    state.roundHint = computeRoundHint(state.players.size);
    socket.join(state.roomId);
    broadcastState();
  });

  socket.on("host:claim", () => {
    if (!state.players.has(socket.id)) return;
    if (state.hostId && state.hostId !== socket.id) {
      socket.emit("action:error", "Админ уже назначен.");
      return;
    }
    state.hostId = socket.id;
    broadcastState();
  });

  socket.on("host:set-packs", (packNames) => {
    if (!assertHost(socket, "выбор паков")) return;
    if (state.phase !== "lobby") {
      socket.emit("action:error", "Паки меняются только в лобби.");
      return;
    }
    const unique = [...new Set(Array.isArray(packNames) ? packNames : [])];
    const valid = unique.filter((name) => availablePacks[name]);
    if (!valid.length) {
      socket.emit("action:error", "Выбери минимум один валидный пак.");
      return;
    }
    state.selectedPacks = valid;
    broadcastState();
  });

  socket.on("host:transfer", (targetId) => {
    if (!assertHost(socket, "передача хоста")) return;
    if (!state.players.has(targetId)) return;
    state.hostId = targetId;
    broadcastState();
  });

  socket.on("host:set-round-mode", (mode) => {
    if (!assertHost(socket, "смена режима круга")) return;
    if (!["reveal", "discussion"].includes(mode)) return;
    state.roundMode = mode;
    if (mode === "reveal") clearCircleMutes();
    broadcastState();
  });

  socket.on("host:revive-player", (targetId) => {
    if (!assertHost(socket, "возврат игрока")) return;
    const target = state.players.get(targetId);
    if (!target) return;
    target.isAlive = true;
    setupTurns();
    broadcastState();
  });

  socket.on("host:eliminate-player", (targetId) => {
    if (!assertHost(socket, "исключение игрока")) return;
    const target = state.players.get(targetId);
    if (!target || !target.isAlive) return;
    target.isAlive = false;
    setupTurns();
    broadcastState();
  });

  socket.on("host:start-game", () => {
    if (!assertHost(socket, "старт игры")) return;
    if (state.players.size < 2) {
      socket.emit("action:error", "Нужно минимум 2 игрока.");
      return;
    }

    state.phase = "in_game";
    state.roundMode = "reveal";
    state.world = pickWorld();
    state.roundHint = computeRoundHint(state.players.size);
    state.lastReveal = null;
    state.lastPublicAction = null;
    state.actionLog = [];
    state.voting = { active: false, endsAt: null, votes: {} };
    clearVotingTimer();

    for (const player of state.players.values()) {
      player.card = buildPlayerCard(state.selectedPacks);
      resetPlayerForGame(player);
      sendPrivateCards(player);
    }

    setupTurns();
    broadcastState();
  });

  socket.on("turn:next", () => {
    if (!assertHost(socket, "переключение хода")) return;
    if (!state.turnOrder.length || state.roundMode !== "reveal") return;

    const current = state.players.get(state.currentSpeakerId);
    if (current) {
      current.bonusRevealCredits = 0;
    }

    state.currentTurnIndex = (state.currentTurnIndex + 1) % state.turnOrder.length;
    state.currentSpeakerId = state.turnOrder[state.currentTurnIndex];
    state.turnRevealCount = 0;
    applySpeakerOverride();
    broadcastState();
  });

  socket.on("reveal:property", (propertyName) => {
    const player = state.players.get(socket.id);
    if (!player || state.phase !== "in_game" || state.roundMode !== "reveal") return;
    if (state.currentSpeakerId !== socket.id) return;
    if (!cardKeys.includes(propertyName) || propertyName === "profession") return;
    if (player.revealed[propertyName] || !player.isAlive) return;
    if (player.mutedForCircle) {
      socket.emit("action:error", "Ты не можешь говорить до конца круга.");
      return;
    }
    if (player.blockedProperties[propertyName]) {
      socket.emit("action:error", "Эта характеристика заблокирована.");
      return;
    }

    const revealLimit = 1 + player.bonusRevealCredits;
    if (state.turnRevealCount >= revealLimit) {
      socket.emit("action:error", "Лимит раскрытий на этот ход исчерпан.");
      return;
    }

    player.revealed[propertyName] = true;
    player.revealedAt[propertyName] = Date.now();
    player.canUndoUntil[propertyName] = Date.now() + 5000;
    state.turnRevealCount += 1;
    state.lastReveal = { playerId: player.id, propertyName, at: Date.now() };
    broadcastState();
  });

  socket.on("reveal:undo", (propertyName) => {
    const player = state.players.get(socket.id);
    if (!player || !cardKeys.includes(propertyName)) return;
    if (!player.revealed[propertyName]) return;
    if (Date.now() > (player.canUndoUntil[propertyName] || 0)) return;

    player.revealed[propertyName] = false;
    player.revealedAt[propertyName] = null;
    player.canUndoUntil[propertyName] = 0;
    state.turnRevealCount = Math.max(0, state.turnRevealCount - 1);
    state.lastReveal = null;
    broadcastState();
  });

  socket.on("action:resolve-forget", (propertyKey) => {
    const player = state.players.get(socket.id);
    if (!player || !player.mustForgetProperty) return;
    if (!player.revealed[propertyKey]) return;

    player.blockedProperties[propertyKey] = true;
    player.mustForgetProperty = false;
    broadcastState();
  });

  socket.on("action:use", ({ targetId, propertyKey } = {}) => {
    const actor = state.players.get(socket.id);
    if (!actor || state.phase !== "in_game" || !actor.isAlive) return;
    if (!actor.actionCard || actor.actionUsed || actor.actionCancelled) {
      socket.emit("action:error", "Карточка действия недоступна.");
      return;
    }

    const def = actor.actionCard;
    let target = null;
    if (def.needsTarget !== false) {
      target = state.players.get(targetId);
      if (!target || !target.isAlive) {
        socket.emit("action:error", "Выбери живого игрока.");
        return;
      }
      if (!def.allowSelf && target.id === actor.id) {
        socket.emit("action:error", "Нельзя применить на себя.");
        return;
      }
    } else {
      target = actor;
    }

    let reflected = false;
    if (actor.unoMarked && def.id !== "uno") {
      actor.unoMarked = false;
      target = actor;
      reflected = true;
    }

    const err = applyAction(actor, target, propertyKey);
    if (err) {
      socket.emit("action:error", err);
      return;
    }

    actor.actionUsed = true;
    recordPublicAction(actor, def.needsTarget === false ? null : target, def, {
      reflected
    });
    state.lastReveal = null;

    sendPrivateCards(actor);
    if (target && target.id !== actor.id) sendPrivateCards(target);
    broadcastState();
  });

  socket.on("host:start-voting", () => {
    if (!assertHost(socket, "запуск голосования")) return;
    if (state.phase !== "in_game") {
      socket.emit("action:error", "Голосование только во время игры.");
      return;
    }

    state.phase = "voting";
    state.roundMode = "discussion";
    state.voting.active = true;
    state.voting.votes = {};
    state.voting.endsAt = Date.now() + 30_000;
    clearVotingTimer();
    votingTimeout = setTimeout(endVoting, 30_000);
    broadcastState();
  });

  socket.on("vote:cast", (targetId) => {
    const player = state.players.get(socket.id);
    if (!player || !player.isAlive || !state.voting.active) return;
    const target = state.players.get(targetId);
    if (!target || !target.isAlive) return;
    state.voting.votes[socket.id] = targetId;
    broadcastState();
  });

  socket.on("host:restart", () => {
    if (!assertHost(socket, "перезапуск")) return;
    clearVotingTimer();
    clearGlobalTimer();

    state.phase = "lobby";
    state.roundMode = "reveal";
    state.world = null;
    state.turnOrder = [];
    state.currentSpeakerId = null;
    state.turnRevealCount = 0;
    state.voting = { active: false, endsAt: null, votes: {} };
    state.globalTimer = { active: false, endsAt: null, durationSec: null };
    state.lastReveal = null;
    state.lastPublicAction = null;
    state.actionLog = [];

    for (const player of state.players.values()) {
      player.card = null;
      player.revealed = Object.fromEntries(cardKeys.map((key) => [key, false]));
      player.isAlive = true;
      player.actionCard = null;
      player.actionUsed = false;
      player.actionCancelled = false;
      player.mutedForCircle = false;
      player.bonusRevealCredits = 0;
      player.blockedProperties = {};
      player.mustForgetProperty = false;
      player.unoMarked = false;
    }

    broadcastState();
  });

  socket.on("host:start-timer", (durationSec) => {
    if (!assertHost(socket, "запуск таймера")) return;
    if (![30, 45, 60].includes(durationSec)) return;

    state.globalTimer = {
      active: true,
      durationSec,
      endsAt: Date.now() + durationSec * 1000
    };
    clearGlobalTimer();
    globalTimerTimeout = setTimeout(() => {
      state.globalTimer = { active: false, durationSec: null, endsAt: null };
      broadcastState();
    }, durationSec * 1000);
    broadcastState();
  });

  socket.on("disconnect", () => {
    state.players.delete(socket.id);
    if (state.turnOrder.includes(socket.id)) setupTurns();
    delete state.voting.votes[socket.id];
    if (state.hostId === socket.id) ensureValidHost();
    state.roundHint = computeRoundHint(state.players.size);
    broadcastState();
  });
});

function ensureValidHost() {
  if (state.hostId && state.players.has(state.hostId)) return;
  state.hostId = null;
}

function clearVotingTimer() {
  if (votingTimeout) {
    clearTimeout(votingTimeout);
    votingTimeout = null;
  }
}

function clearGlobalTimer() {
  if (globalTimerTimeout) {
    clearTimeout(globalTimerTimeout);
    globalTimerTimeout = null;
  }
}

app.use(express.static(path.join(__dirname, "public")));

server.listen(PORT, () => {
  console.log(`Bunker server started on http://localhost:${PORT}`);
});
