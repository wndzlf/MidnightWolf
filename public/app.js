const socket = io();
const STORAGE_PLAYER_KEY = 'onuw_player_key';
const STORAGE_ROOM_CODE = 'onuw_code';

const $ = (id) => document.getElementById(id);

const els = {
  connectCard: $('connectCard'),
  gameCard: $('gameCard'),
  nameInput: $('nameInput'),
  codeInput: $('codeInput'),
  createBtn: $('createBtn'),
  joinBtn: $('joinBtn'),
  roomTitle: $('roomTitle'),
  phaseLine: $('phaseLine'),
  soundBtn: $('soundBtn'),
  timerPill: $('timerPill'),
  statusLine: $('statusLine'),
  youLine: $('youLine'),
  myClaimLine: $('myClaimLine'),
  claimTargetSelect: $('claimTargetSelect'),
  claimRoleButtons: $('claimRoleButtons'),
  claimNarrative: $('claimNarrative'),
  claimClearBtn: $('claimClearBtn'),
  emoteBar: $('emoteBar'),
  myRoleCard: $('myRoleCard'),
  instructionLine: $('instructionLine'),
  playersList: $('playersList'),
  tableInfoFeed: $('tableInfoFeed'),
  catalogCards: $('catalogCards'),
  catalogDetail: $('catalogDetail'),
  chatList: $('chatList'),
  chatInput: $('chatInput'),
  chatSendBtn: $('chatSendBtn'),
  tableActionDock: $('tableActionDock'),
  tableVoteBoard: $('tableVoteBoard'),
  tableSeats: $('tableSeats'),
  tableCenterCards: $('tableCenterCards'),
  hostActions: $('hostActions'),
  toastStack: $('toastStack')
};

let state = null;
let timer = null;
let soundEnabled = localStorage.getItem('onuw_sound') !== 'off';
let audioCtx = null;
let dayAudioNodes = null;
let dayTickInterval = null;
let selectedClaimTargetId = '';
let audioUnlocked = false;
let audioHintShown = false;
let selectedCatalogRole = null;
let editableDeck = [];
let chatComposing = false;
let tableSelectedPlayerIds = [];
let tableSelectedCenterIndices = [];
let interactionStateKey = '';
let currentRoomCode = '';
const EMOTES = ['❗', '😡', '🤯', '🤣', '🤔', '👍', '👀'];
const EMOTE_VISIBLE_MS = 5000;

const phaseTitle = {
  lobby: '로비',
  night: '밤',
  day: '낮 토론',
  vote: '투표',
  reveal: '결과 공개'
};

const ROLE_VISUAL = {
  villager: { icon: '🌾', tone: 'village', blurb: '평범한 주민. 토론으로 승리하세요.' },
  werewolf: { icon: '🐺', tone: 'wolf', blurb: '들키지 말고 마을을 속이세요.' },
  seer: { icon: '🔮', tone: 'seer', blurb: '정체를 엿보는 예언자.' },
  robber: { icon: '🦝', tone: 'robber', blurb: '다른 사람의 역할을 훔칩니다.' },
  troublemaker: { icon: '🃏', tone: 'trouble', blurb: '두 사람의 운명을 바꿉니다.' },
  drunk: { icon: '🍷', tone: 'drunk', blurb: '중앙 카드와 몰래 교환합니다.' },
  insomniac: { icon: '🛌', tone: 'insomniac', blurb: '밤이 끝날 때 내 역할을 확인합니다.' },
  doppelganger: { icon: '🎭', tone: 'doppel', blurb: '다른 역할을 복사해 움직입니다.' },
  minion: { icon: '😈', tone: 'minion', blurb: '늑대를 돕는 비밀 조력자.' },
  mason: { icon: '🧱', tone: 'mason', blurb: '프리메이슨끼리 서로를 압니다.' },
  hunter: { icon: '🏹', tone: 'hunter', blurb: '죽으면 내가 찍은 사람도 함께 탈락.' }
};

const ROLE_DETAILS = {
  villager: '특수 능력은 없습니다.\n토론과 투표로 늑대 팀을 찾아내야 합니다.',
  werewolf: '늑대끼리 서로를 확인합니다.\n유일한 늑대면 중앙 카드 1장을 확인할 수 있습니다.',
  seer: '플레이어 1명의 역할을 보거나,\n중앙 카드 2장을 볼 수 있습니다.',
  robber: '다른 플레이어 1명과 카드를 교환하고,\n교환 후 내 역할을 확인합니다.',
  troublemaker: '다른 플레이어 2명의 카드를 서로 교환합니다.\n결과는 보지 않습니다.',
  drunk: '중앙 카드 1장과 내 카드를 교환합니다.\n새 역할은 확인하지 않습니다.',
  insomniac: '밤 마지막에 내 현재 역할을 확인합니다.',
  doppelganger: '밤 시작에 다른 플레이어 1명의 초기 역할을 복사하고,\n복사한 역할의 행동을 해당 차례에 수행합니다.',
  minion: '늑대 편입니다.\n늑대가 누구인지 알고, 마을을 혼란스럽게 만듭니다.',
  mason: '프리메이슨끼리 서로를 확인합니다.\n유일한 프리메이슨일 수도 있습니다.',
  hunter: '내가 탈락하면,\n내가 투표한 대상도 함께 탈락합니다.'
};

function setError(msg) {
  els.statusLine.textContent = msg;
  showToast(msg, 'error');
}

