'use strict';
// 10-draw.js — 경기장·선수·공 그리기, 미니맵, 배너와 알림
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — const 는 뒤 파일에서 앞 파일을 참조할 수만 있다.

// ── 그리기 ─────────────────────────────────────────────────────────
function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#152528';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  applyFieldTransform();
  drawPitch();
  if (offside) drawOffsideLine();
  for (const side of [0, 1]) for (const p of teams[side]) drawPlayer(p);
  drawBall();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawMinimap();
  if (state === 'goal') drawGoalText();
  if (state === 'setpiece') drawSetpieceText();
  if (state === 'halftime') drawBannerText('하프타임', C.away);
  if (notice.timer > 0) drawNotice();
}

function drawOffsideLine() {
  ctx.save();
  ctx.strokeStyle = '#F2CE7A'; ctx.lineWidth = 5;
  ctx.setLineDash([18, 14]);
  ctx.beginPath(); ctx.moveTo(offside.lineX, 0); ctx.lineTo(offside.lineX, FH); ctx.stroke();
  ctx.restore();
}

function drawPitch() {
  ctx.fillStyle = C.turf;
  ctx.fillRect(0, 0, FW, FH);
  ctx.fillStyle = C.turfAlt;
  const stripes = 14, sw = FW / stripes;
  for (let i = 0; i < stripes; i += 2) ctx.fillRect(i * sw, 0, sw, FH);

  ctx.strokeStyle = C.line; ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, FW - 4, FH - 4);
  ctx.beginPath(); ctx.moveTo(FW / 2, 0); ctx.lineTo(FW / 2, FH); ctx.stroke();
  ctx.beginPath(); ctx.arc(FW / 2, FH / 2, CIRCLE_R, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = C.line;
  ctx.beginPath(); ctx.arc(FW / 2, FH / 2, 7, 0, Math.PI * 2); ctx.fill();

  for (const gx of [0, FW]) {
    const dir = gx === 0 ? 1 : -1;
    ctx.strokeRect(gx === 0 ? 0 : FW - PA_D, (FH - PA_W) / 2, PA_D, PA_W);
    ctx.strokeRect(gx === 0 ? 0 : FW - GA_D, (FH - GA_W) / 2, GA_D, GA_W);
    ctx.beginPath(); ctx.arc(gx + dir * PEN_SPOT, FH / 2, 7, 0, Math.PI * 2); ctx.fill();
  }

  for (const x of [0, FW]) for (const y of [0, FH]) {
    const a0 = x === 0 ? (y === 0 ? 0 : -Math.PI / 2) : (y === 0 ? Math.PI / 2 : Math.PI);
    ctx.beginPath(); ctx.arc(x, y, 20, a0, a0 + Math.PI / 2); ctx.stroke();
  }

  // 골문
  const gy = (FH - GOAL_H) / 2;
  ctx.lineWidth = 10;
  ctx.strokeStyle = C.home;
  ctx.beginPath(); ctx.moveTo(3, gy); ctx.lineTo(3, gy + GOAL_H); ctx.stroke();
  ctx.strokeStyle = C.away;
  ctx.beginPath(); ctx.moveTo(FW - 3, gy); ctx.lineTo(FW - 3, gy + GOAL_H); ctx.stroke();
}

function drawRadius(physicalRadius, minDiameterPx) {
  return Math.max(physicalRadius,
    minDiameterPx * view.dpr / (2 * Math.max(view.scale, 1e-6)));
}

