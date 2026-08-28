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

Shipping Harness가 보여주는 것은 네 가지뿐이다.

1. 이번 버전에 무엇을 넣을지
2. 무엇을 다음 버전으로 미룰지
3. 무엇으로 완료를 증명할지
4. 사용자가 승인하거나 결정해야 할 위험

내용이 맞으면 **“이대로 시작”**이라고 답한다.

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
