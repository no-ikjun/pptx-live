/**
 * npm run import -- <deck.pptx> [--name my-talk]
 *
 * Converts a PowerPoint file into decks/<name>/ (deck.json + media/) and adds a
 * live.tsx stub for slide-specific code if the deck does not have one yet.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convert } from '../src/convert/convert.ts'
import type { Shape } from '../src/model.ts'
import { webFontFor } from '../src/engine/fonts.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function usage(): never {
  console.error('Usage: npm run import -- <deck.pptx> [--name my-talk]')
  process.exit(1)
}

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
if (!file) usage()
const nameFlag = args.indexOf('--name')
const name =
  (nameFlag >= 0 ? args[nameFlag + 1] : null) ??
  basename(file, extname(file))
    .normalize('NFC')
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .toLowerCase()

const deckDir = join(root, 'decks', name)
const mediaDir = join(deckDir, 'media')
rmSync(mediaDir, { recursive: true, force: true })
mkdirSync(mediaDir, { recursive: true })

const started = Date.now()
const { deck, media } = convert(new Uint8Array(readFileSync(file)), basename(file, extname(file)), (done, total) => {
  if (process.stdout.isTTY || process.env.PPTX_PROGRESS) process.stdout.write(`\r  Converting slide ${done}/${total} (${((Date.now() - started) / 1000).toFixed(1)}s)`)
})
if (process.stdout.isTTY) process.stdout.write('\n')

// Browsers cannot show EMF/WMF vector images, so those are left out and reported.
const dropped = new Set<string>()
for (const m of media) {
  if (/\.(emf|wmf)$/i.test(m.name)) {
    dropped.add(`media/${m.name}`)
    continue
  }
  writeFileSync(join(mediaDir, m.name), m.bytes)
}
if (dropped.size) deck.warnings.push(`${dropped.size} EMF/WMF image(s) are not supported by browsers and were left out (re-insert them as PNG or SVG)`)
for (const s of deck.slides) dropDeadImages(s.shapes)

function dropDeadImages(shapes: Shape[]) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]
    if (s.kind === 'image' && dropped.has(s.src)) shapes.splice(i, 1)
    else if (s.kind === 'group') dropDeadImages(s.children)
  }
}

writeFileSync(join(deckDir, 'deck.json'), JSON.stringify(deck))

const livePath = join(deckDir, 'live.tsx')
if (!existsSync(livePath)) {
  writeFileSync(
    livePath,
    `import { defineLive } from '../../src/engine/live'

/**
 * Slide-specific behaviour for this deck. Return overrides for the slides you
 * want to change; see decks/edu-econ/live.tsx for a full example.
 */
export default defineLive(() => ({}))
`,
  )
}

// ---- report ------------------------------------------------------------------
const visible = deck.slides.filter((s) => !s.hidden).length
const builds = deck.slides.reduce((n, s) => n + s.steps.length, 0)
console.log(`\n${deck.title}`)
console.log(`  decks/${name}/  ·  ${deck.slides.length} slides (${deck.slides.length - visible} hidden)  ·  ${deck.width}×${deck.height}  ·  ${media.length} media  ·  ${builds} build steps`)
if (deck.fonts.length) {
  console.log('  Fonts:')
  for (const f of deck.fonts) {
    const web = webFontFor(f)
    console.log(`    ${f.padEnd(28)} ${web ? `→ web font: ${web.family}` : '→ uses the viewer’s installed font, else a fallback'}`)
  }
}
if (deck.warnings.length) {
  console.log('  Notes:')
  for (const w of deck.warnings) console.log(`    - ${w}`)
}
console.log(`\n  Run \`npm run dev\` and open http://localhost:5173/?deck=${encodeURIComponent(name)}\n`)
