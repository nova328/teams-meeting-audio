#!/bin/bash
# PulseAudio Virtual Audio Setup for Meeting Audio Bridge
# Creates sinks at 24000 Hz to match OpenAI Realtime / ElevenLabs

# Stop any existing instances
pulseaudio -k 2>/dev/null || true
sleep 1
pulseaudio --start
sleep 1

# Virtual mic for TTS output (your voice → meeting)
# Using s16le format at 24000 Hz to match the bridge
pactl load-module module-null-sink \
  sink_name=VirtualMic \
  sink_properties=device.description="VirtualMic" \
  rate=24000 \
  format=s16le \
  channels=2

# Virtual source to expose the VirtualMic monitor as a selectable microphone
pactl load-module module-virtual-source \
  source_name=VirtualMicSource \
  master=VirtualMic.monitor \
  source_properties=device.description="Virtual_Microphone" \
  rate=24000 \
  format=s16le

# Meeting output capture (meeting audio → transcription)
pactl load-module module-null-sink \
  sink_name=meeting-output \
  sink_properties=device.description="MeetingOutput" \
  rate=24000 \
  format=s16le \
  channels=2

# Set the virtual source as default (so Meet can find it)
pactl set-default-source VirtualMicSource

echo "✅ PulseAudio configured:"
echo "   VirtualMic: 24000 Hz s16le (TTS output)"
echo "   VirtualMicSource: 24000 Hz s16le (Mic input for Meet)"
echo "   meeting-output: 24000 Hz s16le (Meet audio capture)"
