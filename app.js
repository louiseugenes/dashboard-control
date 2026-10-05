import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, DOMINIO_LOGIN } from './config.js';
import { pad, hoje, comDia, addMeses, prevMes, addDias, ultimoDiaUtil, primeiraCobranca, c2, parseValor, soma, parcelar, calcular } from './calc.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const FORMAS = { credito: 'Crédito', debito: 'Débito', pix: 'Pix', dinheiro: 'Dinheiro', boleto: 'Boleto', vale: 'Vale' };
const ORIGENS = { salario: 'Salário', adiantamento: 'Adiantamento', vale: 'Vale', extra: 'Entrada avulsa' };
const TIPOS_BANCO = { banco: 'Banco', cartao_loja: 'Cartão de loja', outro: 'Outro' };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const CORES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'],
};

const S = { uid: null, bancos: [], categorias: [], lanc: [], pct: 30, edit: null, cache: new Map(), corGrupo: new Map(), charts: {}, visiveis: [], previstos: [] };

const mesAtual = () => hoje().slice(0, 7);
const rotMes = ym => `${MESES[+ym.slice(5, 7) - 1]}/${ym.slice(2, 4)}`;
const fmtData = iso => iso.split('-').reverse().join('/');
const brl = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const banco = id => S.bancos.find(b => b.id === id);
const cat = id => S.categorias.find(c => c.id === id);
const grupoDe = l => cat(l.categoria_id)?.grupo ?? 'Sem categoria';
const titulo = l => l.descricao || cat(l.categoria_id)?.nome || ORIGENS[l.origem] || (l.tipo === 'investimento' ? 'Investimento' : 'Lançamento');
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

async function carregar() {
  const [b, c, cfg] = await Promise.all([
    sb.from('bancos').select('*').order('nome'),
    sb.from('categorias').select('*').order('grupo').order('nome'),
    sb.from('configuracoes').select('*').maybeSingle(),
  ]);
  for (const r of [b, c, cfg]) if (r.error) throw r.error;
  S.bancos = b.data; S.categorias = c.data; S.pct = Number(cfg.data?.percentual_investimento ?? 30);
  S.lanc = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await sb.from('lancamentos').select('*').order('data').order('id').range(i, i + 999);
    if (error) throw error;
    S.lanc.push(...data.map(l => ({ ...l, valor: Number(l.valor) })));
    if (data.length < 1000) break;
  }
  S.cache = new Map();
  const tot = new Map();
  for (const l of S.lanc) if (l.tipo === 'saida') tot.set(grupoDe(l), (tot.get(grupoDe(l)) || 0) + l.valor);
  S.corGrupo = new Map([...tot].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([g], i) => [g, i]));
}
const recarregar = async () => { await carregar(); montarSelects(); renderTudo(); };

function doMes(ym) {
  if (!S.cache.has(ym)) {
    const reais = S.lanc.filter(l => l.data.startsWith(ym));
    S.cache.set(ym, ym < mesAtual() ? reais : [...reais, ...previstos(ym, reais)]);
  }
  return S.cache.get(ym);
}
function previstos(ym, reais) {
  const [y, m] = ym.split('-').map(Number), ant = prevMes(ym, -1), [py, pm] = ant.split('-').map(Number);
  const prever = (l, data) => ({ ...l, id: null, data, previsto: true, estimado: true, pago: false, parcela_grupo: null, parcela_num: null, parcela_total: null, data_compra: null });
  const out = [];
  for (const o of ['vale', 'salario', 'adiantamento']) {
    if (reais.some(l => l.origem === o)) continue;
    const ult = S.lanc.findLast(l => l.origem === o && l.data < ym);
    if (ult) out.push(prever(ult, comDia(y, m, +ult.data.slice(8))));
  }
  const fixa = l => l.fixo && l.tipo === 'saida' && !l.parcela_grupo;
  if (!reais.some(fixa)) {
    for (const l of doMes(ant).filter(fixa)) {
      out.push(prever(l, l.data === ultimoDiaUtil(py, pm) ? ultimoDiaUtil(y, m) : comDia(y, m, +l.data.slice(8))));
    }
  }
  return out;
}
function lancPeriodo(p, diaExato = false) {
  if (p.modo === 'tudo') return S.lanc;
  if (p.modo === 'mes') return doMes(p.mes);
  if (p.modo === 'dia') return doMes(p.dia.slice(0, 7)).filter(l => diaExato ? l.data === p.dia : l.data <= p.dia);
  return MESES.flatMap((_, i) => doMes(`${p.ano}-${pad(i + 1)}`));
}
const inicioPeriodo = p => p.modo === 'ano' ? `${p.ano}-01-01` : (p.modo === 'mes' ? p.mes : p.dia.slice(0, 7)) + '-01';
const rotPeriodo = p => p.modo === 'ano' ? p.ano : p.modo === 'mes' ? rotMes(p.mes) : 'até ' + fmtData(p.dia);
const calc = ls => calcular(ls, S.pct);
const campos = l => ({ tipo: l.tipo, origem: l.origem, descricao: l.descricao, valor: l.valor, data: l.data, banco_id: l.banco_id, categoria_id: l.categoria_id, forma_pagamento: l.forma_pagamento, fixo: l.fixo, estimado: l.tipo === 'entrada', pago: false });

