// Renders the app icon (build/icon.svg) to PNGs for Windows and iOS
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const svg = readFileSync('build/icon.svg', 'utf8')
const render = (size, out, svgText = svg) => {
  const png = new Resvg(svgText, { fitTo: { mode: 'width', value: size } }).render().asPng()
  writeFileSync(out, png)
}
mkdirSync('resources', { recursive: true })
render(512, 'build/icon.png')
render(256, 'public/icon-256.png')
// iOS icons must be opaque and square: drop the rounded corners
render(1024, 'resources/icon.png', svg.replace('rx="112" fill="url(#bg)"', 'fill="url(#bg)"'))
console.log('icons written')
