import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

APP_HOST = "127.0.0.1"
APP_PORT = int(os.environ.get("FUNASR_HTTP_PORT", "10096"))
MIN_AUDIO_BYTES = 1000

MODEL_NAME = os.environ.get("FUNASR_MODEL", "paraformer-zh")
VAD_MODEL_NAME = os.environ.get("FUNASR_VAD_MODEL", "fsmn-vad")
PUNC_MODEL_NAME = os.environ.get("FUNASR_PUNC_MODEL", "ct-punc")

app = FastAPI()
asr_model = None


def to_json_response(payload: dict, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        content=json.loads(json.dumps(payload, ensure_ascii=True)),
        status_code=status_code,
    )


def cleanup_file(path: Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except OSError:
        pass


def convert_to_wav(input_path: Path, output_path: Path) -> None:
    started_at = time.perf_counter()
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-ar",
            "16000",
            "-ac",
            "1",
            "-f",
            "wav",
            str(output_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    elapsed_ms = (time.perf_counter() - started_at) * 1000
    print(f"ffmpeg converted in {elapsed_ms:.0f} ms", flush=True)


@app.on_event("startup")
async def load_model() -> None:
    global asr_model
    print("FunASR package importing...", flush=True)
    from funasr import AutoModel

    print("FunASR model loading...", flush=True)
    asr_model = AutoModel(
        model=MODEL_NAME,
        vad_model=VAD_MODEL_NAME,
        punc_model=PUNC_MODEL_NAME,
        disable_update=True,
    )
    print("FunASR model ready.", flush=True)


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)) -> JSONResponse:
    global asr_model

    if asr_model is None:
        raise HTTPException(status_code=503, detail="FunASR model is not ready.")

    suffix = Path(audio.filename or "recording.webm").suffix or ".webm"
    temp_dir = Path(tempfile.mkdtemp(prefix="voice-map-asr-"))
    input_path = temp_dir / f"upload{suffix}"
    wav_path = temp_dir / "recording.wav"

    try:
        print("received audio", flush=True)
        with input_path.open("wb") as file_handle:
            shutil.copyfileobj(audio.file, file_handle)

        audio_size = input_path.stat().st_size
        if audio_size < MIN_AUDIO_BYTES:
            raise HTTPException(status_code=400, detail="Audio file is too small.")

        if input_path.suffix.lower() == ".wav":
            shutil.copyfile(input_path, wav_path)
        else:
            try:
                convert_to_wav(input_path, wav_path)
            except subprocess.CalledProcessError as error:
                raise HTTPException(
                    status_code=500,
                    detail=f"ffmpeg conversion failed: {(error.stderr or str(error)).strip()}",
                ) from error

        started_at = time.perf_counter()
        result = asr_model.generate(input=str(wav_path))
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        print(f"transcribed in {elapsed_ms:.0f} ms", flush=True)

        if not result:
            raise HTTPException(status_code=500, detail="FunASR returned an empty result.")

        first_item = result[0] if isinstance(result, list) else result
        if isinstance(first_item, dict):
            text = str(first_item.get("text", "")).strip()
        else:
            text = str(first_item).strip()

        if not text:
            raise HTTPException(status_code=500, detail="FunASR did not recognize any speech.")

        return to_json_response({"text": text})
    finally:
        cleanup_file(input_path)
        cleanup_file(wav_path)
        shutil.rmtree(temp_dir, ignore_errors=True)
        audio.file.close()


@app.exception_handler(HTTPException)
async def handle_http_exception(_request, error: HTTPException) -> JSONResponse:
    detail = error.detail if isinstance(error.detail, str) else "FunASR request failed."
    return to_json_response({"error": detail}, status_code=error.status_code)


@app.exception_handler(Exception)
async def handle_unexpected_exception(_request, error: Exception) -> JSONResponse:
    return to_json_response({"error": str(error)}, status_code=500)


if __name__ == "__main__":
    print(f"FunASR HTTP server starting on http://{APP_HOST}:{APP_PORT}", flush=True)
    uvicorn.run(app, host=APP_HOST, port=APP_PORT)
