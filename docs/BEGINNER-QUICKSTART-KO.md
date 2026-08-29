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

그 뒤에는 다음 상태만 보면 된다.

```text
계획 중 → 승인 대기 → 개발 중 → 완료 준비됨 → 버전 완료
                         └→ 문제로 중단
```

`문제로 중단`이면 Shipping Harness는 선택적인 개선이 아니라 현재 버전을 실제로 막는 문제와 남은 수정 기회만 보여준다.

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
