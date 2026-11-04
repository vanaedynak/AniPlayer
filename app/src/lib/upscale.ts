// Anime4K upscaling on the GPU (WebGPU compute shaders from the anime4k-webgpu package).
// The <video> keeps decoding underneath; every decoded frame goes into a texture (straight from the
// decoder where the browser allows it), runs through an Anime4K CNN chain and is drawn onto a canvas.
//
// Phones and tablets get chains built for their GPUs: the networks run on a 720p frame (Anime4K is made
// for 720p/1080p sources; a tablet screen shows little difference) and output at most 1440p.
// Everywhere, a frame the GPU hasn't finished is never queued behind: it is skipped, and when frames
// keep being skipped the chain steps down one level by itself, so the picture never lags behind the sound.
import type { Anime4KPipeline } from 'anime4k-webgpu'
import { isIOS } from './platform'

export type UpscaleMode = 'off' | 'fast' | 'quality' | 'max'

export const UPSCALE_MODES: { id: UpscaleMode; label: string; hint: string }[] = [
  { id: 'off', label: 'Выкл', hint: 'Обычное видео' },
  { id: 'fast', label: 'Быстрый', hint: 'Лёгкая нейросеть, для слабых видеокарт' },
  { id: 'quality', label: 'Качество', hint: 'Anime4K Mode A: чище линии, меньше мыла' },
  { id: 'max', label: 'Максимум', hint: 'Anime4K Mode A+A: лучшая картинка, нужна мощная видеокарта' },
]

// WebGPU can be present while the GPU itself is refused (common on cheap Android tablets with old Mali chips):
// only a real adapter counts, asked once in the background
let capable: boolean | null = null
const hasApi = typeof navigator !== 'undefined' && 'gpu' in navigator
if (hasApi) {
  navigator.gpu
    .requestAdapter()
    .then((a) => (capable = !!a))
    .catch(() => (capable = false))
}
export const upscaleSupported = () => hasApi && capable !== false

const mobile = isIOS || /Android/i.test(navigator.userAgent)

type Lib = typeof import('anime4k-webgpu')
type Stage = 'clamp' | 'restoreM' | 'restoreVL' | 'x2M' | 'x2VL' | 'modeA' | 'modeAA'
/** one rung of the ladder: the networks, and the tallest frame they get fed */
interface Level {
  stages: Stage[]
  input: number
}

// best first; a level that can't keep up gives way to the next one
const LADDER: Record<'desktop' | 'mobile', Record<Exclude<UpscaleMode, 'off'>, Level[]>> = {
  desktop: {
    max: [{ stages: ['modeAA'], input: 2160 }, { stages: ['modeA'], input: 2160 }, { stages: ['restoreM', 'x2M'], input: 1080 }, { stages: ['restoreM', 'x2M'], input: 720 }],
    quality: [{ stages: ['modeA'], input: 2160 }, { stages: ['restoreM', 'x2M'], input: 1080 }, { stages: ['restoreM', 'x2M'], input: 720 }],
    fast: [{ stages: ['restoreM', 'x2M'], input: 2160 }, { stages: ['restoreM', 'x2M'], input: 720 }, { stages: ['restoreM'], input: 720 }],
  },
  mobile: {
    // Mode A's very large networks on a 720p frame: the full look at well under half the work
    max: [{ stages: ['clamp', 'restoreVL', 'x2VL'], input: 720 }, { stages: ['clamp', 'restoreVL', 'x2M'], input: 720 }, { stages: ['restoreM', 'x2M'], input: 720 }, { stages: ['restoreM', 'x2M'], input: 540 }],
    quality: [{ stages: ['clamp', 'restoreVL', 'x2M'], input: 720 }, { stages: ['restoreM', 'x2M'], input: 720 }, { stages: ['restoreM', 'x2M'], input: 540 }],
    fast: [{ stages: ['restoreM', 'x2M'], input: 720 }, { stages: ['restoreM', 'x2M'], input: 540 }, { stages: ['restoreM'], input: 540 }],
  },
}

// fullscreen triangle; the fragment either copies a texture or reads the decoder's frame directly
const VERTEX = /* wgsl */ `
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let p = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var o: V;
  o.pos = vec4f(p[i], 0, 1);
  o.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
  return o;
}`
const BLIT = /* wgsl */ `${VERTEX}
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@fragment fn fs(v: V) -> @location(0) vec4f { return vec4f(textureSample(tex, samp, v.uv).rgb, 1); }`
const INGEST = /* wgsl */ `${VERTEX}
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_external;
@fragment fn fs(v: V) -> @location(0) vec4f { return vec4f(textureSampleBaseClampToEdge(tex, samp, v.uv).rgb, 1); }`

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

