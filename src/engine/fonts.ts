/**
 * Maps the font names a deck uses to web fonts, so the deck looks right on
 * computers that do not have those fonts installed. The viewer's installed
 * font always wins; the web font is the next fallback.
 */

export type WebFont = { family: string; css?: string }

/** Variable Google font; `range` must match the font's real weight axis or the request fails. */
const google = (family: string, range = '100..900'): WebFont => ({
  family,
  css: `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${range}&display=swap`,
})
const googleStatic = (family: string, weights = '400;700'): WebFont => ({
  family,
  css: `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weights}&display=swap`,
})

// Keys are lower-case names with spaces and hyphens removed.
const WEB_FONTS: Record<string, WebFont> = {
  // Bundled with the engine.
  pretendard: { family: 'Pretendard Variable' },
  pretendardvariable: { family: 'Pretendard Variable' },
  // Korean
  suite: { family: 'SUITE Variable', css: 'https://cdn.jsdelivr.net/gh/sun-typeface/SUITE@2/fonts/variable/woff2/SUITE-Variable.css' },
  nanumgothic: googleStatic('Nanum Gothic', '400;700;800'),
  나눔고딕: googleStatic('Nanum Gothic', '400;700;800'),
  nanummyeongjo: googleStatic('Nanum Myeongjo', '400;700;800'),
  나눔명조: googleStatic('Nanum Myeongjo', '400;700;800'),
  nanumpenscript: googleStatic('Nanum Pen Script', '400'),
  notosanskr: google('Noto Sans KR'),
  notosanscjkkr: google('Noto Sans KR'),
  sourcehansanskr: google('Noto Sans KR'),
  본고딕: google('Noto Sans KR'),
  notoserifkr: google('Noto Serif KR', '200..900'),
  malgungothic: google('Noto Sans KR'),
  맑은고딕: google('Noto Sans KR'),
  applesdgothicneo: google('Noto Sans KR'),
  ibmplexsanskr: googleStatic('IBM Plex Sans KR', '300;400;500;600;700'),
  gowundodum: googleStatic('Gowun Dodum', '400'),
  blackhansans: googleStatic('Black Han Sans', '400'),
  dohyeon: googleStatic('Do Hyeon', '400'),
  jua: googleStatic('Jua', '400'),
  spoqahansansneo: { family: 'Spoqa Han Sans Neo', css: 'https://spoqa.github.io/spoqa-han-sans/css/SpoqaHanSansNeo.css' },
  // Latin: metric-compatible stand-ins for Office fonts, plus common Google fonts.
  calibri: googleStatic('Carlito'),
  calibrilight: googleStatic('Carlito'),
  cambria: googleStatic('Caladea', '400;700'),
  arial: google('Arimo', '400..700'),
  helvetica: google('Arimo', '400..700'),
  helveticaneue: google('Arimo', '400..700'),
  timesnewroman: googleStatic('Tinos'),
  times: googleStatic('Tinos'),
  couriernew: googleStatic('Cousine'),
  comicsansms: googleStatic('Comic Neue', '400;700'),
  roboto: google('Roboto'),
  opensans: google('Open Sans', '300..800'),
  lato: googleStatic('Lato', '300;400;700;900'),
  montserrat: google('Montserrat'),
  poppins: googleStatic('Poppins', '300;400;500;600;700;800'),
  inter: google('Inter'),
  sourcesanspro: google('Source Sans 3', '200..900'),
  notosans: google('Noto Sans'),
  raleway: google('Raleway'),
  nunito: google('Nunito', '200..1000'),
  oswald: google('Oswald', '200..700'),
  merriweather: googleStatic('Merriweather', '300;400;700;900'),
  playfairdisplay: google('Playfair Display', '400..900'),
  firasans: googleStatic('Fira Sans', '300;400;500;600;700'),
  ptsans: googleStatic('PT Sans', '400;700'),
  georgia: googleStatic('Gelasio', '400;700'),
  garamond: google('EB Garamond', '400..800'),
  calistomt: googleStatic('Gelasio', '400;700'),
  bookantiqua: googleStatic('Gelasio', '400;700'),
  palatinolinotype: googleStatic('Gelasio', '400;700'),
  consolas: google('Inconsolata', '200..900'),
}

