import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { expect, test } from "@playwright/test"

const root = resolve(process.cwd(), "..")
const doc = (name: string) => readFileSync(resolve(root, "docs", name), "utf8")
const guide = doc("DEVELOPER_START_HERE.md")
const spec = doc("DEPLOYMENT_SPEC.md")
const work = doc("BACKEND_HANDOFF_CHECKLIST_2026-09-09.md")
const matrix = doc("HACKATHON_INTEGRATION_MATRIX_2026-09-08.md")
const groups = ["G01", "G02", "G03", "G04", "G05", "G06", "G07", "G08", "G08-R", "G09", "G09-S", "G10", "G11", "G12", "G13"]

// These guards check documentation traceability, not provider implementation
// or browser coverage. Runtime evidence is deliberately recorded separately.
test("HANDOFF-SYNC-010 local mobile changes stay separate from release claims and preserve the minimum integration scope", () => {
  const name = "KTOUR_MOBILE_REFINEMENT_LOCAL_2026-09-16.md"
  const local = doc(name)
  for (const file of ["HARVEY_HACKATHON_HANDOFF_2026-09-14.md", "KTOUR_PRODUCTION_HANDOFF_2026-09-15.md", "EXPERIENCE_MOCK_HANDOFF_2026-09-15.md", "KTOUR_JOURNEY_PASS_LOCAL_2026-09-16.md", "toss-grade-ux/FL-018_LABS_WALLET_BRIDGE.md"]) {
    expect(doc(file), file).toContain(name)
  }
  for (const boundary of ["local/journey-pass-20260916", "미커밋 / 미푸시 / 미배포", "새 필수 백엔드/API 범위를 추가하지 않는다", "무료 가이드 읽기", "CX", "OpenDID", "Sui", "OmniOne", "결제≠방문", "2분 요청 만료는 데이터 삭제 기한이 아니다", "실제 iPhone Safari/Android"]) {
    expect(local, boundary).toContain(boundary)
  }
  for (const link of [...local.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]).filter(link => !/^(?:https?:|#)/.test(link))) {
    expect(existsSync(resolve(root, "docs", link.split("#")[0])), link).toBe(true)
  }
  const labs = doc("toss-grade-ux/FL-018_LABS_WALLET_BRIDGE.md")
  expect(labs).toContain("일반 bridge")
  expect(labs).toContain("집중형 기념품")
  expect(labs).toContain("서로 다른10곳")
})

test("HANDOFF-SYNC-008 concise handoff keeps the flow, all four integrations, resources and delivery scope", () => {
  const brief = doc("HARVEY_HACKATHON_HANDOFF_2026-09-14.md")
  const detailed = doc("HACKATHON_ONE_WEEK_SPEC_2026-09-14.md")
  expect(brief).toContain("OmniOne CX + OpenDID + OmniOne Chain + Sui")
  for (const requirement of ["Move", "zkLogin", "PTB", "Agentic AI", "DeepSurge", "provenance"]) {
    expect(brief, requirement).toContain(requirement)
  }
  expect(brief).toContain("HACKATHON_SUI_REQUIRED_ADDENDUM_2026-09-14.md")
  expect(brief).toContain("2026-09-21(월) 18:00 KST")
  expect(brief).toContain("https://github.com/woogieboogie-jl/k-tour-id")
  expect(brief).toContain("handoff/harvey-20260914")
  expect(brief).not.toContain("최신 인계 브랜치는 별도 공유 예정")
  expect(brief).toContain("대표 사용자 플로우")
  expect(brief).toContain("구현할 작업")
  expect(brief).toContain("참고 리소스")
  expect(brief).toContain("1주 개발 명세")
  expect(brief).toContain("외부 앱 복귀")
  expect(brief).toContain("취소·잘못된 증명·만료·철회")
  expect(brief).toContain("현재 공개 앱은 목업")
  for (const scope of ["골목 가이드 무료 읽기", "내 패스에 담기", "save-neighborhood-guide-to-pass", "ktour-neighborhood-guide-save-v2", "demo-traveler-pass"]) {
    expect(brief, scope).toContain(scope)
  }
  expect(brief).toContain("공개 읽기는 IDB·gate·intent를 만들지 않습니다")
  expect(brief).toContain("이전 v1 읽기 승인·기록은 삭제/변환하거나 새 저장 동의로 재사용하지 않습니다")
  expect(brief).toContain("별도 서명 VC·방문 배지·결제·예약·매장 제공 의무가 아닙니다")
  expect(brief).toContain("https://github.com/OmniOneID/did-release")
  expect(brief.length).toBeLessThan(6000)
  expect(detailed).toContain("이번 팀의 필수 구현 범위")
  expect(detailed).not.toContain("M0-only 제출로 축소할지 결정")
  expect(detailed).toContain("HARVEY_HACKATHON_HANDOFF_2026-09-14.md")
})

test("HANDOFF-SYNC-009 required Sui scope includes real execution, distinct service finality and bounty evidence", () => {
  const sui = doc("HACKATHON_SUI_REQUIRED_ADDENDUM_2026-09-14.md")
  const detailed = doc("HACKATHON_ONE_WEEK_SPEC_2026-09-14.md")
  for (const term of ["zkLogin + PTB", "Agentic AI", "Move package", "DeepSurge", "provenance", "fulfillment_blocked", "durable intent", "A13", "A20"]) {
    expect(sui, term).toContain(term)
  }
  expect(sui).toContain("Sui 권한 행사 성공은 혜택 사용 완료가 아니다")
  expect(sui).toContain("코드 완료와 접수/수상/격려금 지급은 별도 판정")
  expect(detailed).not.toContain("이번 인계에서는 Sui를 구현 범위에서 제외한다")
  expect(detailed).not.toContain("Sui: 이번 범위 제외")
  expect(detailed).toContain("M2: 팀 필수 Sui 바운티 범위")
  expect(detailed).toContain("A01–A20")
})

test("HANDOFF-SYNC-001 every current flow group has an assigned work package and detailed contract", () => {
  const rows = guide.split("\n").filter(row => /^\| G\d{2}(?:-[RS])? /.test(row))
  expect(rows.map(row => row.split("|")[1].trim().split(" ")[0])).toEqual(groups)
  for (const row of rows) {
    const group = row.split("|")[1].trim().split(" ")[0]
    expect(row, group).toMatch(/BE-\d{2}/)
    expect(spec, group).toContain(group)
  }
  for (let i = 1; i <= 16; i++) {
    const id = "BE-" + String(i).padStart(2, "0")
    expect(guide, id).toContain(id)
    expect(work, id).toContain("| " + id + " |")
  }
})

test("HANDOFF-SYNC-002 every concrete B source touchpoint in the start guide exists", () => {
  const paths = [...guide.matchAll(/`B\/([^\`]+\.(?:tsx?|css))`/g)].map(match => match[1])
  expect(paths.length).toBeGreaterThanOrEqual(14)
  for (const path of paths) expect(existsSync(resolve(process.cwd(), "features/ondo", path)), path).toBe(true)
})

test("HANDOFF-SYNC-003 current handoff and README local document links resolve", () => {
  for (const file of ["README.md", "docs/DEVELOPER_START_HERE.md", "docs/DEPLOYMENT_SPEC.md", "docs/BACKEND_HANDOFF_CHECKLIST_2026-09-09.md", "docs/HACKATHON_INTEGRATION_MATRIX_2026-09-08.md", "docs/HACKATHON_ONE_WEEK_SPEC_2026-09-14.md", "docs/HARVEY_HACKATHON_HANDOFF_2026-09-14.md", "docs/HACKATHON_SUI_REQUIRED_ADDENDUM_2026-09-14.md", "docs/KTOUR_PRODUCTION_HANDOFF_2026-09-15.md", "docs/GITHUB_BRAND_CLEANUP_2026-09-15.md", "docs/MAP_FIRST_ENTRY_2026-09-14.md", "docs/PLACE_AFTER19_FIX_2026-09-14.md"]) {
    const text = readFileSync(resolve(root, file), "utf8")
    const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1])
    for (const link of links.filter(link => !/^(?:https?:|#)/.test(link))) {
      const target = link.split("#")[0]
      expect(existsSync(resolve(dirname(resolve(root, file)), target)), file + " -> " + link).toBe(true)
    }
  }
})

test("HANDOFF-SYNC-004 proposed recovery APIs cover pending operations, history and asynchronous jobs", () => {
  for (const api of [
    "GET /operations/{id}", "POST /identity/sessions/{id}/additional-evidence",
    "POST /credentials/{id}/recovery-sessions", "POST /payments/{id}/capture",
    "GET /partner/disputes?settlementId&cursor", "GET /partner/settlement-exports/{id}",
    "GET /me/data-exports/{id}", "GET /me/account-deletions/{id}", "GET /badges/claims/{id}",
  ]) expect(spec, api).toContain(api)
  expect(guide).toContain("API는 모두 앱/BFF 구현 제안")
  expect(guide).toContain("generic Demo 검증만으로")
  expect(spec).toContain("SettlementSupportB")
  expect(spec).not.toContain("IntegrationSettlementSupportB")
})

test("HANDOFF-SYNC-005 all provider work retains separate responsibility and official/project distinctions", () => {
  for (const name of ["OmniOne CX", "OpenDID", "OmniOne Chain", "Sui"]) {
    expect(guide, name).toContain(name)
    expect(matrix, name).toContain(name)
  }
  for (const id of ["ADR-AUTH-01", "ADR-DID-01", "ADR-AGE-01", "ADR-RESIDENCE-01", "ADR-PAYMENT-01", "ADR-CHAIN-01", "ADR-SUI-01", "ADR-DATA-01"]) {
    expect(spec, id).toContain("| " + id + " |")
  }
  const readme = readFileSync(resolve(root, "README.md"), "utf8")
  expect(readme).toContain("./docs/DEVELOPER_START_HERE.md")
  expect(readme).not.toContain("| `/partner/verify` |")
  expect(guide).toContain("실제 연동·테스트 자금 이동·운영 credential 발급을 목업 완료의 조건으로 요구하지 않는다")
})

test("HANDOFF-SYNC-006 current app/main/Harvey paths agree and historical release evidence stays separate", () => {
  const currentName = "KTOUR_PRODUCTION_HANDOFF_2026-09-15.md"
  const current = doc(currentName)
  const brief = doc("HARVEY_HACKATHON_HANDOFF_2026-09-14.md")
  const detailed = doc("HACKATHON_ONE_WEEK_SPEC_2026-09-14.md")
  const readme = readFileSync(resolve(root, "README.md"), "utf8")

  for (const text of [readme, guide, spec, work, matrix, brief, detailed]) {
    expect(text).toContain(currentName)
    expect(text).toContain("https://ktour-id.vercel.app")
    expect(text).toContain("handoff/harvey-20260914")
    expect(text).toContain("main")
    expect(text).not.toContain("git clone --branch release/ktour-brand-20260915")
    expect(text).not.toContain("오래된 `main`")
  }
  for (const text of [readme, detailed]) {
    expect(text).toContain("git clone --branch handoff/harvey-20260914 --single-branch")
  }
  for (const text of [current, brief]) {
    expect(text).toContain("https://ktour-id.vercel.app")
    expect(text).toContain("https://github.com/woogieboogie-jl/k-tour-id/tree/handoff/harvey-20260914")
    expect(text).toContain("OmniOne Chain")
    expect(text).toContain("OpenDID")
    expect(text).toContain("Sui")
    expect(text).toContain("Sumsub")
    expect(text).toContain("별도")
  }
  expect(current).toContain("https://github.com/woogieboogie-jl/k-tour-id/tree/main")
  expect(current).toContain("동일한 앱·문서 소스로 동기화")
  expect(current).toMatch(/상태: \*\*(?:pending|Ready)/)
  // These are documentation guards, not proof that remote branches or deployment agree.
  // A release marked Ready must nevertheless identify the runtime and the verified branch heads.
  if (/상태: \*\*Ready/.test(current)) {
    for (const label of ["배포 source", "배포 ID·고유 URL", "main / Harvey 원격 HEAD"]) {
      const row = current.split("\n").find(line => line.startsWith("| " + label + " |"))
      expect(row, label).toBeDefined()
      expect(row, label).not.toContain("pending")
    }
    expect(current).toMatch(/\| 배포 source \|[^\n]*[a-f0-9]{7,40}/)
    expect(current).toMatch(/\| 배포 ID·고유 URL \|[^\n]*dpl_[A-Za-z0-9]+/)
    expect(current).toMatch(/\| main \/ Harvey 원격 HEAD \|[^\n]*[a-f0-9]{7,40}/)
  }

  const historicalName = "BRAND_SHARE_REFRESH_2026-09-14.md"
  const historical = doc(historicalName)
  const historicalSource = historical.match(/배포 source `([a-f0-9]{7})`/)?.[1]
  expect(historicalSource).toBeDefined()
  for (const text of [readme, guide, spec, work, matrix]) expect(text).toContain(historicalName)
  expect(readme).toContain("./docs/HACKATHON_ONE_WEEK_SPEC_2026-09-14.md")
  expect(guide).toContain("./HACKATHON_ONE_WEEK_SPEC_2026-09-14.md")
  const currentRelease = spec.split("\n").find(line => line.includes("`release:current`"))
  expect(currentRelease).toContain(currentName)
  expect(currentRelease).not.toContain(historicalSource!)
  expect(spec).toContain("`release:historical:" + historicalSource + "`")
  const currentBaseline = work.split("\n").find(line => line.includes("`baseline:current`"))
  expect(currentBaseline).toContain(currentName)
  expect(work).not.toContain("`baseline:current:" + historicalSource + "`")
  expect(work).toContain("`baseline:historical:" + historicalSource + "`")
  for (const text of [readme, current, doc("GITHUB_BRAND_CLEANUP_2026-09-15.md")]) {
    expect(text).toContain("https://github.com/woogieboogie-jl/k-tour-id/tree/9d4aec9")
  }
  expect(historical).toContain("실제 provider 연결")
  expect(historical).toContain("실제 iPhone Safari/Android")
  expect(readme).toContain("last functional-flow QA baseline is historical `e2ad7c4`")
  expect(guide).toContain("마지막 기능 흐름 검수 기준은 이전 `e2ad7c4`")
  expect(historical).toContain("계약833/833")
  expect(historical).toContain("이번 소스에서 재실행한 결과가 아님")
})

test("HANDOFF-SYNC-007 map-wallet journeys have matching place, order and reservation backend contracts", () => {
  const record = "MAP_WALLET_JOURNEYS_2026-09-12.md"
  for (const text of [guide, spec, work, matrix]) expect(text).toContain(record)
  const journeys = doc(record)
  for (const id of ["MW-01", "MW-02", "MW-03", "MW-04", "MW-05"]) expect(journeys).toContain("| " + id + " |")
  for (const api of ["GET /places/{id}/services", "GET /places?capability=wallet&cityId&cursor", "GET /orders?cursor", "GET /orders/{id}", "GET /reservations?venueId&cursor"]) expect(spec).toContain(api)
  for (const boundary of ["PREPARE_QUOTE", "sampleOnly: true", "PLACE_SERVICE_RETURN_EVENT_B", "SHOW_BALANCE_PLACES_EVENT_B", "CommerceOrderContextB"]) expect(spec).toContain(boundary)
})
