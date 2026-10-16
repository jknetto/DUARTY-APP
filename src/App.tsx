import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  Mic,
  Calculator,
  TrendingUp,
  TrendingDown,
  DollarSign,
  AlertTriangle,
  Building2,
  User,
  Layers,
  Search,
  Filter,
  Trash2,
  CheckCircle2,
  Clock,
  Volume2,
  VolumeX,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRightLeft,
  Sparkles,
  RotateCcw,
  Tag,
  CreditCard,
  Calendar,
  Check,
} from 'lucide-react';
import { DuartyLogo } from './components/DuartyLogo';
import { QuickEntryModal } from './components/QuickEntryModal';
import { FinancialCalculatorModal } from './components/FinancialCalculatorModal';
import { Transaction, FinancialArea, TransactionType, PaymentStatus } from './types';
import { INITIAL_TRANSACTIONS } from './data/initialData';
import { formatCurrencyBRL, formatDateBR, getTodayISODate } from './utils/formatters';

const STORAGE_KEY = 'duarty_transactions_v3';
const VOICE_SETTING_KEY = 'duarty_voice_feedback_enabled';

export default function App() {
  // Persistence state - initializes 100% clean with R$ 0,00 and purges any legacy demo data
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    try {
      // Check if previous storage had demo seed data and clean it out
      const legacyV2 = localStorage.getItem('duarty_transactions_v2');
      if (legacyV2) {
        localStorage.removeItem('duarty_transactions_v2');
      }
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: Transaction[] = JSON.parse(saved);
        // Exclude any legacy mock or demo seed items
        return parsed.filter((t) => !t.id.startsWith('tx-seed-'));
      }
    } catch {}
    return INITIAL_TRANSACTIONS;
  });

  // Current financial view: 'consolidado' | 'pessoal' | 'empresa'
  const [activeArea, setActiveArea] = useState<FinancialArea>('consolidado');

  // Voice feedback toggle
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(VOICE_SETTING_KEY);
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  // Modals state
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false);
  const [quickEntryType, setQuickEntryType] = useState<TransactionType>('despesa');
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [calculatorInitialQuery, setCalculatorInitialQuery] = useState('');

  // Search & List filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('todos');

  // Toast confirmation
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Save transactions to local storage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  }, [transactions]);

  // Save voice setting
  useEffect(() => {
    try {
      localStorage.setItem(VOICE_SETTING_KEY, JSON.stringify(voiceEnabled));
    } catch {}
  }, [voiceEnabled]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  const openQuickEntry = (type: TransactionType = 'despesa') => {
    setQuickEntryType(type);
    setIsQuickEntryOpen(true);
  };

  const handleClearAllData = () => {
    if (confirm('Deseja zerar completamente o financeiro? Todas as movimentações serão apagadas e os saldos voltarão a R$ 0,00.')) {
      setTransactions([]);
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('duarty_transactions_v2');
      } catch {}
      showToast('Financeiro completamente zerado (R$ 0,00).');
    }
  };

  /**
   * Save a newly created transaction
   * Includes duplicate check to avoid accidental double clicks/entries
   */
  const handleSaveTransaction = (newTxData: Omit<Transaction, 'id' | 'criadoEm'>) => {
    // Check for exact duplicate within last 2 minutes
    const isDuplicate = transactions.some((t) => {
      const diffTime = Math.abs(Date.now() - new Date(t.criadoEm).getTime());
      return (
        t.valor === newTxData.valor &&
        t.categoria === newTxData.categoria &&
        t.tipo === newTxData.tipo &&
        t.area === newTxData.area &&
        t.data === newTxData.data &&
        diffTime < 120000 // 2 minutes
      );
    });

    if (isDuplicate) {
      showToast('Aviso: Movimentação idêntica já havia sido registrada recentemente.');
      return;
    }

    const createdTx: Transaction = {
      ...newTxData,
      id: 'tx-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      criadoEm: new Date().toISOString(),
    };

    setTransactions((prev) => [createdTx, ...prev]);

    const prefix =
      createdTx.tipo === 'despesa'
        ? 'Gasto registrado'
        : createdTx.tipo === 'receita'
        ? 'Receita registrada'
        : 'Transferência efetuada';
    showToast(`${prefix}: ${formatCurrencyBRL(createdTx.valor)} em ${createdTx.categoria}`);
  };

  const handleDeleteTransaction = (id: string) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    showToast('Lançamento removido.');
  };

  const handleToggleStatus = (id: string) => {
    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          const newStatus: PaymentStatus = t.status === 'concluido' ? 'pendente' : 'concluido';
          return { ...t, status: newStatus };
        }
        return t;
      })
    );
  };

  const handleResetData = () => {
    if (confirm('Deseja restaurar os dados de demonstração iniciais?')) {
      setTransactions(INITIAL_TRANSACTIONS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_TRANSACTIONS));
      showToast('Dados restaurados para o padrão.');
    }
  };

  // Filter transactions by area and search
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      // Area filter
      if (activeArea !== 'consolidado' && t.area !== activeArea) {
        return false;
      }
      // Type filter
      if (selectedTypeFilter === 'despesa' && t.tipo !== 'despesa') return false;
      if (selectedTypeFilter === 'receita' && t.tipo !== 'receita') return false;
      if (selectedTypeFilter === 'transferencia' && t.tipo !== 'transferencia') return false;
      if (selectedTypeFilter === 'pendente' && t.status !== 'pendente') return false;

      // Search term
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchDesc = t.descricao.toLowerCase().includes(q);
        const matchCat = t.categoria.toLowerCase().includes(q);
        const matchConta = t.conta?.toLowerCase().includes(q);
        const matchForma = t.formaPagamento?.toLowerCase().includes(q);
        return matchDesc || matchCat || matchConta || matchForma;
      }

      return true;
    });
  }, [transactions, activeArea, selectedTypeFilter, searchTerm]);

  // Overall Financial Totals
  const totals = useMemo(() => {
    let receitas = 0;
    let despesas = 0;
    let pendentePagar = 0;
    let pendenteReceber = 0;

    transactions.forEach((t) => {
      // Exclude transfers from income/expense sums to prevent artificial duplication
      if (t.tipo === 'transferencia') return;

      if (activeArea !== 'consolidado' && t.area !== activeArea) return;

      if (t.tipo === 'receita') {
        if (t.status === 'concluido') {
          receitas += t.valor;
        } else {
          pendenteReceber += t.valor;
        }
      } else if (t.tipo === 'despesa') {
        if (t.status === 'concluido') {
          despesas += t.valor;
        } else {
          pendentePagar += t.valor;
        }
      }
    });

    const saldo = receitas - despesas;
    return { receitas, despesas, saldo, pendentePagar, pendenteReceber };
  }, [transactions, activeArea]);

  // Category breakdown for expenses
  const categoryStats = useMemo(() => {
    const map: Record<string, number> = {};
    let totalExp = 0;

    transactions.forEach((t) => {
      if (t.tipo !== 'despesa' || t.status !== 'concluido') return;
      if (activeArea !== 'consolidado' && t.area !== activeArea) return;

      map[t.categoria] = (map[t.categoria] || 0) + t.valor;
      totalExp += t.valor;
    });

    return Object.entries(map)
      .map(([cat, amount]) => ({
        cat,
        amount,
        percent: totalExp > 0 ? Math.round((amount / totalExp) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [transactions, activeArea]);

  return (
    <div className="min-h-screen bg-[#07080c] text-slate-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif] selection:bg-rose-500/30 selection:text-rose-200">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-slate-900 border border-emerald-500/40 text-emerald-300 text-xs font-semibold shadow-2xl animate-in slide-in-from-top-4 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* TOP NAVIGATION BAR */}
      <header className="sticky top-0 z-40 bg-[#07080c]/85 backdrop-blur-md border-b border-slate-800/80 px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          {/* Brand Logo */}
          <DuartyLogo size="md" />

          {/* Center: Financial Area Switcher (CPF / CNPJ / Consolidado) */}
          <div className="hidden md:flex items-center p-1 bg-slate-900/90 border border-slate-800 rounded-2xl shadow-inner">
            <button
              onClick={() => setActiveArea('consolidado')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeArea === 'consolidado'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Consolidado
            </button>
            <button
              onClick={() => setActiveArea('pessoal')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeArea === 'pessoal'
                  ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              Pessoal (CPF)
            </button>
            <button
              onClick={() => setActiveArea('empresa')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeArea === 'empresa'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              Empresa (CNPJ)
            </button>
          </div>

            {/* Right Action Buttons */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Audio Voice Feedback toggle */}
            <button
              type="button"
              onClick={() => {
                const nextVal = !voiceEnabled;
                setVoiceEnabled(nextVal);
                showToast(nextVal ? 'Feedback por voz ativado' : 'Feedback por voz silenciado');
              }}
              className={`p-2.5 rounded-xl border transition-all ${
                voiceEnabled
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/20'
                  : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-400'
              }`}
              title={voiceEnabled ? 'Voz ativada (clique para silenciar)' : 'Voz silenciada'}
            >
              {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* SECONDARY ACTION: “Calcular meu financeiro” */}
            <button
              onClick={() => {
                setCalculatorInitialQuery('');
                setIsCalculatorOpen(true);
              }}
              className="hidden sm:flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-bold transition-all shadow-sm hover:border-amber-500/40"
            >
              <Calculator className="w-4 h-4 text-amber-400" />
              Calcular meu financeiro
            </button>

            {/* ACTION: “Registrar receita” */}
            <button
              onClick={() => openQuickEntry('receita')}
              className="hidden lg:flex items-center gap-1.5 px-3 py-2.5 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-bold transition-all"
            >
              <ArrowUpRight className="w-4 h-4" />
              Registrar receita
            </button>

            {/* PRIMARY CENTRAL ACTION: “Registrar gasto” */}
            <button
              onClick={() => openQuickEntry('despesa')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-fuchsia-600 via-rose-500 to-amber-500 text-white text-xs sm:text-sm font-extrabold shadow-lg shadow-rose-500/25 hover:opacity-95 active:scale-95 transition-all"
            >
              <Mic className="w-4 h-4" />
              Registrar gasto
            </button>
          </div>
        </div>

        {/* Mobile Area Switcher bar */}
        <div className="flex md:hidden items-center justify-center p-1 mt-2 bg-slate-900 border border-slate-800 rounded-xl">
          <button
            onClick={() => setActiveArea('consolidado')}
            className={`flex-1 py-1 rounded-lg text-[11px] font-semibold ${
              activeArea === 'consolidado' ? 'bg-slate-700 text-white' : 'text-slate-400'
            }`}
          >
            Consolidado
          </button>
          <button
            onClick={() => setActiveArea('pessoal')}
            className={`flex-1 py-1 rounded-lg text-[11px] font-semibold ${
              activeArea === 'pessoal' ? 'bg-rose-500 text-white' : 'text-slate-400'
            }`}
          >
            Pessoal (CPF)
          </button>
          <button
            onClick={() => setActiveArea('empresa')}
            className={`flex-1 py-1 rounded-lg text-[11px] font-semibold ${
              activeArea === 'empresa' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400'
            }`}
          >
            Empresa (CNPJ)
          </button>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-8 space-y-6">
        {/* HERO BANNER - Contextual for Zeroed or Active state */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-[#0f111a] to-[#12131d] border border-slate-800 p-5 sm:p-7 shadow-xl">
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-gradient-to-br from-rose-500/10 via-amber-500/10 to-transparent rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-5 relative z-10">
            <div className="space-y-1.5 max-w-xl">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider font-extrabold px-2.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/25">
                  DUARTY Voice & Quick Entry
                </span>
                <span className="text-xs text-slate-400">
                  {activeArea === 'pessoal'
                    ? 'Visualização Pessoal (CPF)'
                    : activeArea === 'empresa'
                    ? 'Visualização Empresa (CNPJ)'
                    : 'Visão Integrada Consolidada'}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                {transactions.length === 0 ? 'Seu financeiro começa aqui.' : 'Lançamento Financeiro Instantâneo'}
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                {transactions.length === 0
                  ? 'Seu controle financeiro pessoal e empresarial 100% limpo, sem valores fictícios. Fale ou digite sua primeira despesa ou receita para que o DUARTY organize seus números automaticamente.'
                  : 'Fale “Gastei 300 reais no mercado” ou consulte “Quanto gastei hoje?”. O DUARTY processa o áudio em tempo real e calcula seus totais com precisão.'}
              </p>
            </div>

            {/* Quick Action Buttons on Hero */}
            <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
              <button
                type="button"
                onClick={() => openQuickEntry('despesa')}
                className="flex-1 md:flex-initial flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-rose-500 to-amber-500 text-white font-extrabold text-xs sm:text-sm shadow-xl shadow-rose-500/20 hover:scale-[1.02] active:scale-95 transition-all"
              >
                <Mic className="w-4 h-4" />
                Registrar gasto
              </button>

              <button
                type="button"
                onClick={() => openQuickEntry('receita')}
                className="flex-1 md:flex-initial flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-bold text-xs sm:text-sm transition-all"
              >
                <ArrowUpRight className="w-4 h-4" />
                Registrar receita
              </button>

              <button
                type="button"
                onClick={() => {
                  setCalculatorInitialQuery('');
                  setIsCalculatorOpen(true);
                }}
                className="flex-1 md:flex-initial flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold text-xs sm:text-sm transition-all"
              >
                <Calculator className="w-4 h-4 text-amber-400" />
                Calcular meu financeiro
              </button>
            </div>
          </div>
        </section>

        {/* FINANCIAL KPI METRICS STRIP - Clean 100% Real Totals */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Card: Saldo Calculado */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-800/90 hover:border-slate-700 transition-all space-y-1">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>Saldo em Caixa</span>
              <DollarSign className="w-4 h-4 text-amber-400" />
            </div>
            <div
              className={`text-xl sm:text-2xl font-black ${
                totals.saldo > 0
                  ? 'text-emerald-400'
                  : totals.saldo < 0
                  ? 'text-rose-400'
                  : 'text-white'
              }`}
            >
              {formatCurrencyBRL(totals.saldo)}
            </div>
            <p className="text-[10px] text-slate-500">
              {totals.saldo === 0 && totals.receitas === 0 && totals.despesas === 0
                ? 'Resultado financeiro: R$ 0,00'
                : 'Receitas menos despesas pagas'}
            </p>
          </div>

          {/* Card: Receitas */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-800/90 hover:border-emerald-500/30 transition-all space-y-1">
            <div className="flex items-center justify-between text-emerald-400 text-xs font-semibold">
              <span className="flex items-center gap-1">
                <ArrowUpRight className="w-3.5 h-3.5" /> Receitas
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                {totals.receitas > 0 ? 'Pagas' : 'R$ 0,00'}
              </span>
            </div>
            <div className="text-xl sm:text-2xl font-black text-emerald-400">
              {formatCurrencyBRL(totals.receitas)}
            </div>
            <p className="text-[10px] text-slate-500">
              {totals.receitas === 0
                ? 'Suas receitas aparecerão aqui quando você registrar a primeira entrada.'
                : `A receber: ${formatCurrencyBRL(totals.pendenteReceber)}`}
            </p>
          </div>

          {/* Card: Despesas */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-800/90 hover:border-rose-500/30 transition-all space-y-1">
            <div className="flex items-center justify-between text-rose-400 text-xs font-semibold">
              <span className="flex items-center gap-1">
                <ArrowDownRight className="w-3.5 h-3.5" /> Despesas
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400">
                {totals.despesas > 0 ? 'Efetivadas' : 'R$ 0,00'}
              </span>
            </div>
            <div className="text-xl sm:text-2xl font-black text-rose-400">
              {formatCurrencyBRL(totals.despesas)}
            </div>
            <p className="text-[10px] text-slate-500">
              {totals.despesas === 0
                ? 'Registre seu primeiro gasto para começar a acompanhar suas despesas.'
                : 'Contabilizadas no período'}
            </p>
          </div>

          {/* Card: Contas Pendentes */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-slate-800/90 hover:border-amber-500/30 transition-all space-y-1">
            <div className="flex items-center justify-between text-amber-400 text-xs font-semibold">
              <span className="flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Contas a Pagar
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300">
                {totals.pendentePagar > 0 ? 'Pendentes' : 'Nenhuma'}
              </span>
            </div>
            <div className="text-xl sm:text-2xl font-black text-amber-300">
              {formatCurrencyBRL(totals.pendentePagar)}
            </div>
            <p className="text-[10px] text-slate-500">
              {totals.pendentePagar === 0
                ? 'Nenhuma conta pendente no momento'
                : 'Não deduzidas do saldo real'}
            </p>
          </div>
        </section>

        {/* TWO COLUMN GRID: CATEGORIES & RECENT ACTIVITY */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: Category Breakdown */}
          <div className="p-5 rounded-3xl bg-slate-900/70 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Tag className="w-4 h-4 text-rose-400" />
                Gastos por Categoria
              </h3>
              <span className="text-[11px] text-slate-400">{categoryStats.length} ativas</span>
            </div>

            {categoryStats.length === 0 ? (
              <div className="py-8 px-4 text-center space-y-3 bg-slate-950/40 rounded-2xl border border-slate-800/60">
                <p className="text-xs font-semibold text-slate-300">
                  Adicione movimentações para visualizar sua evolução financeira.
                </p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Seus relatórios e distribuição por categoria serão gerados conforme você registrar suas movimentações.
                </p>
                <button
                  type="button"
                  onClick={() => openQuickEntry('despesa')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-400 text-xs font-semibold transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar gasto
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {categoryStats.slice(0, 5).map(({ cat, amount, percent }) => (
                  <div key={cat} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-medium">{cat}</span>
                      <span className="text-slate-400 font-mono font-semibold">
                        {formatCurrencyBRL(amount)}{' '}
                        <span className="text-[10px] text-slate-500">({percent}%)</span>
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-rose-500 to-amber-400 rounded-full transition-all duration-500"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Quick Helper Button to calculate category */}
            <button
              onClick={() => {
                setCalculatorInitialQuery('Quanto gastei no mercado este mês?');
                setIsCalculatorOpen(true);
              }}
              className="w-full py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Perguntar gastos por categoria
            </button>
          </div>

          {/* RIGHT (2 Cols): TRANSACTIONS TABLE & FEED */}
          <div className="lg:col-span-2 p-5 rounded-3xl bg-slate-900/70 border border-slate-800 space-y-4">
            {/* Header with Search and Filter */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-sky-400" />
                  Movimentações Financeiras
                </h3>
                <p className="text-[11px] text-slate-400">
                  Mostrando {filteredTransactions.length} registro(s)
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-44">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar registro..."
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
                  />
                </div>

                <select
                  value={selectedTypeFilter}
                  onChange={(e) => setSelectedTypeFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 focus:outline-none"
                >
                  <option value="todos">Todos</option>
                  <option value="despesa">Despesas</option>
                  <option value="receita">Receitas</option>
                  <option value="transferencia">Transferências</option>
                  <option value="pendente">Pendentes</option>
                </select>
              </div>
            </div>

            {/* List */}
            {filteredTransactions.length === 0 ? (
              <div className="py-12 px-4 text-center space-y-3 bg-slate-950/30 rounded-2xl border border-slate-800/50">
                <div className="w-12 h-12 mx-auto rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
                  <Calendar className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-white">
                    {transactions.length === 0
                      ? 'Nenhuma movimentação registrada ainda.'
                      : 'Nenhum lançamento encontrado para os filtros aplicados.'}
                  </p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    {transactions.length === 0
                      ? 'Suas receitas e despesas aparecerão aqui quando você registrar a primeira entrada ou gasto por voz ou texto.'
                      : 'Tente alterar os termos de busca ou o filtro de categoria/tipo.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => openQuickEntry('despesa')}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold shadow-md shadow-rose-500/20 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" /> Registrar gasto
                  </button>
                  <button
                    type="button"
                    onClick={() => openQuickEntry('receita')}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold shadow-md shadow-emerald-500/20 transition-all"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" /> Registrar receita
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                {filteredTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/80 hover:border-slate-700 transition-all flex items-center justify-between gap-3 text-xs"
                  >
                    {/* Left: Icon & Description */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`p-2 rounded-xl shrink-0 ${
                          tx.tipo === 'despesa'
                            ? 'bg-rose-500/10 text-rose-400'
                            : tx.tipo === 'receita'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-blue-500/10 text-blue-400'
                        }`}
                      >
                        {tx.tipo === 'despesa' ? (
                          <ArrowDownRight className="w-4 h-4" />
                        ) : tx.tipo === 'receita' ? (
                          <ArrowUpRight className="w-4 h-4" />
                        ) : (
                          <ArrowRightLeft className="w-4 h-4" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-bold text-slate-200 truncate">{tx.descricao}</p>
                          {/* Method Badge (Voice vs Text vs Manual) */}
                          {tx.metodoEntrada === 'voz' && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-500/15 text-rose-400 flex items-center gap-0.5 font-bold">
                              <Mic className="w-2.5 h-2.5" /> Voz
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                          <span>{tx.categoria}</span>
                          <span>•</span>
                          <span>{formatDateBR(tx.data)}</span>
                          {tx.formaPagamento && (
                            <>
                              <span>•</span>
                              <span>{tx.formaPagamento}</span>
                            </>
                          )}
                          {tx.conta && (
                            <>
                              <span>•</span>
                              <span>{tx.conta}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Amount, Area Badge, and Actions */}
                    <div className="flex items-center gap-3 shrink-0">
                      {/* Area Badge */}
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${
                          tx.area === 'pessoal'
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                            : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                        }`}
                      >
                        {tx.area === 'pessoal' ? 'CPF' : 'CNPJ'}
                      </span>

                      {/* Status Toggle Badge */}
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(tx.id)}
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg transition-colors ${
                          tx.status === 'concluido'
                            ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                            : 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                        }`}
                        title="Clique para alternar entre Pago/Pendente"
                      >
                        {tx.status === 'concluido' ? 'Pago' : 'Pendente'}
                      </button>

                      {/* Amount */}
                      <div
                        className={`font-black font-mono text-sm ${
                          tx.tipo === 'despesa'
                            ? 'text-rose-400'
                            : tx.tipo === 'receita'
                            ? 'text-emerald-400'
                            : 'text-blue-400'
                        }`}
                      >
                        {tx.tipo === 'despesa' ? '-' : '+'}
                        {formatCurrencyBRL(tx.valor)}
                      </div>

                      {/* Delete */}
                      <button
                        type="button"
                        onClick={() => handleDeleteTransaction(tx.id)}
                        className="p-1 rounded text-slate-600 hover:text-rose-400 hover:bg-slate-900 transition-colors"
                        title="Excluir movimentação"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="mt-auto border-t border-slate-800/80 bg-[#07080c] py-4 px-4 sm:px-8 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-extrabold tracking-widest text-slate-400 uppercase">DUARTY</span>
            <span>— Separação Estrita CPF e CNPJ • Sem duplicidades financeiras</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleClearAllData}
              className="text-[11px] text-slate-500 hover:text-rose-400 flex items-center gap-1 transition-colors"
              title="Apagar todas as movimentações e zerar financeiro"
            >
              <RotateCcw className="w-3 h-3" /> Zerar financeiro (R$ 0,00)
            </button>
          </div>
        </div>
      </footer>

      {/* MOBILE FLOATING ACTION BUTTON (FAB) FOR ONE-HANDED QUICK LAUNCH */}
      <div className="sm:hidden fixed bottom-5 right-5 z-40 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setCalculatorInitialQuery('');
            setIsCalculatorOpen(true);
          }}
          className="p-3.5 rounded-full bg-slate-900 border border-slate-700 text-amber-400 shadow-xl shadow-black/60 active:scale-95 transition-transform"
          title="Calcular financeiro"
        >
          <Calculator className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() => openQuickEntry('despesa')}
          className="flex items-center gap-2 px-5 py-3.5 rounded-full bg-gradient-to-r from-fuchsia-600 via-rose-500 to-amber-500 text-white font-extrabold text-sm shadow-2xl shadow-rose-500/40 active:scale-95 transition-transform"
        >
          <Mic className="w-5 h-5 animate-pulse" />
          <span>Registrar gasto</span>
        </button>
      </div>

      {/* QUICK ENTRY MODAL (LANÇAMENTO INTELIGENTE) */}
      <QuickEntryModal
        isOpen={isQuickEntryOpen}
        onClose={() => setIsQuickEntryOpen(false)}
        currentArea={activeArea === 'consolidado' ? 'pessoal' : activeArea}
        defaultType={quickEntryType}
        onSaveTransaction={handleSaveTransaction}
        voiceFeedbackEnabled={voiceEnabled}
        onOpenCalculatorWithQuery={(query) => {
          setCalculatorInitialQuery(query);
          setIsCalculatorOpen(true);
        }}
      />

      {/* FINANCIAL CALCULATOR MODAL (CALCULAR MEU FINANCEIRO) */}
      <FinancialCalculatorModal
        isOpen={isCalculatorOpen}
        onClose={() => setIsCalculatorOpen(false)}
        transactions={transactions}
        currentArea={activeArea}
        initialQuery={calculatorInitialQuery}
        voiceFeedbackEnabled={voiceEnabled}
      />
    </div>
  );
}