function getOrCreatePlayerKey() {
  const existing = localStorage.getItem(STORAGE_PLAYER_KEY);
  if (existing) return existing;
  const key = `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
  localStorage.setItem(STORAGE_PLAYER_KEY, key);
  return key;
}

function roleLabel(role) {
  if (!state || !state.roleLabels || !role) return '-';
  return state.roleLabels[role] || role;
}

function roleVisual(role) {
  return ROLE_VISUAL[role] || { icon: '❓', tone: 'unknown', blurb: '정체 불명 역할' };
}

function claimText(role) {
  const visual = roleVisual(role);
  return `${visual.icon} ${roleLabel(role)}`;
}

function hasMyNightTurn() {
  return Boolean(
    state
    && state.state === 'night'
    && state.me
    && state.instruction
    && !state.turnProgress?.meActed
  );
}

function isLoneWerewolfTurn() {
  return state?.activeRole === 'werewolf' && (state.instruction || '').includes('외로운 늑대');
}

function resetTableSelections() {
  tableSelectedPlayerIds = [];
  tableSelectedCenterIndices = [];
}

function currentInteractionKey() {
  if (!state || !state.me) {
    return '';
  }
  return [
    state.code,
    state.state,
    state.activeRole || '-',
    state.turnProgress?.meActed ? 'done' : 'open',
    state.players.length
  ].join('|');
}

function syncInteractionState() {
  if (!state || !state.me) {
    resetTableSelections();
    interactionStateKey = '';
    return;
  }

  const key = currentInteractionKey();
  if (interactionStateKey !== key) {
    interactionStateKey = key;
    resetTableSelections();
  }

  tableSelectedPlayerIds = tableSelectedPlayerIds.filter((id) => state.players.some((p) => p.id === id));
  tableSelectedCenterIndices = tableSelectedCenterIndices.filter((idx) => Number.isInteger(idx) && idx >= 0 && idx <= 2);

  if (!selectedClaimTargetId || !state.players.some((p) => p.id === selectedClaimTargetId)) {
    selectedClaimTargetId = state.me.id;
  }
}

function setClaimTarget(targetId) {
  if (!state || !state.players.some((p) => p.id === targetId)) {
    return;
  }
  selectedClaimTargetId = targetId;
}

function selectableSeatIds() {
  if (!state || !state.me) {
    return new Set();
  }

  if (hasMyNightTurn()) {
    const nightSeatRoles = new Set(['doppelganger', 'seer', 'robber', 'troublemaker']);
    if (nightSeatRoles.has(state.activeRole)) {
      return new Set(state.players.filter((p) => p.id !== state.me.id).map((p) => p.id));
    }
    return new Set();
  }

  if (state.state === 'night') {
    return new Set();
  }

  if (state.state === 'reveal') {
    return new Set();
  }

  return new Set(state.players.map((p) => p.id));
}

function selectableCenterIndices() {
  if (!state || !hasMyNightTurn()) {
    return new Set();
  }
  if (state.activeRole === 'seer' || state.activeRole === 'drunk' || isLoneWerewolfTurn()) {
    return new Set([0, 1, 2]);
  }
  return new Set();
}

function selectedSeatIdsForHighlight() {
  if (!state || !state.me) {
    return new Set();
  }
  if (state.state === 'night') {
    if (hasMyNightTurn() && state.activeRole === 'troublemaker') {
      return new Set(tableSelectedPlayerIds);
    }
    return new Set();
  }
  return selectedClaimTargetId ? new Set([selectedClaimTargetId]) : new Set();
}

function selectedCenterIdsForHighlight() {
  if (state?.state === 'night' && hasMyNightTurn() && state.activeRole === 'seer') {
    return new Set(tableSelectedCenterIndices);
  }
  return new Set();
}

function handleTableSeatClick(targetId) {
  if (!state || !state.me || !targetId) {
    return;
  }

  if (hasMyNightTurn()) {
    if (targetId === state.me.id) {
      return;
    }

    if (state.activeRole === 'doppelganger' || state.activeRole === 'seer' || state.activeRole === 'robber') {
      if (state.activeRole === 'seer') {
        socket.emit('night_action', { mode: 'player', targetId });
      } else {
        socket.emit('night_action', { targetId });
      }
      resetTableSelections();
      return;
    }

    if (state.activeRole === 'troublemaker') {
      if (tableSelectedPlayerIds.includes(targetId)) {
        tableSelectedPlayerIds = tableSelectedPlayerIds.filter((id) => id !== targetId);
      } else {
        tableSelectedPlayerIds = [...tableSelectedPlayerIds, targetId].slice(-2);
      }

      if (tableSelectedPlayerIds.length === 2) {
        socket.emit('night_action', { targetA: tableSelectedPlayerIds[0], targetB: tableSelectedPlayerIds[1] });
        resetTableSelections();
      }
      renderTableBoard();
      renderActionPanel();
      return;
    }
  }

  setClaimTarget(targetId);
  renderTableBoard();
  renderActionPanel();
  renderClaimControls();
}

function handleTableCenterClick(index) {
  if (!state || !hasMyNightTurn()) {
    return;
  }

  if (state.activeRole === 'drunk' || isLoneWerewolfTurn()) {
    socket.emit('night_action', { centerIndex: index });
    resetTableSelections();
    return;
  }

  if (state.activeRole !== 'seer') {
    return;
  }

  if (tableSelectedCenterIndices.includes(index)) {
    tableSelectedCenterIndices = tableSelectedCenterIndices.filter((x) => x !== index);
  } else if (tableSelectedCenterIndices.length < 2) {
    tableSelectedCenterIndices = [...tableSelectedCenterIndices, index];
  }

  if (tableSelectedCenterIndices.length === 2) {
    socket.emit('night_action', { mode: 'center', indices: [...tableSelectedCenterIndices] });
    resetTableSelections();
  }

  renderTableBoard();
  renderActionPanel();
}

function buildClaimReactionRow(player) {
  const row = document.createElement('div');
  row.className = 'claim-reaction-row';

  const counts = document.createElement('span');
  counts.className = 'claim-reaction-count';
  counts.textContent = `👍 ${player.claimLikes || 0}  👎 ${player.claimDislikes || 0}`;
  row.appendChild(counts);

  if (!state?.me || state.me.id === player.id) {
    return row;
  }

  const likeBtn = document.createElement('button');
  likeBtn.type = 'button';
  likeBtn.className = `claim-react-btn ${player.myClaimReaction === 'like' ? 'active' : ''}`;
  likeBtn.textContent = '👍';
  likeBtn.onclick = () => {
    socket.emit('set_claim_reaction', { targetId: player.id, reaction: 'like' });
  };

  const dislikeBtn = document.createElement('button');
  dislikeBtn.type = 'button';
  dislikeBtn.className = `claim-react-btn ${player.myClaimReaction === 'dislike' ? 'active' : ''}`;
  dislikeBtn.textContent = '👎';
  dislikeBtn.onclick = () => {
    socket.emit('set_claim_reaction', { targetId: player.id, reaction: 'dislike' });
  };

  row.appendChild(likeBtn);
  row.appendChild(dislikeBtn);
  return row;
}

function renderClaimControls() {
  if (!state || !state.me) return;

  if (els.claimTargetSelect) {
    const current = selectedClaimTargetId || state.me.id;
    els.claimTargetSelect.innerHTML = '';
    state.players.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.id === state.me.id ? `${p.name} (나)` : p.name;
      els.claimTargetSelect.appendChild(opt);
    });
    selectedClaimTargetId = state.players.some((p) => p.id === current) ? current : state.me.id;
    els.claimTargetSelect.value = selectedClaimTargetId;
    els.claimTargetSelect.onchange = () => {
      selectedClaimTargetId = els.claimTargetSelect.value;
      renderClaimControls();
      renderTableBoard();
      renderActionPanel();
    };
  }

  if (els.claimRoleButtons) {
    els.claimRoleButtons.innerHTML = '';
    Object.entries(state.roleLabels || {}).forEach(([role, label]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'claim-role-btn';
      const icon = roleVisual(role).icon;
      btn.textContent = `${icon} ${label}`;
      btn.onclick = () => {
        socket.emit('set_claim_assignment', {
          targetId: selectedClaimTargetId || state.me.id,
          role
        });
      };
      els.claimRoleButtons.appendChild(btn);
    });
  }
}

function renderClaimNarrative() {
  if (!els.claimNarrative || !state) return;
  const rows = Array.isArray(state.claimNarratives) ? state.claimNarratives : [];
  els.claimNarrative.textContent = rows.length
    ? rows.slice(-6).join('\n')
    : '아직 주장이 없습니다.';
}

function isFreshEmote(player) {
  return !!(player && player.emote && player.emoteAt && (Date.now() - player.emoteAt <= EMOTE_VISIBLE_MS));
}

function showToast(message, type = 'info') {
  if (!els.toastStack || !message) {
    return;
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  els.toastStack.prepend(toast);

  const maxToasts = 4;
  while (els.toastStack.children.length > maxToasts) {
    els.toastStack.removeChild(els.toastStack.lastChild);
  }

  setTimeout(() => {
    toast.remove();
  }, 3200);
}

function updateSoundButton() {
  if (!els.soundBtn) return;
  els.soundBtn.textContent = soundEnabled ? '사운드 ON' : '사운드 OFF';
}

function ensureAudioContext() {
  if (audioCtx) return audioCtx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  audioCtx = new AudioCtx();
  return audioCtx;
}

async function unlockAudio() {
  const ctx = ensureAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    audioUnlocked = ctx.state === 'running';
    return audioUnlocked;
  } catch {
    return false;
  }
}

function playDayPulse(ctx, destination) {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  osc.type = 'triangle';
  osc.frequency.value = 170;
  filter.type = 'bandpass';
  filter.frequency.value = 260;
  filter.Q.value = 8;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.035, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.23);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  osc.start(now);
  osc.stop(now + 0.25);
}

function startDayBgm() {
  if (!soundEnabled) return;
  if (!audioUnlocked) {
    if (!audioHintShown) {
      showToast('사운드를 들으려면 화면을 한 번 터치하세요.', 'info');
      audioHintShown = true;
    }
    return;
  }
  const ctx = ensureAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') return;
  if (dayAudioNodes) return;

  const master = ctx.createGain();
  master.gain.value = 0.12;
  master.connect(ctx.destination);

  const humOsc = ctx.createOscillator();
  const humFilter = ctx.createBiquadFilter();
  const humGain = ctx.createGain();
  humOsc.type = 'sawtooth';
  humOsc.frequency.value = 58;
  humFilter.type = 'lowpass';
  humFilter.frequency.value = 220;
  humGain.gain.value = 0.6;
  humOsc.connect(humFilter);
  humFilter.connect(humGain);
  humGain.connect(master);

  const subOsc = ctx.createOscillator();
  const subGain = ctx.createGain();
  subOsc.type = 'triangle';
  subOsc.frequency.value = 116;
  subGain.gain.value = 0.2;
  subOsc.connect(subGain);
  subGain.connect(master);

  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type = 'sine';
  lfo.frequency.value = 0.22;
  lfoGain.gain.value = 60;
  lfo.connect(lfoGain);
  lfoGain.connect(humFilter.frequency);

  humOsc.start();
  subOsc.start();
  lfo.start();

  dayAudioNodes = { master, humOsc, humFilter, humGain, subOsc, subGain, lfo, lfoGain };
  dayTickInterval = setInterval(() => {
    if (!audioCtx || !dayAudioNodes || audioCtx.state !== 'running') return;
    playDayPulse(audioCtx, dayAudioNodes.master);
  }, 1600);
}

function stopDayBgm() {
  if (dayTickInterval) {
    clearInterval(dayTickInterval);
    dayTickInterval = null;
  }
  if (!dayAudioNodes) return;
  const ctx = audioCtx;
  const nodes = dayAudioNodes;
  dayAudioNodes = null;
  if (ctx) {
    const t = ctx.currentTime;
    nodes.master.gain.cancelScheduledValues(t);
    nodes.master.gain.setValueAtTime(nodes.master.gain.value, t);
    nodes.master.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    setTimeout(() => {
      nodes.humOsc.stop();
      nodes.subOsc.stop();
      nodes.lfo.stop();
      nodes.humOsc.disconnect();
      nodes.subOsc.disconnect();
      nodes.lfo.disconnect();
      nodes.master.disconnect();
    }, 240);
  }
}

function syncDayBgm() {
  if (!state) return;
  if (!soundEnabled || state.state !== 'day') {
    stopDayBgm();
    return;
  }
  startDayBgm();
}

function fmtMs(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function shuffleArray(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function startTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    const activeRound = state
      && ['night', 'day', 'vote'].includes(state.state)
      && state.roundEndsAt;
    if (!activeRound) {
      els.timerPill.textContent = '--:--';
      return;
    }
    els.timerPill.textContent = fmtMs(state.roundEndsAt - Date.now());
  }, 400);
}

function actionButton(text, onClick, secondary = false) {
  const btn = document.createElement('button');
  btn.textContent = text;
  if (secondary) btn.classList.add('secondary');
  btn.onclick = onClick;
  return btn;
}

function getActionRoot() {
  return els.tableActionDock;
}

function buildNightActionUI() {
  const root = getActionRoot();
  if (!root) return;
  root.innerHTML = '';
  if (!state || state.state !== 'night' || !state.me) {
    return;
  }

  const active = state.activeRole || '';
  const hasMyTurn = hasMyNightTurn();
  const progress = state.turnProgress;
  if (progress) {
    const turn = document.createElement('p');
    turn.className = 'muted';
    turn.textContent = `현재 차례: ${progress.activeRoleLabel}`;
    root.appendChild(turn);
  }

  if (progress && progress.meActed) {
    const done = document.createElement('p');
    done.className = 'muted';
    done.textContent = '내 행동 제출 완료. 모든 대상이 완료되면 자동으로 다음 차례로 넘어갑니다.';
    root.appendChild(done);
    return;
  }

  if (!active || !hasMyTurn) {
    const line = document.createElement('p');
    line.className = 'muted';
    line.textContent = '내 역할 차례를 기다리는 중입니다. (자동 진행)';
    root.appendChild(line);
    return;
  }

  const hint = document.createElement('p');
  hint.className = 'muted';
  root.appendChild(hint);

  if (active === 'doppelganger') {
    hint.textContent = '테이블에서 복사할 플레이어 좌석을 클릭하세요.';
    return;
  }

  if (active === 'werewolf') {
    if (isLoneWerewolfTurn()) {
      hint.textContent = '외로운 늑대입니다. 중앙 카드 1장을 클릭하세요.';
      return;
    }
    hint.textContent = '늑대끼리 정보를 확인했다면 완료를 누르세요.';
    root.appendChild(actionButton('확인 완료', () => {
      socket.emit('night_action', {});
    }));
    return;
  }

  if (active === 'minion' || active === 'mason') {
    hint.textContent = '정보 확인 후 완료 버튼을 누르세요.';
    root.appendChild(actionButton('확인 완료', () => {
      socket.emit('night_action', {});
    }));
    return;
  }

  if (active === 'seer') {
    hint.textContent = '플레이어 좌석 1명 또는 중앙 카드 2장을 클릭하세요.';
    if (tableSelectedCenterIndices.length > 0) {
      const picked = document.createElement('p');
      picked.className = 'muted';
      picked.textContent = `중앙 선택: ${tableSelectedCenterIndices.map((i) => i + 1).join(', ')}`;
      root.appendChild(picked);
    }
    return;
  }

  if (active === 'robber') {
    hint.textContent = '훔칠 플레이어 좌석을 클릭하세요.';
    return;
  }

  if (active === 'troublemaker') {
    hint.textContent = '카드를 바꿀 플레이어 2명의 좌석을 순서대로 클릭하세요.';
    if (tableSelectedPlayerIds.length > 0) {
      const names = tableSelectedPlayerIds
        .map((id) => state.players.find((p) => p.id === id)?.name)
        .filter(Boolean);
      const picked = document.createElement('p');
      picked.className = 'muted';
      picked.textContent = `선택: ${names.join(' → ')}`;
      root.appendChild(picked);
    }
    root.appendChild(actionButton('선택 초기화', () => {
      resetTableSelections();
      renderTableBoard();
      renderActionPanel();
    }, true));
    return;
  }

  if (active === 'drunk') {
    hint.textContent = '중앙 카드 1장을 클릭해 교환하세요.';
    return;
  }

  hint.textContent = '이 단계에서는 행동이 없습니다.';
}

function buildClaimAndVoteUI({ includeVote = false } = {}) {
  const root = getActionRoot();
  if (!root || !state || !state.me) {
    return;
  }

  const target = state.players.find((p) => p.id === selectedClaimTargetId) || state.me;
  const title = document.createElement('p');
  title.className = 'muted';
  title.textContent = `지목 대상: ${target.name} (${target.id === state.me.id ? '나' : '플레이어'})`;
  root.appendChild(title);

  const hint = document.createElement('p');
  hint.className = 'muted';
  hint.textContent = '테이블 좌석을 클릭해 대상을 바꾸고, 아래에서 의심 역할을 지정하세요.';
  root.appendChild(hint);

  const roleGrid = document.createElement('div');
  roleGrid.className = 'table-claim-grid';
  Object.entries(state.roleLabels || {}).forEach(([role, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'table-claim-btn';
    btn.textContent = `${roleVisual(role).icon} ${label}`;
    btn.onclick = () => {
      socket.emit('set_claim_assignment', { targetId: target.id, role });
    };
    roleGrid.appendChild(btn);
  });
  root.appendChild(roleGrid);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'table-action-row';
  buttonRow.appendChild(actionButton('내 주장 지우기', () => {
    socket.emit('clear_claim_assignment');
  }, true));

  if (includeVote) {
    buttonRow.appendChild(actionButton(`투표: ${target.name}`, () => {
      socket.emit('cast_vote', { targetId: target.id });
    }));
  }

  root.appendChild(buttonRow);

  if (state.me.voteTarget) {
    const myVote = state.players.find((p) => p.id === state.me.voteTarget);
    const line = document.createElement('p');
    line.className = 'muted';
    line.textContent = `내 투표: ${myVote ? myVote.name : '-'}`;
    root.appendChild(line);
  }
}

function buildVoteUI() {
  const root = getActionRoot();
  if (!root) return;
  root.innerHTML = '';
  if (!state || state.state !== 'vote') {
    return;
  }
  buildClaimAndVoteUI({ includeVote: true });
}

function buildRevealUI() {
  const root = getActionRoot();
  if (!root) return;
  root.innerHTML = '';
  if (!state || state.state !== 'reveal' || !state.result) {
    return;
  }

  const winner = document.createElement('p');
  winner.textContent = `승리 팀: ${state.result.winner === 'village' ? '마을 팀' : '늑대 팀'}`;
  root.appendChild(winner);

  const deadNames = (state.result.eliminatedIds || [])
    .map((id) => state.players.find((p) => p.id === id)?.name)
    .filter(Boolean);
  const dead = document.createElement('p');
  dead.className = 'muted';
  dead.textContent = deadNames.length ? `탈락: ${deadNames.join(', ')}` : '탈락: 없음';
  root.appendChild(dead);
}

function renderHostActions() {
  els.hostActions.innerHTML = '';
  if (!state || !state.me || state.hostId !== state.me.id) {
    return;
  }

  if (state.state === 'lobby') {
    const startBtn = actionButton('게임 시작', () => {
      socket.emit('start_game');
    });
    if (!state.deckReady) {
      startBtn.disabled = true;
      startBtn.classList.add('secondary');
      startBtn.title = `조합 ${state.deckTargetSize || ((state.players?.length || 0) + 3)}장을 먼저 확정하세요.`;
    }
    els.hostActions.appendChild(startBtn);
  }

  if (state.state === 'reveal') {
    const restartBtn = actionButton('게임 다시하기', () => {
      socket.emit('start_game');
    });
    if (!state.deckReady) {
      restartBtn.disabled = true;
      restartBtn.classList.add('secondary');
      restartBtn.title = `조합 ${state.deckTargetSize || ((state.players?.length || 0) + 3)}장을 먼저 확정하세요.`;
    }
    els.hostActions.appendChild(restartBtn);
  }

  if (state.state === 'day') {
    els.hostActions.appendChild(actionButton('투표 단계 시작', () => {
      socket.emit('start_vote');
    }, true));
  }

  if (state.state === 'vote') {
    els.hostActions.appendChild(actionButton('강제 결과 공개', () => {
      socket.emit('force_reveal');
    }, true));
  }
}

function renderPlayers() {
  els.playersList.innerHTML = '';
  if (!state) return;

  state.players.forEach((p) => {
    const tile = document.createElement('div');
    tile.className = 'player-tile';

    const top = document.createElement('div');
    top.className = 'player-top';
    const name = document.createElement('strong');
    name.textContent = p.name;

    const tags = document.createElement('div');
    tags.className = 'tags';
    if (p.isHost) {
      const hostTag = document.createElement('span');
      hostTag.className = 'tag';
      hostTag.textContent = '방장';
      tags.appendChild(hostTag);
    }
    top.appendChild(name);
    top.appendChild(tags);
    tile.appendChild(top);

    if (state.state === 'reveal') {
      const original = roleVisual(p.originalRole);
      const current = roleVisual(p.currentRole);

      const cardRow = document.createElement('div');
      cardRow.className = 'reveal-cards';

      const before = document.createElement('div');
      before.className = `role-card small tone-${original.tone}`;
      before.innerHTML = `<span class="icon">${original.icon}</span><span class="title">${roleLabel(p.originalRole)}</span><span class="hint">초기</span>`;

      const arrow = document.createElement('div');
      arrow.className = 'arrow';
      arrow.textContent = '→';

      const after = document.createElement('div');
      after.className = `role-card small tone-${current.tone}`;
      after.innerHTML = `<span class="icon">${current.icon}</span><span class="title">${roleLabel(p.currentRole)}</span><span class="hint">최종</span>`;

      cardRow.appendChild(before);
      cardRow.appendChild(arrow);
      cardRow.appendChild(after);
      tile.appendChild(cardRow);
    } else {
      const info = document.createElement('div');
      info.textContent = p.connected ? '접속 중' : '오프라인';
      info.className = 'muted';
      tile.appendChild(info);
    }

    if (p.claimRole) {
      const claim = document.createElement('div');
      claim.className = 'claim-pill';
      claim.textContent = `주장: ${claimText(p.claimRole)}`;
      tile.appendChild(claim);
      tile.appendChild(buildClaimReactionRow(p));
    }

    if (isFreshEmote(p)) {
      const emote = document.createElement('div');
      emote.className = 'claim-pill';
      emote.textContent = `감정: ${p.emote}`;
      tile.appendChild(emote);
    }

    els.playersList.appendChild(tile);
  });
}

function renderNotes() {
  if (!els.tableInfoFeed) return;
  els.tableInfoFeed.innerHTML = '';
  if (!state) return;

  const title = document.createElement('div');
  title.className = 'table-info-title';
  title.textContent = '내 정보 로그';
  els.tableInfoFeed.appendChild(title);

  const notes = state.notes || [];
  if (notes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'table-info-item muted';
    empty.textContent = '아직 확인한 정보가 없습니다.';
    els.tableInfoFeed.appendChild(empty);
    return;
  }

  notes.slice(-5).forEach((note) => {
    const item = document.createElement('div');
    item.className = 'table-info-item';
    item.textContent = note;
    els.tableInfoFeed.appendChild(item);
  });
}

function expandCatalogDeck(catalogCards) {
  const out = [];
  (catalogCards || []).forEach((item) => {
    for (let i = 0; i < item.count; i += 1) {
      out.push(item.role);
    }
  });
  return out;
}

function countDeckRoles(deck) {
  const counts = {};
  (deck || []).forEach((role) => {
    counts[role] = (counts[role] || 0) + 1;
  });
  return counts;
}

function renderCatalogCards() {
  els.catalogCards.innerHTML = '';
  if (!state || !Array.isArray(state.catalogCards) || !Array.isArray(state.availableRoleCards)) {
    return;
  }

  const isHost = state.me && state.hostId === state.me.id;
  const canEditDeck = isHost && (state.state === 'lobby' || state.state === 'reveal');
  const targetDeckSize = state.deckTargetSize || ((state.players?.length || 0) + 3);
  const serverDeck = expandCatalogDeck(state.catalogCards);

  if (!canEditDeck) {
    editableDeck = [];
  } else if (!Array.isArray(editableDeck) || editableDeck.length === 0) {
    editableDeck = [...serverDeck];
  }

  if (canEditDeck) {
    const maxByRole = {};
    state.availableRoleCards.forEach((c) => {
      maxByRole[c.role] = c.count;
    });

    const sanitized = [];
    const usedByRole = {};
    editableDeck.forEach((role) => {
      if (!maxByRole[role]) return;
      usedByRole[role] = (usedByRole[role] || 0) + 1;
      if (usedByRole[role] <= maxByRole[role]) {
        sanitized.push(role);
      }
    });
    editableDeck = sanitized.slice(0, targetDeckSize);

    const info = document.createElement('div');
    info.className = 'muted catalog-wide';
    info.textContent = `조합 편집: ${editableDeck.length}/${targetDeckSize}장 ${state.deckReady ? '(확정됨)' : '(미확정)'}`;
    els.catalogCards.appendChild(info);
    const selectedCount = (role) => editableDeck.filter((r) => r === role).length;

    const builder = document.createElement('div');
    builder.className = 'deck-builder catalog-wide';

    const availableZone = document.createElement('div');
    availableZone.className = 'deck-zone';
    availableZone.innerHTML = '<div class="deck-zone-title">카드 풀 (드래그 시작)</div>';

    const availableTokens = document.createElement('div');
    availableTokens.className = 'deck-token-wrap';
    Object.entries(maxByRole).forEach(([role, max]) => {
      const remain = max - selectedCount(role);
      for (let i = 0; i < remain; i += 1) {
        const t = document.createElement('div');
        t.className = `deck-token tone-${roleVisual(role).tone}`;
        t.draggable = true;
        t.textContent = `${roleVisual(role).icon} ${roleLabel(role)}`;
        t.dataset.role = role;
        t.dataset.from = 'pool';
        t.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData('text/plain', JSON.stringify({ role, from: 'pool' }));
        });
        availableTokens.appendChild(t);
      }
    });
    availableZone.appendChild(availableTokens);

    const selectedZone = document.createElement('div');
    selectedZone.className = 'deck-zone selected';
    selectedZone.innerHTML = `<div class="deck-zone-title">선택 조합 (${editableDeck.length}/${targetDeckSize})</div>`;

    const selectedTokens = document.createElement('div');
    selectedTokens.className = 'deck-token-wrap';
    editableDeck.forEach((role, idx) => {
      const t = document.createElement('div');
      t.className = `deck-token tone-${roleVisual(role).tone}`;
      t.draggable = true;
      t.textContent = `${roleVisual(role).icon} ${roleLabel(role)}`;
      t.dataset.role = role;
      t.dataset.from = 'selected';
      t.dataset.index = String(idx);
      t.title = '풀로 드래그하면 제거';
      t.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', JSON.stringify({ role, from: 'selected', index: idx }));
      });
      selectedTokens.appendChild(t);
    });
    selectedZone.appendChild(selectedTokens);

    const allowDrop = (zone) => {
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
    };
    allowDrop(availableZone);
    allowDrop(selectedZone);

    selectedZone.addEventListener('drop', (e) => {
      e.preventDefault();
      const raw = e.dataTransfer?.getData('text/plain');
      if (!raw) return;
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      const role = payload?.role;
      if (!role || !maxByRole[role]) return;
      if (payload.from === 'pool') {
        if (editableDeck.length >= targetDeckSize) return;
        if (selectedCount(role) >= maxByRole[role]) return;
        editableDeck.push(role);
        renderCatalogCards();
      }
    });

    availableZone.addEventListener('drop', (e) => {
      e.preventDefault();
      const raw = e.dataTransfer?.getData('text/plain');
      if (!raw) return;
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (payload?.from !== 'selected') return;
      const idx = Number(payload.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= editableDeck.length) return;
      editableDeck.splice(idx, 1);
      renderCatalogCards();
    });

    builder.appendChild(availableZone);
    builder.appendChild(selectedZone);
    els.catalogCards.appendChild(builder);

    const editor = document.createElement('div');
    editor.className = 'catalog-editor-row catalog-wide';

    const shuffleBtn = actionButton('선택 덱 셔플', () => {
      editableDeck = shuffleArray(editableDeck);
      renderCatalogCards();
    }, true);

    const randomBtn = actionButton('랜덤 조합', () => {
      const pool = [];
      (state.availableRoleCards || []).forEach((c) => {
        for (let i = 0; i < c.count; i += 1) pool.push(c.role);
      });
      editableDeck = shuffleArray(pool).slice(0, targetDeckSize);
      renderCatalogCards();
    }, true);

    const clearBtn = actionButton('전체 비우기', () => {
      editableDeck = [];
      renderCatalogCards();
    }, true);

    const applyBtn = actionButton('조합 적용', () => {
      if (editableDeck.length !== targetDeckSize) {
        setError(`조합은 정확히 ${targetDeckSize}장이어야 합니다.`);
        return;
      }
      socket.emit('set_round_deck', { deck: editableDeck });
      showToast('라운드 조합을 적용했습니다.', 'info');
    });

    editor.appendChild(shuffleBtn);
    editor.appendChild(randomBtn);
    editor.appendChild(clearBtn);
    editor.appendChild(applyBtn);
    els.catalogCards.appendChild(editor);
  }

  const deckToDisplay = canEditDeck ? editableDeck : serverDeck;
  const displayCounts = countDeckRoles(deckToDisplay);
  const displayCards = Object.keys(displayCounts).map((role) => ({
    role,
    count: displayCounts[role],
    label: roleLabel(role)
  }));

  if (!selectedCatalogRole || !state.roleLabels?.[selectedCatalogRole]) {
    selectedCatalogRole = displayCards[0]?.role || state.availableRoleCards[0]?.role || null;
  }

  if (displayCards.length === 0) {
    const line = document.createElement('p');
    line.className = 'muted catalog-wide';
    line.textContent = canEditDeck
      ? '아직 선택된 카드가 없습니다. 카드 풀에서 드래그해서 조합을 만드세요.'
      : '방장이 아직 라운드 조합을 확정하지 않았습니다.';
    els.catalogCards.appendChild(line);
  } else {
    displayCards.forEach((item) => {
      const visual = roleVisual(item.role);
      const box = document.createElement('div');
      box.className = `catalog-card tone-${visual.tone}`;
      if (selectedCatalogRole === item.role) {
        box.classList.add('selected');
      }
      box.innerHTML = `
        <span class="icon">${visual.icon}</span>
        <div class="meta">
          <strong>${item.label}</strong>
          <span class="muted">${item.count}장</span>
        </div>
      `;
      box.onclick = () => {
        selectedCatalogRole = item.role;
        renderCatalogCards();
      };
      els.catalogCards.appendChild(box);
    });
  }

  if (els.catalogDetail) {
    if (!selectedCatalogRole) {
      els.catalogDetail.textContent = '카드를 눌러 역할 설명을 확인하세요.';
    } else {
      const label = roleLabel(selectedCatalogRole);
      const desc = ROLE_DETAILS[selectedCatalogRole] || roleVisual(selectedCatalogRole).blurb;
      els.catalogDetail.textContent = `${label}\n${desc}`;
    }
  }
}

function renderEmoteBar() {
  if (!els.emoteBar) return;
  els.emoteBar.innerHTML = '';
  EMOTES.forEach((emote) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emote-btn';
    btn.textContent = emote;
    btn.onclick = () => {
      socket.emit('set_emote', { emote });
    };
    els.emoteBar.appendChild(btn);
  });
}

function seatPositions(count) {
  const preset = {
    3: [[50, 80], [20, 28], [80, 28]],
    4: [[50, 82], [18, 50], [50, 18], [82, 50]],
    5: [[50, 84], [20, 62], [28, 22], [72, 22], [80, 62]],
    6: [[50, 84], [22, 66], [20, 34], [50, 16], [80, 34], [78, 66]],
    7: [[50, 86], [24, 72], [16, 48], [28, 22], [72, 22], [84, 48], [76, 72]],
    8: [[50, 86], [28, 74], [16, 58], [16, 34], [50, 16], [84, 34], [84, 58], [72, 74]],
    9: [[50, 88], [30, 78], [18, 64], [14, 44], [28, 22], [72, 22], [86, 44], [82, 64], [70, 78]],
    10: [[50, 88], [32, 80], [20, 68], [14, 50], [20, 30], [40, 18], [60, 18], [80, 30], [86, 50], [80, 68]]
  };
  return preset[count] || preset[10];
}

function renderTableBoard() {
  if (!state || !state.me || !els.tableSeats || !els.tableCenterCards) {
    return;
  }

  els.tableSeats.innerHTML = '';
  els.tableCenterCards.innerHTML = '';
  const selectableSeats = selectableSeatIds();
  const selectableCenters = selectableCenterIndices();
  const selectedSeats = selectedSeatIdsForHighlight();
  const selectedCenters = selectedCenterIdsForHighlight();

  const meIndex = state.players.findIndex((p) => p.id === state.me.id);
  const ordered = meIndex >= 0
    ? state.players.slice(meIndex).concat(state.players.slice(0, meIndex))
    : state.players;

  const coords = seatPositions(ordered.length);
  ordered.forEach((p, idx) => {
    const seat = document.createElement('div');
    seat.className = 'seat';
    if (p.id === state.me.id) seat.classList.add('me');
    if (selectableSeats.has(p.id)) seat.classList.add('selectable');
    if (selectedSeats.has(p.id)) seat.classList.add('selected');
    seat.style.left = `${coords[idx][0]}%`;
    seat.style.top = `${coords[idx][1]}%`;

    const roleText = state.state === 'reveal'
      ? `${roleLabel(p.originalRole)} -> ${roleLabel(p.currentRole)}`
      : (p.connected ? '접속 중' : '오프라인');
    const claimLine = p.claimRole
      ? `주장: ${claimText(p.claimRole)} [👍${p.claimLikes || 0} 👎${p.claimDislikes || 0}]`
      : '';

    seat.innerHTML = `
      <div class="seat-name">${p.name}${p.id === state.me.id ? ' (나)' : ''}</div>
      <div class="seat-meta">${roleText}${claimLine ? `<br>${claimLine}` : ''}</div>
    `;
    if (isFreshEmote(p)) {
      const bubble = document.createElement('div');
      bubble.className = 'seat-emote';
      bubble.textContent = p.emote;
      seat.appendChild(bubble);
    }
    if (selectableSeats.has(p.id)) {
      seat.onclick = () => handleTableSeatClick(p.id);
    }
    els.tableSeats.appendChild(seat);
  });

  for (let i = 0; i < 3; i += 1) {
    const card = document.createElement('div');
    card.className = 'center-card';
    card.onclick = null;
    if (state.state === 'reveal' && state.center) {
      card.classList.add('open');
      card.textContent = roleLabel(state.center[i]);
    } else {
      card.textContent = '?';
    }

    if (selectedCenters.has(i)) {
      card.classList.add('picked');
    }

    if (selectableCenters.has(i)) {
      card.classList.add('preview');
      card.onclick = () => handleTableCenterClick(i);
    }
    els.tableCenterCards.appendChild(card);
  }
}

function renderVoteBoard() {
  if (!els.tableVoteBoard || !state) return;
  if (state.state !== 'reveal' || !state.result) {
    els.tableVoteBoard.classList.add('hidden');
    els.tableVoteBoard.innerHTML = '';
    return;
  }

  els.tableVoteBoard.classList.remove('hidden');
  const lines = [];
  state.players.forEach((p) => {
    const target = state.players.find((x) => x.id === p.voteTarget);
    const got = state.result.votes?.[p.id] || 0;
    lines.push(`${p.name}: 투표 → ${target ? target.name : '-'} / 받은 표 ${got}`);
  });

  const title = `투표 현황 (${state.result.winner === 'village' ? '마을 승리' : '늑대 승리'})`;
  els.tableVoteBoard.innerHTML = `
    <div class="table-vote-title">${title}</div>
    ${lines.map((l) => `<div class="table-vote-line">${l}</div>`).join('')}
  `;
}

function renderChat() {
  if (!els.chatList || !state) return;
  const list = Array.isArray(state.chatMessages) ? state.chatMessages : [];
  const nearBottom = els.chatList.scrollTop + els.chatList.clientHeight >= els.chatList.scrollHeight - 24;
  els.chatList.innerHTML = '';
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '아직 채팅이 없습니다.';
    els.chatList.appendChild(empty);
  } else {
    list.forEach((m) => {
      const item = document.createElement('div');
      item.className = 'chat-item';
      const t = new Date(m.ts || Date.now());
      const mm = String(t.getMinutes()).padStart(2, '0');
      const hh = String(t.getHours()).padStart(2, '0');
      const meta = document.createElement('div');
      meta.className = 'chat-meta';
      meta.textContent = `${m.name} · ${hh}:${mm}`;
      const text = document.createElement('div');
      text.className = 'chat-text';
      text.textContent = String(m.text || '');
      item.appendChild(meta);
      item.appendChild(text);
      els.chatList.appendChild(item);
    });
  }
  if (nearBottom) {
    els.chatList.scrollTop = els.chatList.scrollHeight;
  }
}

function renderActionPanel() {
  const root = getActionRoot();
  if (!root) return;
  if (!state) return;
  if (state.state === 'night') {
    buildNightActionUI();
    return;
  }
  if (state.state === 'vote') {
    buildVoteUI();
    return;
  }
  if (state.state === 'reveal') {
    buildRevealUI();
    return;
  }
  root.innerHTML = '';
  buildClaimAndVoteUI({ includeVote: false });
}

function renderMyCard() {
  els.myRoleCard.innerHTML = '';
  if (!state || !state.me?.originalRole) {
    return;
  }

  const displayRole = state.state === 'reveal' ? state.me.currentRole : state.me.originalRole;
  const visual = roleVisual(displayRole);
  const card = document.createElement('div');
  card.className = `role-card tone-${visual.tone}`;
  card.innerHTML = `
    <span class="icon">${visual.icon}</span>
    <div>
      <strong>${roleLabel(displayRole)}</strong>
      <p class="blurb">${visual.blurb}</p>
    </div>
  `;
  els.myRoleCard.appendChild(card);
}

function render() {
  if (!state) return;
  syncInteractionState();

  document.body.dataset.phase = state.state || 'lobby';
  els.connectCard.classList.add('hidden');
  els.gameCard.classList.remove('hidden');
  els.roomTitle.textContent = `방 코드: ${state.code}`;
  els.phaseLine.textContent = phaseTitle[state.state] || state.state;

  const myRole = state.me?.originalRole ? roleLabel(state.me.originalRole) : '-';
  const myCurrent = state.me?.currentRole ? roleLabel(state.me.currentRole) : '-';
  const roleText = state.state === 'reveal'
    ? `초기 역할: ${myRole} | 최종 역할: ${myCurrent}`
    : `초기 역할: ${myRole}`;
  els.youLine.textContent = `${state.me?.name || '-'} | ${roleText}`;
  if (els.myClaimLine) {
    const mine = (state.claimAssignments || []).filter((c) => c.asserterId === state.me.id).slice(-1)[0];
    els.myClaimLine.textContent = mine
      ? `내 최신 주장: ${mine.targetName} = ${claimText(mine.role)}`
      : '내 주장: 없음';
  }

  els.instructionLine.textContent = state.instruction || '';
  let statusText = `현재 단계: ${phaseTitle[state.state] || state.state}`;
  if (state.state === 'night' && state.turnProgress) {
    statusText += ` | 차례: ${state.turnProgress.activeRoleLabel}`;
  }
  if (state.state === 'lobby') {
    statusText += state.deckReady
      ? ` | 조합 확정 ${state.deckTargetSize}장`
      : ` | 방장이 조합 ${state.deckTargetSize}장을 먼저 선택해야 시작됩니다.`;
  }
  els.statusLine.textContent = statusText;

  renderClaimControls();
  renderClaimNarrative();
  renderEmoteBar();
  renderMyCard();
  renderTableBoard();
  renderVoteBoard();
  renderPlayers();
  renderChat();
  renderNotes();
  renderCatalogCards();
  renderActionPanel();
  renderHostActions();
  startTimer();
  syncDayBgm();
}

els.createBtn.onclick = () => {
  const name = els.nameInput.value.trim();
  if (!name) {
    setError('이름을 먼저 입력하세요.');
    return;
  }
  localStorage.setItem('onuw_name', name);
  socket.emit('create_room', { name, playerKey: getOrCreatePlayerKey() });
};

els.joinBtn.onclick = () => {
  const name = els.nameInput.value.trim();
  const rawCode = els.codeInput.value.trim();
  const code = /^\d{1,2}$/.test(rawCode) ? rawCode.padStart(2, '0') : rawCode.toUpperCase();
  if (!name || !code) {
    setError('이름과 방 코드를 입력하세요.');
    return;
  }
  localStorage.setItem('onuw_name', name);
  localStorage.setItem(STORAGE_ROOM_CODE, code);
  socket.emit('join_room', { code, name, playerKey: getOrCreatePlayerKey() });
};

if (els.soundBtn) {
  els.soundBtn.onclick = async () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('onuw_sound', soundEnabled ? 'on' : 'off');
    updateSoundButton();
    if (soundEnabled) {
      await unlockAudio();
    }
    syncDayBgm();
  };
}

if (els.claimClearBtn) {
  els.claimClearBtn.onclick = () => {
    socket.emit('clear_claim_assignment');
    showToast('내 주장을 지웠습니다.', 'info');
  };
}

if (els.chatSendBtn) {
  const sendChat = () => {
    const text = String(els.chatInput?.value || '').trim();
    if (!text) return;
    socket.emit('send_chat', { message: text });
    if (els.chatInput) els.chatInput.value = '';
  };
  els.chatSendBtn.onclick = sendChat;
  if (els.chatInput) {
    els.chatInput.addEventListener('compositionstart', () => {
      chatComposing = true;
    });
    els.chatInput.addEventListener('compositionend', () => {
      chatComposing = false;
    });
    els.chatInput.addEventListener('keydown', (e) => {
      if (chatComposing || e.isComposing || e.keyCode === 229) {
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
  }
}

socket.on('state', (nextState) => {
  if (currentRoomCode && currentRoomCode !== nextState?.code) {
    editableDeck = [];
    selectedClaimTargetId = '';
    resetTableSelections();
    interactionStateKey = '';
  }
  currentRoomCode = nextState?.code || '';
  state = nextState;
  if (nextState?.code) {
    localStorage.setItem(STORAGE_ROOM_CODE, nextState.code);
  }
  render();
});

socket.on('error_message', (message) => {
  setError(message);
});

socket.on('disconnect', (reason) => {
  showToast(`연결이 끊어졌습니다: ${reason}`, 'error');
});

socket.on('connect', () => {
  showToast('서버에 연결되었습니다.', 'info');
  const code = localStorage.getItem(STORAGE_ROOM_CODE);
  const name = localStorage.getItem('onuw_name') || '';
  if (!state && code) {
    socket.emit('resume_session', {
      code,
      name,
      playerKey: getOrCreatePlayerKey()
    });
  }
});

socket.on('connect_error', () => {
  showToast('서버 연결에 실패했습니다. 잠시 후 다시 시도하세요.', 'error');
});

socket.on('resume_failed', () => {
  localStorage.removeItem(STORAGE_ROOM_CODE);
});

(function boot() {
  const savedName = localStorage.getItem('onuw_name');
  const savedCode = localStorage.getItem(STORAGE_ROOM_CODE);
  if (savedName) els.nameInput.value = savedName;
  if (savedCode) els.codeInput.value = savedCode;
  getOrCreatePlayerKey();
  updateSoundButton();
  const unlockOnce = async () => {
    const ok = await unlockAudio();
    if (ok) {
      audioHintShown = false;
      syncDayBgm();
    }
  };
  window.addEventListener('pointerdown', unlockOnce, { once: true });
  window.addEventListener('touchstart', unlockOnce, { once: true });
  window.addEventListener('keydown', unlockOnce, { once: true });
})();