/** Installed look-alikes worth trying before a web font (e.g. on macOS). */
const LOCAL_ALIASES: Record<string, string[]> = {
  gillsansmt: ['Gill Sans'],
  franklingothicbook: ['Franklin Gothic', 'Libre Franklin'],
  calistomt: ['Calisto MT', 'Baskerville', 'Georgia'],
  돋움: ['Dotum', 'Apple SD Gothic Neo'],
  굴림: ['Gulim', 'Apple SD Gothic Neo'],
  바탕: ['Batang', 'AppleMyungjo'],
  segoeui: ['Segoe UI', 'Helvetica Neue'],
  msgothic: ['MS Gothic', 'Hiragino Sans'],
  mspgothic: ['MS PGothic', 'Hiragino Sans'],
}

const SERIF_WORDS = /times|georgia|garamond|cambria|calisto|palatino|antiqua|baskerville|bodoni|didot|century|bookman|serif|명조|바탕|batang|myeongjo|mincho|songti/i
const MONO_WORDS = /courier|consolas|mono|code|menlo/i

/** Fonts the converter classified from their PANOSE codes ("serif" / "mono"). */
let fontKinds: Record<string, 'serif' | 'mono'> = {}
export function setFontKinds(kinds: Record<string, 'serif' | 'mono'> | undefined) {
  fontKinds = kinds ?? {}
}

const WEIGHTS: [RegExp, number][] = [
  [/[\s-]?(thin|hairline)$/i, 100],
  [/[\s-]?(extra|ultra)\s?light$/i, 200],
  [/[\s-]?light$/i, 300],
  [/[\s-]?(regular|normal|book|roman)$/i, 400],
  [/[\s-]?medium$/i, 500],
  [/[\s-]?(semi|demi)\s?bold$/i, 600],
  [/[\s-]?(extra|ultra)\s?bold$/i, 800],
  [/[\s-]?bold(mt)?$/i, 700],
  [/[\s-]?(black|heavy)$/i, 900],
]

/** "SUITE ExtraBold" → { base: "SUITE", weight: 800 }; "Arial-BoldMT" → { base: "Arial", weight: 700 }. */
export function splitWeight(name: string): { base: string; weight?: number } {
  const clean = name.replace(/MT$/, '')
  for (const [re, w] of WEIGHTS) {
    if (re.test(clean)) return { base: clean.replace(re, '').trim() || name, weight: w }
  }
  return { base: name }
}

const key = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, '')

export function webFontFor(name: string): WebFont | undefined {
  return WEB_FONTS[key(name)] ?? WEB_FONTS[key(splitWeight(name).base)]
}

const FALLBACK = `'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif`
const SERIF_FALLBACK = `Georgia, 'Times New Roman', 'Noto Serif KR', 'AppleMyungjo', serif`
const MONO_FALLBACK = `Menlo, Consolas, 'Courier New', monospace`

/** CSS font-family and weight for a run's "Latin,EastAsian" font field. */
export function fontStack(field: string | undefined, bold: boolean | undefined): { family: string; weight: number } {
  let weight: number | undefined
  let kind: 'serif' | 'mono' | undefined
  const parts: string[] = []
  for (const name of (field ?? '').split(',').filter(Boolean)) {
    const { base, weight: w } = splitWeight(name)
    weight ??= w
    kind ??= fontKinds[name] ?? (SERIF_WORDS.test(name) ? 'serif' : MONO_WORDS.test(name) ? 'mono' : undefined)
    parts.push(`'${name}'`)
    if (base !== name) parts.push(`'${base}'`)
    for (const alias of LOCAL_ALIASES[key(name)] ?? LOCAL_ALIASES[key(base)] ?? []) parts.push(`'${alias}'`)
    const web = webFontFor(name)
    if (web) parts.push(`'${web.family}'`)
  }
  const w = weight ?? 400
  const tail = kind === 'serif' ? `${SERIF_FALLBACK}, ${FALLBACK}` : kind === 'mono' ? `${MONO_FALLBACK}, ${FALLBACK}` : FALLBACK
  return { family: [...new Set(parts), tail].join(', '), weight: bold ? Math.max(700, w) : w }
}

/** Adds <link> tags for the web fonts a deck needs. */
export function loadFonts(fonts: string[]) {
  const urls = new Set<string>()
  for (const f of fonts) {
    const css = webFontFor(f)?.css
    if (css) urls.add(css)
  }
  for (const href of urls) {
    if (document.querySelector(`link[data-webfont="${href}"]`)) continue
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.webfont = href
    document.head.appendChild(link)
  }
}
