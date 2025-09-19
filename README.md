# Subtitle-Streaming (WebSockets + Whisper)

An project for exploring WebSockets by streaming microphone audio from the browser to a FastAPI backend that runs OpenAI Whisper for live transcription. Captions are rendered in real time in the browser.

- Frontend: [frontend/index.html](frontend/index.html), [frontend/app.js](frontend/app.js), [frontend/style.css](frontend/style.css)
- Backend: [backend/main.py](backend/main.py), [backend/requirements.txt](backend/requirements.txt)

## Why
Built for learning and exploring WebSockets end-to-end:
- Sending binary audio data from the browser via WebSockets
- Accumulating and processing audio server-side
- Returning incremental and final transcriptions
- Handling real-time UI updates and UX states on the client

## Features
- Live microphone capture with `MediaRecorder`
- WebSocket streaming to FastAPI at `ws://localhost:8000/ws`
- Incremental transcription and final summary on stop
- Whisper model configurable (default: `"small"`)
- Simple, accessible UI with keyboard shortcuts (Ctrl+Space / Space / Esc)

## How it works
- Frontend ([frontend/app.js](frontend/app.js)):
  - Captures audio, encodes to WebM/Opus, sends ArrayBuffer chunks over WS.
  - Displays server messages as live captions; handles a special `Final: ...` message on stop.
- Backend ([backend/main.py](backend/main.py)):
  - WebSocket endpoint [`websocket_endpoint`](backend/main.py) accumulates bytes and periodically processes the complete stream with [`process_complete_audio_stream`](backend/main.py).
  - Converts WebM → WAV (16kHz mono) using pydub/ffmpeg, then transcribes with Whisper.
  - Sends incremental text during recording and a final transcription on `"END"`.

## Prerequisites
- Python 3.10+ (Python 3.13 works with `audioop-lts`)
- ffmpeg (required by pydub/whisper for audio decoding)
- A modern browser (MediaRecorder + getUserMedia support)
- Optional: Node.js (only if you prefer a static server other than Python)

Install ffmpeg:
- macOS (brew): `brew install ffmpeg`
- Ubuntu/Debian: `sudo apt-get install ffmpeg`
- Windows: Install from ffmpeg.org and add to PATH

## Setup

### 1) Backend
```sh
# from project root: WebSockets/Subtitle-Streaming
python -m venv backend/venv
# Linux/Mac
source backend/venv/bin/activate
# Windows
# backend\venv\Scripts\activate

pip install -r backend/requirements.txt

# Start the API & WebSocket server on :8000
# From project root:
uvicorn backend.main:app --reload
# or from backend/ directory:
# uvicorn main:app --reload
```

### 2) Frontend (serve over localhost)
getUserMedia typically requires a secure context (https) or localhost.

Option A (Python):
```sh
# from the frontend/ directory
python -m http.server 5500
# open http://localhost:5500
```

Option B (Node serve):
```sh
# from the project root or frontend/
npx serve -l 5500 frontend
# open http://localhost:5500
```

## Usage
1. Start the backend (port 8000).
2. Serve the frontend (e.g., http://localhost:5500).
3. Open the app in your browser, click “Start”, and allow microphone access.
4. Speak and watch captions appear. Click “Stop” to send the final transcription.

Keyboard shortcuts:
- Ctrl+Space or Space: Toggle start/stop
- Esc: Stop

## Configuration
- Whisper model size (accuracy vs speed): edit in [backend/main.py](backend/main.py)
  ```py
  model = whisper.load_model("small")  # options: tiny, base, small, medium, large
  ```
- WebSocket URL (client → server): edit in [frontend/app.js](frontend/app.js)
  ```js
  ws = new WebSocket("ws://localhost:8000/ws");
  ```
- Chunk size (ms) sent by MediaRecorder: [frontend/app.js](frontend/app.js)
  ```js
  mediaRecorder.start(3000); // 3s chunks
  ```

## Project Structure
- Backend: FastAPI app, WebSocket at `/ws`, Whisper transcription
  - [`websocket_endpoint`](backend/main.py)
  - [`process_complete_audio_stream`](backend/main.py)
  - [`root`](backend/main.py)
- Frontend: Static HTML/CSS/JS UI with status and caption area

## Troubleshooting
- ffmpeg not found: Install and ensure it’s on PATH.
- Mic permission denied: Check browser permissions and use localhost (not file://).
- Connection refused: Ensure backend is running on port 8000 and not blocked by a firewall.
- High CPU/slow: Use a smaller Whisper model (`"tiny"` or `"base"`).
- WebM decode errors: Confirm ffmpeg is installed; try different browsers.

## Notes
- For learning and exploration of WebSockets and real-time media processing.
- Not production-hardened; no auth, rate limits, or storage.

## Acknowledgements
- FastAPI, Starlette
- OpenAI Whisper
- pydub /