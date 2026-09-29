import { useCallback, useEffect, useRef, useState } from "react";
import type { VoicePillProps } from "@/components/VoicePill";

type SpeechAlternative = { transcript: string };
type SpeechResult = ArrayLike<SpeechAlternative> & { isFinal: boolean };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type SpeechRecognitionError = { error: string };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: SpeechRecognitionError) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionConstructor = new () => Recognition;
type RecognitionWindow = Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };

export function useSpeechDictation(onText: (text: string) => void) {
  const insertText = useRef(onText);
  insertText.current = onText;
  const recognitionRef = useRef<Recognition | null>(null);
  const finalTextRef = useRef("");
  const cancelledRef = useRef(false);
  const resetErrorRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [errorLocked, setErrorLocked] = useState(false);
  const [message, setMessage] = useState("");
  const [interim, setInterim] = useState("");

  useEffect(() => {
    const win = window as RecognitionWindow;
    setSupported(Boolean(win.SpeechRecognition || win.webkitSpeechRecognition));
    return () => {
      if (resetErrorRef.current) clearTimeout(resetErrorRef.current);
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const start = useCallback((_event: { source: "simulated" | "mic" }) => {
    const win = window as RecognitionWindow;
    const RecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!RecognitionClass) {
      setMessage("Speech dictation is not supported by this browser.");
      return;
    }
    recognitionRef.current?.abort();
    finalTextRef.current = "";
    cancelledRef.current = false;
    setInterim("");
    setMessage("Listening — speak naturally, then tap the mic to finish.");

    const recognition = new RecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      let interimText = "";
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (finalText) finalTextRef.current = `${finalTextRef.current} ${finalText}`.trim();
      setInterim(interimText.trim());
    };
    recognition.onerror = (event) => {
      const descriptions: Record<string, string> = {
        "not-allowed": "Microphone permission was blocked. Allow microphone access and try again.",
        "service-not-allowed": "Speech recognition is unavailable for this browser session.",
        "no-speech": "No speech was detected. Try again a little closer to the microphone.",
        network: "The browser speech service is unavailable right now.",
      };
      setMessage(descriptions[event.error] ?? `Dictation stopped: ${event.error}.`);
      cancelledRef.current = true;
      setErrorLocked(true);
      if (resetErrorRef.current) clearTimeout(resetErrorRef.current);
      resetErrorRef.current = setTimeout(() => setErrorLocked(false), 1400);
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setListening(false);
      setInterim("");
      const transcript = finalTextRef.current.trim();
      if (!cancelledRef.current && transcript) {
        insertText.current(transcript);
        setMessage("Dictation added to your prompt.");
      } else if (!cancelledRef.current && !transcript) {
        setMessage("No speech was transcribed. Try again or type your request.");
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setMessage("Could not start speech recognition. Try again or type your request.");
      setErrorLocked(true);
      resetErrorRef.current = setTimeout(() => setErrorLocked(false), 1400);
    }
  }, []);

  const stop = useCallback(({ reason }: { reason: Parameters<NonNullable<VoicePillProps["onStop"]>>[0]["reason"] }) => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setListening(false);
      if (reason === "mic-denied") setMessage("Microphone permission was denied. Check browser permissions to use voice input.");
      return;
    }
    const cancel = reason === "cancel" || reason === "mic-denied" || reason === "disabled" || reason === "unmount";
    cancelledRef.current = cancel;
    setListening(false);
    if (reason === "mic-denied") setMessage("Microphone permission was denied. Check browser permissions to use voice input.");
    if (cancel) {
      recognitionRef.current = null;
      setInterim("");
      recognition.abort();
      finalTextRef.current = "";
    } else {
      recognition.stop();
      setMessage("Finishing transcription…");
    }
  }, []);

  return { start, stop, listening, supported, errorLocked, message, interim };
}
