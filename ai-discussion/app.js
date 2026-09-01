'use strict';

const RELAY_BASE = 'http://127.0.0.1:8787';

const state = {
  step: 1,
  participantCount: 3,
  assignments: new Map(),
  started: false,
  finished: false,
  starting: false,
  remote: false,
  roomId: null,
  moderatorCondition: '',
  phase: 'waiting',
  freeTalkMinutes: 0,
  freeTalkUntil: 0,
  progressTimer: null,
  eventSource: null,
  remoteMessageIds: new Set()
};

const $ = selector => document.querySelector(selector);
const participantCount = $('#participantCount');
const countValue = $('#countValue');
const countHint = $('#countHint');
const topicInput = $('#topicInput');
const moderatorRules = $('#moderatorRules');
const assignmentCount = $('#assignmentCount');
const roleAssignments = $('#roleAssignments');
const nextButton = $('#nextButton');
const backButton = $('#backButton');
const setupCard = $('#setupCard');
const chatCard = $('#chatCard');
const progressLabel = $('#progressLabel');
const moderatorName = $('#moderatorName');
const rosterCount = $('#rosterCount');
const rosterList = $('#rosterList');
const speakerSelect = $('#speakerSelect');
const startButton = $('#startButton');
const resetButton = $('#resetButton');
const chatStatus = $('#chatStatus');
const freeTalkClock = $('#freeTalkClock');
const chatHint = $('#chatHint');
const relayStatus = $('#relayStatus');
const messages = $('#messages');
const emptyChat = $('#emptyChat');
const chatForm = $('#chatForm');
const messageInput = $('#messageInput');
const sendButton = $('#sendButton');

function roles() {
  return ['사회자', ...Array.from(
    { length: state.participantCount },
    (_, index) => `토론자${index + 1}`
  )];
}

function syncCountText() {
  countValue.value = `${state.participantCount}명`;
  countValue.textContent = `${state.participantCount}명`;
  countHint.textContent = `사회자 1명과 토론자 ${state.participantCount}명이 대화에 참여합니다.`;
}

function setRelayStatus(text, className = '') {
  relayStatus.textContent = text;
  relayStatus.className = `relay-status${className ? ` ${className}` : ''}`;
}

