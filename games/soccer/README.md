# 동네 축구 — 설계 문서 목차

`index.html`(2091줄, 의존성 없는 Canvas 2D 한 파일)의 확장 설계.
문서 작성 규칙은 `AGENTS.md` 를 따른다 — kebab-case, 파일당 200줄 이하,
한 파일에 한 주제.

## 문서

| 문서 | 역할 |
|---|---|
| [principles.md](principles.md) | 확장 중에도 지키는 4가지 제약. 다른 모든 문서의 상위 규칙 |
| [baseline.md](baseline.md) | 현재 구현이 가진 것과 없는 것. 모든 설계의 출발점 |
| [balance.md](balance.md) | 실측 승률과 측정 조건. 도구는 `tools/soccer-sim.js` |
| [balance-history.md](balance-history.md) | 0~3단계 과거 기준선과 목표 변경 근거 |
| [balance-expansion.md](balance-expansion.md) | 4단계 이후 회귀·팀·전술 실측 |
| [realistic-balance.md](realistic-balance.md) | 현실 계측치 전환 1~5단계 실측과 튜닝 기록 |
| [input-system.md](input-system.md) | 조작과 플레이 감. 공 소유, 조준, 액션, 선수 전환 |
| [match-rules.md](match-rules.md) | 경기 규칙과 심판. 아웃, 세트피스, 오프사이드, 파울 |
| [team-tactics.md](team-tactics.md) | 팀·전술·선수 상성. 능력치, 포메이션, 전술 슬라이더 |
| [game-modes.md](game-modes.md) | 모드와 진행 구조. 토너먼트, 리그, 승부차기, 저장 |
| [realistic-scale.md](realistic-scale.md) | 현실 계측치 전환 계획. 크기·속도·카메라·수비 재설계 |
| [movement-metrics.md](movement-metrics.md) | 이동 계측 정의. 표본 범위·속도 구간·전후반 비교 |
| [ball-height.md](ball-height.md) | 공의 `z` 축 물리와 표현. 중력·바운스·원근·크로스바 |
| [aerial-play.md](aerial-play.md) | 공중 플레이. 높이별 경합, 헤딩, GK 하이볼 |
| [kick-loft.md](kick-loft.md) | 킥 높이 제어. 사람의 땅볼 패스·센터링, AI 로빙·칩, 슛 로프트 |
| [aerial-balance.md](aerial-balance.md) | 공중 플레이가 승률·득점을 얼마나 움직였는지 측정 기록 |
| [player-sprites.md](player-sprites.md) | 선수 그림. 액션별 포즈 목록, 방향, 포즈 우선순위, 규격 |
| [sprite-pipeline.md](sprite-pipeline.md) | 스프라이트 만들기. 생성기, 프레임 수, 구현, 겪은 함정 |
| [sprite-prompts.md](sprite-prompts.md) | 원본 그림을 이미지 생성 도구로 뽑을 때 쓰는 프롬프트와 제약 |
| [practice-mode.md](practice-mode.md) | 혼자 시험하기 — 연습 모드, 키 배치, `soccer-lab.js` |
| [roadmap.md](roadmap.md) | 구현 순서, 단계별 완료 기준, 미결 질문 |

## 읽는 순서

`principles.md` → `baseline.md` 를 먼저 읽는다. 나머지 4개 설계 문서는
서로 독립적이지 않다 — 의존 관계가 있다.

```
input-system  ──┬─→ match-rules   (태클이 있어야 파울이 성립)
                │
                └─→ team-tactics  (공 소유가 있어야 점유율·경합 능력치가 의미)

match-rules   ──→ game-modes      (승부차기는 조준·세트피스 위에 선다)

team-tactics  ──→ game-modes      (팀이 달라야 토너먼트·리그가 의미)
```

`roadmap.md` 의 구현 순서는 이 의존 관계에서 나왔다.

## 현재 상태

0~6단계와 현실 계측치 전환 1~5단계 구현 완료. 토너먼트·승부차기·리그·
다중 시즌·v2 저장·경기 기록이 동작한다.

후속 규칙 확장은 새 측정 없이 확정하지 않는다. 현재 구현과 보류 항목은
각 설계 문서에서 `확정` / `제안` / `미결`로 구분한다.

## 공개

축구 게임은 전 단계 완료 후 1회만 공개한다. 중간 상태는 로컬 커밋으로만
보관한다 (루트 `AGENTS.md`, `CLAUDE.md` 참조).