const NAV = ['home', 'lista', 'form'];
function mostrar(v) {
  $$('.view').forEach(el => el.classList.toggle('on', el.id === 'view-' + v));
  $('#titulo').textContent = { login: '', home: 'Resumo', lista: 'Lançamentos', form: S.edit ? 'Editar' : 'Adicionar' }[v];
  $('#nav').style.setProperty('--i', NAV.indexOf(v));
  $$('#nav [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  scrollTo({ top: 0 });
}
$$('#nav [data-view]').forEach(b => b.onclick = () => {
  const v = b.dataset.view;
  if (v === 'form') return novoForm();
  if (v === 'lista') renderLista();
  mostrar(v);
});

const sistemaEscuro = matchMedia('(prefers-color-scheme: dark)');
const temaAtual = () => document.documentElement.dataset.theme || (sistemaEscuro.matches ? 'dark' : 'light');
function aplicarTema() {
  const t = temaAtual();
  $('#b-tema use').setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon');
  $('meta[name=theme-color]').content = t === 'dark' ? '#000000' : '#fafafa';
  if (S.uid) renderHome();
}
$('#b-tema').onclick = () => {
  const t = temaAtual() === 'dark' ? 'light' : 'dark', root = document.documentElement;
  try {
    if (t === (sistemaEscuro.matches ? 'dark' : 'light')) { delete root.dataset.theme; localStorage.removeItem('tema'); }
    else { root.dataset.theme = t; localStorage.setItem('tema', t); }
  } catch { root.dataset.theme = t; }
  aplicarTema();
};
sistemaEscuro.addEventListener('change', aplicarTema);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200);
}
function erro(e) {
  console.error(e);
  toast(e?.code === '23505' ? 'Já existe um registro com esse nome' : 'Erro: ' + (e?.message || e));
}
function contar(el, v) {
  const de = Number(el.dataset.v || 0); el.dataset.v = v;
  el.classList.toggle('neg', v < 0);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return el.textContent = brl(v);
  const t0 = performance.now();
  const passo = t => {
    const k = Math.min(1, (t - t0) / 700);
    el.textContent = brl(de + (v - de) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

async function entrar(session) {
  S.uid = session.user.id;
  $('#nav').hidden = false;
  try { await carregar(); } catch (e) { erro(e); }
  montarSelects(); renderTudo(); mostrar('home');
}
$('#login').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#login .btn'); btn.disabled = true; $('#login-erro').textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({
    email: $('#lg-user').value.trim().toLowerCase() + DOMINIO_LOGIN,
    password: $('#lg-senha').value,
  });
  btn.disabled = false;
  if (error) return $('#login-erro').textContent = error.status === 400 ? 'Usuário ou senha inválidos.' : error.message;
  $('#lg-senha').value = '';
  entrar(data.session);
});
$('#b-sair').onclick = async () => {
  if (!confirm('Sair do sistema?')) return;
  await sb.auth.signOut();
  Object.assign(S, { uid: null, lanc: [], edit: null });
  $('#nav').hidden = true;
  mostrar('login');
};

