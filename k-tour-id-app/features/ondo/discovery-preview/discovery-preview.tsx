"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, ArrowUpRight, Bookmark, Check, ChevronLeft, ChevronRight, Coffee, Flame, Globe2, Info, MapPin, Moon, Search, Sparkles, Sun, Utensils, X } from "lucide-react"
import { CITIES, PLACES, STORIES, results, searchMood, words, type City, type Kind, type Locale, type Place, type Scope } from "./fixtures"
import { PreviewMap, type Camera } from "./preview-map"
import styles from "./preview.module.css"

const COPY = {
  search: words("장소, Hot 또는 Cool", "Places, Hot or Cool", "場所、Hot、Cool"),
  next: words("다음은 어디로?", "Where to next?", "次は、どこへ？"),
  hot: words("주목할 곳", "In the spotlight", "注目の場所"),
  cool: words("새로운 발견", "A different discovery", "新しい発見"),
  saved: words("저장한 장소", "Saved places", "保存した場所"),
  all: words("전체", "All", "すべて"),
  cafe: words("카페", "Cafés", "カフェ"),
  food: words("먹거리", "Food", "グルメ"),
  close: words("닫기", "Close", "閉じる"),
  back: words("이전 탐색으로", "Back to discovery", "前の探索へ"),
  save: words("저장", "Save", "保存"),
  savedOne: words("저장됨", "Saved", "保存済み"),
  source: words("출처와 이미지", "Sources & image", "情報源と画像"),
  illustration: words("일러스트", "Illustration", "イラスト"),
  original: words("이야기 원문", "Original story", "元のストーリー"),
  viewMap: words("지도에서 보기", "See on map", "地図で見る"),
  empty: words("아직 맞는 장소가 없어요", "No matching places yet", "一致する場所はまだありません"),
  reset: words("조건 지우기", "Clear filters", "条件を解除"),
  prototype: words("로컬 목업", "Local prototype", "ローカル試作"),
  truth: words("추천은 고정된 편집 예시예요. 실시간 인기·혼잡 정보가 아니며, Cool은 한적함이 아닌 새로운 발견을 뜻해요. 저장은 이 화면에서만 유지돼요. 계정·인증·예약·결제는 연결하지 않았어요.", "Recommendations are fixed editorial examples, not live popularity or crowd data. Cool means discovery, not quietness. Saves last only in this page. No account, identity, booking or payment services are connected.", "固定の編集例で、リアルタイムの人気・混雑情報ではありません。Coolは静けさではなく新しい発見です。保存はこの画面内のみ。アカウント・本人確認・予約・決済には接続していません。"),
}
type Snapshot = { scope: Scope; kind: Kind; query: string; selected: string | null; camera: Camera | null; detail?: string | null; info?: boolean }

function Picture({ place, locale, className = "" }: { place: Place; locale: Locale; className?: string }) {
  const [failed, setFailed] = useState(false)
  return <div className={`${styles.picture} ${className}`}>
    {!failed ? <img src={place.image} alt={place.imageAlt[locale]} onError={() => setFailed(true)} style={place.id === "research-seoul-hakrim-dabang" ? { objectPosition: "50% 0%" } : undefined} />
      : <MapPin aria-hidden="true" size={32} />}
    {place.illustration && <span aria-label={COPY.illustration[locale]} title={COPY.illustration[locale]}>✧</span>}
  </div>
}

function Sheet({ title, children, onClose, locale }: { title: string; children: ReactNode; onClose(): void; locale: Locale }) {
  const ref = useRef<HTMLDialogElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const dialog = ref.current
    const opener = document.activeElement as HTMLElement | null
    dialog?.showModal()
    return () => { dialog?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [])
  return <dialog ref={ref} className={styles.sheet} aria-labelledby="preview-sheet-title"
    onCancel={event => { event.preventDefault(); onCloseRef.current() }}
    onClick={event => { if (event.target === ref.current) { const r = ref.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onCloseRef.current() } }}>
    <div className={styles.sheetHeader}><h2 id="preview-sheet-title">{title}</h2><button type="button" aria-label={COPY.close[locale]} onClick={onClose}><X size={21} /></button></div>
    {children}
  </dialog>
}

