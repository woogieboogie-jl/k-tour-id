import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  advanceTemperatureSample, canRunTemperatureSample, createTemperatureSampleBlend, createTemperatureSampleFrame, normalizeTemperatureSampleMinute,
  TEMPERATURE_SAMPLE_DISSOLVE_MS,
  TEMPERATURE_SAMPLE_END_MINUTE, TEMPERATURE_SAMPLE_INITIAL_MINUTE, TEMPERATURE_SAMPLE_MAX_POINTS,
  TEMPERATURE_SAMPLE_START_MINUTE, TEMPERATURE_SAMPLE_TICK_MS, temperatureSampleTimeLabel,
  temperatureSampleColor, temperatureSampleWeight,
} from "../../features/ondo/contracts/temperature-timeline"
import { clearSampleTemperaturePresentationB, publishSampleTemperaturePresentationB, readSampleTemperaturePresentationB } from "../../features/ondo/map/sample-temperature-presentation-b"

const points = Array.from({ length: 12 }, (_, index) => ({ id: `sample-place-${index}`, longitude: 126.97 + index * .02, latitude: 37.56 + index * .01 }))

test("THERMAL-SAMPLE-001 different places follow distinct prepared evening curves", () => {
  const before = createTemperatureSampleFrame("seoul", points, 18 * 60)
  const after = createTemperatureSampleFrame("seoul", points, 21 * 60)
  const deltas = after.features.map((feature, index) => feature.properties.sampleWeight - before.features[index].properties.sampleWeight)
  expect(deltas.some((delta) => delta > .2)).toBe(true)
  expect(deltas.some((delta) => delta < -.2)).toBe(true)
  expect(new Set(deltas.map((delta) => delta.toFixed(2))).size).toBeGreaterThan(3)
  expect(createTemperatureSampleFrame("seoul", points, 18 * 60)).toEqual(before)
})

test("THERMAL-SAMPLE-002 all cities preserve real coordinates and distinguish illustration from source facts", () => {
  const snapshot = JSON.stringify(points)
  for (const city of ["seoul", "busan", "jeju"] as const) {
    const frame = createTemperatureSampleFrame(city, points, 19 * 60)
    frame.features.forEach((feature, index) => {
      expect(feature.id).toBe(points[index].id)
      expect(feature.geometry.coordinates).toEqual([points[index].longitude, points[index].latitude])
      expect(feature.properties).toMatchObject({ sampleOrigin: "PREPARED_ILLUSTRATION", observedAt: null, officialScore: null })
      expect(feature.properties).not.toHaveProperty("pulseScore")
      expect(feature.properties).not.toHaveProperty("coverageIntensity")
    })
  }
  expect(JSON.stringify(points)).toBe(snapshot)
})

test("THERMAL-SAMPLE-003 interpolation is bounded and changes gently between neighboring minutes", () => {
  for (const city of ["seoul", "busan", "jeju"] as const) {
    for (const point of points) {
      const weights: number[] = []
      const changes: number[] = []
      for (let minute = TEMPERATURE_SAMPLE_START_MINUTE; minute < TEMPERATURE_SAMPLE_END_MINUTE; minute++) {
        const weight = temperatureSampleWeight(city, point.id, minute)
        weights.push(weight)
        changes.push(Math.abs(weight - temperatureSampleWeight(city, point.id, minute + 1)))
      }
      expect(Math.min(...weights)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...weights)).toBeLessThanOrEqual(1)
      expect(Math.max(...changes)).toBeLessThan(.025)
    }
  }
})

test("THERMAL-SAMPLE-004 source payload is capped, invalid coordinates and duplicate IDs are rejected", () => {
  const many = Array.from({ length: 100 }, (_, index) => ({ ...points[0], id: `point-${index}` }))
  expect(createTemperatureSampleFrame("seoul", many, 19 * 60).features).toHaveLength(TEMPERATURE_SAMPLE_MAX_POINTS)
  expect(createTemperatureSampleFrame("jeju", [points[0], points[0], { ...points[1], latitude: Number.NaN }, { ...points[2], longitude: 190 }], 19 * 60).features).toHaveLength(1)
  expect(TEMPERATURE_SAMPLE_TICK_MS).toBeGreaterThanOrEqual(1000)
})

test("THERMAL-SAMPLE-005 reduced motion, hidden tabs, inactive screens and pause stop automatic progression", () => {
  const active = { requested: true, visible: true, documentVisible: true, reducedMotion: false, minute: TEMPERATURE_SAMPLE_INITIAL_MINUTE }
  expect(canRunTemperatureSample(active)).toBe(true)
  for (const change of [{ requested: false }, { visible: false }, { documentVisible: false }, { reducedMotion: true }]) {
    expect(canRunTemperatureSample({ ...active, ...change })).toBe(false)
  }
  expect(canRunTemperatureSample({ ...active, minute: TEMPERATURE_SAMPLE_END_MINUTE })).toBe(true)
})

