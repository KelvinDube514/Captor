# Parakeet Studio

A local-first recording studio with a React + Vite frontend and a FastAPI backend running NVIDIA NeMo's Parakeet model. Start capture explicitly or upload a meeting recording, then review the transcript and practice or debrief with an AI model.

## Requirements

- Node.js 20.19 or newer
- Python 3.10–3.12 for the NeMo/PyTorch stack
- Ollama for local document Q&A, or API credentials for Google Gemini/OpenAI
- Linux is the most reliable environment for NeMo. On Windows, use WSL2 with Ubuntu; native Windows installation may require dependency adjustments.
- Internet access for the first model download. The `nvidia/parakeet-tdt-0.6b-v2` weights load the first time you request a transcript.

CPU inference works but can be slow. GPU acceleration depends on installing a PyTorch build compatible with your CUDA setup.

## Start the backend

In a terminal, from the project root:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

For WSL2/Linux, create and activate the environment with `python3.12 -m venv .venv` and `source .venv/bin/activate` instead.

The first startup downloads the model and may take a while. The API reports readiness at `http://localhost:8000/api/health`.

## Ask questions about documents

Select **Ollama** for local inference and download a model, for example:

```powershell
ollama pull qwen2.5:3b
```

To use Google Gemini or OpenAI (ChatGPT), copy `backend/.env.example` to `backend/.env` and add the matching API key. Keys stay on the backend and are never sent to the browser. Restart FastAPI after changing `.env`.

Open **Documents + Q&A**, choose a provider, add one or more files, choose an available model, and ask a question. Ollama keeps processing local. Gemini and OpenAI receive the selected document excerpts and question; the original files remain on the backend. Supported formats are PDF, DOCX, TXT, Markdown, CSV, and JSON. Scanned PDFs need OCR before upload.

## Start the frontend

Open a second terminal at the project root:

```powershell
cd frontend
npm install
npm run dev
```

Open the URL Vite prints, usually `http://localhost:5173`. Vite forwards `/api` requests to the FastAPI server on port 8000.

## Studio

Open **Studio** and choose **Share a tab or screen** to use the browser's visible screen-share picker, or upload an exported recording. Start and stop are always user controlled; the app does not join calls, capture in the background without notice, or provide covert live interview answers. Enable tab or system audio in the share dialog. When capture stops, choose **Create transcript**. Copy or download the transcript, then use **Practice or debrief after the session** to ask the selected AI about it.

Supported recordings: WAV, MP3, M4A, FLAC, OGG, WEBM, MP4, MOV, MKV, MPEG, and MPGA. Maximum upload size: 1 GB. MP4/MOV/MKV/WEBM video captures use the bundled FFmpeg binary to extract audio before transcription. This is an exported/uploaded recording and review workflow, not a direct Teams/Zoom account integration or live meeting bot.

## Configuration

- `PARAKEET_MODEL`: model identifier (default: `nvidia/parakeet-tdt-0.6b-v2`)
- `OLLAMA_BASE_URL`: Ollama API URL (default: `http://127.0.0.1:11434`)
- `GEMINI_API_KEY`: Google AI Studio API key for Gemini models
- `OPENAI_API_KEY`: OpenAI API key for ChatGPT models
- `FRONTEND_ORIGINS`: comma-separated allowed browser origins (defaults to the local Vite URLs)
