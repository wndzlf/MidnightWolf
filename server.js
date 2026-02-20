const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DAY_DURATION_MS = 3 * 60 * 1000;
const ROUND_DURATION_MS = 8 * 60 * 1000;
const NIGHT_ROLE_DURATION_MS = 15 * 1000;
const EMOTE_DURATION_MS = 5 * 1000;
const DISCONNECT_TTL_MS = 10 * 60 * 1000;

const NIGHT_ORDER = ['doppelganger', 'werewolf', 'minion', 'mason', 'seer', 'robber', 'troublemaker', 'drunk', 'insomniac'];
const ROLE_COUNTS = {
  villager: 3,
  werewolf: 2,
  seer: 1,
  robber: 1,
  troublemaker: 1,
  drunk: 1,
  insomniac: 1,
  doppelganger: 1,
  minion: 1,
  mason: 2,
  hunter: 1
};

const ROLE_LABELS = {
  villager: '마을주민',
  werewolf: '늑대인간',
  seer: '예언자',
  robber: '강도',
  troublemaker: '말썽쟁이',
  drunk: '주정뱅이',
  insomniac: '불면증환자',
  doppelganger: '도플갱어',
  minion: '하수인',
  mason: '프리메이슨',
  hunter: '사냥꾼'
};
const ALLOWED_EMOTES = ['❗', '😡', '🤯', '🤣', '🤔', '👍', '👀'];
const CLAIM_REACTIONS = ['like', 'dislike'];

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
  const n = Math.floor(Math.random() * 100);
  return String(n).padStart(2, '0');
}

function buildMasterDeck() {
  const deck = [];
  for (const [role, count] of Object.entries(ROLE_COUNTS)) {
    for (let i = 0; i < count; i += 1) {
      deck.push(role);
    }
  }
  return deck;
}

function pickCardsForRound(playerCount) {
  const total = playerCount + 3;
  return shuffle(buildMasterDeck()).slice(0, total);
}

function buildCatalogCardsFromDeck(deck) {
  const counts = {};
  for (const role of deck || []) {
    counts[role] = (counts[role] || 0) + 1;
  }
  return Object.entries(counts).map(([role, count]) => ({
    role,
    count,
    label: ROLE_LABELS[role]
  }));
}

function buildAvailableRoleCards() {
  return Object.entries(ROLE_COUNTS).map(([role, count]) => ({
    role,
    count,
    label: ROLE_LABELS[role]
  }));
}

function isValidRoundDeck(deck, playerCount) {
  if (!Array.isArray(deck) || deck.length !== playerCount + 3) {
    return false;
  }
  const counts = {};
  for (const role of deck) {
    if (!ROLE_COUNTS[role]) {
      return false;
    }
    counts[role] = (counts[role] || 0) + 1;
    if (counts[role] > ROLE_COUNTS[role]) {
      return false;
    }
  }
  return true;
}

function refreshRoomDeck(room) {
  room.roundDeck = pickCardsForRound(room.players.length);
  room.deckLocked = false;
}

