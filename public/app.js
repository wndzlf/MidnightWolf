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
  catalogCards: $('catalogCards'),
  actionContent: $('actionContent'),
  hostActions: $('hostActions')
};

let state = null;
let timer = null;

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
  if (!state || !state.me) return [];
  return state.players.filter((p) => includeSelf || p.id !== state.me.id);
}

function buildNightActionUI() {
  els.actionContent.innerHTML = '';
  if (!state || state.state !== 'night' || !state.me) {
    return;
  }

  const active = state.activeRole;
  const hasMyTurn = Boolean(state.instruction);
  const progress = state.turnProgress;
  if (progress) {
    const turn = document.createElement('p');
    turn.className = 'muted';
    turn.textContent = `현재 차례: ${progress.activeRoleLabel} (${progress.acted}/${progress.required} 완료)`;
    els.actionContent.appendChild(turn);
  }

  if (progress && progress.meActed) {
    const done = document.createElement('p');
    done.className = 'muted';
    done.textContent = '내 행동 제출 완료. 모든 대상이 완료되면 자동으로 다음 차례로 넘어갑니다.';
    els.actionContent.appendChild(done);
    return;
  }

  if (!active || !hasMyTurn) {
    const line = document.createElement('p');
    line.className = 'muted';
    line.textContent = '내 역할 차례를 기다리는 중입니다. (자동 진행)';
    els.actionContent.appendChild(line);
    return;
  }

  if (active === 'doppelganger') {
    const select = document.createElement('select');
    optionPlayers(false).forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      select.appendChild(o);
    });
    els.actionContent.appendChild(select);
    els.actionContent.appendChild(actionButton('역할 복사', () => {
      socket.emit('night_action', { targetId: select.value });
    }));
    return;
  }

  if (active === 'werewolf') {
    const isLone = (state.instruction || '').includes('외로운 늑대');
    if (!isLone) {
      els.actionContent.appendChild(actionButton('확인 완료', () => {
        socket.emit('night_action', {});
      }));
      return;
    }

    const select = document.createElement('select');
    [0, 1, 2].forEach((idx) => {
      const o = document.createElement('option');
      o.value = String(idx);
      o.textContent = `중앙[${idx}]`;
      select.appendChild(o);
    });
    els.actionContent.appendChild(select);
    els.actionContent.appendChild(actionButton('중앙 카드 확인', () => {
      socket.emit('night_action', { centerIndex: Number(select.value) });
    }));
    return;
  }

  if (active === 'minion' || active === 'mason') {
    els.actionContent.appendChild(actionButton('확인 완료', () => {
      socket.emit('night_action', {});
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
      oa.textContent = `중앙[${idx}]`;
      centerA.appendChild(oa);

      const ob = document.createElement('option');
      ob.value = String(idx);
      ob.textContent = `중앙[${idx}]`;
      centerB.appendChild(ob);
    });

    els.actionContent.appendChild(playerSelect);
    els.actionContent.appendChild(actionButton('플레이어 1명 확인', () => {
      socket.emit('night_action', { mode: 'player', targetId: playerSelect.value });
    }));

    const line = document.createElement('p');
    line.className = 'muted';
    line.textContent = '또는';
    els.actionContent.appendChild(line);
    els.actionContent.appendChild(centerA);
    els.actionContent.appendChild(centerB);
    els.actionContent.appendChild(actionButton('중앙 2장 확인', () => {
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
    els.actionContent.appendChild(actionButton('카드 훔치기', () => {
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
    els.actionContent.appendChild(actionButton('두 사람 카드 교환', () => {
      socket.emit('night_action', { targetA: a.value, targetB: b.value });
    }));
    return;
  }

  if (active === 'drunk') {
    const select = document.createElement('select');
    [0, 1, 2].forEach((idx) => {
      const o = document.createElement('option');
      o.value = String(idx);
      o.textContent = `중앙[${idx}]`;
      select.appendChild(o);
    });
    els.actionContent.appendChild(select);
    els.actionContent.appendChild(actionButton('중앙 카드와 교환', () => {
      socket.emit('night_action', { centerIndex: Number(select.value) });
    }));
    return;
  }

  const line = document.createElement('p');
  line.className = 'muted';
  line.textContent = '이 단계에서는 행동이 없습니다.';
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
  els.actionContent.appendChild(actionButton('투표하기', () => {
    socket.emit('cast_vote', { targetId: select.value });
  }));

  if (state.me && state.me.voteTarget) {
    const line = document.createElement('p');
    line.className = 'muted';
    const target = state.players.find((p) => p.id === state.me.voteTarget);
    line.textContent = `내 투표: ${target ? target.name : '-'}`;
    els.actionContent.appendChild(line);
  }
}

function buildRevealUI() {
  els.actionContent.innerHTML = '';
  if (!state || state.state !== 'reveal' || !state.result) {
    return;
  }

  const winner = document.createElement('p');
  winner.textContent = `승리 팀: ${state.result.winner === 'village' ? '마을 팀' : '늑대 팀'}`;
  els.actionContent.appendChild(winner);

  const deadNames = (state.result.eliminatedIds || [])
    .map((id) => state.players.find((p) => p.id === id)?.name)
    .filter(Boolean);
  const dead = document.createElement('p');
  dead.className = 'muted';
  dead.textContent = deadNames.length ? `탈락: ${deadNames.join(', ')}` : '탈락: 없음';
  els.actionContent.appendChild(dead);
}

function renderHostActions() {
  els.hostActions.innerHTML = '';
  if (!state || !state.me || state.hostId !== state.me.id) {
    return;
  }

  if (state.state === 'lobby') {
    els.hostActions.appendChild(actionButton('게임 시작', () => {
      socket.emit('start_game');
    }));
  }

  if (state.state === 'reveal') {
    els.hostActions.appendChild(actionButton('게임 다시하기', () => {
      socket.emit('start_game');
    }));
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

function renderCatalogCards() {
  els.catalogCards.innerHTML = '';
  if (!state || !Array.isArray(state.catalogCards)) {
    return;
  }

  state.catalogCards.forEach((item) => {
    const visual = roleVisual(item.role);
    const box = document.createElement('div');
    box.className = `catalog-card tone-${visual.tone}`;
    box.innerHTML = `
      <span class="icon">${visual.icon}</span>
      <div class="meta">
        <strong>${item.label}</strong>
        <span class="muted">${item.count}장</span>
      </div>
    `;
    els.catalogCards.appendChild(box);
  });
}

function renderActionPanel() {
  if (!state) return;
  if (state.state === 'night') buildNightActionUI();
  if (state.state === 'vote') buildVoteUI();
  if (state.state === 'reveal') buildRevealUI();
  if (state.state === 'lobby' || state.state === 'day') {
    els.actionContent.innerHTML = '<p class="muted">현재 직접 행동은 없습니다.</p>';
  }
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

  els.instructionLine.textContent = state.instruction || '';
  let statusText = `현재 단계: ${phaseTitle[state.state] || state.state}`;
  if (state.state === 'night' && state.turnProgress) {
    statusText += ` | 차례: ${state.turnProgress.activeRoleLabel} (${state.turnProgress.acted}/${state.turnProgress.required})`;
  }
  els.statusLine.textContent = statusText;

  renderMyCard();
  renderPlayers();
  renderNotes();
  renderCatalogCards();
  renderActionPanel();
  renderHostActions();
  startTimer();
}

els.createBtn.onclick = () => {
  const name = els.nameInput.value.trim();
  if (!name) {
    setError('이름을 먼저 입력하세요.');
    return;
  }
  localStorage.setItem('onuw_name', name);
  socket.emit('create_room', { name });
};

els.joinBtn.onclick = () => {
  const name = els.nameInput.value.trim();
  const code = els.codeInput.value.trim().toUpperCase();
  if (!name || !code) {
    setError('이름과 방 코드를 입력하세요.');
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
