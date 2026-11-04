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
// the web version, added to a home screen: square, the system rounds the corners
const square = svg.replace('rx="112" fill="url(#bg)"', 'fill="url(#bg)"')
render(180, 'public/apple-touch-icon.png', square)
render(192, 'public/icon-192.png', square)
render(512, 'public/icon-512.png', square)
console.log('icons written')