function createRoom(hostSocket, hostName) {
  if (rooms.size >= 100) {
    throw new Error('room_capacity_exceeded');
  }

  let code = makeRoomCode();
  let guard = 0;
  while (rooms.has(code) && guard < 200) {
    code = makeRoomCode();
    guard += 1;
  }

  if (rooms.has(code)) {
    throw new Error('room_code_exhausted');
  }

  const player = {
    id: hostSocket.id,
    playerKey: hostSocket.id,
    name: hostName,
    connected: true,
    disconnectedAt: null,
    originalRole: null,
    currentRole: null,
    voteTarget: null,
    doppelRole: null,
    claimRole: null,
    emote: null,
    emoteAt: null
  };

  const room = {
    code,
    hostId: hostSocket.id,
    state: 'lobby',
    players: [player],
    center: [],
    activeRole: null,
    roleEndsAt: null,
    nightIndex: 0,
    actedBy: new Set(),
    nightActions: {},
    privateNotes: {},
    dayEndsAt: null,
    roundEndsAt: null,
    roundDeck: [],
    deckLocked: false,
    claimReactions: {},
    claimAssignments: {},
    result: null,
    createdAt: Date.now()
  };

  refreshRoomDeck(room);

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

function getPlayerByKey(room, playerKey) {
  return room.players.find((p) => p.playerKey === playerKey) || null;
}

function connectedPlayerCount(room) {
  return room.players.filter((p) => p.connected).length;
}

function latestClaimedRoleForTarget(room, targetId) {
  let latest = null;
  for (const claim of Object.values(room.claimAssignments || {})) {
    if (!claim || claim.targetId !== targetId || !ROLE_LABELS[claim.role]) {
      continue;
    }
    if (!latest || (claim.ts || 0) > (latest.ts || 0)) {
      latest = claim;
    }
  }
  return latest ? latest.role : null;
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
  return room.players.filter((p) => canActAsRole(p, role));
}

function canActAsRole(player, role) {
  if (player.originalRole === role) {
    return true;
  }
  return player.originalRole === 'doppelganger' && player.doppelRole === role;
}

function getInstruction(role, room, player) {
  if (!role || !player) {
    return null;
  }

  if (role === 'doppelganger' && player.originalRole === 'doppelganger') {
    return '다른 플레이어 1명을 선택해 그 역할을 복사하세요.';
  }

  if (!canActAsRole(player, role)) {
    return null;
  }

  if (role === 'werewolf') {
    const wolves = activePlayersForRole(room, 'werewolf');
    if (wolves.length === 1) {
      return '외로운 늑대입니다. 중앙 카드 1장을 확인하세요.';
    }
    return '늑대끼리 서로를 확인한 뒤 확인 버튼을 누르세요.';
  }

  if (role === 'minion') {
    return '늑대인간이 누구인지 확인한 뒤 확인 버튼을 누르세요.';
  }

  if (role === 'mason') {
    return '프리메이슨끼리 서로를 확인한 뒤 확인 버튼을 누르세요.';
  }

  if (role === 'seer') {
    return '플레이어 1명을 보거나, 중앙 카드 2장을 보세요.';
  }

  if (role === 'robber') {
    return '플레이어 1명과 카드를 바꾸고 새 역할을 확인하세요.';
  }

  if (role === 'troublemaker') {
    return '다른 플레이어 2명의 카드를 서로 바꾸세요.';
  }

  if (role === 'drunk') {
    return '중앙 카드 1장과 카드를 교환하세요. (결과는 비공개)';
  }

  return null;
}

function startDay(room) {
  room.state = 'day';
  room.activeRole = null;
  room.roleEndsAt = null;
  room.actedBy = new Set();
  room.dayEndsAt = Date.now() + DAY_DURATION_MS;
}

function startVote(room) {
  room.state = 'vote';
  room.activeRole = null;
  room.roleEndsAt = null;
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

  const finalEliminated = new Set(eliminatedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...finalEliminated]) {
      const player = room.players.find((p) => p.id === id);
      if (!player || player.currentRole !== 'hunter' || !player.voteTarget) {
        continue;
      }
      if (!finalEliminated.has(player.voteTarget)) {
        finalEliminated.add(player.voteTarget);
        changed = true;
      }
    }
  }

  const werewolfIds = room.players
    .filter((p) => p.currentRole === 'werewolf')
    .map((p) => p.id);
  const minionIds = room.players
    .filter((p) => p.currentRole === 'minion')
    .map((p) => p.id);

  let villageWin;
  if (werewolfIds.length === 0) {
    villageWin = minionIds.length > 0
      ? [...finalEliminated].some((id) => minionIds.includes(id))
      : finalEliminated.size > 0;
  } else {
    villageWin = [...finalEliminated].some((id) => werewolfIds.includes(id));
  }

  room.result = {
    votes: counts,
    maxVotes,
    eliminatedIds: [...finalEliminated],
    winner: villageWin ? 'village' : 'werewolves'
  };
}

