import React, { useState, useEffect, useRef } from 'react';
import {
  Calculator,
  X,
  TrendingUp,
  TrendingDown,
  DollarSign,
  AlertTriangle,
  Calendar,
  Building2,
  User,
  Layers,
  Mic,
  Send,
  Volume2,
  VolumeX,
  Square,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { Transaction, PeriodFilter, FinancialArea, CalculationResult } from '../types';
import { formatCurrencyBRL } from '../utils/formatters';
import { speakFeedback } from '../utils/voiceFeedback';
import { AudioRecorder } from '../utils/audioRecorder';

interface FinancialCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactions: Transaction[];
  currentArea: FinancialArea;
  initialQuery?: string;
  voiceFeedbackEnabled: boolean;
}

const PERIOD_LABELS: { key: PeriodFilter; label: string }[] = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'esta_semana', label: 'Esta semana' },
  { key: 'este_mes', label: 'Este mês' },
  { key: 'ultimos_30_dias', label: 'Últimos 30 dias' },
  { key: 'geral', label: 'Geral' },
];

const SUGGESTED_QUERIES = [
  'Quanto gastei hoje?',
  'Quanto gastei no mercado este mês?',
  'Quanto entrou na empresa esta semana?',
  'Quanto tenho de contas para pagar?',
  'Quanto sobrou depois das despesas?',
];

