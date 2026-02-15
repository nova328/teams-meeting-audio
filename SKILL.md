---
name: teams-meeting-audio
description: Join web meetings (Teams, Zoom, Google Meet, etc.) with real-time audio. AI speaks via TTS, listens via STT, and can perform web searches and meeting actions via voice commands.
---

# Meeting Audio Bridge

Real-time AI participation in browser-based video meetings using headless Chrome, PulseAudio virtual devices, and OpenAI Realtime API.

## Personalization

The default wake word and persona is **"Claw"**. To match your agent's identity:

1. **Replace "Claw"** with the name from your `SOUL.md` (e.g., if your agent is "Alice", users will say "Alice, look up X").
2. Set the `SYSTEM_PROMPT` env var to override the default prompt with your agent's personality and name.
3. Alternatively, edit the `SYSTEM_PROMPT` constant in `realtime-hybrid.js` directly.

The bridge's default prompt, tool descriptions, and transcript labels all use "Claw" as a placeholder. Swap it for your agent's name everywhere it appears.

## Platform Support

Works with any browser-based meeting platform:
- **Microsoft Teams** — Web app (teams.microsoft.com)
- **Zoom** — Browser client (zoom.us)
- **Google Meet** — Browser (meet.google.com)
- **WebEx, GoToMeeting, etc.** — Any web-based platform

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Meeting App   │────▶│ meeting-output   │────▶│ OpenAI Realtime │
│   (Chrome)      │     │   (capture)      │     │   (STT + VAD)   │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
        ▲                                                  │
        │                                                  ▼
┌───────┴─────────┐     ┌──────────────────┐     ┌─────────────────┐
│   VirtualMic    │◀────│   ElevenLabs     │◀────│   GPT-4o-mini   │
│   (playback)    │     │     (TTS)        │     │   (response)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Requirements

### System
- Ubuntu VPS (headless supported)
- PulseAudio (`sudo apt install pulseaudio pulseaudio-utils`)
- Node.js 18+ (`npm install ws` in skill directory)
- Chrome with audio flags (see `chrome-audio` wrapper script)

### Environment Variables (REQUIRED)

Set these before running:

```bash
export OPENAI_API_KEY="sk-..."
export ELEVENLABS_API_KEY="..."
export EXA_API_KEY="..."              # Optional, for web search
export ELEVENLABS_VOICE_ID="..."      # Optional, defaults to Jessica
export SYSTEM_PROMPT="..."            # Optional, override agent persona
export SAMPLE_RATE="24000"            # Optional, default 24000
export INPUT_DEVICE="meeting-output.monitor"   # Optional
export OUTPUT_DEVICE="VirtualMic"     # Optional
```

**DO NOT** commit these to the repo. Use `.env` files or your shell profile.

## Quick Start

### 1. Initial Setup (One-time)

```bash
# Create PulseAudio devices (run this after reboots)
./pa-setup.sh

# Create Chrome wrapper script (save to ~/.local/bin/chrome-audio)
# See "Chrome Wrapper Script" section below

# Configure OpenClaw to use the audio-enabled Chrome
openclaw config set browser.executablePath "$HOME/.local/bin/chrome-audio"
```

### 2. Chrome Wrapper Script

Create `~/.local/bin/chrome-audio`:

```bash
#!/bin/bash
exec /usr/bin/google-chrome \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --autoplay-policy=no-user-gesture-required \
  --disable-features=AudioServiceOutOfProcess \
  --use-fake-ui-for-media-stream \
  --alsa-input-device=pulse \
  --alsa-output-device=pulse \
  --user-data-dir=/tmp/chrome-meeting \
  --remote-debugging-port=18800 \
  "${@:-about:blank}"
```

Make executable: `chmod +x ~/.local/bin/chrome-audio`

**Why this is critical:** The `--headless=new` + PulseAudio flags allow Chrome to access virtual audio devices in a headless environment.

### 3. Join a Meeting

#### Option A: Automated (Recommended)

```bash
./join.sh https://meet.google.com/abc-defg-hij
```

This script:
- Verifies env vars
- Sets up PulseAudio devices
- Launches Chrome with the meeting URL
- Runs pre-flight audio checks
- Starts the bridge

#### Option B: Manual (for debugging)

```bash
# Step 1: Ensure PulseAudio is ready
./pa-setup.sh

# Step 2: Open meeting via OpenClaw browser tool
# (Browser control handles navigation, auto-join logic)
browser open --url "https://teams.microsoft.com/meet/..."

# Step 3: Start the bridge
node realtime-hybrid.js
```

### 4. In-Meeting Audio Routing

**CRITICAL:** Configure meeting device settings:

| Setting | Value | Why |
|---------|-------|-----|
| **Microphone** | Virtual_Microphone | Receives TTS output |
| **Speaker** | MeetingOutput | Captures incoming audio for STT |
| **Camera** | Off / None | We don't send video |

In **Teams**: Settings → Devices → Set Speaker to "MeetingOutput"
In **Google Meet**: Settings → Audio → Speaker → "MeetingOutput"
In **Zoom**: Settings → Audio → Speaker → "MeetingOutput"

## Voice Commands

The AI responds to its name followed by requests. Replace "Claw" with your agent's name from SOUL.md.