function startNightRole(room, role) {
  room.activeRole = role;
  room.roleEndsAt = Date.now() + NIGHT_ROLE_DURATION_MS;
  room.actedBy = new Set();

  const rolePlayers = activePlayersForRole(room, role);

  if (role === 'werewolf') {
    const wolves = rolePlayers;
    if (wolves.length === 1) {
      pushNote(room, wolves[0].id, '이번 판의 유일한 늑대입니다.');
    } else {
      for (const wolf of wolves) {
        const partner = wolves.find((w) => w.id !== wolf.id);
        pushNote(room, wolf.id, `다른 늑대: ${partner.name}`);
      }
    }
  }

  if (role === 'minion') {
    const wolves = activePlayersForRole(room, 'werewolf');
    for (const minion of rolePlayers) {
      if (wolves.length === 0) {
        pushNote(room, minion.id, '이번 판에 늑대가 없습니다.');
      } else {
        pushNote(room, minion.id, `늑대 후보: ${wolves.map((w) => w.name).join(', ')}`);
      }
    }
  }

  if (role === 'mason') {
    for (const mason of rolePlayers) {
      const others = rolePlayers.filter((m) => m.id !== mason.id);
      if (others.length === 0) {
        pushNote(room, mason.id, '이번 판의 유일한 프리메이슨입니다.');
      } else {
        pushNote(room, mason.id, `다른 프리메이슨: ${others.map((m) => m.name).join(', ')}`);
      }
    }
  }

  if (role === 'insomniac') {
    for (const p of rolePlayers) {
      pushNote(room, p.id, `불면증환자 확인: 현재 내 역할은 ${ROLE_LABELS[p.currentRole]}입니다.`);
    }
  }
}

function advanceNight(room) {
  if (room.nightIndex >= NIGHT_ORDER.length) {
    startDay(room);
    return;
  }

  const role = NIGHT_ORDER[room.nightIndex];
  startNightRole(room, role);
}

function finishNightRole(room) {
  if (!room.activeRole) {
    return;
  }
  room.nightActions[room.activeRole] = '__done__';
  room.activeRole = null;
  room.roleEndsAt = null;
  room.actedBy = new Set();
  room.nightIndex += 1;
  advanceNight(room);
}

