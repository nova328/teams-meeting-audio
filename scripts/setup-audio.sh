#!/bin/bash
# Setup PulseAudio virtual devices for meeting audio
# Run once after PulseAudio starts

set -e

echo "🔊 Setting up virtual audio devices..."

# Create sink to receive TTS audio (Claw's voice to meeting)
pactl load-module module-null-sink \
  sink_name=VirtualMic \
  sink_properties=device.description="VirtualMic" || true

# Create virtual source (microphone) from that sink's monitor
pactl load-module module-virtual-source \
  source_name=VirtualMicSource \
  master=VirtualMic.monitor \
  source_properties=device.description="Virtual_Microphone" || true

# Set as default source so Chrome picks it up
pactl set-default-source VirtualMicSource

# Create sink for capturing meeting audio output
pactl load-module module-null-sink \
  sink_name=meeting-output \
  sink_properties=device.description="MeetingOutput" || true

echo "✅ Virtual audio devices created:"
echo ""
pactl list sinks short
echo ""
pactl list sources short
echo ""
echo "🎤 To speak: paplay --device=VirtualMic <audio.opus>"
echo "👂 To listen: parecord --device=meeting-output.monitor <output.wav>"