export function DiscoveryPreview() {
  const [hydrated, setHydrated] = useState(false)
  const [locale, setLocale] = useState<Locale>("ko")
  const [dark, setDark] = useState(false)
  const [scope, setScope] = useState<Scope>({ city: "seoul", mode: "explore" })
  const [kind, setKind] = useState<Kind>("all")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [saved, setSaved] = useState<string[]>([])
  const [history, setHistory] = useState<Snapshot[]>([])
  const [restore, setRestore] = useState<Camera | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [info, setInfo] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const camera = useRef<Camera | null>(null)
  const rail = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const popHandler = useRef<(event: PopStateEvent) => void>(() => {})
  const syncEntry = useRef<() => void>(() => {})
  const places = results(scope, kind, saved)
  const resultKey = `${scope.city}:${scope.mode}:${scope.story ?? ""}:${scope.query ?? ""}:${kind}:${places.map(p => p.id).join(",")}`
  const current = places.find(p => p.id === selected) ?? places[0] ?? null
  const currentIndex = current ? places.findIndex(p => p.id === current.id) : 0
  const story = scope.mode === "story" ? STORIES.find(s => s.id === scope.story) : null
  const focusedPlace = PLACES.find(p => p.id === detail)
  const isExplore = scope.mode === "explore"
  const count = (n: number) => locale === "ko" ? `${n}곳` : locale === "ja" ? `${n}か所` : `${n} ${n === 1 ? "place" : "places"}`
  const title = story ? story.title[locale] : scope.mode === "hot" ? "Hot" : scope.mode === "cool" ? "Cool"
    : scope.mode === "saved" ? COPY.saved[locale] : scope.mode === "search" ? scope.query : COPY.next[locale]

  useEffect(() => { setDark(window.matchMedia("(prefers-color-scheme: dark)").matches); setHydrated(true) }, [])
  useEffect(() => {
    // Same-URL, tab-local browser history. Never touch the production app's state.
    const initialSnapshot: Snapshot = { scope: { city: "seoul", mode: "explore" }, kind: "all", query: "", selected: null, camera: null }
    window.history.replaceState({ ...window.history.state, discoveryPreview: { snapshot: initialSnapshot, stack: [] } }, "")
    const handle = (event: PopStateEvent) => popHandler.current(event)
    window.addEventListener("popstate", handle)
    return () => window.removeEventListener("popstate", handle)
  }, [])
  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current) }, [])
  useEffect(() => {
    const target = rail.current
    if (!target || isExplore) return
    const card = target.children[currentIndex] as HTMLElement | undefined
    if (card) target.scrollTo({ left: card.offsetLeft - (target.firstElementChild as HTMLElement).offsetLeft, behavior: "instant" })
  }, [currentIndex, resultKey, isExplore])

  function snapshot(): Snapshot {
    return { scope, kind, query: scope.query ?? (scope.mode === "hot" || scope.mode === "cool" ? scope.mode : ""), selected: current?.id ?? null, camera: camera.current, detail, info }
  }
  syncEntry.current = () => {
    if (window.history.state?.discoveryPreview) window.history.replaceState({ ...window.history.state, discoveryPreview: { snapshot: snapshot(), stack: history } }, "")
  }
  useEffect(() => { if (hydrated) syncEntry.current() }, [hydrated, scope, kind, selected, detail, info, history])
  function applySnapshot(next: Snapshot, stack: Snapshot[]) {
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    setScope(next.scope); setKind(next.kind); setQuery(next.query); setSelected(next.selected); setRestore(next.camera)
    setDetail(next.detail ?? null); setInfo(next.info ?? false); setHistory(stack); setSearchOpen(false)
  }
  popHandler.current = event => {
    const entry = event.state?.discoveryPreview as { snapshot: Snapshot; stack: Snapshot[] } | undefined
    if (entry?.snapshot?.scope && Array.isArray(entry.stack)) applySnapshot(entry.snapshot, entry.stack)
  }
  function pushSnapshot(next: Snapshot) {
    const previous = snapshot()
    const stack = [...history, previous]
    window.history.replaceState({ ...window.history.state, discoveryPreview: { snapshot: previous, stack: history } }, "")
    window.history.pushState({ ...window.history.state, discoveryPreview: { snapshot: next, stack } }, "")
    applySnapshot(next, stack)
  }
  function navigate(next: Scope, nextKind: Kind = kind) {
    pushSnapshot({ scope: next, kind: nextKind, selected: null, camera: null, query: next.query ?? (next.mode === "hot" || next.mode === "cool" ? next.mode : "") })
    search.current?.blur()
  }
  function goBack() {
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    if (history.length) window.history.back()
    else applySnapshot({ scope: { city: scope.city, mode: "explore" }, kind: "all", query: "", selected: null, camera: null }, [])
    setSearchOpen(false)
  }
  function submitSearch() {
    const q = query.trim()
    if (!q) { setSearchOpen(false); search.current?.blur(); return }
    const mood = searchMood(q)
    navigate({ city: scope.city, mode: mood ?? "search", ...(mood ? {} : { query: q }) })
  }
  function selectPlace(id: string) {
    if (isExplore) {
      const place = PLACES.find(p => p.id === id)
      if (place) navigate({ city: scope.city, mode: "search", query: place.name[locale] })
    }
    setSelected(id)
  }
  function toggleSave(id: string) { setSaved(s => s.includes(id) ? s.filter(i => i !== id) : [...s, id]) }
  function closeSearch() { setSearchOpen(false); search.current?.blur(); setQuery(scope.query ?? (scope.mode === "hot" || scope.mode === "cool" ? scope.mode : "")) }

  return <main className={styles.root} data-theme={dark ? "dark" : "light"} data-mode={scope.mode} data-testid="discovery-preview" data-ready={hydrated} inert={!hydrated} lang={locale}>
    <PreviewMap places={places} selected={isExplore ? selected : current?.id ?? null} city={scope.city} locale={locale} dark={dark} viewKey={resultKey} restore={restore} onSelect={selectPlace} cameraRef={camera} onCameraChange={() => syncEntry.current()} />

    <header className={styles.header}>
      <div className={styles.brandRow}>
        <div className={styles.brand}><img src="/brand/ktour-id-mono-v1.svg" alt="" /><strong>K-Tour ID</strong></div>
        <label className={styles.city}><MapPin size={14} aria-hidden="true" /><span className={styles.srOnly}>{locale === "ko" ? "도시" : "City"}</span><select aria-label={locale === "ko" ? "도시" : "City"} value={scope.city} onChange={e => navigate({ city: e.target.value as City, mode: scope.mode === "hot" || scope.mode === "cool" ? scope.mode : "explore" })}>
          {Object.entries(CITIES).map(([id, name]) => <option key={id} value={id}>{name[locale]}</option>)}
        </select></label>
        <button type="button" className={styles.iconButton} onClick={() => setLocale(l => l === "ko" ? "en" : l === "en" ? "ja" : "ko")} aria-label={locale === "ko" ? "Change language to English" : locale === "en" ? "日本語に変更" : "한국어로 변경"}><Globe2 size={19} /><span className={styles.locale}>{locale.toUpperCase()}</span></button>
      </div>
      <form className={styles.search} role="search" onSubmit={e => { e.preventDefault(); submitSearch() }}>
        {!isExplore || history.length ? <button type="button" aria-label={COPY.back[locale]} onClick={goBack}><ArrowLeft size={21} /></button> : <Search size={20} aria-hidden="true" />}
        <input ref={search} value={query} onChange={e => setQuery(e.target.value)} onFocus={() => setSearchOpen(true)} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); closeSearch() } }} aria-label={COPY.search[locale]} placeholder={COPY.search[locale]} maxLength={100} enterKeyHint="search" autoComplete="off" />
        {searchOpen ? <button type="button" aria-label={COPY.close[locale]} onClick={closeSearch}><X size={19} /></button>
          : <button type="button" onClick={() => navigate({ city: scope.city, mode: "saved" })} aria-label={COPY.saved[locale]}><Bookmark size={20} fill={scope.mode === "saved" ? "currentColor" : "none"} /></button>}
      </form>
      {searchOpen && <div className={styles.searchSuggestions}>
        <button type="button" onClick={() => navigate({ city: scope.city, mode: "hot" })}><Flame size={20} /><b>Hot</b><span>{COPY.hot[locale]}</span><ChevronRight size={16} /></button>
        <button type="button" onClick={() => navigate({ city: scope.city, mode: "cool" })}><Sparkles size={20} /><b>Cool</b><span>{COPY.cool[locale]}</span><ChevronRight size={16} /></button>
        {!!query.trim() && <button type="button" onClick={submitSearch}><Search size={20} /><span>{query}</span><ChevronRight size={16} /></button>}
      </div>}
    </header>

    {searchOpen && <button type="button" className={styles.searchScrim} aria-label={COPY.close[locale]} onClick={closeSearch} />}

    <section className={styles.tray} aria-label={title} data-testid="discovery-tray">
      <div className={styles.trayTop}>
        <div className={styles.resultTitle}>
          {scope.mode === "hot" ? <Flame size={21} className={styles.hotInk} /> : scope.mode === "cool" ? <Sparkles size={21} className={styles.coolInk} /> : null}
          <h1>{title}</h1>{!isExplore && <span><span className={styles.compactCity}>{CITIES[scope.city][locale]} · </span>{count(places.length)}</span>}
        </div>
        {isExplore ? <div className={styles.moodButtons}>
          <button type="button" onClick={() => navigate({ city: scope.city, mode: "hot" })}><Flame size={17} />Hot</button>
          <button type="button" onClick={() => navigate({ city: scope.city, mode: "cool" })}><Sparkles size={17} />Cool</button>
        </div> : <div className={styles.compactTools}>
          {scope.mode !== "story" && <select className={styles.compactFilter} aria-label={locale === "ko" ? "장소 종류" : "Place type"} value={kind} onChange={e => { setKind(e.target.value as Kind); setSelected(null); setRestore(null) }}>
            {(["all", "cafe", "food"] as Kind[]).map(k => <option key={k} value={k}>{COPY[k][locale]}</option>)}
          </select>}
          <button type="button" className={styles.iconButton} onClick={goBack} aria-label={COPY.back[locale]}><X size={19} /></button>
        </div>}
      </div>

      {isExplore ? <div className={styles.storyRail}>
        {STORIES.map(s => <button type="button" key={s.id} data-testid={`story-${s.id}`} className={styles.storyCard}
          aria-label={`${s.title[locale]} · ${CITIES[s.city][locale]} · ${COPY.viewMap[locale]}`}
          onClick={() => navigate({ city: s.city, mode: "story", story: s.id }, "all")}>
          <img src={s.image} alt="" /><span className={styles.storyShade} />
          <span className={styles.storyCity}><MapPin size={12} />{CITIES[s.city][locale]}<span>· {count(s.places.length)}</span></span>
          <strong>{s.title[locale]}</strong><span className={styles.storyArrow}><ArrowUpRight size={20} /></span>
        </button>)}
      </div> : <>
        {scope.mode !== "story" && <div className={styles.filters} aria-label={locale === "ko" ? "장소 종류" : "Place type"}>
          {(["all", "cafe", "food"] as Kind[]).map(k => <button type="button" key={k} aria-pressed={kind === k} onClick={() => { setKind(k); setSelected(null); setRestore(null) }}>{k === "cafe" ? <Coffee size={15} /> : k === "food" ? <Utensils size={15} /> : null}{COPY[k][locale]}</button>)}
          {places.length > 1 && <div className={styles.pager}>
            <button type="button" disabled={currentIndex === 0} aria-label={locale === "ko" ? "이전 장소" : "Previous place"} onClick={() => selectPlace(places[currentIndex - 1].id)}><ChevronLeft size={18} /></button>
            <span>{currentIndex + 1}/{places.length}</span>
            <button type="button" disabled={currentIndex === places.length - 1} aria-label={locale === "ko" ? "다음 장소" : "Next place"} onClick={() => selectPlace(places[currentIndex + 1].id)}><ChevronRight size={18} /></button>
          </div>}
        </div>}
        {places.length ? <div className={styles.placeRail} ref={rail} data-testid="place-rail" onScroll={() => {
          if (scrollTimer.current) clearTimeout(scrollTimer.current)
          scrollTimer.current = setTimeout(() => {
            const node = rail.current
            if (!node || !node.firstElementChild) return
            const step = (node.firstElementChild as HTMLElement).offsetWidth + 12
            const index = Math.min(places.length - 1, Math.max(0, Math.round(node.scrollLeft / step)))
            if (places[index]) setSelected(places[index].id)
          }, 100)
        }}>
          {places.map((place, index) => <article key={place.id} className={styles.placeCard} data-place-card={place.id} data-selected={current?.id === place.id}>
            <button type="button" className={styles.placeOpen} onClick={() => pushSnapshot({ ...snapshot(), selected: place.id, detail: place.id })} aria-label={`${place.name[locale]} · ${locale === "ko" ? "장소 보기" : locale === "ja" ? "場所を見る" : "View place"}`}>
              <Picture place={place} locale={locale} />
              <span className={styles.placeText}><span className={styles.placeArea}>{index + 1} · {place.area[locale]}</span><strong>{place.name[locale]}</strong><span>{place.reason[locale]}</span></span>
            </button>
            <button type="button" className={styles.saveButton} aria-pressed={saved.includes(place.id)} aria-label={`${place.name[locale]} ${saved.includes(place.id) ? COPY.savedOne[locale] : COPY.save[locale]}`} onClick={() => toggleSave(place.id)}><Bookmark size={19} fill={saved.includes(place.id) ? "currentColor" : "none"} /></button>
          </article>)}
        </div> : <div className={styles.empty}><Search size={23} /><span>{COPY.empty[locale]}</span>
          {(kind !== "all" || scope.mode === "search") && <button type="button" onClick={() => { setKind("all"); if (scope.mode === "search") { setScope({ city: scope.city, mode: "explore" }); setQuery("") } setRestore(null) }}>{COPY.reset[locale]}</button>}
        </div>}
        {story && <a className={styles.storySource} href={story.source} target="_blank" rel="noreferrer">{COPY.original[locale]}<ArrowUpRight size={14} /></a>}
      </>}
    </section>

    <button type="button" className={styles.prototype} onClick={() => pushSnapshot({ ...snapshot(), info: true })}><Info size={13} />{COPY.prototype[locale]}</button>
    {info && <Sheet title={COPY.prototype[locale]} onClose={goBack} locale={locale}>
      <div className={styles.infoBody}><p>{COPY.truth[locale]}</p><label className={styles.city}><MapPin size={18} /><select aria-label={locale === "ko" ? "도시" : "City"} value={scope.city} onChange={e => navigate({ city: e.target.value as City, mode: "explore" }, "all")}>{Object.entries(CITIES).map(([id, name]) => <option key={id} value={id}>{name[locale]}</option>)}</select></label><button type="button" className={styles.themeButton} onClick={() => setDark(d => !d)}>{dark ? <Sun size={19} /> : <Moon size={19} />}{dark ? "Light" : "Dark"}</button><button type="button" className={styles.themeButton} onClick={() => setLocale(l => l === "ko" ? "en" : l === "en" ? "ja" : "ko")}><Globe2 size={19} />{locale === "ko" ? "English" : locale === "en" ? "日本語" : "한국어"}</button></div>
    </Sheet>}
    {focusedPlace && <Sheet title={focusedPlace.area[locale]} onClose={goBack} locale={locale}>
      <div className={styles.detailBody}>
        <Picture place={focusedPlace} locale={locale} className={styles.hero} />
        {focusedPlace.illustration && <small className={styles.imageNote}>{COPY.illustration[locale]}</small>}
        <h3>{focusedPlace.name[locale]}</h3><p>{focusedPlace.reason[locale]}</p>
        <details className={styles.provenance}><summary>{COPY.source[locale]}<ChevronRight size={16} /></summary><p>{focusedPlace.credit}</p><a href={focusedPlace.source} target="_blank" rel="noreferrer">{locale === "ko" ? "장소 정보" : locale === "ja" ? "場所の情報" : "Place information"}<ArrowUpRight size={15} /></a>
          {focusedPlace.photoSource && <a href={focusedPlace.photoSource} target="_blank" rel="noreferrer">{locale === "ko" ? "사진 원문" : locale === "ja" ? "写真の出典" : "Photo source"}<ArrowUpRight size={15} /></a>}
          {focusedPlace.licenseUrl && <a href={focusedPlace.licenseUrl} target="_blank" rel="noreferrer">{locale === "ko" ? "이미지 라이선스" : locale === "ja" ? "画像ライセンス" : "Image license"}<ArrowUpRight size={15} /></a>}
        </details>
      </div>
      <footer className={styles.detailActions}><button type="button" aria-pressed={saved.includes(focusedPlace.id)} onClick={() => toggleSave(focusedPlace.id)}>{saved.includes(focusedPlace.id) ? <Check size={20} /> : <Bookmark size={20} />}{saved.includes(focusedPlace.id) ? COPY.savedOne[locale] : COPY.save[locale]}</button><button type="button" onClick={goBack}><MapPin size={19} />{COPY.viewMap[locale]}</button></footer>
    </Sheet>}
    <span className={styles.srOnly} role="status" aria-live="polite">{!isExplore ? `${title}, ${count(places.length)}. ${current?.name[locale] ?? ""}` : ""}</span>
  </main>
}
