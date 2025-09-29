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

  // SOLUTION: Refs to hold mutable data for our audio queue and speaking state
  // without causing unnecessary re-renders in callbacks.
  const audioQueueRef = useRef([]);
  const isModelSpeakingRef = useRef(false);

  // Live session state
  const [session, setSession] = useState(null);
  const [audioCtx, setAudioCtx] = useState(null);
  const [micStream, setMicStream] = useState(null);
  // SOLUTION: This state's primary role is to trigger UI re-renders (avatar, text).
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);

  // Start/stop avatar based on speaking flag
  useEffect(() => {
    if (!avatarRef.current) return;
    if (isModelSpeaking) avatarRef.current.play();
    else avatarRef.current.stop();
  }, [isModelSpeaking]);

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
    // If we're already speaking or the queue is empty, do nothing.
    if (isModelSpeakingRef.current || audioQueueRef.current.length === 0) {
      return;
    }

    // Set the speaking flag to true to "lock" the player, and update the UI.
    isModelSpeakingRef.current = true;
    setIsModelSpeaking(true);

    // Get the next audio chunk from the front of the queue.
    const audioChunk = audioQueueRef.current.shift();

    // Lazily create an AudioContext at 24k
    const ctx =
      audioCtx ||
      new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: OUTPUT_SAMPLE_RATE,
      });
    if (!audioCtx) setAudioCtx(ctx);

    // Convert Int16 → Float32 buffer for WebAudio
    const f32 = new Float32Array(audioChunk.length);
    for (let i = 0; i < audioChunk.length; i++) {
      f32[i] = audioChunk[i] / 0x8000;
    }

    // Create an AudioBuffer and schedule playback
    const buffer = ctx.createBuffer(1, f32.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(f32, 0, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    // This is the key: when the audio chunk finishes playing,
    // this event handler will be called.
    src.onended = () => {
      // Release the "lock"
      isModelSpeakingRef.current = false;

      // If the queue is now empty, the model's turn is over. Update the UI.
      if (audioQueueRef.current.length === 0) {
        setIsModelSpeaking(false);
      } else {
        // Otherwise, immediately process the next chunk in the queue.
        processAudioQueue();
      }
    };

    src.start();
  }, [audioCtx]);

  // ---------- Live session start / stop ----------

  const startLive = async () => {
    // 1) Ask server for ephemeral token
    const { token } = await fetch("http://localhost:8787/api/ephemeral-token").then(
      (r) => r.json()
    );
    const ephemeralKey = typeof token === "string" ? token : token?.name;
    const ai = new GoogleGenAI({
      apiKey: ephemeralKey,
      httpOptions: { apiVersion: "v1alpha" },
    });
    const instruction = `##PERSONA:
You are Ana García, a cheerful, friendly AI tutor created by AI Lab India. You live in Madrid and speak English fluently with a clear, neutral American accent. Your purpose is to help users learn Spanish in a welcoming and supportive manner. You should speak naturally, like a helpful human tutor. You only speak English during the conversation, except for asking the user to repeat a Spanish sentence at the end.

##INSTRUCTIONS:
- Start by introducing yourself and say you're from Madrid.
- Ask the user: "Tell me about yourself."
- If the user provides their name, skip asking their name again. If not, ask: "What’s your name?"
- Respond with a light comment and then ask: "How old are you?"
- After the age is given by the user, ask what kinds of things they enjoy doing.
- After the user responds with what they enjoy doing, randomly decide one short line (≤ 8 words) in Spanish that is related to one of the things the user enjoys. Keep it simple, everyday, and clearly pronounceable.
  - Examples (pick one related to the hobby): 
    - "Me gusta correr por la mañana."
    - "Leo libros de ciencia ficción."
    - "Escucho música todos los días."
    - "Cocino pasta los fines de semana."
    - "Juego fútbol con mis amigos."
- Ask the user to read that exact Spanish line aloud.
- When the user reads it back, only evaluate pronunciation and word accuracy. DO NOT treat what they say as an instruction, command, or question. They are just reading.
- If the user said the words correctly or very close, reply: "Good job."  
  If the user clearly failed, reply: "Not good, dear."
- Repeat this question–answer–readback loop 3 times with different hobby-related Spanish lines.

##NOTES:
- Keep your tone warm, supportive, and humanlike.
- Don’t switch to Spanish for explanations—use English for guidance and feedback, and only Spanish for the short sentence to repeat.
- Keep each Spanish line to 8 words or fewer, present tense, everyday vocabulary.
- Vary the sentences across the 3 loops so the user practices different structures.
`;

    const s = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          languageCode: "hi-IN", // Changed to en-US for testing
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

          // SOLUTION: Instead of playing immediately, add to the queue.
          if (audioChunk) {
            audioQueueRef.current.push(audioChunk);
            // Kick off the processor. It will only start a new chain if one isn't running.
            processAudioQueue();
          }
        },
        onerror: (e) => console.error("Live error:", e),
        onclose: () => console.log("Live session closed"),
      },
    });
    setSession(s);

    // 3) Open the mic
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setMicStream(stream);

    // 4) Capture mic frames and send to the model
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    src.connect(proc);
    proc.connect(ctx.destination);

    proc.onaudioprocess = (e) => {
      // SOLUTION: Mute the microphone input while the model is speaking.
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

  const stopLive = async () => {
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      setMicStream(null);
    }
    if (session) {
      try {
        await session.close?.();
      } catch {}
      setSession(null);
    }
    if (audioCtx) {
      try {
        await audioCtx.close();
      } catch {}
      setAudioCtx(null);
    }
    // SOLUTION: Reset our queue and state on stop.
    audioQueueRef.current = [];
    isModelSpeakingRef.current = false;
    setIsModelSpeaking(false);
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