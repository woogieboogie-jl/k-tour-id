import { expect, test } from "@playwright/test"
import { RESEARCHED_FOOD_B } from "../../features/ondo/map/researched-food-b"
import { personalPlaceByIdB, sanitizePlaceMemoriesB, updatePlaceMemoryB } from "../../features/ondo/place/place-memory-model-b"
import { createMyKoreaPlaceReturnOrigin, createMyKoreaPlaceReturnPlace, isMyKoreaPlaceReturnPair, myKoreaPlaceReturnOpenerSelector, sanitizeMyKoreaPlaceReturnReceipt } from "../../features/ondo/my/my-korea-place-return-b"

const id = "research-seoul-onion-anguk"
const at = "2026-09-29T01:00:00.000Z"
test("every research/native market place has a distinct personal identity without an invented official id", () => {
  for (const place of RESEARCHED_FOOD_B) {
    expect(personalPlaceByIdB(place.id, "ja")).toMatchObject({ id: place.id, kind: "discovery", city: place.city, name: place.name.ja })
    expect(place.canonicalVenueId).toBeNull()
  }
  expect(personalPlaceByIdB("lab-seoul-jungbu-market")?.kind).toBe("discovery")
  expect(personalPlaceByIdB("mois-0021cd596bc5b2a922ad")?.kind).toBe("canonical")
  expect(personalPlaceByIdB("jeju-seongsan-ilchulbong")?.kind).toBe("editorial")
  expect(personalPlaceByIdB("unknown-or-forged-id")).toBeNull()
})
test("private memory cannot carry identity, external visit or entitlement authority", () => {
  const restored = sanitizePlaceMemoriesB({ [id]: { saved: true, note: "Coffee", visitedAt: at, verified: true, stamp: 10, entitlement: "claimed" }, unknown: { saved: true } })
  expect(restored).toEqual({ [id]: { saved: true, note: "Coffee", visitedAt: at } })
  expect(sanitizePlaceMemoriesB({ "mois-0021cd596bc5b2a922ad": { saved: true } })).toEqual({})
})
test("removing a research bookmark preserves its personal note and visit; undo visit does not erase note", () => {
  const memory = { [id]: { saved: true, note: "order tip", visitedAt: at } }
  const removed = updatePlaceMemoryB(memory, id, { saved: false })!
  expect(removed[id]).toEqual({ saved: false, note: "order tip", visitedAt: at })
  expect(updatePlaceMemoryB(removed, id, { visitedAt: null })![id]).toEqual({ saved: false, note: "order tip", visitedAt: null })
  expect(updatePlaceMemoryB(memory, "unregistered", { saved: true })).toBeNull()
  expect(updatePlaceMemoryB(memory, id, { note: "x".repeat(1001) })).toBeNull()
})
test("saved discovery returns bind native id and origin, rejecting official/editorial aliases", () => {
  const origin = createMyKoreaPlaceReturnOrigin({ journeyId: "MYK-B-123e4567-e89b-42d3-a456-426614174000", scrollTop: 240, sourceKind: "discovery", discoveryPlaceId: id })!
  const place = createMyKoreaPlaceReturnPlace(origin)!
  expect(isMyKoreaPlaceReturnPair(origin, place)).toBe(true)
  expect(myKoreaPlaceReturnOpenerSelector(place)).toBe(`[data-my-korea-saved-discovery='${id}']`)
  expect(isMyKoreaPlaceReturnPair(origin, { ...place, discoveryPlaceId: "research-seoul-hakrim-dabang" })).toBe(false)
  expect(sanitizeMyKoreaPlaceReturnReceipt({ ...place, venueId: "mois-0021cd596bc5b2a922ad" })).toBeNull()
  expect(sanitizeMyKoreaPlaceReturnReceipt({ ...place, discoveryPlaceId: "jeju-seongsan-ilchulbong" })).toBeNull()
  expect(sanitizeMyKoreaPlaceReturnReceipt({ ...place, discoveryPlaceId: "unknown" })).toBeNull()
})
test("bounded storage never reports success when the requested record was dropped", () => {
  const full = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`unknown-${i}`, { saved: true, note: "", visitedAt: null }]))
  expect(updatePlaceMemoryB(full, id, { saved: true })).toBeNull()
})
