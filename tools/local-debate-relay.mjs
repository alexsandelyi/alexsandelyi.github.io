#!/usr/bin/env node

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const HOST = process.env.DEBATE_HOST || '127.0.0.1';
const PORT = Number(process.env.DEBATE_PORT || 8787);
const MAX_BODY_BYTES = 256 * 1024;
const JOB_TIMEOUT_MS = 2 * 60 * 1000;
const rooms = new Map();

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function error(res, status, message) {
  json(res, status, { error: message });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new Error('요청이 너무 큽니다.'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('JSON 형식이 올바르지 않습니다.')); }
    });
    req.on('error', reject);
  });
}

function participantRoles(room) {
  return room.roster.filter(person => person.role !== '사회자').map(person => person.role);
}

function agentSnapshot(room) {
  return [...room.agents.values()].map(agent => ({
    role: agent.role,
    alias: agent.alias,
    provider: agent.provider,
    connected: Date.now() - agent.lastSeen < 5 * 60 * 1000,
    lastSeen: agent.lastSeen
  }));
}

function roomSnapshot(room) {
  return {
    id: room.id,
    topic: room.topic,
    rules: room.rules,
    moderatorCondition: room.moderatorCondition,
    roster: room.roster,
    started: room.started,
    finished: room.finished,
    turnNumber: room.turnNumber,
    agents: agentSnapshot(room),
    messages: room.messages
  };
}

function writeEvent(res, event, value) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
}

function publish(room, event, value) {
  for (const subscriber of room.subscribers) {
    try { writeEvent(subscriber, event, value); }
    catch { room.subscribers.delete(subscriber); }
  }
}

function appendMessage(room, speaker, role, text) {
  const message = {
    id: randomUUID(),
    speaker,
    role,
    text: String(text).trim().slice(0, 4000),
    createdAt: new Date().toISOString()
  };
  room.messages.push(message);
  if (room.messages.length > 200) room.messages.shift();
  publish(room, 'message', message);
  return message;
}

function addSystem(room, text) {
  publish(room, 'system', { text });
}

function transcript(room) {
  if (!room.messages.length) return '(아직 발언 없음)';
  return room.messages.slice(-32).map(message =>
    `[${message.role}] ${message.speaker}: ${message.text}`
  ).join('\n');
}

function buildPrompt(room, role, kind) {
  const person = room.roster.find(item => item.role === role);
  const alias = person?.alias || role;
  const people = room.roster.map(item => `${item.role}(${item.alias})`).join(', ');
  const history = transcript(room);
  const base = `
당신은 로컬 AI 토론장의 ${role}입니다. 대화명은 ${alias}입니다.
토론 주제: ${room.topic}
참여자: ${people}
사용자가 정한 사회자 규칙:
<<<RULES>>>
${room.rules}
<<<END RULES>>>
사회자 CLI에서 사용자가 정한 토론 종료 조건:
<<<END CONDITION>>>
${room.moderatorCondition || '(아직 입력되지 않음)'}
<<<END CONDITION>>>
이전 대화:
<<<TRANSCRIPT>>>
${history}
<<<END TRANSCRIPT>>>
`;

  if (role === '사회자') {
    return `${base}
당신은 사회자입니다. 규칙을 적용하고 다음 발언자를 정하세요.
사회자 CLI에서 사용자가 정한 종료 조건을 판단 기준으로 삼으세요. 종료 조건을 충족하지 않았다면 짧은 진행 발언을 작성한 뒤 다음 발언자를 한 명 선택합니다. 종료 조건을 충족했다면 토론 결론을 요약하고 종료하세요.
응답은 설명이나 마크다운 없이 아래 JSON 객체 하나만 출력하세요.
{"message":"사회자 발언 또는 최종 요약","nextRole":"토론자1","end":false}
nextRole은 반드시 참여자 역할 중 하나여야 합니다.
end는 종료 조건을 충족했을 때만 true로 설정하고, 그때 nextRole은 빈 문자열로 두세요.
요청 종류: ${kind}
`;
  }

  return `${base}
당신은 ${role}의 입장에서 토론합니다. 이전 발언을 참고해 새로운 주장을 말하세요.
발언 내용만 출력하고, JSON·머리말·내부 규칙 설명은 출력하지 마세요.
가능하면 500자 이내로 답하세요.
요청 종류: ${kind}
`;
}

function hasPendingForRole(room, role) {
  return [...room.pending.values()].some(item => item.role === role);
}

