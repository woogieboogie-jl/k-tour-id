import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"
import { ONDO_MODAL_PRIORITY } from "../../features/ondo/shared/ui/modal-layer-priority"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")
const commerce = source("features/ondo/commerce-b/id-wallet-commerce-b.tsx")
const css = source("features/ondo/commerce-b/id-wallet-commerce-b.module.css")
const product = source("features/ondo/app/ondo-product-b.tsx")
const provider = source("features/ondo/shared/state/ondo-b-provider.tsx")
const offer = commerce.slice(commerce.indexOf("function CanonicalCommerceOfferB"), commerce.indexOf("const COMMERCE_FALLBACK_DESTINATIONS"))
const mount = commerce.slice(commerce.indexOf("export function CommerceOfferMountB"), commerce.indexOf("export function IdWalletCommerceB"))
const walletSheet = commerce.slice(commerce.indexOf("function WalletConnectSheet"), commerce.indexOf("function fundingSourceLabel"))

test("COMMERCE-EXIT-001 canonical state returns immediately while a global mount retains presentation", () => {
  expect(product).toContain('import { CommerceOfferMountB, WalletFundingMountB } from "../commerce-b/id-wallet-commerce-b"')
  expect(product).toContain("<CanonicalPlaceMount /><EditorialPlaceMountB /><CommerceOfferMountB /><WalletFundingMountB /><AccountSaveGateMountB />")
  expect(mount).toContain("const offerPresence = useSheetPresence(desiredSubject)")
  expect(mount).toContain('const presentedPhase = desiredSubject?.key === retainedSubject?.key && offerPresence.phase === "open" ? "open" : "closing"')
  expect(mount).toContain("presenceState={presentedPhase}")
  expect(provider).toMatch(/returnFromCommerceOrigin: \(\) => \{[\s\S]*?commitEphemeral\([\s\S]*?commerceOrigin: null/)
  expect(commerce).not.toMatch(/if \(state\.commerceOrigin\?\.kind === "canonical_place"[\s\S]{0,1000}<CanonicalCommerceOfferB/)
})

test("COMMERCE-EXIT-002 the outer surface freezes its complete local and domain presentation", () => {
  for (const field of [
    "commerce: StableCommerceBState",
    "fundingSource: OndoBCommerceFundingSource",
    "locale: Locale",
    "originVenueId: string",
    "originVenueName: string",
    "reviewMode: boolean",
    "transactionVenueId: string",
    "transactionVenueName: string",
    "walletStatus: OndoBCommerceWalletStatus",
  ]) expect(commerce).toContain(field)
  expect(commerce).toContain("type CommerceOfferVisualSnapshot")
  expect(offer).toContain("if (!closing && !exitRequestedRef.current) visualSnapshotRef.current = liveVisualSnapshot")
  expect(offer).toContain("const renderedView = visualSnapshot.view")
  expect(offer).toContain("const renderedConsent = visualSnapshot.consent")
  expect(offer).toContain("const renderedStorageError = visualSnapshot.storageError")
  expect(offer).toContain("data-payment-state={renderedView}")
  expect(offer).toContain("data-benefit-policy={renderedBenefitPolicy.status}")
  expect(offer).toContain("data-storage-error={renderedStorageError ?? \"none\"}")
})

test("COMMERCE-EXIT-003 retained offer owns modal, scroll and input until the 260ms unmount", () => {
  const journey = source("features/ondo/commerce-b/journey-visit-b.tsx")
  const sheet = source("features/ondo/shared/ui/sheet-b.tsx")
  expect(offer).toContain("useModalIsolation(true, rootRef)")
  expect(offer).toContain("useDocumentScrollLock(true)")
  expect(offer).toContain('data-modal-layer-priority={renderedView === "receipt" ? 139 : ONDO_MODAL_PRIORITY.critical}')
  expect(offer).toContain('style={renderedView === "receipt" ? { zIndex: 139 } : undefined}')
  expect(journey).toContain("modalPriority={140}")
  expect(journey).toContain('active={open && presence.phase === "open"}')
  expect(sheet).toContain("data-modal-layer-priority={modalPriority}")
  expect(sheet).toContain("style={priorityOverride === undefined ? undefined : { zIndex: modalPriority }}")
  expect(139).toBeGreaterThan(ONDO_MODAL_PRIORITY.detail)
  expect(140).toBeGreaterThan(139)
  expect(140).toBeLessThan(ONDO_MODAL_PRIORITY.critical)
  expect(offer).toContain("data-commerce-presence={presenceState}")
  expect(offer).toContain("onClickCapture={consumeClosingInput}")
  expect(offer).toContain("event.nativeEvent.stopImmediatePropagation()")
  expect(css).toMatch(/\.offerOverlay\[data-commerce-presence="closing"\][\s\S]*animation:\s*commerceOfferExit 260ms/)
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.offerOverlay\[data-commerce-presence="closing"\][\s\S]*animation:\s*none/)
})

test("COMMERCE-EXIT-004 final close is one-shot and async payment callbacks cannot repaint it", () => {
  expect(offer).toContain("if (closingRef.current || exitRequestedRef.current) return false")
  expect(offer).toContain("exitRequestedRef.current = true")
  expect(offer).toContain("if (closingRef.current || exitRequestedRef.current) return")
  expect(offer).toContain('window.addEventListener("keydown", cancelPending, true)')
  expect(offer).toContain("pendingCheckoutRef.current = null")
  expect(offer).toContain('actions.dispatchCommerce({ type: "CANCEL_CONFIRMATION" })')
  expect(offer.indexOf('actions.dispatchCommerce({ type: "CANCEL_CONFIRMATION" })')).toBeLessThan(offer.lastIndexOf("if (!onClose())"))
})

test("COMMERCE-EXIT-005 focus returns only after removal and stale reopen work is serial guarded", () => {
  expect(mount).toContain("if (offerPresence.value !== null || !restoreAfterExitRef.current) return")
  expect(mount).toContain("const restorationSerial = restorationSerialRef.current")
  expect(mount).toContain("if (restorationSerial !== restorationSerialRef.current || desiredWasOpenRef.current) return")
  expect(mount).toContain("exactOpener?.isConnected && isRenderedFocusable(exactOpener)")
  expect(mount).toContain("focusFirstAvailableDestination(COMMERCE_FALLBACK_DESTINATIONS)")
  expect(mount).toContain("key={presented.key}")
})

test("COMMERCE-EXIT-005B restoring the same venue after a gate does not remount the offer", () => {
  expect(mount).toContain("const previousOriginVenueRef = useRef<string | null>(null)")
  expect(mount).toContain("const liveOriginVenueId = liveOrigin?.venueId ?? null")
  expect(mount).toContain("previousOriginVenueRef.current !== liveOriginVenueId")
  expect(mount).toContain("previousOriginVenueRef.current = liveOriginVenueId")
  expect(mount).not.toContain("previousOriginRef.current !== liveOrigin")
})

test("COMMERCE-EXIT-006 wallet setup X, backdrop, Escape and terminal outcomes retain their exact phase", () => {
  expect(product).toContain("<CommerceOfferMountB />")
  expect(commerce).toContain("COMMERCE_WALLET_OPEN_EVENT")
  expect(walletSheet).toContain('presenceState: Exclude<SheetPresencePhase, "closed">')
  expect(walletSheet).toContain("const visual = closing || exitRequestedRef.current ? visualRef.current : liveVisual")
  expect(walletSheet).toContain('onClick={(event) => { if (event.target === event.currentTarget) requestClose() }}')
  expect(walletSheet).toContain("trapFocus(event, rootRef.current, requestClose)")
  expect(walletSheet).toContain('data-wallet-presence={presenceState}')
  expect(walletSheet).toContain('onReturn("ready")')
  expect(walletSheet).toContain('onReturn("failed")')
  expect(css).toMatch(/\.walletSetupBackdrop\[data-wallet-presence="closing"\][\s\S]*260ms/)
})

test("COMMERCE-EXIT-007 product truth and progressive financial disclosure remain intact", () => {
  for (const contract of [
    'balance: "Travel balance"',
    'digital: "Stablecoins"',
    "USDC · USDT → travel balance",
    "Travel balance is displayed in KRW. Stablecoin funding has its own asset, network and transfer steps.",
    "OOKRW is a separate settlement test-token concept, not redeemable won.",
    'localActual("travel_wallet_shell"',
    'unavailable: "Not connected"',
    'providerUnavailable("merchant_payment")',
    'data-testid="commerce-refund-reference"',
    'data-testid="commerce-receipt-reference"',
    'data-testid="commerce-place-context"',
    'data-testid="wallet-activity-place"',
  ]) expect(commerce).toContain(contract)
})
