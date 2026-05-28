const socket = io();

const labels = {
  profession: "Профессия",
  health: "Здоровье",
  bio: "Биологические данные",
  hobby: "Хобби",
  phobia: "Фобии",
  extra: "Доп. навыки / багаж",
  traits: "Личные качества"
};

const cardKeys = Object.keys(labels);

const joinSection = document.getElementById("joinSection");
const gameSection = document.getElementById("gameSection");
const nicknameInput = document.getElementById("nickname");
const joinBtn = document.getElementById("joinBtn");
const joinError = document.getElementById("joinError");
const myCard = document.getElementById("myCard");
const playersTable = document.getElementById("playersTable");

let joined = false;

function createCardItem(key, value) {
  const wrap = document.createElement("div");
  wrap.className = "card-item";

  const title = document.createElement("h3");
  title.textContent = labels[key];

  const text = document.createElement("p");
  text.textContent = value;

  const button = document.createElement("button");
  button.textContent = "Открыть";
  button.addEventListener("click", () => {
    socket.emit("reveal:property", key);
    button.disabled = true;
    button.textContent = "Открыто";
  });

  wrap.append(title, text, button);
  return wrap;
}

joinBtn.addEventListener("click", () => {
  const nickname = nicknameInput.value.trim();
  joinError.textContent = "";
  socket.emit("join", nickname);
});

nicknameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinBtn.click();
  }
});

socket.on("join:error", (message) => {
  joinError.textContent = message;
});

socket.on("card:private", (card) => {
  joined = true;
  joinSection.classList.add("hidden");
  gameSection.classList.remove("hidden");
  myCard.innerHTML = "";

  for (const key of cardKeys) {
    myCard.appendChild(createCardItem(key, card[key]));
  }
});

socket.on("players:update", (players) => {
  if (!joined) return;

  playersTable.innerHTML = "";
  for (const player of players) {
    const row = document.createElement("div");
    row.className = "player-row";

    const title = document.createElement("h3");
    title.textContent = player.nickname;

    const props = document.createElement("div");
    props.className = "props";

    for (const key of cardKeys) {
      const line = document.createElement("div");
      const value = player[key] || "Закрыто";
      if (!player[key]) line.className = "locked";
      line.textContent = `${labels[key]}: ${value}`;
      props.appendChild(line);
    }

    row.append(title, props);
    playersTable.appendChild(row);
  }
});
