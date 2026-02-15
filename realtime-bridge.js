#!/usr/bin/env node
/**
 * OpenAI Realtime API Bridge for Teams/Zoom Meetings
 * 
 * Captures audio from PulseAudio sink (meeting output), streams to OpenAI Realtime,
 * and plays responses back to virtual mic.
 * 
 * Usage: node realtime-bridge.js [--voice marin] [--instructions "Be helpful"]
 */

import WebSocket from 'ws';
import { spawn } from 'child_process';
import { Buffer } from 'buffer';

// Config
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = 'gpt-4o-realtime-preview';
const VOICE = process.argv.includes('--voice') 
  ? process.argv[process.argv.indexOf('--voice') + 1] 
  : 'marin';
const INSTRUCTIONS = process.argv.includes('--instructions')
  ? process.argv[process.argv.indexOf('--instructions') + 1]
  : (process.env.SYSTEM_PROMPT || 'You are an AI assistant in a meeting. Be concise and professional.');

// Audio config - OpenAI Realtime uses 24kHz mono PCM16
const SAMPLE_RATE = parseInt(process.env.SAMPLE_RATE || '24000');
const INPUT_DEVICE = process.env.INPUT_DEVICE || 'meeting-output.monitor';
const OUTPUT_DEVICE = process.env.OUTPUT_DEVICE || 'VirtualMic';

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not set');
  process.exit(1);
}

console.log('🚀 OpenAI Realtime Bridge starting...');
console.log(`   Voice: ${VOICE}`);
console.log(`   Input: ${INPUT_DEVICE}`);
console.log(`   Output: ${OUTPUT_DEVICE}`);

// Connect to OpenAI Realtime API
const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODEL}`, {
  headers: {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'OpenAI-Beta': 'realtime=v1'
  }
});

let sessionReady = false;
let parecord = null;
let paplay = null;

// Audio buffer for outgoing (to speaker)
let audioQueue = [];
let isPlaying = false;

ws.on('open', () => {
  console.log('✅ Connected to OpenAI Realtime API');
  
  // Configure session
  ws.send(JSON.stringify({
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      instructions: INSTRUCTIONS,
      voice: VOICE,
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: {
        model: 'whisper-1'
      },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500
      }
    }
  }));
});

ws.on('message', (data) => {
  const event = JSON.parse(data.toString());
  
  switch (event.type) {
    case 'session.created':
      console.log('📡 Session created');
      break;
      
    case 'session.updated':
      console.log('✅ Session configured');
      sessionReady = true;
      startAudioCapture();
      break;
      
    case 'input_audio_buffer.speech_started':
      console.log('🎤 Speech detected');
      break;
      
    case 'input_audio_buffer.speech_stopped':
      console.log('🔇 Speech ended');
      break;
      
    case 'conversation.item.input_audio_transcription.completed':
      console.log(`📝 User said: "${event.transcript}"`);
      break;
      
    case 'response.audio.delta':
      // Queue audio for playback
      if (event.delta) {
        const audioBuffer = Buffer.from(event.delta, 'base64');
        audioQueue.push(audioBuffer);
        playAudioQueue();
      }
      break;
      
    case 'response.audio_transcript.delta':
      process.stdout.write(event.delta || '');
      break;
      
    case 'response.audio_transcript.done':
      console.log(`\n🗣️ Claw: "${event.transcript}"`);
      break;
      
    case 'response.done':
      console.log('✅ Response complete');
      break;
      
    case 'error':
      console.error('❌ Error:', event.error);
      break;
      
    default:
      // Uncomment to debug all events
      // console.log('📨', event.type);
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
});

ws.on('close', (code, reason) => {
  console.log(`🔌 Connection closed: ${code} ${reason}`);
  cleanup();
  process.exit(0);
});

function startAudioCapture() {
  console.log('🎧 Starting audio capture from meeting...');
  
  // Use parec to capture raw PCM from meeting output
  // Resample to 24kHz mono for OpenAI
  parecord = spawn('parec', [
    '--device=' + INPUT_DEVICE,
    '--format=s16le',
    '--rate=' + SAMPLE_RATE,
    '--channels=1',
    '--latency-msec=50'
  ]);
  
  parecord.stdout.on('data', (chunk) => {
    if (sessionReady && ws.readyState === WebSocket.OPEN) {
      // Send audio chunk to OpenAI
      ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: chunk.toString('base64')
      }));
    }
  });
  
  parecord.stderr.on('data', (data) => {
    console.error('parec stderr:', data.toString());
  });
  
  parecord.on('error', (err) => {
    console.error('❌ parec error:', err.message);
  });
  
  parecord.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`parec exited with code ${code}`);
    }
  });
  
  console.log('✅ Audio capture started');
}

function playAudioQueue() {
  if (isPlaying || audioQueue.length === 0) return;
  isPlaying = true;
  
  // Concatenate all queued audio
  const audioData = Buffer.concat(audioQueue);
  audioQueue = [];
  
  // Pipe to paplay for output
  const paplayProc = spawn('paplay', [
    '--device=' + OUTPUT_DEVICE,
    '--format=s16le',
    '--rate=' + SAMPLE_RATE,
    '--channels=1',
    '--raw'
  ]);
  
  paplayProc.stdin.write(audioData);
  paplayProc.stdin.end();
  
  paplayProc.on('close', () => {
    isPlaying = false;
    // Check if more audio arrived while playing
    if (audioQueue.length > 0) {
      playAudioQueue();
    }
  });
  
  paplayProc.on('error', (err) => {
    console.error('❌ paplay error:', err.message);
    isPlaying = false;
  });
}

function cleanup() {
  console.log('🧹 Cleaning up...');
  if (parecord) {
    parecord.kill();
  }
  if (ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

console.log('💡 Press Ctrl+C to stop');
