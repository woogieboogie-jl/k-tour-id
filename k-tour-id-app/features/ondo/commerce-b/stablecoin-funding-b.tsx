"use client"

import { useState } from "react"
import { ArrowDown, ArrowRight, Check, CircleCheck, Coins, Fingerprint, FlaskConical, ShieldCheck, WalletCards } from "lucide-react"
import type { OndoBLocale } from "../shared/state/ondo-b-preferences"
import { FUNDING_CREDIT_AMOUNTS_B, stablecoinCanAuthorizeB, type FundingRailActionB, type FundingRailOperationB, type FundingSampleOutcomeB, type StablecoinSignerMethodB } from "./funding-rail-model-b"
import styles from "./stablecoin-funding-b.module.css"
import { WalletConnectionPreviewB } from "./wallet-connection-preview-b"

type Props = {
  operation: FundingRailOperationB
  locale: OndoBLocale
  closing: boolean
  creditComplete: boolean
  balance: string
  returnLabel: string
  onAction: (action: FundingRailActionB) => unknown
  onAmount: (amount: number) => void
  onCreditRetry: () => void
  onUseBalance: () => void
  onMethods: () => void
  onClose: () => void
}

/** This visible route is a connected-product rehearsal, not a wallet SDK.
 * Source confirmation and destination confirmation remain separate actions. */