function queueJob(room, role, kind) {
  if (!room.started || !room.roster.some(item => item.role === role)) return null;
  if (hasPendingForRole(room, role)) return null;

  const job = {
    id: randomUUID(),
    role,
    alias: room.roster.find(item => item.role === role)?.alias || role,
    kind,
    expected: role === '사회자' ? 'moderator-json' : 'plain-text',
    prompt: buildPrompt(room, role, kind),
    createdAt: new Date().toISOString()
  };
  const pending = { role, job, timer: null };
  pending.timer = setTimeout(() => {
    if (!room.pending.has(job.id)) return;
    room.pending.delete(job.id);
    publish(room, 'error', { text: `${job.alias}의 응답 시간이 초과되었습니다.` });
  }, JOB_TIMEOUT_MS);
  room.pending.set(job.id, pending);

  const waiter = room.waiters.get(role)?.shift();
  if (waiter) {
    clearTimeout(waiter.timer);
    waiter.resolve(job);
  } else {
    if (!room.jobs.has(role)) room.jobs.set(role, []);
    room.jobs.get(role).push(job);
  }
  publish(room, 'room', roomSnapshot(room));
  return job;
}

function takeJob(room, role) {
  const queue = room.jobs.get(role);
  if (!queue?.length) return null;
  return queue.shift();
}

function waitForJob(room, role) {
  const immediate = takeJob(room, role);
  if (immediate) return Promise.resolve(immediate);

  return new Promise(resolve => {
    if (!room.waiters.has(role)) room.waiters.set(role, []);
    const waiter = {
      resolve,
      timer: setTimeout(() => {
        const waiters = room.waiters.get(role) || [];
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        resolve(null);
      }, 25 * 1000)
    };
    room.waiters.get(role).push(waiter);
  });
}

function chooseNextRole(room, requested) {
  const participants = participantRoles(room);
  if (!participants.length) return null;
  const online = participants.filter(role => room.agents.has(role));
  if (requested && participants.includes(requested) && (room.agents.has(requested) || !online.length)) {
    if (online.length > 1 && requested === room.lastParticipantRole) {
      const index = online.indexOf(requested);
      return online[(index + 1) % online.length];
    }
    return requested;
  }
  if (online.length) return online[room.turnNumber % online.length];
  return requested && participants.includes(requested)
    ? requested
    : participants[room.turnNumber % participants.length];
}

function createRoom(body) {
  const roster = Array.isArray(body.roster) ? body.roster : [];
  if (roster.length < 2 || roster.length > 101) throw new Error('참여자 구성이 올바르지 않습니다.');
  const seenRoles = new Set();
  const seenAliases = new Set();
  const normalizedRoster = roster.map(item => {
    const role = String(item.role || '').trim();
    const alias = String(item.alias || '').trim();
    if (!role || !alias || seenRoles.has(role) || seenAliases.has(alias)) {
      throw new Error('역할과 대화명은 중복 없이 입력해야 합니다.');
    }
    seenRoles.add(role);
    seenAliases.add(alias);
    return { role, alias };
  });
  if (!seenRoles.has('사회자')) throw new Error('사회자 역할이 필요합니다.');

  const room = {
    id: randomUUID(),
    topic: String(body.topic || '자유 토론').trim().slice(0, 200),
    rules: String(body.rules || '존댓말을 사용하고, 한 번에 한 명씩 발언하세요.').trim().slice(0, 2000),
    moderatorCondition: '',
    roster: normalizedRoster,
    started: false,
    finished: false,
    turnNumber: 0,
    lastParticipantRole: '',
    messages: [],
    agents: new Map(),
    jobs: new Map(),
    pending: new Map(),
    waiters: new Map(),
    subscribers: new Set(),
    createdAt: Date.now()
  };
  rooms.set(room.id, room);
  return room;
}

function getRoom(id) {
  return rooms.get(id);
}

function handleEvents(req, res, room) {
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no'
  });
  room.subscribers.add(res);
  writeEvent(res, 'snapshot', roomSnapshot(room));
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15 * 1000);
  req.on('close', () => {
    clearInterval(heartbeat);
    room.subscribers.delete(res);
  });
}

