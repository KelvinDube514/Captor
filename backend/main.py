import asyncio
import re
import os
import subprocess
import tempfile
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool


load_dotenv(Path(__file__).with_name(".env"))

MODEL_NAME = os.getenv("PARAKEET_MODEL", "nvidia/parakeet-tdt-0.6b-v2")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
MAX_DOCUMENT_FILE_BYTES = 15 * 1024 * 1024
MAX_DOCUMENT_TOTAL_BYTES = 30 * 1024 * 1024
MAX_DOCUMENT_FILES = 8
MAX_DOCUMENT_TEXT_CHARS = 150_000
MAX_CONTEXT_CHARS = 24_000
ALLOWED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm", ".mp4", ".mov", ".mkv", ".mpeg", ".mpga"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}
ALLOWED_DOCUMENT_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".csv", ".json"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.asr_model = None
    app.state.model_lock = asyncio.Lock()
    yield
    app.state.asr_model = None


app = FastAPI(title="Parakeet Transcription API", lifespan=lifespan)
origins = [origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok", "model_loaded": getattr(app.state, "asr_model", None) is not None}


def get_transcript(model, audio_path: str) -> str:
    result = model.transcribe([audio_path])
    first_result = result[0] if isinstance(result, (list, tuple)) else result
    transcript = getattr(first_result, "text", first_result)
    return str(transcript).strip()


def load_asr_model():
    import torch
    from nemo.collections.asr.models import ASRModel

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Loading {MODEL_NAME} on {device}...")
    return ASRModel.from_pretrained(MODEL_NAME).to(device)


async def get_asr_model():
    model = app.state.asr_model
    if model is not None:
        return model

    async with app.state.model_lock:
        if app.state.asr_model is None:
            app.state.asr_model = await run_in_threadpool(load_asr_model)
            print("Parakeet model loaded.")
        return app.state.asr_model


def extract_document_text(filename: str, content: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(content))
        if len(reader.pages) > 500:
            raise HTTPException(status_code=413, detail=f"{filename} has too many pages (maximum 500).")
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    elif suffix == ".docx":
        from docx import Document

        document = Document(BytesIO(content))
        paragraphs = [paragraph.text for paragraph in document.paragraphs]
        paragraphs.extend(" | ".join(cell.text for cell in row.cells) for table in document.tables for row in table.rows)
        text = "\n".join(paragraphs)
    elif suffix in {".txt", ".md", ".csv", ".json"}:
        text = content.decode("utf-8-sig", errors="replace")
    else:
        raise HTTPException(status_code=415, detail=f"Unsupported document type: {suffix or 'unknown'}.")

    text = text.replace("\x00", "").strip()
    if not text:
        raise HTTPException(status_code=422, detail=f"No readable text found in {filename}. Scanned PDFs need OCR before upload.")
    return text[:MAX_DOCUMENT_TEXT_CHARS]


def build_document_context(documents: list[tuple[str, str]], question: str) -> str:
    terms = set(re.findall(r"[a-z0-9]{3,}", question.lower()))
    chunks = []
    for document_index, (filename, text) in enumerate(documents):
        normalized = re.sub(r"\s+", " ", text)
        for offset in range(0, len(normalized), 1200):
            content = normalized[offset:offset + 1200].strip()
            if content:
                score = sum(content.lower().count(term) for term in terms)
                chunks.append((score, document_index, filename, content))

    chunks.sort(key=lambda chunk: (-chunk[0], chunk[1]))
    selected = []
    total_chars = 0
    for _, _, filename, content in chunks:
        excerpt = f"[Source: {filename}]\n{content}"
        if total_chars + len(excerpt) > MAX_CONTEXT_CHARS:
            continue
        selected.append(excerpt)
        total_chars += len(excerpt)
        if total_chars >= MAX_CONTEXT_CHARS - 1200:
            break

    return "\n\n".join(selected)


@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported audio format. Upload WAV, MP3, M4A, FLAC, OGG, or WebM audio.")

    temp_path = None
    audio_path = None
    try:
        with tempfile.NamedTemporaryFile(prefix="parakeet-", suffix=suffix, delete=False) as temp_file:
            temp_path = temp_file.name
            size = 0
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Recording files must be smaller than 1 GB.")
                temp_file.write(chunk)

        if size == 0:
            raise HTTPException(status_code=400, detail="The uploaded audio file is empty.")

        audio_path = temp_path
        if suffix in VIDEO_EXTENSIONS:
            from imageio_ffmpeg import get_ffmpeg_exe

            with tempfile.NamedTemporaryFile(prefix="parakeet-audio-", suffix=".wav", delete=False) as audio_file:
                audio_path = audio_file.name
            try:
                await run_in_threadpool(
                    subprocess.run,
                    [get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", temp_path, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", audio_path],
                    check=True,
                    capture_output=True,
                    timeout=600,
                )
            except subprocess.TimeoutExpired as error:
                raise HTTPException(status_code=408, detail="Extracting audio from the video took too long.") from error
            except subprocess.CalledProcessError as error:
                message = error.stderr.decode(errors="replace").strip()[-500:]
                raise HTTPException(status_code=422, detail=f"Could not extract an audio track from this video. {message}") from error

        model = await get_asr_model()
        transcript = await run_in_threadpool(get_transcript, model, audio_path)
        return JSONResponse({"transcript": transcript})
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {error}") from error
    finally:
        await file.close()
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        if audio_path and audio_path != temp_path and os.path.exists(audio_path):
            os.remove(audio_path)


@app.get("/api/llm/models")
async def list_llm_models(provider: str = "ollama"):
    if provider not in {"ollama", "gemini", "openai"}:
        raise HTTPException(status_code=400, detail="Choose Ollama, Gemini, or OpenAI.")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            if provider == "ollama":
                response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
                models = [item["name"] for item in response.json().get("models", []) if item.get("name")]
            elif provider == "openai":
                if not OPENAI_API_KEY:
                    raise HTTPException(status_code=503, detail="Add OPENAI_API_KEY to backend/.env to use OpenAI models.")
                response = await client.get("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {OPENAI_API_KEY}"})
                models = [item["id"] for item in response.json().get("data", []) if item.get("id", "").startswith(("gpt-", "o1", "o3", "o4"))]
            else:
                if not GEMINI_API_KEY:
                    raise HTTPException(status_code=503, detail="Add GEMINI_API_KEY to backend/.env to use Gemini models.")
                response = await client.get("https://generativelanguage.googleapis.com/v1beta/models", headers={"x-goog-api-key": GEMINI_API_KEY})
                models = [item["name"] for item in response.json().get("models", []) if "generateContent" in item.get("supportedGenerationMethods", []) and item.get("name")]
            response.raise_for_status()
    except HTTPException:
        raise
    except httpx.TimeoutException as error:
        raise HTTPException(status_code=504, detail=f"Timed out while loading {provider} models.") from error
    except httpx.HTTPStatusError as error:
        raise HTTPException(status_code=502, detail=f"Could not load {provider} models. Check the API key and provider account.") from error
    except httpx.HTTPError as error:
        detail = "Ollama is unavailable. Start Ollama to use local models." if provider == "ollama" else f"Could not connect to {provider}."
        raise HTTPException(status_code=503, detail=detail) from error

    return {"provider": provider, "models": sorted(models)}