function startGame(room) {
  if (!Array.isArray(room.roundDeck) || room.roundDeck.length !== room.players.length + 3) {
    refreshRoomDeck(room);
  }
  const deck = shuffle(room.roundDeck);
  const players = shuffle(room.players);

  for (let i = 0; i < players.length; i += 1) {
    players[i].originalRole = deck[i];
    players[i].currentRole = deck[i];
    players[i].voteTarget = null;
    players[i].doppelRole = null;
    players[i].claimRole = null;
    players[i].emote = null;
    players[i].emoteAt = null;
  }

  room.center = deck.slice(players.length);
  room.state = 'night';
  room.result = null;
  room.claimReactions = {};
  room.claimAssignments = {};
  room.dayEndsAt = null;
  room.roundEndsAt = Date.now() + ROUND_DURATION_MS;
  room.roleEndsAt = null;
  room.activeRole = null;
  room.nightIndex = 0;
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
  if (!role || (role === 'doppelganger' ? player.originalRole !== 'doppelganger' : !canActAsRole(player, role))) {
    return { ok: false, error: '지금은 행동할 수 없는 시간입니다.' };
  }

  if (room.actedBy.has(player.id)) {
    return { ok: false, error: '이미 행동을 제출했습니다.' };
  }

  if (role === 'doppelganger') {
    const target = room.players.find((p) => p.id === payload.targetId && p.id !== player.id);
    if (!target) {
      return { ok: false, error: '복사할 대상을 다시 선택하세요.' };
    }
    player.doppelRole = target.originalRole;
    player.currentRole = target.originalRole;
    pushNote(room, player.id, `도플갱어 복사: ${target.name}의 역할(${ROLE_LABELS[target.originalRole]})을 복사했습니다.`);
    room.actedBy.add(player.id);
  }

  if (role === 'minion' || role === 'mason') {
    room.actedBy.add(player.id);
  }

  if (role === 'werewolf') {
    const wolves = activePlayersForRole(room, 'werewolf');
    if (wolves.length === 1) {
      if (!isValidCenterIndex(payload.centerIndex)) {
        return { ok: false, error: '중앙 카드 인덱스가 올바르지 않습니다.' };
      }
      const roleSeen = room.center[payload.centerIndex];
      pushNote(room, player.id, `중앙[${payload.centerIndex}] 확인: ${ROLE_LABELS[roleSeen]}`);
    }

    room.actedBy.add(player.id);
  }

  if (role === 'seer') {
    if (payload.mode === 'player') {
      const target = room.players.find((p) => p.id === payload.targetId && p.id !== player.id);
      if (!target) {
        return { ok: false, error: '대상 플레이어를 다시 선택하세요.' };
      }
      pushNote(room, player.id, `${target.name} 확인: ${ROLE_LABELS[target.currentRole]}`);
    } else if (payload.mode === 'center') {
      const indices = Array.isArray(payload.indices) ? payload.indices : [];
      if (indices.length !== 2 || !isValidCenterIndex(indices[0]) || !isValidCenterIndex(indices[1]) || indices[0] === indices[1]) {
        return { ok: false, error: '서로 다른 중앙 카드 2장을 선택하세요.' };
      }
      pushNote(room, player.id, `중앙[${indices[0]}]=${ROLE_LABELS[room.center[indices[0]]]}, 중앙[${indices[1]}]=${ROLE_LABELS[room.center[indices[1]]]}`);
    } else {
      return { ok: false, error: '예언자 행동 형식이 올바르지 않습니다.' };
    }

    room.actedBy.add(player.id);
  }

  if (role === 'robber') {
    const target = room.players.find((p) => p.id === payload.targetId && p.id !== player.id);
    if (!target) {
      return { ok: false, error: '대상 플레이어를 다시 선택하세요.' };
    }

    const old = player.currentRole;
    player.currentRole = target.currentRole;
    target.currentRole = old;

    pushNote(room, player.id, `${target.name}의 카드를 훔쳤습니다. 현재 역할: ${ROLE_LABELS[player.currentRole]}`);
    room.actedBy.add(player.id);
  }

  if (role === 'troublemaker') {
    const targetA = room.players.find((p) => p.id === payload.targetA && p.id !== player.id);
    const targetB = room.players.find((p) => p.id === payload.targetB && p.id !== player.id);
    if (!targetA || !targetB || targetA.id === targetB.id) {
      return { ok: false, error: '서로 다른 대상 2명을 선택하세요.' };
    }

    const old = targetA.currentRole;
    targetA.currentRole = targetB.currentRole;
    targetB.currentRole = old;

    pushNote(room, player.id, `${targetA.name}와 ${targetB.name}의 카드를 바꿨습니다.`);
    room.actedBy.add(player.id);
  }

  if (role === 'drunk') {
    if (!isValidCenterIndex(payload.centerIndex)) {
      return { ok: false, error: '중앙 카드 인덱스가 올바르지 않습니다.' };
    }

    const old = player.currentRole;
    player.currentRole = room.center[payload.centerIndex];
    room.center[payload.centerIndex] = old;

    pushNote(room, player.id, `중앙[${payload.centerIndex}]과 카드를 교환했습니다. 새 역할은 공개되지 않습니다.`);
    room.actedBy.add(player.id);
  }

  return { ok: true };
}

