#!/usr/bin/env node
/**
 * Hybrid Realtime Bridge: OpenAI Realtime STT + ElevenLabs TTS
 * 
 * Uses OpenAI Realtime API for low-latency transcription with server VAD,
 * then generates responses with Claude/GPT and speaks via ElevenLabs.
 * 
 * Features:
 * - Real-time speech detection and transcription
 * - ElevenLabs TTS for consistent voice
 * - Meeting controls via voice commands (leave, mute, pause)
 * 
 * Usage: node realtime-hybrid.js
 */

import WebSocket from 'ws';
import { spawn, exec } from 'child_process';
import { Buffer } from 'buffer';
import https from 'https';
import http from 'http';

// Config - all from environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'cgSgspJ2msm6clMCkdW9'; // Jessica
const EXA_API_KEY = process.env.EXA_API_KEY;

// Audio config - override via env if needed
const SAMPLE_RATE = parseInt(process.env.SAMPLE_RATE || '24000');
const INPUT_DEVICE = process.env.INPUT_DEVICE || 'meeting-output.monitor';
const OUTPUT_DEVICE = process.env.OUTPUT_DEVICE || 'VirtualMic';

// System prompt with meeting control awareness
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || `You are Claw, an AI assistant in a voice meeting. Stay completely silent unless directly addressed by name.

CORE BEHAVIOR:
- Do NOT announce your presence or listening state.
- Do NOT say phrases like "I'm listening" or "note listening passively" or "I will continue to listen".
- Stay silent during general conversation.
- Only speak when someone says "Claw" followed by a question or request.

WHEN ADDRESSED:
- Be concise and natural (1-2 sentences).
- Examples: "What do you think Claw?", "Claw, look up X", "Hey Claw, what's your take?"
- ALWAYS give a spoken response. Do NOT just call a tool without speaking.

NOTES & ACTION ITEMS:
- When asked to take a note, remember something, or jot something down: say "Got it" or "Noted" and repeat the key point back briefly.
  The note will appear in the transcript for later review. You do NOT need a tool for this.
  Example: User says "Claw, note that we agreed on a March 15th deadline." → You say: "Noted — March 15th deadline."
- When asked to add an action item or to-do: acknowledge and restate it clearly.
  Example: "Claw, remind me to send the proposal." → "Got it — action item: send the proposal."

SCHEDULING & FOLLOW-UPS:
- When asked to schedule a meeting, check availability, send an email, or do anything that requires external tools you don't have:
  ACCEPT the request confidently and say you'll handle it after the call.
  Examples:
  - "Claw, schedule a follow-up for next Tuesday." → "I'll set that up after the call."
  - "Claw, can you check my calendar?" → "I'll check and get back to you after the meeting."
  - "Claw, send the summary." → "I'll send that over once we wrap up."
  The request will appear in the transcript. The parent agent (OpenClaw) will pick it up and execute it.
- NEVER say "I can't do that" or "I don't have access to that." You CAN — just not live. Defer gracefully.

MEETING CONTROLS (ONLY when EXPLICITLY commanded):
- leave_meeting: ONLY if someone says "Claw, leave the meeting" (NOT on casual "bye"/"thanks").
- mute_self: ONLY if someone says "Claw, mute yourself".
- unmute_self: ONLY if currently muted AND someone says "Claw, unmute". Never call if already unmuted.
- pause_listening: ONLY if someone says "Claw, stop listening" or "Claw, give us privacy".

WEB SEARCH:
- Use web_search when asked to look up, search, find, or when asked factual questions.
- Answer ONLY what was asked. No extra context, explanations, or unsolicited suggestions.
- For venue/place searches: list 2-3 specific options with name and address.
- Be direct and factual. Keep responses SHORT — one to two sentences max.
- If asked for a recommendation, pick one based on ratings, reviews, or proximity from the search results. Give a brief reason.

NEVER announce what you're doing. Just do it.`;

