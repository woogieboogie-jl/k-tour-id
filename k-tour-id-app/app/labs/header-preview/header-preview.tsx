"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, ArrowUpRight, BatteryFull, Check, ChevronDown, ChevronRight, ChevronUp, Coffee, Compass, Info, MapPin, MoreHorizontal, Search, Signal, SlidersHorizontal, Wallet, Wifi, X } from "lucide-react"
import { ondoMapPalette } from "@/lib/ondo/map/ondo-map-style"
import { HeaderSpectrum } from "./header-spectrum"
import { HeaderCredits } from "./header-credits"
import { PLACES as DISCOVERY_PLACES, DEMO_TEMPERATURE } from "@/features/ondo/discovery-preview/fixtures"
import styles from "./header-preview.module.css"

type Variant = "a" | "b" | "c"
type City = "서울" | "제주"
type Mood = "all" | "hot" | "warm" | "cool"
type Panel = "city" | "filters" | "wallet" | "options" | "place" | "credits" | null
type Place = { id: string; name: string; area: string; city: City; mood: Exclude<Mood, "all">; kind: string; x: number; y: number; adult?: boolean; image?: string; illustration?: boolean; photoSource?: string; licenseUrl?: string; credit?: string }
const PLACES: Place[] = [
  { id: "onion", name: "어니언 안국", area: "안국", city: "서울", mood: "hot", kind: "카페", x: 40, y: 45 },
  { id: "hakrim", name: "학림다방", area: "대학로", city: "서울", mood: "cool", kind: "카페", x: 74, y: 54 },
  { id: "market", name: "중부시장", area: "을지로", city: "서울", mood: "warm", kind: "먹거리", x: 48, y: 63 },
  { id: "cham", name: "바 참", area: "서촌", city: "서울", mood: "warm", kind: "바", x: 20, y: 54, adult: true },
  { id: "jeju-coast", name: "바다 앞 카페", area: "애월 · 예시 장소", city: "제주", mood: "cool", kind: "카페", x: 28, y: 46 },
  { id: "jeju-market", name: "동네 시장", area: "제주시 · 예시 장소", city: "제주", mood: "hot", kind: "먹거리", x: 62, y: 38 },
  { id: "jeju-table", name: "제주의 한 끼", area: "서귀포 · 예시 장소", city: "제주", mood: "warm", kind: "먹거리", x: 52, y: 65 },
]
// Reuse the existing editorial examples, never invent live popularity or eligibility.
// Coordinates below are layout positions on the Lab illustration, not geography.
const A_PLACES: Place[] = [
  ...(["cool", "warm", "hot"] as const).flatMap((band, row) => DISCOVERY_PLACES.filter(place => DEMO_TEMPERATURE[place.id]?.band === band).map((place, index) => ({
    id: place.id, name: place.name.ko, area: place.area.ko, city: "서울" as const, mood: band,
    kind: place.kind === "bar" ? "바" : place.kind === "cafe" ? "카페" : "먹거리",
    x: 25 + index * 25, y: 37 + row * 12, adult: place.kind === "bar",
    image: place.image, illustration: place.illustration, photoSource: place.photoSource, licenseUrl: place.licenseUrl, credit: place.credit,
  }))),
  ...PLACES.filter(place => place.city === "제주"),
]
const MOODS: { id: Mood; label: string; hint: string }[] = [
  { id: "all", label: "전체", hint: "분위기 모두 보기" },
  { id: "hot", label: "Hot", hint: "눈길이 가는 곳" },
  { id: "warm", label: "Warm", hint: "편안한 일상 속 발견" },
  { id: "cool", label: "Cool", hint: "차분한 무드" },
]
const DESIGNS = [
  { id: "a" as const, name: "큐레이션 아일랜드", tag: "수정안", summary: "글자 대신 색과 움직임으로 발견해요. 스펙트럼을 밀면 지도와 추천이 함께 바뀌어요.", benefit: "스펙트럼은 바로, 검색은 필요할 때", tradeoff: "손을 놓으면 추천 적용 · 출처 표기는 5초 후 축소" },
  { id: "b" as const, name: "차분한 도시 헤더", tag: "명료함", summary: "도시 → 검색 → 분위기 순서. 처음 쓰는 사람에게 가장 명확해요.", benefit: "안정적인 흰 바탕과 읽는 순서", tradeoff: "상단이 높아 지도가 조금 줄어요." },
  { id: "c" as const, name: "엄지 중심 커맨드", tag: "지도 우선", summary: "상단은 가볍게, 검색은 아래로. 한 손 탐색과 넓은 지도에 집중해요.", benefit: "자주 쓰는 조작을 엄지 가까이", tradeoff: "실제 적용 시 하단 탭·장소 카드를 함께 재배치해야 해요." },
]