function buildClientState(room, socketId) {
  const me = getPlayer(room, socketId);
  const activePlayers = room.activeRole ? activePlayersForRole(room, room.activeRole) : [];
  const centerPreview = room.roundDeck.slice(room.players.length, room.players.length + 3);
  const claims = Object.entries(room.claimAssignments || {})
    .map(([asserterId, claim]) => {
      const asserter = room.players.find((p) => p.id === asserterId);
      const target = room.players.find((p) => p.id === claim.targetId);
      if (!asserter || !target || !ROLE_LABELS[claim.role]) {
        return null;
      }
      return {
        asserterId,
        asserterName: asserter.name,
        targetId: target.id,
        targetName: target.name,
        role: claim.role,
        ts: claim.ts || 0
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);

  const latestClaimByTarget = {};
  const roleOwnerByRole = {};
  const claimNarratives = [];
  for (const claim of claims) {
    latestClaimByTarget[claim.targetId] = claim.role;

    if (claim.asserterId === claim.targetId) {
      claimNarratives.push(`${claim.asserterName}가 ${ROLE_LABELS[claim.role]}이라고 주장합니다.`);
    } else {
      claimNarratives.push(`${claim.asserterName}가 ${claim.targetName}에게 ${ROLE_LABELS[claim.role]} 역할을 붙입니다.`);
    }

    const prevOwner = roleOwnerByRole[claim.role];
    if (prevOwner && prevOwner !== claim.asserterName) {
      claimNarratives.push(`${claim.asserterName}가 ${prevOwner}에게서 ${ROLE_LABELS[claim.role]} 역할을 가져옵니다.`);
    }
    roleOwnerByRole[claim.role] = claim.asserterName;
  }

  const players = room.players.map((p) => ({
    id: p.id,
    name: p.name,
    connected: p.connected,
    isHost: p.id === room.hostId,
    emote: p.emote || undefined,
    emoteAt: p.emoteAt || undefined,
    voteTarget: room.state === 'reveal' ? p.voteTarget : undefined,
    claimRole: latestClaimByTarget[p.id] || undefined,
    claimLikes: Object.values(room.claimReactions[p.id] || {}).filter((v) => v === 'like').length,
    claimDislikes: Object.values(room.claimReactions[p.id] || {}).filter((v) => v === 'dislike').length,
    myClaimReaction: (room.claimReactions[p.id] || {})[socketId] || null,
    originalRole: room.state === 'reveal' ? p.originalRole : undefined,
    currentRole: room.state === 'reveal' ? p.currentRole : undefined,
    doppelRole: room.state === 'reveal' ? p.doppelRole : undefined
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
        voteTarget: me.voteTarget,
        claimRole: me.claimRole || undefined,
        doppelRole: room.state === 'reveal' ? me.doppelRole : undefined
      }
      : null,
    centerCount: 3,
    center: room.state === 'reveal' ? room.center : null,
    centerPreview: room.state === 'lobby' ? centerPreview : null,
    activeRole: room.activeRole,
    instruction: getInstruction(room.activeRole, room, me),
    notes: room.privateNotes[socketId] || [],
    dayEndsAt: room.dayEndsAt,
    roleEndsAt: room.roleEndsAt,
    roundEndsAt: room.roundEndsAt,
    result: room.result,
    roleLabels: ROLE_LABELS,
    availableRoleCards: buildAvailableRoleCards(),
    deckLocked: !!room.deckLocked,
    claimAssignments: claims,
    claimNarratives,
    catalogCards: buildCatalogCardsFromDeck(room.roundDeck),
    turnProgress: room.state === 'night' && room.activeRole
      ? {
        activeRole: room.activeRole,
        activeRoleLabel: ROLE_LABELS[room.activeRole],
        required: activePlayers.length,
        acted: activePlayers.filter((p) => room.actedBy.has(p.id)).length,
        meActed: room.actedBy.has(socketId)
      }
      : null
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
  delete room.claimReactions[socketId];
  delete room.claimAssignments[socketId];
  for (const asserterId of Object.keys(room.claimAssignments)) {
    if (room.claimAssignments[asserterId].targetId === socketId) {
      delete room.claimAssignments[asserterId];
    }
  }
  for (const targetId of Object.keys(room.claimReactions)) {
    delete room.claimReactions[targetId][socketId];
  }

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  if (room.hostId === socketId) {
    room.hostId = room.players[0].id;
  }

  if (room.state === 'lobby' || room.state === 'reveal') {
    refreshRoomDeck(room);
  }

  if (room.state !== 'lobby' && room.players.length < 3) {
    room.state = 'lobby';
    room.activeRole = null;
    room.roleEndsAt = null;
    room.nightIndex = 0;
    room.dayEndsAt = null;
    room.roundEndsAt = null;
    room.result = null;
    refreshRoomDeck(room);
  }
}

function markPlayerDisconnected(room, socketId) {
  const player = getPlayer(room, socketId);
  if (!player) {
    return;
  }
  player.connected = false;
  player.disconnectedAt = Date.now();

  if (room.hostId === socketId) {
    const nextHost = room.players.find((p) => p.connected);
    if (nextHost) {
      room.hostId = nextHost.id;
    }
  }
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ name, playerKey }) => {
    const safeName = String(name || '').trim().slice(0, 24);
    const safePlayerKey = String(playerKey || socket.id).trim().slice(0, 64);
    if (!safeName) {
      socket.emit('error_message', 'Name is required.');
      return;
    }

    try {
      const room = createRoom(socket, safeName);
      room.players[0].playerKey = safePlayerKey || socket.id;
      emitRoom(room);
    } catch (err) {
      socket.emit('error_message', '현재 생성 가능한 방 코드가 부족합니다. 잠시 후 다시 시도하세요.');
    }
  });

  socket.on('join_room', ({ code, name, playerKey }) => {
    const safeName = String(name || '').trim().slice(0, 24);
    const safePlayerKey = String(playerKey || '').trim().slice(0, 64);
    const rawCode = String(code || '').trim();
    const safeCode = /^\d{1,2}$/.test(rawCode)
      ? rawCode.padStart(2, '0')
      : rawCode.toUpperCase();

    if (!safeName || !safeCode) {
      socket.emit('error_message', 'Code and name are required.');
      return;
    }

    const room = rooms.get(safeCode);
    if (!room) {
      socket.emit('error_message', 'Room not found.');
      return;
    }

    if (safePlayerKey) {
      const existing = getPlayerByKey(room, safePlayerKey);
      if (existing) {
        existing.id = socket.id;
        existing.name = safeName || existing.name;
        existing.connected = true;
        existing.disconnectedAt = null;
        socket.join(room.code);
        emitRoom(room);
        return;
      }
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
      playerKey: safePlayerKey || socket.id,
      name: safeName,
      connected: true,
      disconnectedAt: null,
      originalRole: null,
      currentRole: null,
      voteTarget: null,
      doppelRole: null,
      claimRole: null,
      emote: null,
      emoteAt: null
    });
    refreshRoomDeck(room);

    socket.join(room.code);
    emitRoom(room);
  });

  socket.on('resume_session', ({ code, playerKey, name }) => {
    const safeKey = String(playerKey || '').trim().slice(0, 64);
    const rawCode = String(code || '').trim();
    const safeCode = /^\d{1,2}$/.test(rawCode) ? rawCode.padStart(2, '0') : rawCode.toUpperCase();
    if (!safeKey || !safeCode) {
      socket.emit('resume_failed');
      return;
    }
    const room = rooms.get(safeCode);
    if (!room) {
      socket.emit('resume_failed');
      return;
    }
    const existing = getPlayerByKey(room, safeKey);
    if (!existing) {
      socket.emit('resume_failed');
      return;
    }

    existing.id = socket.id;
    existing.connected = true;
    existing.disconnectedAt = null;
    if (String(name || '').trim()) {
      existing.name = String(name).trim().slice(0, 24);
    }
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

    if (connectedPlayerCount(room) < 3) {
      socket.emit('error_message', 'Need at least 3 players.');
      return;
    }

    if (room.state !== 'lobby' && room.state !== 'reveal') {
      socket.emit('error_message', 'Cannot start now.');
      return;
    }

    if (room.state === 'reveal' && !room.deckLocked) {
      refreshRoomDeck(room);
    }
    startGame(room);
    emitRoom(room);
  });

  socket.on('set_round_deck', ({ deck }) => {
    const room = findRoomBySocket(socket.id);
    if (!room) {
      return;
    }
    if (!isHost(room, socket.id)) {
      socket.emit('error_message', '방장만 조합을 바꿀 수 있습니다.');
      return;
    }
    if (room.state !== 'lobby' && room.state !== 'reveal') {
      socket.emit('error_message', '지금은 조합을 변경할 수 없습니다.');
      return;
    }
    if (!isValidRoundDeck(deck, room.players.length)) {
      socket.emit('error_message', `조합은 총 ${room.players.length + 3}장이어야 하며 카드 수량 제한을 지켜야 합니다.`);
      return;
    }
    room.roundDeck = [...deck];
    room.deckLocked = true;
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
    if (!voter || !voter.connected || !target) {
      socket.emit('error_message', 'Invalid vote target.');
      return;
    }

    voter.voteTarget = targetId;

    const everyoneVoted = room.players.filter((p) => p.connected).every((p) => !!p.voteTarget);
    if (everyoneVoted) {
      revealResult(room);
    }

    emitRoom(room);
  });

  socket.on('set_claim_assignment', ({ targetId, role }) => {
    const room = findRoomBySocket(socket.id);
    if (!room) {
      return;
    }
    const asserter = getPlayer(room, socket.id);
    const target = getPlayer(room, targetId);
    if (!asserter || !target) {
      socket.emit('error_message', '주장 대상이 올바르지 않습니다.');
      return;
    }

    const safeRole = String(role);
    if (!ROLE_LABELS[safeRole]) {
      socket.emit('error_message', '올바르지 않은 주장 역할입니다.');
      return;
    }

    room.claimAssignments[asserter.id] = {
      targetId: target.id,
      role: safeRole,
      ts: Date.now()
    };
    room.claimReactions[target.id] = {};
    emitRoom(room);
  });

  socket.on('clear_claim_assignment', () => {
    const room = findRoomBySocket(socket.id);
    if (!room) {
      return;
    }
    delete room.claimAssignments[socket.id];
    emitRoom(room);
  });

  socket.on('set_claim', ({ role }) => {
    const room = findRoomBySocket(socket.id);
    if (!room) {
      return;
    }
    const me = getPlayer(room, socket.id);
    if (!me) {
      return;
    }
    if (!role) {
      delete room.claimAssignments[socket.id];
      emitRoom(room);
      return;
    }
    const safeRole = String(role);
    if (!ROLE_LABELS[safeRole]) {
      socket.emit('error_message', '올바르지 않은 주장 역할입니다.');
      return;
    }
    room.claimAssignments[socket.id] = { targetId: me.id, role: safeRole, ts: Date.now() };
    room.claimReactions[me.id] = {};
    emitRoom(room);
  });

  socket.on('set_claim_reaction', ({ targetId, reaction }) => {
    const room = findRoomBySocket(socket.id);
    if (!room) {
      return;
    }
    const voter = getPlayer(room, socket.id);
    const target = getPlayer(room, targetId);
    if (!voter || !target) {
      socket.emit('error_message', '반응 대상이 올바르지 않습니다.');
      return;
    }
    if (voter.id === target.id) {
      socket.emit('error_message', '자신의 주장에는 반응할 수 없습니다.');
      return;
    }
    if (!latestClaimedRoleForTarget(room, target.id)) {
      socket.emit('error_message', '아직 주장하지 않은 플레이어입니다.');
      return;
    }
    if (!CLAIM_REACTIONS.includes(String(reaction || ''))) {
      socket.emit('error_message', '올바르지 않은 반응입니다.');
      return;
    }

    if (!room.claimReactions[target.id]) {
      room.claimReactions[target.id] = {};
    }
    const prev = room.claimReactions[target.id][voter.id];
    room.claimReactions[target.id][voter.id] = prev === reaction ? null : reaction;
    if (!room.claimReactions[target.id][voter.id]) {
      delete room.claimReactions[target.id][voter.id];
    }
    emitRoom(room);
  });

  socket.on('set_emote', ({ emote }) => {
    const room = findRoomBySocket(socket.id);
    if (!room) {
      return;
    }
    const player = getPlayer(room, socket.id);
    if (!player) {
      return;
    }

    if (!ALLOWED_EMOTES.includes(String(emote || ''))) {
      socket.emit('error_message', '사용할 수 없는 이모티콘입니다.');
      return;
    }

    player.emote = String(emote);
    player.emoteAt = Date.now();
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

    markPlayerDisconnected(room, socket.id);
    emitRoom(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    let emoteChanged = false;
    for (const player of room.players) {
      if (player.emoteAt && now - player.emoteAt > EMOTE_DURATION_MS) {
        player.emote = null;
        player.emoteAt = null;
        emoteChanged = true;
      }
    }
    if (emoteChanged) {
      emitRoom(room);
    }

    const staleDisconnected = room.players
      .filter((p) => !p.connected && p.disconnectedAt && now - p.disconnectedAt > DISCONNECT_TTL_MS)
      .map((p) => p.id);
    for (const staleId of staleDisconnected) {
      removePlayerFromRoom(room, staleId);
    }
    if (staleDisconnected.length > 0 && rooms.has(room.code)) {
      emitRoom(room);
    }

    if (room.state === 'night' && room.roleEndsAt && now >= room.roleEndsAt) {
      finishNightRole(room);
      emitRoom(room);
      continue;
    }
    if (room.state === 'day' && room.dayEndsAt && now >= room.dayEndsAt) {
      startVote(room);
      emitRoom(room);
    }
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`ONUW MVP server listening on http://localhost:${PORT}`);
});
