import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Initialize Google GenAI client if GEMINI_API_KEY is present
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Modelos (podem ser trocados por variáveis de ambiente no Render, sem mexer no código)
const MODEL_TEXT = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';
const MODEL_TEXT_BACKUP = process.env.GEMINI_TEXT_BACKUP_MODEL || 'gemini-3.6-flash';
const MODEL_TRANSCRIBE = process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isTemporaryError(err: any): boolean {
  const msg = String(err?.message || '');
  return (
    [429, 500, 503, 504].includes(Number(err?.status)) ||
    /UNAVAILABLE|high demand|overloaded|RESOURCE_EXHAUSTED/i.test(msg)
  );
}

/**
 * Chama o Gemini tentando cada modelo da lista; em erro temporário (503/429)
 * espera um pouco e tenta de novo antes de passar para o próximo modelo.
 */
async function generateWithRetry(models: string[], request: any): Promise<any> {
  if (!ai) throw new Error('Serviço de IA não configurado.');
  let lastErr: any = null;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await ai.models.generateContent({ ...request, model });
      } catch (err: any) {
        lastErr = err;
        console.warn(`Gemini (${model}) tentativa ${attempt + 1} falhou:`, err?.status || '', String(err?.message || '').slice(0, 160));
        if (!isTemporaryError(err)) break; // erro permanente: troca de modelo
        await sleep(700 * (attempt + 1));
      }
    }
  }
  throw lastErr || new Error('Falha ao chamar a IA.');
}

/**
 * Lê a transcrição da resposta. O modelo de transcrição devolve o texto numa parte
 * "audioTranscription" (que não é texto comum), então olhamos as partes antes de usar .text
 */
function extractTranscript(resp: any): string {
  const parts = resp?.candidates?.[0]?.content?.parts || [];
  const pieces: string[] = [];
  for (const p of parts) {
    const t = p?.audioTranscription;
    if (typeof t === 'string') pieces.push(t);
    else if (t && typeof t === 'object') pieces.push(t.text || t.transcript || t.transcription || '');
    else if (typeof p?.text === 'string') pieces.push(p.text);
  }
  const joined = pieces.join(' ').trim();
  if (joined) return joined;
  try {
    return String(resp?.text || '').trim();
  } catch {
    return '';
  }
}

// O navegador envia "audio/webm;codecs=opus"; o Gemini aceita melhor só "audio/webm"
function cleanMime(m?: string): string {
  return (m || 'audio/webm').split(';')[0].trim() || 'audio/webm';
}

/**
 * Health check endpoint
 */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    time: new Date().toISOString(),
  });
});

/**
 * Fallback natural language rule parser for Brazilian Portuguese finance
 * Works even when Gemini API key is missing or offline
 */