@app.post("/api/documents/ask")
async def ask_documents(
    question: str = Form(...),
    model: str = Form(...),
    provider: str = Form("ollama"),
    files: list[UploadFile] = File(...),
):
    question = question.strip()
    model = model.strip()
    if not question or len(question) > 4000:
        raise HTTPException(status_code=400, detail="Enter a question up to 4,000 characters.")
    if provider not in {"ollama", "gemini", "openai"}:
        raise HTTPException(status_code=400, detail="Choose Ollama, Gemini, or OpenAI.")
    if not model or len(model) > 160:
        raise HTTPException(status_code=400, detail="Choose a valid model.")
    model_pattern = r"models/[A-Za-z0-9._-]+" if provider == "gemini" else r"[A-Za-z0-9._:-]+" if provider == "openai" else r"[A-Za-z0-9._:/-]+"
    if not re.fullmatch(model_pattern, model):
        raise HTTPException(status_code=400, detail="The selected model name is invalid for this provider.")
    if not files or len(files) > MAX_DOCUMENT_FILES:
        raise HTTPException(status_code=400, detail=f"Upload between 1 and {MAX_DOCUMENT_FILES} documents.")

    documents = []
    total_size = 0
    try:
        for file in files:
            filename = Path(file.filename or "").name
            suffix = Path(filename).suffix.lower()
            if suffix not in ALLOWED_DOCUMENT_EXTENSIONS:
                raise HTTPException(status_code=415, detail=f"Unsupported document type for {filename or 'file'}.")

            content = await file.read(MAX_DOCUMENT_FILE_BYTES + 1)
            if len(content) > MAX_DOCUMENT_FILE_BYTES:
                raise HTTPException(status_code=413, detail=f"Each document must be smaller than 15 MB ({filename}).")
            total_size += len(content)
            if total_size > MAX_DOCUMENT_TOTAL_BYTES:
                raise HTTPException(status_code=413, detail="All documents combined must be smaller than 30 MB.")

            text = await run_in_threadpool(extract_document_text, filename, content)
            documents.append((filename, text))

        context = build_document_context(documents, question)
        if not context:
            raise HTTPException(status_code=422, detail="No text could be extracted from the uploaded documents.")

        system_prompt = "Answer the user's question using only the supplied document excerpts. If the answer is not supported by the excerpts, say so plainly. Cite supporting filenames in square brackets, such as [report.pdf]. Do not invent facts."
        user_prompt = f"Question: {question}\n\nDocument excerpts:\n{context}"
        async with httpx.AsyncClient(timeout=180) as client:
            if provider == "ollama":
                response = await client.post(
                    f"{OLLAMA_BASE_URL}/api/chat",
                    json={"model": model, "stream": False, "options": {"temperature": 0.2}, "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]},
                )
            elif provider == "openai":
                if not OPENAI_API_KEY:
                    raise HTTPException(status_code=503, detail="Add OPENAI_API_KEY to backend/.env to use OpenAI models.")
                response = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                    json={"model": model, "temperature": 0.2, "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]},
                )
            else:
                if not GEMINI_API_KEY:
                    raise HTTPException(status_code=503, detail="Add GEMINI_API_KEY to backend/.env to use Gemini models.")
                response = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/{model}:generateContent",
                    headers={"x-goog-api-key": GEMINI_API_KEY},
                    json={"systemInstruction": {"parts": [{"text": system_prompt}]}, "contents": [{"role": "user", "parts": [{"text": user_prompt}]}], "generationConfig": {"temperature": 0.2}},
                )
            response.raise_for_status()
    except HTTPException:
        raise
    except httpx.TimeoutException as error:
        raise HTTPException(status_code=504, detail="The local model took too long to answer. Try a smaller model or shorter question.") from error
    except httpx.HTTPStatusError as error:
        raise HTTPException(status_code=502, detail=f"{provider.title()} rejected the request (HTTP {error.response.status_code}). Check the API key, account limits, and selected model.") from error
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail=f"Could not connect to {provider.title()}. Check its service and network connection.") from error
    finally:
        for file in files:
            await file.close()

    response_data = response.json()
    if provider == "gemini":
        answer = "".join(part.get("text", "") for part in response_data.get("candidates", [{}])[0].get("content", {}).get("parts", [])).strip()
    elif provider == "openai":
        answer = response_data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    else:
        answer = response_data.get("message", {}).get("content", "").strip()
    if not answer:
        raise HTTPException(status_code=502, detail="The selected model returned an empty answer.")
    return {"answer": answer, "model": model, "provider": provider, "sources": [filename for filename, _ in documents]}
