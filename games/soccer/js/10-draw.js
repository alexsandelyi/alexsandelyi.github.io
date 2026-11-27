'use strict';
// 10-draw.js — 경기장·3D 골대/그물·발 앵커 선수·회전 축구공·파워게이지·미니맵·배너
// 클래식 <script> 라 전역 스코프를 공유한다. index.html 의 로드 순서를
// 지켜야 한다 — const 는 뒤 파일에서 앞 파일을 참조할 수만 있다.

let turfPattern = null;
function getTurfPattern() {
  if (turfPattern) return turfPattern;
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 48; cv.height = 48;
  const c = cv.getContext('2d');
  for (let y = 0; y < 48; y += 3) {
    c.fillStyle = y % 6 === 0 ? 'rgba(255,255,255,.028)' : 'rgba(0,0,0,.028)';
    c.fillRect(0, y, 48, 2);
  }
  turfPattern = ctx.createPattern(cv, 'repeat');
  return turfPattern;
}

function depthKey(x, y) { return view.rot ? -x : y; }

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = C.turfOut;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawPitch();
  drawGoalBack(0, -GOAL_DEPTH);
  drawGoalBack(FW, FW + GOAL_DEPTH);
  if (offside) drawOffsideLine();

  const allPlayers = teams[0].concat(teams[1]);
  for (const p of allPlayers) drawPlayerGround(p);
  drawBallShadow();

  const items = allPlayers.map(p => ({ p, key:depthKey(p.x, p.y) }));
  items.push({
    ball:true,
    key:ball.z > HEAD_H ? Infinity : depthKey(ball.x, ball.y) + 2
  });
  items.sort((a, b) => a.key - b.key);
  for (const it of items) {
    if (it.ball) drawBall();
    else drawPlayerBody(it.p);
  }

  drawGoalFront(0, -GOAL_DEPTH);
  drawGoalFront(FW, FW + GOAL_DEPTH);
  if (ball.postHitT > 0) drawPostHit();
  drawChargeGauge();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawMinimap();
  if (state === 'goal') drawGoalText();
  if (state === 'setpiece') drawSetpieceText();
  if (state === 'halftime') drawBannerText('하프타임', C.away);
  if (notice.timer > 0) drawNotice();
}

function drawOffsideLine() {
  ctx.save();
  ctx.strokeStyle = '#F7C93B'; ctx.lineWidth = 3.5 * view.dpr;
  ctx.setLineDash([16, 12]);
  strokeWorldLine(offside.lineX, 0, offside.lineX, FH);
  ctx.restore();
}

function projectedPath(points, close = false) {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = projectWorld(points[i][0], points[i][1]);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  if (close) ctx.closePath();
}