function localRuleBasedParser(text: string, currentArea: 'pessoal' | 'empresa' = 'pessoal') {
  const lower = text.toLowerCase().trim();

  // 1. Detect if it's a query ("quanto...", "qual o...", "quanto tenho", "quanto sobrou")
  const isQuery =
    lower.startsWith('quanto') ||
    lower.startsWith('qual') ||
    lower.includes('quanto gastei') ||
    lower.includes('quanto recebi') ||
    lower.includes('quanto sobrou') ||
    lower.includes('quanto entrou') ||
    lower.includes('quanto tenho') ||
    lower.includes('contas para pagar');

  if (isQuery) {
    let queryPeriod: 'hoje' | 'esta_semana' | 'este_mes' | 'ultimos_30_dias' | 'geral' = 'este_mes';
    if (lower.includes('hoje')) queryPeriod = 'hoje';
    else if (lower.includes('semana')) queryPeriod = 'esta_semana';
    else if (lower.includes('mês') || lower.includes('mes')) queryPeriod = 'este_mes';
    else if (lower.includes('30 dias')) queryPeriod = 'ultimos_30_dias';

    let queryType: 'despesa' | 'receita' | 'pendente' | 'todos' = 'todos';
    if (lower.includes('gastei') || lower.includes('despesa') || lower.includes('paguei')) queryType = 'despesa';
    else if (lower.includes('recebi') || lower.includes('entrou') || lower.includes('ganhei')) queryType = 'receita';
    else if (lower.includes('pagar') || lower.includes('pendente') || lower.includes('devo')) queryType = 'pendente';

    let categoryFilter: string | null = null;
    if (lower.includes('mercado')) categoryFilter = 'Mercado';
    else if (lower.includes('gasolina') || lower.includes('combustivel') || lower.includes('combustível')) categoryFilter = 'Transporte';
    else if (lower.includes('internet')) categoryFilter = 'Contas & Serviços';
    else if (lower.includes('almoço') || lower.includes('restaurante') || lower.includes('comida')) categoryFilter = 'Alimentação';

    return {
      intent: 'consulta',
      query: {
        tipo: queryType,
        periodo: queryPeriod,
        categoriaFiltro: categoryFilter,
        areaFiltro: lower.includes('empresa') ? 'empresa' : lower.includes('pessoal') ? 'pessoal' : 'consolidado',
        perguntaOriginal: text,
      },
      message: 'Consulta financeira identificada.',
    };
  }

  // 2. Detect if it's a future intention / planning ("quero gastar", "pretendo gastar", "vou comprar")
  const isPlanning =
    lower.startsWith('quero gastar') ||
    lower.startsWith('pretendo gastar') ||
    lower.startsWith('vou comprar') ||
    lower.startsWith('planejo gastar') ||
    lower.includes('quero comprar');

  if (isPlanning) {
    // Extract planned amount
    const valMatch = text.match(/(?:r\$\s*|reais\s*)?(\d+(?:[.,]\d+)?)(?:\s*mil)?(?:\s*reais)?/i);
    let valor: number | null = null;
    if (valMatch) {
      let num = parseFloat(valMatch[1].replace(',', '.'));
      if (lower.includes('mil')) num *= 1000;
      valor = num;
    }
    return {
      intent: 'planejamento',
      valor,
      mensagem:
        'Identificamos uma intenção futura ou planejamento. Para preservar a precisão do seu saldo real, essa movimentação NÃO foi contabilizada como despesa realizada. Deseja adicionar uma meta ou orçamento?',
    };
  }

  // 3. Financial Transaction Registration (Expense, Income, Transfer)
  let tipo: 'despesa' | 'receita' | 'transferencia' = 'despesa';
  if (lower.includes('recebi') || lower.includes('ganhei') || lower.includes('entrou') || lower.includes('venda') || lower.includes('faturamento') || lower.includes('cliente pagou')) {
    tipo = 'receita';
  } else if (lower.includes('transferi') || lower.includes('transferência') || lower.includes('transferencia') || (lower.includes('para minha conta') && lower.includes('empresa'))) {
    tipo = 'transferencia';
  }

  // Extract monetary value: e.g. "300 reais", "R$ 300,00", "2 mil reais", "1.000 reais", "80", "150"
  let valor: number | null = null;
  const milRegex = /(\d+(?:[.,]\d+)?)\s*mil/i;
  const milMatch = text.match(milRegex);
  if (milMatch) {
    valor = parseFloat(milMatch[1].replace(',', '.')) * 1000;
  } else {
    // Check for Brazilian format like "1.000" or "1.000,00"
    const brThousandMatch = text.match(/\b(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?)\b/);
    if (brThousandMatch) {
      const cleanNum = brThousandMatch[1].replace(/\./g, '').replace(',', '.');
      const parsed = parseFloat(cleanNum);
      if (!isNaN(parsed) && parsed > 0) {
        valor = parsed;
      }
    }

    if (valor === null) {
      const matches = [...text.matchAll(/\b(?:r\$\s*)?(\d+(?:[.,]\d{2})?|\d+)(?:\s*reais)?\b/gi)];
      for (const m of matches) {
        const numStr = m[1].replace(',', '.');
        const parsed = parseFloat(numStr);
        if (!isNaN(parsed) && parsed > 0 && parsed !== 2026) {
          valor = parsed;
          break;
        }
      }
    }
  }

  // Area inference
  let area: 'pessoal' | 'empresa' = currentArea;
  let areaInferredFromContext = true;
  if (lower.includes('empresa') || lower.includes('cnpj') || lower.includes('cliente') || lower.includes('software') || lower.includes('pj') || lower.includes('negócio') || lower.includes('trabalho')) {
    area = 'empresa';
    areaInferredFromContext = false;
  } else if (lower.includes('pessoal') || lower.includes('cpf') || lower.includes('casa') || lower.includes('família')) {
    area = 'pessoal';
    areaInferredFromContext = false;
  }

  // Category inference
  let categoria = 'Outros';
  if (lower.includes('mercado') || lower.includes('supermercado') || lower.includes('feira') || lower.includes('compras')) {
    categoria = 'Mercado';
  } else if (lower.includes('gasolina') || lower.includes('abasteci') || lower.includes('combustível') || lower.includes('combustivel') || lower.includes('posto')) {
    categoria = 'Combustível';
  } else if (lower.includes('almoço') || lower.includes('almoco') || lower.includes('jantar') || lower.includes('lanche') || lower.includes('restaurante') || lower.includes('ifood')) {
    categoria = 'Alimentação';
  } else if (lower.includes('internet') || lower.includes('luz') || lower.includes('água') || lower.includes('energia') || lower.includes('condomínio') || lower.includes('aluguel')) {
    categoria = 'Contas & Utilidades';
  } else if (lower.includes('software') || lower.includes('serviço de ti') || lower.includes('assinatura') || lower.includes('ferramenta') || lower.includes('hospedagem')) {
    categoria = 'Software & Ferramentas';
  } else if (tipo === 'receita') {
    categoria = area === 'empresa' ? 'Serviços Prestados' : 'Rendimento';
  } else if (tipo === 'transferencia') {
    categoria = 'Transferência';
  }

  // Payment method (ONLY if explicitly mentioned)
  let formaPagamento: string | null = null;
  if (lower.includes('pix')) formaPagamento = 'Pix';
  else if (lower.includes('cartão de crédito') || lower.includes('cartao de credito') || lower.includes('crédito')) formaPagamento = 'Cartão de Crédito';
  else if (lower.includes('cartão de débito') || lower.includes('cartao de debito') || lower.includes('débito')) formaPagamento = 'Cartão de Débito';
  else if (lower.includes('dinheiro') || lower.includes('em espécie')) formaPagamento = 'Dinheiro';
  else if (lower.includes('boleto')) formaPagamento = 'Boleto';

  // Bank Account (ONLY if mentioned)
  let conta: string | null = null;
  if (lower.includes('nubank')) conta = 'Nubank';
  else if (lower.includes('inter') || lower.includes('banco inter')) conta = 'Banco Inter';
  else if (lower.includes('itaú') || lower.includes('itau')) conta = 'Itaú';
  else if (lower.includes('bradesco')) conta = 'Bradesco';
  else if (lower.includes('santander')) conta = 'Santander';

  // Status
  let status: 'concluido' | 'pendente' = 'concluido';
  if (lower.includes('a pagar') || lower.includes('para pagar') || lower.includes('vence') || lower.includes('pendente') || lower.includes('fatura')) {
    status = 'pendente';
  }

  // Transfer details
  let transferenciaDetalhes: { origem: 'empresa' | 'pessoal'; destino: 'empresa' | 'pessoal' } | null = null;
  if (tipo === 'transferencia') {
    if (lower.includes('empresa para') || lower.includes('da empresa')) {
      transferenciaDetalhes = { origem: 'empresa', destino: 'pessoal' };
    } else {
      transferenciaDetalhes = { origem: 'pessoal', destino: 'empresa' };
    }
  }

  // Description cleanup
  let descricao = text.trim();
  if (descricao.length > 50) {
    descricao = descricao.slice(0, 50);
  }

  const todayStr = new Date().toISOString().split('T')[0];

  return {
    intent: 'registro',
    dados: {
      tipo,
      valor,
      descricao: descricao || (tipo === 'despesa' ? 'Despesa registrada' : 'Receita registrada'),
      categoria,
      area,
      areaInferredFromContext,
      data: todayStr,
      formaPagamento,
      conta,
      status,
      recorrencia: lower.includes('mensal') ? 'Mensal' : null,
      transferenciaDetalhes,
    },
  };
}

