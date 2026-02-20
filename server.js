const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DAY_DURATION_MS = 3 * 60 * 1000;

const NIGHT_ORDER = ['werewolf', 'seer', 'robber', 'troublemaker', 'drunk', 'insomniac'];

const ROLE_LABELS = {
  villager: '마을주민',
  werewolf: '늑대인간',
  seer: '예언자',
  robber: '강도',
  troublemaker: '말썽쟁이',
  drunk: '주정뱅이',
  insomniac: '불면증환자'
};

const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function buildDeck(playerCount) {
  const total = playerCount + 3;
  const deck = ['werewolf', 'werewolf'];
  const specials = ['seer', 'robber', 'troublemaker', 'drunk', 'insomniac'];

  for (const role of specials) {
    if (deck.length < total) {
      deck.push(role);
    }
  }

  while (deck.length < total) {
    deck.push('villager');
  }

  return deck;
}

function createRoom(hostSocket, hostName) {
  let code = makeRoomCode();
  while (rooms.has(code)) {
    code = makeRoomCode();
  }

  const player = {
    id: hostSocket.id,
    name: hostName,
    connected: true,
    originalRole: null,
    currentRole: null,
    voteTarget: null
  };

  const room = {
    code,
    hostId: hostSocket.id,
    state: 'lobby',
    players: [player],
    center: [],
    activeRole: null,
    actedBy: new Set(),
    nightActions: {},
    privateNotes: {},
    dayEndsAt: null,
    result: null,
    createdAt: Date.now()
  };

  rooms.set(code, room);
  hostSocket.join(code);
  return room;
}

function findRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.id === socketId)) {
      return room;
    }
  }
  return null;
}

function getPlayer(room, socketId) {
  return room.players.find((p) => p.id === socketId) || null;
}

function pushNote(room, playerId, message) {
  if (!room.privateNotes[playerId]) {
    room.privateNotes[playerId] = [];
  }
  room.privateNotes[playerId].push(message);
}

function resetPrivateNotes(room) {
  room.privateNotes = {};
  for (const p of room.players) {
    room.privateNotes[p.id] = [];
  }
}

function isHost(room, socketId) {
  return room.hostId === socketId;
}

function activePlayersForRole(room, role) {
  return room.players.filter((p) => p.originalRole === role);
}

function getInstruction(role, room, player) {
  if (!role || !player || player.originalRole !== role) {
    return null;
  }

  if (role === 'werewolf') {
    const wolves = activePlayersForRole(room, 'werewolf');
    if (wolves.length === 1) {
      return 'You are the lone werewolf. Pick one center card (0,1,2) to view.';
    }
    return 'Confirm when ready. You and the other werewolf can see each other.';
  }

  if (role === 'seer') {
    return 'Choose one player to view OR choose two center indices.';
  }

  if (role === 'robber') {
    return 'Choose one player to swap with. You will see your new role.';
  }

  if (role === 'troublemaker') {
    return 'Choose two other players to swap their cards.';
  }

  if (role === 'drunk') {
    return 'Choose one center index (0,1,2) to swap with your card.';
  }

  return null;
}

function startDay(room) {
  room.state = 'day';
  room.activeRole = null;
  room.actedBy = new Set();
  room.dayEndsAt = Date.now() + DAY_DURATION_MS;
}

function startVote(room) {
  room.state = 'vote';
  room.activeRole = null;
  room.actedBy = new Set();
  room.dayEndsAt = null;
  for (const p of room.players) {
    p.voteTarget = null;
  }
}

function revealResult(room) {
  room.state = 'reveal';

  const counts = {};
  for (const p of room.players) {
    if (!p.voteTarget) {
      continue;
    }
    counts[p.voteTarget] = (counts[p.voteTarget] || 0) + 1;
  }

  let maxVotes = 0;
  for (const count of Object.values(counts)) {
    if (count > maxVotes) {
      maxVotes = count;
    }
  }

  const eliminatedIds = maxVotes === 0
    ? []
    : Object.entries(counts)
      .filter(([, count]) => count === maxVotes)
      .map(([playerId]) => playerId);

  const werewolfIds = room.players
    .filter((p) => p.currentRole === 'werewolf')
    .map((p) => p.id);

  let villageWin;
  if (werewolfIds.length === 0) {
    villageWin = eliminatedIds.length > 0;
  } else {
    villageWin = eliminatedIds.some((id) => werewolfIds.includes(id));
  }

  room.result = {
    votes: counts,
    maxVotes,
    eliminatedIds,
    winner: villageWin ? 'village' : 'werewolves'
  };
}

function advanceNight(room) {
  for (const role of NIGHT_ORDER) {
    if (room.nightActions[role] === '__done__') {
      continue;
    }

    const rolePlayers = activePlayersForRole(room, role);
    if (rolePlayers.length === 0) {
      room.nightActions[role] = '__done__';
      continue;
    }

    if (role === 'insomniac') {
      for (const p of rolePlayers) {
        pushNote(room, p.id, `Insomniac check: your current role is ${ROLE_LABELS[p.currentRole]}.`);
      }
      room.nightActions[role] = '__done__';
      continue;
    }

    room.activeRole = role;
    room.actedBy = new Set();

    if (role === 'werewolf') {
      const wolves = rolePlayers;
      if (wolves.length === 1) {
        pushNote(room, wolves[0].id, 'You are the only werewolf in play.');
      } else {
        for (const wolf of wolves) {
          const partner = wolves.find((w) => w.id !== wolf.id);
          pushNote(room, wolf.id, `Other werewolf: ${partner.name}.`);
        }
      }
    }

    return;
  }

  startDay(room);
}

