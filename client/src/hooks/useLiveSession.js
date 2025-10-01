// src/hooks/useLiveSession.js
import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';
import {
  arrayBufferToBase64,
  base64ToInt16,
  downsampleTo16k,
  floatTo16BitPCM,
} from '../audioUtils';

// Correct Live model id
const MODEL = 'gemini-live-2.5-flash-preview';

// Live output is 24 kHz PCM. We'll create a 24k AudioContext for clean playback.
const OUTPUT_SAMPLE_RATE = 24000;

export function useLiveSession({ onTranscriptUpdate }) {
  const [session, setSession] = useState(null);
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [micStream, setMicStream] = useState(null);
  const [audioCtx, setAudioCtx] = useState(null);

  // Refs for mutable data and audio nodes
  const audioQueueRef = useRef([]);
  const isModelSpeakingRef = useRef(false);
  const audioProcessorRef = useRef(null);
  const audioSourceRef = useRef(null);

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

  const startSession = async () => {
    try {
      const { token, instruction } = await fetch(
        'http://localhost:8787/api/ephemeral-token'
      ).then((r) => r.json());

      const ephemeralKey = typeof token === 'string' ? token : token?.name;
      const ai = new GoogleGenAI({
        apiKey: ephemeralKey,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      const newSession = await ai.live.connect({
        model: MODEL,
        config: {
          responseModalities: ['AUDIO'],
          inputAudioTranscription: {
            speechConfig: {
              languageCodes: ['es-ES'],
            },
          },
          outputAudioTranscription: {},
          speechConfig: {
            languageCode: 'es-ES',
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: instruction,
        },
        callbacks: {
          onmessage: (msg) => {
            // Handle audio playback
            const base64Audio = msg?.speechUpdate?.audio || msg?.data || null;
            let audioChunk = null;
            if (typeof base64Audio === 'string') {
              audioChunk = base64ToInt16(base64Audio);
            } else if (base64Audio instanceof ArrayBuffer) {
              audioChunk = new Int16Array(base64Audio);
            }
            if (audioChunk) {
              audioQueueRef.current.push(audioChunk);
              processAudioQueue();
            }

            // Handle transcript updates
            const { inputTranscription, outputTranscription } =
              msg.serverContent || {};
            if (inputTranscription || outputTranscription) {
              onTranscriptUpdate({ inputTranscription, outputTranscription });
            }
          },
          onerror: (e) => console.error('Live error:', e),
          onclose: () => console.log('Live session closed'),
        },
      });
      setSession(newSession);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicStream(stream);

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);

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
        const mime = 'audio/pcm;rate=16000';
        newSession.sendRealtimeInput({
          audio: { data: arrayBufferToBase64(pcm16.buffer), mimeType: mime },
        });
      };
    } catch (error) {
      console.error('Failed to start session:', error);
    }
  };

  const stopSession = async () => {
    if (audioProcessorRef.current && audioSourceRef.current) {
      audioSourceRef.current.disconnect(audioProcessorRef.current);
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current.onaudioprocess = null;
      audioProcessorRef.current = null;
      audioSourceRef.current = null;
    }

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

  return {
    isConnected: !!session,
    isModelSpeaking,
    startSession,
    stopSession,
    sendText,
  };
}