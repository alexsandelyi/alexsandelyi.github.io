'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const names = ['?쇱?', '肄붾퓭??, '?낆뼱', '?섎쭏', '肄붾겮由?, '紐⑤몢 ?④퍡'];
  const progressKey = 'game_progress-unlocked_match3i';
  const soundKey = 'sound_effects_prefs-enabledb';
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
      label.textContent = button.disabled ? '?댁쟾 ?④퀎 ?꾨즺 ?? : selected === i + 1 ? '?좏깮?? : '?뚮젅??媛??;
      button.append(label);
      button.addEventListener('click', () => { selected = i + 1; renderMenu(); $('stages').children[i].focus(); });
      $('stages').append(button);
    });
    $('stage-description').textContent = selected === 6 ? '?ㅼ꽢 移쒓뎄?먭쾶 怨④퀬猷?癒뱀씠瑜?二쇱꽭??' : `${names[selected - 1]} 移쒓뎄媛 留쏆엳??怨쇱씪??湲곕떎?ㅼ슂.`;
    const sound = read(soundKey, 'true') !== 'false';
    $('sound').textContent = sound ? '?뚮━ 耳쒖쭚' : '?뚮━ 爰쇱쭚';
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
    $('continue').hidden = !action; $('continue').textContent = action || '寃뚯엫 ?쒖옉';
    $('retry').hidden = !failed;
  }
  function start() {
    clearTimeout(timer);
    frame?.remove();
    ready = false; paused = true; failed = false;
    $('menu').hidden = true; $('game').hidden = false;
    $('stage-label').textContent = `${selected} 쨌 ${names[selected - 1]}`;
    $('pause').disabled = true;
    cover('移쒓뎄瑜?留뚮굹??媛??以?, '寃뚯엫??遺덈윭?ㅺ퀬 ?덉뼱??');
    frame = document.createElement('iframe'); frame.title = 'Match 3 寃뚯엫 ?붾㈃'; frame.allow = 'autoplay; fullscreen';
    // Every embed gets a fresh URL so a retry cannot reuse a half-disposed GWT document.
    frame.src = `play.html?stage=${selected}&run=${++runNonce}`;
    $('game-area').append(frame); resize();
    timer = setTimeout(() => {
      if (!ready && !failed) {
        $('cover-detail').textContent = '?곌껐???먮젮 以鍮꾧? ?ㅻ옒 嫄몃━怨??덉뼱?? ?좎떆 湲곕떎由ш굅???ㅼ떆 遺덈윭? 二쇱꽭??';
        $('retry').hidden = false;
      }
    }, 120000);
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
    if (value) cover('?좉퉸 ?ъ뼱 媛덇퉴??', '以鍮꾨릺硫?怨꾩냽 ?뚮젅?댄븯?몄슂.', '怨꾩냽?섍린');
    else { $('cover').hidden = true; frame.contentWindow.focus(); }
    $('pause').textContent = value ? '怨꾩냽?섍린' : '?쇱떆?뺤?';
  }
  window.addEventListener('message', event => {
    if (!frame || event.origin !== location.origin || event.data?.source !== 'ilbbang-match3') return;
    // GWT executes in its own hidden module iframe; accept only our current game's two windows.
    const moduleWindow = frame.contentWindow.document.getElementById('match3')?.contentWindow;
    if (event.source !== frame.contentWindow && event.source !== moduleWindow) return;
    const {type, detail} = event.data;
    if (type === 'loading' && !ready && !failed) {
      const percent = Number(detail);
      if (Number.isFinite(percent) && percent > 0) {
        $('cover-detail').textContent = `寃뚯엫 以鍮?以?${Math.min(100, Math.max(0, Math.round(percent)))}%`;
      }
    }
    else if (type === 'error') { failed = true; clearTimeout(timer); cover('?좎떆 臾몄젣媛 ?앷꼈?댁슂', detail); }
    else if (type === 'restart') start();
    else if (type === 'menu') menu();
    else if (type === 'playing' && !failed) {
      clearTimeout(timer);
      if (!ready) {
        ready = true; $('pause').disabled = false;
        cover('移쒓뎄媛 湲곕떎由ш퀬 ?덉뼱??', '怨쇱씪 3媛쒕? ?곌껐??癒뱀씠瑜?二쇱꽭??', '寃뚯엫 ?쒖옉');
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
