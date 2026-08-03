#!/usr/bin/env node
// 측정 결과 집계와 출력.

const {
  TARGET_WIN, TARGET_GOALS, LEVEL_NAMES, SWEEP_SPEEDS
} = require('./soccer-runtime.js');

// ── 통계 ────────────────────────────────────────────────────────────
// 승률은 비율이라 정규근사가 꼬리에서 부정확하다. Wilson 구간을 쓴다.
function wilson(k, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p = k / n, z2 = z * z;
  const d = 1 + z2 / n;
  const c = p + z2 / (2 * n);
  const s = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)];
}

const pct = (x) => (x * 100).toFixed(1).padStart(5);

function combineRows(parts) {
  const groups = new Map();
  for (const row of parts) {
    const key = `${row.lvl}:${row.speed ?? ''}`;
    let out = groups.get(key);
    if (!out) {
      out = {
        lvl:row.lvl, speed:row.speed, w:0, d:0, l:0, gf:0, ga:0, n:0,
        matchSec:row.matchSec, avgSteps:0, setpieces:{}, sampleEvents:[],
        eventTotals:{}, movement:{
          count:0, sum:0, max:0, bins:[0,0,0,0],
          halfCount:[0,0], halfSum:[0,0]
        }, secs:0
      };
      groups.set(key, out);
    }
    out.w += row.w; out.d += row.d; out.l += row.l;
    out.gf += row.gf; out.ga += row.ga;
    out.avgSteps += row.avgSteps * row.n; out.n += row.n;
    out.secs = Math.max(out.secs, row.secs);
    if (!out.sampleEvents.length) out.sampleEvents = row.sampleEvents;
    for (const [name, value] of Object.entries(row.setpieces))
      out.setpieces[name] = (out.setpieces[name] || 0) + value;
    for (const [name, value] of Object.entries(row.eventTotals))
      out.eventTotals[name] = (out.eventTotals[name] || 0) + value;
    const m = row.movement, om = out.movement;
    om.count += m.count; om.sum += m.sum; om.max = Math.max(om.max, m.max);
    for (let i = 0; i < 4; i++) om.bins[i] += m.bins[i];
    for (let i = 0; i < 2; i++) {
      om.halfCount[i] += m.halfCount[i]; om.halfSum[i] += m.halfSum[i];
    }
  }
  return Array.from(groups.values()).map(row => {
    row.avgSteps /= row.n;
    return row;
  }).sort((a, b) => a.lvl - b.lvl || (a.speed || 0) - (b.speed || 0));
}