function drawPlayer(p) {
  const isCtrl = p === ctrl[0];
  const base = p.side === 0
    ? (p.isGK ? C.gkHome : C.home)
    : (p.isGK ? C.gkAway : C.away);
  const r = drawRadius(R_PLAYER, DRAW_PLAYER_MIN_PX);

  // 그림자. 스프라이트가 원보다 색 면적이 작아 예전 진하기로는 선수
  // 옆에 붙은 별개 덩어리처럼 보였다.
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.beginPath(); ctx.ellipse(p.x + r * .14, p.y + r * .18,
    r * .92, r * .74, 0, 0, Math.PI * 2); ctx.fill();

  if (!drawPlayerSprite(p, r)) {
    // 시트를 아직 못 받았거나 아예 못 받는다. 원으로 계속 돌아간다 —
    // 그림이 없다고 경기가 멈추면 안 된다.
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    if (p.blockT > 0) {
      ctx.strokeStyle = base; ctx.lineWidth = r * .65; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x, p.y - r * 1.35);
      ctx.lineTo(p.x, p.y + r * 1.35); ctx.stroke();
    }
  }

  // 조작 중인 선수는 흰 테두리 + 위쪽 삼각 표시 (22명 중에서 찾기 쉽게)
  if (isCtrl) {
    ctx.strokeStyle = '#F2F7F4'; ctx.lineWidth = Math.max(2, r * .18);
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.22, 0, Math.PI * 2); ctx.stroke();
    ctx.save();
    ctx.translate(p.x, p.y - r * 1.75);
    if (view.rot) ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#F2F7F4';
    const marker = r * .42;
    ctx.beginPath(); ctx.moveTo(0, marker); ctx.lineTo(-marker, -marker * .55);
    ctx.lineTo(marker, -marker * .55); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  if (p.yellow) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (view.rot) ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#F2CE4A';
    ctx.fillRect(r * .48, -r * 1.12, r * .42, r * .62);
    ctx.restore();
  }

  // 등번호는 세워서 그린다. 22명 구분이 전적으로 여기 달려 있어서
  // 스프라이트에 굽지 않고 늘 위에 얹는다.
  ctx.save();
  ctx.translate(p.x, p.y);
  if (view.rot) ctx.rotate(Math.PI / 2);
  // 스프라이트 위에서는 번호가 선수를 통째로 덮지 않게 작게 쓰고,
  // 어두운 테두리를 둘러 밝은 셔츠·잔디 어디서나 읽히게 한다.
  const fs = Math.max(7, r * (spriteReady ? .82 : 1.05));
  ctx.font = '700 ' + fs + 'px ' + bodyFont();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const label = p.isGK ? 'GK' : String(p.no);
  if (spriteReady) {
    ctx.strokeStyle = 'rgba(12,18,20,.85)';
    ctx.lineWidth = Math.max(1.5, fs * .28);
    ctx.lineJoin = 'round';
    ctx.strokeText(label, 0, 1);
  }
  ctx.fillStyle = spriteReady ? '#F7FBF8' : '#152528';
  ctx.fillText(label, 0, 1);
  ctx.restore();
}

