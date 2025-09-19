import os
import uuid
import asyncio
import tempfile
import io

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydub import AudioSegment
import whisper
import numpy as np

from starlette.websockets import WebSocketState

# Load a better Whisper model for improved accuracy
model = whisper.load_model("small")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    session_id = str(uuid.uuid4())
    accumulated_audio_data = bytearray()
    chunk_count = 0
    last_transcription_length = 0

    try:
        while True:
            data = await ws.receive()
            
            if "text" in data:
                if data["text"] == "END":
                    # Process final accumulated audio
                    if len(accumulated_audio_data) > 1000:
                        try:
                            text = await process_complete_audio_stream(bytes(accumulated_audio_data), is_final=True)
                            if text and ws.client_state == WebSocketState.CONNECTED:
                                await ws.send_text(f"Final: {text}")
                        except Exception as e:
                            print(f"Error processing final audio: {e}")
                    break
                    
            elif "bytes" in data:
                chunk_count += 1
                chunk_size = len(data["bytes"])
                accumulated_audio_data.extend(data["bytes"])
                
                print(f"Received chunk {chunk_count}, size: {chunk_size} bytes, total: {len(accumulated_audio_data)} bytes")
                
                # Process the complete accumulated stream every ~15 seconds of audio
                # With 128kbps, 15 seconds ≈ 240KB
                if len(accumulated_audio_data) >= 240000 and chunk_count % 3 == 0:  # Every 3 chunks after reaching minimum size
                    try:
                        text = await process_complete_audio_stream(bytes(accumulated_audio_data), is_final=False)
                        
                        if text and len(text) > last_transcription_length:
                            # Only send new text (incremental transcription)
                            new_text = text[last_transcription_length:].strip()
                            if new_text and ws.client_state == WebSocketState.CONNECTED:
                                await ws.send_text(new_text)
                            last_transcription_length = len(text)
                        
                    except Exception as e:
                        print(f"Error processing accumulated audio: {e}")

    except WebSocketDisconnect:
        print(f"Client {session_id} disconnected")
    except Exception as e:
        print(f"Unexpected error in websocket_endpoint: {e}")
    finally:
        if ws.client_state == WebSocketState.CONNECTED:
            try:
                await ws.close()
            except Exception as e:
                print(f"Error closing websocket: {e}")


async def process_complete_audio_stream(audio_bytes: bytes, is_final: bool = False) -> str:
    """Process the complete accumulated audio stream as one WebM file"""
    if len(audio_bytes) < 1000:
        return ""
    
    tmp_webm_path = None
    tmp_wav_path = None
    
    try:
        # Save the complete accumulated audio as a WebM file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp_webm:
            tmp_webm.write(audio_bytes)
            tmp_webm_path = tmp_webm.name
        
        print(f"Processing complete audio stream: {len(audio_bytes)} bytes")
        
        try:
            # Load the complete WebM file
            audio = AudioSegment.from_file(tmp_webm_path, format="webm")
            
            print(f"Successfully loaded WebM: {len(audio)}ms duration")
            
            # Improve audio quality for transcription
            audio = audio.normalize()
            audio = audio.set_channels(1).set_frame_rate(16000)
            
            # Remove silence at start/end
            audio = audio.strip_silence(silence_len=300, silence_thresh=-40)
            
            if len(audio) < 1000:  # Less than 1 second
                print("Audio too short after processing")
                return ""
            
            # Export to WAV
            tmp_wav_path = tmp_webm_path.replace(".webm", ".wav")
            audio.export(tmp_wav_path, format="wav", parameters=["-ac", "1", "-ar", "16000"])
            
            # Run Whisper with optimal settings
            loop = asyncio.get_event_loop()
            
            whisper_options = {
                "language": "en",
                "task": "transcribe",
                "fp16": False,
                "temperature": 0,
                "best_of": 1,
                "beam_size": 1,
                "patience": 1.0,
                "length_penalty": 1.0,
                "suppress_tokens": "-1",
                "condition_on_previous_text": True,
                "compression_ratio_threshold": 2.4,
                "logprob_threshold": -1.0,
                "no_speech_threshold": 0.6,
            }
            
            result = await loop.run_in_executor(
                None, 
                lambda: model.transcribe(tmp_wav_path, **whisper_options)
            )
            
            text = result.get("text", "").strip()
            
            if text:
                # Calculate average confidence if available
                if "segments" in result and result["segments"]:
                    confidences = []
                    for seg in result["segments"]:
                        if "no_speech_prob" in seg:
                            confidences.append(1 - seg["no_speech_prob"])
                    
                    if confidences:
                        avg_confidence = sum(confidences) / len(confidences)
                        print(f"Transcription confidence: {avg_confidence:.2f}")
                
                print(f"Transcribed: '{text}'")
            
            return text
            
        except Exception as e:
            print(f"Error processing WebM file: {e}")
            return ""
            
    except Exception as e:
        print(f"Error in process_complete_audio_stream: {e}")
        return ""
    finally:
        # Clean up temporary files
        try:
            if tmp_webm_path and os.path.exists(tmp_webm_path):
                os.remove(tmp_webm_path)
            if tmp_wav_path and os.path.exists(tmp_wav_path):
                os.remove(tmp_wav_path)
        except Exception as e:
            print(f"Error cleaning up temp files: {e}")


@app.get("/")
async def root():
    return {"status": "ok"}