// Meeting control tools for function calling
// NOTE: These are deliberately strict. AI should prefer speech over tools.
const MEETING_TOOLS = [
  {
    type: "function",
    function: {
      name: "leave_meeting",
      description: "Leave the meeting, stop recording, and end the session. ONLY call this if someone EXPLICITLY says 'Claw, leave the meeting' or 'Claw, leave the call'. DO NOT call for casual farewells like 'bye', 'see ya', 'goodbye', 'thank you', etc."
    }
  },
  {
    type: "function",
    function: {
      name: "mute_self",
      description: "Mute the AI's microphone so it stops speaking. ONLY call this if someone EXPLICITLY says 'Claw, mute yourself'. DO NOT call for phrases like 'thanks', 'that's all', silence, etc."
    }
  },
  {
    type: "function",
    function: {
      name: "unmute_self",
      description: "Unmute the AI's microphone to resume speaking. ONLY call this if you are currently muted AND someone EXPLICITLY asks you to unmute or speak again. DO NOT call if already unmuted."
    }
  },
  {
    type: "function",
    function: {
      name: "pause_listening",
      description: "Temporarily stop listening to the meeting. ONLY call this if someone EXPLICITLY says 'Claw, stop listening' or 'give us privacy'."
    }
  },
  {
    type: "function",
    function: {
      name: "resume_listening",
      description: "Resume listening after being paused. ONLY call this if someone EXPLICITLY says 'Claw, start listening again' while paused."
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current information. Use when someone asks 'Claw, look up X', 'Claw, search for Y', or asks about facts, data, or topics that may have changed since your training cutoff.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to look up"
          },
          count: {
            type: "integer",
            description: "Number of results to return (1-5, default 3)"
          }
        },
        required: ["query"]
      }
    }
  }
];

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not set');
  process.exit(1);
}

if (!ELEVENLABS_API_KEY) {
  console.error('❌ ELEVENLABS_API_KEY not set');
  process.exit(1);
}

console.log('🚀 Hybrid Realtime Bridge starting...');
console.log('   STT: OpenAI Realtime (server VAD)');
console.log('   TTS: ElevenLabs');
console.log(`   Input: ${INPUT_DEVICE}`);
console.log(`   Output: ${OUTPUT_DEVICE}`);
console.log('   Controls: leave, mute, pause via voice');

// State
let conversationHistory = [];
let isProcessingResponse = false;
let parecord = null;
let isMuted = false;
let isPaused = false;

// Pending search requests (id -> { resolve, reject, timeout })
const pendingSearches = new Map();

// Listen for search results from stdin (OpenClaw agent writes JSON)
import * as readline from 'readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  try {
    const data = JSON.parse(line);
    if (data.type === 'search_results' && data.id) {
      const pending = pendingSearches.get(data.id);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingSearches.delete(data.id);
        pending.resolve(data.results || []);
        console.log(`✅ Received search results for ${data.id}`);
      }
    }
  } catch (e) {
    // Not JSON, ignore
  }
});

function waitForSearchResults(searchId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingSearches.delete(searchId);
      reject(new Error('Search timeout'));
    }, timeoutMs);
    
    pendingSearches.set(searchId, { resolve, reject, timeout });
  });
}

// Connect to OpenAI Realtime API for transcription only
const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview', {
  headers: {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'OpenAI-Beta': 'realtime=v1'
  }
});

ws.on('open', () => {
  console.log('✅ Connected to OpenAI Realtime API');
  
  // Configure for transcription only (no audio output)
  ws.send(JSON.stringify({
    type: 'session.update',
    session: {
      modalities: ['text'],
      instructions: 'Transcribe the user\'s speech accurately. Do not generate responses.',
      input_audio_format: 'pcm16',
      input_audio_transcription: {
        model: 'whisper-1'
      },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 700
      }
    }
  }));
});