export function StablecoinFundingB({ operation, locale, closing, creditComplete, balance, returnLabel, onAction, onAmount, onCreditRetry, onUseBalance, onMethods, onClose }: Props) {
  const [consent, setConsent] = useState(false)
  const [method, setMethod] = useState<StablecoinSignerMethodB>(operation.stablecoin?.signerMethod ?? "zklogin")
  const [signerResult, setSignerResult] = useState<"ready" | "failed" | "wrong_network">("ready")
  const [sourceOutcome, setSourceOutcome] = useState<FundingSampleOutcomeB>("settled")
  const [destinationOutcome, setDestinationOutcome] = useState<FundingSampleOutcomeB>("settled")
  const [connectionQuote, setConnectionQuote] = useState<string | null>(null)
  const w = (en: string, ko: string, ja: string) => locale === "ko" ? ko : locale === "ja" ? ja : en
  const stable = operation.stablecoin
  if (!stable) return null
  const { phase, quote } = operation
  const money = (amount: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(amount)
  const tokens = (atomic: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(atomic / 1_000_000)
  const sourceDone = stable.sourceStatus === "confirmed"
  const destinationDone = stable.destinationStatus === "confirmed"
  const inFlight = phase === "pending" || phase === "unknown"
  const rejected = ["failed", "cancelled", "expired"].includes(phase)
  const credited = phase === "settled" && creditComplete
  const step = phase === "quoted" ? 0 : phase === "authorize" ? 1 : destinationDone ? 3 : 2
  const act = (action: FundingRailActionB) => { if (!closing) onAction(action) }
  const check = (destination: boolean) => {
    act({ type: destination ? "DESTINATION_STATUS" : "SOURCE_STATUS", operationId: operation.operationId, quoteId: quote.quoteId, result: destination ? destinationOutcome : sourceOutcome, now: Date.now() })
    // A following explicit status check can resolve the same operation.
    if (destination) setDestinationOutcome("settled")
    else setSourceOutcome("settled")
  }
  const transferStatus = <ol className={styles.journey} aria-label={w("Transfer status", "전송 현황", "送信状況")}>
    <li data-complete={sourceDone}><span>{sourceDone ? <Check size={15} aria-hidden="true" /> : 1}</span><div><strong>{stable.asset} · Sui</strong><small>{sourceDone ? w("Source confirmed · sample", "출발 확인 · 샘플", "送信元確認・サンプル") : w("Source confirmation pending", "출발 확인 대기", "送信元の確認待ち")}</small></div></li>
    <li data-complete={destinationDone}><span>{destinationDone ? <Check size={15} aria-hidden="true" /> : 2}</span><div><strong>{w("Balance arrival", "잔액 도착", "残高への到着")}</strong><small>{destinationDone ? w("Destination confirmed · sample", "도착 확인 · 샘플", "到着確認・サンプル") : w("Arrival pending · sample", "도착 확인 대기 · 샘플", "到着確認待ち・サンプル")}</small></div></li>
    <li data-complete={creditComplete}><span>{creditComplete ? <Check size={15} aria-hidden="true" /> : 3}</span><div><strong>{w("Travel balance", "여행 잔액", "旅の残高")}</strong><small>{creditComplete ? w("Credited once", "한 번만 반영 완료", "1回のみ反映済み") : w("Unchanged until arrival is confirmed", "도착 확인 전까지 잔액 유지", "到着確認までは残高を維持")}</small></div></li>
  </ol>
  if (connectionQuote && phase === "quoted") return <WalletConnectionPreviewB key={connectionQuote} locale={locale} method={method}
    onReturn={() => { setConnectionQuote(null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-testid="stablecoin-connect"]')?.focus()) }}
    onApprove={() => {
      if (!closing && connectionQuote === quote.quoteId) act({ type: "CONNECT_SIGNER", method, result: signerResult, now: Date.now() })
      setSignerResult("ready"); setConnectionQuote(null)
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-testid="stablecoin-connect"]')?.focus())
    }} />
  return <div className={styles.root} data-testid="stablecoin-funding" data-stage={stable.stage} data-source-status={stable.sourceStatus} data-destination-status={stable.destinationStatus} data-credit-complete={credited}>
    <p className={styles.truth}><FlaskConical size={15} aria-hidden="true" />{w("Sample journey · no real funds move", "샘플 체험 · 실제 자금 이동 없음", "サンプル体験・実際の資金移動なし")}</p>
    {!credited ? <ol className={styles.steps} aria-label={w("Stablecoin funding steps", "스테이블코인 충전 단계", "ステーブルコインのチャージ手順")}>
      {[w("Quote", "견적", "見積もり"), w("Approve", "승인", "承認"), w("Transfer", "전송", "送信"), w("Arrival", "도착", "到着")].map((label, index) => <li key={index} data-active={index <= step} aria-current={index === step ? "step" : undefined}><span>{index < step ? <Check size={12} aria-hidden="true" /> : index + 1}</span>{label}</li>)}
    </ol> : null}

    <div className={styles.content} data-testid={credited ? "stablecoin-receipt" : undefined}>
    {credited ? <>
      <section className={styles.completedSummary} aria-label={w("Top-up complete", "충전 완료", "チャージ完了")}>
        <strong data-testid="funding-credited-amount">+{money(quote.creditKrw)}</strong>
        <p>{w("Added to your sample travel balance", "샘플 여행 잔액에 반영됐어요", "サンプルの旅の残高に追加しました")}</p>
        <dl><div><dt>{w("Sample travel balance", "샘플 여행 잔액", "サンプルの旅の残高")}</dt><dd data-testid="funding-receipt-balance">{balance}</dd></div></dl>
      </section>
      <button type="button" className={styles.primary} disabled={closing} data-testid="funding-sample-use" onClick={onUseBalance}>{returnLabel}</button>
    </> : phase === "quoted" || phase === "authorize" ? <>
      <div className={styles.exchange}>
        <div><span className={styles.assetIcon}><Coins size={24} aria-hidden="true" /></span><span><small>{w("From your sample wallet", "샘플 지갑에서", "サンプルウォレットから")}</small><strong>{tokens(stable.sourceAmountAtomic)} <em>{stable.asset}</em></strong></span></div>
        <ArrowDown className={styles.exchangeArrow} size={19} aria-hidden="true" />
        <div><span className={styles.assetIcon}><WalletCards size={24} aria-hidden="true" /></span><span><small>{w("To travel balance", "여행 잔액으로", "旅の残高へ")}</small><strong>{money(quote.creditKrw)}</strong></span></div>
      </div>
      {phase === "quoted" ? <>
        <fieldset className={styles.selector}><legend>{w("Choose a stablecoin", "코인을 선택해 주세요", "コインを選択")}</legend><div>{(["USDC", "USDT"] as const).map(asset => <button key={asset} type="button" data-testid={`stablecoin-asset-${asset}`} aria-pressed={stable.asset === asset} disabled={closing} onClick={() => { setConsent(false); act({ type: "SELECT_ASSET", asset, now: Date.now() }) }}>{asset}</button>)}</div></fieldset>
        <fieldset className={styles.selector}><legend>{w("Amount to receive", "받을 금액", "受取額")}</legend><div>{FUNDING_CREDIT_AMOUNTS_B.map(amount => <button key={amount} type="button" data-testid={`funding-amount-${amount}`} aria-pressed={quote.creditKrw === amount} disabled={closing} onClick={() => { setConsent(false); onAmount(amount) }}>{money(amount)}</button>)}</div></fieldset>
        <section className={styles.signer} aria-label={w("Sample wallet connection", "샘플 지갑 연결", "サンプルウォレット接続")}>
          <div className={styles.sectionHeading}><WalletCards size={18} aria-hidden="true" /><h3>{w("Prepare your wallet", "지갑 준비", "ウォレットの準備")}</h3>{stable.signerStatus === "ready" && stable.signerMethod === method ? <span className={styles.ready}>{w("Ready", "준비됨", "準備完了")}</span> : null}</div>
          <div className={styles.signerChoices}>{(["zklogin", "existing_wallet"] as const).map(choice => <button type="button" key={choice} data-testid={`stablecoin-signer-${choice}`} aria-pressed={method === choice} disabled={closing} onClick={() => setMethod(choice)}>{choice === "zklogin" ? <Fingerprint size={18} aria-hidden="true" /> : <WalletCards size={18} aria-hidden="true" />}<span>{choice === "zklogin" ? w("Connect with a social account", "소셜 계정으로 연결", "ソーシャルアカウントで接続") : w("Existing wallet", "기존 지갑", "既存ウォレット")}</span></button>)}</div>
          <p>{w("Target: Sui Testnet · simulated. No account login or signature is sent.", "대상: Sui Testnet · 시뮬레이션. 실제 로그인·서명은 보내지 않아요.", "対象：Sui Testnet・シミュレーション。実際のログインや署名は送信しません。")}</p>
          <button type="button" className={styles.secondary} data-testid="stablecoin-connect" disabled={closing} onClick={() => { setConsent(false); setConnectionQuote(quote.quoteId) }}>{stable.signerStatus === "ready" && stable.signerMethod === method ? w("Reconnect sample wallet", "샘플 지갑 다시 연결", "サンプルを再接続") : w("Connect sample wallet", "샘플 지갑 연결", "サンプルウォレットを接続")}</button>
          {stable.signerStatus === "failed" || stable.signerStatus === "wrong_network" ? <p role="alert" className={styles.error}>{stable.signerStatus === "wrong_network" ? w("Wrong network. Reconnect to the sample Sui route.", "네트워크가 달라요. 샘플 Sui 경로에 다시 연결해 주세요.", "ネットワークが違います。サンプルSuiに再接続してください。") : w("Connection was declined. You can try again.", "연결이 거절됐어요. 다시 시도할 수 있어요.", "接続が拒否されました。もう一度お試しください。")}</p> : null}
        </section>
      </> : <p className={styles.notice}><ShieldCheck size={17} aria-hidden="true" />{w("Approve only this transfer amount. Identity and payment checks stay separate.", "이 전송 금액만 승인해요. 본인 확인과 결제 확인은 별개예요.", "この送信金額だけを承認します。本人確認と決済確認は別です。")}</p>}
      <dl className={styles.facts}>
        <div><dt>{w("Sample network", "샘플 네트워크", "サンプルネットワーク")}</dt><dd>Sui Testnet</dd></div>
        <div><dt>{w("Available in this sample", "이 샘플에서 사용 가능", "このサンプルの利用可能額")}</dt><dd>{tokens(stable.sourceBalanceAtomic)} {stable.asset}</dd></div>
        <div><dt>{w("Included route fee", "포함된 경로 수수료", "経路手数料込み")}</dt><dd>{tokens(stable.feeAtomic)} {stable.asset}</dd></div>
        <div><dt>{w("Illustrative rate", "예시 환산율", "換算例")}</dt><dd>1 {stable.asset} = ₩1,500</dd></div>
        <div><dt>{w("Quote valid until", "견적 유효 시간", "見積もり有効期限")}</dt><dd>{new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(quote.expiresAt)}</dd></div>
      </dl>
      {stable.sourceAmountAtomic > stable.sourceBalanceAtomic ? <p className={styles.error} role="alert">{w("Not enough sample tokens. Restore the sample balance below to continue.", "샘플 코인이 부족해요. 아래에서 샘플 잔액을 복원해 주세요.", "サンプルコインが不足しています。下でサンプル残高を戻してください。")}</p> : null}
      {phase === "authorize" ? <label className={styles.consent}><input type="checkbox" data-testid="funding-consent" checked={consent} disabled={closing} onChange={event => setConsent(event.target.checked)} /><span>{w(`I approve ${tokens(stable.sourceAmountAtomic)} ${stable.asset} in this sample. No real transfer or bridge is submitted.`, `샘플 ${tokens(stable.sourceAmountAtomic)} ${stable.asset} 사용을 승인합니다. 실제 전송·브리지는 실행되지 않아요.`, `サンプルの${tokens(stable.sourceAmountAtomic)} ${stable.asset}を承認します。実際の送信やブリッジは実行しません。`)}</span></label> : null}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} data-testid={phase === "quoted" ? "funding-quote-continue" : "funding-authorize"} disabled={closing || stable.signerMethod !== method || !stablecoinCanAuthorizeB(operation) || (phase === "authorize" && !consent)} onClick={() => act(phase === "quoted" ? { type: "REVIEW", now: Date.now() } : { type: "AUTHORIZE", quoteId: quote.quoteId, consent, outcome: "settled", now: Date.now() })}>{phase === "quoted" ? w("Review transfer", "전송 내용 확인", "送信内容を確認") : w("Approve sample transfer", "샘플 전송 승인", "サンプル送信を承認")}<ArrowRight size={18} aria-hidden="true" /></button>
        <button type="button" className={styles.textButton} data-testid="funding-cancel" disabled={closing} onClick={() => act({ type: "CANCEL", now: Date.now() })}>{w("Not now", "나중에", "後で")}</button>
      </div>
    </> : inFlight || phase === "settled" ? <>
      <div className={styles.resultHero}><span className={styles.resultIcon}>{destinationDone ? <CircleCheck size={29} aria-hidden="true" /> : <Coins size={29} aria-hidden="true" />}</span><strong>{creditComplete ? `+${money(quote.creditKrw)}` : `${tokens(stable.sourceAmountAtomic)} ${stable.asset}`}</strong><p>{creditComplete ? w("Added to your sample travel balance", "샘플 여행 잔액에 반영됐어요", "サンプルの旅の残高に追加しました") : destinationDone ? w("Arrival confirmed. Apply the receipt to update your sample balance.", "도착은 확인됐어요. 결과를 반영하면 샘플 잔액이 업데이트돼요.", "到着を確認しました。結果を反映するとサンプル残高が更新されます。") : sourceDone ? w("Source confirmed. Waiting for arrival.", "출발 확인 완료. 도착을 기다리고 있어요.", "送信元を確認。到着を待っています。") : w("Transfer approved. Confirm the source next.", "전송을 승인했어요. 출발 상태를 확인해 주세요.", "送信を承認しました。送信元を確認してください。")}</p></div>
      {transferStatus}
      {inFlight ? <>
        {phase === "unknown" ? <p className={styles.notice} role="status">{w("This transfer is unresolved. Check the same operation; don’t send again.", "확인이 끝나지 않았어요. 다시 보내지 말고 같은 전송을 조회해 주세요.", "確認が未完了です。再送せず同じ送信を照会してください。")}</p> : null}
        <button type="button" className={styles.primary} data-testid={sourceDone ? "stablecoin-check-destination" : "stablecoin-check-source"} disabled={closing} onClick={() => check(sourceDone)}>{sourceDone ? w("Confirm sample arrival", "샘플 도착 확인", "サンプル到着を確認") : w("Confirm sample source", "샘플 출발 확인", "サンプル送信元を確認")}</button>
        <button type="button" className={styles.textButton} disabled={closing} onClick={onClose}>{w("Check later", "나중에 확인", "後で確認")}</button>
      </> : <>
        <dl className={styles.facts} data-testid="stablecoin-receipt">
          <div><dt>{w("Sample tokens used", "사용한 샘플 코인", "使用したサンプルコイン")}</dt><dd>{tokens(stable.sourceAmountAtomic)} {stable.asset}</dd></div>
          <div><dt>{w("Network", "네트워크", "ネットワーク")}</dt><dd>Sui Testnet · {w("simulated", "시뮬레이션", "シミュレーション")}</dd></div>
          <div><dt>{w("Included route fee", "포함된 경로 수수료", "経路手数料込み")}</dt><dd>{tokens(stable.feeAtomic)} {stable.asset}</dd></div>
          <div><dt>{w("Sample travel balance", "샘플 여행 잔액", "サンプルの旅の残高")}</dt><dd data-testid="funding-receipt-balance">{balance}</dd></div>
        </dl>
        <p className={styles.notice}>{w("No real funds moved. Your identity, payment checks and pass allowance are unchanged.", "실제 자금은 이동하지 않았어요. 신원·결제 확인과 패스 한도는 그대로예요.", "実際の資金移動はありません。本人・決済確認とパス上限は変わりません。")}</p>
        <div className={styles.actions}><button type="button" className={styles.primary} disabled={closing} data-testid={creditComplete ? "funding-sample-use" : "funding-credit-retry"} onClick={creditComplete ? onUseBalance : onCreditRetry}>{creditComplete ? returnLabel : w("Apply sample receipt", "샘플 결과 반영", "サンプル結果を反映")}</button><button type="button" className={styles.secondary} data-testid="funding-add-another" disabled={closing} onClick={onMethods}>{w("Start another top-up", "다른 충전 시작", "別のチャージを開始")}</button></div>
      </>}
    </> : rejected ? <>
      <p className={styles.notice}>{w("No sample tokens were transferred and your travel balance is unchanged. A retry creates a new quote and asks for approval again.", "샘플 코인을 전송하지 않았고 여행 잔액도 그대로예요. 재시도하면 새 견적을 확인하고 다시 승인합니다.", "サンプルコインは送信されず、旅の残高も変わりません。再試行では新しい見積もりを確認して再承認します。")}</p>
      <div className={styles.actions}><button type="button" className={styles.primary} data-testid="funding-retry" disabled={closing} onClick={() => { setConsent(false); act({ type: "RETRY", now: Date.now() }) }}>{w("Try again", "다시 시도", "再試行")}</button><button type="button" className={styles.secondary} disabled={closing} onClick={onMethods}>{w("Choose another method", "다른 방법 선택", "別の方法を選択")}</button></div>
    </> : null}

    <details className={styles.details} data-testid="stablecoin-technical-details"><summary>{w("Route & receipt details", "경로·영수증 상세", "経路・控えの詳細")}</summary>
      {credited ? <div className={styles.completedReceipt}>
        {transferStatus}
        <dl className={styles.facts}>
          <div><dt>{w("Sample tokens used", "사용한 샘플 코인", "使用したサンプルコイン")}</dt><dd>{tokens(stable.sourceAmountAtomic)} {stable.asset}</dd></div>
          <div><dt>{w("Network", "네트워크", "ネットワーク")}</dt><dd>Sui Testnet · {w("simulated", "시뮬레이션", "シミュレーション")}</dd></div>
          <div><dt>{w("Included route fee", "포함된 경로 수수료", "経路手数料込み")}</dt><dd>{tokens(stable.feeAtomic)} {stable.asset}</dd></div>
        </dl>
        <p className={styles.notice}>{w("No real funds moved. Your identity, payment checks and pass allowance are unchanged.", "실제 자금은 이동하지 않았어요. 신원·결제 확인과 패스 한도는 그대로예요.", "実際の資金移動はありません。本人・決済確認とパス上限は変わりません。")}</p>
      </div> : null}
      <p>{w("The social-account connection previews Sui zkLogin; the other option previews an existing wallet. A signer connection is not DID verification or payment approval. Neither option connects a real provider here.", "소셜 계정 연결은 Sui zkLogin, 다른 선택지는 기존 지갑 연결의 예시예요. 서명 지갑 연결은 DID 검증이나 결제 승인이 아닙니다. 여기서는 실제 제공자에 연결하지 않아요.", "ソーシャルアカウントの接続はSui zkLogin、もう一つは既存ウォレット接続の例です。署名用ウォレットの接続はDID検証や決済承認ではありません。実際の事業者には接続しません。")}</p><p>{w("Sui → OmniOne is a simulated interoperability hypothesis, not a supported native bridge. OOKRW is a settlement test-token concept, not redeemable won. These USDC/USDT samples do not claim native or wrapped token availability. Rates and fees are illustrative; no AMM swap is executed.", "Sui → OmniOne은 상호운용 가설 시연이며, 지원이 확인된 네이티브 브리지가 아니에요. OOKRW는 정산 테스트 토큰 개념이지 상환 가능한 원화가 아닙니다. USDC·USDT 샘플은 실제 네이티브·래핑 토큰 지원을 뜻하지 않아요. 환산율·수수료는 예시이며 AMM 스왑은 실행하지 않습니다.", "Sui → OmniOneは相互運用の仮説デモで、対応済みのネイティブブリッジではありません。OOKRWは精算テストトークンの概念で、換金可能なウォンではありません。USDC・USDTサンプルは実際のトークン対応を示しません。レート・手数料は例で、AMMスワップは実行しません。")}</p><dl className={styles.technical}><div><dt>{w("Asset identifier", "자산 식별자", "資産ID")}</dt><dd>{stable.coinType}</dd></div><div><dt>{w("Atomic amount / decimals", "최소 단위 수량 / 소수 자릿수", "最小単位量 / 桁数")}</dt><dd>{stable.sourceAmountAtomic} / {stable.decimals}</dd></div><div><dt>{w("Operation", "작업", "操作")}</dt><dd>{operation.operationId}</dd></div><div><dt>{w("Source sample reference", "출발 샘플 참조", "送信元サンプル参照")}</dt><dd>{stable.sourceReference ?? "—"}</dd></div><div><dt>{w("Arrival sample reference", "도착 샘플 참조", "到着サンプル参照")}</dt><dd>{stable.destinationReference ?? "—"}</dd></div></dl></details>
    {credited ? <button type="button" className={styles.textButton} data-testid="funding-add-another" disabled={closing} onClick={onMethods}>{w("Start another top-up", "다른 충전 시작", "別のチャージを開始")}</button> : null}
    </div>
    {phase === "quoted" || inFlight ? <details className={styles.details}><summary>{w("Sample scenarios", "샘플 상황 선택", "サンプル状況")}</summary><div className={styles.scenarios}>
      {phase === "quoted" ? <><button type="button" data-testid="stablecoin-signer-failed" onClick={() => setSignerResult("failed")} aria-pressed={signerResult === "failed"}>{w("Connection declined", "연결 거절", "接続拒否")}</button><button type="button" data-testid="stablecoin-signer-wrong_network" onClick={() => setSignerResult("wrong_network")} aria-pressed={signerResult === "wrong_network"}>{w("Wrong network", "다른 네트워크", "異なるネットワーク")}</button><button type="button" data-testid="stablecoin-source-empty" onClick={() => act({ type: "SAMPLE_SOURCE_BALANCE", amountAtomic: stable.sourceBalanceAtomic ? 0 : 100_000_000, now: Date.now() })}>{stable.sourceBalanceAtomic ? w("Insufficient tokens", "코인 부족", "コイン不足") : w("Restore sample tokens", "샘플 코인 복원", "サンプルコインを戻す")}</button></> : <>{(["failed", "unknown"] as const).map(outcome => <button type="button" key={outcome} data-testid={`stablecoin-status-${outcome}`} aria-pressed={(sourceDone ? destinationOutcome : sourceOutcome) === outcome} onClick={() => sourceDone ? setDestinationOutcome(outcome) : setSourceOutcome(outcome)}>{outcome === "failed" ? w("Failure", "실패", "失敗") : w("Still pending", "확인 지연", "確認待ち")}</button>)}</>}
    </div></details> : null}
  </div>
}