function chainFor(lib: Lib, device: GPUDevice, input: GPUTexture, stages: Stage[], target: { width: number; height: number }) {
  const chain: Anime4KPipeline[] = []
  let tex = input
  let w = input.width
  let h = input.height
  const native = { width: w, height: h }
  for (const s of stages) {
    // doubling only pays off when the screen has more pixels than the frame
    if ((s === 'x2M' || s === 'x2VL') && !(target.width > w * 1.2)) continue
    const p =
      s === 'clamp' ? new lib.ClampHighlights({ device, inputTexture: tex })
      : s === 'restoreM' ? new lib.CNNM({ device, inputTexture: tex })
      : s === 'restoreVL' ? new lib.CNNVL({ device, inputTexture: tex })
      : s === 'x2M' ? new lib.CNNx2M({ device, inputTexture: tex })
      : s === 'x2VL' ? new lib.CNNx2VL({ device, inputTexture: tex })
      : s === 'modeA' ? new lib.ModeA({ device, inputTexture: tex, nativeDimensions: native, targetDimensions: target })
      : new lib.ModeAA({ device, inputTexture: tex, nativeDimensions: native, targetDimensions: target })
    chain.push(p)
    tex = p.getOutputTexture()
    w = tex.width
    h = tex.height
  }
  return chain
}

