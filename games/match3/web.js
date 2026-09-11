'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const names = ['돼지', '코뿔소', '악어', '하마', '코끼리', '모두 함께'];
  const progressKey = 'game_progress:unlocked_match3i';
  const soundKey = 'sound_effects_prefs:enabledb';
  let selected = 1, frame, timer, paused = false, ready = false, failed = false, runNonce = 0;
  function read(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; }
    catch { $('storage-note').hidden = false; return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, String(value)); }
    catch { $('storage-note').hidden = false; }
  }
  function renderMenu() {
    const unlocked = Math.max(1, Math.min(6, Number(read(progressKey, 1)) || 1));
    selected = Math.min(selected, unlocked);
    $('stages').replaceChildren();
    names.forEach((name, i) => {
      const button = document.createElement('button');
      button.type = 'button'; button.disabled = i + 1 > unlocked;
      button.textContent = `${i + 1}. ${name}`;
      button.setAttribute('aria-pressed', String(selected === i + 1));
      const label = document.createElement('span');
      label.textContent = button.disabled ? '이전 단계 완료 후' : selected === i + 1 ? '선택됨' : '플레이 가능';
      button.append(label);
      button.addEventListener('click', () => { selected = i + 1; renderMenu(); $('stages').children[i].focus(); });
      $('stages').append(button);
    });
    $('stage-description').textContent = selected === 6 ? '다섯 친구에게 골고루 먹이를 주세요.' : `${names[selected - 1]} 친구가 맛있는 과일을 기다려요.`;
    const sound = read(soundKey, 'true') !== 'false';
    $('sound').textContent = sound ? '소리 켜짐' : '소리 꺼짐';
    $('sound').setAttribute('aria-pressed', String(sound));
  }
  function resize() {
    if (!frame) return;
    const area = $('game-area');
    const h = area.clientHeight - (parseFloat(getComputedStyle(area).paddingBottom) || 0);
    // Preserve the Android portrait scene and its physics scale on every viewport.
    const width = Math.min(area.clientWidth, h * 9 / 16);
    frame.style.width = `${Math.floor(width)}px`;
    frame.style.height = `${Math.floor(width * 16 / 9)}px`;
  }
  function cover(title, detail, action) {
    $('cover').hidden = false; $('cover-title').textContent = title; $('cover-detail').textContent = detail;
    $('continue').hidden = !action; $('continue').textContent = action || '게임 시작';
    $('retry').hidden = !failed;
  }
  function start() {
    clearTimeout(timer);
    frame?.remove();
    ready = false; paused = true; failed = false;
    $('menu').hidden = true; $('game').hidden = false;
    $('stage-label').textContent = `${selected} · ${names[selected - 1]}`;
    $('pause').disabled = true;
    cover('친구를 만나러 가는 중', '게임을 불러오고 있어요.');
    frame = document.createElement('iframe'); frame.title = 'Match 3 게임 화면'; frame.allow = 'autoplay; fullscreen';
    // Every embed gets a fresh URL so a retry cannot reuse a half-disposed GWT document.
    frame.src = `play.html?stage=${selected}&run=${++runNonce}`;
    $('game-area').append(frame); resize();
    timer = setTimeout(() => {
      if (!ready && !failed) {
        $('cover-detail').textContent = '연결이 느려 준비가 오래 걸리고 있어요. 잠시 기다리거나 다시 불러와 주세요.';
        $('retry').hidden = false;
      }
    }, 45000);
  }
  function menu() {
    clearTimeout(timer); frame?.remove(); frame = null;
    $('game').hidden = true; $('menu').hidden = false;
    renderMenu(); $('play').focus();
  }
  function setPaused(value) {
    if (!ready || failed) return;
    paused = value;
    frame.contentWindow.setMatch3Paused?.(value);
    if (value) cover('잠깐 쉬어 갈까요?', '준비되면 계속 플레이하세요.', '계속하기');
    else { $('cover').hidden = true; frame.contentWindow.focus(); }
    $('pause').textContent = value ? '계속하기' : '일시정지';
  }
  window.addEventListener('message', event => {
    if (!frame || event.origin !== location.origin || event.data?.source !== 'ilbbang-match3') return;
    // GWT executes in its own hidden module iframe; accept only our current game's two windows.
    const moduleWindow = frame.contentWindow.document.getElementById('match3')?.contentWindow;
    if (event.source !== frame.contentWindow && event.source !== moduleWindow) return;
    const {type, detail} = event.data;
    if (type === 'error') { failed = true; clearTimeout(timer); cover('잠시 문제가 생겼어요', detail); }
    else if (type === 'restart') start();
    else if (type === 'menu') menu();
    else if (type === 'playing' && !failed) {
      clearTimeout(timer);
      if (!ready) {
        ready = true; $('pause').disabled = false;
        cover('친구가 기다리고 있어요!', '과일 3개를 연결해 먹이를 주세요.', '게임 시작');
        $('continue').focus();
      }
    }
  });
  $('play').addEventListener('click', start);
  $('retry').addEventListener('click', start);
  $('back').addEventListener('click', menu);
  $('cover-menu').addEventListener('click', menu);
  $('continue').addEventListener('click', () => setPaused(false));
  $('pause').addEventListener('click', () => setPaused(!paused));
  $('sound').addEventListener('click', () => { write(soundKey, read(soundKey, 'true') === 'false'); renderMenu(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  renderMenu();
})();
