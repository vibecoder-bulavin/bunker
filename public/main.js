const socket = io();

const labels = {
  profession: "Профессия",
  health: "Здоровье",
  bio: "Биологические данные",
  hobby: "Хобби",
  phobia: "Фобии",
  extra: "Доп. навыки / багаж",
  traits: "Личные качества",
  fact: "Доп. факт",
  secret: "Секрет"
};
const labelIcons = {
  profession: "🛠",
  health: "❤️",
  bio: "🧬",
  hobby: "🎯",
  phobia: "😱",
  extra: "🎒",
  traits: "🧠",
  fact: "📌",
  secret: "🤫"
};

const cardKeys = Object.keys(labels);
const actionPropertyKeys = cardKeys.filter((key) => key !== "profession");

const joinSection = document.getElementById("joinSection");
const gameSection = document.getElementById("gameSection");
const nicknameInput = document.getElementById("nickname");
const avatarUrlInput = document.getElementById("avatarUrl");
const joinBtn = document.getElementById("joinBtn");
const joinError = document.getElementById("joinError");
const myCard = document.getElementById("myCard");
const myActionCard = document.getElementById("myActionCard");
const playersTable = document.getElementById("playersTable");
const lobbyPlayers = document.getElementById("lobbyPlayers");
const hostControls = document.getElementById("hostControls");
const reviveList = document.getElementById("reviveList");
const packChips = document.getElementById("packChips");
const startGameBtn = document.getElementById("startGameBtn");
const nextTurnBtn = document.getElementById("nextTurnBtn");
const startVotingBtn = document.getElementById("startVotingBtn");
const restartBtn = document.getElementById("restartBtn");
const worldInfo = document.getElementById("worldInfo");
const turnLabel = document.getElementById("turnLabel");
const turnInfo = document.getElementById("turnInfo");
const turnOpenLabel = document.getElementById("turnOpenLabel");
const turnOpenInfo = document.getElementById("turnOpenInfo");
const circleStatus = document.getElementById("circleStatus");
const effectInfo = document.getElementById("effectInfo");
const publicActionInfo = document.getElementById("publicActionInfo");
const actionLogEl = document.getElementById("actionLog");
const actionBanner = document.getElementById("actionBanner");
const adminLobbyHint = document.getElementById("adminLobbyHint");
const voteInfo = document.getElementById("voteInfo");
const modeRevealBtn = document.getElementById("modeRevealBtn");
const modeDiscussionBtn = document.getElementById("modeDiscussionBtn");
const claimHostBtn = document.getElementById("claimHostBtn");
const timerBar = document.getElementById("timerBar");
const playerModal = document.getElementById("playerModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const modalPlayerName = document.getElementById("modalPlayerName");
const modalPlayerStats = document.getElementById("modalPlayerStats");

let joined = false;
let myCardData = null;
let myActionData = null;
let lastState = null;
let timerTicker = null;
let draftPacks = [];
let audioCtx = null;
let lastSpeakerId = null;
let lastPhase = null;
let lastTimerKey = "none";
let lastCountdownSecond = null;
let lastActionAt = null;
let actionBannerTimeout = null;
const packTitles = {
  classic: "Классика",
  science: "Научный",
  chaos: "Хаос"
};

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function beep(freq, duration = 0.08, type = "sine", volume = 0.03) {
  ensureAudio();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playTurnClick() {
  beep(700, 0.03, "square", 0.02);
  setTimeout(() => beep(900, 0.03, "square", 0.02), 25);
}

function playVotingStart() {
  beep(520, 0.1, "triangle", 0.03);
  setTimeout(() => beep(740, 0.12, "triangle", 0.03), 120);
}

function playTick(urgency) {
  beep(1200 + urgency * 160, 0.03, "square", 0.02);
}

function playBell() {
  beep(880, 0.15, "sine", 0.04);
  setTimeout(() => beep(1320, 0.18, "sine", 0.04), 170);
}

function avatarOrFallback(url) {
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.className = "avatar";
    img.alt = "avatar";
    img.referrerPolicy = "no-referrer";
    return img;
  }
  const fallback = document.createElement("div");
  fallback.className = "avatar";
  fallback.textContent = "👤";
  fallback.style.display = "grid";
  fallback.style.placeItems = "center";
  return fallback;
}

function createCardItem(key, value, playerState) {
  const wrap = document.createElement("div");
  wrap.className = "card-item";

  const title = document.createElement("h3");
  title.textContent = `${labelIcons[key] || ""} ${labels[key]}`;

  const text = document.createElement("p");
  text.textContent = value;

  const isProfession = key === "profession";
  const button = document.createElement("button");
  button.textContent = "Открыть";
  button.disabled = isProfession || !playerState?.isMyTurn || playerState?.revealed?.[key];
  button.addEventListener("click", () => {
    socket.emit("reveal:property", key);
  });

  const undoButton = document.createElement("button");
  undoButton.textContent = "Ой, вернуть";
  undoButton.classList.add("hidden");
  undoButton.addEventListener("click", () => {
    socket.emit("reveal:undo", key);
  });

  const undoUntil = playerState?.canUndoUntil?.[key] || 0;
  if (Date.now() < undoUntil) {
    undoButton.classList.remove("hidden");
    const remain = Math.ceil((undoUntil - Date.now()) / 1000);
    undoButton.textContent = `Ой, вернуть (${remain})`;
  }

  if (playerState?.revealed?.[key]) {
    button.disabled = true;
    button.textContent = "Открыто";
  }

  if (isProfession) {
    button.textContent = "Открыто по умолчанию";
  }

  wrap.append(title, text, button, undoButton);
  return wrap;
}

function renderActionCard(state) {
  const me = state.players.find((player) => player.id === state.meId);
  myActionCard.innerHTML = "";
  if (!myActionData || !me) {
    myActionCard.textContent = "Карточка действия появится после старта мира.";
    return;
  }

  const title = document.createElement("h3");
  title.textContent = `Карточка действия: ${myActionData.title}`;
  const descr = document.createElement("p");
  descr.textContent = myActionData.description;
  myActionCard.append(title, descr);

  if (me.actionUsed) {
    const used = document.createElement("div");
    used.className = "hint";
    used.textContent = "Карточка уже использована.";
    myActionCard.append(used);
    return;
  }

  let targetSelect = null;
  const needsTarget = myActionData.needsTarget !== false;
  if (needsTarget) {
    const targets = state.players.filter((p) => {
      if (!p.isAlive) return false;
      if (p.id === state.meId && !myActionData.allowSelf) return false;
      return true;
    });
    if (!targets.length) return;
    targetSelect = document.createElement("select");
    for (const player of targets) {
      const option = document.createElement("option");
      option.value = player.id;
      option.textContent = player.nickname;
      targetSelect.append(option);
    }
    myActionCard.append(targetSelect);
  }

  let propertySelect = null;
  if (myActionData.needsProperty || myActionData.id === "swap_property") {
    propertySelect = document.createElement("select");
    for (const key of actionPropertyKeys) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = labels[key];
      propertySelect.append(option);
    }
    myActionCard.append(propertySelect);
  }

  const actionBtn = document.createElement("button");
  actionBtn.textContent = "Применить карточку";
  actionBtn.addEventListener("click", () => {
    socket.emit("action:use", {
      targetId: targetSelect ? targetSelect.value : state.meId,
      propertyKey: propertySelect ? propertySelect.value : null
    });
  });
  myActionCard.append(actionBtn);
}

