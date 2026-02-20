const socket = io();

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
  timerPill: $('timerPill'),
  statusLine: $('statusLine'),
  youLine: $('youLine'),
  myRoleCard: $('myRoleCard'),
  instructionLine: $('instructionLine'),
  playersList: $('playersList'),
  notesList: $('notesList'),
  actionContent: $('actionContent'),
  hostActions: $('hostActions')
};

let state = null;
let timer = null;

const phaseTitle = {
  lobby: 'Lobby',
  night: 'Night',
  day: 'Day Discussion',
  vote: 'Vote',
  reveal: 'Reveal'
};

const ROLE_VISUAL = {
  villager: { icon: '🌾', tone: 'village', blurb: '평범한 주민. 토론이 생명.' },
  werewolf: { icon: '🐺', tone: 'wolf', blurb: '정체를 숨기고 살아남아라.' },
  seer: { icon: '🔮', tone: 'seer', blurb: '진실을 엿보는 예언자.' },
  robber: { icon: '🦝', tone: 'robber', blurb: '역할을 훔쳐 흐름을 뒤집는다.' },
  troublemaker: { icon: '🃏', tone: 'trouble', blurb: '두 사람의 운명을 바꾼다.' },
  drunk: { icon: '🍷', tone: 'drunk', blurb: '중앙 카드와 비밀 교환.' },
  insomniac: { icon: '🛌', tone: 'insomniac', blurb: '밤 끝에 내 정체를 확인.' }
};

function setError(msg) {
  els.statusLine.textContent = msg;
}

function roleLabel(role) {
  if (!state || !state.roleLabels || !role) return '-';
  return state.roleLabels[role] || role;
}

function roleVisual(role) {
  return ROLE_VISUAL[role] || { icon: '❓', tone: 'unknown', blurb: '정체 불명 역할' };
}

function fmtMs(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function startTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (!state || state.state !== 'day' || !state.dayEndsAt) {
      els.timerPill.textContent = '--:--';
      return;
    }
    els.timerPill.textContent = fmtMs(state.dayEndsAt - Date.now());
  }, 400);
}

function actionButton(text, onClick, secondary = false) {
  const btn = document.createElement('button');
  btn.textContent = text;
  if (secondary) btn.classList.add('secondary');
  btn.onclick = onClick;
  return btn;
}

function optionPlayers(includeSelf = false) {
  if (!state) return [];
  return state.players.filter((p) => includeSelf || p.id !== state.me.id);
}

function buildNightActionUI() {
  els.actionContent.innerHTML = '';
  if (!state || state.state !== 'night' || !state.me) {
    return;
  }

  const myOriginal = state.me.originalRole;
  const active = state.activeRole;

  if (!active || myOriginal !== active) {
    const line = document.createElement('p');
    line.className = 'muted';
    line.textContent = 'Wait for your role window.';
    els.actionContent.appendChild(line);
    return;
  }

  if (active === 'werewolf') {
    const isLone = (state.instruction || '').toLowerCase().includes('lone werewolf');
    if (!isLone) {
      els.actionContent.appendChild(actionButton('Confirm', () => {
        socket.emit('night_action', {});
      }));
      return;
    }

    const select = document.createElement('select');
    [0, 1, 2].forEach((idx) => {
      const o = document.createElement('option');
      o.value = String(idx);
      o.textContent = `center[${idx}]`;
      select.appendChild(o);
    });
    els.actionContent.appendChild(select);
    els.actionContent.appendChild(actionButton('View Center Card', () => {
      socket.emit('night_action', { centerIndex: Number(select.value) });
    }));
    return;
  }

  if (active === 'seer') {
    const playerSelect = document.createElement('select');
    optionPlayers(false).forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      playerSelect.appendChild(o);
    });

    const centerA = document.createElement('select');
    const centerB = document.createElement('select');
    [0, 1, 2].forEach((idx) => {
      const oa = document.createElement('option');
      oa.value = String(idx);
      oa.textContent = `center[${idx}]`;
      centerA.appendChild(oa);

      const ob = document.createElement('option');
      ob.value = String(idx);
      ob.textContent = `center[${idx}]`;
      centerB.appendChild(ob);
    });

    els.actionContent.appendChild(playerSelect);
    els.actionContent.appendChild(actionButton('View Selected Player', () => {
      socket.emit('night_action', { mode: 'player', targetId: playerSelect.value });
    }));

    const line = document.createElement('p');
    line.className = 'muted';
    line.textContent = 'or';
    els.actionContent.appendChild(line);
    els.actionContent.appendChild(centerA);
    els.actionContent.appendChild(centerB);
    els.actionContent.appendChild(actionButton('View Two Center Cards', () => {
      socket.emit('night_action', {
        mode: 'center',
        indices: [Number(centerA.value), Number(centerB.value)]
      });
    }));
    return;
  }

  if (active === 'robber') {
    const select = document.createElement('select');
    optionPlayers(false).forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      select.appendChild(o);
    });
    els.actionContent.appendChild(select);
    els.actionContent.appendChild(actionButton('Swap With Player', () => {
      socket.emit('night_action', { targetId: select.value });
    }));
    return;
  }

  if (active === 'troublemaker') {
    const a = document.createElement('select');
    const b = document.createElement('select');
    optionPlayers(false).forEach((p) => {
      const oa = document.createElement('option');
      oa.value = p.id;
      oa.textContent = p.name;
      a.appendChild(oa);

      const ob = document.createElement('option');
      ob.value = p.id;
      ob.textContent = p.name;
      b.appendChild(ob);
    });

    els.actionContent.appendChild(a);
    els.actionContent.appendChild(b);
    els.actionContent.appendChild(actionButton('Swap The Two Players', () => {
      socket.emit('night_action', { targetA: a.value, targetB: b.value });
    }));
    return;
  }

  if (active === 'drunk') {
    const select = document.createElement('select');
    [0, 1, 2].forEach((idx) => {
      const o = document.createElement('option');
      o.value = String(idx);
      o.textContent = `center[${idx}]`;
      select.appendChild(o);
    });
    els.actionContent.appendChild(select);
    els.actionContent.appendChild(actionButton('Swap With Center', () => {
      socket.emit('night_action', { centerIndex: Number(select.value) });
    }));
    return;
  }

  const line = document.createElement('p');
  line.className = 'muted';
  line.textContent = 'No action in this phase.';
  els.actionContent.appendChild(line);
}

