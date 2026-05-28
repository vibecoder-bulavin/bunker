# Online Drochiknya Bunker

Онлайн-версия игры «Бункер»: лобби, карточки, голосование, действия.

## Запуск локально

- Открой Terminal на Mac
- Перейди в папку проекта: `cd ~/Desktop/Bunker`
- Установи зависимости (один раз): `npm install`
- Запусти сервер: `npm start`
- Открой в браузере: [http://localhost:3000](http://localhost:3000)
- Если порт занят: `PORT=3001 npm start` → [http://localhost:3001](http://localhost:3001)
- Для теста с несколькими игроками открой 2–3 вкладки с разными никами

## Запуск в интернете (Render)

- Зайди на [render.com](https://render.com) и войди через GitHub
- Нажми **New → Web Service**
- Выбери репозиторий `vibecoder-bulavin/bunker`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- Нажми **Create Web Service**
- Через 1–3 минуты получишь URL вида `https://bunker-xxxx.onrender.com` — это живой линк для игроков

## Репозиторий

- GitHub: [https://github.com/vibecoder-bulavin/bunker](https://github.com/vibecoder-bulavin/bunker)