function renderForgetPicker(state, me) {
  if (!me.mustForgetProperty || state.currentSpeakerId !== state.meId) return;
  const box = document.createElement("div");
  box.className = "action-card";
  box.innerHTML = "<h3>Забыть характеристику</h3><p>Выбери открытую характеристику — она станет неактивной.</p>";
  const select = document.createElement("select");
  const revealedKeys = cardKeys.filter((k) => me.revealed?.[k] && k !== "profession");
  for (const key of revealedKeys) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = labels[key];
    select.append(option);
  }
  const btn = document.createElement("button");
  btn.textContent = "Забыть выбранную";
  btn.addEventListener("click", () => socket.emit("action:resolve-forget", select.value));
  box.append(select, btn);
  myActionCard.prepend(box);
}

function renderPackChips(state) {
  const isHost = state.meId === state.hostId;
  if (!draftPacks.length) {
    draftPacks = [...state.selectedPacks];
  }

  packChips.innerHTML = "";
  for (const packName of state.availablePacks) {
    const chip = document.createElement("button");
    chip.className = "chip";
    if (draftPacks.includes(packName)) chip.classList.add("active");
    chip.textContent = packTitles[packName] || packName;
    chip.disabled = !isHost || state.phase !== "lobby";
    chip.addEventListener("click", () => {
      if (draftPacks.includes(packName)) {
        draftPacks = draftPacks.filter((name) => name !== packName);
      } else {
        draftPacks.push(packName);
      }
      if (!draftPacks.length) {
        draftPacks = [packName];
      }
      renderPackChips(state);
    });
    packChips.append(chip);
  }
}

