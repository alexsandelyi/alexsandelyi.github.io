#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const DEFAULT_RELAY = 'http://127.0.0.1:8787';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    result[key] = argv[index + 1]?.startsWith('--') ? true : (argv[++index] ?? true);
  }
  return result;
}

const options = parseArgs(process.argv.slice(2));
const relay = String(options.relay || DEFAULT_RELAY).replace(/\/$/, '');
const role = String(options.role || '').trim();
const provider = String(options.provider || 'codex').trim().toLowerCase();
const requestedRoom = String(options.room || 'latest').trim();
const moderatorInput = role === '사회자'
  ? createInterface({ input: process.stdin, output: process.stdout })
  : null;

if (!role) {
  console.error('사용법: node tools/local-debate-agent.mjs --role 사회자 --provider codex --room latest');
  process.exit(2);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(path, init = {}) {
  const response = await fetch(`${relay}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text }; }
  }
  if (!response.ok) throw new Error(data?.error || `중계 서버 오류 (${response.status})`);
  return data;
}

async function findRoom() {
  if (requestedRoom !== 'latest') {
    const data = await request(`/api/rooms/${encodeURIComponent(requestedRoom)}`);
    return data.room;
  }
  const data = await request('/api/rooms');
  return data.room;
}

function runChild(command, args, prompt, timeoutMs = 150000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: tmpdir(),
      env: process.env,
      shell: process.platform === 'win32',
      windowsHide: false
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} 응답 시간이 초과되었습니다.`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(prompt);
  });
}

