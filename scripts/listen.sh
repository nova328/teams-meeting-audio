#!/bin/bash
# Record meeting audio and transcribe with Whisper
# Usage: listen.sh [seconds] [output.txt]

SECONDS="${1:-5}"
OUTPUT="${2:-/tmp/meeting-transcript.txt}"
AUDIO_FILE="/tmp/meeting-audio-$$.wav"
WHISPER_SCRIPT="/home/openclaw/.npm-global/lib/node_modules/openclaw/skills/openai-whisper-api/scripts/transcribe.sh"

echo "🎧 Recording for $SECONDS seconds..."

# Record from meeting output
parecord --device=meeting-output.monitor --file-format=wav "$AUDIO_FILE" &
PID=$!
sleep "$SECONDS"
kill $PID 2>/dev/null
wait $PID 2>/dev/null

# Transcribe
echo "📝 Transcribing..."
bash "$WHISPER_SCRIPT" "$AUDIO_FILE" --out "$OUTPUT" 2>/dev/null

# Output result
TRANSCRIPT=$(cat "$OUTPUT" 2>/dev/null)
echo "Transcript: $TRANSCRIPT"

# Cleanup
rm -f "$AUDIO_FILE"

echo "$TRANSCRIPT"