test("THERMAL-SAMPLE-006 invalid or out-of-range time never corrupts the sample field", () => {
  expect(normalizeTemperatureSampleMinute(Number.NaN)).toBe(TEMPERATURE_SAMPLE_INITIAL_MINUTE)
  expect(temperatureSampleTimeLabel(-1)).toBe("17:00")
  expect(temperatureSampleTimeLabel(24 * 60)).toBe("23:00")
  expect(temperatureSampleTimeLabel(19 * 60 + 10)).toBe("19:10")
})

test("THERMAL-SAMPLE-007 map integration keeps one bounded sample source separate from ratings and camera", () => {
  const component = readFileSync(resolve("features/ondo/map/temperature-timeline-b.tsx"), "utf8")
  const map = readFileSync(resolve("features/ondo/map/map-entry-b.tsx"), "utf8")
  expect(component).toContain('const SOURCE_ID = "ondo-sample-temperature"')
  expect(component).toContain('"heatmap-weight": ["get", "sampleWeight"]')
  expect(component).toContain('document.addEventListener("visibilitychange", sync)')
  expect(component).toContain('window.clearInterval(timer)')
  expect(component).not.toMatch(/requestAnimationFrame|fetch\(|setFeatureState|flyTo\(|easeTo\(|jumpTo\(/)
  expect(component).not.toMatch(/setSourceData|source\.setData\([^)]*ondo-pulse/)
  expect(map).toContain('data-marker-coordinate-authority="geojson-point-no-translate"')
  expect(map).toContain('data-editorial-temperature-score={city === "jeju" ? "none" : undefined}')
  expect(map).toContain('map={mapState === "ready" && entryTransitionCity !== city ? mapRef.current : null}')
})

test("THERMAL-SAMPLE-008 alternating render slots preserve the visible old weights and exact next frame", () => {
  const previous = createTemperatureSampleFrame("seoul", points, 19 * 60)
  const next = createTemperatureSampleFrame("seoul", points, 19 * 60 + 10)
  const before = JSON.stringify([previous, next])
  for (const nextSlot of [0, 1] as const) {
    const blend = createTemperatureSampleBlend(previous, next, nextSlot)
    expect(blend.features).toHaveLength(points.length)
    blend.features.forEach((feature, index) => {
      expect(feature.geometry).toEqual(next.features[index].geometry)
      expect(feature.properties.sampleWeight).toBe((nextSlot === 0 ? next : previous).features[index].properties.sampleWeight)
      expect(feature.properties.sampleBlendWeight).toBe((nextSlot === 1 ? next : previous).features[index].properties.sampleWeight)
      expect(feature.properties).toMatchObject({ sampleOrigin: "PREPARED_ILLUSTRATION", observedAt: null, officialScore: null })
    })
  }
  expect(JSON.stringify([previous, next])).toBe(before)
})

test("THERMAL-SAMPLE-009 new or removed filtered places cannot borrow another place's old temperature", () => {
  const previous = createTemperatureSampleFrame("jeju", points.slice(0, 6), 1140)
  const next = createTemperatureSampleFrame("jeju", [...points.slice(8), ...points.slice(3, 5)], 1160)
  const blend = createTemperatureSampleBlend(previous, next, 1)
  expect(blend.features.map((feature) => feature.id)).toEqual(next.features.map((feature) => feature.id))
  for (const feature of blend.features) {
    const old = previous.features.find((candidate) => candidate.id === feature.id)
    const current = next.features.find((candidate) => candidate.id === feature.id)!
    expect(feature.properties.sampleWeight).toBe((old ?? current).properties.sampleWeight)
    expect(feature.properties.sampleBlendWeight).toBe(current.properties.sampleWeight)
  }
})

test("THERMAL-SAMPLE-010 native dissolve stays below the bounded sample tick and is disabled for still states", () => {
  const component = readFileSync(resolve("features/ondo/map/temperature-timeline-b.tsx"), "utf8")
  expect(TEMPERATURE_SAMPLE_DISSOLVE_MS).toBeGreaterThanOrEqual(750)
  expect(TEMPERATURE_SAMPLE_DISSOLVE_MS).toBeLessThan(TEMPERATURE_SAMPLE_TICK_MS)
  expect(component).toContain('duration: animate ? TEMPERATURE_SAMPLE_DISSOLVE_MS : 0')
  expect(component).toContain('index === nextSlot ? FIELD_OPACITY : 0')
  expect(component).toContain('source.setData(blend, true).then')
  expect(component).toContain('generation !== paintGenerationRef.current')
  expect((component.match(/map\.addSource\(/g) ?? [])).toHaveLength(1)
  expect(component).toContain('if (map.getLayer(BLEND_LAYER_ID)) map.removeLayer(BLEND_LAYER_ID)')
})

test("THERMAL-SAMPLE-011 nation warmth is finite decoration and the timeline trace avoids legend icon rules", () => {
  const source = readFileSync("features/ondo/map/map-entry-b.tsx", "utf8")
  const css = readFileSync("features/ondo/map/map-b.module.css", "utf8")
  const timeline = readFileSync("features/ondo/map/temperature-timeline-b.tsx", "utf8")
  expect(source).toContain('data-thermal-intro={sampleMotion && mapState === "ready" ? "sample" : "still"}')
  expect(source).toContain('data-thermal-intro-paused={!documentVisible || departingCity !== null}')
  expect(source).toContain('document.removeEventListener("visibilitychange", syncVisibility)')
  expect(source).toContain('data-atlas-motion={atlasIntroComplete ? "settled" : atlasMotionPlaying ? "playing" : "paused"}')
  expect(source).not.toContain('data-testid="ondo-b-atlas-motion"')
  expect(css).toContain("animation: atlasWarmthBreath 4200ms")
  expect(css).toContain(':global(html[lang="ko"]) .koreaAtlas .nationIntro h1 { word-break: keep-all; overflow-wrap: break-word; }')
  expect(css).toContain('@media (prefers-reduced-motion: reduce), (forced-colors: active)')
  expect(timeline).toContain('<span className={styles.thermalTrace}')
  expect(timeline).not.toContain('<i className={styles.thermalTrace}')
})

test("THERMAL-SAMPLE-012 replay reflects at both endpoints without a time or color jump", () => {
  let playback: { minute: number; direction: 1 | -1 } = { minute: TEMPERATURE_SAMPLE_INITIAL_MINUTE, direction: 1 }
  const seenDirections = new Set<number>()
  for (let tick = 0; tick < 200; tick++) {
    const next = advanceTemperatureSample(playback.minute, playback.direction)
    expect(Math.abs(next.minute - playback.minute)).toBe(10)
    expect(next.minute).toBeGreaterThanOrEqual(TEMPERATURE_SAMPLE_START_MINUTE)
    expect(next.minute).toBeLessThanOrEqual(TEMPERATURE_SAMPLE_END_MINUTE)
    seenDirections.add(next.direction)
    playback = next
  }
  expect([...seenDirections].sort()).toEqual([-1, 1])
  expect(advanceTemperatureSample(1380, -1)).toEqual({ minute: 1370, direction: -1 })
  expect(advanceTemperatureSample(1020, 1)).toEqual({ minute: 1030, direction: 1 })
})

test("THERMAL-SAMPLE-013 map core and peek use one continuous illustrative palette, not fixed peak buckets", () => {
  expect(temperatureSampleColor(0)).toBe("#4b9fa6")
  expect(temperatureSampleColor(1)).toBe("#b32c79")
  expect(temperatureSampleColor(1, true)).toBe("#e84d9c")
  expect(temperatureSampleColor(Number.NaN)).toBe(temperatureSampleColor(0))
  expect(temperatureSampleColor(100)).toBe(temperatureSampleColor(1))
  expect(new Set(Array.from({ length: 20 }, (_, index) => temperatureSampleColor(index / 19))).size).toBe(20)
  const component = readFileSync("features/ondo/map/temperature-timeline-b.tsx", "utf8")
  const meter = readFileSync("features/ondo/map/sample-activity-meter-b.tsx", "utf8")
  expect(component).toContain('"circle-color": coreColor(weight, after19)')
  expect(component).toContain('publishSampleTemperaturePresentationB(presentationOwner.current')
  expect(component).toContain('id: HIT_ID, type: "circle", source: SOURCE_ID')
  expect(component).toContain('"circle-radius": 22')
  expect(component).toContain('left.distance - right.distance')
  expect(meter).toContain('feature.properties.sampleWeight')
  expect(meter).toContain('temperatureSampleColor(weight, snapshot.after19)')
  expect(meter).toContain('data-origin="PREPARED_ILLUSTRATION"')
  expect(meter).not.toMatch(/actions\.|localStorage|fetch\(/)
})

test("THERMAL-SAMPLE-014 stale city cleanup cannot erase a newer painted frame", () => {
  const oldOwner = Symbol("old-city")
  const nextOwner = Symbol("new-city")
  const frame = createTemperatureSampleFrame("busan", points, 1200)
  const presentation = { city: "busan" as const, minute: 1200, direction: 1 as const, running: true, after19: false, frame }
  publishSampleTemperaturePresentationB(oldOwner, { ...presentation, city: "seoul" })
  publishSampleTemperaturePresentationB(nextOwner, presentation)
  clearSampleTemperaturePresentationB(oldOwner)
  expect(readSampleTemperaturePresentationB()).toBe(presentation)
  expect(readSampleTemperaturePresentationB()?.frame).toBe(frame)
  clearSampleTemperaturePresentationB(nextOwner)
  expect(readSampleTemperaturePresentationB()).toBeNull()
})