| Command | Action | Response |
|---------|--------|----------|
| "Claw, what's the weather?" | Query | Spoken answer |
| "Claw, search for..." | Web search (Exa) | Search results spoken |
| "Claw, note that..." | Note-taking | Acknowledges and echoes to transcript |
| "Claw, schedule a follow-up" | Deferred task | Accepts, logged for agent pickup |
| "Claw, send the summary" | Deferred task | Accepts, logged for agent pickup |
| "Claw, leave the meeting" | Exit call | "Okay, signing off!" → Leaves & stops bridge |
| "Claw, mute yourself" | Stop speaking | Silences TTS (still listens) |
| "Claw, unmute" | Resume speaking | Re-enables TTS |
| "Claw, stop listening" | Pause STT | Stops transcription |
| "Claw, start listening again" | Resume STT | Re-enables transcription |

### Deferred Tasks (Transcript-Driven)

The bridge does NOT have live access to calendars, email, or other tools. Instead:

1. User asks: *"Claw, schedule a meeting for Tuesday"*
2. Bridge responds: *"I'll set that up after the call."*
3. The request appears in the transcript (`📝 User:` / `🗣️ Claw:`)
4. After the meeting, the parent agent (OpenClaw) reviews the transcript and executes deferred tasks

This applies to: scheduling, email, reminders, calendar checks, file sharing, and any task requiring external tools.

The bridge **never refuses** these requests — it accepts them and defers to the agent.

## Scripts Reference

### `pa-setup.sh` — Audio Device Setup
Creates PulseAudio virtual sinks/sources at 24kHz for compatibility with OpenAI/ElevenLabs.

```bash
# Run after system reboot or if devices are missing
./pa-setup.sh
```

### `join.sh` — Automated Meeting Entry
One-command launcher that orchestrates the entire pipeline.

```bash
./join.sh <meeting-url>

# Skip audio setup (use if already configured)
./join.sh --quick <meeting-url>
```

### `realtime-hybrid.js` — Main Bridge
The AI brain. Handles:
- OpenAI Realtime API for speech detection
- GPT-4o-mini for response generation
- Exa search integration
- ElevenLabs TTS
- Voice command parsing

```bash
# Environment variables required
node realtime-hybrid.js
```

## Troubleshooting

### "No microphone detected" in meeting

Chrome can't see the virtual devices. Solutions:

```bash
# 1. Verify devices exist
pactl list sources short | grep Virtual

# 2. Restart PulseAudio
./pa-setup.sh

# 3. Restart Chrome (must launch AFTER devices exist)
pkill -f chrome-audio
./join.sh <url>  # Or use browser tool
```

### Audio flowing but no transcription

```bash
# Verify audio is actually reaching the sink
timeout 2 parec --device=meeting-output.monitor | wc -c
# Should show >0 bytes

# Check bridge logs for STT errors
process log --sessionId <id>
```

### TTS not playing in meeting

```bash
# Verify VirtualMic isn't suspended
pactl list sinks short
# Should show VirtualMic as IDLE or RUNNING, not SUSPENDED

# Test TTS manually
tts "Can you hear me?"
paplay --device=VirtualMic <tts-output-file>
```

### Exa search not working

```bash
# Verify key is set
echo $EXA_API_KEY

# Check bridge output for "EXA_API_KEY not set"
```

## Meeting Transcripts

After the meeting, retrieve the conversation:

```bash
# If bridge is still running
process log --sessionId <session-id> | grep -E "^📝|^🗣️"

# Or if you saved output
cat bridge.log | grep -E "^📝|^🗣️"
```

Format:
- `📝 User: "..."` — What was said to the meeting
- `🗣️ Claw: "..."` — AI responses
- `🔧 Tool call: ...` — Actions taken (search, leave, etc.)

## Chrome Audio Flags Explained

| Flag | Purpose |
|------|---------|
| `--use-fake-ui-for-media-stream` | Auto-grant mic/camera permissions without GUI |
| `--autoplay-policy=no-user-gesture-required` | Allow audio playback without user click |
| `--disable-features=AudioServiceOutOfProcess` | Keep audio in main process (headless reliability) |
| `--alsa-input-device=pulse` | Route mic through PulseAudio |
| `--alsa-output-device=pulse` | Route speaker through PulseAudio |
| `--headless=new` | Modern headless mode with full web audio support |

## Security Notes

- **Never commit API keys** to this repo. Use env vars or `.env` files ignored by git.
- The bridge emits `SIGNAL:*` to stdout for meeting controls. The parent agent (OpenClaw) must poll and execute these.
- Chrome runs in `--no-sandbox` mode for headless VPS compatibility. Acceptable for isolated meeting use, but don't browse untrusted sites.

## Development

To modify behavior:

1. **Response personality**: Set `SYSTEM_PROMPT` env var or edit the constant in `realtime-hybrid.js`. Replace "Claw" with your agent's name from SOUL.md.
2. **Voice**: Change `ELEVENLABS_VOICE_ID` env var or default in code.
3. **Search provider**: Currently Exa. To switch, replace `searchExa()` function.
4. **New commands**: Add to `MEETING_TOOLS` array and `handleToolCall()` function.

## Latency

Typical round-trip: **2-3 seconds**

| Component | Time |
|-----------|------|
| VAD detection | ~300ms |
| OpenAI transcription | ~500ms |
| GPT-4o-mini response | ~800ms |
| ElevenLabs TTS | ~600ms |
| Audio playback | ~200ms |

## Related

- **PulseAudio docs**: https://www.freedesktop.org/wiki/Software/PulseAudio/
- **OpenAI Realtime API**: https://platform.openai.com/docs/guides/realtime
- **ElevenLabs TTS**: https://elevenlabs.io/docs