function printNormalResults(rows) {
  console.log('\n난이도  승  무  패   승률(95% CI)          득점  실점  총득점/경기  목표');
  console.log('─'.repeat(76));
  for (const r of rows) {
    const [lo, hi] = wilson(r.w, r.n);
    const total = (r.gf + r.ga) / r.n;
    const target = TARGET_WIN[r.lvl];
    const hit = target / 100 >= lo && target / 100 <= hi ? '충족' : '벗어남';
    console.log(
      `${LEVEL_NAMES[r.lvl].padEnd(4)}  ` +
      `${String(r.w).padStart(3)} ${String(r.d).padStart(3)} ${String(r.l).padStart(3)}   ` +
      `${pct(r.w / r.n)}% (${pct(lo)}~${pct(hi)}%)  ` +
      `${(r.gf / r.n).toFixed(2).padStart(5)} ${(r.ga / r.n).toFixed(2).padStart(5)}  ` +
      `${total.toFixed(2).padStart(10)}  ` +
      `${String(target).padStart(3)}% ${hit}`
    );
  }

  const allGoals = rows.reduce((s, r) => s + r.gf + r.ga, 0) /
                   rows.reduce((s, r) => s + r.n, 0);
  console.log('─'.repeat(76));
  console.log(
    `전체 경기당 총 득점 ${allGoals.toFixed(2)} ` +
    `(목표 ${TARGET_GOALS[0]}~${TARGET_GOALS[1]})`
  );

  console.log('\n슛 분류 (양 팀 합계)');
  console.log('난이도  슛/경기  슛득점 비슛(운반/공격루즈/자책)  성공률  비슛비율  블록');
  for (const r of rows) {
    const s = r.eventTotals;
    const goals = s.shotGoals + s.nonShotGoals;
    console.log(
      `${LEVEL_NAMES[r.lvl].padEnd(4)}  ${(s.shots / r.n).toFixed(2).padStart(7)} ` +
      `${String(s.shotGoals).padStart(6)} ${String(s.nonShotGoals).padStart(4)}` +
      `(${String(s.carryGoals).padStart(2)}/${String(s.attackingLooseGoals).padStart(3)}` +
      `/${String(s.ownGoals).padStart(3)})  ` +
      `${pct(s.shotGoals / Math.max(1, s.shots))}% ` +
      `${pct(s.nonShotGoals / Math.max(1, goals))}%  ` +
      `${(s.blocks / r.n).toFixed(2).padStart(7)}`
    );
  }

  console.log('\n공중 플레이 (경기당, 양 팀 합계)');
  console.log('난이도   헤딩  헤딩골   몸튕김   크로스  GK캐치  헤딩골/득점');
  for (const r of rows) {
    const s = r.eventTotals;
    const goals = s.shotGoals + s.nonShotGoals;
    console.log(
      `${LEVEL_NAMES[r.lvl].padEnd(4)} ${(s.headers / r.n).toFixed(2).padStart(7)} ` +
      `${(s.headGoals / r.n).toFixed(2).padStart(6)} ` +
      `${(s.deflections / r.n).toFixed(2).padStart(8)} ` +
      `${(s.crosses / r.n).toFixed(2).padStart(8)} ` +
      `${(s.gkClaims / r.n).toFixed(2).padStart(7)} ` +
      `${pct(s.headGoals / Math.max(1, goals))}%`
    );
  }

  console.log('\n이동 속도 (play 상태·22명 시간 가중)');
  console.log('난이도  평균   최고   걷기   조깅   달리기 스프린트  전반   후반');
  for (const r of rows) {
    const m = r.movement, count = Math.max(1, m.count);
    const avg = m.sum / count;
    const shares = m.bins.map(n => n / count * 100);
    const first = m.halfSum[0] / Math.max(1, m.halfCount[0]);
    const second = m.halfSum[1] / Math.max(1, m.halfCount[1]);
    console.log(
      `${LEVEL_NAMES[r.lvl].padEnd(4)}  ${avg.toFixed(2).padStart(5)} ` +
      `${m.max.toFixed(2).padStart(6)} ` +
      `${shares.map(v => v.toFixed(1).padStart(6)).join(' ')}  ` +
      `${first.toFixed(2).padStart(5)} ${second.toFixed(2).padStart(6)}`
    );
  }

  const width = rows.reduce((m, r) => {
    const [lo, hi] = wilson(r.w, r.n);
    return Math.max(m, hi - lo);
  }, 0);
  if (width > 0.2) {
    console.log(
      `\n주의: 신뢰구간 폭이 최대 ±${(width / 2 * 100).toFixed(0)}%p 입니다. ` +
      `난이도 간 차이를 판정하려면 -n 을 200 이상으로 올리세요.`
    );
  }
}

function printSweepResults(rows) {
  console.log('\nspeed   승  무  패   승률(95% CI)          득점  실점  총득점/경기');
  console.log('─'.repeat(72));
  for (const r of rows) {
    const [lo, hi] = wilson(r.w, r.n);
    const total = (r.gf + r.ga) / r.n;
    console.log(
      `${r.speed.toFixed(2)}  ` +
      `${String(r.w).padStart(3)} ${String(r.d).padStart(3)} ${String(r.l).padStart(3)}   ` +
      `${pct(r.w / r.n)}% (${pct(lo)}~${pct(hi)}%)  ` +
      `${(r.gf / r.n).toFixed(2).padStart(5)} ${(r.ga / r.n).toFixed(2).padStart(5)}  ` +
      `${total.toFixed(2).padStart(10)}`
    );
  }
  console.log('─'.repeat(72));

  let steepest = null;
  for (let i = 1; i < rows.length; i++) {
    const delta = rows[i].w / rows[i].n - rows[i - 1].w / rows[i - 1].n;
    if (!steepest || Math.abs(delta) > Math.abs(steepest.delta)) {
      steepest = { from:rows[i - 1].speed, to:rows[i].speed, delta };
    }
  }
  if (steepest) {
    console.log(
      `가장 큰 인접 변화 ${steepest.from.toFixed(2)}→${steepest.to.toFixed(2)}: ` +
      `${(steepest.delta * 100).toFixed(1)}%p`
    );
  }
}

module.exports = { wilson, pct, combineRows, printNormalResults, printSweepResults };
