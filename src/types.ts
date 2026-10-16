export type FinancialArea = 'pessoal' | 'empresa' | 'consolidado';

export type TransactionType = 'despesa' | 'receita' | 'transferencia';

export type PaymentStatus = 'concluido' | 'pendente';

export interface Transaction {
  id: string;
  tipo: TransactionType;
  valor: number;
  descricao: string;
  categoria: string;
  area: 'pessoal' | 'empresa';
  data: string; // YYYY-MM-DD
  formaPagamento?: string; // Pix, Cartão de Crédito, Cartão de Débito, Boleto, Dinheiro
  conta?: string; // Nubank, Inter, Itaú, etc.
  status: PaymentStatus;
  recorrencia?: string;
  origem?: 'pessoal' | 'empresa';
  destino?: 'pessoal' | 'empresa';
  criadoEm: string;
  metodoEntrada: 'voz' | 'texto' | 'manual';
}

export interface InterpretedDraft {
  tipo: TransactionType;
  valor: number | null;
  descricao: string;
  categoria: string;
  area: 'pessoal' | 'empresa';
  areaInferredFromContext: boolean;
  data: string;
  formaPagamento?: string | null;
  conta?: string | null;
  status: PaymentStatus;
  recorrencia?: string | null;
  transferenciaDetalhes?: {
    origem: 'pessoal' | 'empresa';
    destino: 'pessoal' | 'empresa';
  } | null;
}

export type PeriodFilter = 'hoje' | 'esta_semana' | 'este_mes' | 'ultimos_30_dias' | 'geral';

export interface CalculationResult {
  totalReceitas: number;
  totalDespesas: number;
  saldoCalculado: number;
  resultadoPeriodo: number;
  pendentePagar: number;
  pendenteReceber: number;
  pendentesCount: number;
  matchingAmount: number | null;
  matchingDetails: string;
  speechText: string;
  totalTransactions: number;
}
