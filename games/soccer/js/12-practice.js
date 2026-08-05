'use strict';
// 12-practice.js — 연습 모드 — 선수 1명 격리, 공 리셋, 실시간 계측 HUD
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — const 는 뒤 파일에서 앞 파일을 참조할 수만 있다.

// ── 연습 모드 ──────────────────────────────────────────────────────
// 혼자 조작 감각을 시험하는 모드. 나머지 선수를 구석에 치우고 시계를
// 멈춘다. 제목 화면의 「연습 모드」 버튼으로만 켜지며, 그 전에는 아래
// 코드가 한 줄도 돌지 않는다.
let solo = false;
let soloKeeper = false, soloRival = false, soloHelp = true;
let soloPlayer = null;

function soloKept(p) {
  if (p === soloPlayer) return true;
  if (soloKeeper && p.isGK && p.side === 1) return true;
  if (soloRival && p.side === 1 && p.no === 5) return true;
  return false;
}

// 치운 선수는 목표 지점을 자기 자리로 고정해 가속하지 않게 한다.
// 처음 상태로 되돌린다 — 선수는 센터, 공은 발밑, 쿨다운 해제.
function soloReset(reason) {
  soloPlayer = teams[0][9];
  soloPlayer.x = FW / 2 - 80; soloPlayer.y = FH / 2;
  soloPlayer.vx = soloPlayer.vy = 0;
  soloPlayer.aimX = attackDir[0]; soloPlayer.aimY = 0;
  soloPlayer.kickCd = soloPlayer.headCd = soloPlayer.tackleCd = 0;
  soloPlayer.tackleT = soloPlayer.blockT = 0;
  soloPlayer.actShoot = soloPlayer.actPass = soloPlayer.actThrough = 0;
  soloPlayer.shootHeld = false; soloPlayer.shootCharge = 0;
  ctrl[0] = soloPlayer;
  setpiece = null; offside = null; state = 'play';
  soloBall(0);
  if (reason) notice = { text:reason, timer:1.1, color:'#F2CE7A' };
}

function soloTick() {
  if (!solo) return;
  if (state === 'title' || state === 'end') { soloPlayer = null; return; }

  // buildTeams() 가 선수 객체를 새로 만들므로 배열에 남아 있는지로 확인한다.
  // 옛 객체를 붙들면 조작이 먹지 않는다.
  if (!soloPlayer || teams[0].indexOf(soloPlayer) < 0) {
    soloReset(null);
  } else if (state !== 'play') {
    // 연습 모드에는 세트피스도 킥오프 대기도 두지 않는다. 공이 나가거나
    // 골이 들어가면 곧바로 처음 상태로 되돌려 계속 시험하게 한다.
    // 무엇 때문이었는지는 알림으로만 남긴다.
    soloReset(state === 'goal' ? '골! — 다시 시작' : '아웃 — 다시 시작');
  }
  ctrl[0] = soloPlayer;            // 치운 선수에게 조작이 넘어가지 않게 한다
  ctrlLock[0] = 1;

  if (state === 'play') { clock = MATCH_SEC / 2; addedBank = 0; inAdded = false; }
  for (const side of [0, 1]) for (const p of teams[side]) {
    if (soloKept(p)) continue;
    p.x = 70 + p.no * 26; p.y = side === 0 ? 70 : FH - 70;
    p.vx = p.vy = 0; p.aiT = 1e9; p.aiTx = p.x; p.aiTy = p.y;
    p.tackleT = 0; p.blockT = 0; p.gkClaim = false;
  }
}

function soloBall(z) {
  const p = soloPlayer || ctrl[0];
  if (!p) return;
  ball.lastTouch = null; ball.freeCd = 0;
  ball.z = z; ball.vx = ball.vy = ball.vz = 0;
  ball.shotSide = -1; ball.shotCounted = ball.blockCounted = ball.headShot = false;
  setpiece = null; offside = null;
  if (state !== 'play') state = 'play';

  if (z <= FOOT_H) {
    // 지면 리셋은 소유까지 준다. 접촉 반경이 0.41m 뿐이라 공을 앞에
    // '놓기만' 하면 손이 닿지 않아 소유가 안 되고, 그 상태에서는
    // 패스·슛이 조용히 아무 일도 하지 않는다.
    p.trapCd = 0;
    ball.owner = p;
    ball.x = ball.prevX = p.x; ball.y = ball.prevY = p.y;
  } else {
    // 공중 리셋은 자유공이어야 튕김·헤딩을 시험할 수 있다.
    ball.owner = null;
    const d = R_PLAYER + R_BALL + 10;
    ball.x = ball.prevX = p.x + (p.aimX || attackDir[0]) * d;
    ball.y = ball.prevY = p.y + (p.aimY || 0) * d;
    p.trapCd = 0.4;
  }
}

