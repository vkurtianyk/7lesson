const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');

const PORT = 3000;
const MAX_POINTS = 1000;
const LAN_IP = Object.values(os.networkInterfaces()).flat()
  .find((n) => n.family === 'IPv4' && !n.internal)?.address;
if (!LAN_IP) throw new Error('No network connection found. Connect this computer to the classroom Wi-Fi.');
const JOIN_URL = `http://${LAN_IP}:${PORT}`;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

// pin -> game
const games = new Map();

// Throws a readable error if the uploaded quiz is not in the expected format.
function validateQuiz(quiz) {
  if (typeof quiz !== 'object' || quiz === null) throw new Error('Quiz must be a JSON object');
  if (typeof quiz.title !== 'string' || !quiz.title.trim()) throw new Error('"title" must be a non-empty string');
  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) throw new Error('"questions" must be a non-empty array');
  quiz.questions.forEach((q, i) => {
    const n = `Question ${i + 1}`;
    if (typeof q.question !== 'string' || !q.question.trim()) throw new Error(`${n}: "question" must be a non-empty string`);
    if (!Array.isArray(q.answers) || q.answers.length < 2 || q.answers.length > 4) throw new Error(`${n}: "answers" must have 2 to 4 items`);
    if (!q.answers.every((a) => typeof a === 'string' && a.trim())) throw new Error(`${n}: every answer must be a non-empty string`);
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.answers.length) throw new Error(`${n}: "correct" must be the index (0-${q.answers.length - 1}) of the right answer`);
    if (!Number.isInteger(q.time) || q.time < 5 || q.time > 120) throw new Error(`${n}: "time" must be whole seconds between 5 and 120`);
  });
}

function newPin() {
  let pin;
  do pin = String(Math.floor(100000 + Math.random() * 900000));
  while (games.has(pin));
  return pin;
}

function leaderboard(game) {
  return [...game.players.values()]
    .map((p) => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function sendPlayers(game) {
  io.to(game.hostId).emit('players', [...game.players.values()].map((p) => p.name));
}

function startQuestion(game) {
  const q = game.quiz.questions[game.index];
  game.answers = new Map(); // socketId -> { choice, ms }
  game.startedAt = Date.now();
  game.open = true;
  const payload = {
    index: game.index,
    total: game.quiz.questions.length,
    question: q.question,
    answers: q.answers,
    time: q.time,
  };
  io.to(game.pin).emit('question', payload);
  game.timer = setTimeout(() => endQuestion(game), q.time * 1000);
}

function endQuestion(game) {
  if (!game.open) return;
  game.open = false;
  clearTimeout(game.timer);
  const q = game.quiz.questions[game.index];
  for (const [id, player] of game.players) {
    const a = game.answers.get(id);
    const correct = a !== undefined && a.choice === q.correct;
    // Correct answers earn 500..1000 points, faster answers earn more.
    const points = correct ? Math.round(MAX_POINTS * (1 - a.ms / (q.time * 1000) / 2)) : 0;
    player.score += points;
    io.to(id).emit('result', { correct, points, score: player.score });
  }
  const counts = q.answers.map((_, i) => [...game.answers.values()].filter((a) => a.choice === i).length);
  const isLast = game.index === game.quiz.questions.length - 1;
  io.to(game.hostId).emit('reveal', { correct: q.correct, counts, leaderboard: leaderboard(game), isLast });
}

io.on('connection', (socket) => {
  socket.on('host:create', (quiz, reply) => {
    try {
      validateQuiz(quiz);
    } catch (err) {
      return reply({ error: err.message });
    }
    const pin = newPin();
    games.set(pin, { pin, hostId: socket.id, quiz, players: new Map(), index: -1, timer: null, open: false });
    socket.data.hostPin = pin;
    socket.join(pin);
    reply({ pin, joinUrl: JOIN_URL });
  });

  socket.on('host:next', () => {
    const game = games.get(socket.data.hostPin);
    if (!game || game.open) return;
    game.index += 1;
    if (game.index < game.quiz.questions.length) return startQuestion(game);
    const board = leaderboard(game);
    io.to(game.pin).emit('gameover', board);
  });

  socket.on('host:skip', () => {
    const game = games.get(socket.data.hostPin);
    if (game) endQuestion(game);
  });

  socket.on('player:join', ({ pin, name }, reply) => {
    const game = games.get(String(pin).trim());
    if (!game) return reply({ error: 'Game not found. Check the PIN.' });
    if (game.index !== -1) return reply({ error: 'This game has already started.' });
    const clean = String(name || '').trim().slice(0, 20);
    if (!clean) return reply({ error: 'Please enter a nickname.' });
    if ([...game.players.values()].some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      return reply({ error: 'This nickname is taken. Choose another.' });
    }
    game.players.set(socket.id, { name: clean, score: 0 });
    socket.data.playerPin = game.pin;
    socket.join(game.pin);
    sendPlayers(game);
    reply({ name: clean, title: game.quiz.title });
  });

  socket.on('player:answer', (choice) => {
    const game = games.get(socket.data.playerPin);
    if (!game || !game.open || !game.players.has(socket.id) || game.answers.has(socket.id)) return;
    if (!Number.isInteger(choice)) return;
    game.answers.set(socket.id, { choice, ms: Date.now() - game.startedAt });
    io.to(game.hostId).emit('answered', game.answers.size);
    if (game.answers.size === game.players.size) endQuestion(game);
  });

  socket.on('disconnect', () => {
    if (socket.data.hostPin) {
      const game = games.get(socket.data.hostPin);
      clearTimeout(game.timer);
      io.to(game.pin).emit('ended');
      games.delete(game.pin);
    }
    if (socket.data.playerPin) {
      const game = games.get(socket.data.playerPin);
      if (!game) return;
      game.players.delete(socket.id);
      sendPlayers(game);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Teacher: http://localhost:${PORT}/host.html`);
  console.log(`Students: ${JOIN_URL}`);
});
