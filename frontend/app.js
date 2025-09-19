let mediaRecorder;
let ws;
let isRecording = false;
let stream;
let recordingStartTime;

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const captionsDiv = document.getElementById('captions');

// Create status area if it doesn't exist
let statusDiv = document.getElementById('status');
if (!statusDiv) {
  statusDiv = document.createElement('div');
  statusDiv.id = 'status';
  statusDiv.className = 'status-area';
  document.querySelector('.output').insertBefore(statusDiv, captionsDiv);
}

startBtn.onclick = async () => {
  try {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    captionsDiv.textContent = "";
    statusDiv.textContent = "Starting...";

    // Open WebSocket
    ws = new WebSocket("ws://localhost:8000/ws");

    ws.onmessage = (event) => {
      const message = event.data;
      
      // Handle different types of messages
      if (message.startsWith("Final: ")) {
        const finalText = message.substring(7).trim();
        if (finalText) {
          captionsDiv.textContent += finalText + " ";
        }
      } else {
        // Regular transcription
        const cleanText = message.trim();
        if (cleanText) {
          captionsDiv.textContent += cleanText + " ";
        }
      }
      
      console.log("Received caption:", message);
      
      // Auto-scroll to bottom
      captionsDiv.scrollTop = captionsDiv.scrollHeight;
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      statusDiv.textContent = "Connection Error";
      statusDiv.className = 'status-area error';
    };

    ws.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      statusDiv.textContent = "Disconnected";
      statusDiv.className = 'status-area';
      cleanup();
    };

    ws.onopen = async () => {
      try {
        // Get high-quality audio stream
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            channelCount: 1,
            sampleRate: 48000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            googEchoCancellation: true,
            googAutoGainControl: true,
            googNoiseSuppression: true,
            googHighpassFilter: true,
            googTypingNoiseDetection: true
          } 
        });

        // Find the best supported format
        const supportedTypes = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/mp4;codecs=mp4a.40.2',
          'audio/ogg;codecs=opus'
        ];

        let selectedType = '';
        for (const type of supportedTypes) {
          if (MediaRecorder.isTypeSupported(type)) {
            selectedType = type;
            break;
          }
        }

        console.log('Using MIME type:', selectedType || 'browser default');

        // Configure MediaRecorder for optimal quality
        const options = {
          ...(selectedType && { mimeType: selectedType }),
          audioBitsPerSecond: 128000, // High quality bitrate
        };

        mediaRecorder = new MediaRecorder(stream, options);
        
        let chunkCount = 0;
        let totalDataSent = 0;

        // Send data more frequently for better real-time experience
        mediaRecorder.ondataavailable = async (e) => {
          if (e.data.size > 0 && ws && ws.readyState === WebSocket.OPEN) {
            try {
              chunkCount++;
              totalDataSent += e.data.size;
              
              const elapsedTime = ((Date.now() - recordingStartTime) / 1000).toFixed(1);
              console.log(`Sending chunk ${chunkCount}: ${e.data.size} bytes (${elapsedTime}s elapsed, ${totalDataSent} total)`);
              
              const arrayBuffer = await e.data.arrayBuffer();
              ws.send(arrayBuffer);
              
              // Log status without affecting captions display
              if (chunkCount === 1) {
                console.log("Processing first audio chunk...");
              } else if (chunkCount % 3 === 0) {
                console.log(`Processing chunk ${chunkCount}...`);
              }
              
            } catch (error) {
              console.error('Error sending audio data:', error);
            }
          } else {
            console.log(`Skipping chunk: size=${e.data.size}, ws_state=${ws?.readyState}`);
          }
        };

        mediaRecorder.onstop = () => {
          console.log('MediaRecorder stopped');
          if (stream) {
            stream.getTracks().forEach(track => track.stop());
          }
        };

        mediaRecorder.onerror = (error) => {
          console.error('MediaRecorder error:', error);
          statusDiv.textContent = "Recording Error";
          statusDiv.className = 'status-area error';
        };

        mediaRecorder.onstart = () => {
          console.log('MediaRecorder started');
          recordingStartTime = Date.now();
          statusDiv.textContent = "🎤 Recording...";
          statusDiv.className = 'status-area recording';
          captionsDiv.textContent = ""; // Clear any previous captions
          
          // Visual indication of recording
          document.body.classList.add('recording');
        };

        // Start recording with optimized chunk size
        // 3000ms chunks provide good balance of real-time response and processing efficiency
        mediaRecorder.start(3000);
        isRecording = true;
        
      } catch (error) {
        console.error('Error starting recording:', error);
        statusDiv.textContent = "Microphone Access Error";
        statusDiv.className = 'status-area error';
        cleanup();
      }
    };
  } catch (error) {
    console.error('Error initializing:', error);
    statusDiv.textContent = "Initialization Error";
    statusDiv.className = 'status-area error';
    cleanup();
  }
};

stopBtn.onclick = () => {
  statusDiv.textContent = "Stopping...";
  statusDiv.className = 'status-area';
  cleanup();
};

function cleanup() {
  // Reset UI
  document.body.classList.remove('recording');
  statusDiv.textContent = "Stopped";
  statusDiv.className = 'status-area';
  
  if (mediaRecorder && isRecording) {
    try {
      mediaRecorder.stop();
      console.log('Stopping MediaRecorder...');
    } catch (error) {
      console.error('Error stopping recorder:', error);
    }
    isRecording = false;
  }

  if (stream) {
    try {
      stream.getTracks().forEach(track => {
        track.stop();
        console.log(`Stopped ${track.kind} track`);
      });
    } catch (error) {
      console.error('Error stopping stream:', error);
    }
    stream = null;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      console.log('Sending END signal to server');
      ws.send("END");
      
      // Give server time to process final audio
      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      }, 500);
    } catch (error) {
      console.error('Error closing WebSocket:', error);
    }
  }
  
  ws = null;
  startBtn.disabled = false;
  stopBtn.disabled = true;
}

// Enhanced cleanup on page unload
window.addEventListener('beforeunload', (e) => {
  if (isRecording) {
    cleanup();
    // Optional: Show warning when leaving during recording
    e.preventDefault();
    e.returnValue = '';
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Ctrl+Space or Space (when not in input field) to toggle recording
  if ((e.code === 'Space' && e.ctrlKey) || 
      (e.code === 'Space' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA')) {
    e.preventDefault();
    if (!isRecording) {
      startBtn.click();
    } else {
      stopBtn.click();
    }
  }
  
  // Escape to stop recording
  if (e.code === 'Escape' && isRecording) {
    stopBtn.click();
  }
});

// Show recording stats
function showStats() {
  if (isRecording && recordingStartTime) {
    const elapsed = ((Date.now() - recordingStartTime) / 1000).toFixed(1);
    document.title = `Recording... ${elapsed}s - Live Captions`;
  } else {
    document.title = 'Live Captions - WebSocket + Whisper';
  }
}

// Update stats every second
setInterval(showStats, 1000);

console.log('Live Caption Demo loaded.');
console.log('Controls: Ctrl+Space to start/stop, Space to toggle, Escape to stop');