// Funções puras: datas (strings YYYY-MM-DD, sem fuso), dinheiro e cálculos do mês.
export const pad = n => String(n).padStart(2, '0');
export const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const ultimoDia = (y, m) => new Date(y, m, 0).getDate(); // m de 1 a 12
export const comDia = (y, m, d) => `${y}-${pad(m)}-${pad(Math.min(d, ultimoDia(y, m)))}`;

export function addMeses(iso, n) {
  let [y, m, d] = iso.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = (((m - 1) % 12) + 12) % 12 + 1;
  return comDia(y, m, d);
}
export const prevMes = (ym, n) => addMeses(ym + '-01', n).slice(0, 7);
export function addDias(iso, n) {
  const [y, m, d] = iso.split('-').map(Number), t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
// ponytail: ignora feriados; trocar por tabela de feriados se precisar
export function ultimoDiaUtil(y, m) {
  let d = ultimoDia(y, m);
  while ([0, 6].includes(new Date(y, m - 1, d).getDay())) d--;
  return comDia(y, m, d);
}

// Compra no crédito -> data em que entra na conta.
// Com dia de fechamento: compra antes do fechamento cai na fatura do mês, no dia/depois cai na do mês seguinte.
// Sem fechamento (cartão de loja): vence no mesmo dia, um mês depois.
export function primeiraCobranca(dataCompra, banco) {
  if (!banco?.dia_fechamento) return addMeses(dataCompra, 1);
  const [y, m, d] = dataCompra.split('-').map(Number);
  const [fy, fm] = (d >= banco.dia_fechamento ? addMeses(`${y}-${pad(m)}-01`, 1) : `${y}-${pad(m)}-01`).split('-').map(Number);
  if (!banco.dia_vencimento) return comDia(fy, fm, banco.dia_fechamento);
  if (banco.dia_vencimento > banco.dia_fechamento) return comDia(fy, fm, banco.dia_vencimento);
  return addMeses(comDia(fy, fm, banco.dia_vencimento), 1);
}

export const c2 = v => Math.round(v * 100) / 100;
export function parseValor(s) {
  s = String(s).trim().replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return c2(parseFloat(s));
}
export const soma = (ls, f) => ls.reduce((a, l) => a + (f(l) ? Math.round(l.valor * 100) : 0), 0) / 100;

// Divide uma compra em n parcelas (centavos que sobram vão na 1ª)
export function parcelar(base, n, modo) {
  if (n <= 1) return [base];
  const cents = Math.round(base.valor * 100), tot = modo === 'parcela' ? cents * n : cents;
  const p = Math.floor(tot / n), resto = tot - p * n, grupo = crypto.randomUUID();
  return Array.from({ length: n }, (_, k) => ({
    ...base, valor: (p + (k ? 0 : resto)) / 100, data: addMeses(base.data, k),
    parcela_grupo: grupo, parcela_num: k + 1, parcela_total: n,
  }));
}

// Vale é separado: não entra nas despesas nem nas entradas "normais"
export function calcular(ls, pct = 30) {
  const r = {
    entradas: soma(ls, l => l.tipo === 'entrada' && l.origem !== 'vale'),
    vale: soma(ls, l => l.tipo === 'entrada' && l.origem === 'vale'),
    despesas: soma(ls, l => l.tipo === 'saida' && l.forma_pagamento !== 'vale'),
    gastosVale: soma(ls, l => l.tipo === 'saida' && l.forma_pagamento === 'vale'),
    investido: soma(ls, l => l.tipo === 'investimento'),
    aPagar: soma(ls, l => l.tipo === 'saida' && !l.pago),
    aReceber: soma(ls, l => l.tipo === 'entrada' && !l.pago),
  };
  r.sobra = c2(r.entradas - r.despesas);
  r.valeAtual = c2(r.vale - r.gastosVale);
  r.saldoComVale = c2(r.sobra + r.valeAtual);
  r.saldoMenosInvest = c2(r.sobra - r.investido);
  r.sugestao = Math.max(0, c2(r.sobra * pct / 100));
  return r;
}
