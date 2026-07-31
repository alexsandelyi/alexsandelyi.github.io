# 동네 축구 — 설계 문서 목차

`index.html`(892줄, 의존성 없는 Canvas 2D 한 파일)의 확장 설계.
문서 작성 규칙은 `AGENTS.md` 를 따른다 — kebab-case, 파일당 200줄 이하,
한 파일에 한 주제.

## 문서

| 문서 | 역할 |
|---|---|
| [principles.md](principles.md) | 확장 중에도 지키는 4가지 제약. 다른 모든 문서의 상위 규칙 |
| [baseline.md](baseline.md) | 현재 구현이 가진 것과 없는 것. 모든 설계의 출발점 |
| [input-system.md](input-system.md) | 조작과 플레이 감. 공 소유, 조준, 액션, 선수 전환 |
| [match-rules.md](match-rules.md) | 경기 규칙과 심판. 아웃, 세트피스, 오프사이드, 파울 |
| [team-tactics.md](team-tactics.md) | 팀·전술·선수 상성. 능력치, 포메이션, 전술 슬라이더 |
| [game-modes.md](game-modes.md) | 모드와 진행 구조. 토너먼트, 리그, 승부차기, 저장 |
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

설계 단계. 구현은 아직 시작하지 않았다.

모든 문서의 제안은 **미측정**이다. 숫자가 적힌 항목은 시뮬레이션으로
확인하기 전까지 확정이 아니며, 각 문서 안에서 `확정` / `제안` / `미결` 로
구분해 표시한다.

## 공개

축구 게임은 전 단계 완료 후 1회만 공개한다. 중간 상태는 로컬 커밋으로만
보관한다 (루트 `AGENTS.md`, `CLAUDE.md` 참조).
