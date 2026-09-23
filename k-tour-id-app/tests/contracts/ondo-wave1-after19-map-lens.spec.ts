import { readFileSync } from "node:fs"
import { expect, test } from "@playwright/test"
import { discoveryCollectionPlacesB } from "../../features/ondo/map/discovery-collection-model-b"

const mapSource = readFileSync("features/ondo/map/map-entry-b.tsx", "utf8")

test("W1-AFTER19-MAP-001 19+ derives a night subset without rewriting discovery state", () => {
  expect(mapSource).toContain('data-after19-lens-policy="derived-night-filter-preserve-discovery-state"')
  expect(mapSource).toContain('const after19NightSubsetActive = after19Active && !balancePlacesActive && (city === "seoul" || city === "busan")')
  expect(mapSource).toContain('const balancePlacesActive = sampleEnvironment && balancePlacesOnly')
  expect(mapSource).toContain('const effectiveCategory: BDiscoveryCategory = after19NightSubsetActive ? "night" : category')
  expect(mapSource).toContain('const categoryRailItems: readonly BDiscoveryCategory[] = categoryOptions')
  expect(mapSource).toContain('after19NightSubsetActive ? <div className={styles.after19Context}')
  expect(mapSource).toContain('data-testid="ondo-b-after19-context"')
  expect(mapSource).not.toContain('data-after19-category-locked=')
  expect(mapSource).toContain('aria-pressed={category === item}')

  for (const forbidden of [
    "ondo-b.after19.browse-snapshot",
    "After19BrowseSnapshot",
    "after19FilterActive",
    'setCategory("night")',
    'category: "night"',
  ]) expect(mapSource).not.toContain(forbidden)
})

test("W1-AFTER19-MAP-002 approved eligibility and the current query define night result membership", () => {
  expect(mapSource).toContain('if (effectiveCategory !== "all" && venue.primaryCategory !== effectiveCategory) return false')
  expect(mapSource).toContain('if (after19NightSubsetActive && !venue.after19PresentationEligible) return false')
  expect(mapSource).toContain("return !query.trim() || haystack.includes(query.trim().toLowerCase())")
  expect(mapSource).toContain("personalizedCanonicalVenueRows(\n    venues,")
  expect(mapSource).toContain("const personalizedVenues = useMemo(() => personalizedVenueRows.map(({ venue }) => venue), [personalizedVenueRows])")
  expect(mapSource).toContain("const venueFeatures = toFeatureCollection(venues, state.localPulseEvidenceByVenue, selectedVenueId, personalMatchCountByVenue)")
  expect(mapSource).not.toContain("toFeatureCollection(personalizedVenues")
  expect(mapSource).toContain("void directorySource.setData(venueFeatures)")
  expect(mapSource).toContain("if (after19LensSource) void after19LensSource.setData(venueFeatures)")
  expect(mapSource).toContain('data-result-count={visibleResultCount ?? (city === "jeju" ? editorialPlaces.length : venues.length) + researchedFoods.length}')
  // The collection count must not bypass the existing night-eligibility lens.
  const collectionContext = { city: "seoul", category: "all", editorialCategory: "all", after19: true, balanceOnly: false }
  for (const collection of ["hot", "cool", "sesame"] as const) expect(discoveryCollectionPlacesB(collection, collectionContext)).toEqual([])
  expect(discoveryCollectionPlacesB("screen", { ...collectionContext, city: "jeju" }).map(place => place.kind)).toEqual(["sight", "sight"])
  expect(mapSource).toContain('if (place.city !== city || !researchFoodMatchesB(place, query)) return false')
  expect(mapSource).toContain('if (after19ThemeActive && !balancePlacesActive) return place.kind === "bar"')
  expect(mapSource).toContain('if (balancePlacesActive && !resolveCommercePlaceB(place.id)?.commerce) return false')
  expect(mapSource).toContain('data-research-result-count={researchedFoods.length}')
  expect(mapSource).not.toMatch(/after19Active[^\n]{0,160}(?:setQuery|setCategory|focusFilteredVenues|\.jumpTo|\.flyTo)/)
})

test("W1-AFTER19-MAP-003 only approved places enter the result source and receive the 19+ highlight", () => {
  expect(mapSource).toContain('if (after19NightSubsetActive && !venue.after19PresentationEligible) return false')
  expect(mapSource).toContain("after19Eligible: venue.after19PresentationEligible")
  expect(mapSource).toContain('const AFTER19_ELIGIBLE_FILTER: ExpressionSpecification = ["==", ["get", "after19Eligible"], true]')
  expect(mapSource).toContain('instance.addSource("ondo-after19-lens"')
  expect(mapSource).toContain('id: "ondo-after19-eligible-field"')
  expect(mapSource).toContain("filter: AFTER19_ELIGIBLE_FILTER")
  expect(mapSource).toContain('id: "ondo-after19-eligible-points"')
  expect(mapSource).toContain("filter: AFTER19_UNCURATED_ELIGIBLE_FILTER")
  expect(mapSource).toContain('["case", AFTER19_ELIGIBLE_FILTER, AFTER19_PULSE_LEVEL_EXPRESSION, PULSE_LEVEL_EXPRESSION]')
  expect(mapSource).toContain('map.setPaintProperty("ondo-after19-eligible-field", "heatmap-opacity", after19ThemeActive')
  expect(mapSource).toContain('map.setPaintProperty("ondo-after19-eligible-points", "circle-opacity", after19ThemeActive ? 0.96 : 0)')
})

test("W1-AFTER19-MAP-004 off exposes the saved category again and Jeju never invents night eligibility", () => {
  expect(mapSource).toContain('map.setPaintProperty("ondo-temperature-field", "heatmap-color", city === "jeju" ? EDITORIAL_COVERAGE_HEAT_COLOR : PULSE_HEAT_COLOR)')
  expect(mapSource).toContain('after19Eligible: false')
  expect(mapSource).toContain('data-after19-active={after19ThemeActive ? "true" : "false"}')
  expect(mapSource).toContain('const after19ThemeActive = after19Active')
  expect(mapSource).toContain('city === "jeju" ? "editorial-preserved-no-night-inference" : "approved-night-subset"')
  expect(mapSource).toContain('const effectiveCategory: BDiscoveryCategory = after19NightSubsetActive ? "night" : category')
  expect(mapSource).not.toContain("ondo-b.after19.browse-snapshot")
  expect(mapSource.match(/source: "ondo-after19-lens"/g)).toHaveLength(2)
})