function montarSelects() {
  const keep = (sel, html) => { const v = sel.value; sel.innerHTML = html; sel.value = v; if (sel.selectedIndex < 0) sel.selectedIndex = 0; };
  const grupos = [...new Set(S.categorias.map(c => c.grupo))];
  const opBancos = S.bancos.map(b => `<option value="${b.id}">${esc(b.nome)}</option>`).join('');
  const opCats = (pref = '', todo = false) => grupos.map(g => `<optgroup label="${esc(g)}">${todo ? `<option value="g:${esc(g)}">${esc(g)} (todas)</option>` : ''}${S.categorias.filter(c => c.grupo === g).map(c => `<option value="${pref}${c.id}">${esc(c.nome)}</option>`).join('')}</optgroup>`).join('');
  keep($('#in-banco'), '<option value="">Nenhum</option>' + opBancos);
  keep($('#in-cat'), '<option value="">Nenhuma</option>' + opCats());
  keep($('#f-banco'), '<option value="">Todos</option><option value="sem">Sem banco</option>' + opBancos);
  keep($('#f-cat'), '<option value="">Todas</option><option value="sem">Sem categoria</option>' + opCats('c:', true));
  $('#dl-grupos').innerHTML = grupos.map(g => `<option value="${esc(g)}">`).join('');
}

function renderTudo() { renderHome(); renderLista(); renderAjustes(); }

function periodoHome() {
  const modo = $('input[name=hmodo]:checked').value;
  for (const m of ['mes', 'ano', 'dia']) $('#h-' + m).hidden = m !== modo;
  if (!$('#h-mes').value) $('#h-mes').value = mesAtual();
  if (!$('#h-ano').value) $('#h-ano').value = hoje().slice(0, 4);
  if (!$('#h-dia').value) $('#h-dia').value = hoje();
  return { modo, mes: $('#h-mes').value, ano: $('#h-ano').value, dia: $('#h-dia').value };
}
$('#home-ctrl').addEventListener('change', renderHome);
$('#h-prev').onclick = () => moverHome(-1);
$('#h-next').onclick = () => moverHome(1);
function moverHome(n) {
  const modo = $('input[name=hmodo]:checked').value;
  if (modo === 'mes') $('#h-mes').value = prevMes($('#h-mes').value || mesAtual(), n);
  if (modo === 'ano') $('#h-ano').value = +$('#h-ano').value + n;
  if (modo === 'dia') $('#h-dia').value = addDias($('#h-dia').value || hoje(), n);
  renderHome();
}

const linhas = rs => rs.map(([dt, dd, cls = '']) => `<div class="${cls}"><dt>${dt}</dt><dd class="num ${typeof dd === 'number' && dd < 0 ? 'neg' : ''}">${typeof dd === 'number' ? brl(dd) : dd}</dd></div>`).join('');

function renderHome() {
  const p = periodoHome(), ls = lancPeriodo(p), r = calc(ls);
  $('#h-rot').textContent = 'Resultado · ' + rotPeriodo(p);
  contar($('#h-res'), r.sobra);
  const pos = r.sobra >= 0;
  $('#h-badge').className = 'badge ' + (pos ? 'good' : 'bad');
  $('#h-badge').innerHTML = `<svg class="i"><use href="#i-${pos ? 'up' : 'down'}"/></svg>${pos ? 'Positivo' : 'Negativo'}`;
  const nPrev = ls.filter(l => l.previsto).length;
  $('#h-nota').textContent = nPrev ? `Inclui ${nPrev} valor${nPrev > 1 ? 'es' : ''} previsto${nPrev > 1 ? 's' : ''}` : '';

  contar($('#s1'), r.saldoComVale);
  contar($('#s2'), r.sobra);
  contar($('#s3'), r.saldoMenosInvest);
  $('#s3-sub').textContent = r.investido ? `Investido: ${brl(r.investido)}` : `Sugestão ${S.pct}%: ${brl(r.sugestao)}`;

  $('#det').innerHTML = linhas([
    ['Salário + adiantamento + avulsas', r.entradas],
    ['Total + vale', c2(r.entradas + r.vale)],
    ['Vale atual / inicial', `${brl(r.valeAtual)} / ${brl(r.vale)}`],
    ['Despesas (sem vale)', r.despesas],
    ['Total − despesas', r.sobra, 'forte'],
    ['Total final + vale atual', r.saldoComVale],
    [`Investimento sugerido (${S.pct}%)`, r.sugestao],
    ['Total − despesas − sugestão', c2(r.sobra - r.sugestao)],
    ['Investido no período', r.investido],
    ['Ainda a pagar', r.aPagar],
    ['Ainda a receber', r.aReceber],
  ]);

  const ant = calc(S.lanc.filter(l => l.data < inicioPeriodo(p)));
  $('#acum').innerHTML = linhas([
    ['Sobras de meses anteriores', ant.saldoMenosInvest],
    ['Vale não usado (anteriores)', ant.valeAtual],
    ['Sobras anteriores + este período', c2(ant.saldoMenosInvest + r.saldoMenosInvest), 'forte'],
    ['Total já investido', soma(S.lanc, l => l.tipo === 'investimento')],
  ]);

  S.previstos = p.modo === 'mes' ? ls.filter(l => l.previsto) : [];
  $('#c-prev').hidden = !S.previstos.length;
  $('#prev-lista').innerHTML = S.previstos.map((l, i) => itemHtml(l, i)).join('');

  graficos(p, ls);
}
$('#prev-lista').onclick = e => {
  const b = e.target.closest('.item');
  if (b) { preencher(S.previstos[+b.dataset.i], false); mostrar('form'); }
};
$('#prev-todos').onclick = async () => {
  if (!confirm(`Lançar ${S.previstos.length} previstos neste mês?`)) return;
  const { error } = await sb.from('lancamentos').insert(S.previstos.map(campos));
  if (error) return erro(error);
  toast('Lançados'); recarregar();
};