/**
 * Route: POST /api/voice/process
 * Accepts audio (base64) OR raw text and produces real transcription + structured financial intent
 */
app.post('/api/voice/process', async (req, res) => {
  try {
    const { audioBase64, mimeType, text, currentArea = 'pessoal', currentDate } = req.body;

    let recognizedText = (text || '').trim();
    const effectiveDate = currentDate || new Date().toISOString().split('T')[0];

    // 1. If audio is provided, perform REAL audio transcription using Gemini API
    if (audioBase64) {
      if (!ai) {
        return res.status(503).json({
          error: 'Serviço de IA não configurado no servidor. Utilize a digitação direta.',
        });
      }

      const audioPart = {
        inlineData: { mimeType: cleanMime(mimeType), data: audioBase64 },
      };
      const transcribePrompt =
        'Você é o assistente de voz do aplicativo financeiro DUARTY. Transcreva com fidelidade absoluta o áudio em português do Brasil. ' +
        'Retorne APENAS a transcrição exata das palavras faladas pelo usuário, sem aspas e sem comentários.';

      try {
        // 1) modelo de texto (devolve a transcrição como texto normal) ; 2) modelo de transcrição dedicado
        const attempts: string[][] = [[MODEL_TEXT, MODEL_TEXT_BACKUP], [MODEL_TRANSCRIBE]];
        let lastError: any = null;
        for (const models of attempts) {
          try {
            const resp = await generateWithRetry(models, {
              contents: { parts: [audioPart, { text: transcribePrompt }] },
            });
            recognizedText = extractTranscript(resp);
            if (recognizedText) break;
            console.warn('Transcrição vazia com os modelos:', models.join(', '));
          } catch (e: any) {
            lastError = e;
            console.error('Erro de transcrição com', models.join(', '), ':', e?.message || e);
          }
        }
        if (!recognizedText) {
          if (lastError && isTemporaryError(lastError)) {
            return res.status(503).json({
              error: 'A IA está sobrecarregada no momento. Tente de novo em alguns segundos ou digite o lançamento.',
            });
          }
          return res.status(400).json({
            error: 'Não foi possível reconhecer o áudio gravado. Fale com clareza ou digite o lançamento.',
          });
        }
      } catch (err: any) {
        console.error('Audio transcription error:', err);
        return res.status(400).json({ error: 'Falha no processamento do áudio. Tente digitar o lançamento.' });
      }
    }

    if (!recognizedText) {
      return res.status(400).json({
        error: 'Nenhum texto ou áudio fornecido para processamento.',
      });
    }

    // 2. Interpret natural language using Gemini 3.8 Flash with structured Schema
    if (ai) {
      try {
        const systemInstruction = `Você é o motor de compreensão financeira do DUARTY.
Analise a frase do usuário em português brasileiro e classifique a intenção com rigor:
1. "registro": Quando o usuário relata um gasto ocorrido, receita recebida ou transferência feita. Ex: "Gastei 300 reais no mercado", "Abasteci 200 reais de gasolina", "Paguei 150 de internet", "Recebi 2 mil", "Transferi 1000 da empresa para o pessoal".
2. "consulta": Quando o usuário pergunta sobre seus totais, saldos ou gastos. Ex: "Quanto gastei hoje?", "Quanto gastei no mercado?", "Quanto sobrou?".
3. "planejamento": Quando o usuário expressa uma intenção futura ou orçamento ainda NÃO realizado. Ex: "Quero gastar 300 no mercado", "Pretendo comprar um carro", "Vou gastar semana que vem". NUNCA marque planejamento como gasto efetivado!
4. "outro": Outras mensagens.

Regras de extração para "registro":
- tipo: "despesa", "receita" ou "transferencia".
- valor: número decimal correspondente ao valor (ex: "300 reais" -> 300; "2 mil" -> 2000; "80 reais" -> 80). Se não mencionado valor, retorne null.
- descricao: descrição curta e profissional (ex: "Compras no mercado", "Abastecimento do carro", "Internet fibra", "Serviço para cliente").
- categoria: escolha a categoria ideal (ex: "Mercado", "Combustível", "Alimentação", "Contas & Utilidades", "Software & Ferramentas", "Serviços Prestados", "Vendas", "Lazer", "Saúde", "Outros").
- area: "pessoal" ou "empresa". Se o usuário citou "empresa", "cliente", "software para empresa", "cnpj", marque "empresa". Se citou "pessoal", "cpf", marque "pessoal". Se não especificou, use a área padrão informada (${currentArea}) e marque areaInferredFromContext = true.
- data: Se falou "hoje", use "${effectiveDate}". Se falou "ontem", calcule o dia anterior. Caso contrário, use "${effectiveDate}".
- formaPagamento: Se e somente se o usuário mencionou Pix, Cartão de Crédito, Cartão de Débito, Dinheiro, Boleto, etc. NÃO INVENTE se não foi dito!
- conta: Se e somente se o usuário citou Nubank, Itaú, Inter, etc. NÃO INVENTE!
- status: "concluido" (se já pago/recebido) ou "pendente" (se a pagar, conta pendente, fatura).
- recorrencia: "Mensal", etc. se mencionado explicitamente.`;

        const geminiResponse = await generateWithRetry([MODEL_TEXT, MODEL_TEXT_BACKUP], {
          contents: `Frase do usuário: "${recognizedText}". Data atual de referência: ${effectiveDate}. Área ativa padrão: ${currentArea}.`,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                intent: {
                  type: Type.STRING,
                  description: 'registro, consulta, planejamento ou outro',
                },
                registro: {
                  type: Type.OBJECT,
                  properties: {
                    tipo: { type: Type.STRING },
                    valor: { type: Type.NUMBER, nullable: true },
                    descricao: { type: Type.STRING },
                    categoria: { type: Type.STRING },
                    area: { type: Type.STRING },
                    areaInferredFromContext: { type: Type.BOOLEAN },
                    data: { type: Type.STRING },
                    formaPagamento: { type: Type.STRING, nullable: true },
                    conta: { type: Type.STRING, nullable: true },
                    status: { type: Type.STRING },
                    recorrencia: { type: Type.STRING, nullable: true },
                    origemTransferencia: { type: Type.STRING, nullable: true },
                    destinoTransferencia: { type: Type.STRING, nullable: true },
                  },
                },
                consulta: {
                  type: Type.OBJECT,
                  properties: {
                    tipo: { type: Type.STRING },
                    periodo: { type: Type.STRING },
                    categoriaFiltro: { type: Type.STRING, nullable: true },
                    areaFiltro: { type: Type.STRING },
                  },
                },
                planejamentoMensagem: {
                  type: Type.STRING,
                  nullable: true,
                },
              },
              required: ['intent'],
            },
          },
        });

        const parsed = JSON.parse(geminiResponse.text || '{}');

        if (parsed.intent === 'registro' && parsed.registro) {
          const reg = parsed.registro;
          return res.json({
            transcription: recognizedText,
            intent: 'registro',
            dados: {
              tipo: reg.tipo || 'despesa',
              valor: typeof reg.valor === 'number' ? reg.valor : null,
              descricao: reg.descricao || recognizedText,
              categoria: reg.categoria || 'Outros',
              area: reg.area || currentArea,
              areaInferredFromContext: Boolean(reg.areaInferredFromContext),
              data: reg.data || effectiveDate,
              formaPagamento: reg.formaPagamento || null,
              conta: reg.conta || null,
              status: reg.status || 'concluido',
              recorrencia: reg.recorrencia || null,
              transferenciaDetalhes:
                reg.tipo === 'transferencia'
                  ? {
                      origem: reg.origemTransferencia || 'empresa',
                      destino: reg.destinoTransferencia || 'pessoal',
                    }
                  : null,
            },
          });
        } else if (parsed.intent === 'consulta') {
          return res.json({
            transcription: recognizedText,
            intent: 'consulta',
            query: {
              tipo: parsed.consulta?.tipo || 'todos',
              periodo: parsed.consulta?.periodo || 'este_mes',
              categoriaFiltro: parsed.consulta?.categoriaFiltro || null,
              areaFiltro: parsed.consulta?.areaFiltro || 'consolidado',
              perguntaOriginal: recognizedText,
            },
          });
        } else if (parsed.intent === 'planejamento') {
          return res.json({
            transcription: recognizedText,
            intent: 'planejamento',
            mensagem:
              parsed.planejamentoMensagem ||
              'Identificamos uma intenção futura ou planejamento. Para proteger seus números reais, isso NÃO foi lançado como gasto já efetuado.',
          });
        }
      } catch (geminiErr) {
        console.warn('Gemini extraction parsing warning, falling back to local heuristic:', geminiErr);
      }
    }

    // Fallback: local deterministic parser
    const localResult = localRuleBasedParser(recognizedText, currentArea);
    return res.json({
      transcription: recognizedText,
      ...localResult,
    });
  } catch (error: any) {
    console.error('API Error in /api/voice/process:', error);
    res.status(500).json({
      error: 'Erro interno ao processar áudio/texto: ' + (error.message || 'Erro desconhecido'),
    });
  }
});