function formatClock(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function updateRoomProgress(room = {}) {
  state.phase = room.phase || state.phase || 'waiting';
  if (Object.hasOwn(room, 'freeTalkMinutes')) state.freeTalkMinutes = Number(room.freeTalkMinutes || 0);
  if (Object.hasOwn(room, 'freeTalkUntil')) state.freeTalkUntil = Number(room.freeTalkUntil || 0);
  window.clearInterval(state.progressTimer);
  state.progressTimer = null;

  const renderClock = () => {
    const remaining = Math.max(0, Math.ceil((state.freeTalkUntil - Date.now()) / 1000));
    const activeFreeTalk = state.started && !state.finished && state.freeTalkUntil && remaining > 0;
    if (activeFreeTalk) {
      freeTalkClock.hidden = false;
      freeTalkClock.textContent = `자유 토론 ${formatClock(remaining)}`;
      return true;
    }
    freeTalkClock.hidden = !state.freeTalkUntil || state.finished;
    if (state.freeTalkUntil && !state.finished && remaining === 0) {
      freeTalkClock.textContent = '자유 토론 시간 종료';
    }
    return false;
  };

  if (state.finished || room.finished || state.phase === 'finished') {
    chatStatus.textContent = '종료';
    chatStatus.classList.remove('is-live');
  } else if (!state.started) {
    chatStatus.textContent = '시작 전';
    chatStatus.classList.remove('is-live');
  } else if (state.phase === 'free-talk') {
    chatStatus.textContent = '자유 토론';
    chatStatus.classList.add('is-live');
  } else {
    chatStatus.textContent = state.phase === 'review' ? '사회자 정리' : '사회자 진행';
    chatStatus.classList.add('is-live');
  }

  if (renderClock()) {
    state.progressTimer = window.setInterval(() => {
      if (!renderClock()) window.clearInterval(state.progressTimer);
    }, 1000);
  }
}

function showStep(step) {
  state.step = step;
  document.querySelectorAll('[data-step-panel]').forEach(panel => {
    panel.hidden = Number(panel.dataset.stepPanel) !== step;
  });
  document.querySelectorAll('[data-step-indicator]').forEach(indicator => {
    indicator.classList.toggle('is-current', Number(indicator.dataset.stepIndicator) === step);
  });
  progressLabel.textContent = `${step} / 2`;
  backButton.hidden = step === 1;
  nextButton.textContent = step === 1 ? '다음: 대화명 선택' : '다음: 대화창 열기';
  nextButton.disabled = step === 2 && state.assignments.size !== roles().length;
}

function renderRoleAssignments() {
  const availableRoles = roles();
  for (const role of state.assignments.keys()) {
    if (!availableRoles.includes(role)) state.assignments.delete(role);
  }

  roleAssignments.replaceChildren();
  availableRoles.forEach(role => {
    const field = document.createElement('label');
    field.className = `role-field${role === '사회자' ? ' is-moderator' : ''}`;

    const roleText = document.createElement('span');
    roleText.textContent = role === '사회자' ? '시작 권한 · 사회자' : role;

    const select = document.createElement('select');
    select.setAttribute('aria-label', `${role} 대화명`);
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '대화명 선택';
    select.append(placeholder);

    availableRoles.forEach(alias => {
      const option = document.createElement('option');
      option.value = alias;
      option.textContent = alias;
      const selectedByOther = [...state.assignments.entries()]
        .some(([otherRole, selected]) => otherRole !== role && selected === alias);
      option.disabled = selectedByOther;
      select.append(option);
    });

    select.value = state.assignments.get(role) || '';
    select.addEventListener('change', () => {
      if (select.value) state.assignments.set(role, select.value);
      else state.assignments.delete(role);
      renderRoleAssignments();
    });

    field.append(roleText, select);
    roleAssignments.append(field);
  });

  assignmentCount.value = `${state.assignments.size} / ${availableRoles.length} 선택`;
  assignmentCount.textContent = `${state.assignments.size} / ${availableRoles.length} 선택`;
  nextButton.disabled = state.assignments.size !== availableRoles.length;
}

function addSystemMessage(text) {
  const item = document.createElement('p');
  item.className = 'system-message';
  item.textContent = text;
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

function addMessage(speaker, text, roleOverride = '') {
  if (emptyChat.isConnected) emptyChat.remove();
  const role = roleOverride || [...state.assignments.entries()]
    .find(([, alias]) => alias === speaker)?.[0] || '토론자';
  const item = document.createElement('article');
  item.className = `message${role === '사회자' ? ' is-moderator' : ''}`;

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const speakerLabel = document.createElement('span');
  speakerLabel.className = 'message-speaker';
  speakerLabel.textContent = speaker;
  const roleLabel = document.createElement('span');
  roleLabel.className = 'message-role';
  roleLabel.textContent = role;
  const timeLabel = document.createElement('time');
  timeLabel.className = 'message-time';
  timeLabel.textContent = new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit', minute: '2-digit'
  }).format(new Date());

  const body = document.createElement('p');
  body.className = 'message-body';
  body.textContent = text;
  meta.append(speakerLabel, roleLabel, timeLabel);
  item.append(meta, body);
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

function renderChat() {
  const availableRoles = roles();
  const moderator = state.assignments.get('사회자');
  moderatorName.textContent = moderator;
  rosterCount.textContent = `${availableRoles.length}명`;
  rosterList.replaceChildren();
  speakerSelect.replaceChildren();

  const userOption = document.createElement('option');
  userOption.value = '__user__';
  userOption.textContent = '사용자 개입';
  speakerSelect.append(userOption);

  availableRoles.forEach(role => {
    const alias = state.assignments.get(role);
    const option = document.createElement('option');
    option.value = alias;
    option.textContent = `${alias} · ${role}`;
    speakerSelect.append(option);

    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = alias;
    const roleText = document.createElement('small');
    roleText.textContent = role;
    item.append(name, roleText);
    rosterList.append(item);
  });

  speakerSelect.value = moderator;
  state.finished = false;
  state.phase = 'waiting';
  state.freeTalkMinutes = 0;
  state.freeTalkUntil = 0;
  updateRoomProgress();
  chatHint.textContent = `사회자 ${moderator}님이 시작을 누르면 채팅창이 활성화됩니다.`;
  startButton.textContent = `${moderator}로 시작`;
  startButton.disabled = false;
  speakerSelect.disabled = true;
  messageInput.disabled = true;
  sendButton.disabled = true;
  messages.replaceChildren(emptyChat);
  emptyChat.hidden = false;
  setRelayStatus('로컬 중계 서버 확인 전');
}

function openChat() {
  state.started = false;
  setupCard.hidden = true;
  chatCard.hidden = false;
  renderChat();
  chatCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function relayRequest(path, options = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), options.timeout || 1800);
  try {
    const response = await fetch(`${RELAY_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const body = await response.text();
    let data = null;
    if (body) {
      try { data = JSON.parse(body); } catch { data = { message: body }; }
    }
    if (!response.ok) throw new Error(data?.error || `중계 서버 오류 (${response.status})`);
    return data;
  } finally {
    window.clearTimeout(timer);
  }
}

function connectRoomEvents() {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = new EventSource(`${RELAY_BASE}/api/rooms/${encodeURIComponent(state.roomId)}/events`);
  state.eventSource.addEventListener('snapshot', event => {
    const snapshot = JSON.parse(event.data);
    state.moderatorCondition = snapshot.moderatorCondition || '';
    state.started = Boolean(snapshot.started);
    state.finished = Boolean(snapshot.finished);
    updateRoomProgress(snapshot);
    updateAgentStatus(snapshot.agents || []);
    (snapshot.messages || []).forEach(handleRemoteMessage);
  });
  state.eventSource.addEventListener('message', event => handleRemoteMessage(JSON.parse(event.data)));
  state.eventSource.addEventListener('system', event => {
    const data = JSON.parse(event.data);
    addSystemMessage(data.text);
  });
  state.eventSource.addEventListener('agent', event => {
    const data = JSON.parse(event.data);
    updateAgentStatus(data.agents || []);
  });
  state.eventSource.addEventListener('room', event => {
    const room = JSON.parse(event.data);
    state.moderatorCondition = room.moderatorCondition || '';
    state.started = Boolean(room.started);
    state.finished = Boolean(room.finished);
    updateRoomProgress(room);
    updateAgentStatus(room.agents || []);
    if (room.finished) finishRemoteChat(room.finishReason);
  });
  state.eventSource.addEventListener('error', event => {
    if (event?.data) {
      try { addSystemMessage(JSON.parse(event.data).text || '에이전트 오류가 발생했습니다.'); } catch { /* ignore */ }
    }
  });
  state.eventSource.onerror = () => {
    if (state.remote) setRelayStatus('중계 서버 연결이 끊겼습니다.', 'is-error');
  };
}

function finishRemoteChat(reason = 'moderator') {
  state.started = false;
  state.finished = true;
  state.phase = 'finished';
  updateRoomProgress({ finished: true, phase: 'finished' });
  chatStatus.textContent = '종료';
  chatStatus.classList.remove('is-live');
  startButton.textContent = '토론 종료됨';
  startButton.disabled = true;
  speakerSelect.disabled = true;
  messageInput.disabled = true;
  sendButton.disabled = true;
  chatHint.textContent = reason === 'user'
    ? '사용자가 토론을 종료했습니다.'
    : '사회자 AI가 사용자가 정한 종료 조건을 충족해 토론을 종료했습니다.';
}

function handleRemoteMessage(message) {
  if (!message || state.remoteMessageIds.has(message.id)) return;
  state.remoteMessageIds.add(message.id);
  addMessage(message.speaker, message.text, message.role);
}

function updateAgentStatus(agents) {
  const connected = agents.filter(agent => agent.connected !== false).length;
  const total = roles().length;
  setRelayStatus(`로컬 중계 서버 연결됨 · 에이전트 ${connected}/${total}명`, 'is-connected');
  if (state.remote && state.started) {
    chatHint.textContent = state.moderatorCondition
      ? `사회자 종료 조건: ${state.moderatorCondition}`
      : '사회자 CLI 터미널에서 토론 종료 조건을 입력하면 자동 토론이 시작됩니다.';
  }
}

async function createRemoteRoom() {
  const roster = roles().map(role => ({ role, alias: state.assignments.get(role) }));
  const data = await relayRequest('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({
      topic: topicInput.value.trim() || '자유 토론',
      rules: moderatorRules.value.trim() || '존댓말을 사용하고, 한 번에 한 명씩 발언하세요. 5분동안 자유로운 토론을 진행하세요.',
      roster
    })
  });
  state.roomId = data.room.id;
  state.remote = true;
  state.moderatorCondition = data.room.moderatorCondition || '';
  state.freeTalkMinutes = Number(data.room.freeTalkMinutes || 0);
  state.freeTalkUntil = Number(data.room.freeTalkUntil || 0);
  state.phase = data.room.phase || 'waiting';
  state.remoteMessageIds.clear();
  connectRoomEvents();
  updateAgentStatus(data.room.agents || []);
}

function applyLiveUi() {
  state.started = true;
  state.finished = false;
  if (!state.remote) state.phase = 'moderated';
  chatStatus.textContent = '진행 중';
  chatStatus.classList.add('is-live');
  startButton.textContent = state.remote ? '토론 종료' : '토론 진행 중';
  startButton.disabled = !state.remote;
  speakerSelect.disabled = state.remote;
  speakerSelect.value = state.remote ? '__user__' : speakerSelect.value;
  messageInput.disabled = false;
  sendButton.disabled = false;
  chatHint.textContent = state.remote
    ? '사회자 CLI 터미널에서 토론 종료 조건을 입력하면 자동 토론이 시작됩니다.'
    : '발언자를 선택하고 메시지를 입력하세요.';
  messageInput.placeholder = state.remote ? 'AI 토론에 개입할 메시지를 입력하세요' : '대화를 입력하세요';
  messageInput.focus();
}

async function stopChat() {
  if (!state.remote || !state.roomId || !state.started) return;
  startButton.disabled = true;
  chatHint.textContent = '토론을 종료하는 중입니다...';
  try {
    await relayRequest(`/api/rooms/${encodeURIComponent(state.roomId)}/stop`, { method: 'POST' });
  } catch (error) {
    startButton.disabled = false;
    chatHint.textContent = state.moderatorCondition
      ? `사회자 종료 조건: ${state.moderatorCondition}`
      : '사회자 CLI 터미널에서 토론 종료 조건을 입력하면 자동 토론이 시작됩니다.';
    addSystemMessage(`토론 종료 요청에 실패했습니다. ${error.message}`);
  }
}

async function startChat() {
  if (state.starting || state.started) return;
  state.starting = true;
  startButton.disabled = true;
  chatHint.textContent = '로컬 중계 서버에 연결하는 중입니다...';

  try {
    await createRemoteRoom();
    applyLiveUi();
    await relayRequest(`/api/rooms/${encodeURIComponent(state.roomId)}/start`, { method: 'POST' });
  } catch (error) {
    closeRoomEvents();
    state.remote = false;
    state.roomId = null;
    setRelayStatus('중계 서버 없음 · 브라우저 시험 모드', 'is-error');
    applyLiveUi();
    addSystemMessage('로컬 중계 서버에 연결되지 않아 브라우저 시험 모드로 시작했습니다.');
  } finally {
    state.starting = false;
  }
}

function closeRoomEvents() {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = null;
}

function resetRoom() {
  closeRoomEvents();
  window.clearInterval(state.progressTimer);
  state.progressTimer = null;
  state.step = 1;
  state.participantCount = 3;
  state.assignments.clear();
  state.started = false;
  state.finished = false;
  state.starting = false;
  state.remote = false;
  state.roomId = null;
  state.moderatorCondition = '';
  state.phase = 'waiting';
  state.freeTalkMinutes = 0;
  state.freeTalkUntil = 0;
  state.remoteMessageIds.clear();
  participantCount.value = '3';
  syncCountText();
  chatCard.hidden = true;
  setupCard.hidden = false;
  renderRoleAssignments();
  showStep(1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

participantCount.addEventListener('input', () => {
  state.participantCount = Number(participantCount.value);
  syncCountText();
  if (state.step === 2) renderRoleAssignments();
});

nextButton.addEventListener('click', () => {
  if (state.step === 1) {
    renderRoleAssignments();
    showStep(2);
    return;
  }
  if (state.assignments.size === roles().length) openChat();
});

backButton.addEventListener('click', () => showStep(1));
startButton.addEventListener('click', () => {
  if (state.remote && state.started) void stopChat();
  else void startChat();
});
resetButton.addEventListener('click', resetRoom);

chatForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.started) return;
  const text = messageInput.value.trim();
  if (!text) return;

  if (state.remote) {
    sendButton.disabled = true;
    try {
      await relayRequest(`/api/rooms/${encodeURIComponent(state.roomId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text })
      });
      messageInput.value = '';
    } catch (error) {
      addSystemMessage(`메시지를 보내지 못했습니다: ${error.message}`);
    } finally {
      sendButton.disabled = false;
      messageInput.focus();
    }
    return;
  }

  const selectedSpeaker = speakerSelect.value === '__user__' ? '사용자' : speakerSelect.value;
  addMessage(selectedSpeaker, text, selectedSpeaker === '사용자' ? '사용자' : '');
  messageInput.value = '';
  messageInput.focus();
});

messageInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

syncCountText();
renderRoleAssignments();
showStep(1);