function findJsonObject(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { /* try the first JSON object below */ }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

function extractProviderText(providerName, output) {
  const raw = output.trim();
  if (!raw) return '';
  const parsed = findJsonObject(raw);
  if (providerName === 'gemini' && parsed?.response) return String(parsed.response).trim();
  if (parsed?.output_text) return String(parsed.output_text).trim();
  if (parsed?.response) return String(parsed.response).trim();

  const jsonLines = raw.split(/\r?\n/).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const result = [...jsonLines].reverse().find(item => item.response || item.output_text);
  if (result?.response) return String(result.response).trim();
  if (result?.output_text) return String(result.output_text).trim();
  const chunks = jsonLines
    .filter(item => item.type === 'message' && typeof item.content === 'string')
    .map(item => item.content)
    .join('');
  return (chunks || raw).trim();
}

async function runProvider(job) {
  if (provider === 'mock') {
    if (job.role === '사회자') {
      return JSON.stringify({
        message: `좋습니다. ${job.kind}을(를) 시작하겠습니다. 각자의 근거를 차례로 들어보겠습니다.`,
        nextRole: '토론자1'
      });
    }
    return `${job.alias}의 시범 발언입니다. 주제에 대해 근거를 들어 차분하게 의견을 제시하겠습니다.`;
  }

  if (provider === 'codex') {
    const folder = await mkdtemp(join(tmpdir(), 'ilbbang-codex-'));
    const outputPath = join(folder, 'last-message.txt');
    try {
      const command = process.env.CODEX_CMD || (process.platform === 'win32' ? 'codex.cmd' : 'codex');
      const result = await runChild(command, [
        'exec', '--ephemeral', '--json', '--sandbox', 'read-only',
        '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
        '--output-last-message', outputPath, '-'
      ], job.prompt);
      let finalText = '';
      try { finalText = await readFile(outputPath, 'utf8'); } catch { finalText = result.stdout; }
      if (result.code !== 0 && !finalText.trim()) {
        throw new Error(result.stderr.trim() || `Codex 종료 코드 ${result.code}`);
      }
      return extractProviderText('codex', finalText);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  if (provider === 'gemini') {
    const command = process.env.GEMINI_CMD || (process.platform === 'win32' ? 'gemini.cmd' : 'gemini');
    const result = await runChild(command, ['--output-format', 'json'], job.prompt);
    const finalText = extractProviderText('gemini', result.stdout);
    if (result.code !== 0 && !finalText) throw new Error(result.stderr.trim() || `Gemini 종료 코드 ${result.code}`);
    return finalText;
  }

  throw new Error(`지원하지 않는 provider: ${provider}`);
}

function parseReply(job, providerText) {
  if (job.role !== '사회자') return { text: providerText.trim(), nextRole: '', end: false };
  const parsed = findJsonObject(providerText);
  if (!parsed || typeof parsed.message !== 'string') {
    return { text: providerText.trim(), nextRole: '', end: false };
  }
  return {
    text: parsed.message.trim(),
    nextRole: String(parsed.nextRole || '').trim(),
    end: parsed.end === true
  };
}

async function register(room) {
  const data = await request(`/api/rooms/${encodeURIComponent(room.id)}/agents/register`, {
    method: 'POST',
    body: JSON.stringify({ role, provider })
  });
  console.log(`[${role}] ${provider} 에이전트 등록 완료 · ${data.agent.alias}`);
}

async function askModeratorCondition(room) {
  if (role !== '사회자' || room.moderatorCondition || !moderatorInput) return;

  console.log('\n[사회자 CLI] 토론 종료 조건을 입력하세요.');
  console.log('예: "3라운드가 끝나면 각자의 결론을 요약하고 종료" 또는 "사용자가 종료를 요청할 때까지 진행"');
  let condition = '';
  while (!condition) {
    condition = (await moderatorInput.question('종료 조건> ')).trim();
    if (!condition) console.log('종료 조건을 한 줄 이상 입력해야 합니다.');
  }

  await request(`/api/rooms/${encodeURIComponent(room.id)}/moderator-condition`, {
    method: 'POST',
    body: JSON.stringify({ condition })
  });
  console.log(`[사회자] 종료 조건을 중계 서버에 전달했습니다: ${condition}`);
}

async function main() {
  let activeRoomId = '';
  console.log(`[${role}] ${provider} 에이전트 시작 · 중계 서버 ${relay}`);
  while (true) {
    let room;
    try {
      room = await findRoom();
    } catch (err) {
      console.log(`[${role}] 방을 기다리는 중: ${err.message}`);
      await sleep(3000);
      continue;
    }

    if (room.finished) {
      if (requestedRoom === 'latest') {
        activeRoomId = '';
        await sleep(1500);
        continue;
      }
      console.log(`[${role}] 토론이 종료되어 에이전트를 종료합니다.`);
      return;
    }

    if (activeRoomId !== room.id) {
      await register(room);
      activeRoomId = room.id;
      await askModeratorCondition(room);
    }

    let data;
    try {
      data = await request(`/api/rooms/${encodeURIComponent(activeRoomId)}/agents/${encodeURIComponent(role)}/next`);
    } catch (err) {
      console.log(`[${role}] 작업 수신 실패: ${err.message}`);
      await sleep(2000);
      continue;
    }
    const job = data?.job;
    if (!job) continue;

    console.log(`[${role}] 작업 수신: ${job.kind}`);
    let providerText;
    try {
      providerText = await runProvider(job);
    } catch (err) {
      providerText = `에이전트 실행 오류: ${err.message}`;
      console.error(`[${role}] ${err.message}`);
    }
    const reply = parseReply(job, providerText);
    if (!reply.text) reply.text = '응답을 만들지 못했습니다.';

    try {
      await request(`/api/rooms/${encodeURIComponent(activeRoomId)}/agents/${encodeURIComponent(role)}/reply`, {
        method: 'POST',
        body: JSON.stringify({
          jobId: job.id,
          text: reply.text,
          nextRole: reply.nextRole,
          end: reply.end
        })
      });
      console.log(`[${role}] 발언 전송 완료`);
    } catch (err) {
      console.error(`[${role}] 발언 전송 실패: ${err.message}`);
      await sleep(1500);
    }
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
}).finally(() => {
  moderatorInput?.close();
});
