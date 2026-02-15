#!/bin/bash
# join.sh - Launcher for AI Meeting Participation
# Usage: ./join.sh <meeting-url>

MEETING_URL="$1"

if [ -z "$MEETING_URL" ]; then
  echo "Usage: ./join.sh <meeting-url>"
  exit 1
fi

SKIP_SETUP=0
if [ "$1" == "--quick" ]; then
  SKIP_SETUP=1
  MEETING_URL="$2"
fi

echo "🚀 Launching AI Meeting Participant..."
echo "   Target: $MEETING_URL"

# 1. Environment Check
if [ -z "$OPENAI_API_KEY" ]; then echo "❌ OPENAI_API_KEY missing"; exit 1; fi
if [ -z "$ELEVENLABS_API_KEY" ]; then echo "❌ ELEVENLABS_API_KEY missing"; exit 1; fi
if [ -z "$EXA_API_KEY" ]; then 
  echo "⚠️ EXA_API_KEY missing - web search will fail"
  # Continue anyway, not critical for basic audio
fi

# 2. Audio Setup (PulseAudio)
if [ "$SKIP_SETUP" -eq 0 ]; then
  echo "🔊 Configuring PulseAudio devices..."
  ./pa-setup.sh > /dev/null 2>&1
  
  # Verify devices exist
  if ! pactl list sinks short | grep -q "VirtualMic"; then
    echo "❌ Failed to create VirtualMic sink"
    exit 1
  fi
  if ! pactl list sources short | grep -q "VirtualMicSource"; then
    echo "❌ Failed to create VirtualMicSource"
    exit 1
  fi

  # Set defaults and wake up devices
  pactl set-default-sink VirtualMic
  pactl set-default-source VirtualMicSource
  pactl set-sink-mute VirtualMic 0
  pactl set-source-mute VirtualMicSource 0
  echo "✅ Audio devices ready"
fi

# 3. Kill existing Chrome instances to ensure clean audio routing
echo "🧹 Cleaning up old browser sessions..."
pkill -f "chrome-audio" || true
sleep 1

# 4. Launch Headless Chrome
# Note: Using openclaw browser tool is preferred, but we launch here to ensure env vars propagate
echo "🌐 Launching Chrome..."
# The browser tool (puppeteer) will attach to this instance if running on port 18800
CHROME_BIN="${CHROME_AUDIO_BIN:-$HOME/.local/bin/chrome-audio}"
nohup "$CHROME_BIN" \
  --remote-debugging-port=18800 \
  --no-first-run \
  --no-default-browser-check \
  --use-fake-ui-for-media-stream \
  --autoplay-policy=no-user-gesture-required \
  --disable-features=AudioServiceOutOfProcess \
  "$MEETING_URL" > /dev/null 2>&1 &
CHROME_PID=$!
echo "✅ Chrome started (PID $CHROME_PID)"

# 5. Wait for Chrome to initialize
sleep 5

# 6. Pre-flight Audio Check (verify audio path)
echo "🎤 Pre-flight audio check..."
# Play a short silent blip to VirtualMic to ensure it's running
paplay --device=VirtualMic /usr/share/sounds/freedesktop/stereo/camera-shutter.oga 2>/dev/null || true

# 7. Start the Bridge
echo "bridge starting..."
# We run this in foreground so Ctrl+C kills it
node realtime-hybrid.js