function buildVoteUI() {
  els.actionContent.innerHTML = '';
  if (!state || state.state !== 'vote') {
    return;
  }

  const select = document.createElement('select');
  state.players.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    select.appendChild(o);
  });

  els.actionContent.appendChild(select);
  els.actionContent.appendChild(actionButton('Cast Vote', () => {
    socket.emit('cast_vote', { targetId: select.value });
  }));

  if (state.me && state.me.voteTarget) {
    const line = document.createElement('p');
    line.className = 'muted';
    const target = state.players.find((p) => p.id === state.me.voteTarget);
    line.textContent = `You voted: ${target ? target.name : '-'}`;
    els.actionContent.appendChild(line);
  }
}

function buildRevealUI() {
  els.actionContent.innerHTML = '';
  if (!state || state.state !== 'reveal' || !state.result) {
    return;
  }

  const winner = document.createElement('p');
  winner.textContent = `Winner: ${state.result.winner}`;
  els.actionContent.appendChild(winner);

  const deadNames = (state.result.eliminatedIds || [])
    .map((id) => state.players.find((p) => p.id === id)?.name)
    .filter(Boolean);
  const dead = document.createElement('p');
  dead.className = 'muted';
  dead.textContent = deadNames.length ? `Eliminated: ${deadNames.join(', ')}` : 'Eliminated: none';
  els.actionContent.appendChild(dead);
}

function renderHostActions() {
  els.hostActions.innerHTML = '';
  if (!state || !state.me || state.hostId !== state.me.id) {
    return;
  }

  if (state.state === 'lobby' || state.state === 'reveal') {
    els.hostActions.appendChild(actionButton('Start Game', () => {
      socket.emit('start_game');
    }));
  }

  if (state.state === 'day') {
    els.hostActions.appendChild(actionButton('Start Vote', () => {
      socket.emit('start_vote');
    }, true));
  }

  if (state.state === 'vote') {
    els.hostActions.appendChild(actionButton('Force Reveal', () => {
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
      hostTag.textContent = 'HOST';
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
      info.textContent = p.connected ? 'online' : 'offline';
      info.className = 'muted';
      tile.appendChild(info);
    }
    els.playersList.appendChild(tile);
  });
}

function renderNotes() {
  els.notesList.className = 'note-list';
  els.notesList.innerHTML = '';
  if (!state) return;

  (state.notes || []).forEach((note) => {
    const li = document.createElement('li');
    li.textContent = note;
    els.notesList.appendChild(li);
  });
}

function renderActionPanel() {
  if (!state) return;
  if (state.state === 'night') buildNightActionUI();
  if (state.state === 'vote') buildVoteUI();
  if (state.state === 'reveal') buildRevealUI();
  if (state.state === 'lobby' || state.state === 'day') {
    els.actionContent.innerHTML = '<p class="muted">No direct action here.</p>';
  }
}

function render() {
  if (!state) return;

  els.connectCard.classList.add('hidden');
  els.gameCard.classList.remove('hidden');
  els.roomTitle.textContent = `Room ${state.code}`;
  els.phaseLine.textContent = phaseTitle[state.state] || state.state;

  const myRole = state.me?.originalRole ? roleLabel(state.me.originalRole) : '-';
  const myCurrent = state.me?.currentRole ? roleLabel(state.me.currentRole) : '-';
  const roleText = state.state === 'reveal'
    ? `Original: ${myRole} | Final: ${myCurrent}`
    : `Original role: ${myRole}`;
  els.youLine.textContent = `${state.me?.name || '-'} | ${roleText}`;

  els.myRoleCard.innerHTML = '';
  if (state.me?.originalRole) {
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

  els.instructionLine.textContent = state.instruction || '';
  els.statusLine.textContent = `Phase: ${phaseTitle[state.state] || state.state}`;

  renderPlayers();
  renderNotes();
  renderActionPanel();
  renderHostActions();
  startTimer();
}

els.createBtn.onclick = () => {
  const name = els.nameInput.value.trim();
  if (!name) {
    setError('Enter your name first.');
    return;
  }
  localStorage.setItem('onuw_name', name);
  socket.emit('create_room', { name });
};

els.joinBtn.onclick = () => {
  const name = els.nameInput.value.trim();
  const code = els.codeInput.value.trim().toUpperCase();
  if (!name || !code) {
    setError('Enter name and room code.');
    return;
  }
  localStorage.setItem('onuw_name', name);
  localStorage.setItem('onuw_code', code);
  socket.emit('join_room', { code, name });
};

socket.on('state', (nextState) => {
  state = nextState;
  render();
});

socket.on('error_message', (message) => {
  setError(message);
});

(function boot() {
  const savedName = localStorage.getItem('onuw_name');
  const savedCode = localStorage.getItem('onuw_code');
  if (savedName) els.nameInput.value = savedName;
  if (savedCode) els.codeInput.value = savedCode;
})();