function renderRevivePanel(state) {
  if (!reviveList) return;
  reviveList.innerHTML = "";
  const isHost = state.meId === state.hostId;
  if (!isHost) return;

  const eliminated = state.players.filter((player) => !player.isAlive);
  if (!eliminated.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Нет выбывших игроков.";
    reviveList.append(empty);
    return;
  }

  for (const player of eliminated) {
    const row = document.createElement("div");
    row.className = "revive-row";
    const name = document.createElement("span");
    name.textContent = player.nickname;
    const reviveBtn = document.createElement("button");
    reviveBtn.className = "revive-btn";
    reviveBtn.textContent = "Вернуть в игру";
    reviveBtn.addEventListener("click", () => {
      socket.emit("host:revive-player", player.id);
    });
    row.append(name, reviveBtn);
    reviveList.append(row);
  }
}

function addAdminPlayerActions(state, container, player) {
  if (state.meId !== state.hostId) return;
  if (!player.isAlive) {
    const reviveBtn = document.createElement("button");
    reviveBtn.className = "revive-btn";
    reviveBtn.textContent = "Вернуть в игру";
    reviveBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      socket.emit("host:revive-player", player.id);
    });
    container.append(reviveBtn);
  }
}

function formatActionLine(entry) {
  const base = entry.targetName
    ? `${entry.actorName} → ${entry.targetName}: «${entry.actionTitle}»`
    : `${entry.actorName}: «${entry.actionTitle}»`;
  return entry.reflected ? `${base} (отражено Уно)` : base;
}

function showActionBanner(entry) {
  if (!entry || !actionBanner) return;
  actionBanner.innerHTML = `
    <div class="action-banner-title">Использовано действие</div>
    <div class="action-banner-text">${formatActionLine(entry)}</div>
    <div class="action-banner-desc">${entry.description || ""}</div>
  `;
  actionBanner.classList.remove("hidden");
  if (actionBannerTimeout) clearTimeout(actionBannerTimeout);
  actionBannerTimeout = setTimeout(() => {
    actionBanner.classList.add("hidden");
  }, 8000);
}

function renderActionLog(state) {
  if (!actionLogEl) return;
  actionLogEl.innerHTML = "";
  const log = state.actionLog || [];
  if (!log.length) {
    const empty = document.createElement("li");
    empty.className = "hint";
    empty.textContent = "Пока никто не использовал карты действий.";
    actionLogEl.append(empty);
    return;
  }
  for (const entry of log) {
    const item = document.createElement("li");
    item.className = "prop-line action-log-item";
    const title = document.createElement("div");
    title.className = "action-log-title";
    title.textContent = formatActionLine(entry);
    const meta = document.createElement("div");
    meta.className = "action-log-meta";
    meta.textContent = entry.targetName
      ? `Игрок ${entry.actorName} применил на ${entry.targetName}`
      : `Игрок ${entry.actorName} применил на себя`;
    const desc = document.createElement("div");
    desc.className = "action-log-desc";
    desc.textContent = entry.description || "";
    item.append(title, meta, desc);
    actionLogEl.append(item);
  }
}

function getPlayerLastAction(state, nickname) {
  return (state.actionLog || []).find((entry) => entry.actorName === nickname) || null;
}

function remainingText(endAt) {
  if (!endAt) return "";
  const sec = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  return `${sec}с`;
}

