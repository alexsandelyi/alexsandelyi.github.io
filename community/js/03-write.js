'use strict';
// 03-write.js — 글쓰기 폼.
//
// 클래식 <script> 라 전역 스코프를 공유한다. 01-api.js·02-list.js 뒤에 온다.
//
// <dialog> 를 쓴다 — Esc 닫기, 포커스 가둠, 배경 클릭 차단을 브라우저가
// 해준다. 직접 만들면 접근성에서 반드시 뭔가 빠진다.

const dlg = document.getElementById('writeDlg');
const form = document.getElementById('writeForm');
const fAuthor = document.getElementById('fAuthor');
const fTitle = document.getElementById('fTitle');
const fBody = document.getElementById('fBody');
const fPw = document.getElementById('fPw');
const formErr = document.getElementById('formErr');
const btnSubmit = document.getElementById('btnSubmit');

let sending = false;

// 글자 수 표시. 한도가 있는 칸은 얼마나 남았는지 보여야 덜 답답하다.
function bindCount(input, max, outId) {
  const out = document.getElementById(outId);
  const paint = () => {
    const n = input.value.length;
    out.textContent = n + '/' + max;
    out.classList.toggle('over', n > max);
  };
  input.addEventListener('input', paint);
  paint();
}
bindCount(fTitle, Api.TITLE_MAX, 'cTitle');
bindCount(fBody, Api.BODY_MAX, 'cBody');
bindCount(fAuthor, Api.AUTHOR_MAX, 'cAuthor');

function setError(msg) {
  formErr.textContent = msg || '';
  formErr.hidden = !msg;
}

function open() {
  setError('');
  form.reset();
  bindCount(fTitle, Api.TITLE_MAX, 'cTitle');
  bindCount(fBody, Api.BODY_MAX, 'cBody');
  bindCount(fAuthor, Api.AUTHOR_MAX, 'cAuthor');
  dlg.showModal();
  fTitle.focus();
}

function close() {
  if (sending) return;                 // 보내는 중에는 닫지 않는다
  dlg.close();
}

document.getElementById('btnWrite').addEventListener('click', open);
document.getElementById('btnCancel').addEventListener('click', close);

// Esc 는 <dialog> 가 처리하지만, 전송 중에는 막아야 한다.
dlg.addEventListener('cancel', e => { if (sending) e.preventDefault(); });

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (sending) return;                 // 두 번 눌러도 한 번만 간다
  setError('');

  sending = true;
  btnSubmit.disabled = true;
  btnSubmit.textContent = '올리는 중…';

  try {
    await Api.create({
      author: fAuthor.value,
      title: fTitle.value,
      body: fBody.value,
      pw: fPw.value
    });
    dlg.close();
    // 새 글은 맨 앞이므로 1페이지로 간다.
    go(1);
  } catch (err) {
    // 검증 오류든 서버 오류든 같은 자리에 보여준다.
    setError(err.message || '올리지 못했습니다');
  } finally {
    sending = false;
    btnSubmit.disabled = false;
    btnSubmit.textContent = '올리기';
  }
});
