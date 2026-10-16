/**
 * Voice feedback utility for DUARTY
 * Supports both Gemini 3.8 Flash Lite TTS and native browser SpeechSynthesis fallback
 */
export async function speakFeedback(text: string, enabled: boolean = true): Promise<void> {
  if (!enabled || !text) return;

  try {
    // 1. Try Gemini TTS via backend server
    const response = await fetch('/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.audioBase64) {
        const audio = new Audio(`data:audio/wav;base64,${data.audioBase64}`);
        await audio.play();
        return;
      }
    }
  } catch (err) {
    // Ignore and proceed to browser fallback
  }

  // 2. Browser SpeechSynthesis fallback
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    // Pick a Portuguese voice if available
    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find(
      (v) => v.lang.startsWith('pt') || v.lang.includes('BR')
    );
    if (ptVoice) {
      utterance.voice = ptVoice;
    }

    window.speechSynthesis.speak(utterance);
  }
}