function updateLiveCounters() {
  if (!lastState) return;
  const votingActive = lastState.voting.active;
  const commonActive = lastState.globalTimer.active;
  let timerKey = "none";
  let endsAt = null;

  if (votingActive) {
    timerKey = "voting";
    endsAt = lastState.voting.endsAt;
    timerBar.textContent = `ГОЛОСОВАНИЕ: ${remainingText(endsAt)}`;
    timerBar.classList.remove("hidden");
  } else if (commonActive) {
    timerKey = "global";
    endsAt = lastState.globalTimer.endsAt;
    timerBar.textContent = `ТАЙМЕР: ${remainingText(endsAt)}`;
    timerBar.classList.remove("hidden");
  } else {
    timerBar.classList.add("hidden");
  }

  if (lastTimerKey !== "none" && timerKey === "none") {
    playBell();
  }
  lastTimerKey = timerKey;

  if (!endsAt) {
    lastCountdownSecond = null;
    return;
  }

  const sec = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  if (sec <= 5 && sec > 0 && sec !== lastCountdownSecond) {
    const urgency = 6 - sec;
    const count = sec <= 2 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      setTimeout(() => playTick(urgency), i * 90);
    }
  }
  lastCountdownSecond = sec;
}

function renderLobbyPlayers(state) {
  lobbyPlayers.innerHTML = "";
  for (const player of state.players) {
    const tile = document.createElement("div");
    tile.className = "lobby-tile";
    if (!player.isAlive) tile.classList.add("eliminated");
    if (player.id === state.currentSpeakerId) tile.classList.add("speaking");

    const avatar = avatarOrFallback(player.avatarUrl);
    avatar.classList.add("lobby-avatar");
    const name = document.createElement("strong");
    name.textContent = player.nickname;
    tile.append(avatar, name);

    if (player.id === state.hostId) {
      const adminDot = document.createElement("div");
      adminDot.className = "admin-dot";
      adminDot.textContent = "A";
      tile.append(adminDot);
    }

    tile.addEventListener("click", () => {
      modalPlayerName.textContent = player.nickname;
      modalPlayerStats.innerHTML = "";
      for (const key of cardKeys) {
        const line = document.createElement("div");
        line.className = "prop-line";
        const label = document.createElement("div");
        label.className = "prop-label";
        label.textContent = `${labelIcons[key] || ""} ${labels[key]}`;
        const value = document.createElement("div");
        value.className = "prop-value";
        value.textContent = player[key] || "Закрыто";
        if (!player[key]) value.classList.add("locked");
        line.append(label, value);
        modalPlayerStats.append(line);
      }
      playerModal.classList.remove("hidden");
    });

    tile.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (state.meId !== state.hostId) return;
      if (!player.isAlive) {
        socket.emit("host:revive-player", player.id);
        return;
      }
      if (player.id === state.hostId) return;
      socket.emit("host:transfer", player.id);
    });

    lobbyPlayers.append(tile);
    addAdminPlayerActions(state, tile, player);
  }
}

function renderWorld(state) {
  worldInfo.innerHTML = "";
  if (!state.world) {
    worldInfo.innerHTML = "<div class='locked'>Локация появится после старта мира.</div>";
    return;
  }
  const lines = [
    { label: "Локация", value: state.world.location },
    { label: "Наполнение", value: state.world.supplies },
    { label: "Апокалипсис", value: state.world.apocalypse }
  ];
  for (const item of lines) {
    const line = document.createElement("div");
    line.className = "world-item";
    const label = document.createElement("div");
    label.className = "world-label";
    label.textContent = item.label;
    const value = document.createElement("div");
    value.className = "world-value";
    value.textContent = item.value;
    line.append(label, value);
    worldInfo.append(line);
  }
}

function renderMyCard(state) {
  const me = state.players.find((player) => player.id === state.meId);
  if (!myCardData || !me) return;

  myCard.innerHTML = "";
  const playerState = {
    isMyTurn:
      state.currentSpeakerId === state.meId &&
      state.phase === "in_game" &&
      state.roundMode === "reveal",
    revealed: me.revealed || {},
    canUndoUntil: me.canUndoUntil || {}
  };

  for (const key of cardKeys) {
    if (key === "profession") continue;
    const item = createCardItem(key, myCardData[key], playerState);
    if (state.lastReveal?.playerId === state.meId && state.lastReveal?.propertyName === key) {
      item.classList.add("reveal-highlight");
    }
    myCard.append(item);
  }
}

