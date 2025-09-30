// src/App.js
import React, { useCallback, useEffect, useRef, useState } from "react";
import Lottie from "lottie-react";
import talkingAvatar from "./talking-avatar.json";
import { GoogleGenAI } from "@google/genai";

// Correct Live model id
const MODEL = "gemini-live-2.5-flash-preview";

// Live output is 24 kHz PCM. We'll create a 24k AudioContext for clean playback.
const OUTPUT_SAMPLE_RATE = 24000;

export default function App() {
  const avatarRef = useRef(null);
  const transcriptContainerRef = useRef(null); // Ref for the transcript container

  // SOLUTION: Refs to hold mutable data for our audio queue and speaking state
  // without causing unnecessary re-renders in callbacks.
  const audioQueueRef = useRef([]);
  const isModelSpeakingRef = useRef(false);

  // --- NEW: Refs for audio nodes to manage disconnection ---
  const audioProcessorRef = useRef(null);
  const audioSourceRef = useRef(null);


  // Live session state
  const [session, setSession] = useState(null);
  const [audioCtx, setAudioCtx] = useState(null);
  const [micStream, setMicStream] = useState(null);
  // SOLUTION: This state's primary role is to trigger UI re-renders (avatar, text).
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);

  // --- MODIFIED: State for transcriptions ---
  const [transcript, setTranscript] = useState([]);


  // Start/stop avatar based on speaking flag
  useEffect(() => {
    if (!avatarRef.current) return;
    if (isModelSpeaking) avatarRef.current.play();
    else avatarRef.current.stop();
  }, [isModelSpeaking]);

  // Auto-scroll transcript to the bottom
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcript]);


  // ---------- helpers: audio conversions (Unchanged) ----------

  function floatTo16BitPCM(float32) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  function downsampleTo16k(float32, inRate) {
    const outRate = 16000;
    if (inRate === outRate) return float32;
    const ratio = inRate / outRate;
    const newLen = Math.floor(float32.length / ratio);
    const out = new Float32Array(newLen);
    let pos = 0;
    for (let i = 0; i < newLen; i++, pos += ratio) {
      out[i] = float32[Math.floor(pos)];
    }
    return out;
  }

  function arrayBufferToBase64(ab) {
    const bytes = new Uint8Array(ab);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function base64ToInt16(b64) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new Int16Array(bytes.buffer);
  }

  // SOLUTION: The new audio queue processing function.
  const processAudioQueue = useCallback(async () => {
    if (isModelSpeakingRef.current || audioQueueRef.current.length === 0) {
      return;
    }
    isModelSpeakingRef.current = true;
    setIsModelSpeaking(true);
    const audioChunk = audioQueueRef.current.shift();
    const ctx =
      audioCtx ||
      new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: OUTPUT_SAMPLE_RATE,
      });
    if (!audioCtx) setAudioCtx(ctx);
    const f32 = new Float32Array(audioChunk.length);
    for (let i = 0; i < audioChunk.length; i++) {
      f32[i] = audioChunk[i] / 0x8000;
    }
    const buffer = ctx.createBuffer(1, f32.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(f32, 0, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => {
      isModelSpeakingRef.current = false;
      if (audioQueueRef.current.length === 0) {
        setIsModelSpeaking(false);
      } else {
        processAudioQueue();
      }
    };
    src.start();
  }, [audioCtx]);

  // ---------- Live session start / stop ----------

  const startLive = async () => {
    // 1) Ask server for ephemeral token AND the dynamic instruction
    const { token, instruction } = await fetch("http://localhost:8787/api/ephemeral-token")
      .then((r) => r.json());

    const ephemeralKey = typeof token === "string" ? token : token?.name;
    const ai = new GoogleGenAI({
      apiKey: ephemeralKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    // --- USE THE INSTRUCTION FROM THE BACKEND HERE ---
    const s = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: ["AUDIO"],
        // --- MODIFIED: Add language codes for user input ---
        inputAudioTranscription: {
          speechConfig: {
            languageCodes: ["en-US", "es-ES", "hi-IN"], // Add all languages you want to support
          },
        },
        outputAudioTranscription: {}, // Enable AI transcription
        speechConfig: {
          languageCode: "en-US",
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
        },
        systemInstruction: instruction,
      },
      callbacks: {
       onmessage: (msg) => {
        const base64Audio = msg?.speechUpdate?.audio || msg?.data || null;
        let audioChunk = null;
        if (typeof base64Audio === "string") {
        audioChunk = base64ToInt16(base64Audio);
        } else if (base64Audio instanceof ArrayBuffer) {
        audioChunk = new Int16Array(base64Audio);
        }
        if (audioChunk) {
        audioQueueRef.current.push(audioChunk);
        processAudioQueue();
        }

        // --- FIXED: Handle sequential transcriptions ---
        const { inputTranscription, outputTranscription } = msg.serverContent || {};

        if (inputTranscription?.text || outputTranscription?.text) {
            setTranscript(currentTranscript => {
                const nextTranscript = [...currentTranscript];
                const lastEntry = nextTranscript.length > 0 ? nextTranscript[nextTranscript.length - 1] : null;

                if (inputTranscription?.text) {
                    // User transcription provides chunks of text.
                    // A new utterance begins if the last one was from the AI, or if the previous user utterance was marked as final.
                    if (lastEntry && lastEntry.speaker === 'User' && !lastEntry.isFinal) {
                        // Append to the existing non-final user utterance
                        nextTranscript[nextTranscript.length - 1] = { 
                            ...lastEntry, 
                            text: lastEntry.text + ' ' + inputTranscription.text, 
                            isFinal: inputTranscription.isFinal 
                        };
                    } else {
                        // Add a new entry for the user
                        nextTranscript.push({ speaker: 'User', text: inputTranscription.text, isFinal: inputTranscription.isFinal });
                    }
                } else if (outputTranscription?.text) {
                    // AI transcription provides chunks that need to be concatenated.
                    // A new utterance begins if the last speaker was the user.
                    if (lastEntry && lastEntry.speaker === 'AI') {
                        // Append to the existing AI utterance
                        nextTranscript[nextTranscript.length - 1] = { ...lastEntry, text: lastEntry.text + outputTranscription.text };
                    } else {
                        // Start a new AI utterance
                        nextTranscript.push({ speaker: 'AI', text: outputTranscription.text });
                    }
                }
                
                return nextTranscript;
            });
        }
      },
        onerror: (e) => console.error("Live error:", e),
        onclose: () => console.log("Live session closed"),
      },
    });
    setSession(s);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setMicStream(stream);
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);

    // --- MODIFICATION: Store nodes in refs ---
    audioSourceRef.current = src;
    audioProcessorRef.current = proc;


    src.connect(proc);
    proc.connect(ctx.destination);

    proc.onaudioprocess = (e) => {
      if (isModelSpeakingRef.current) {
        return;
      }
      const inBuf = e.inputBuffer.getChannelData(0);
      const ds = downsampleTo16k(inBuf, ctx.sampleRate);
      const pcm16 = floatTo16BitPCM(ds);
      const mime = "audio/pcm;rate=16000";
      s.sendRealtimeInput({
        audio: { data: arrayBufferToBase64(pcm16.buffer), mimeType: mime },
      });
    };
  };

  // --- MODIFIED `stopLive` FUNCTION ---
  const stopLive = async () => {
    // 1. Disconnect the audio processor to stop sending data
    if (audioProcessorRef.current && audioSourceRef.current) {
        audioSourceRef.current.disconnect(audioProcessorRef.current);
        audioProcessorRef.current.disconnect();
        audioProcessorRef.current.onaudioprocess = null; // Remove the handler
        audioProcessorRef.current = null;
        audioSourceRef.current = null;
    }
      
    // 2. Stop the microphone tracks
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      setMicStream(null);
    }
      
    // 3. Now, safely close the session
    if (session) {
      try {
        await session.close?.();
      } catch {}
      setSession(null);
    }
      
    // 4. Clean up the audio context
    if (audioCtx) {
      try {
        await audioCtx.close();
      } catch {}
      setAudioCtx(null);
    }
      
    // 5. Reset states
    audioQueueRef.current = [];
    isModelSpeakingRef.current = false;
    setIsModelSpeaking(false);
    setTranscript([]);
  };

  const sendText = async (text) => {
    if (!session) return;
    session.sendClientContent({
      text,
      turnComplete: true,
    });
  };

  return (
    <div className="app">
      <h2>Talking AI Avatar </h2>
      <Lottie
        lottieRef={avatarRef}
        animationData={talkingAvatar}
        loop
        autoplay={false}
        style={{ height: 300 }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {!session ? (
          <button onClick={startLive}>Start Live</button>
        ) : (
          <>
            <button onClick={() => sendText("Tell me a short story.")}>
              Send Text Turn
            </button>
            <button onClick={stopLive}>Stop</button>
          </>
        )}
      </div>
       {/* --- NEW: Display transcriptions --- */}
       <div 
        ref={transcriptContainerRef}
        className="transcripts" 
        style={{ 
          marginTop: 20, 
          textAlign: 'left', 
          width: '100%', 
          maxWidth: 500,
          maxHeight: 200, // Set a max height
          overflowY: 'auto', // Enable vertical scrolling
          border: '1px solid #ccc',
          padding: 10,
          borderRadius: 8
        }}
       >
        {transcript.map((item, index) => (
          <p key={index} style={{margin: '8px 0'}}>
            <strong>{item.speaker}:</strong> {item.text}
          </p>
        ))}
      </div>
      <p style={{ opacity: 0.7, marginTop: 8 }}>
        {session
          ? isModelSpeaking
            ? "Model is speaking..."
            : "Live connected. Speak into your mic."
          : "Click Start Live and give mic permission."}
      </p>
    </div>
  );
}