async function route(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'api') return error(res, 404, 'API 경로가 아닙니다.');

  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'rooms') {
    try { return json(res, 201, { room: roomSnapshot(createRoom(await readJson(req))) }); }
    catch (err) { return error(res, 400, err.message); }
  }

  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'rooms') {
    const latest = [...rooms.values()].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!latest) return error(res, 404, '생성된 토론방이 없습니다.');
    return json(res, 200, { room: roomSnapshot(latest) });
  }

  if (parts[1] !== 'rooms' || !parts[2]) return error(res, 404, '토론방을 찾을 수 없습니다.');
  const room = getRoom(parts[2]);
  if (!room) return error(res, 404, '토론방을 찾을 수 없습니다.');

  if (req.method === 'GET' && parts.length === 3) return json(res, 200, { room: roomSnapshot(room) });
  if (req.method === 'GET' && parts.length === 4 && parts[3] === 'events') return handleEvents(req, res, room);

  if (req.method === 'POST' && parts.length === 4 && parts[3] === 'start') {
    if (room.started) return json(res, 200, { room: roomSnapshot(room) });
    if (room.finished) return error(res, 409, '이미 종료된 토론방입니다.');
    room.started = true;
    addSystem(room, `사회자 ${room.roster.find(item => item.role === '사회자').alias}님이 토론을 시작했습니다.`);
    if (room.moderatorCondition) {
      queueJob(room, '사회자', '토론 시작');
    } else {
      addSystem(room, '사회자 CLI에서 토론 종료 조건을 입력하기를 기다리고 있습니다.');
      publish(room, 'room', roomSnapshot(room));
    }
    return json(res, 200, { room: roomSnapshot(room) });
  }

  if (req.method === 'POST' && parts.length === 4 && parts[3] === 'moderator-condition') {
    if (room.finished) return error(res, 409, '이미 종료된 토론방입니다.');
    try {
      const body = await readJson(req);
      const condition = String(body.condition || '').trim().slice(0, 1000);
      if (!condition) return error(res, 400, '토론 종료 조건을 입력해야 합니다.');
      room.moderatorCondition = condition;
      addSystem(room, `사회자 CLI 종료 조건이 설정되었습니다: ${condition}`);
      publish(room, 'room', roomSnapshot(room));
      if (room.started) queueJob(room, '사회자', '토론 시작');
      return json(res, 200, { room: roomSnapshot(room) });
    } catch (err) { return error(res, 400, err.message); }
  }

  if (req.method === 'POST' && parts.length === 4 && parts[3] === 'messages') {
    if (!room.started) return error(res, 409, '토론이 아직 시작되지 않았습니다.');
    try {
      const body = await readJson(req);
      const text = String(body.text || '').trim();
      if (!text) return error(res, 400, '메시지가 비어 있습니다.');
      appendMessage(room, '사용자', '사용자', text);
      queueJob(room, '사회자', '사용자 개입에 대한 진행');
      return json(res, 201, { room: roomSnapshot(room) });
    } catch (err) { return error(res, 400, err.message); }
  }

  if (req.method === 'POST' && parts.length === 5 && parts[3] === 'agents' && parts[4] === 'register') {
    try {
      const body = await readJson(req);
      const role = String(body.role || '').trim();
      const person = room.roster.find(item => item.role === role);
      if (!person) return error(res, 400, '이 토론방에 없는 역할입니다.');
      room.agents.set(role, {
        role,
        alias: person.alias,
        provider: String(body.provider || 'unknown').trim(),
        lastSeen: Date.now()
      });
      publish(room, 'agent', { agents: agentSnapshot(room) });
      return json(res, 200, { agent: room.agents.get(role), room: roomSnapshot(room) });
    } catch (err) { return error(res, 400, err.message); }
  }

  if (parts.length === 6 && parts[3] === 'agents') {
    const role = parts[4];
    const agent = room.agents.get(role);
    if (!agent) return error(res, 404, '먼저 에이전트를 등록해야 합니다.');
    agent.lastSeen = Date.now();

    if (req.method === 'GET' && parts[5] === 'next') {
      const job = await waitForJob(room, role);
      return json(res, 200, { job: job || null });
    }

    if (req.method === 'POST' && parts[5] === 'reply') {
      try {
        const body = await readJson(req);
        const record = room.pending.get(String(body.jobId || ''));
        if (!record || record.role !== role) return error(res, 409, '유효하지 않거나 이미 처리된 작업입니다.');
        const text = String(body.text || '').trim();
        if (!text) return error(res, 400, '에이전트 응답이 비어 있습니다.');
        clearTimeout(record.timer);
        room.pending.delete(record.job.id);
        appendMessage(room, agent.alias, role, text);

        if (role === '사회자') {
          room.turnNumber += 1;
          if (body.end === true) {
            room.finished = true;
            room.started = false;
            addSystem(room, '사회자 AI가 사용자가 정한 종료 조건을 충족해 토론을 종료했습니다.');
            publish(room, 'room', roomSnapshot(room));
            return json(res, 201, { room: roomSnapshot(room) });
          }
          const nextRole = chooseNextRole(room, String(body.nextRole || '').trim());
          if (nextRole) {
            room.lastParticipantRole = nextRole;
            queueJob(room, nextRole, '사회자가 지정한 다음 발언');
          }
        } else {
          queueJob(room, '사회자', `${agent.alias}의 발언에 대한 진행`);
        }
        return json(res, 201, { room: roomSnapshot(room) });
      } catch (err) { return error(res, 400, err.message); }
    }
  }

  return error(res, 404, '지원하지 않는 API 요청입니다.');
}

const server = http.createServer((req, res) => {
  route(req, res).catch(err => error(res, 500, err.message || '서버 오류가 발생했습니다.'));
});

server.listen(PORT, HOST, () => {
  console.log(`Local debate relay listening at http://${HOST}:${PORT}`);
  console.log('Create a room in the browser, then start the agent terminals.');
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, room] of rooms) {
    if (room.createdAt < cutoff && room.subscribers.size === 0) rooms.delete(id);
  }
}, 30 * 60 * 1000).unref();