function startGame(room) {
  const deck = shuffle(buildDeck(room.players.length));
  const players = shuffle(room.players);

  for (let i = 0; i < players.length; i += 1) {
    players[i].originalRole = deck[i];
    players[i].currentRole = deck[i];
    players[i].voteTarget = null;
  }

  room.center = deck.slice(players.length);
  room.state = 'night';
  room.result = null;
  room.dayEndsAt = null;
  room.activeRole = null;
  room.actedBy = new Set();
  room.nightActions = {};
  resetPrivateNotes(room);

  advanceNight(room);
}

function isValidCenterIndex(index) {
  return Number.isInteger(index) && index >= 0 && index <= 2;
}

function handleNightAction(room, player, payload) {
  const role = room.activeRole;
  if (!role || player.originalRole !== role) {
    return { ok: false, error: 'Not your action window.' };
  }

  if (room.actedBy.has(player.id)) {
    return { ok: false, error: 'Action already submitted.' };
  }

  if (role === 'werewolf') {
    const wolves = activePlayersForRole(room, 'werewolf');
    if (wolves.length === 1) {
      if (!isValidCenterIndex(payload.centerIndex)) {
        return { ok: false, error: 'Invalid center index.' };
      }
      const roleSeen = room.center[payload.centerIndex];
      pushNote(room, player.id, `You viewed center[${payload.centerIndex}]: ${ROLE_LABELS[roleSeen]}.`);
    }

    room.actedBy.add(player.id);
  }

  if (role === 'seer') {
    if (payload.mode === 'player') {
      const target = room.players.find((p) => p.id === payload.targetId && p.id !== player.id);
      if (!target) {
        return { ok: false, error: 'Invalid target player.' };
      }
      pushNote(room, player.id, `You viewed ${target.name}: ${ROLE_LABELS[target.currentRole]}.`);
    } else if (payload.mode === 'center') {
      const indices = Array.isArray(payload.indices) ? payload.indices : [];
      if (indices.length !== 2 || !isValidCenterIndex(indices[0]) || !isValidCenterIndex(indices[1]) || indices[0] === indices[1]) {
        return { ok: false, error: 'Choose two different center indices.' };
      }
      pushNote(room, player.id, `You viewed center[${indices[0]}]: ${ROLE_LABELS[room.center[indices[0]]]} and center[${indices[1]}]: ${ROLE_LABELS[room.center[indices[1]]]}.`);
    } else {
      return { ok: false, error: 'Invalid seer action.' };
    }

    room.actedBy.add(player.id);
  }

  if (role === 'robber') {
    const target = room.players.find((p) => p.id === payload.targetId && p.id !== player.id);
    if (!target) {
      return { ok: false, error: 'Invalid target player.' };
    }

    const old = player.currentRole;
    player.currentRole = target.currentRole;
    target.currentRole = old;

    pushNote(room, player.id, `You robbed ${target.name}. Your new role is ${ROLE_LABELS[player.currentRole]}.`);
    room.actedBy.add(player.id);
  }

  if (role === 'troublemaker') {
    const targetA = room.players.find((p) => p.id === payload.targetA && p.id !== player.id);
    const targetB = room.players.find((p) => p.id === payload.targetB && p.id !== player.id);
    if (!targetA || !targetB || targetA.id === targetB.id) {
      return { ok: false, error: 'Pick two different target players.' };
    }

    const old = targetA.currentRole;
    targetA.currentRole = targetB.currentRole;
    targetB.currentRole = old;

    pushNote(room, player.id, `You swapped ${targetA.name} and ${targetB.name}.`);
    room.actedBy.add(player.id);
  }

  if (role === 'drunk') {
    if (!isValidCenterIndex(payload.centerIndex)) {
      return { ok: false, error: 'Invalid center index.' };
    }

    const old = player.currentRole;
    player.currentRole = room.center[payload.centerIndex];
    room.center[payload.centerIndex] = old;

    pushNote(room, player.id, `You swapped with center[${payload.centerIndex}]. You do not see your new role.`);
    room.actedBy.add(player.id);
  }

  const requiredPlayers = activePlayersForRole(room, role);
  if (requiredPlayers.every((p) => room.actedBy.has(p.id))) {
    room.nightActions[role] = '__done__';
    room.activeRole = null;
    room.actedBy = new Set();
    advanceNight(room);
  }

  return { ok: true };
}