ws.on('message', async (data) => {
  const event = JSON.parse(data.toString());
  
  switch (event.type) {
    case 'session.created':
      console.log('📡 Session created');
      break;
      
    case 'session.updated':
      console.log('✅ Session configured (transcription mode)');
      startAudioCapture();
      break;
      
    case 'input_audio_buffer.speech_started':
      if (!isPaused) console.log('🎤 Speech detected');
      break;
      
    case 'input_audio_buffer.speech_stopped':
      if (!isPaused) console.log('🔇 Speech ended');
      break;
      
    case 'conversation.item.input_audio_transcription.completed':
      if (event.transcript && event.transcript.trim() && !isPaused) {
        console.log(`📝 User: "${event.transcript}"`);
        await handleUserSpeech(event.transcript);
      }
      break;
      
    case 'error':
      console.error('❌ Error:', event.error);
      break;
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
});

ws.on('close', () => {
  console.log('🔌 Connection closed');
  cleanup();
  process.exit(0);
});

async function handleUserSpeech(transcript) {
  if (isProcessingResponse) {
    console.log('⏳ Still processing previous response, queuing...');
    return;
  }
  
  isProcessingResponse = true;
  
  try {
    // Add to conversation history
    conversationHistory.push({ role: 'user', content: transcript });
    
    // Keep last 10 exchanges for context
    if (conversationHistory.length > 20) {
      conversationHistory = conversationHistory.slice(-20);
    }
    
    // Generate response with function calling
    const result = await generateResponse();
    
    // Check for tool calls
    if (result.tool_calls && result.tool_calls.length > 0) {
      for (const toolCall of result.tool_calls) {
        await handleToolCall(toolCall);
      }
    }
    
    // Speak the response if there is one and we're not muted
    if (result.content && !isMuted) {
      console.log(`🗣️ Claw: "${result.content}"`);
      conversationHistory.push({ role: 'assistant', content: result.content });
      await speakElevenLabs(result.content);
    }
    
  } catch (err) {
    console.error('❌ Response error:', err.message);
  } finally {
    isProcessingResponse = false;
  }
}

async function handleToolCall(toolCall) {
  const funcName = toolCall.function.name;
  console.log(`🔧 Tool call: ${funcName}`);
  
  switch (funcName) {
    case 'leave_meeting':
      console.log('👋 Leaving meeting...');
      // Acknowledge before signaling
      if (!isMuted) {
        await speakElevenLabs("Okay, signing off!");
      }
      // Signal to parent agent via stdout (agent must poll process logs)
      console.log('SIGNAL:LEAVE_MEETING');
      isPaused = true;  // Stop processing further speech
      // Wait for agent to kill us after clicking Leave
      setTimeout(() => {
        console.log('⏱️ Timeout waiting for agent, exiting anyway');
        cleanup();
        process.exit(0);
      }, 60000);  // 60s for agent to poll and act
      break;
      
    case 'mute_self':
      if (isMuted) {
        console.log('🔇 Already muted, ignoring duplicate call');
        return;
      }
      isMuted = true;
      console.log('🔇 Muted - will not speak');
      console.log('SIGNAL:MUTED');
      break;
      
    case 'unmute_self':
      if (!isMuted) {
        console.log('🔊 Already unmuted, ignoring duplicate call');
        return;
      }
      isMuted = false;
      console.log('🔊 Unmuted - resuming speech');
      console.log('SIGNAL:UNMUTED');
      // No spoken response here — prevents interrupting the conversation
      break;
      
    case 'pause_listening':
      isPaused = true;
      console.log('⏸️ Paused - not processing speech');
      console.log('SIGNAL:PAUSED');
      if (!isMuted) {
        await speakElevenLabs("I'll stop listening now. Say my name when you want me back.");
      }
      break;
      
    case 'resume_listening':
      isPaused = false;
      console.log('▶️ Resumed - processing speech');
      console.log('SIGNAL:RESUMED');
      if (!isMuted) {
        await speakElevenLabs("I'm listening again. How can I help?");
      }
      break;
      
    case 'web_search':
      try {
        const args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
        const searchQuery = args.query;
        const searchCount = args.count || 3;
        if (!searchQuery) {
          console.log('⚠️ web_search called without query');
          return;
        }
        
        if (!EXA_API_KEY) {
          console.log('⚠️ EXA_API_KEY not set');
          if (!isMuted) {
            await speakElevenLabs("Web search isn't configured.");
          }
          return;
        }
        
        console.log(`🔍 Searching Exa for: "${searchQuery}"`);
        const results = await searchExa(searchQuery, searchCount);
        
        if (!results || results.length === 0) {
          if (!isMuted) {
            await speakElevenLabs("I couldn't find any results for that.");
          }
          return;
        }
        
        // Feed results to GPT for spoken summary
        const resultsText = results.map((r, i) => `${i+1}. ${r.title}: ${r.snippet}`).join('\n');
        console.log(`📄 Got ${results.length} results`);
        conversationHistory.push({ role: 'assistant', content: `[Searched for "${searchQuery}"]` });
        conversationHistory.push({ role: 'system', content: `Search results:\n${resultsText}\n\nRULES: Answer ONLY what was asked. For places/venues, list 2-3 options with name and address only. Example format: "There's [Name] at [Address], [Name] at [Address], and [Name] at [Address]." No explanations, no suggestions, no filler. One sentence.` });
        const summary = await generateResponse();
        if (summary.content && !isMuted) {
          console.log(`🗣️ Claw: "${summary.content}"`);
          conversationHistory.push({ role: 'assistant', content: summary.content });
          await speakElevenLabs(summary.content);
        }
      } catch (err) {
        console.error('❌ Search error:', err.message);
        if (!isMuted) {
          await speakElevenLabs("Sorry, the search failed.");
        }
      }
      break;

    default:
      console.log(`⚠️ Unknown tool: ${funcName}`);
  }
}

async function generateResponse() {
  return new Promise((resolve, reject) => {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversationHistory
    ];
    
    const postData = JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      tools: MEETING_TOOLS,
      tool_choice: 'auto',
      max_tokens: 150,
      temperature: 0.7
    });
    
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.choices && json.choices[0]) {
            const message = json.choices[0].message;
            resolve({
              content: message.content,
              tool_calls: message.tool_calls
            });
          } else {
            reject(new Error('No response from API'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function searchExa(query, count = 3) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      query: query,
      numResults: count,
      type: 'auto',
      userLocation: 'CA',
      contents: {
        summary: {
          query: query
        }
      }
    });
    
    const req = https.request({
      hostname: 'api.exa.ai',
      path: '/search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': EXA_API_KEY,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error));
            return;
          }
          const results = (json.results || []).slice(0, count).map(r => ({
            title: r.title || '',
            snippet: r.summary || r.text || '',
            url: r.url || ''
          }));
          resolve(results);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Expand common abbreviations for better TTS pronunciation
