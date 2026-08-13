# 스프라이트 원본 생성 프롬프트

**상태: 사용 중.** 남은 포즈의 원본 그림을 이미지 생성 도구로 뽑을 때
쓴다. 만들어진 그림을 시트에 넣는 방법은
[sprite-pipeline.md](sprite-pipeline.md) 참조.

그림은 사람이 뽑고, 배경 제거부터 시트 통합·검증까지는 자동이다.
에이전트가 생성 도구를 붙여 쓸 수 있는 경우에도 **픽셀아트 생성기는 쓸 수
없다** — 아래 「픽셀아트 생성기는 못 쓴다」 참조.

## 쓰는 법

1. **이미 만든 두 장(달리기, 서 있기)을 같은 대화에 첨부한다.** 그림체
   일관성이 여기서 거의 결정된다.
2. 아래 「공통」에 「동작」 한 줄을 붙여 한 포즈씩 요청한다.
3. 받은 PNG 로 아래 명령을 돌린다.

```bash
python tools/sprite-cutout.py <받은.png> <이름>
# tools/sprite_import.py 의 IMPORTED 에 한 줄 추가
python tools/sprite-gen.py
node tools/soccer-sim.js --restamp
```

## 공통 (그대로 붙여넣기)

```
Draw a soccer player game sprite in exactly the same art style, camera
angle, character design and scale as the attached reference images.

Camera: top-down, seen from above and slightly behind. The player faces
away from the viewer, moving "up" the screen. Do not change this angle.

Character: plain blue jersey with white shoulder stripes, blue shorts,
blue socks, white boots, black hair. No numbers, no logos, no text.

Background: flat pure white (#FFFFFF). No shadow, no ground, no grass,
no gradient.

Framing: the whole body including both feet. Nothing cropped.

Layout: N phases of the motion side by side in one image, left to right,
with clear white space between figures so they never touch or overlap.

Motion: ...
```

`N` 과 `Motion:` 만 아래 표대로 바꾼다.

## 포즈별 동작

| 이름 | N | `Motion:` 에 넣을 문장 |
|---|---|---|
| `kick` | 3 | `three phases of kicking a pass — (1) kicking leg drawn back, (2) foot striking the ball, (3) follow-through with the leg swung forward.` |
| `shoot` | 3 | `three phases of a powerful shot — same as a pass but with a much bigger backswing and a longer follow-through.` |
| `charge` | 1 | `one pose: crouched low, weight on the back foot, kicking leg drawn far back, winding up before striking.` |
| `tackle` | 3 | `three phases of a sliding tackle — body dropping low, one leg stretched far forward along the ground, arms out for balance.` |
| `block` | 2 | `two poses of blocking a shot — standing tall, arms spread wide to the sides, legs apart, making the body as big as possible.` |
| `header` | 3 | `three phases of heading the ball — (1) crouching to jump, (2) in the air with the head thrust forward and arms out, (3) landing.` |
| `deflect` | 2 | `two poses of the ball hitting the player's body — arms tucked in, torso twisted away from the impact.` |
| `gk-dive` | 3 | `three phases of a goalkeeper diving sideways — body stretched out horizontally, both arms reaching to the same side.` |
| `gk-claim` | 2 | `two poses of a goalkeeper catching a high ball — both arms stretched up and forward above the head.` |
| `gk-punt` | 3 | `three phases of a goalkeeper punting the ball — (1) ball held out, (2) leg swinging up to strike, (3) follow-through.` |

한 자세당 **한 장만 줘도 넣을 수 있다.** `N` 을 줄이고 프레임 수를
맞추면 된다.

## 반드시 지켜야 하는 것

지키지 않으면 자동 처리가 깨진다. 취향 문제가 아니다.

| 규칙 | 이유 |
|---|---|
| **흰 배경, 그림자 없음** | 테두리에서 흰색을 타고 들어가는 flood fill 로 배경을 지운다. 그림자가 있으면 몸의 일부로 남아 잔디 위에 검은 얼룩이 된다 |
| **파란 유니폼** | 유니폼을 **색으로 골라내** 회색조로 바꾼 뒤 팀 색을 곱한다. 파랑이 아니면 유니폼을 못 찾아 팀 색이 안 입혀진다 |
| **골키퍼도 파란 유니폼** | 위와 같은 이유. GK 색(민트·보라)은 코드가 입힌다 |
| **위를 향한 뒷모습** | 생성기가 `+x` 를 향하게 돌린다. 다른 각도면 회전이 어긋난다 |
| **인물끼리 안 겹침, 사이에 흰 여백** | 세로 빈 칸으로 인물을 나눈다. 붙어 있으면 두 명이 한 스프라이트가 된다 |
| **번호·로고·글자 없음** | 등번호는 게임이 위에 따로 그린다. 그림에 있으면 두 번 보인다 |
| **몸 전체, 발까지** | 잘리면 실루엣이 깨진다 |

## 픽셀아트 생성기는 못 쓴다 (2026-08-13)

`sprite-ai` MCP 로 `kick` 을 한 장 뽑아 확인했다. **각도·공·배경은 프롬프트
문제였지만 그림체는 아니다.** 도구가 픽셀아트 전용이라 24색 팔레트에 1px
검정 아웃라인이 나온다 (원본 `run.png` 은 22,526색 셀셰이딩).

문제는 취향이 아니라 렌더링 방식이다.

| 걸리는 것 | 어디 |
|---|---|
| 선수가 **조준 방향으로 임의 각도 회전**한다. 1px 아웃라인이 부서진다 | `js/09-sprites.js` `drawPlayerSprite()` 의 `ctx.rotate` |
| 축소 배율이 정수가 아니다. 64px 셀 → 화면 약 34px | 같은 함수의 `s = 2*r*SPRITE_GAIN/SPRITE_BODY` |
| `imageSmoothingEnabled` 를 끄지 않는다 (기본 `true`, 이중선형 보간) | `js/` 전체에 설정 없음 |

픽셀아트는 회전시키지 않고 **방향별로 미리 굽는** 게 관례다. 그 관례를
따르면 프레임이 32 → **256** (8방향)이 되고 `ctx.rotate` 를 방향→칸 선택으로
바꿔야 한다. 아트 교체가 아니라 엔진 변경이다.

**매끈한 셀셰이딩을 내는 범용 이미지 생성 도구를 쓴다.** 자유 회전과 축소를
견디는 그림이어야 한다는 것이 이 파이프라인의 전제다.

## 크기는 신경 쓰지 않아도 된다

그림마다 크기가 달라도 된다. 생성기가 **어깨 폭**을 재서 맞춘다
(`KIT_W`). 전체 길이가 아니라 어깨 폭이 기준인 이유는, 길이로 맞추면
달릴 때 뒤로 뻗은 다리 때문에 선수가 작아지기 때문이다.
