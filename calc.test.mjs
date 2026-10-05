// Rodar: node calc.test.mjs
import assert from 'node:assert/strict';
import { addMeses, ultimoDiaUtil, primeiraCobranca, parseValor, parcelar, calcular } from './calc.js';

assert.equal(addMeses('2026-10-20', 9), '2027-07-20');
assert.equal(addMeses('2027-01-31', 1), '2027-02-28');
assert.equal(addMeses('2027-01-15', -1), '2026-12-15');
assert.equal(ultimoDiaUtil(2026, 10), '2026-10-30'); // 31/10/2026 é sábado

const nubank = { dia_fechamento: 16 };
assert.equal(primeiraCobranca('2026-10-10', nubank), '2026-10-16');
assert.equal(primeiraCobranca('2026-10-16', nubank), '2026-11-16');
assert.equal(primeiraCobranca('2026-12-20', nubank), '2027-01-16');
assert.equal(primeiraCobranca('2026-10-10', { dia_fechamento: 16, dia_vencimento: 23 }), '2026-10-23');
assert.equal(primeiraCobranca('2026-10-10', { dia_fechamento: 28, dia_vencimento: 5 }), '2026-11-05');
assert.equal(primeiraCobranca('2026-09-19', null), '2026-10-19'); // cartão de loja

assert.equal(parseValor('1.064,21'), 1064.21);
assert.equal(parseValor('R$ 59,95'), 59.95);
assert.equal(parseValor('70.5'), 70.5);

const p = parcelar({ valor: 100, data: '2026-10-16' }, 3, 'total');
assert.deepEqual(p.map(x => x.valor), [33.34, 33.33, 33.33]);
assert.deepEqual(p.map(x => x.data), ['2026-10-16', '2026-11-16', '2026-12-16']);
assert.equal(parcelar({ valor: 59.95, data: '2026-10-19' }, 2, 'parcela')[1].valor, 59.95);

// Outubro/2026 deve bater com a planilha
const e = (origem, valor) => ({ tipo: 'entrada', origem, valor });
const s = valor => ({ tipo: 'saida', valor });
const out = [e('vale', 598), e('salario', 2463.20), e('adiantamento', 1829.46),
  ...[155.04, 70, 89.99, 89.90, 20, 58.03, 1064.21, 970.24, 59.95, 99.95, 640.78, 71.94, 80].map(s)];
const r = calcular(out, 30);
assert.equal(r.entradas, 4292.66);
assert.equal(r.despesas, 3470.03);
assert.equal(r.sobra, 822.63);
assert.equal(r.saldoComVale, 1420.63);
assert.equal(r.sugestao, 246.79);
assert.equal(r.sobra - r.sugestao, 575.84);
// gasto no vale não mexe no saldo normal
const r2 = calcular([...out, { tipo: 'saida', forma_pagamento: 'vale', valor: 100 }], 30);
assert.equal(r2.sobra, 822.63);
assert.equal(r2.valeAtual, 498);

console.log('ok');