function Sheet({ title, onClose, children, returnFocus }: { title: string; onClose(): void; children: ReactNode; returnFocus: HTMLElement | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    // Capture before the background becomes inert, not from the now-blurred DOM.
    const opener = returnFocus
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true })
    return () => { requestAnimationFrame(() => {
      const active = document.activeElement
      if (opener?.isConnected && !opener.closest("[inert]") && (!active || active === document.body || !active.isConnected)) opener.focus({ preventScroll: true })
    }) }
  }, [returnFocus])
  return <div className={styles.scrim} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={ref} className={styles.sheet} role="dialog" aria-labelledby={id} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); onClose() }
      if (event.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, a[href], [tabindex="0"]')
        if (!nodes?.length) return
        const first = nodes[0], last = nodes[nodes.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }}>
      <div className={styles.sheetHeading}><h3 id={id}>{title}</h3><button type="button" className={styles.iconButton} aria-label="닫기" onClick={onClose}><X size={20} /></button></div>
      {children}
    </div>
  </div>
}

function MapCanvas({ city, places, labels, adult, variant, mood, onSelect }: { city: City; places: Place[]; labels: boolean; adult: boolean; variant: Variant; mood: Mood; onSelect(place: Place): void }) {
  const palette = ondoMapPalette("light", adult)
  const patternId = useId().replace(/:/g, "")
  const activeCamera = useRef({ x: 50, y: 50, scale: 1 })
  if (variant === "a" && places.length) {
    activeCamera.current = mood === "all" ? { x: 50, y: 50, scale: 1 } : {
      x: places.reduce((sum, p) => sum + p.x, 0) / places.length,
      y: places.reduce((sum, p) => sum + p.y, 0) / places.length,
      scale: 1.12,
    }
  }
  const camera = activeCamera.current
  const offsetX = (50 - camera.x) * camera.scale
  const offsetY = camera.scale === 1 ? 0 : -3 + (50 - camera.y) * camera.scale
  return <div className={styles.map} aria-label={`${city} 예시 지도`} data-testid={variant === "a" ? "header-a-map" : undefined} data-camera={`${camera.x}:${camera.y}:${camera.scale}`} style={{ background: palette.canvas }}>
    <svg className={styles.mapDrawing} style={variant === "a" ? { transform: `translate(${offsetX}%, ${offsetY}%) scale(${camera.scale})` } : undefined} viewBox="0 0 390 720" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><pattern id={patternId} width="53" height="46" patternTransform="rotate(-13)" patternUnits="userSpaceOnUse"><rect x="4" y="5" width="18" height="15" rx="2" fill={palette.building} opacity=".55" /><rect x="28" y="7" width="19" height="30" rx="2" fill={palette.building} opacity=".55" /><rect x="4" y="26" width="18" height="15" rx="2" fill={palette.building} opacity=".4" /><path d="M0 0H53M0 0V46" stroke={palette.minorRoad} strokeWidth="2" /></pattern></defs>
      <rect width="390" height="720" fill={`url(#${patternId})`} />
      <path d="M-40 92 Q40 140 38 226 T155 272 L197 173 138 70Z M252 389 Q296 327 396 336 L430 444 331 476Z" fill={palette.park} />
      <path d={city === "서울" ? "M-30 570 C70 485 139 568 244 531 S365 463 430 492 L430 536 C345 507 337 567 253 575 S81 535 -30 614Z" : "M-30 52 C95 72 111 148 240 118 S380 80 430 125 L430 0H-30Z"} fill={palette.water} />
      <g fill="none" strokeLinecap="round"><path d="M-20 302 Q160 270 414 299 M67 145 Q123 322 68 537 M303 87 Q221 288 290 526 M-10 436L410 368" stroke={palette.secondaryRoad} strokeWidth="9" /><path d="M-20 302 Q160 270 414 299 M67 145 Q123 322 68 537 M303 87 Q221 288 290 526 M-10 436L410 368" stroke="#fff" strokeWidth="5" /><path d="M-30 645Q122 461 428 180" stroke={palette.majorRoad} strokeWidth="5" /><path d="M-30 645Q122 461 428 180" stroke="#fff" strokeWidth="2" /></g>
      {labels && <g fill={palette.label} fontSize="11" fontWeight="500" textAnchor="middle"><text x="69" y="238">{city === "서울" ? "경복궁" : "애월"}</text><text x="206" y="288">{city === "서울" ? "종로" : "제주시"}</text><text x="317" y="384">{city === "서울" ? "동대문" : "한라산"}</text><text x="101" y="451">{city === "서울" ? "을지로" : "중문"}</text><text x="249" y="620">{city === "서울" ? "용산" : "서귀포"}</text><text x="90" y="554" letterSpacing="5">{city === "서울" ? "한강" : "제주"}</text></g>}
    </svg>
    {places.map((place, index) => <button key={place.id} type="button" className={`${styles.pin} ${variant === "a" ? styles.numberPin : ""}`} data-mood={place.mood} style={{ left: `${variant === "a" ? (place.x - 50) * camera.scale + 50 + offsetX : place.x}%`, top: `${variant === "a" ? (place.y - 50) * camera.scale + 50 + offsetY : place.y - (variant === "c" ? 10 : 0)}%` }} aria-label={`${index + 1}. ${place.name}`} onClick={() => onSelect(place)}><span className={styles.pinDot} /><span>{variant === "a" ? index + 1 : place.name}</span></button>)}
    <span className={styles.mapNote}>위치·분위기 예시 지도</span>
  </div>
}

