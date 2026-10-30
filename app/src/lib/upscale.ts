// Anime4K upscaling on the GPU (WebGPU compute shaders from the anime4k-webgpu package).
// The <video> keeps decoding underneath; every decoded frame is copied into a texture,
// run through the Anime4K CNN chain and drawn onto a canvas sized to the real screen pixels.
import type { Anime4KPipeline } from 'anime4k-webgpu'

export type UpscaleMode = 'off' | 'fast' | 'quality' | 'max'

export const UPSCALE_MODES: { id: UpscaleMode; label: string; hint: string }[] = [
  { id: 'off', label: 'Выкл', hint: 'Обычное видео' },
  { id: 'fast', label: 'Быстрый', hint: 'Лёгкая нейросеть, для слабых видеокарт' },
  { id: 'quality', label: 'Качество', hint: 'Anime4K Mode A: чище линии, меньше мыла' },
  { id: 'max', label: 'Максимум', hint: 'Anime4K Mode A+A: лучшая картинка, нужна мощная видеокарта' },
]

export const upscaleSupported = () => typeof navigator !== 'undefined' && 'gpu' in navigator

// plain fullscreen-triangle blit of the processed texture onto the canvas
const BLIT = /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let p = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var o: V;
  o.pos = vec4f(p[i], 0, 1);
  o.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
  return o;
}
@fragment fn fs(v: V) -> @location(0) vec4f {
  return vec4f(textureSample(tex, samp, v.uv).rgb, 1);
}`

let devicePromise: Promise<GPUDevice> | null = null
function getDevice() {
  devicePromise ??= (async () => {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('Видеокарта не поддерживает WebGPU')
    const device = await adapter.requestDevice()
    device.lost.then(() => (devicePromise = null))
    return device
  })()
  return devicePromise
}

export interface Upscaler {
  stop(): void
  /** output resolution, for the "1080p → 2160p" badge */
  info(): { from: number; to: number }
}

/** starts drawing `video` onto `canvas`; rebuilds itself when the source or screen size changes */
export async function startUpscale(video: HTMLVideoElement, canvas: HTMLCanvasElement, mode: Exclude<UpscaleMode, 'off'>, onError: (e: Error) => void): Promise<Upscaler> {
  const [{ ModeA, ModeAA, CNNx2M, CNNM }, device] = await Promise.all([import('anime4k-webgpu'), getDevice()])
  const ctx = canvas.getContext('webgpu')
  if (!ctx) throw new Error('WebGPU canvas недоступен')
  const format = navigator.gpu.getPreferredCanvasFormat()
  ctx.configure({ device, format, alphaMode: 'opaque' })

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const shader = device.createShaderModule({ code: BLIT })
  const blit = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: shader, entryPoint: 'vs' },
    fragment: { module: shader, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })

  let stopped = false
  let frameHandle = 0
  let built: { key: string; input: GPUTexture; chain: Anime4KPipeline[]; bind: GPUBindGroup; w: number; h: number; tw: number; th: number } | null = null

  // the canvas covers the video's letterboxed area exactly, in physical pixels (capped at 4K)
  const target = () => {
    const box = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    let w = Math.round(box.width * dpr)
    let h = Math.round(box.height * dpr)
    const k = Math.min(1, 3840 / w, 2160 / h)
    w = Math.max(2, Math.round(w * k))
    h = Math.max(2, Math.round(h * k))
    return { w, h }
  }

  const build = () => {
    const w = video.videoWidth
    const h = video.videoHeight
    const t = target()
    const key = `${w}x${h}>${t.w}x${t.h}`
    if (built?.key === key) return built
    built?.input.destroy()
    canvas.width = t.w
    canvas.height = t.h
    const input = device.createTexture({
      size: [w, h, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    })
    const dims = { nativeDimensions: { width: w, height: h }, targetDimensions: { width: t.w, height: t.h } }
    let chain: Anime4KPipeline[]
    if (mode === 'fast') {
      // restore lines, then double only when the screen actually has more pixels than the video
      const restore = new CNNM({ device, inputTexture: input })
      chain = [restore]
      if (t.w > w * 1.2) chain.push(new CNNx2M({ device, inputTexture: restore.getOutputTexture() }))
    } else if (mode === 'quality') chain = [new ModeA({ device, inputTexture: input, ...dims })]
    else chain = [new ModeAA({ device, inputTexture: input, ...dims })]
    const bind = device.createBindGroup({
      layout: blit.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: chain.at(-1)!.getOutputTexture().createView() },
      ],
    })
    built = { key, input, chain, bind, w, h, tw: t.w, th: t.h }
    return built
  }

  const draw = () => {
    if (stopped || !video.videoWidth) return
    try {
      const b = build()
      device.queue.copyExternalImageToTexture({ source: video }, { texture: b.input }, [b.w, b.h])
      const enc = device.createCommandEncoder()
      b.chain.forEach((p) => p.pass(enc))
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      })
      pass.setPipeline(blit)
      pass.setBindGroup(0, b.bind)
      pass.draw(3)
      pass.end()
      device.queue.submit([enc.finish()])
    } catch (e) {
      stopped = true
      onError(e as Error)
    }
  }

  // requestVideoFrameCallback fires once per decoded frame, also after a seek while paused
  const loop = () => {
    draw()
    if (!stopped) frameHandle = video.requestVideoFrameCallback(loop)
  }
  frameHandle = video.requestVideoFrameCallback(loop)
  // redraw the still frame right away and whenever the player is resized (fullscreen, rotation)
  const ro = new ResizeObserver(() => draw())
  ro.observe(canvas)
  draw()

  return {
    stop() {
      stopped = true
      video.cancelVideoFrameCallback(frameHandle)
      ro.disconnect()
      built?.input.destroy()
      built = null
    },
    info: () => ({ from: video.videoHeight, to: built?.th ?? 0 }),
  }
}
