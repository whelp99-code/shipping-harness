# [High] 검증 후 미커밋 변경으로 테스트가 실패해도 release close가 CLOSED를 허용함

Status: FIXED in v1.10.0 (dirty-tree evidence fix pass; evidence is bound to a tree fingerprint and goes stale on an uncommitted edit — see docs/planning/34-V1.10.0-STATE-INTEGRITY-AND-CONTRACT-DEFECT-DEVELOPMENT-PLAN.md section 6.10)
Reported: 2026-09-12
Type: Correctness / completion integrity
Scope: core verification and closure

## 확인 결과

현재 작업 트리의 코드를 임시 fixture 저장소에서 호출해 재현했다. 실제 프로젝트 소스/계약/릴리스 상태는 수정하지 않았다.

1. test/helpers/repo.mjs의 createFixtureRepo()로 임시 저장소 생성.
2. fixture.lock() 후 verifyRelease(root) 실행: SHIPPABLE.
3. 커밋하지 않고 package.json의 test 스크립트를 `node -e "process.exit(1)"`로 변경.
4. 같은 임시 저장소에서 npm test 실행: 종료 코드 1.
5. closeRelease(root) 실행: CLOSED.
6. 임시 저장소 정리.

관측 결과: {"verified":"SHIPPABLE","modifiedTestExit":1,"close":"CLOSED"}

## 영향 및 원인

src/core/gate.mjs의 closeRelease는 currentEvidenceSha와 현재 HEAD, 계약 해시, 저장된 manifest와 필수 실패 수를 검사하지만 검증 후 달라진 작업 트리 내용을 대조하지 않는다. src/core/evidence.mjs의 assertFreshEvidence는 계약 해시와 Git SHA를 비교한다. 미커밋 변경은 HEAD를 바꾸지 않으므로 현재 파일이 검증된 상태와 다른데도 종료가 허용된다.

관련 상태/의도 테스트 13개는 통과했다. 이는 이 회귀의 부재를 증명하지 않는다. 배포된 설치 패키지에 대한 동일 재현은 수행하지 않았으며, 이번 재현 대상은 개발 체크아웃 코드다.

## 수정 방향

검증 대상의 실제 소스 상태와 실행 환경을 증거에 결합하고 종료 시 재확인한다. 정책에 따라 제품 관련 dirty 상태를 거부하거나, tracked/untracked 제품 파일의 결정적 fingerprint를 저장/대조한다. 하네스 자체 증거·상태 파일은 명시적으로 분리해 정상 종료를 막지 않도록 한다. 격리 검증의 커밋 결과와 현재 작업 트리 결과를 혼동하지 않는다. 무조건 자동 커밋하거나 유효한 검증을 항상 재실행하는 방식으로 우회하지 않는다.

## 인수 기준

- 위 재현에서 CLOSED가 거부되고 증거가 오래됐거나 소스가 변경됐다는 이유가 표시된다.
- tracked 수정, 새 제품 파일, 삭제, 검증 이후 및 검증 도중 변경을 다룬다.
- 관련 소스가 변하지 않은 경우 유효한 증거를 재사용해 정상 종료한다.
- 하네스가 생성한 증거/상태만 변경된 경우 거짓 소스 변경으로 처리하지 않는다.
- 계약 해시와 Git SHA 검사, 사람 pause/abort, 필수 실패, blocker 판정은 유지한다.
- CLI/MCP가 같은 종료 경계를 적용하는지 검증하고, 개발 소스와 설치 패키지 결과를 따로 기록한다.

코드 수정은 아직 수행하지 않았다. Git remote가 없어 GitHub 이슈 대신 로컬 이슈로 등록했다.