function Phone({ variant }: { variant: Variant }) {
  const [city, setCity] = useState<City>("서울")
  const [mood, setMood] = useState<Mood>("all")
  const [query, setQuery] = useState("")
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [creditsVersion, setCreditsVersion] = useState(0)
  const [adult, setAdult] = useState(false)
  const [labels, setLabels] = useState(true)
  const [panel, setPanel] = useState<Panel>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [saved, setSaved] = useState<string[]>([])
  const [message, setMessage] = useState("")
  const [history, setHistory] = useState<{ city: City; mood: Mood; query: string; adult: boolean }[]>([])
  const input = useRef<HTMLInputElement>(null)
  const searchButton = useRef<HTMLButtonElement>(null)
  const panelTrigger = useRef<HTMLElement | null>(null)
  useEffect(() => { if (variant === "a" && searchExpanded) input.current?.focus({ preventScroll: true }) }, [searchExpanded, variant])
  const closeSearch = () => { setSearchExpanded(false); searchButton.current?.focus({ preventScroll: true }) }
  const shown = (variant === "a" ? A_PLACES : PLACES).filter(p => p.city === city && (adult || !p.adult) && (mood === "all" || p.mood === mood) && `${p.name} ${p.area} ${p.kind} ${p.mood}`.toLowerCase().includes(query.trim().toLowerCase()))
  const current = shown[0]
  const isChanged = query || mood !== "all" || adult || city !== "서울"
  const remember = () => setHistory(stack => [...stack, { city, mood, query, adult }])
  const chooseMood = (next: Mood) => { if (next === mood) return; if (variant !== "a" || mood === "all") remember(); setMood(next); setMessage(next === "all" ? "모든 분위기 보기" : `${MOODS.find(m => m.id === next)?.hint} 추천 선택`) }
  function goBack() {
    if (variant === "a" && searchExpanded) { closeSearch(); return }
    const previous = history.at(-1)
    if (previous) { setCity(previous.city); setMood(previous.mood); setQuery(previous.query); setAdult(previous.adult); setHistory(h => h.slice(0, -1)); setMessage("이전 탐색으로 돌아왔어요.") }
    else if (isChanged) { setQuery(""); setMood("all"); setAdult(false); setCity("서울"); setMessage("처음 탐색으로 돌아왔어요.") }
    else setPanel("city")
  }
  const cityButton = <div className={styles.cityGroup}><button type="button" className={styles.backButton} aria-label="이전 탐색" onClick={goBack}><ArrowLeft size={19} /></button><button type="button" className={styles.cityButton} onClick={() => setPanel("city")} aria-label={`도시 변경 · 현재 ${city}`} aria-haspopup="dialog">{city}<ChevronDown size={15} /></button></div>
  const walletButton = <button type="button" className={styles.walletButton} onClick={() => setPanel("wallet")} aria-label="여행 지갑 · 예시 잔액 60,000원" aria-haspopup="dialog"><Wallet size={18} /><span>60,000원</span></button>
  const optionsButton = <button type="button" className={styles.iconButton} aria-label="지도 옵션" aria-haspopup="dialog" onClick={() => setPanel("options")}><MoreHorizontal size={21} /></button>
  const search = <form className={styles.search} role="search" onKeyDown={event => { if (variant === "a" && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeSearch() } }} onSubmit={event => { event.preventDefault(); if (variant === "a") closeSearch(); else input.current?.blur(); setMessage(`${query || city} · ${shown.length}곳을 찾았어요.`) }}><Search size={21} aria-hidden="true" /><input ref={input} value={query} onChange={event => setQuery(event.target.value)} aria-label="장소 또는 동네 검색" placeholder={variant === "b" ? "어디로 가볼까요?" : "장소, 동네 검색"} autoComplete="off" enterKeyHint="search" maxLength={80} />{query && <button type="button" className={styles.clearSearch} onClick={() => { setQuery(""); input.current?.focus() }} aria-label="검색어 지우기"><X size={16} /></button>}{variant === "a" ? <button type="button" className={styles.clearSearch} onClick={closeSearch} aria-label="검색 닫기"><ChevronUp size={18} /></button> : variant === "c" && <button type="button" className={styles.filterButton} onClick={() => setPanel("filters")} aria-label="분위기 및 19+ 필터" aria-haspopup="dialog"><SlidersHorizontal size={19} />{adult && <i />}</button>}</form>
  const moods = <div className={styles.moods} aria-label="장소 분위기">{MOODS.map(item => <button type="button" key={item.id} data-mood={item.id} aria-pressed={mood === item.id} onClick={() => chooseMood(item.id)}>{item.id !== "all" && <i />}{item.label}</button>)}{variant === "b" && <button type="button" className={styles.inlineFilter} aria-label="분위기 및 19+ 필터" onClick={() => setPanel("filters")}><SlidersHorizontal size={17} /></button>}</div>
  const panelTitle = panel === "city" ? "어느 도시로 갈까요?" : panel === "wallet" ? "여행 지갑" : panel === "options" ? "지도 옵션" : panel === "credits" ? "지도 출처" : panel === "place" ? place?.name ?? "장소" : variant === "a" ? "19+ 장소" : "분위기로 찾아보기"
  return <div className={styles.phone} data-variant={variant} data-search-expanded={searchExpanded} data-testid={`header-design-${variant}`}>
    <div className={styles.phoneContent} inert={panel !== null} onClickCapture={event => {
      if (event.target instanceof Element) panelTrigger.current = event.target.closest<HTMLElement>("button")
    }}>
      <MapCanvas city={city} places={shown} labels={labels} adult={adult} variant={variant} mood={mood} onSelect={selected => { setPlace(selected); setPanel("place") }} />
      <div className={styles.statusBar} aria-hidden="true"><b>9:41</b><span><Signal size={14} /><Wifi size={14} /><BatteryFull size={19} /></span></div>
      {variant === "a" && <header className={styles.headerA} data-testid="header-a-shell">
        <div className={styles.utilityRow} data-testid="header-a-utilities">{cityButton}<div className={styles.utilities}>{walletButton}{optionsButton}</div></div>
        <div className={styles.curationIsland}>
          <div className={styles.curationBar} data-testid="header-a-curation">
            <HeaderSpectrum value={mood} onChange={chooseMood} onOpen={() => setSearchExpanded(false)} disabled={panel !== null} />
            <button ref={searchButton} type="button" className={styles.searchToggle} aria-label="장소 검색 열기" aria-expanded={searchExpanded} data-has-query={Boolean(query)} onClick={() => searchExpanded ? closeSearch() : setSearchExpanded(true)}><Search size={20} aria-hidden="true" />{query && <i />}</button>
          </div>
          {searchExpanded && search}
        </div>
      </header>}
      {variant === "b" && <header className={styles.headerB}><div className={styles.utilityRow}>{cityButton}<div className={styles.utilities}>{walletButton}{optionsButton}</div></div><p className={styles.citySubtitle}>익숙한 도시, 새로운 발견</p>{search}{moods}</header>}
      {variant === "c" && <><header className={styles.headerC}>{cityButton}<div className={styles.utilities}>{walletButton}{optionsButton}</div></header><div className={styles.bottomCommand}>{search}{moods}</div></>}
      {adult && <button type="button" className={styles.adultPill} onClick={() => { remember(); setAdult(false) }} aria-label="19+ 장소 제외하기">19+ 포함 <X size={14} /></button>}
      {variant === "a"
        ? <span className={styles.srOnly} data-testid="header-a-result-summary" aria-live="polite">{query ? `${query} · ` : ""}추천 장소 {shown.length}곳</span>
        : <div className={styles.mapCaption} aria-live="polite"><span className={styles.resultDot} />{query ? `“${query}”` : mood === "all" ? `${city}에서 발견하기` : `${MOODS.find(m => m.id === mood)?.label} 분위기`}<b>{shown.length}곳</b></div>}
      {variant === "a" && current ? <div key={`${city}:${mood}:${query}:${adult}`} className={styles.recommendationRail} data-testid="header-a-recommendations" data-count={shown.length} role="region" aria-label={`추천 장소 · ${shown.length}곳`}>
        {shown.map((item, index) => <button key={item.id} type="button" className={styles.placeCard} data-place-id={item.id} onClick={() => { setPlace(item); setPanel("place") }}><div className={styles.placeArtwork}>{item.image ? <img src={item.image} alt="" /> : <Coffee size={26} />}{item.illustration && <small>일러스트</small>}</div><div><span className={styles.placeEyebrow}><span className={styles.cardPosition} data-testid="header-a-card-position">{index + 1} / {shown.length}</span><span aria-hidden="true"> · </span>{item.area}</span><strong>{item.name}</strong><span className={styles.placeMood} data-mood={item.mood}><i />{item.kind}</span></div><ChevronRight size={18} /></button>)}
      </div> : current ? <button type="button" className={styles.placeCard} onClick={() => { setPlace(current); setPanel("place") }}><div className={styles.placeArtwork}>{current.id === "onion" ? <img src="/media/venues/onion-anguk-christopher-phua-20250301.jpg" alt="" /> : current.id === "hakrim" ? <img src="/media/venues/research-seoul-hakrim-dabang/exterior-seefooddiet-20250110-v1.jpg" alt="" /> : <Coffee size={26} />}</div><div><span className={styles.placeEyebrow}>{current.area} · {current.kind}</span><strong>{current.name}</strong><span className={styles.placeMood} data-mood={current.mood}><i />{MOODS.find(m => m.id === current.mood)?.hint}</span></div><ChevronRight size={18} /></button> : <div className={styles.empty}><Search size={23} /><strong>맞는 장소가 아직 없어요</strong><button type="button" onClick={() => { setQuery(""); setMood("all") }}>검색·분위기 초기화</button></div>}
      <div className={styles.homeIndicator} aria-hidden="true" />
      {variant === "a" && <HeaderCredits key={creditsVersion} enabled={panel === null} onDetails={() => setPanel("credits")} />}
      <p className={styles.srOnly} role="status">{message}</p>
    </div>
    {panel && <Sheet title={panelTitle} returnFocus={panelTrigger.current} onClose={() => setPanel(null)}>
      {panel === "city" && <><p className={styles.sheetHint}>도시를 바꾸면 검색과 분위기를 초기화해요.</p>{(["서울", "제주"] as City[]).map(next => <button className={styles.choiceRow} type="button" key={next} onClick={() => { remember(); setCity(next); setQuery(""); setMood("all"); setSearchExpanded(false); setPanel(null) }}><MapPin size={19} /><span>{next}<small>{next === "서울" ? "골목과 카페의 발견" : "바다와 느긋한 하루"}</small></span>{city === next && <Check size={19} />}</button>)}</>}
      {panel === "filters" && <>{variant !== "a" && <><p className={styles.sheetHint}>오늘 끌리는 분위기를 골라보세요.</p><div className={styles.moodChoices}>{MOODS.map(item => <button type="button" key={item.id} data-mood={item.id} aria-pressed={mood === item.id} onClick={() => chooseMood(item.id)}><span><i />{item.label}</span><small>{item.hint}</small>{mood === item.id && <Check size={17} />}</button>)}</div><div className={styles.separator} /></>}<label className={styles.switchRow}><span>19+ 장소도 보기<small>바·나이트라이프를 선택적으로 포함</small></span><input type="checkbox" checked={adult} onChange={event => { remember(); setAdult(event.target.checked) }} /></label><p className={styles.disclosure}>화면 예시만 바뀌어요. 나이 확인을 대신하지 않으며, 실시간 인기·혼잡·조용함을 보장하지 않아요.</p><button type="button" className={styles.primaryButton} onClick={() => setPanel(null)}>{variant === "a" ? "지도 보기" : `${shown.length}곳 보기`}</button></>}
      {panel === "wallet" && <><span className={styles.exampleLabel}>인터랙션 예시 · 실제 자산 아님</span><div className={styles.balance}><span>여행 잔액</span><strong>60,000<span> KRW</span></strong></div><div className={styles.walletDetail}><span>이 화면에서는</span><strong>잔액 조회 화면만 미리 보기</strong></div><p className={styles.disclosure}>계정, 지갑, 송금·충전·결제 서비스와 연결하지 않았어요. 금액은 모든 안에 동일한 고정 예시예요.</p><button type="button" className={styles.primaryButton} onClick={() => setPanel(null)}>지도로 돌아가기</button></>}
      {panel === "options" && <><label className={styles.switchRow}><span>지도 지명 표시<small>동네 이름을 지도에 보여줘요</small></span><input type="checkbox" checked={labels} onChange={event => setLabels(event.target.checked)} /></label><button type="button" className={styles.choiceRow} onClick={() => setPanel("filters")}><SlidersHorizontal size={19} /><span>{variant === "a" ? "19+ 설정" : "분위기·19+ 설정"}<small>19+ 장소 {adult ? "포함" : "제외"}</small></span><ChevronRight size={17} /></button><button type="button" className={styles.choiceRow} onClick={() => setPanel("wallet")}><Wallet size={19} /><span>여행 지갑<small>60,000 KRW · 예시 잔액</small></span><ChevronRight size={17} /></button>{variant === "a" && <button type="button" className={styles.choiceRow} onClick={() => setPanel("credits")}><Info size={19} /><span>지도 출처<small>표기 방식 미리보기</small></span><ChevronRight size={17} /></button>}<button type="button" className={styles.resetButton} onClick={() => { setCity("서울"); setMood("all"); setQuery(""); setSearchExpanded(false); setAdult(false); setLabels(true); setSaved([]); setHistory([]); setCreditsVersion(n => n + 1); setPanel(null) }}>이 안의 체험 초기화</button><p className={styles.disclosure}>선택은 이 페이지 안에서만 유지돼요.</p></>}
      {panel === "credits" && <><span className={styles.exampleLabel}>출처 표기 시뮬레이션</span><p className={styles.sheetHint}>이 Lab의 배경은 직접 그린 예시 지도예요. 실제 앱 지도에 적용할 작은 출처 표기 방식을 비교하고 있어요.</p><div className={styles.creditSources}><a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles <ArrowUpRight size={15} /></a><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap <ArrowUpRight size={15} /></a></div><p className={styles.disclosure}>처음 5초 동안 전체 표기를 보여준 뒤 OpenMapTiles와 정보 아이콘만 남겨요. 읽거나 누르는 중에는 접히지 않아요.</p><button type="button" className={styles.primaryButton} onClick={() => { setCreditsVersion(n => n + 1); setPanel(null); requestAnimationFrame(() => searchButton.current?.focus({ preventScroll: true })) }}>처음 표시 다시 보기</button></>}
      {panel === "place" && place && <><div className={styles.detailMood} data-mood={place.mood}><i />{variant === "a" ? place.kind : place.mood.toUpperCase()} · {place.area}</div><p className={styles.sheetHint}>헤더의 검색·필터에 따라 장소가 바뀌는 예시예요. 실제 영업·위치·혼잡 안내가 아니에요.</p><button type="button" className={styles.primaryButton} onClick={() => setSaved(ids => ids.includes(place.id) ? ids.filter(id => id !== place.id) : [...ids, place.id])}>{saved.includes(place.id) ? "저장됨 · 다시 누르면 해제" : "이 화면에서 저장하기"}</button>{place.id === "onion" && <p className={styles.disclosure}>사진: Christopher Phua / Unsplash · 썸네일 크롭<br /><a href="https://unsplash.com/photos/desserts-and-a-coffee-are-served-on-a-tray-VVwfHGp8in8" target="_blank" rel="noreferrer">사진 출처</a>{" · "}<a href="https://unsplash.com/license" target="_blank" rel="noreferrer">Unsplash License</a></p>}{place.id === "hakrim" && <p className={styles.disclosure}>Hakrim Dabang 01.jpg · Seefooddiet / Wikimedia Commons · 썸네일 크롭<br /><a href="https://commons.wikimedia.org/wiki/File:Hakrim_Dabang_01.jpg" target="_blank" rel="noreferrer">사진 출처</a>{" · "}<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a></p>}</>}
      {panel === "place" && place?.credit && <p className={styles.disclosure}>{place.credit}{place.photoSource && <><br /><a href={place.photoSource} target="_blank" rel="noreferrer">사진 출처</a></>}{place.licenseUrl && <> · <a href={place.licenseUrl} target="_blank" rel="noreferrer">이용 조건</a></>}</p>}
    </Sheet>}
  </div>
}