/**
 * Route: POST /api/voice/calculate
 * Computes exact financial figures based on actual user transactions
 * and generates a natural spoken explanation
 */
app.post('/api/voice/calculate', async (req, res) => {
  try {
    const { transactions = [], query, period = 'este_mes', area = 'consolidado' } = req.body;

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Filter by area
    let filtered = [...transactions];
    if (area === 'pessoal') {
      filtered = filtered.filter((t: any) => t.area === 'pessoal');
    } else if (area === 'empresa') {
      filtered = filtered.filter((t: any) => t.area === 'empresa');
    }

    // Filter by period
    filtered = filtered.filter((t: any) => {
      const tDate = new Date(t.data);
      if (period === 'hoje') {
        return t.data === todayStr;
      }
      if (period === 'esta_semana') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return tDate >= weekAgo && tDate <= now;
      }
      if (period === 'este_mes') {
        return tDate.getMonth() === now.getMonth() && tDate.getFullYear() === now.getFullYear();
      }
      if (period === 'ultimos_30_dias') {
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return tDate >= thirtyDaysAgo && tDate <= now;
      }
      return true; // geral
    });

    // Calculate real numbers
    let totalReceitas = 0;
    let totalDespesas = 0;
    let pendentePagar = 0;
    let pendenteReceber = 0;
    let pendentesCount = 0;

    filtered.forEach((t: any) => {
      // Exclude internal transfers from consolidated revenue/expense to avoid double counting!
      if (t.tipo === 'transferencia') return;

      if (t.tipo === 'receita') {
        if (t.status === 'concluido') {
          totalReceitas += Number(t.valor) || 0;
        } else {
          pendenteReceber += Number(t.valor) || 0;
          pendentesCount++;
        }
      } else if (t.tipo === 'despesa') {
        if (t.status === 'concluido') {
          totalDespesas += Number(t.valor) || 0;
        } else {
          pendentePagar += Number(t.valor) || 0;
          pendentesCount++;
        }
      }
    });

    const saldoCalculado = totalReceitas - totalDespesas;
    const resultadoPeriodo = saldoCalculado;

    // Specific category filter if requested in query
    let matchingAmount: number | null = null;
    let matchingDetails = '';

    if (query?.categoriaFiltro) {
      const catLower = query.categoriaFiltro.toLowerCase();
      const catTxs = filtered.filter(
        (t: any) => t.categoria?.toLowerCase().includes(catLower) && t.tipo === 'despesa' && t.status === 'concluido'
      );
      matchingAmount = catTxs.reduce((acc: number, cur: any) => acc + (Number(cur.valor) || 0), 0);
      matchingDetails = `${catTxs.length} lançamento(s) na categoria ${query.categoriaFiltro}`;
    }

    // Natural speech response generator
    let speechText = '';
    const formatBR = (val: number) =>
      val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    if (filtered.length === 0) {
      speechText = 'Nenhuma movimentação registrada para o período selecionado. Seu saldo está zerado em R$ 0,00.';
    } else if (matchingAmount !== null) {
      speechText = `No período selecionado, você gastou ${formatBR(matchingAmount)} em ${query.categoriaFiltro}.`;
    } else if (query?.tipo === 'despesa') {
      speechText = `Suas despesas no período somam ${formatBR(totalDespesas)}.`;
    } else if (query?.tipo === 'receita') {
      speechText = `Suas receitas totalizam ${formatBR(totalReceitas)}.`;
    } else if (query?.tipo === 'pendente') {
      speechText = `Você possui ${pendentesCount} conta(s) pendente(s), somando ${formatBR(pendentePagar)} a pagar.`;
    } else {
      speechText = `Receitas de ${formatBR(totalReceitas)}, despesas de ${formatBR(totalDespesas)}. Saldo calculado de ${formatBR(saldoCalculado)}.`;
    }

    res.json({
      totalReceitas,
      totalDespesas,
      saldoCalculado,
      resultadoPeriodo,
      pendentePagar,
      pendenteReceber,
      pendentesCount,
      matchingAmount,
      matchingDetails,
      speechText,
      totalTransactions: filtered.length,
    });
  } catch (error: any) {
    console.error('Calculation API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Route: POST /api/voice/tts
 * Generates natural spoken audio feedback using gemini-3.8-flash-lite-tts
 */
app.post('/api/voice/tts', async (req, res) => {
  try {
    const { text, voiceName = 'Kore' } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Texto para fala é obrigatório.' });
    }

    if (!ai) {
      // Browser can use speechSynthesis fallback
      return res.status(503).json({ fallbackToBrowser: true });
    }

    const ttsResponse = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: text,
              speechMetadata: {
                style: 'Voz clara, profissional, calorosa de assistente financeiro premium',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' },
          },
        },
      },
    });

    const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      res.json({ audioBase64: base64Audio, format: 'audio/wav' });
    } else {
      res.status(500).json({ fallbackToBrowser: true });
    }
  } catch (error: any) {
    console.warn('TTS error (falling back to browser voice):', error.message);
    res.status(500).json({ fallbackToBrowser: true, message: error.message });
  }
});

// Setup Vite middleware in dev or static files in production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`DUARTY Server running at http://0.0.0.0:${port}`);
  });
}

startServer();