function renderTable(state) {
  playersTable.innerHTML = "";
  const voteCounts = {};
  if (state.voting?.votes) {
    for (const targetId of Object.values(state.voting.votes)) {
      voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    }
  }
  const myVoteTarget = state.voting?.votes?.[state.meId] || null;
  const myVotePlayer = state.players.find((player) => player.id === myVoteTarget);
  voteInfo.textContent =
    state.phase === "voting" && myVotePlayer ? `Ваш голос против ${myVotePlayer.nickname} засчитан` : "";

  for (const player of state.players) {
    const row = document.createElement("div");
    row.className = "player-row";
    if (!player.isAlive) row.classList.add("eliminated");
    if (player.id === state.currentSpeakerId) row.classList.add("speaking");

    const title = document.createElement("h3");
    title.textContent = player.nickname;

    const usedAction = getPlayerLastAction(state, player.nickname);
    if (usedAction) {
      const usedBox = document.createElement("div");
      usedBox.className = "player-action-used";
      usedBox.textContent = `⚡ Действие: «${usedAction.actionTitle}»${
        usedAction.targetName ? ` → ${usedAction.targetName}` : ""
      }`;
      row.append(title, usedBox);
    } else {
      row.append(title);
    }

    const props = document.createElement("ul");
    props.className = "props props-bullets";
    for (const key of cardKeys) {
      const line = document.createElement("li");
      line.className = "prop-line";
      const label = document.createElement("div");
      label.className = "prop-label";
      label.textContent = `${labelIcons[key] || ""} ${labels[key]}`;
      const value = document.createElement("div");
      value.className = "prop-value";
      value.textContent = player[key] || "Закрыто";
      if (!player[key]) value.classList.add("locked");
      if (state.lastReveal?.playerId === player.id && state.lastReveal?.propertyName === key) {
        line.classList.add("reveal-highlight");
      }
      line.append(label, value);
      props.append(line);
    }

    const statuses = document.createElement("ul");
    statuses.className = "props props-bullets status-bullets";
    const statusItems = [
      `Действие: ${player.actionUsed ? "использовано" : "готово"}`,
      `Молчание: ${player.mutedForCircle ? "до конца круга" : "нет"}`,
      `Бонусы раскрытия: ${player.bonusRevealCredits || 0}`,
      `Голосов против: ${voteCounts[player.id] || 0}`
    ];
    for (const text of statusItems) {
      const item = document.createElement("li");
      item.className = "status-line hint";
      item.textContent = text;
      statuses.append(item);
    }

    row.append(props, statuses);
    addAdminPlayerActions(state, row, player);

    if (state.phase === "voting" && state.meId !== player.id && player.isAlive) {
      const voteBtn = document.createElement("button");
      voteBtn.textContent = "Голосовать против";
      voteBtn.addEventListener("click", () => socket.emit("vote:cast", player.id));
      row.append(voteBtn);
    }

    playersTable.append(row);
  }
}

joinBtn.addEventListener("click", () => {
  const nickname = nicknameInput.value.trim();
  const avatarUrl = avatarUrlInput.value.trim();
  joinError.textContent = "";
  socket.emit("join", { nickname, avatarUrl });
});

nicknameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinBtn.click();
});

socket.on("join:error", (message) => {
  joinError.textContent = message;
});

socket.on("action:error", (message) => {
  joinError.textContent = message;
});

socket.on("card:private", (card) => {
  myCardData = card;
  if (!joined) {
    joined = true;
    joinSection.classList.add("hidden");
    gameSection.classList.remove("hidden");
  }
});

socket.on("action:private", (actionCard) => {
  myActionData = actionCard;
});