export function HeaderPreview() {
  const [selected, setSelected] = useState<Variant>("a")
  const [revision, setRevision] = useState(0)
  return <main className={styles.lab} lang="ko">
    <div className={styles.labInner}>
      <div className={styles.labTop}><a href="/?city=seoul" className={styles.brand}><img src="/brand/ktour-id-mono-v1.svg" alt="" />K-Tour ID <span>/ 헤더 비교실</span></a><span className={styles.localTag}><i />로컬 인터랙션 프로토타입</span></div>
      <header className={styles.intro}><div><span className={styles.eyebrow}>HEADER STUDY / A REFINED</span><h1>지도는 넓게.<br />선택은 또렷하게.</h1><p>A안을 큐레이션 중심으로 다듬었어요. B·C는 비교용으로 남겼어요.</p></div><aside className={styles.recommendation}><span><Compass size={18} /> A · 색으로 발견하기</span><p>글자 없는 스펙트럼을 좌우로 밀어보세요.<br />손을 놓으면 지도와 추천이 함께 바뀌어요.</p><button type="button" onClick={() => setRevision(n => n + 1)}>세 안 모두 초기화 <span>↺</span></button></aside></header>
      <div className={styles.variantTabs} aria-label="디자인 선택">{DESIGNS.map(design => <button type="button" key={design.id} aria-pressed={selected === design.id} onClick={() => setSelected(design.id)}>{design.id.toUpperCase()}<span>{design.id === "a" ? "큐레이션" : design.id === "b" ? "도시 헤더" : "하단 검색"}</span>{design.id === "a" && <i />}</button>)}</div>
      <div className={styles.comparison}>{DESIGNS.map(design => <section key={`${design.id}-${revision}`} className={styles.design} data-active={selected === design.id} aria-labelledby={`design-title-${design.id}`}><div className={styles.designHeading}><div><span className={styles.letter}>{design.id.toUpperCase()}</span><h2 id={`design-title-${design.id}`}>{design.name}</h2></div><span className={styles.designTag} data-recommended={design.id === "a"}>{design.tag}</span></div><p className={styles.designSummary}>{design.summary}</p><Phone variant={design.id} /><div className={styles.designFoot}><strong><Check size={15} />{design.benefit}</strong><span>{design.tradeoff}</span></div></section>)}</div>
      <footer className={styles.footer}><p>스펙트럼 · 검색 · 도시 전환 · 19+ 선택 · 지갑 · 설정을 눌러보세요.<br />실제 서비스는 바뀌지 않아요. 지도 위치·추천·잔액은 고정 예시이며, 계정·위치 권한·결제에 연결하지 않아요.</p><div><span>설계 참고</span><a href="https://toss.tech/article/toss-design-system" target="_blank" rel="noreferrer">Toss · 위계와 접근성 <ArrowUpRight size={12} /></a><a href="https://www.revolut.com/blog/post/our-top-5-design-principles-at-revolut/" target="_blank" rel="noreferrer">Revolut · 사용자의 언어 <ArrowUpRight size={12} /></a></div></footer>
    </div>
  </main>
}