function drawBall() {
  const base = drawRadius(R_BALL, DRAW_BALL_MIN_PX);
  const r = base * Math.min(BALL_GROW_MAX, 1 + ball.z / BALL_GROW);
  const lift = ball.z * BALL_LIFT;

  // 화면 위쪽은 가로 화면에서 필드 -y, 세로 화면에서 필드 +x 다.
  // 변환이 화면y = -s·필드x 로 사상하기 때문이다. 필드 좌표로 그냥 빼면
  // 세로 화면에서 공이 위가 아니라 옆으로 뜬다.
  const ox = view.rot ? lift : 0;
  const oy = view.rot ? 0 : -lift;

  // 그림자는 지면에 남는다. 공과 벌어지는 거리가 높이의 주된 단서다.
  const sh = base * (1 - Math.min(.45, ball.z / 600));
  ctx.fillStyle = `rgba(0,0,0,${Math.max(.12, .34 - ball.z / 900).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(ball.x, ball.y, sh, sh * .8, 0, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = C.ball;
  ctx.beginPath(); ctx.arc(ball.x + ox, ball.y + oy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#152528';
  ctx.beginPath(); ctx.arc(ball.x + ox, ball.y + oy, r * 0.42, 0, Math.PI * 2); ctx.fill();
}

// 미니맵은 화면 좌표로 그린다(경기장 변환·회전과 무관하게 항상 가로).
// 위치는 우측 상단 — 아래쪽은 조이스틱(좌)과 슛·패스 버튼(우)이 차지한다.
function drawMinimap() {
  const pad = 10 * view.dpr;
  const mw = Math.min(canvas.width * 0.40, 320 * view.dpr);
  const mh = mw * (FH / FW);
  const mx = canvas.width - mw - pad, my = pad;
  const sx = mw / FW, sy = mh / FH;

  ctx.fillStyle = C.mapBg;
  ctx.fillRect(mx, my, mw, mh);
  ctx.strokeStyle = '#52777E'; ctx.lineWidth = 1.4 * view.dpr;
  ctx.strokeRect(mx + .5, my + .5, mw - 1, mh - 1);
  ctx.beginPath(); ctx.moveTo(mx + mw / 2, my); ctx.lineTo(mx + mw / 2, my + mh); ctx.stroke();

  // 현재 화면에 보이는 범위
  const sp = viewSpan();
  ctx.strokeStyle = 'rgba(242,247,244,.72)';
  ctx.lineWidth = 1.5 * view.dpr;
  ctx.strokeRect(mx + (cam.x - sp.x / 2) * sx, my + (cam.y - sp.y / 2) * sy, sp.x * sx, sp.y * sy);

  const r = Math.max(DRAW_PLAYER_MIN_PX * .12 * view.dpr, mw * 0.012);
  for (const side of [0, 1]) for (const p of teams[side]) {
    ctx.fillStyle = p.side === 0 ? C.home : C.away;
    ctx.beginPath(); ctx.arc(mx + p.x * sx, my + p.y * sy, r, 0, Math.PI * 2); ctx.fill();
    if (p === ctrl[0]) {
      ctx.strokeStyle = '#F2F7F4'; ctx.lineWidth = 1.8 * view.dpr;
      ctx.beginPath(); ctx.arc(mx + p.x * sx, my + p.y * sy,
        r + 2.2 * view.dpr, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.fillStyle = C.ball;
  const br = Math.max(DRAW_BALL_MIN_PX * .15 * view.dpr, r * .7);
  ctx.beginPath(); ctx.arc(mx + ball.x * sx, my + ball.y * sy, br, 0, Math.PI * 2); ctx.fill();
}

function drawGoalText() {
  ctx.fillStyle = 'rgba(21,37,40,.5)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = lastScorer === 0 ? C.home : C.away;
  ctx.font = '700 ' + Math.round(Math.min(canvas.width, canvas.height) * 0.16) + 'px ' + bodyFont();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('골!', canvas.width / 2, canvas.height / 2);
}

function drawBannerText(text, color = C.ball) {
  ctx.fillStyle = 'rgba(21,37,40,.48)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.font = '700 ' + Math.round(Math.min(canvas.width, canvas.height) * 0.10) + 'px ' + bodyFont();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

function drawSetpieceText() {
  if (!setpiece) return;
  const names = {
    throw:'스로인', goalkick:'골킥', corner:'코너킥',
    free:'프리킥', kickoff:'킥오프', penalty:'페널티킥'
  };
  ctx.fillStyle = 'rgba(21,37,40,.72)';
  ctx.fillRect(canvas.width / 2 - 90 * view.dpr, 12 * view.dpr, 180 * view.dpr, 34 * view.dpr);
  ctx.fillStyle = setpiece.side === 0 ? C.home : C.away;
  ctx.font = `700 ${14 * view.dpr}px ${bodyFont()}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(names[setpiece.type], canvas.width / 2, 29 * view.dpr);
}

function drawNotice() {
  ctx.fillStyle = 'rgba(21,37,40,.82)';
  ctx.fillRect(canvas.width / 2 - 110 * view.dpr, 52 * view.dpr, 220 * view.dpr, 36 * view.dpr);
  ctx.fillStyle = notice.color;
  ctx.font = `700 ${15 * view.dpr}px ${bodyFont()}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(notice.text, canvas.width / 2, 70 * view.dpr);
}

function bodyFont() { return getComputedStyle(document.body).fontFamily; }
