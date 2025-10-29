// src/App.js : Main application component for the Talking AI Avatar
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Lottie from 'lottie-react';
import talkingAvatar from './talking-avatar.json';
import { useLiveSession } from './hooks/useLiveSession';

export default function App() {
  const avatarRef = useRef(null);
  const transcriptContainerRef = useRef(null);

  const [transcript, setTranscript] = useState([]);

  /*
  @author: Zahir
  @Desc: Handles updates to the transcript state based on incoming transcriptions
  */
  const handleTranscriptUpdate = useCallback(
    ({ inputTranscription, outputTranscription }) => {
      setTranscript((currentTranscript) => {
        const nextTranscript = [...currentTranscript];
        const lastEntry =
          nextTranscript.length > 0
            ? nextTranscript[nextTranscript.length - 1]
            : null;

        if (inputTranscription?.text) {
          if (lastEntry && lastEntry.speaker === 'User' && !lastEntry.isFinal) {
            nextTranscript[nextTranscript.length - 1] = {
              ...lastEntry,
              text: lastEntry.text + ' ' + inputTranscription.text,
              isFinal: inputTranscription.isFinal,
            };
          } else {
            nextTranscript.push({
              speaker: 'User',
              text: inputTranscription.text,
              isFinal: inputTranscription.isFinal,
            });
          }
        } else if (outputTranscription?.text) {
          if (lastEntry && lastEntry.speaker === 'AI') {
            nextTranscript[nextTranscript.length - 1] = {
              ...lastEntry,
              text: lastEntry.text + outputTranscription.text,
            };
          } else {
            nextTranscript.push({
              speaker: 'AI',
              text: outputTranscription.text,
            });
          }
        }
        return nextTranscript;
      });
    },
    []
  );

  const { isConnected, isModelSpeaking, startSession, stopSession, sendText } =
    useLiveSession({
      onTranscriptUpdate: handleTranscriptUpdate,
    });

  // Effect to control the avatar animation
  useEffect(() => {
    if (!avatarRef.current) return;
    if (isModelSpeaking) avatarRef.current.play();
    else avatarRef.current.stop();
  }, [isModelSpeaking]);

  // Effect to auto-scroll the transcript
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop =
        transcriptContainerRef.current.scrollHeight;
    }
  }, [transcript]);

  const handleStop = () => {
    stopSession();
    setTranscript([]); // Clear transcript on stop
  };

  return (
    <div className="app">
      <h2>Talking AI Avatar</h2>
      <Lottie
        lottieRef={avatarRef}
        animationData={talkingAvatar}
        loop
        autoplay={false}
        style={{ height: 300 }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {!isConnected ? (
          <button onClick={startSession}>Start Live</button>
        ) : (
          <>
            <button onClick={() => sendText('Tell me a short story.')}>
              Send Text Turn
            </button>
            <button onClick={handleStop}>Stop</button>
          </>
        )}
      </div>
      <div
        ref={transcriptContainerRef}
        className="transcripts"
        style={{
          marginTop: 20,
          textAlign: 'left',
          width: '100%',
          maxWidth: 500,
          maxHeight: 200,
          overflowY: 'auto',
          border: '1px solid #ccc',
          padding: 10,
          borderRadius: 8,
        }}
      >
        {transcript.map((item, index) => (
          <p key={index} style={{ margin: '8px 0' }}>
            <strong>{item.speaker}:</strong> {item.text}
          </p>
        ))}
      </div>
      <p style={{ opacity: 0.7, marginTop: 8 }}>
        {isConnected
          ? isModelSpeaking
            ? 'Model is speaking...'
            : 'Live connected. Speak into your mic.'
          : 'Click Start Live and give mic permission.'}
      </p>
    </div>
  );
}