export interface AudioRecorderCallbacks {
  onLevel?: (level: number) => void;
  onTimeUpdate?: (seconds: number) => void;
  onError?: (err: Error) => void;
}

export class AudioRecorder {
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private animationFrameId: number | null = null;
  private timerInterval: NodeJS.Timeout | null = null;
  private startTime: number = 0;
  private callbacks: AudioRecorderCallbacks = {};
  public isRecording: boolean = false;
  public mimeType: string = 'audio/webm';

  constructor(callbacks: AudioRecorderCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * Check if recording is supported in current environment
   */
  public static isSupported(): boolean {
    return typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof window.MediaRecorder !== 'undefined';
  }

  /**
   * Start microphone recording with real audio stream and visual analyzer
   */
  public async start(): Promise<void> {
    if (!AudioRecorder.isSupported()) {
      throw new Error('Gravação de áudio não suportada neste navegador.');
    }

    try {
      this.audioChunks = [];
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Find supported mime type
      const possibleTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/wav',
      ];
      this.mimeType = possibleTypes.find((t) => MediaRecorder.isTypeSupported(t)) || '';

      const options = this.mimeType ? { mimeType: this.mimeType } : undefined;
      this.mediaRecorder = new MediaRecorder(this.mediaStream, options);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      // Set up AudioContext for volume levels
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          this.audioContext = new AudioCtx();
          this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
          this.analyser = this.audioContext.createAnalyser();
          this.analyser.fftSize = 256;
          this.sourceNode.connect(this.analyser);

          const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
          const updateLevel = () => {
            if (!this.isRecording || !this.analyser) return;
            this.analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            const normalized = Math.min(100, Math.round((average / 128) * 100));
            this.callbacks.onLevel?.(normalized);
            this.animationFrameId = requestAnimationFrame(updateLevel);
          };
          updateLevel();
        }
      } catch (e) {
        console.warn('AudioContext visualization setup failed:', e);
      }

      this.startTime = Date.now();
      this.isRecording = true;

      // Start elapsed timer
      this.timerInterval = setInterval(() => {
        if (this.isRecording) {
          const elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
          this.callbacks.onTimeUpdate?.(elapsedSec);
        }
      }, 500);

      this.mediaRecorder.start(250);
    } catch (err: any) {
      this.cleanup();
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('Permissão do microfone negada pelo usuário ou pelo navegador.');
      }
      if (err.name === 'NotFoundError') {
        throw new Error('Nenhum microfone detectado no dispositivo.');
      }
      throw new Error('Não foi possível acessar o microfone: ' + (err.message || 'Erro desconhecido'));
    }
  }

  /**
   * Stop recording and return base64 audio and mimeType
   */
  public async stop(): Promise<{ blob: Blob; base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || !this.isRecording) {
        this.cleanup();
        reject(new Error('Nenhuma gravação ativa'));
        return;
      }

      this.mediaRecorder.onstop = async () => {
        try {
          const finalType = this.mimeType || 'audio/webm';
          const blob = new Blob(this.audioChunks, { type: finalType });
          const base64 = await AudioRecorder.blobToBase64(blob);
          this.cleanup();
          resolve({ blob, base64, mimeType: finalType });
        } catch (e) {
          this.cleanup();
          reject(e);
        }
      };

      try {
        this.mediaRecorder.stop();
        this.isRecording = false;
      } catch (e) {
        this.cleanup();
        reject(e);
      }
    });
  }

  /**
   * Cancel and discard current recording
   */
  public cancel(): void {
    if (this.mediaRecorder && this.isRecording) {
      try {
        this.mediaRecorder.stop();
      } catch {}
    }
    this.cleanup();
  }

  private cleanup(): void {
    this.isRecording = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }
    this.analyser = null;
    this.sourceNode = null;
    this.audioChunks = [];
  }

  public static blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Strip data:audio/xyz;base64, prefix
        const base64Data = result.split(',')[1] || result;
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}
