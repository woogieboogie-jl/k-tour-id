"use client"

import { MapEntryB } from "../map/map-entry-b"
import { PulseTablesEntryB } from "../connect/tables-entry-b"
import { CommerceOfferMountB, WalletFundingMountB } from "../commerce-b/id-wallet-commerce-b"
import { TravelerIdEntryB } from "../identity-b/traveler-id-entry-b"
import { KTourIdSetupB } from "../identity-b/ktour-id-setup-b"
import { AccountSaveGateMountB } from "../identity-b/account-save-gate-b"
import { BActionGateCoordinator } from "../identity-b/action-gate-coordinator-b"
import { ExperienceMountB } from "../experience-b/experience-b"
import { BActivityProfileProvider } from "../identity-b/activity-profile-b-provider"
import { LocalSignalLayerB } from "../local-signal-b/local-signal-layer-b"
import { LabsEntryB } from "../labs/labs-entry"
import { HackathonEntitlementLayerB } from "../hackathon-b/hackathon-layer-b"
import { SavedEntryB } from "../my/saved-entry-b"
import { OfficialDirectoryOnboardingLayer } from "../onboarding/official-directory-onboarding"
import { CanonicalPlaceMount } from "../place/canonical-place-mount"
import { EditorialPlaceMountB } from "../place/editorial-place-mount-b"
import { SettingsEntryB } from "../settings/settings-entry-b"
import { useOndoB } from "../shared/state/ondo-b-provider"
import { useSheetPresence } from "../shared/ui/use-sheet-presence"
import { OndoAppB } from "./ondo-app-b"

export function OndoProductB() {
  return (
    <BActivityProfileProvider>
      <OndoAppB slots={{
        explore: <MapEntryB />,
        saved: <SavedEntryB />,
        tables: <PulseTablesEntryB />,
        travelerId: <TravelerIdEntryB />,
        settings: <SettingsEntryB />,
        overlays: <><CanonicalPlaceMount /><EditorialPlaceMountB /><CommerceOfferMountB /><WalletFundingMountB /><AccountSaveGateMountB /><LocalSignalLayerB /><OfficialDirectoryOnboardingLayer /><ExperienceMountB /><KTourIdSetupB /><BActionGateCoordinator /><LabsEntryMountB /><HackathonEntitlementLayerB /></>,
      }} />
    </BActivityProfileProvider>
  )
}

function LabsEntryMountB() {
  const { state } = useOndoB()
  const presence = useSheetPresence(state.surface.kind === "labs" ? true : null)
  return presence.value ? <LabsEntryB presenceState={presence.phase} /> : null
}
