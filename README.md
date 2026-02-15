# Meeting Audio Bridge

Real-time AI participation in browser-based video meetings using headless Chrome, PulseAudio, and OpenAI Realtime API.

## Features

- **Platform-agnostic** — Teams, Zoom, Google Meet, WebEx, or any browser-based meeting
- **Real-time voice conversation** using OpenAI Realtime API with server-side VAD
- **ElevenLabs TTS** for consistent voice identity
- **Exa web search** — ask your agent to look things up mid-meeting
- **Notes & deferred tasks** — agent accepts scheduling/email requests and logs them to transcript for post-meeting execution
- **Voice-controlled meeting actions** — leave, mute, pause, resume via natural speech
- **One-command entry** via `join.sh`
- **~2-3 second latency** for natural conversation flow
- **Configurable persona** via `SYSTEM_PROMPT` env var (default: "Claw")

## Quick Start

```bash
# 1. Set environment variables
export OPENAI_API_KEY="sk-..."
export ELEVENLABS_API_KEY="..."
export EXA_API_KEY="..."              # Optional, for web search

# 2. Install dependencies
npm install

# 3. Join a meeting
./join.sh https://meet.google.com/abc-defg-hij
```

## Documentation

See [SKILL.md](./SKILL.md) for complete setup instructions, architecture, personalization, troubleshooting, and transcript retrieval.

## Bridge Options

| Script | Voice | Latency | Use Case |
|--------|-------|---------|----------|
| `realtime-hybrid.js` | ElevenLabs | ~2-3s | Consistent voice across channels ✓ Recommended |
| `realtime-bridge.js` | OpenAI native | ~500ms | Lowest latency |

## Requirements

- Ubuntu with PulseAudio
- Node.js 18+
- Google Chrome
- OpenAI API key
- ElevenLabs API key (for hybrid mode)
- Exa API key (optional, for web search)

## License

MIT