function fillWorldRect(x, y, w, h) {
  projectedPath([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
  ctx.fill();
}

function strokeWorldRect(x, y, w, h) {
  projectedPath([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
  ctx.stroke();
}

function strokeWorldLine(x1, y1, x2, y2) {
  projectedPath([[x1, y1], [x2, y2]]);
  ctx.stroke();
}

function strokeLine3D(x1, y1, z1, x2, y2, z2) {
  const a = projectWorld3D(x1, y1, z1), b = projectWorld3D(x2, y2, z2);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

function worldCurvePoints(cx, cy, rx, ry, start, end, segments = 56) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = start + (end - start) * i / segments;
    points.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  return points;
}

function strokeWorldEllipse(cx, cy, rx, ry = rx) {
  projectedPath(worldCurvePoints(cx, cy, rx, ry, 0, Math.PI * 2));
  ctx.closePath(); ctx.stroke();
}

function strokeWorldArc(cx, cy, r, start, end) {
  projectedPath(worldCurvePoints(cx, cy, r, r, start, end, 22));
  ctx.stroke();
}

function drawPitch() {
  // 경기장 바깥 잔디 여유 공간과 사이드라인 펜스
  ctx.fillStyle = C.turfOut;
  fillWorldRect(-180, -160, FW + 360, FH + 320);
  ctx.strokeStyle = 'rgba(12,34,18,.55)';
  ctx.lineWidth = 3 * view.dpr;
  strokeWorldRect(-95, -85, FW + 190, FH + 170);

  // 잔디 띠 (16줄)
  ctx.fillStyle = C.turf;
  fillWorldRect(0, 0, FW, FH);
  ctx.fillStyle = C.turfAlt;
  const stripes = 16, sw = FW / stripes;
  for (let i = 0; i < stripes; i += 2) fillWorldRect(i * sw, 0, sw, FH);
  const pat = getTurfPattern();
  if (pat) {
    ctx.fillStyle = pat;
    fillWorldRect(0, 0, FW, FH);
  }

  // 흰 석회 라인
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2.6 * view.dpr;
  strokeWorldRect(1, 1, FW - 2, FH - 2);
  strokeWorldLine(FW / 2, 0, FW / 2, FH);
  strokeWorldEllipse(FW / 2, FH / 2, CIRCLE_R);
  ctx.fillStyle = C.line;
  projectedPath(worldCurvePoints(FW / 2, FH / 2, 6, 6, 0, Math.PI * 2));
  ctx.closePath(); ctx.fill();

  // 페널티 박스 · 골 에어리어 · 페널티 스팟 · D-아크
  const dAng = Math.acos((PA_D - PEN_SPOT) / CIRCLE_R);
  for (const gx of [0, FW]) {
    const dir = gx === 0 ? 1 : -1;
    strokeWorldRect(gx === 0 ? 0 : FW - PA_D, (FH - PA_W) / 2, PA_D, PA_W);
    strokeWorldRect(gx === 0 ? 0 : FW - GA_D, (FH - GA_W) / 2, GA_D, GA_W);
    projectedPath(worldCurvePoints(gx + dir * PEN_SPOT, FH / 2, 5.5, 5.5, 0, Math.PI * 2));
    ctx.closePath(); ctx.fill();
    if (gx === 0) strokeWorldArc(PEN_SPOT, FH / 2, CIRCLE_R, -dAng, dAng);
    else strokeWorldArc(FW - PEN_SPOT, FH / 2, CIRCLE_R, Math.PI - dAng, Math.PI + dAng);
  }

  // 코너 아크 + 코너 깃발
  for (const x of [0, FW]) for (const y of [0, FH]) {
    const a0 = x === 0 ? (y === 0 ? 0 : -Math.PI / 2) : (y === 0 ? Math.PI / 2 : Math.PI);
    strokeWorldArc(x, y, 20, a0, a0 + Math.PI / 2);
    const bot = projectWorld3D(x, y, 0), top = projectWorld3D(x, y, 28);
    ctx.strokeStyle = '#F2F7F4'; ctx.lineWidth = 1.8 * view.dpr;
    ctx.beginPath(); ctx.moveTo(bot.x, bot.y); ctx.lineTo(top.x, top.y); ctx.stroke();
    const wave = Math.sin(clock * 6 + x + y) * 2.5 * view.dpr;
    ctx.fillStyle = x === 0 ? C.home : C.away;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(top.x + 11 * view.dpr, top.y + 3.5 * view.dpr + wave);
    ctx.lineTo(top.x, top.y + 8 * view.dpr);
    ctx.closePath(); ctx.fill();
  }
}

function drawNetMeshQuad(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, nu, nv) {
  ctx.strokeStyle = 'rgba(244,250,247,.32)';
  ctx.lineWidth = Math.max(1, 1.05 * view.dpr);
  for (let i = 0; i <= nu; i++) {
    const t = i / nu;
    strokeLine3D(
      x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t,
      x3 + (x2 - x3) * t, y3 + (y2 - y3) * t, z3 + (z2 - z3) * t);
  }
  for (let j = 0; j <= nv; j++) {
    const t = j / nv;
    strokeLine3D(
      x0 + (x3 - x0) * t, y0 + (y3 - y0) * t, z0 + (z3 - z0) * t,
      x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, z1 + (z2 - z1) * t);
  }
}

function drawGoalBack(gx, backX) {
  const gy0 = (FH - GOAL_H) / 2, gy1 = (FH + GOAL_H) / 2, h = CROSSBAR;
  ctx.fillStyle = 'rgba(0,0,0,.17)';
  fillWorldRect(Math.min(gx, backX), gy0, GOAL_DEPTH, GOAL_H);
  // 뒤쪽 그물망
  drawNetMeshQuad(backX, gy0, 0, backX, gy1, 0, backX, gy1, h, backX, gy0, h, 8, 4);
  // 화면상 위쪽(먼 쪽) 옆그물
  const farY = projectWorld(gx, gy0).y <= projectWorld(gx, gy1).y ? gy0 : gy1;
  drawNetMeshQuad(gx, farY, 0, backX, farY, 0, backX, farY, h, gx, farY, h, 4, 4);
}

function drawGoalFront(gx, backX) {
  const gy0 = (FH - GOAL_H) / 2, gy1 = (FH + GOAL_H) / 2, h = CROSSBAR;
  const nearY = projectWorld(gx, gy0).y > projectWorld(gx, gy1).y ? gy0 : gy1;
  // 가까운 옆그물 + 지붕 그물
  drawNetMeshQuad(gx, nearY, 0, backX, nearY, 0, backX, nearY, h, gx, nearY, h, 4, 4);
  drawNetMeshQuad(gx, gy0, h, gx, gy1, h, backX, gy1, h, backX, gy0, h, 8, 3);

  // 뒤쪽 지지대 프레임
  ctx.strokeStyle = 'rgba(216,232,224,.70)';
  ctx.lineWidth = Math.max(1.5, 2.0 * view.dpr);
  for (const py of [gy0, gy1]) {
    strokeLine3D(gx, py, h, backX, py, h);
    strokeLine3D(backX, py, h, backX, py, 0);
  }
  strokeLine3D(backX, gy0, h, backX, gy1, h);

  // 3D 흰색 골포스트 + 크로스바 (외곽 어두운 테두리 + 밝은 금속 파이프)
  const postW = Math.max(3, 4.6 * view.dpr);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(14,26,18,.68)';
  ctx.lineWidth = postW + 2.4 * view.dpr;
  strokeLine3D(gx, gy0, 0, gx, gy0, h);
  strokeLine3D(gx, gy1, 0, gx, gy1, h);
  strokeLine3D(gx, gy0, h, gx, gy1, h);

  ctx.strokeStyle = '#F7FBF8';
  ctx.lineWidth = postW;
  strokeLine3D(gx, gy0, 0, gx, gy0, h);
  strokeLine3D(gx, gy1, 0, gx, gy1, h);
  strokeLine3D(gx, gy0, h, gx, gy1, h);
}

function drawBallShadow() {
  const base = drawRadius(R_BALL, DRAW_BALL_MIN_PX);
  const pt = projectWorld3D(ball.x, ball.y, 0);
  const sh = Math.max(base * pt.scale * 1.15, 5.2 * view.dpr) * (1 - Math.min(.48, ball.z / 520));
  ctx.fillStyle = `rgba(6,20,10,${Math.max(.14, .42 - ball.z / 760).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(pt.x, pt.y + 1 * view.dpr, sh, sh * .48, 0, 0, Math.PI * 2);
  ctx.fill();
  // 공중볼일 때 낙하 지면 기준 링
  if (ball.z > FOOT_H) {
    ctx.strokeStyle = 'rgba(247,251,248,.34)';
    ctx.lineWidth = 1.2 * view.dpr;
    ctx.beginPath();
    ctx.ellipse(pt.x, pt.y, sh * 1.45, sh * 0.68, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawBall() {
  const base = drawRadius(R_BALL, DRAW_BALL_MIN_PX);
  const pt = projectWorld3D(ball.x, ball.y, ball.z);
  const r = Math.max(base * pt.scale * 1.18, 6.0 * view.dpr) *
    Math.min(BALL_GROW_MAX, 1 + ball.z / BALL_GROW);

  // 고속 슛·커브 잔상
  const bSp = Math.hypot(ball.vx, ball.vy);
  if (!ball.owner && bSp > 240) {
    const tail = projectWorld3D(
      ball.x - ball.vx * 0.045, ball.y - ball.vy * 0.045,
      Math.max(0, ball.z - ball.vz * 0.045));
    const alpha = Math.min(0.45, (bSp - 240) / 860);
    ctx.save();
    ctx.strokeStyle = Math.abs(ball.spinZ) > 5
      ? `rgba(247,201,59,${alpha.toFixed(3)})`
      : `rgba(247,251,248,${alpha.toFixed(3)})`;
    ctx.lineWidth = Math.max(2 * view.dpr, r * 1.1);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
    ctx.restore();
  }

  // 3D 구형 음영 + 회전하는 클래식 축구공 오각형 패치
  ctx.save();
  ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2); ctx.clip();
  const grad = ctx.createRadialGradient(
    pt.x - r * 0.32, pt.y - r * 0.34, r * 0.1, pt.x, pt.y, r * 1.05);
  grad.addColorStop(0, '#FFFFFF');
  grad.addColorStop(0.62, '#E5ECEA');
  grad.addColorStop(1, '#8D9B9F');
  ctx.fillStyle = grad;
  ctx.fillRect(pt.x - r, pt.y - r, r * 2, r * 2);

  const sx = view.rot ? ball.vy : ball.vx;
  const sy = view.rot ? -ball.vx : ball.vy;
  const heading = Math.hypot(sx, sy) > 4 ? Math.atan2(sy, sx) : 0;
  const ca = Math.cos(heading), sa = Math.sin(heading);
  ctx.fillStyle = '#1C2629';
  const phase = ball.rollAngle;
  for (let i = 0; i < 4; i++) {
    const ang = phase + i * (Math.PI / 2);
    if (Math.cos(ang) < -0.15) continue;
    const u = Math.sin(ang) * r * 0.72;
    const v = ((i % 2) * 2 - 1) * r * 0.28 * Math.cos(ang * 0.5);
    const px = pt.x + u * ca - v * sa;
    const py = pt.y + u * sa + v * ca;
    const pr = r * 0.31 * (0.65 + 0.35 * Math.max(0, Math.cos(ang)));
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = heading + k * (Math.PI * 2 / 5) + phase * 0.25;
      const vx = px + Math.cos(a) * pr, vy = py + Math.sin(a) * pr;
      if (k === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
    }
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(18,28,24,.75)';
  ctx.lineWidth = Math.max(1, 1.15 * view.dpr);
  ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2); ctx.stroke();
}

function drawPostHit() {
  const p = projectWorld3D(ball.postHitX, ball.postHitY, ball.postHitZ || 0);
  const t = 1 - ball.postHitT / 0.42;
  const rad = (10 + t * 30) * view.dpr;
  ctx.save();
  ctx.strokeStyle = `rgba(247,201,59,${(1 - t).toFixed(3)})`;
  ctx.lineWidth = Math.max(1.5, (3.2 - t * 2) * view.dpr);
  ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawChargeGauge() {
  if (state !== 'play') return;
  const info = humanChargeInfo();
  const p = ctrl[0];
  if (!info || !p || info.power <= 0.01) return;
  const pt = projectWorld(p.x, p.y);
  const dpr = view.dpr;
  const w = 50 * dpr, h = 6.5 * dpr;
  const x = pt.x - w / 2, y = pt.y + 22 * dpr;
  ctx.save();
  ctx.fillStyle = 'rgba(10,22,14,.82)';
  ctx.fillRect(x - 1.5 * dpr, y - 1.5 * dpr, w + 3 * dpr, h + 3 * dpr);
  ctx.fillStyle = info.kind === 'shoot'
    ? (info.power > 0.86 ? '#FF5A3D' : info.power > 0.35 ? '#F7C93B' : '#4CE0B3')
    : (info.kind === 'through' ? '#7CEBD0' : '#F7C93B');
  ctx.fillRect(x, y, w * Math.min(1, info.power), h);
  if (Math.abs(info.curve) > 0.15) {
    const cx = pt.x + info.curve * (w * 0.48);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(cx - 1.5 * dpr, y - 3 * dpr, 3 * dpr, h + 6 * dpr);
  }
  ctx.restore();
}

function drawMinimap() {
  const pad = 10 * view.dpr;
  const mw = Math.min(canvas.width * 0.38, 300 * view.dpr);
  const mh = mw * (FH / FW);
  const mx = canvas.width - mw - pad, my = pad;
  const sx = mw / FW, sy = mh / FH;

  ctx.fillStyle = C.mapBg;
  ctx.fillRect(mx, my, mw, mh);
  ctx.strokeStyle = C.mapLine; ctx.lineWidth = 1.4 * view.dpr;
  ctx.strokeRect(mx + .5, my + .5, mw - 1, mh - 1);
  ctx.beginPath(); ctx.moveTo(mx + mw / 2, my); ctx.lineTo(mx + mw / 2, my + mh); ctx.stroke();

  const sp = viewSpan();
  ctx.strokeStyle = 'rgba(247,251,248,.75)';
  ctx.lineWidth = 1.4 * view.dpr;
  ctx.strokeRect(mx + (cam.x - sp.x / 2) * sx, my + (cam.y - sp.y / 2) * sy, sp.x * sx, sp.y * sy);

  const r = Math.max(DRAW_PLAYER_MIN_PX * .12 * view.dpr, mw * 0.013);
  for (const side of [0, 1]) for (const p of teams[side]) {
    ctx.fillStyle = p.side === 0 ? C.home : C.away;
    ctx.beginPath(); ctx.arc(mx + p.x * sx, my + p.y * sy, r, 0, Math.PI * 2); ctx.fill();
    if (p === ctrl[0]) {
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.8 * view.dpr;
      ctx.beginPath(); ctx.arc(mx + p.x * sx, my + p.y * sy,
        r + 2.2 * view.dpr, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.fillStyle = '#FFFFFF';
  const br = Math.max(DRAW_BALL_MIN_PX * .16 * view.dpr, r * .75);
  ctx.beginPath(); ctx.arc(mx + ball.x * sx, my + ball.y * sy, br, 0, Math.PI * 2); ctx.fill();
}

function drawGoalText() {
  ctx.fillStyle = 'rgba(12,28,18,.44)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = lastScorer === 0 ? C.home : C.away;
  ctx.strokeStyle = 'rgba(10,22,14,.85)';
  ctx.lineWidth = Math.max(4, Math.min(canvas.width, canvas.height) * 0.012);
  ctx.font = '800 ' + Math.round(Math.min(canvas.width, canvas.height) * 0.16) + 'px ' + bodyFont();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeText('골!', canvas.width / 2, canvas.height / 2);
  ctx.fillText('골!', canvas.width / 2, canvas.height / 2);
}

function drawBannerText(text, color = C.ball) {
  ctx.fillStyle = 'rgba(12,28,18,.46)';
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
  ctx.fillStyle = 'rgba(14,32,22,.78)';
  ctx.fillRect(canvas.width / 2 - 90 * view.dpr, 12 * view.dpr, 180 * view.dpr, 34 * view.dpr);
  ctx.fillStyle = setpiece.side === 0 ? C.home : C.away;
  ctx.font = `700 ${14 * view.dpr}px ${bodyFont()}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(names[setpiece.type], canvas.width / 2, 29 * view.dpr);
}

function drawNotice() {
  ctx.fillStyle = 'rgba(14,32,22,.84)';
  ctx.fillRect(canvas.width / 2 - 110 * view.dpr, 52 * view.dpr, 220 * view.dpr, 36 * view.dpr);
  ctx.fillStyle = notice.color;
  ctx.font = `700 ${15 * view.dpr}px ${bodyFont()}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(notice.text, canvas.width / 2, 70 * view.dpr);
}
