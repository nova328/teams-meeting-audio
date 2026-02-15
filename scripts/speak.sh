#!/bin/bash
# Speak text to the meeting via TTS and VirtualMic
# Usage: speak.sh "Hello, this is Claw"

TEXT="$1"

if [ -z "$TEXT" ]; then
  echo "Usage: speak.sh <text>"
  exit 1
fi

# This script is a helper - actual TTS should be called via OpenClaw's tts tool
# Then play the resulting audio:
# paplay --device=VirtualMic /tmp/tts-xxx/voice-xxx.opus

echo "To speak in meeting:"
echo "1. Use OpenClaw tts tool to generate audio"
echo "2. Run: paplay --device=VirtualMic <audio-file>"
