#!/bin/bash
# Claw Meeting Conversation Daemon with VAD
# Listens with voice activity detection, transcribes, responds
# Usage: ./conversation-daemon.sh [input-device] [output-device]

INPUT_DEVICE="${1:-meeting-output.monitor}"
OUTPUT_DEVICE="${2:-VirtualMic}"
WHISPER_SCRIPT="/home/openclaw/.npm-global/lib/node_modules/openclaw/skills/openai-whisper-api/scripts/transcribe.sh"
ELEVENLABS_API_KEY="${ELEVENLABS_API_KEY:?ELEVENLABS_API_KEY env var required}"
ELEVENLABS_VOICE_ID="${ELEVENLABS_VOICE_ID:?ELEVENLABS_VOICE_ID env var required}"

# VAD params
MIN_SPEECH="0.3"        # Seconds of speech to start recording
SILENCE_DURATION="1.0"  # Seconds of silence to stop recording
THRESHOLD="1%"          # Audio level threshold
MAX_WAIT=60             # Max seconds to wait for speech

PIDFILE="/tmp/nova-meeting-daemon.pid"

cleanup() {
    echo "🛑 Daemon stopping..."
    rm -f "$PIDFILE"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo $$ > "$PIDFILE"

echo "🎙️ Claw VAD Conversation Daemon"
echo "   Input: $INPUT_DEVICE"
echo "   Output: $OUTPUT_DEVICE"
echo "   PID: $$"
echo ""

speak() {
    local text="$1"
    local tmpfile="/tmp/nova-tts-$$.mp3"
    
    curl -sS "https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream" \
        -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"text\": \"${text}\", \"model_id\": \"eleven_turbo_v2_5\"}" \
        -o "$tmpfile" 2>/dev/null
    
    paplay --device="$OUTPUT_DEVICE" "$tmpfile" 2>/dev/null
    rm -f "$tmpfile"
}

listen_vad() {
    local outfile="$1"
    
    timeout $MAX_WAIT bash -c "
        parecord --device='$INPUT_DEVICE' --raw --format=s16le --rate=16000 --channels=1 2>/dev/null | \
        sox -t raw -r 16000 -e signed -b 16 -c 1 - '$outfile' \
            silence 1 $MIN_SPEECH $THRESHOLD \
            1 $SILENCE_DURATION $THRESHOLD \
            2>/dev/null
    "
}

transcribe() {
    local audiofile="$1"
    local outfile="/tmp/nova-transcript-$$.txt"
    
    bash "$WHISPER_SCRIPT" "$audiofile" --out "$outfile" 2>/dev/null
    cat "$outfile" 2>/dev/null | tr -d '\n'
    rm -f "$outfile"
}

# Main loop
echo "🎧 Listening..."

while true; do
    AUDIO_FILE="/tmp/nova-vad-$$.wav"
    
    # Wait for speech with VAD
    listen_vad "$AUDIO_FILE"
    
    # Check if we got meaningful audio (>5KB)
    FILESIZE=$(stat -c%s "$AUDIO_FILE" 2>/dev/null || echo "0")
    if [ "$FILESIZE" -lt 5000 ]; then
        rm -f "$AUDIO_FILE"
        continue
    fi
    
    # Transcribe
    TRANSCRIPT=$(transcribe "$AUDIO_FILE")
    rm -f "$AUDIO_FILE"
    
    # Skip empty or noise
    if [ -z "$TRANSCRIPT" ] || [ "$TRANSCRIPT" = "you" ] || [ "$TRANSCRIPT" = "You" ]; then
        continue
    fi
    
    echo "👂 Heard: $TRANSCRIPT"
    echo "TRANSCRIPT:$TRANSCRIPT"
done