function buildClientState(room, socketId) {
  const me = getPlayer(room, socketId);
  const players = room.players.map((p) => ({
    id: p.id,
    name: p.name,
    connected: p.connected,
    isHost: p.id === room.hostId,
    voteTarget: room.state === 'reveal' ? p.voteTarget : undefined,
    originalRole: room.state === 'reveal' ? p.originalRole : undefined,
    currentRole: room.state === 'reveal' ? p.currentRole : undefined
  }));

  return {
    code: room.code,
    state: room.state,
    hostId: room.hostId,
    players,
    me: me
      ? {
        id: me.id,
        name: me.name,
        originalRole: me.originalRole,
        currentRole: room.state === 'reveal' ? me.currentRole : undefined,
        voteTarget: me.voteTarget
      }
      : null,
    centerCount: 3,
    center: room.state === 'reveal' ? room.center : null,
    activeRole: room.activeRole,
    instruction: getInstruction(room.activeRole, room, me),
    notes: room.privateNotes[socketId] || [],
    dayEndsAt: room.dayEndsAt,
    result: room.result,
    roleLabels: ROLE_LABELS
  };
}

function emitRoom(room) {
  for (const p of room.players) {
    io.to(p.id).emit('state', buildClientState(room, p.id));
  }
}

function removePlayerFromRoom(room, socketId) {
  const index = room.players.findIndex((p) => p.id === socketId);
  if (index === -1) {
    return;
  }

  room.players.splice(index, 1);

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  if (room.hostId === socketId) {
    room.hostId = room.players[0].id;
  }

  if (room.state !== 'lobby' && room.players.length < 3) {
    room.state = 'lobby';
    room.activeRole = null;
    room.dayEndsAt = null;
    room.result = null;
  }
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ name }) => {
    const safeName = String(name || '').trim().slice(0, 24);
    if (!safeName) {
      socket.emit('error_message', 'Name is required.');
      return;
    }

    const room = createRoom(socket, safeName);
    emitRoom(room);
  });

  socket.on('join_room', ({ code, name }) => {
    const safeName = String(name || '').trim().slice(0, 24);
    const safeCode = String(code || '').trim().toUpperCase();

    if (!safeName || !safeCode) {
      socket.emit('error_message', 'Code and name are required.');
      return;
    }

    const room = rooms.get(safeCode);
    if (!room) {
      socket.emit('error_message', 'Room not found.');
      return;
    }

    if (room.state !== 'lobby') {
      socket.emit('error_message', 'Game already started.');
      return;
    }

    if (room.players.length >= 10) {
      socket.emit('error_message', 'Room is full.');
      return;
    }

    room.players.push({
      id: socket.id,
      name: safeName,
      connected: true,
      originalRole: null,
      currentRole: null,
      voteTarget: null
    });

    socket.join(room.code);
    emitRoom(room);
  });

  socket.on('start_game', () => {
    const room = findRoomBySocket(socket.id);
    if (!room) {
      return;
    }

    if (!isHost(room, socket.id)) {
      socket.emit('error_message', 'Only host can start the game.');
      return;
    }

    if (room.players.length < 3) {
      socket.emit('error_message', 'Need at least 3 players.');
      return;
    }

    if (room.state !== 'lobby' && room.state !== 'reveal') {
      socket.emit('error_message', 'Cannot start now.');
      return;
    }

    startGame(room);
    emitRoom(room);
  });

  socket.on('night_action', (payload) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.state !== 'night') {
      return;
    }

    const player = getPlayer(room, socket.id);
    if (!player) {
      return;
    }

    const result = handleNightAction(room, player, payload || {});
    if (!result.ok) {
      socket.emit('error_message', result.error);
      return;
    }

    emitRoom(room);
  });

  socket.on('start_vote', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.state !== 'day') {
      return;
    }

    if (!isHost(room, socket.id)) {
      socket.emit('error_message', 'Only host can start vote.');
      return;
    }

    startVote(room);
    emitRoom(room);
  });

  socket.on('cast_vote', ({ targetId }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.state !== 'vote') {
      return;
    }

    const voter = getPlayer(room, socket.id);
    const target = getPlayer(room, targetId);
    if (!voter || !target) {
      socket.emit('error_message', 'Invalid vote target.');
      return;
    }

    voter.voteTarget = targetId;

    const everyoneVoted = room.players.every((p) => !!p.voteTarget);
    if (everyoneVoted) {
      revealResult(room);
    }

    emitRoom(room);
  });

  socket.on('force_reveal', () => {
    const room = findRoomBySocket(socket.id);
    if (!room) {
      return;
    }

    if (!isHost(room, socket.id)) {
      socket.emit('error_message', 'Only host can do this.');
      return;
    }

    if (room.state !== 'vote') {
      socket.emit('error_message', 'Reveal is only available during vote.');
      return;
    }

    revealResult(room);
    emitRoom(room);
  });

  socket.on('disconnect', () => {
    const room = findRoomBySocket(socket.id);
    if (!room) {
      return;
    }

    removePlayerFromRoom(room, socket.id);
    if (rooms.has(room.code)) {
      emitRoom(room);
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.state === 'day' && room.dayEndsAt && now >= room.dayEndsAt) {
      startVote(room);
      emitRoom(room);
    }
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`ONUW MVP server listening on http://localhost:${PORT}`);
});
