import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Square,
  X,
  Send,
  CheckCircle2,
  AlertCircle,
  Edit3,
  Calendar,
  Tag,
  CreditCard,
  Building2,
  User,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Info,
  Clock,
  Check,
  ChevronDown,
} from 'lucide-react';
import { Transaction, InterpretedDraft, FinancialArea, TransactionType, PaymentStatus } from '../types';
import { AudioRecorder } from '../utils/audioRecorder';
import { formatCurrencyBRL, formatDateBR, getTodayISODate } from '../utils/formatters';
import { speakFeedback } from '../utils/voiceFeedback';

interface QuickEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentArea: 'pessoal' | 'empresa';
  defaultType?: TransactionType;
  onSaveTransaction: (transaction: Omit<Transaction, 'id' | 'criadoEm'>) => void;
  voiceFeedbackEnabled: boolean;
  onOpenCalculatorWithQuery?: (query: string) => void;
}

const COMMON_CATEGORIES = [
  'Mercado',
  'Combustível',
  'Alimentação',
  'Contas & Utilidades',
  'Software & Ferramentas',
  'Serviços Prestados',
  'Vendas',
  'Salário & Rendimentos',
  'Saúde',
  'Lazer',
  'Educação',
  'Transporte',
  'Transferência',
  'Outros',
];

const PAYMENT_METHODS = [
  'Pix',
  'Cartão de Crédito',
  'Cartão de Débito',
  'Dinheiro',
  'Boleto',
  'Transferência Bancária',
];

const POPULAR_EXAMPLES = [
  'Gastei 300 reais no mercado.',
  'Abasteci o carro com 200 reais de gasolina.',
  'Paguei 150 reais de internet da empresa.',
  'Recebi 2 mil reais de um cliente.',
  'Gastei 80 reais almoçando.',
  'Paguei a conta de luz de 230 reais.',
  'Comprei um software de 99 reais para a empresa.',
  'Transferi 1.000 reais da conta da empresa para a minha conta pessoal.',
];