function startPractice() {
  solo = true;
  soloPlayer = null; soloKeeper = false; soloRival = false; soloHelp = true;
  competition = null; shootout = null;
  startMatch('1p');
  soloTick();                        // 첫 프레임 전에 배치를 끝낸다
}

function exitPractice() {
  if (!solo) return;
  solo = false; soloPlayer = null;
  showTitle();
}

// 연습 모드가 꺼져 있으면 즉시 빠져나간다. 버튼으로만 켜진다.
addEventListener('keydown', e => {
  if (!solo || e.repeat) return;
  if (e.code === 'Escape') { e.preventDefault(); exitPractice(); return; }
  const keysUsed = ['KeyB','KeyV','KeyG','KeyT','KeyH',
                    'Digit1','Digit2','Digit3','Digit4'];
  if (!keysUsed.includes(e.code)) return;
  e.preventDefault();
  if (e.code === 'KeyB' || e.code === 'Digit1') soloBall(0);
  if (e.code === 'Digit2') soloBall(0.75 * M);     // 가슴 구간
  if (e.code === 'Digit3') soloBall(1.8 * M);      // 헤딩 구간
  if (e.code === 'Digit4') soloBall(4 * M);        // 아무도 못 닿는 높이
  if (e.code === 'KeyV') { ball.vx = ball.vy = ball.vz = 0; }
  if (e.code === 'KeyG') soloKeeper = !soloKeeper;
  if (e.code === 'KeyT') soloRival = !soloRival;
  if (e.code === 'KeyH') soloHelp = !soloHelp;
});

function drawSoloHud() {
  if (!solo) return;
  const dpr = view.dpr, pad = 10 * dpr, lh = 16 * dpr;
  const p = soloPlayer;
  const band = ball.z <= FOOT_H ? '발' : ball.z <= CHEST_H ? '가슴'
    : ball.z <= HEAD_H ? '헤딩' : ball.z <= GK_HIGH_H ? 'GK만' : '무접촉';
  const lines = [
    `공 높이 ${(ball.z / M).toFixed(2)}m (${band})  ` +
      `속도 ${(Math.hypot(ball.vx, ball.vy) / M * 3.6).toFixed(1)}km/h  ` +
      `수직 ${(ball.vz / M).toFixed(1)}m/s`,
    `선수 ${p ? (Math.hypot(p.vx, p.vy) / M * 3.6).toFixed(1) : '-'}km/h  ` +
      `체력 ${p ? Math.round(p.energy * 100) : '-'}%  ` +
      `소유 ${ball.owner === p ? '나' : ball.owner ? '상대' : '없음'}  ` +
      `충전 ${p ? (p.shootCharge || 0).toFixed(2) : '-'}`,
    `상대GK ${soloKeeper ? 'ON' : 'off'}  상대선수 ${soloRival ? 'ON' : 'off'}  ` +
      `슛 ${matchStats.shots[0]}  헤딩 ${matchStats.headers[0]}  득점 ${score[0]}`
  ];
  if (soloHelp) lines.push(
    'B 공 리셋 · 1~4 높이(0/0.75/1.8/4m) · V 공 정지 · G 상대GK · T 상대선수 · ' +
    'H 도움말 · Esc 나가기');

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${12 * dpr}px ${bodyFont()}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const w = Math.max(...lines.map(t => ctx.measureText(t).width)) + pad * 2;
  const boxH = lh * lines.length + pad;
  ctx.fillStyle = 'rgba(21,37,40,.82)';
  ctx.fillRect(pad, canvas.height - pad - boxH, w, boxH);
  ctx.fillStyle = '#F2F7F4';
  lines.forEach((t, i) =>
    ctx.fillText(t, pad * 2, canvas.height - pad - boxH + pad / 2 + lh * i));
  ctx.restore();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);   // 백그라운드 복귀 시 점프 방지
  last = now;
  soloTick();
  step(dt);
  draw();
  drawSoloHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
