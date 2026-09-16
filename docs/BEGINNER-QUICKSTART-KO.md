# Shipping Harness 초보자 빠른 시작

Shipping Harness는 사용자가 명령어를 외우는 도구가 아니다. 한 번 설치한 뒤 Codex 같은 연결된 에이전트에게 원하는 결과만 말한다.

## 1. 내부 패키지 설치

Ubuntu 서버에서 Shipping Harness 저장소로 이동한다.

```bash
cd /home/jm/orca/projects/shipping-harness
mkdir -p .chatgpt2codex/releases
npm pack --pack-destination .chatgpt2codex/releases

mkdir -p "$HOME/.local/share/shipping-harness"
npm install \
  --prefix "$HOME/.local/share/shipping-harness" \
  --ignore-scripts --no-audit --no-fund \
  .chatgpt2codex/releases/shipping-harness-1.0.0.tgz
```

개발 중인 버전을 설치할 때는 tarball 이름의 버전만 현재 버전으로 바꾼다.

## 2. Codex에 연결

아래에서 `/path/to/project`만 실제로 끝내고 싶은 프로젝트 경로로 바꾼다.

```bash
PLUGIN="$HOME/.local/share/shipping-harness/node_modules/.bin/shipping-harness-plugin"

"$PLUGIN" install \
  --install-root "$HOME/.local/share/shipping-harness-plugin" \
  --host codex \
  --codex-home "$HOME/.codex" \
  --project-root /path/to/project \
  --apply
```

연결 확인:

```bash
codex mcp get shipping-harness

"$PLUGIN" doctor \
  --install-root "$HOME/.local/share/shipping-harness-plugin" \
  --project-root /path/to/project \
  --json
```

## 3. 실제 사용

Codex를 대상 프로젝트에서 실행하고 다음처럼 말한다.

> Shipping Harness로 이 프로젝트를 실제 사용할 수 있는 가장 작은 버전까지 끝내줘. 일반적인 기술 결정은 네가 하고, 위험한 결정만 나에게 물어봐.

Shipping Harness는 기술 세부보다 먼저 아래 쉬운 안내를 직접 만든다.

1. **문제점** — 지금 왜 멈췄는지
2. **개선안** — 무엇을 안전하게 바꿀지
3. **다음 진행 플랜** — 어떤 순서로 갈지
4. **요약** — 지금 상황을 한 문장으로
5. **지금 할 일** — 사용자가 입력할 문장 하나

예를 들어 기존 변경이 남아 있으면 파일 경로 전체 대신 `제품 코드 7개`, `검증 기록 3개`처럼 보여주고 **“이 기준선만 보존해.”**라고 안내한다. 개발 범위가 준비되면 **“이대로 시작해.”**, 검증이 끝나면 **“이 버전을 종료해.”**를 안내한다. 이 문구는 AI 모델이 새로 쓰는 것이 아니라 Shipping 상태와 증거에서 결정된다.

`v1.5.0`부터는 같은 보고서의 **전체 개발계획**에서 최종 목표까지 필요한 버전 순서를 함께 보여준다. 현재 버전만 상세 계약이며, 다음 버전은 앞 버전이 `CLOSED`된 뒤 저장소를 다시 분석한다. 따라서 먼 미래의 명령이나 파일을 AI가 미리 추측해 현재 권한으로 사용하지 않는다.

`v1.6.0`부터는 처음 범위를 승인할 때 운영 방식도 한 번 선택할 수 있다. `MANUAL`은 기존처럼 변경 단계마다 사람의 권한을 요구한다. `LOCAL_REVERSIBLE`은 범위·테스트·복구가 증명된 로컬 작업만 자동으로 진행하고, 필수 검증이 모두 통과하면 개발 버전을 자동으로 `CLOSED`할 수 있다. 데이터 삭제, 인증·보안·라이선스 변경, 비용 발생, 외부 배포와 공개는 자동으로 진행하지 않는다. `CLOSED`는 개발 완료이며 실제 배포를 뜻하는 `RELEASED`가 아니다.

그 뒤에는 다음 상태만 보면 된다.

```text
계획 중 → 승인 대기 → 개발 중 → 완료 준비됨 → 버전 완료
                         └→ 문제로 중단
```

`문제로 중단`이면 Shipping Harness는 선택적인 개선이 아니라 현재 버전을 실제로 막는 문제와 남은 수정 기회만 보여준다.

오토파일럿의 판단은 네 가지뿐이다.

```text
AUTO    안전한 로컬 작업을 계속함
NOTIFY  계속하고 결과를 알림
ASK     실제 영향이 있어 사람에게 물음
STOP    증거나 복구가 부족해 중단함
```

## 4. 즉시 멈추기

에이전트에게 다음처럼 말한다.

> Shipping Harness 작업을 지금 일시정지해.

사람의 중단은 모든 자동 재개보다 우선한다.

## 5. 설치 복구

설치가 깨졌을 때 JSON 파일을 직접 고치지 않는다.

```bash
"$PLUGIN" repair \
  --install-root "$HOME/.local/share/shipping-harness-plugin" \
  --host codex \
  --codex-home "$HOME/.codex" \
  --project-root /path/to/project \
  --apply
```

복구는 플러그인 파일과 Codex 등록만 고친다. 대상 프로젝트의 `.shipping` 계약, 증거, 완료 기록은 수정하지 않는다.

## 6. 삭제와 재설치

```bash
"$PLUGIN" uninstall \
  --install-root "$HOME/.local/share/shipping-harness-plugin" \
  --apply
```

삭제해도 대상 프로젝트의 `.shipping` 상태는 남는다. 다시 설치하면 진행 중이던 버전 또는 완료된 버전 기록을 그대로 읽는다.

