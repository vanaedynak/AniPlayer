"""AniPlayer voice module: F5-TTS (Russian fine-tune) on the PC's GPU, served to the app on localhost.

GET  /health          -> {"ok": true, "device": "cuda", "voices": [...]}
POST /tts {text, voice, speed?} -> audio/wav

Voices are reference clips in <home>/voices: <name>.wav plus <name>.txt with what is said in it.
The model copies the timbre and manner of the clip, so every voice is just a short recording.
"""

import io
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("ANIPLAYER_VOICE_PORT", "47917"))
HOME = Path(os.environ.get("ANIPLAYER_VOICE_HOME", Path(__file__).resolve().parent))
MODELS = HOME / "models"
VOICES = HOME / "voices"

state = {"ready": False, "error": "", "device": ""}
lock = threading.Lock()
tts = None
accent = None


def load():
    global tts, accent
    try:
        import soundfile as sf
        import torch
        import torchaudio

        # torchaudio 2.9+ reads audio through torchcodec, which needs FFmpeg; the clips are plain WAV
        def load_wav(path, *a, **k):
            data, sr = sf.read(str(path), dtype="float32", always_2d=True)
            return torch.from_numpy(data.T.copy()), sr

        torchaudio.load = load_wav
        from f5_tts.api import F5TTS

        device = "cuda" if torch.cuda.is_available() else "cpu"
        ckpt = next(p for p in sorted(MODELS.glob("*.safetensors")))
        tts = F5TTS(model="F5TTS_v1_Base", ckpt_file=str(ckpt), vocab_file=str(MODELS / "vocab.txt"), device=device)
        try:
            # stress marks: the model reads "+" before the stressed vowel and reads far better with them
            import numpy as np
            import onnxruntime as ort

            # newer tokenizers leave out token_type_ids that ruaccent's models still ask for
            run = ort.InferenceSession.run

            def run_with_types(self, out, feed, *a, **k):
                if "input_ids" in feed and "token_type_ids" not in feed and any(i.name == "token_type_ids" for i in self.get_inputs()):
                    feed = {**feed, "token_type_ids": np.zeros_like(feed["input_ids"])}
                return run(self, out, feed, *a, **k)

            ort.InferenceSession.run = run_with_types
            from ruaccent import RUAccent

            accent = RUAccent()
            accent.load(omograph_model_size="turbo3.1", use_dictionary=True, tiny_mode=False)
        except Exception as e:  # works without, just with a few wrong stresses
            print("[voice] no ruaccent:", e, flush=True)
        state.update(ready=True, device=device)
        print(f"[voice] ready on {device} with {ckpt.name}", flush=True)
    except Exception as e:
        state["error"] = str(e)
        print("[voice] failed:", e, flush=True)


def voices():
    return sorted(p.stem for p in VOICES.glob("*.wav") if p.with_suffix(".txt").exists())


def speak(text: str, voice: str, speed: float) -> bytes:
    import soundfile as sf

    ref = VOICES / f"{voice}.wav"
    if not ref.exists():
        raise ValueError(f"no voice {voice}")
    ref_text = ref.with_suffix(".txt").read_text(encoding="utf-8").strip()
    if accent is not None:
        text = accent.process_all(text)
    with lock:
        wav, sr, _ = tts.infer(ref_file=str(ref), ref_text=ref_text, gen_text=text, speed=speed, nfe_step=32, remove_silence=False, show_info=lambda *a: None)
    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        # Chromium asks before a public page talks to localhost
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def reply(self, code, body: bytes, kind="application/json"):
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.reply(204, b"")

    def do_GET(self):
        if self.path.startswith("/health"):
            self.reply(200, json.dumps({"ok": state["ready"], "error": state["error"], "device": state["device"], "voices": voices()}).encode())
        else:
            self.reply(404, b"{}")

    def do_POST(self):
        if not self.path.startswith("/tts"):
            return self.reply(404, b"{}")
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            if not state["ready"]:
                return self.reply(503, json.dumps({"error": state["error"] or "loading"}).encode())
            t = time.time()
            wav = speak(str(req["text"])[:2000], str(req.get("voice", "narrator")), float(req.get("speed", 1)))
            print(f"[voice] {len(req['text'])} chars in {time.time() - t:.1f}s", flush=True)
            self.reply(200, wav, "audio/wav")
        except Exception as e:
            self.reply(500, json.dumps({"error": str(e)}).encode())

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    threading.Thread(target=load, daemon=True).start()
    print(f"[voice] listening on 127.0.0.1:{PORT}", flush=True)
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except OSError as e:  # already running
        print("[voice]", e, flush=True)
        sys.exit(0)
