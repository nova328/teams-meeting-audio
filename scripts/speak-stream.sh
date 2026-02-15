#!/bin/bash
# Fast ElevenLabs TTS - download and play in parallel
# Usage: speak-stream.sh "Hello, this is Claw"

TEXT="$1"
DEVICE="${2:-VirtualMic}"

# ElevenLabs config
API_KEY="${ELEVENLABS_API_KEY:?ELEVENLABS_API_KEY env var required}"
VOICE_ID="${ELEVENLABS_VOICE_ID:-cgSgspJ2msm6clMCkdW9}"
MODEL_ID="${ELEVENLABS_MODEL_ID:-eleven_turbo_v2_5}"

if [ -z "$TEXT" ]; then
  echo "Usage: speak-stream.sh <text> [device]"
  exit 1
fi

TMPFILE="/tmp/tts-stream-$$.mp3"

# Download audio
curl -sS "https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream" \
  -H "xi-api-key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"text\": \"${TEXT}\",
    \"model_id\": \"${MODEL_ID}\",
    \"voice_settings\": {
      \"stability\": 0.3,
      \"similarity_boost\": 0.7,
      \"style\": 0.6
    }
  }" -o "$TMPFILE"

# Play to virtual mic
paplay --device="$DEVICE" "$TMPFILE"

# Cleanup
rm -f "$TMPFILE"