export const FinancialCalculatorModal: React.FC<FinancialCalculatorModalProps> = ({
  isOpen,
  onClose,
  transactions,
  currentArea,
  initialQuery = '',
  voiceFeedbackEnabled,
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodFilter>('este_mes');
  const [selectedArea, setSelectedArea] = useState<FinancialArea>(currentArea || 'consolidado');
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [activeSpeechText, setActiveSpeechText] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [calculation, setCalculation] = useState<CalculationResult | null>(null);

  // Audio query recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recorderRef = useRef<AudioRecorder | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedArea(currentArea);
      if (initialQuery) {
        setQueryInput(initialQuery);
        executeCalculation(selectedPeriod, currentArea, initialQuery);
      } else {
        executeCalculation(selectedPeriod, currentArea, '');
      }
    } else {
      if (recorderRef.current?.isRecording) {
        recorderRef.current.cancel();
      }
      setIsRecording(false);
    }
  }, [isOpen, currentArea, initialQuery]);

  const executeCalculation = async (
    period: PeriodFilter,
    area: FinancialArea,
    questionText: string = ''
  ) => {
    setIsLoading(true);
    try {
      // 1. If user typed a question, we can parse intent first
      let parsedQuery: any = null;
      if (questionText.trim()) {
        const procResp = await fetch('/api/voice/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: questionText.trim(),
            currentArea: area === 'consolidado' ? 'pessoal' : area,
            currentDate: new Date().toISOString().split('T')[0],
          }),
        });
        if (procResp.ok) {
          const procData = await procResp.json();
          if (procData.query) {
            parsedQuery = procData.query;
            if (procData.query.periodo && procData.query.periodo !== 'geral') {
              period = procData.query.periodo as PeriodFilter;
              setSelectedPeriod(period);
            }
            if (procData.query.areaFiltro && procData.query.areaFiltro !== 'consolidado') {
              area = procData.query.areaFiltro as FinancialArea;
              setSelectedArea(area);
            }
          }
        }
      }

      // 2. Perform exact calculations on real transactions
      const calcResp = await fetch('/api/voice/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactions,
          period,
          area,
          query: parsedQuery,
        }),
      });

      if (calcResp.ok) {
        const result: CalculationResult = await calcResp.json();
        setCalculation(result);
        setActiveSpeechText(result.speechText);

        if (voiceFeedbackEnabled && result.speechText) {
          speakFeedback(result.speechText);
        }
      }
    } catch (err) {
      console.error('Calculation error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePeriodChange = (p: PeriodFilter) => {
    setSelectedPeriod(p);
    executeCalculation(p, selectedArea, queryInput);
  };

  const handleAreaChange = (a: FinancialArea) => {
    setSelectedArea(a);
    executeCalculation(selectedPeriod, a, queryInput);
  };

  const handleQuerySubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    executeCalculation(selectedPeriod, selectedArea, queryInput);
  };

  const handleStartAudioQuery = async () => {
    try {
      const recorder = new AudioRecorder({
        onTimeUpdate: (sec) => setRecordingSeconds(sec),
      });
      recorderRef.current = recorder;
      await recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
    } catch (err: any) {
      alert(err.message || 'Erro ao iniciar microfone.');
    }
  };

  const handleStopAudioQuery = async () => {
    if (!recorderRef.current || !isRecording) return;
    setIsLoading(true);
    try {
      const { base64, mimeType } = await recorderRef.current.stop();
      setIsRecording(false);

      // Transcribe via backend
      const resp = await fetch('/api/voice/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: base64,
          mimeType,
          currentArea: selectedArea === 'consolidado' ? 'pessoal' : selectedArea,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const recognized = data.transcription || '';
        setQueryInput(recognized);
        await executeCalculation(selectedPeriod, selectedArea, recognized);
      }
    } catch (err) {
      console.error('Error in audio query:', err);
    } finally {
      setIsRecording(false);
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-xl bg-[#0e1017] border border-slate-800 rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Accent Bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 via-rose-500 to-fuchsia-500" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/20">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Calcular Meu Financeiro
              </h2>
              <p className="text-[11px] text-slate-400">
                Totais calculados em tempo real com base nos seus registros reais
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[85vh] overflow-y-auto">
          {/* Quick Filters Row: Area & Period */}
          <div className="space-y-3">
            {/* Area Filter */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">Área Financeira:</span>
              <div className="flex gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl">
                {(['consolidado', 'pessoal', 'empresa'] as FinancialArea[]).map((area) => (
                  <button
                    key={area}
                    type="button"
                    onClick={() => handleAreaChange(area)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-all ${
                      selectedArea === area
                        ? area === 'pessoal'
                          ? 'bg-rose-500 text-white'
                          : area === 'empresa'
                          ? 'bg-amber-500 text-slate-950 font-bold'
                          : 'bg-slate-700 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {area === 'consolidado'
                      ? 'Consolidado'
                      : area === 'pessoal'
                      ? 'Pessoal (CPF)'
                      : 'Empresa (CNPJ)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Period Filter Buttons */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {PERIOD_LABELS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handlePeriodChange(key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                    selectedPeriod === key
                      ? 'bg-gradient-to-r from-rose-500/20 to-amber-500/20 text-rose-300 border border-rose-500/40 font-bold'
                      : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Interactive Natural Language Question / Voice Box */}
          <div className="space-y-2">
            <form onSubmit={handleQuerySubmit} className="relative flex items-center">
              <input
                type="text"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="Pergunte por voz ou texto: Ex. Quanto gastei no mercado este mês?"
                className="w-full pl-3.5 pr-20 py-3 bg-slate-900/90 border border-slate-700/80 rounded-2xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-all"
              />

              <div className="absolute right-1.5 flex items-center gap-1">
                {isRecording ? (
                  <button
                    type="button"
                    onClick={handleStopAudioQuery}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-600 text-white text-[11px] font-bold animate-pulse"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    Parar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartAudioQuery}
                    className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                    title="Perguntar por áudio"
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="p-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold shadow-md shadow-amber-500/20 transition-all disabled:opacity-50"
                  title="Calcular"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>

            {/* Quick Suggestions Chips */}
            <div className="flex flex-wrap gap-1">
              {SUGGESTED_QUERIES.map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setQueryInput(q);
                    executeCalculation(selectedPeriod, selectedArea, q);
                  }}
                  className="text-[10px] px-2.5 py-1 rounded-lg bg-slate-900/70 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800/80 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Voice Response Strip / AI Summary */}
          {activeSpeechText && (
            <div className="p-3.5 rounded-2xl bg-gradient-to-r from-rose-950/40 to-amber-950/40 border border-amber-500/30 flex items-start justify-between gap-3 text-xs">
              <div className="flex items-start gap-2.5 text-amber-200">
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-white block mb-0.5">Resposta do Cálculo:</span>
                  <p className="leading-relaxed">{activeSpeechText}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => speakFeedback(activeSpeechText, true)}
                className="p-1.5 rounded-lg text-amber-300 hover:bg-amber-500/20 transition-colors shrink-0"
                title="Ouvir novamente"
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Real Financial Totals Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* Receitas */}
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-emerald-500/20 space-y-1">
              <span className="text-[11px] font-medium text-emerald-400 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" /> Total Receitas
              </span>
              <p className="text-lg font-black text-emerald-300">
                {formatCurrencyBRL(calculation?.totalReceitas || 0)}
              </p>
            </div>

            {/* Despesas */}
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-rose-500/20 space-y-1">
              <span className="text-[11px] font-medium text-rose-400 flex items-center gap-1">
                <TrendingDown className="w-3.5 h-3.5" /> Total Despesas
              </span>
              <p className="text-lg font-black text-rose-300">
                {formatCurrencyBRL(calculation?.totalDespesas || 0)}
              </p>
            </div>

            {/* Saldo Calculado */}
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1 col-span-2 sm:col-span-1">
              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5 text-amber-400" /> Saldo Líquido
              </span>
              <p
                className={`text-lg font-black ${
                  (calculation?.saldoCalculado || 0) >= 0 ? 'text-white' : 'text-rose-400'
                }`}
              >
                {formatCurrencyBRL(calculation?.saldoCalculado || 0)}
              </p>
            </div>
          </div>

          {/* Pending Bills Row */}
          <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-300">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>
                Contas pendentes no período:{' '}
                <strong className="text-amber-300">
                  {calculation?.pendentesCount || 0} lançamento(s)
                </strong>
              </span>
            </div>
            <div className="font-bold text-amber-300">
              {formatCurrencyBRL(calculation?.pendentePagar || 0)}
            </div>
          </div>

          {/* Specific Query Match details if any */}
          {calculation?.matchingAmount !== null && calculation?.matchingAmount !== undefined && (
            <div className="p-3.5 rounded-xl bg-slate-900 border border-rose-500/30 flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium">{calculation.matchingDetails}</span>
              <span className="font-extrabold text-rose-400 text-sm">
                {formatCurrencyBRL(calculation.matchingAmount)}
              </span>
            </div>
          )}

          {/* Footer Note */}
          <div className="text-center text-[11px] text-slate-500">
            Valores computados diretamente dos registros reais. Não inclui previsões nem transferências internas.
          </div>
        </div>
      </div>
    </div>
  );
};