function expandAbbreviations(text) {
  return text
    .replace(/\bSt\b(?=\s|,|$)/g, 'Street')
    .replace(/\bAve\b(?=\s|,|$)/g, 'Avenue')
    .replace(/\bBlvd\b(?=\s|,|$)/g, 'Boulevard')
    .replace(/\bDr\b(?=\s|,|$)/g, 'Drive')
    .replace(/\bRd\b(?=\s|,|$)/g, 'Road')
    .replace(/\bLn\b(?=\s|,|$)/g, 'Lane')
    .replace(/\bCt\b(?=\s|,|$)/g, 'Court')
    .replace(/\bPl\b(?=\s|,|$)/g, 'Place');
}

async function speakElevenLabs(text) {
  if (isMuted) {
    console.log('🔇 (muted, skipping TTS)');
    return;
  }
  
  // Expand abbreviations for proper pronunciation
  const processedText = expandAbbreviations(text);
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      text: processedText,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      },
      apply_text_normalization: 'on'
    });
    
    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=pcm_24000`,
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/pcm'
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        let errData = '';
        res.on('data', chunk => errData += chunk);
        res.on('end', () => reject(new Error(`ElevenLabs error ${res.statusCode}: ${errData}`)));
        return;
      }
      
      const paplayProc = spawn('paplay', [
        '--device=' + OUTPUT_DEVICE,
        '--format=s16le',
        '--rate=24000',
        '--channels=1',
        '--raw'
      ], { stdio: ['pipe', 'ignore', 'ignore'] });
      
      res.pipe(paplayProc.stdin);
      
      paplayProc.on('close', () => resolve());
      paplayProc.on('error', reject);
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function startAudioCapture() {
  console.log('🎧 Starting audio capture...');
  
  parecord = spawn('parec', [
    '--device=' + INPUT_DEVICE,
    '--format=s16le',
    '--rate=' + SAMPLE_RATE,
    '--channels=1',
    '--latency-msec=50'
  ]);
  
  parecord.stdout.on('data', (chunk) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: chunk.toString('base64')
      }));
    }
  });
  
  parecord.stderr.on('data', (data) => {
    console.error('parec:', data.toString());
  });
  
  parecord.on('error', (err) => {
    console.error('❌ parec error:', err.message);
  });
  
  console.log('✅ Audio capture started');
}

function writeSignal(signal) {
  try {
    fs.writeFileSync(SIGNAL_FILE, signal + '\n' + new Date().toISOString());
    console.log(`📄 Signal written to ${SIGNAL_FILE}`);
  } catch (err) {
    console.error('⚠️ Could not write signal file:', err.message);
  }
}

function cleanup() {
  console.log('🧹 Cleaning up...');
  if (parecord) parecord.kill();
  if (ws.readyState === WebSocket.OPEN) ws.close();
}

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

console.log('💡 Voice commands: "leave the call", "mute yourself", "stop listening"');
console.log('💡 Press Ctrl+C to stop manually');