/** starts drawing `video` onto `canvas`; rebuilds itself when the source or screen size changes */
export async function startUpscale(video: HTMLVideoElement, canvas: HTMLCanvasElement, mode: Exclude<UpscaleMode, 'off'>, onError: (e: Error) => void): Promise<Upscaler> {
  const [lib, device] = await Promise.all([import('anime4k-webgpu'), getDevice()])
  const ctx = canvas.getContext('webgpu')
  if (!ctx) throw new Error('WebGPU canvas недоступен')
  const format = navigator.gpu.getPreferredCanvasFormat()
  ctx.configure({ device, format, alphaMode: 'opaque' })

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const pipeline = (code: string, target: GPUTextureFormat) => {
    const module = device.createShaderModule({ code })
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: target }] },
      primitive: { topology: 'triangle-list' },
    })
  }
  const blit = pipeline(BLIT, format)
  const toInput = pipeline(BLIT, 'rgba16float')
  // WebGPU reports bad shaders asynchronously, so the async form is what tells whether external textures work
  let ingest: GPURenderPipeline | null = null
  try {
    const module = device.createShaderModule({ code: INGEST })
    ingest = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    })
  } catch {
    /* no external textures: frames are copied instead */
  }

  const ladder = LADDER[mobile ? 'mobile' : 'desktop'][mode]
  let level = 0
  let stopped = false
  let frameHandle = 0
  type Built = {
    key: string
    raw: GPUTexture | null // the decoded frame at its own size, when it has to be copied first
    rawBind: GPUBindGroup | null
    input: GPUTexture
    chain: Anime4KPipeline[]
    bind: GPUBindGroup
    th: number
  }
  let built: Built | null = null

  // the canvas covers the video's letterboxed area in physical pixels: up to 4K, or 1440p on a phone or tablet
  const target = () => {
    const box = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    let w = Math.round(box.width * dpr)
    let h = Math.round(box.height * dpr)
    const k = mobile ? Math.min(1, 2560 / w, 1440 / h) : Math.min(1, 3840 / w, 2160 / h)
    w = Math.max(2, Math.round(w * k))
    h = Math.max(2, Math.round(h * k))
    return { w, h }
  }

  const destroy = (b: Built | null) => {
    b?.raw?.destroy()
    b?.input.destroy()
  }

  const build = () => {
    const vw = video.videoWidth
    const vh = video.videoHeight
    const t = target()
    const step = ladder[level]
    const k = Math.min(1, step.input / vh)
    const iw = Math.max(2, Math.round(vw * k))
    const ih = Math.max(2, Math.round(vh * k))
    const key = `${vw}x${vh}>${iw}x${ih}>${t.w}x${t.h}#${level}:${!!ingest}`
    if (built?.key === key) return built
    destroy(built)
    canvas.width = t.w
    canvas.height = t.h
    const input = device.createTexture({
      size: [iw, ih, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    })
    // without external textures the frame is copied at full size, then scaled into the input
    let raw: GPUTexture | null = null
    let rawBind: GPUBindGroup | null = null
    if (!ingest && (iw !== vw || ih !== vh)) {
      raw = device.createTexture({
        size: [vw, vh, 1],
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      })
      rawBind = device.createBindGroup({ layout: toInput.getBindGroupLayout(0), entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: raw.createView() }] })
    }
    const chain = chainFor(lib, device, input, step.stages, { width: t.w, height: t.h })
    const out = chain.at(-1)?.getOutputTexture() ?? input
    const bind = device.createBindGroup({
      layout: blit.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: out.createView() },
      ],
    })
    built = { key, raw, rawBind, input, chain, bind, th: Math.min(t.h, out.height) }
    return built
  }

  const fill = (enc: GPUCommandEncoder, view: GPUTextureView, pipe: GPURenderPipeline, bind: GPUBindGroup) => {
    const pass = enc.beginRenderPass({ colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] })
    pass.setPipeline(pipe)
    pass.setBindGroup(0, bind)
    pass.draw(3)
    pass.end()
  }

  // frame pacing: one frame on the GPU at a time; skipped frames are counted to step down when it can't keep up
  let busy = false
  let frames = 0
  let skipped = 0
  let warmup = 30

  // A frame can only be read once the element holds one. Right after a source change, while HLS is still
  // buffering its first segment or mid-seek there is none, and reading it then throws
  // ("Failed to execute 'copyExternalImageToTexture'"). Those moments are skipped and the next decoded
  // frame is drawn; only a fault that keeps coming back while a real frame is there stops the upscaler.
  const ready = () => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0 && !video.seeking
  let faults = 0
  let extFaults = 0

  const draw = (): void => {
    if (stopped || !ready()) return
    if (busy) {
      skipped++
      return
    }
    try {
      const b = build()
      const enc = device.createCommandEncoder()
      if (ingest) {
        let external: GPUExternalTexture
        try {
          external = device.importExternalTexture({ source: video })
          extFaults = 0
        } catch {
          // a few misses in a row with a frame there: this browser can't read the decoder's frame
          // directly, so frames are copied from now on
          if (++extFaults >= 3) {
            ingest = null
            built = null
          }
          return
        }
        const bind = device.createBindGroup({ layout: ingest.getBindGroupLayout(0), entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: external }] })
        fill(enc, b.input.createView(), ingest, bind)
      } else if (b.raw) {
        device.queue.copyExternalImageToTexture({ source: video }, { texture: b.raw }, [b.raw.width, b.raw.height])
        fill(enc, b.input.createView(), toInput, b.rawBind!)
      } else {
        device.queue.copyExternalImageToTexture({ source: video }, { texture: b.input }, [b.input.width, b.input.height])
      }
      b.chain.forEach((p) => p.pass(enc))
      fill(enc, ctx.getCurrentTexture().createView(), blit, b.bind)
      device.queue.submit([enc.finish()])
      faults = 0
      busy = true
      void device.queue.onSubmittedWorkDone().then(() => (busy = false))
    } catch (e) {
      const err = e as Error
      // a video from a server that doesn't allow reading its pixels never becomes readable
      if (err.name === 'SecurityError') {
        stopped = true
        onError(new Error('этот источник не разрешает обработку кадров'))
        return
      }
      // a frame that wasn't ready yet: try the next one; a second of nothing but faults is a real problem
      if (++faults > 60) {
        stopped = true
        onError(err)
      }
    }
  }

  // the first frame of a new source or a finished seek is drawn as soon as it is there
  const kick = () => draw()
  video.addEventListener('loadeddata', kick)
  video.addEventListener('seeked', kick)
  video.addEventListener('canplay', kick)

  // requestVideoFrameCallback fires once per decoded frame, also after a seek while paused
  const loop = () => {
    draw()
    if (!video.paused && warmup-- <= 0 && ++frames >= 48) {
      // more than one frame in eight dropped over the last two seconds: one level lighter,
      // and when even the lightest can't keep up the device is too weak: plain video, no stutter
      if (skipped * 8 > frames) {
        if (level < ladder.length - 1) {
          level++
          warmup = 30
        } else {
          stopped = true
          onError(new Error('устройство не успевает, видео идёт без него'))
          return
        }
      }
      frames = 0
      skipped = 0
    }
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
      video.removeEventListener('loadeddata', kick)
      video.removeEventListener('seeked', kick)
      video.removeEventListener('canplay', kick)
      destroy(built)
      built = null
    },
    info: () => ({ from: video.videoHeight, to: built?.th ?? 0 }),
  }
}