## 사용 원칙

- 사용자는 세부 기술 질문의 답변자가 아니라 최종 승인자다.
- 에이전트의 “완료했습니다”라는 문장만으로 버전이 완료되지 않는다.
- 현재 Git SHA의 검증 증거와 필수 완료조건이 있어야 `CLOSED`가 된다.
- 선택적인 개선은 다음 버전으로 이동한다.
- 자동 Push와 실제 배포는 별도 승인 없이는 수행하지 않는다.

## 8. 실전 강화 증거

v1.6.1은 오토파일럿 권한을 늘리지 않는다. 여러 모델 표현, 위험한 외부 영향, Dirty 프로젝트, 재시작, 중복 실행, 실제 프로젝트 읽기 전용 분석을 반복해도 하네스의 판정과 대상 파일이 흔들리지 않는지 검증한다.

```text
False AUTO/ASK/STOP/CLOSED/RELEASED  0
실제 프로젝트 무단 변경             0
모델 문장에 의한 권한 변경           0
OMP 바이너리 변경                    0
```

이 지표 중 하나라도 0이 아니면 자동 진행이나 버전 종료는 차단된다.

## 9. 프로젝트 목표를 잘 모를 때

다음처럼 짧게 말해도 된다.

```text
이 프로젝트를 분석해서 완성해.
모르는 부분은 필요한 것만 물어보고, 내가 모르면 안전한 권장안을 사용해.
```

하네스는 먼저 저장소를 분석한다. 목표가 충분히 구체적이면 질문하지 않는다. 정말 결과가 달라지는 경우에만 한 번에 최대 세 가지를 묻는다.

```text
가장 먼저 완성할 결과
가장 먼저 사용할 사람
로컬·회사 내부·외부 중 운영 경계
```

프레임워크, 라이브러리, 파일 경로, 명령어 같은 기술 질문은 하지 않는다. 잘 모르겠으면 다음 한 문장으로 안전한 기본안을 선택할 수 있다.

```text
권장안으로 결정해.
```

질문은 최대 두 라운드다. 그래도 핵심 방향이 불명확하면 자동으로 개발하지 않고 멈춘다. 확정된 방향은 전체 개발계획의 입력일 뿐이며, 그 자체로 코드 실행·범위 승인·버전 종료·배포 권한을 갖지 않는다.

## v1.8.1에서 달라진 점

하네스가 저장소를 먼저 읽고, 정말 필요한 제품 질문만 최대 3개씩 두 번까지 묻습니다. 모르면 `권장안으로 결정해`라고 답할 수 있습니다. 확정된 방향은 Goal Charter와 전체 버전 계획으로 연결되지만, Production 배포·외부 공개·비용·데이터 삭제·보안 변경은 자동 승인되지 않습니다.

## v1.8.3에서 달라진 점

다음처럼 짧게 말하면 하네스가 개발을 요청받았다고 확대 해석하지 않습니다.

```text
이 프로젝트 분석해. 쉬핑하네스로
```

하네스는 먼저 읽기 전용 분석을 끝낸 뒤 딱 한 번 묻습니다.

```text
1. 분석 결과만
2. 다음 버전 계획까지
3. 승인 후 구현까지
4. 정책 범위 안에서 검증·CLOSED까지
```

답하기 전 기본값은 `ANALYZE_ONLY`입니다. 따라서 코드 수정, 커밋, 테스트 실행, Goal Charter, 전체 개발계획 확정, 범위 승인, 버전 종료가 발생하지 않습니다. `DIRTY_BASELINE`이 있어도 프로젝트 분석 결과는 보여주며, 기존 변경사항은 의도가 확정되기 전 자동으로 보존하거나 폐기하지 않습니다.

`PLAN_ONLY`는 목표 질문과 버전별 계획까지만 만들고 개발하지 않습니다. `IMPLEMENT`와 `AUTOPILOT`만 기존 범위 승인·정책 Gate로 들어갑니다.

## 10. 개발 중인 프로젝트 — 전체 계획을 하네스에 알려주기

이미 개발이 진행 중이고 전체 계획(`docs/planning/`, `STATUS.json`, 로드맵 문서 등)이 저장소 안에 있다면, 모델에게
그 계획을 읽고 `docs/shipping-plan.json` 파일로 정리해 달라고 시킬 수 있다.

```text
docs/planning 아래 문서와 STATUS 파일을 읽고 docs/shipping-plan.json을 써줘.
schemas/v1/shipping-plan.schema.json 형식을 따르고, 명령어는 절대 넣지 마.
```

이 파일은 사람이 검토하고 커밋하는 일반 소스 파일이다. 하네스는 이 파일을 쓰지 않고, 내용을 검증만 한다. 저장
전에 다음으로 확인할 수 있다.

```bash
shipping-harness plan check --json
shipping-harness plan status
```

`docs/shipping-plan.json`이 있으면 이후 `shipping_start` 응답 맨 위에 세 부분이 고정 순서로 나온다.

- **전체 목표** — 프로젝트 전체가 끝났을 때의 결과와 현재까지 몇 단계가 끝났는지, 다음 세 단계.
  실행·승인 권한이 없는 읽기 전용 요약이다.
- **이번 릴리즈** — 지금 승인하면 실제로 진행되는 단계 하나(MILESTONE 또는 작은 수정). 승인 대상은
  언제나 이 하나뿐이며, 전체 목표는 승인할 수 없다.
- **작은 수정** — 별도의 작은 수정 후보가 있을 때만 나온다.

승인은 지금과 똑같이 정확히 하나의 제안(이번 릴리즈)에만 한다. 자세한 파일 형식과 예제는
[`docs/SHIPPING-PLAN.md`](SHIPPING-PLAN.md)를 본다.