export const QuickEntryModal: React.FC<QuickEntryModalProps> = ({
  isOpen,
  onClose,
  currentArea,
  defaultType = 'despesa',
  onSaveTransaction,
  voiceFeedbackEnabled,
  onOpenCalculatorWithQuery,
}) => {
  const [selectedArea, setSelectedArea] = useState<'pessoal' | 'empresa'>(currentArea);
  const [selectedType, setSelectedType] = useState<TransactionType>(defaultType);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // States of process: 'input' | 'preview' | 'editing' | 'planning_notice'
  const [step, setStep] = useState<'input' | 'preview' | 'editing' | 'planning_notice'>('input');
  const [draft, setDraft] = useState<InterpretedDraft | null>(null);
  const [transcribedText, setTranscribedText] = useState<string>('');
  const [planningMessage, setPlanningMessage] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const recorderRef = useRef<AudioRecorder | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedArea(currentArea);
      setSelectedType(defaultType || 'despesa');
      setStep('input');
      setDraft(null);
      setErrorMessage(null);
      setInputText('');
      setTranscribedText('');
      setTimeout(() => inputRef.current?.focus(), 150);
    } else {
      if (recorderRef.current?.isRecording) {
        recorderRef.current.cancel();
      }
      setIsRecording(false);
    }
  }, [isOpen, currentArea, defaultType]);

  if (!isOpen) return null;

  // Format seconds mm:ss
  const formatTimer = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  /**
   * Start microphone audio recording
   */
  const handleStartRecording = async () => {
    setErrorMessage(null);
    setPermissionDenied(false);

    if (!AudioRecorder.isSupported()) {
      setPermissionDenied(true);
      setErrorMessage('Seu navegador não suporta gravação de áudio direta. Por favor, digite o lançamento.');
      return;
    }

    try {
      const recorder = new AudioRecorder({
        onLevel: (lvl) => setAudioLevel(lvl),
        onTimeUpdate: (sec) => setRecordingSeconds(sec),
      });
      recorderRef.current = recorder;
      await recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
    } catch (err: any) {
      setIsRecording(false);
      setPermissionDenied(true);
      setErrorMessage(
        err.message || 'Permissão do microfone negada. Você pode digitar o lançamento normalmente.'
      );
    }
  };

  /**
   * Stop recording and send audio to real backend processing
   */
  const handleStopRecording = async () => {
    if (!recorderRef.current || !isRecording) return;

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const { base64, mimeType } = await recorderRef.current.stop();
      setIsRecording(false);

      await processInputPayload({
        audioBase64: base64,
        mimeType,
        currentArea: selectedArea,
        currentDate: getTodayISODate(),
      });
    } catch (err: any) {
      setIsRecording(false);
      setIsProcessing(false);
      setErrorMessage('Erro ao capturar áudio: ' + (err.message || 'Tente novamente ou digite.'));
    }
  };

  /**
   * Cancel recording without processing
   */
  const handleCancelRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.cancel();
    }
    setIsRecording(false);
    setRecordingSeconds(0);
    setAudioLevel(0);
  };

  /**
   * Submit written text
   */
  const handleTextSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;

    setIsProcessing(true);
    setErrorMessage(null);

    await processInputPayload({
      text: inputText.trim(),
      currentArea: selectedArea,
      currentDate: getTodayISODate(),
    });
  };

  /**
   * Process payload with backend /api/voice/process
   */
  const processInputPayload = async (payload: {
    text?: string;
    audioBase64?: string;
    mimeType?: string;
    currentArea: 'pessoal' | 'empresa';
    currentDate: string;
  }) => {
    try {
      const response = await fetch('/api/voice/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Falha ao processar solicitação');
      }

      const result = await response.json();
      setTranscribedText(result.transcription || payload.text || '');

      // Check intent
      if (result.intent === 'consulta') {
        // User asked a question e.g. "Quanto gastei hoje?"
        onClose();
        if (onOpenCalculatorWithQuery) {
          onOpenCalculatorWithQuery(result.transcription || payload.text || '');
        }
        return;
      }

      if (result.intent === 'planejamento') {
        setPlanningMessage(
          result.mensagem ||
            'Esta frase indica uma intenção futura ou planejamento. Por segurança e precisão, nenhum gasto foi registrado.'
        );
        setStep('planning_notice');
        setIsProcessing(false);
        return;
      }

      if (result.intent === 'registro' && result.dados) {
        const d: InterpretedDraft = {
          tipo: result.dados.tipo || 'despesa',
          valor: result.dados.valor,
          descricao: result.dados.descricao || 'Lançamento',
          categoria: result.dados.categoria || 'Outros',
          area: result.dados.area || selectedArea,
          areaInferredFromContext: Boolean(result.dados.areaInferredFromContext),
          data: result.dados.data || getTodayISODate(),
          formaPagamento: result.dados.formaPagamento || null,
          conta: result.dados.conta || null,
          status: result.dados.status || 'concluido',
          recorrencia: result.dados.recorrencia || null,
          transferenciaDetalhes: result.dados.transferenciaDetalhes || null,
        };

        setDraft(d);
        setStep('preview');
      } else {
        throw new Error('Não foi possível identificar valores ou dados na frase.');
      }
    } catch (err: any) {
      console.error('Error processing:', err);
      setErrorMessage(err.message || 'Erro ao interpretar informações. Tente reformular.');
      setStep('input');
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Confirm and save transaction
   */
  const handleConfirmSave = async () => {
    if (!draft) return;
    if (draft.valor === null || isNaN(draft.valor) || draft.valor <= 0) {
      setErrorMessage('Por favor informe um valor válido maior que zero.');
      setStep('editing');
      return;
    }

    setIsSaving(true);
    try {
      const newTx: Omit<Transaction, 'id' | 'criadoEm'> = {
        tipo: draft.tipo,
        valor: draft.valor,
        descricao: draft.descricao || (draft.tipo === 'despesa' ? 'Despesa' : 'Receita'),
        categoria: draft.categoria || 'Outros',
        area: draft.area,
        data: draft.data || getTodayISODate(),
        formaPagamento: draft.formaPagamento || undefined,
        conta: draft.conta || undefined,
        status: draft.status || 'concluido',
        recorrencia: draft.recorrencia || undefined,
        origem: draft.transferenciaDetalhes?.origem,
        destino: draft.transferenciaDetalhes?.destino,
        metodoEntrada: transcribedText ? 'voz' : 'texto',
      };

      onSaveTransaction(newTx);

      // Voice Feedback
      const tipoNome =
        draft.tipo === 'despesa' ? 'Gasto registrado' : draft.tipo === 'receita' ? 'Receita registrada' : 'Transferência realizada';
      const feedbackMsg = `${tipoNome}: ${formatCurrencyBRL(draft.valor)} em ${draft.categoria}.`;

      if (voiceFeedbackEnabled) {
        speakFeedback(feedbackMsg);
      }

      onClose();
    } catch (err: any) {
      setErrorMessage('Erro ao salvar no banco de dados. Tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md transition-all">
      <div className="relative w-full max-w-lg bg-[#0e1017] border border-slate-800 rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Top Gradient Accent Bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-fuchsia-500 via-rose-500 to-amber-500" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse" />
            <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              Lançamento Inteligente
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                Voz & Texto
              </span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 max-h-[85vh] overflow-y-auto">
          {/* STEP 1: INPUT (Voice or Text) */}
          {step === 'input' && (
            <div className="space-y-5">
              {/* Financial Area Selector */}
              <div className="flex items-center justify-between p-2 rounded-2xl bg-slate-900/90 border border-slate-800">
                <span className="text-xs font-medium text-slate-400 pl-2">Área ativa:</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedArea('pessoal')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                      selectedArea === 'pessoal'
                        ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <User className="w-3.5 h-3.5" />
                    Pessoal (CPF)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedArea('empresa')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                      selectedArea === 'empresa'
                        ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    Empresa (CNPJ)
                  </button>
                </div>
              </div>

              {/* Movement Type Quick Tabs */}
              <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-slate-900/60 border border-slate-800/80">
                <button
                  type="button"
                  onClick={() => setSelectedType('despesa')}
                  className={`py-1.5 rounded-xl text-xs font-bold transition-all ${
                    selectedType === 'despesa'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Despesa (Gasto)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedType('receita')}
                  className={`py-1.5 rounded-xl text-xs font-bold transition-all ${
                    selectedType === 'receita'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Receita (Entrada)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedType('transferencia')}
                  className={`py-1.5 rounded-xl text-xs font-bold transition-all ${
                    selectedType === 'transferencia'
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Transferência
                </button>
              </div>

              {/* Title & Prompt description */}
              <div className="text-center space-y-1">
                <h3 className="text-xl font-extrabold text-white tracking-tight">
                  Vamos registrar o que aconteceu?
                </h3>
                <p className="text-xs text-slate-400">
                  {selectedType === 'receita'
                    ? 'Digite ou fale sua receita. O DUARTY organiza para você.'
                    : selectedType === 'transferencia'
                    ? 'Digite ou fale sua transferência entre contas.'
                    : 'Digite ou fale seu gasto. O DUARTY organiza para você.'}
                </p>
              </div>

              {/* Error message */}
              {errorMessage && (
                <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
                  <div className="flex-1">
                    <p>{errorMessage}</p>
                    {permissionDenied && (
                      <p className="mt-1 text-slate-400">
                        Você pode digitar sua movimentação no campo abaixo sem complicações.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* REAL AUDIO RECORDING PANEL */}
              {isRecording ? (
                <div className="p-5 rounded-3xl bg-gradient-to-b from-rose-950/30 via-slate-900 to-slate-900 border border-rose-500/40 text-center space-y-4">
                  <div className="flex items-center justify-center gap-2 text-rose-400 text-xs font-semibold uppercase tracking-wider">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                    Gravando Áudio em Tempo Real
                  </div>

                  {/* Audio visualizer wave */}
                  <div className="flex items-center justify-center gap-1.5 h-12">
                    {[12, 28, 45, 75, 95, 60, 40, 70, 85, 50, 30, 65, 80, 35, 20].map(
                      (baseHeight, idx) => {
                        const dynamicHeight = Math.max(
                          8,
                          Math.min(100, (baseHeight * (audioLevel + 30)) / 80)
                        );
                        return (
                          <div
                            key={idx}
                            className="w-1.5 bg-gradient-to-t from-rose-500 to-amber-400 rounded-full transition-all duration-75"
                            style={{ height: `${dynamicHeight}%` }}
                          />
                        );
                      }
                    )}
                  </div>

                  {/* Timer */}
                  <div className="text-2xl font-mono font-bold text-white tracking-widest">
                    {formatTimer(recordingSeconds)}
                  </div>
                  <p className="text-xs text-slate-400">
                    Fale naturalmente. Ex: &ldquo;Gastei 300 reais no mercado hoje&rdquo;
                  </p>

                  {/* Recording Action Buttons */}
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleCancelRecording}
                      className="px-4 py-2.5 rounded-2xl bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 text-xs font-semibold transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleStopRecording}
                      className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-gradient-to-r from-rose-500 to-amber-500 text-white font-bold text-xs shadow-lg shadow-rose-500/25 hover:opacity-95 transition-all"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      Parar e Processar
                    </button>
                  </div>
                </div>
              ) : (
                /* TEXT INPUT & MICROPHONE LAUNCHER */
                <form onSubmit={handleTextSubmit} className="space-y-4">
                  <div className="relative">
                    <input
                      ref={inputRef}
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder={
                        selectedType === 'receita'
                          ? 'Ex.: Recebi R$ 2.500 de um cliente hoje.'
                          : selectedType === 'transferencia'
                          ? 'Ex.: Transferi R$ 1.000 da empresa para conta pessoal.'
                          : 'Ex.: Gastei R$ 300 no mercado hoje.'
                      }
                      disabled={isProcessing}
                      className="w-full pl-4 pr-14 py-3.5 bg-slate-900/90 border border-slate-700/80 rounded-2xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all disabled:opacity-50"
                    />

                    {/* Submit Text Button */}
                    {inputText.trim() && (
                      <button
                        type="submit"
                        disabled={isProcessing}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-gradient-to-r from-rose-500 to-amber-500 text-white shadow-md shadow-rose-500/20 hover:opacity-95 transition-all"
                        title="Processar texto"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Big Central Mic Record Button */}
                  <div className="flex flex-col items-center justify-center py-3">
                    <button
                      type="button"
                      onClick={handleStartRecording}
                      disabled={isProcessing}
                      className="group relative flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-tr from-fuchsia-600 via-rose-500 to-amber-500 text-white shadow-xl shadow-rose-500/30 hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-50"
                    >
                      <div className="absolute inset-1 rounded-full bg-[#0a0b10]/20 backdrop-blur-sm" />
                      <Mic className="relative w-8 h-8 text-white group-hover:scale-110 transition-transform" />
                    </button>
                    <span className="mt-2 text-xs font-semibold text-slate-300">
                      Toque para Falar
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Gravação com reconhecimento inteligente
                    </span>
                  </div>
                </form>
              )}

              {/* Quick Examples */}
              {!isRecording && (
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                    <span>Exemplos de voz ou texto:</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                    {POPULAR_EXAMPLES.map((example, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setInputText(example);
                          processInputPayload({
                            text: example,
                            currentArea: selectedArea,
                            currentDate: getTodayISODate(),
                          });
                        }}
                        className="text-left text-[11px] px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800/90 hover:border-slate-700 text-slate-300 hover:text-white transition-colors"
                      >
                        &ldquo;{example}&rdquo;
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: PREVIEW & CONFIRMATION (PAINEL DE PRÉVIA) */}
          {step === 'preview' && draft && (
            <div className="space-y-5 animate-in fade-in duration-150">
              {/* Header Badge */}
              <div className="flex items-center gap-2 p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>Entendi seu lançamento com perfeição. Revise os detalhes abaixo:</span>
              </div>

              {/* Transcription Transcript Banner */}
              {transcribedText && (
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400 italic">
                  &ldquo;{transcribedText}&rdquo;
                </div>
              )}

              {/* Summary Card */}
              <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
                {/* Type & Amount */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs uppercase font-extrabold px-2.5 py-1 rounded-lg ${
                        draft.tipo === 'despesa'
                          ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          : draft.tipo === 'receita'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                      }`}
                    >
                      {draft.tipo === 'despesa'
                        ? 'Despesa'
                        : draft.tipo === 'receita'
                        ? 'Receita'
                        : 'Transferência'}
                    </span>
                    <span className="text-xs text-slate-400">{draft.descricao}</span>
                  </div>
                  <div
                    className={`text-xl font-extrabold ${
                      draft.tipo === 'despesa'
                        ? 'text-rose-400'
                        : draft.tipo === 'receita'
                        ? 'text-emerald-400'
                        : 'text-blue-400'
                    }`}
                  >
                    {draft.valor !== null ? formatCurrencyBRL(draft.valor) : 'R$ --,--'}
                  </div>
                </div>

                {/* Grid of Identified Fields */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {/* Category */}
                  <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                    <span className="text-slate-500 flex items-center gap-1 text-[11px]">
                      <Tag className="w-3 h-3 text-rose-400" /> Categoria
                    </span>
                    <p className="font-semibold text-slate-200 mt-0.5">{draft.categoria}</p>
                  </div>

                  {/* Financial Area */}
                  <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                    <span className="text-slate-500 flex items-center gap-1 text-[11px]">
                      {draft.area === 'pessoal' ? (
                        <User className="w-3 h-3 text-rose-400" />
                      ) : (
                        <Building2 className="w-3 h-3 text-amber-400" />
                      )}
                      Área Financeira
                    </span>
                    <p className="font-semibold text-slate-200 mt-0.5">
                      {draft.area === 'pessoal' ? 'Pessoal — CPF' : 'Empresa — CNPJ'}
                      {draft.areaInferredFromContext && (
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Contexto)
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Date */}
                  <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                    <span className="text-slate-500 flex items-center gap-1 text-[11px]">
                      <Calendar className="w-3 h-3 text-sky-400" /> Data
                    </span>
                    <p className="font-semibold text-slate-200 mt-0.5">
                      {formatDateBR(draft.data)}
                    </p>
                  </div>

                  {/* Payment Method / Account */}
                  <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                    <span className="text-slate-500 flex items-center gap-1 text-[11px]">
                      <CreditCard className="w-3 h-3 text-purple-400" /> Pagamento / Conta
                    </span>
                    <p className="font-semibold text-slate-200 mt-0.5">
                      {draft.formaPagamento || draft.conta || 'Não especificado'}
                    </p>
                  </div>
                </div>

                {/* Transfer Details if applicable */}
                {draft.tipo === 'transferencia' && draft.transferenciaDetalhes && (
                  <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 flex items-center justify-between">
                    <span>
                      Origem: <strong>{draft.transferenciaDetalhes.origem.toUpperCase()}</strong>
                    </span>
                    <ArrowRight className="w-3.5 h-3.5" />
                    <span>
                      Destino: <strong>{draft.transferenciaDetalhes.destino.toUpperCase()}</strong>
                    </span>
                  </div>
                )}

                {/* Status Notice */}
                <div className="flex items-center justify-between text-xs pt-1 text-slate-400">
                  <span>Situação:</span>
                  <span
                    className={`font-semibold px-2 py-0.5 rounded ${
                      draft.status === 'concluido'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {draft.status === 'concluido' ? 'Concluído' : 'Pendente de Pagamento'}
                  </span>
                </div>
              </div>

              {/* Missing Value Warning */}
              {draft.valor === null && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Não identificamos o valor numérico. Por favor clique em <strong>Editar</strong> para informá-lo antes de confirmar.</span>
                </div>
              )}

              {/* 3 Explicit Actions as required */}
              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  onClick={handleConfirmSave}
                  disabled={isSaving || draft.valor === null}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold text-sm shadow-lg shadow-emerald-500/20 hover:opacity-95 transition-all disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  {isSaving ? 'Salvando lançamento...' : '1. Confirmar lançamento'}
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setStep('editing')}
                    className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    2. Editar informações
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStep('input');
                      setDraft(null);
                    }}
                    className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-rose-400 text-xs font-semibold transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    3. Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: EDITING (Tweak single field without restarting) */}
          {step === 'editing' && draft && (
            <div className="space-y-4 animate-in fade-in duration-150 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h4 className="font-bold text-slate-200">Ajustar Detalhes do Lançamento</h4>
                <button
                  onClick={() => setStep('preview')}
                  className="text-xs text-rose-400 hover:underline"
                >
                  Voltar à prévia
                </button>
              </div>

              {/* Type Switcher */}
              <div className="space-y-1">
                <label className="text-slate-400">Tipo de Movimentação</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['despesa', 'receita', 'transferencia'] as TransactionType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDraft({ ...draft, tipo: t })}
                      className={`py-2 rounded-xl text-xs font-bold capitalize transition-all ${
                        draft.tipo === t
                          ? t === 'despesa'
                            ? 'bg-rose-500 text-white'
                            : t === 'receita'
                            ? 'bg-emerald-500 text-white'
                            : 'bg-blue-500 text-white'
                          : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Value & Description */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Valor (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={draft.valor ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        valor: e.target.value ? parseFloat(e.target.value) : null,
                      })
                    }
                    placeholder="0,00"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:border-rose-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Descrição</label>
                  <input
                    type="text"
                    value={draft.descricao}
                    onChange={(e) => setDraft({ ...draft, descricao: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:border-rose-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Category & Area */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Categoria</label>
                  <select
                    value={draft.categoria}
                    onChange={(e) => setDraft({ ...draft, categoria: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:border-rose-500 focus:outline-none"
                  >
                    {COMMON_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Área Financeira</label>
                  <select
                    value={draft.area}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        area: e.target.value as 'pessoal' | 'empresa',
                        areaInferredFromContext: false,
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:border-rose-500 focus:outline-none"
                  >
                    <option value="pessoal">Pessoal (CPF)</option>
                    <option value="empresa">Empresa (CNPJ)</option>
                  </select>
                </div>
              </div>

              {/* Date & Payment Method */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Data</label>
                  <input
                    type="date"
                    value={draft.data}
                    onChange={(e) => setDraft({ ...draft, data: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:border-rose-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Forma de Pagamento</label>
                  <select
                    value={draft.formaPagamento || ''}
                    onChange={(e) =>
                      setDraft({ ...draft, formaPagamento: e.target.value || null })
                    }
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:border-rose-500 focus:outline-none"
                  >
                    <option value="">Não informado</option>
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm} value={pm}>
                        {pm}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Status */}
              <div className="space-y-1">
                <label className="text-slate-400">Situação</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, status: 'concluido' })}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold ${
                      draft.status === 'concluido'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-slate-900 text-slate-400'
                    }`}
                  >
                    Concluído (Pago/Recebido)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, status: 'pendente' })}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold ${
                      draft.status === 'pendente'
                        ? 'bg-amber-500 text-slate-950 font-bold'
                        : 'bg-slate-900 text-slate-400'
                    }`}
                  >
                    Pendente (A Pagar/A Receber)
                  </button>
                </div>
              </div>

              {/* Confirm from edit */}
              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep('preview')}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-semibold text-xs"
                >
                  Voltar à Prévia
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSave}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs"
                >
                  Confirmar Lançamento
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: PLANNING NOTICE (Distinção entre Lançamento e Planejamento) */}
          {step === 'planning_notice' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                  <Info className="w-5 h-5 shrink-0" />
                  Intenção Futura Identificada
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{planningMessage}</p>
                <div className="p-3 rounded-xl bg-slate-950/70 border border-amber-500/20 text-xs text-amber-200">
                  <strong>Regra Financeira DUARTY:</strong> Intenções futuras como &ldquo;Quero gastar&rdquo; ou &ldquo;Planejo comprar&rdquo; nunca são debitadas automaticamente do seu saldo real para evitar distorções no fluxo de caixa.
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStep('input');
                    setInputText('');
                  }}
                  className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
                >
                  Voltar ao Início
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Let user transform this into a pending expense if they really bought it
                    setDraft({
                      tipo: 'despesa',
                      valor: null,
                      descricao: inputText || 'Gasto planejado',
                      categoria: 'Outros',
                      area: selectedArea,
                      areaInferredFromContext: true,
                      data: getTodayISODate(),
                      status: 'pendente',
                    });
                    setStep('editing');
                  }}
                  className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition-colors"
                >
                  Lançar como Conta Pendente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