function graficos(p, ls) {
  if (!window.Chart) return;
  const tema = temaAtual(), ink = cssVar('--text'), muted = cssVar('--muted'), line = cssVar('--line'), card = cssVar('--card');
  Chart.defaults.color = muted;
  Chart.defaults.font.family = "'Space Grotesk', -apple-system, system-ui, sans-serif";
  const tooltip = { backgroundColor: ink, titleColor: card, bodyColor: card, padding: 10, cornerRadius: 10, displayColors: false,
    callbacks: { label: c => `${c.dataset.label || c.label}: ${brl(c.parsed.y ?? c.parsed)}` } };

  const fim = p.modo === 'ano' ? null : (p.modo === 'mes' ? p.mes : p.dia.slice(0, 7));
  const meses = fim ? [5, 4, 3, 2, 1, 0].map(n => prevMes(fim, -n)) : MESES.map((_, i) => `${p.ano}-${pad(i + 1)}`);
  const dados = meses.map(m => calc(doMes(m)));
  S.charts.barras?.destroy();
  S.charts.barras = new Chart($('#ch-barras'), {
    type: 'bar',
    data: {
      labels: meses.map(rotMes),
      datasets: [
        { label: 'Entradas', data: dados.map(d => d.entradas), backgroundColor: ink, borderRadius: 4 },
        { label: 'Saídas', data: dados.map(d => d.despesas), backgroundColor: muted, borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      datasets: { bar: { categoryPercentage: .62, barPercentage: .88 } },
      plugins: { legend: { align: 'start', labels: { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 8, boxHeight: 8 } }, tooltip },
      scales: {
        x: { grid: { display: false }, border: { color: line } },
        y: { grid: { color: line }, border: { display: false }, ticks: { maxTicksLimit: 5, callback: v => v >= 1000 ? `${v / 1000}k` : v } },
      },
    },
  });

  const tot = new Map();
  for (const l of ls) if (l.tipo === 'saida') {
    const g = S.corGrupo.has(grupoDe(l)) ? grupoDe(l) : 'Demais';
    tot.set(g, (tot.get(g) || 0) + l.valor);
  }
  const fatias = [...tot].sort((a, b) => b[1] - a[1]), total = c2(fatias.reduce((a, f) => a + f[1], 0));
  const cor = g => g === 'Demais' ? muted : CORES[tema][S.corGrupo.get(g)];
  $('#pz-total').textContent = brl(total);
  $('#pz-leg').innerHTML = fatias.length
    ? fatias.map(([g, v]) => `<li><i style="background:${cor(g)}"></i><span>${esc(g)}</span><span class="num">${brl(v)}</span><span class="pc num">${Math.round(v / total * 100)}%</span></li>`).join('')
    : '<li class="vazio">Sem gastos no período</li>';
  S.charts.pizza?.destroy();
  S.charts.pizza = new Chart($('#ch-pizza'), {
    type: 'doughnut',
    data: { labels: fatias.map(f => f[0]), datasets: [{ data: fatias.map(f => c2(f[1])), backgroundColor: fatias.map(f => cor(f[0])), borderColor: card, borderWidth: 2, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false }, tooltip } },
  });
}

function filtros() {
  const v = id => $('#' + id).value, ck = id => $('#' + id).checked;
  return { modo: v('f-modo'), mes: v('f-mes') || mesAtual(), ano: v('f-ano') || hoje().slice(0, 4), dia: v('f-dia') || hoje(),
    tipo: v('f-tipo'), pago: v('f-pago'), cat: v('f-cat'), banco: v('f-banco'), forma: v('f-forma'),
    fixo: ck('f-fixo'), parc: ck('f-parc'), est: ck('f-est'), busca: v('f-busca').trim().toLowerCase() };
}
function iniciarFiltros() {
  $('#filtros').reset();
  $('#f-mes').value = mesAtual(); $('#f-ano').value = hoje().slice(0, 4); $('#f-dia').value = hoje();
}
$('#filtros').addEventListener('submit', e => e.preventDefault());
$('#filtros').addEventListener('input', renderLista);
$('#filtros').addEventListener('change', renderLista);
$('#f-limpar').onclick = () => { iniciarFiltros(); renderLista(); };

const itemHtml = (l, i) => {
  const c = cat(l.categoria_id);
  const meta = [banco(l.banco_id)?.nome, c && `${c.grupo} · ${c.nome}`, FORMAS[l.forma_pagamento], l.parcela_total && `${l.parcela_num}/${l.parcela_total}`, l.tipo === 'investimento' && 'Investimento']
    .filter(Boolean).join(' · ');
  const tags = [l.previsto ? 'previsto' : l.estimado && 'estimado', l.fixo && 'fixa'].filter(Boolean);
  const sinal = { entrada: '+ ', saida: '− ', investimento: '' }[l.tipo];
  const ck = l.previsto ? '<span class="ck off"></span>' : `<span class="ck ${l.pago ? 'on' : ''}" data-ck title="${l.pago ? 'Pago' : 'Pendente'}"><svg class="i"><use href="#i-check"/></svg></span>`;
  return `<button type="button" class="item ${l.tipo} ${l.previsto ? 'prev' : ''}" data-i="${i}">${ck}
    <span><span class="t">${esc(titulo(l))}</span><span class="s">${esc(meta)}${tags.map(t => `<em class="tag">${t}</em>`).join('')}</span></span>
    <span class="v num">${sinal}${brl(l.valor)}</span></button>`;
};

function renderLista() {
  const f = filtros();
  for (const m of ['mes', 'ano', 'dia']) $('#f-' + m).hidden = m !== f.modo;
  const ativos = [f.tipo, f.pago, f.cat, f.banco, f.forma, f.fixo, f.parc, f.est, f.busca].filter(Boolean).length;
  $('#f-qtd').hidden = !ativos; $('#f-qtd').textContent = ativos;

  const ls = lancPeriodo(f, true).filter(l =>
    (!f.tipo || l.tipo === f.tipo) &&
    (!f.pago || (f.pago === 'sim') === !!l.pago) &&
    (!f.cat || (f.cat === 'sem' ? !l.categoria_id : f.cat.startsWith('g:') ? cat(l.categoria_id)?.grupo === f.cat.slice(2) : l.categoria_id === +f.cat.slice(2))) &&
    (!f.banco || (f.banco === 'sem' ? !l.banco_id : l.banco_id === +f.banco)) &&
    (!f.forma || l.forma_pagamento === f.forma) &&
    (!f.fixo || l.fixo) && (!f.parc || l.parcela_grupo) && (!f.est || l.estimado) &&
    (!f.busca || `${titulo(l)} ${l.descricao || ''}`.toLowerCase().includes(f.busca))
  ).sort((a, b) => b.data.localeCompare(a.data) || (b.id || 0) - (a.id || 0));

  S.visiveis = ls;
  $('#l-ent').textContent = brl(soma(ls, l => l.tipo === 'entrada'));
  $('#l-sai').textContent = brl(soma(ls, l => l.tipo === 'saida'));
  $('#l-pend').textContent = brl(soma(ls, l => l.tipo === 'saida' && !l.pago));

  const dias = new Map();
  ls.forEach((l, i) => dias.set(l.data, [...(dias.get(l.data) || []), [l, i]]));
  $('#lista').innerHTML = ls.length ? [...dias].map(([d, its]) => {
    const [y, m, dd] = d.split('-').map(Number);
    const rot = new Date(y, m - 1, dd).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    return `<div class="card"><div class="dia-h"><span class="label">${rot}</span></div>${its.map(([l, i]) => itemHtml(l, i)).join('')}</div>`;
  }).join('') : '<div class="vazio">Nada encontrado</div>';
}
$('#lista').onclick = async e => {
  const b = e.target.closest('.item'); if (!b) return;
  const l = S.visiveis[+b.dataset.i];
  if (e.target.closest('[data-ck]')) {
    const { error } = await sb.from('lancamentos').update({ pago: !l.pago }).eq('id', l.id);
    if (error) return erro(error);
    l.pago = !l.pago;
    toast(l.pago ? (l.tipo === 'entrada' ? 'Recebido' : 'Pago') : 'Pendente');
    renderLista(); renderHome();
    return;
  }
  preencher(l, !l.previsto);
  mostrar('form');
};

const F = $('#form');
$('#in-parc').innerHTML = Array.from({ length: 24 }, (_, i) => `<option value="${i + 1}">${i ? `${i + 1}×` : 'À vista'}</option>`).join('');

function novoForm() { preencher({ tipo: 'saida', data: hoje() }, false); mostrar('form'); }
function preencher(l, editar) {
  S.edit = editar ? l : null;
  F.reset();
  F.elements.tipo.value = l.tipo;
  F.elements.forma.value = l.forma_pagamento || '';
  $('#in-valor').value = l.valor != null ? l.valor.toFixed(2).replace('.', ',') : '';
  $('#in-desc').value = l.descricao || '';
  $('#in-origem').value = l.origem || 'salario';
  $('#in-data').value = l.data || hoje();
  $('#in-compra').value = l.data_compra || l.data || hoje();
  $('#in-banco').value = l.banco_id || '';
  $('#in-cat').value = l.categoria_id || '';
  $('#in-pago').checked = !!l.pago;
  $('#in-fixo').checked = !!l.fixo;
  $('#in-est').checked = !!l.estimado;
  ajustarForm();
}
function ajustarForm() {
  const tipo = F.elements.tipo.value, forma = F.elements.forma.value;
  $$('[data-tipo]', F).forEach(el => el.hidden = !el.dataset.tipo.split(' ').includes(tipo));
  const marcada = F.querySelector('input[name=forma]:checked');
  if (marcada?.closest('[hidden]')) marcada.checked = false;
  const credito = tipo === 'saida' && F.elements.forma.value === 'credito';
  $('#w-compra').hidden = !credito;
  $('#l-data').textContent = credito ? 'Cai na fatura de' : 'Data';
  const parcelavel = tipo === 'saida' && ['credito', 'boleto'].includes(forma) && !S.edit;
  $('#w-parcelas').hidden = !parcelavel;
  if (!parcelavel) $('#in-parc').value = '1';
  $('#w-modo').hidden = $('#in-parc').value === '1';
  $('#w-edit').hidden = !S.edit;
  $('#l-pago').textContent = { entrada: 'Já recebido', saida: 'Já foi pago', investimento: 'Já investido' }[tipo];
  const obrigatoria = tipo === 'entrada' && $('#in-origem').value === 'extra';
  $('#l-desc').textContent = obrigatoria ? 'Descrição (obrigatória)' : 'Descrição';
  $('#in-desc').placeholder = obrigatoria ? 'Ex.: venda, reembolso, presente...' : 'Opcional';
  dicaParcelas();
}
function dicaParcelas() {
  const n = +$('#in-parc').value, v = parseValor($('#in-valor').value);
  const ps = n > 1 && v > 0 ? parcelar({ valor: v, data: $('#in-data').value || hoje() }, n, $('#in-modo').value) : [];
  $('#parc-hint').textContent = ps.length ? `${n}× de ${brl(ps[1].valor)} · total ${brl(soma(ps, () => true))} · última em ${fmtData(ps.at(-1).data)}` : '';
}
function autoData() {
  if (F.elements.tipo.value !== 'saida' || F.elements.forma.value !== 'credito' || !$('#in-compra').value) return;
  $('#in-data').value = primeiraCobranca($('#in-compra').value, banco(+$('#in-banco').value));
}
F.addEventListener('change', e => {
  if (e.target.id === 'in-compra' || e.target.id === 'in-banco' || e.target.name === 'forma') autoData();
  ajustarForm();
});
F.addEventListener('input', e => { if (e.target.id === 'in-valor') dicaParcelas(); });

F.addEventListener('submit', async e => {
  e.preventDefault();
  const tipo = F.elements.tipo.value, forma = tipo === 'investimento' ? null : F.elements.forma.value || null;
  const credito = forma === 'credito', valor = parseValor($('#in-valor').value), data = $('#in-data').value;
  const descricao = $('#in-desc').value.trim() || null, origem = tipo === 'entrada' ? $('#in-origem').value : null;
  if (!(valor > 0)) return toast('Informe um valor válido');
  if (!data) return toast('Informe a data');
  if (origem === 'extra' && !descricao) return toast('Descreva a entrada avulsa');
  const base = {
    tipo, valor, data, descricao, origem, forma_pagamento: forma,
    data_compra: credito ? $('#in-compra').value || null : null,
    banco_id: +$('#in-banco').value || null,
    categoria_id: tipo === 'saida' ? +$('#in-cat').value || null : null,
    fixo: tipo === 'saida' && $('#in-fixo').checked,
    estimado: $('#in-est').checked,
    pago: $('#in-pago').checked,
  };
  const btn = $('#b-salvar'); btn.disabled = true;
  const editando = S.edit;
  const { error } = editando
    ? await sb.from('lancamentos').update(base).eq('id', editando.id)
    : await sb.from('lancamentos').insert(parcelar(base, +$('#in-parc').value, $('#in-modo').value));
  btn.disabled = false;
  if (error) return erro(error);
  toast(editando ? 'Alterado' : 'Salvo');
  await recarregar();
  if (editando) { S.edit = null; mostrar('lista'); } else novoForm();
});

$('#b-cancelar').onclick = () => { S.edit = null; mostrar('lista'); };
$('#b-excluir').onclick = async () => {
  const l = S.edit;
  let q = sb.from('lancamentos').delete();
  if (l.parcela_grupo && confirm(`Excluir TODAS as ${l.parcela_total} parcelas desta compra?\n\nCancelar = excluir só esta parcela`)) q = q.eq('parcela_grupo', l.parcela_grupo);
  else if (confirm('Excluir este lançamento?')) q = q.eq('id', l.id);
  else return;
  const { error } = await q;
  if (error) return erro(error);
  S.edit = null; toast('Excluído');
  await recarregar(); mostrar('lista');
};

function dialogo(tituloDlg, campos, podeExcluir) {
  const d = $('#dlg');
  d.innerHTML = `<form method="dialog"><h2>${esc(tituloDlg)}</h2>${campos.map(c => `<label class="field"><span>${c.l}</span>${c.op
    ? `<select name="${c.n}">${Object.entries(c.op).map(([k, v]) => `<option value="${k}" ${k === c.v ? 'selected' : ''}>${v}</option>`).join('')}</select>`
    : `<input name="${c.n}" type="${c.t || 'text'}" value="${esc(c.v)}" ${c.req ? 'required' : ''} ${c.t === 'number' ? 'min="1" max="31" inputmode="numeric"' : ''} ${c.list ? `list="${c.list}"` : ''} autocomplete="off">`}</label>`).join('')}
    <div class="acoes">${podeExcluir ? '<button value="excluir" class="btn ghost danger" formnovalidate>Excluir</button>' : ''}<button value="" class="btn ghost" formnovalidate>Cancelar</button><button value="ok" class="btn">Salvar</button></div></form>`;
  d.returnValue = '';
  d.showModal();
  return new Promise(res => d.addEventListener('close', () =>
    res(d.returnValue === 'ok' ? Object.fromEntries(new FormData(d.querySelector('form'))) : d.returnValue === 'excluir' ? 'excluir' : null), { once: true }));
}
async function gravar(q, msg) {
  const { data, error } = await q;
  if (error) { erro(error); return null; }
  toast(msg); await recarregar();
  return data;
}

async function editarBanco(b, selecionar) {
  const r = await dialogo(b ? 'Editar banco' : 'Novo banco / cartão', [
    { n: 'nome', l: 'Nome', v: b?.nome, req: true },
    { n: 'tipo', l: 'Tipo', v: b?.tipo || 'banco', op: TIPOS_BANCO },
    { n: 'dia_fechamento', l: 'Dia que a fatura fecha (crédito)', v: b?.dia_fechamento, t: 'number' },
    { n: 'dia_vencimento', l: 'Dia de vencimento (opcional)', v: b?.dia_vencimento, t: 'number' },
  ], !!b);
  if (!r) return;
  if (r === 'excluir') {
    if (confirm(`Excluir ${b.nome}? Os lançamentos ficam sem banco.`)) gravar(sb.from('bancos').delete().eq('id', b.id), 'Excluído');
    return;
  }
  const row = { nome: r.nome.trim(), tipo: r.tipo, dia_fechamento: +r.dia_fechamento || null, dia_vencimento: +r.dia_vencimento || null };
  const novo = await gravar(b ? sb.from('bancos').update(row).eq('id', b.id).select().single() : sb.from('bancos').insert(row).select().single(), 'Salvo');
  if (novo && selecionar) { $('#in-banco').value = novo.id; autoData(); ajustarForm(); }
}
async function editarCat(c, selecionar) {
  const r = await dialogo(c ? 'Editar categoria' : 'Nova categoria', [
    { n: 'grupo', l: 'Grupo (ex.: Casa)', v: c?.grupo, req: true, list: 'dl-grupos' },
    { n: 'nome', l: 'Nome (ex.: Água)', v: c?.nome, req: true },
  ], !!c);
  if (!r) return;
  if (r === 'excluir') {
    if (confirm(`Excluir ${c.grupo} · ${c.nome}? Os lançamentos ficam sem categoria.`)) gravar(sb.from('categorias').delete().eq('id', c.id), 'Excluída');
    return;
  }
  const row = { grupo: r.grupo.trim(), nome: r.nome.trim() };
  const nova = await gravar(c ? sb.from('categorias').update(row).eq('id', c.id).select().single() : sb.from('categorias').insert(row).select().single(), 'Salvo');
  if (nova && selecionar) $('#in-cat').value = nova.id;
}
$('#add-banco').onclick = () => editarBanco(null, true);
$('#add-cat').onclick = () => editarCat(null, true);

function renderAjustes() {
  $('#aj-bancos').innerHTML = S.bancos.map(b => `<button type="button" data-id="${b.id}">${esc(b.nome)}${b.dia_fechamento ? `<small>fecha ${b.dia_fechamento}</small>` : ''}</button>`).join('')
    + '<button type="button" class="add" data-id="">+ Banco</button>';
  const grupos = [...new Set(S.categorias.map(c => c.grupo))];
  $('#aj-cats').innerHTML = grupos.map(g => `<div class="grupo"><div class="muted small">${esc(g)}</div><div class="tags">${S.categorias.filter(c => c.grupo === g).map(c => `<button type="button" data-id="${c.id}">${esc(c.nome)}</button>`).join('')}</div></div>`).join('')
    + '<div class="tags"><button type="button" class="add" data-id="">+ Categoria</button></div>';
  $('#aj-pct').value = S.pct;
}
$('#aj-bancos').onclick = e => { const b = e.target.closest('[data-id]'); if (b) editarBanco(b.dataset.id ? banco(+b.dataset.id) : null); };
$('#aj-cats').onclick = e => { const b = e.target.closest('[data-id]'); if (b) editarCat(b.dataset.id ? cat(+b.dataset.id) : null); };
$('#aj-pct').onchange = async () => {
  const v = Math.min(100, Math.max(0, Number($('#aj-pct').value) || 0));
  const { error } = await sb.from('configuracoes').upsert({ user_id: S.uid, percentual_investimento: v });
  if (error) return erro(error);
  S.pct = v; toast('Percentual salvo'); renderHome();
};

(async () => {
  aplicarTema();
  iniciarFiltros();
  if (SUPABASE_URL.includes('SEU-PROJETO')) $('#login-erro').textContent = 'Configure SUPABASE_URL no arquivo config.js';
  const { data: { session } } = await sb.auth.getSession();
  if (session) entrar(session); else mostrar('login');
})();