socket.on("state:update", (state) => {
  lastState = state;
  if (!joined) {
    joined = true;
    joinSection.classList.add("hidden");
    gameSection.classList.remove("hidden");
  }

  const isHost = state.meId === state.hostId;
  hostControls.classList.toggle("hidden", !isHost);
  if (!isHost) {
    hostControls.querySelectorAll("button").forEach((btn) => btn.classList.add("hidden"));
  } else {
    hostControls.querySelectorAll("button").forEach((btn) => btn.classList.remove("hidden"));
  }
  claimHostBtn.classList.toggle("hidden", isHost || Boolean(state.hostId));
  if (adminLobbyHint) adminLobbyHint.classList.toggle("hidden", !isHost);
  renderRevivePanel(state);
  renderPackChips(state);

  circleStatus.textContent = state.circleStatus || "";

  const isDiscussion = state.roundMode === "discussion" || state.phase === "voting";
  const speaker = state.players.find((player) => player.id === state.currentSpeakerId);

  if (isDiscussion) {
    turnLabel.textContent = "Обсуждение";
    turnInfo.textContent = speaker ? speaker.nickname : "Все";
    turnOpenLabel.textContent = "Статус";
    turnOpenInfo.textContent = "Готовимся к исключению игроков";
  } else {
    turnLabel.textContent = "Сейчас говорит";
    turnInfo.textContent = speaker ? speaker.nickname : "Ожидание";
    turnOpenLabel.textContent = "Открыто в этом ходу";
    const requiredOpenCount = speaker
      ? speaker.mutedForCircle
        ? 0
        : 1 + (speaker.bonusRevealCredits || 0)
      : 0;
    turnOpenInfo.textContent = speaker ? `${state.turnRevealCount} из ${requiredOpenCount}` : "";
  }

  if (speaker && !isDiscussion) {
    const effects = [];
    if (speaker.mutedForCircle) effects.push("молчит до конца круга");
    if (speaker.bonusRevealCredits > 0) effects.push("должен открыть +1 характеристику");
    if (speaker.mustForgetProperty) effects.push("должен забыть одну открытую характеристику");
    effectInfo.textContent = effects.length ? `Эффекты хода: ${effects.join("; ")}` : "";
  } else {
    effectInfo.textContent = "";
  }

  if (state.lastPublicAction) {
    const a = state.lastPublicAction;
    publicActionInfo.textContent = `Последнее: ${formatActionLine(a)}`;
    if (a.at && a.at !== lastActionAt) {
      lastActionAt = a.at;
      showActionBanner(a);
    }
  } else {
    publicActionInfo.textContent = "";
  }

  renderActionLog(state);

  if (lastSpeakerId && state.currentSpeakerId && state.currentSpeakerId !== lastSpeakerId) {
    playTurnClick();
  }
  if (lastPhase && lastPhase !== "voting" && state.phase === "voting") {
    playVotingStart();
  }
  lastSpeakerId = state.currentSpeakerId;
  lastPhase = state.phase;

  renderLobbyPlayers(state);
  renderWorld(state);
  renderActionCard(state);
  const mePlayer = state.players.find((p) => p.id === state.meId);
  if (mePlayer) renderForgetPicker(state, mePlayer);
  renderMyCard(state);
  renderTable(state);
  updateLiveCounters();
});

startGameBtn.addEventListener("click", () => {
  socket.emit("host:set-packs", draftPacks);
  socket.emit("host:start-game");
});
startVotingBtn.addEventListener("click", () => socket.emit("host:start-voting"));
modeRevealBtn.addEventListener("click", () => socket.emit("host:set-round-mode", "reveal"));
modeDiscussionBtn.addEventListener("click", () => socket.emit("host:set-round-mode", "discussion"));
nextTurnBtn.addEventListener("click", () => socket.emit("turn:next"));
restartBtn.addEventListener("click", () => socket.emit("host:restart"));
claimHostBtn.addEventListener("click", () => socket.emit("host:claim"));
closeModalBtn.addEventListener("click", () => playerModal.classList.add("hidden"));
playerModal.addEventListener("click", (event) => {
  if (event.target === playerModal) playerModal.classList.add("hidden");
});

document.querySelectorAll(".timer-btn").forEach((btn) => {
  btn.addEventListener("click", () => socket.emit("host:start-timer", Number(btn.dataset.seconds)));
});

if (!timerTicker) {
  timerTicker = setInterval(updateLiveCounters, 300);
}
