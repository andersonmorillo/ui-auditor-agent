import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const categories = {
  usability: { label: 'Usabilidad', checks: 'Completar las tareas principales; claridad de acciones; esfuerzo y pasos innecesarios.' },
  accessibility: { label: 'Accesibilidad', checks: 'axe; recorrido con teclado; foco visible; etiquetas; contraste; zoom al 200%; revisión manual de casos incompletos.' },
  visual: { label: 'Diseño visual', checks: 'Jerarquía, legibilidad, espaciado, alineación, consistencia y estados de componentes.' },
  navigation: { label: 'Navegación', checks: 'Encontrar funciones; ubicación actual; atrás/adelante; enlaces profundos y rutas sin salida.' },
  functionality: { label: 'Funcionamiento', checks: 'Probar los flujos solicitados; datos válidos e inválidos; verificar el resultado visible de cada acción.' },
  feedback: { label: 'Estados y errores', checks: 'Carga, éxito, vacío, error, recuperación; conservación de datos; claridad de mensajes.' },
  performance: { label: 'Rendimiento', checks: 'Lighthouse para navegación pública; tiempos de la sesión explorada; respuesta a interacciones. Las mediciones de laboratorio no equivalen a datos de usuarios reales.' },
  responsive: { label: 'Adaptación', checks: 'Escritorio, tablet y móvil; desbordamiento; menús; tamaños de objetivos táctiles; orientación.' },
  compatibility: { label: 'Compatibilidad', checks: 'Repetir los flujos en los navegadores objetivo. Una sesión en Chrome no demuestra compatibilidad con Firefox o Safari.' },
  experience: { label: 'Experiencia y contenido', checks: 'Lenguaje, expectativas, confianza y fricción. La satisfacción de usuarios reales requiere entrevistas o pruebas con personas.' },
};

const text = z.string().trim().min(1).max(6000);
const id = z.uuid();
const httpUrl = z.url().refine(value => /^https?:\/\//.test(value), 'Usa una URL HTTP o HTTPS');
const category = z.enum(Object.keys(categories));
const region = z.object({ x: z.number().nonnegative(), y: z.number().nonnegative(), width: z.number().positive(), height: z.number().positive() });
const base = { audit_id: id };
export const schemas = {
  audit_start: z.object({ title: text, url: httpUrl, flows: z.array(text).max(30).default([]), scope: text.default('Evaluación exploratoria de la interfaz web') }),
  audit_capture: z.object({ ...base, label: text, run_axe: z.boolean().default(true), mask_selectors: z.array(text).max(30).default([]) }),
  audit_finding: z.object({
    ...base, kind: z.enum(['bug', 'improvement']), category, severity: z.enum(['critical', 'high', 'medium', 'low']), title: text, observed: text, impact: text, recommendation: text,
    steps: z.array(text).min(1).max(30), evidence_id: id, confidence: z.enum(['confirmed', 'hypothesis']), region: region.optional(),
  }),
  audit_assess: z.object({ ...base, category, status: z.enum(['reviewed', 'partial', 'not_applicable']), notes: text, evidence_ids: z.array(id).max(100).default([]) }),
  audit_status: z.object(base),
  audit_lighthouse: z.object({ ...base, url: httpUrl, device: z.enum(['mobile', 'desktop']).default('mobile') }),
  audit_report: z.object({ ...base, summary: text }),
};

export function auditDir(root, auditId) { return path.join(root, id.parse(auditId)); }
export async function loadAudit(root, auditId) { return JSON.parse(await readFile(path.join(auditDir(root, auditId), 'audit.json'), 'utf8')); }
export async function saveAudit(root, audit) {
  const dir = auditDir(root, audit.id);
  await mkdir(dir, { recursive: true });
  const temporary = path.join(dir, `audit-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(audit, null, 2));
  await rename(temporary, path.join(dir, 'audit.json'));
}

export async function startAudit(root, input) {
  const audit = { id: randomUUID(), ...input, created_at: new Date().toISOString(), captures: [], findings: [], assessments: {}, lighthouse: [] };
  await saveAudit(root, audit);
  return audit;
}

export function addFinding(audit, input, source = 'agent') {
  const capture = audit.captures.find(item => item.id === input.evidence_id);
  const run = audit.lighthouse.find(item => item.id === input.evidence_id);
  if (!capture && !run) throw new Error('La evidencia debe pertenecer a esta auditoría. Usa audit_capture o audit_lighthouse primero.');
  if (input.region && !capture) throw new Error('region solo se puede marcar en una captura de audit_capture.');
  const { width, height } = capture?.viewport ?? {};
  if (input.region && (input.region.x + input.region.width > width || input.region.y + input.region.height > height)) throw new Error('La región debe estar dentro de la captura del viewport.');
  const { audit_id, ...finding } = input;
  const result = { id: randomUUID(), ...finding, also_seen_in: [], url: capture?.url ?? run.final_url, source };
  audit.findings.push(result);
  return result;
}

// Automated checks run on every capture: a repeated key adds the capture to the existing finding instead of duplicating it.
export function recordAutomatedFinding(audit, key, input, source) {
  const existing = audit.findings.find(finding => finding.key === key);
  if (!existing) return addFinding(audit, { ...input, key }, source);
  if (existing.evidence_id !== input.evidence_id && !existing.also_seen_in.includes(input.evidence_id)) existing.also_seen_in.push(input.evidence_id);
  return existing;
}

export function assess(audit, input) {
  if (input.status !== 'not_applicable' && !input.evidence_ids.length) throw new Error('Una evaluación revisada o parcial necesita al menos una evidencia.');
  if (input.evidence_ids.some(evidenceId => ![...audit.captures, ...audit.lighthouse].some(evidence => evidence.id === evidenceId))) throw new Error('La evidencia no pertenece a esta auditoría.');
  audit.assessments[input.category] = { status: input.status, notes: input.notes, evidence_ids: input.evidence_ids };
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const statusLabels = { reviewed: 'Revisado', partial: 'Revisión parcial', not_applicable: 'No aplica', not_reviewed: 'Sin evaluar' };
const severityLabels = { critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja' };
const severityHelp = { critical: 'bloquea una tarea o se pierden datos', high: 'impide o confunde una tarea principal', medium: 'molesta o confunde, pero hay alternativa', low: 'detalle de pulido' };
const kindLabels = { bug: 'Error', improvement: 'Mejora' };
const priorities = { critical: 0, high: 1, medium: 2, low: 3 };
// Score model: each aspect starts at 100 and loses these points per open problem (half when it still needs validation).
const penalties = { critical: 25, high: 15, medium: 8, low: 3 };
const date = value => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' (Bogotá)';
// Plain-language names for the axe rules seen most often; other rules fall back to axe's own text.
const axeRules = {
  'color-contrast': ['Contraste de color insuficiente', 'Hay textos que no se distinguen bien del fondo. WCAG AA pide un contraste de 4.5:1 para texto normal y 3:1 para texto grande.'],
  'target-size': ['Zonas para pulsar demasiado pequeñas', 'Hay botones o enlaces de menos de 24 × 24 px o muy juntos: cuesta acertarles con el dedo o con poca precisión.'],
  'landmark-unique': ['Regiones de la página con el mismo nombre', 'Dos regiones (por ejemplo, dos menús) se llaman igual y un lector de pantalla no puede distinguirlas.'],
  'heading-order': ['Títulos fuera de orden', 'Los niveles de título saltan (por ejemplo, de h1 a h3) y quien navega por títulos pierde la estructura.'],
  'aria-allowed-role': ['Rol de accesibilidad no válido', 'Un elemento declara un rol que su etiqueta HTML no admite, y puede anunciarse mal.'],
  label: ['Campos sin etiqueta', 'Un campo de formulario no tiene etiqueta asociada y un lector de pantalla no dice qué hay que escribir.'],
  'button-name': ['Botones sin nombre', 'Un botón no tiene texto ni etiqueta accesible y solo se anuncia como "botón".'],
  'link-name': ['Enlaces sin nombre', 'Un enlace no tiene texto ni etiqueta accesible.'],
  'image-alt': ['Imágenes sin texto alternativo', 'Una imagen con información no tiene texto alternativo.'],
  'select-name': ['Listas desplegables sin etiqueta', 'Una lista desplegable no tiene etiqueta asociada.'],
  'nested-interactive': ['Controles dentro de otros controles', 'Un control interactivo contiene otro, lo que confunde al teclado y a los lectores de pantalla.'],
  'scrollable-region-focusable': ['Zona desplazable sin acceso por teclado', 'Una zona con desplazamiento no se puede recorrer con el teclado.'],
  region: ['Contenido fuera de las regiones de la página', 'Parte del contenido no está dentro de una región (main, nav…), y es más difícil de encontrar con un lector de pantalla.'],
  'landmark-one-main': ['Falta la región principal', 'La página no marca su contenido principal con main.'],
  'page-has-heading-one': ['Falta el título principal', 'La página no tiene un título h1.'],
};
const metricNames = { 'first-contentful-paint': 'Primer contenido visible (FCP)', 'largest-contentful-paint': 'Contenido principal visible (LCP)', 'speed-index': 'Índice de velocidad', 'total-blocking-time': 'Tiempo bloqueado (TBT)', 'cumulative-layout-shift': 'Saltos de diseño (CLS)' };
const metricValue = metric => metric?.value == null ? '—' : metric.unit === 'millisecond' ? (metric.value >= 1000 ? `${(metric.value / 1000).toFixed(1)} s` : `${Math.round(metric.value)} ms`) : metric.value.toFixed(2);
// Findings saved before `kind` existed: automated checks, broken behaviour and wrong states count as errors.
const kindOf = finding => finding.kind ?? (finding.source !== 'agent' || ['functionality', 'feedback'].includes(finding.category) ? 'bug' : 'improvement');
const pointsOf = issue => Math.ceil(penalties[issue.severity] / (issue.confidence === 'hypothesis' ? 2 : 1));
const pathOf = url => { try { return new URL(url).pathname; } catch { return String(url ?? ''); } };
const scoreLevel = score => score >= 85 ? 'good' : score >= 60 ? 'fair' : 'poor';
// Paragraphs stay paragraphs and consecutive "1. …" lines become a list, so the agent's summary reads like a document.
const prose = value => String(value ?? '').split(/\n\s*\n/).map(block => {
  let html = '', items = [];
  const flush = () => { if (items.length) html += `<ol>${items.map(item => `<li>${escape(item)}</li>`).join('')}</ol>`; items = []; };
  for (const line of block.split('\n').map(item => item.trim()).filter(Boolean)) {
    const numbered = line.match(/^\d+[.)]\s+(.*)/);
    if (numbered) items.push(numbered[1]); else { flush(); html += `<p>${escape(line)}</p>`; }
  }
  flush();
  return html;
}).join('');

const styles = `
:root{--ink:#17202d;--muted:#55647a;--line:#d5dce5;--bg:#f2f4f7;--card:#fff;--bug:#b42318;--bug-bg:#fdecea;--imp:#1f5fbf;--imp-bg:#e8f0fd;--high:#b42318;--high-bg:#fdecea;--medium:#8a5a00;--medium-bg:#fff3d6;--low:#3d5a80;--low-bg:#e9eef5;--good:#1d7a4a;--fair:#a86400;--poor:#b42318;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);line-height:1.55}
*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:36px 24px 60px}a{color:#164b94;overflow-wrap:anywhere}
h1{font-size:clamp(26px,3.6vw,38px);line-height:1.2;margin:8px 0}h2{font-size:24px;margin:48px 0 6px}p.lead{margin-top:0;color:var(--muted)}h3{font-size:19px;line-height:1.35;margin:10px 0}h4{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:14px 0 2px}
.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:var(--muted)}header{padding-bottom:20px;border-bottom:2px solid var(--ink)}
.summary{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 20px;margin-top:14px}.summary>summary{font-weight:600}.summary p{margin:.4em 0}.summary ol{margin:.4em 0;padding-left:22px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:22px}.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}.stat strong{display:block;font-size:30px;line-height:1.1}.stat strong small{font-size:15px;color:var(--muted)}.stat span{font-size:13px;color:var(--muted)}.stat.bug strong{color:var(--bug)}.stat.imp strong{color:var(--imp)}
.good{color:var(--good)}.fair{color:var(--fair)}.poor{color:var(--poor)}
nav{display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin:18px 0 0;font-size:14px}
.top{list-style:none;padding:0;margin:12px 0 0;display:grid;gap:8px}.top li{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--bug);border-radius:8px;padding:10px 14px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.top li.improvement{border-left-color:var(--imp)}.top a{font-weight:600;color:var(--ink);text-decoration:none}.top a:hover{text-decoration:underline}
.tag{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;background:var(--low-bg);color:var(--low);white-space:nowrap}.tag.bug{background:var(--bug-bg);color:var(--bug)}.tag.improvement{background:var(--imp-bg);color:var(--imp)}.tag.critical,.tag.high{background:var(--high-bg);color:var(--high)}.tag.medium{background:var(--medium-bg);color:var(--medium)}.tag.low{background:var(--low-bg);color:var(--low)}.tag.tentative{background:#fff;color:var(--medium);border:1px dashed var(--medium)}.tag.points{background:#fff;color:var(--muted);border:1px solid var(--line)}
.ranking{display:grid;gap:8px;margin-top:12px}.aspect{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px}.aspect>summary{display:grid;grid-template-columns:minmax(150px,230px) 1fr 64px;gap:14px;align-items:center;cursor:pointer;list-style:none;color:var(--ink)}.aspect>summary::-webkit-details-marker{display:none}
.aspect .name{font-weight:600}.aspect .name small{display:block;font-weight:400;color:var(--muted);font-size:12px}.bar{height:12px;background:var(--bg);border-radius:6px;overflow:hidden}.bar i{display:block;height:100%;border-radius:6px}.bar i.good{background:var(--good)}.bar i.fair{background:var(--fair)}.bar i.poor{background:var(--poor)}.aspect .value{font-size:22px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums}.aspect .value.none{font-size:13px;color:var(--muted)}
.aspect ol{margin:6px 0 4px;padding-left:22px}.aspect li{margin:4px 0}.aspect p{margin:8px 0 0;color:var(--muted);font-size:14px}
.legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px;margin-top:20px;font-size:14px}.legend div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.legend p{margin:6px 0 0;color:var(--muted)}
.filters{position:sticky;top:0;z-index:2;background:var(--bg);padding:12px 0;display:flex;gap:12px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line);margin-top:28px;font-size:13px;color:var(--muted)}.filters label{display:flex;gap:6px;align-items:center}select,button{font:inherit;font-size:14px;padding:6px 10px;background:#fff;border:1px solid #9ba8b7;border-radius:6px;color:var(--ink)}button{cursor:pointer}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:16px 0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);overflow:hidden;break-inside:avoid;scroll-margin-top:70px}.card.bug{border-top:5px solid var(--bug)}.card.improvement{border-top:5px solid var(--imp)}
.card-text{padding:18px 22px}.card-text p{margin:0}.tags{display:flex;gap:6px;flex-wrap:wrap}.num{color:var(--muted);margin-right:6px}.fix{background:var(--bg);border-radius:8px;padding:2px 14px 12px;margin-top:14px}.fix h4{color:var(--ink)}
.card details{margin-top:12px;font-size:14px}summary{cursor:pointer;color:#164b94}.card ol{margin:6px 0 0;padding-left:20px}p.related{font-size:13px;color:var(--muted);margin-top:10px}
.card-image{background:#e9edf2;padding:14px;display:flex;flex-direction:column;gap:8px;justify-content:center}.card-image figure{margin:0}figcaption{font-size:12px;color:var(--muted);margin-top:4px}
.shot{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:6px;background:#fff}.annotation{fill:none;stroke:#e01e37;stroke-width:4px;vector-effect:non-scaling-stroke}.dim{fill:rgba(15,23,42,.42)}
.metrics{width:100%;border-collapse:collapse;font-size:14px;background:#fff}.metrics td{padding:6px 10px;border-bottom:1px solid var(--line)}.metrics td:last-child{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.auto{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:8px 0;scroll-margin-top:70px}.auto>summary{display:flex;gap:10px;align-items:center;flex-wrap:wrap;color:var(--ink)}.auto>summary strong{font-size:16px}.auto p{margin:8px 0 0}
table.coverage{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line)}.coverage th,.coverage td{padding:12px 14px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:14px}.coverage th{min-width:150px}
.gallery details{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:8px 0;scroll-margin-top:20px}.gallery summary span{color:var(--muted);font-size:13px;margin-left:8px}.gallery figure{margin:12px 0 0}
.sprites{position:absolute;width:0;height:0;overflow:hidden}footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}[hidden]{display:none!important}
@media(max-width:860px){.filters{position:static}.coverage tr{display:grid;grid-template-columns:1fr auto;border-bottom:1px solid var(--line)}.coverage th,.coverage td{border:0;padding:8px 12px}.coverage td:last-child{grid-column:1/-1;padding-top:0}.coverage th{min-width:0}.card{grid-template-columns:1fr}.aspect>summary{grid-template-columns:1fr 54px}.aspect .bar{grid-column:1/-1;grid-row:2}main{padding:22px 14px}}
@media print{body{background:#fff}.filters,nav{display:none}.card[hidden],section[hidden]{display:block!important}.card{display:grid!important}}`;

export async function renderReport(root, audit, summary) {
  const dir = auditDir(root, audit.id);
  // Each screenshot is embedded once in an SVG sprite and drawn with <use>, so findings that share a capture do not repeat its bytes.
  const sprites = [];
  for (const capture of audit.captures) {
    const data = (await readFile(path.join(dir, `${capture.id}.png`))).toString('base64');
    sprites.push(`<image id="shot-${capture.id}" width="${capture.viewport.width}" height="${capture.viewport.height}" href="data:image/png;base64,${data}"/>`);
  }
  const captures = new Map(audit.captures.map(capture => [capture.id, capture]));
  const runs = new Map(audit.lighthouse.map(run => [run.id, run]));
  const pageNames = new Map();
  for (const capture of audit.captures) if (!pageNames.has(pathOf(capture.url))) pageNames.set(pathOf(capture.url), capture.label.split('·')[0].trim());
  const evidenceLink = evidenceId => {
    const capture = captures.get(evidenceId);
    return `<a href="#capture-${evidenceId}">${capture ? escape(capture.label) : `Lighthouse · ${escape(runs.get(evidenceId)?.device)}`}</a>`;
  };

  // Zoom into the marked area (keeping some context) and dim the rest, so the problem is obvious at a glance.
  const figure = (capture, area, zoom = Boolean(area)) => {
    const { width, height } = capture.viewport;
    let view = { x: 0, y: 0, width, height };
    if (area && zoom) {
      const w = Math.min(width, Math.max(area.width + 160, 560)), h = Math.min(height, Math.max(area.height + 160, 320));
      const clamp = (start, size, max) => Math.max(0, Math.min(start, max - size));
      view = { x: clamp(area.x + area.width / 2 - w / 2, w, width), y: clamp(area.y + area.height / 2 - h / 2, h, height), width: w, height: h };
    }
    const mark = area ? `<path class="dim" fill-rule="evenodd" d="M0 0H${width}V${height}H0Z M${area.x} ${area.y}h${area.width}v${area.height}h${-area.width}Z"/>`
      + `<rect class="annotation" x="${area.x}" y="${area.y}" width="${area.width}" height="${area.height}" rx="4"><title>Zona del problema</title></rect>` : '';
    return `<figure><svg class="shot" viewBox="${view.x} ${view.y} ${view.width} ${view.height}" role="img" aria-label="${escape(capture.label)}"><use href="#shot-${capture.id}"/>${mark}</svg>`
      + `<figcaption>${escape(capture.label)}</figcaption></figure>`;
  };
  const metricsTable = run => `<table class="metrics"><tr><td>Puntuación de rendimiento</td><td>${run.score === null ? '—' : Math.round(run.score * 100) + '/100'}</td></tr>`
    + Object.entries(metricNames).map(([key, name]) => `<tr><td>${name}</td><td>${metricValue(run.metrics?.[key])}</td></tr>`).join('') + '</table>';

  // Automated checks (axe, overflow) are grouped by rule across pages: one entry per problem instead of one per page.
  const groups = new Map();
  for (const finding of audit.findings.filter(item => item.source !== 'agent')) {
    const rule = finding.key?.startsWith('axe:') ? finding.key.split(':')[1] : finding.title;
    const group = groups.get(rule) ?? { rule, category: finding.category, severity: finding.severity, confidence: finding.confidence, findings: [] };
    if (priorities[finding.severity] < priorities[group.severity]) group.severity = finding.severity;
    group.findings.push(finding);
    groups.set(rule, group);
  }
  const automated = [...groups.values()].sort((a, b) => priorities[a.severity] - priorities[b.severity]).map((group, index) => {
    const [name, explanation] = axeRules[group.rule] ?? [group.findings[0].title.replace(/^axe: /, ''), group.findings[0].observed.split('\n')[0]];
    const evidence = [...new Set(group.findings.flatMap(item => [item.evidence_id, ...(item.also_seen_in ?? [])]))];
    const pages = new Set(evidence.map(id => pathOf(captures.get(id)?.url)));
    const affected = Math.max(0, ...group.findings.map(item => item.affected ?? 0));
    const reference = group.findings[0].recommendation.match(/https?:\/\/\S+/)?.[0];
    return { ...group, kind: 'bug', anchor: `auto-${index + 1}`, title: name, html: `<details class="auto" id="auto-${index + 1}"><summary><span class="tag ${group.severity}">Prioridad ${severityLabels[group.severity].toLowerCase()}</span>`
      + `<strong>${escape(name)}</strong><span class="tag">${pages.size} ${pages.size === 1 ? 'pantalla' : 'pantallas'}</span>${affected ? `<span class="tag">hasta ${affected} ${affected === 1 ? 'elemento' : 'elementos'} por pantalla</span>` : ''}${group.confidence === 'hypothesis' ? '<span class="tag tentative">Por validar</span>' : ''}</summary>`
      + `<p>${escape(explanation)}</p><p>Dónde: ${evidence.map(evidenceLink).join(' · ')}</p>${reference ? `<p><a href="${escape(reference)}">Cómo corregirlo (guía de axe, en inglés)</a></p>` : ''}</details>` };
  });

  // Agent findings: errors first, then improvements; inside each, by priority.
  const ordered = audit.findings.filter(item => item.source === 'agent').map(item => ({ ...item, kind: kindOf(item) }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'bug' ? -1 : 1) || priorities[a.severity] - priorities[b.severity] || (a.confidence === 'hypothesis') - (b.confidence === 'hypothesis'));
  ordered.forEach((finding, index) => { finding.anchor = `f-${index + 1}`; finding.number = index + 1; });
  const pageOf = finding => captures.has(finding.evidence_id) ? pathOf(captures.get(finding.evidence_id).url) : 'lighthouse';
  const pageName = finding => captures.has(finding.evidence_id) ? pageNames.get(pageOf(finding)) : `Rendimiento (Lighthouse ${runs.get(finding.evidence_id)?.device ?? ''})`;
  const card = finding => {
    const capture = captures.get(finding.evidence_id);
    const run = runs.get(finding.evidence_id);
    const image = capture
      ? figure(capture, finding.region) + (finding.region ? `<details><summary>Ver la pantalla completa</summary>${figure(capture, finding.region, false)}</details>` : '')
      : `${run ? metricsTable(run) : ''}<p>Evidencia: ${evidenceLink(finding.evidence_id)}</p>`;
    const related = finding.also_seen_in?.length ? `<p class="related">También en: ${finding.also_seen_in.map(evidenceLink).join(' · ')}</p>` : '';
    return `<article class="card ${finding.kind}" id="${finding.anchor}" data-kind="${finding.kind}" data-severity="${finding.severity}" data-page="${escape(pageOf(finding))}"><div class="card-text">`
      + `<div class="tags"><span class="tag ${finding.kind}">${kindLabels[finding.kind]}</span><span class="tag ${finding.severity}">Prioridad ${severityLabels[finding.severity].toLowerCase()}</span>`
      + `<span class="tag">${escape(pageName(finding))}</span>${finding.confidence === 'hypothesis' ? '<span class="tag tentative">Por validar</span>' : ''}<span class="tag points">+${pointsOf(finding)} en ${escape(categories[finding.category].label)}</span></div>`
      + `<h3><span class="num">${finding.number}.</span>${escape(finding.title)}</h3>`
      + `<h4>Qué pasa</h4><p>${escape(finding.observed)}</p><h4>Por qué importa</h4><p>${escape(finding.impact)}</p>`
      + `<div class="fix"><h4>Qué hacer</h4><p>${escape(finding.recommendation)}</p></div>`
      + `<details><summary>Cómo reproducirlo</summary><ol>${finding.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol></details>${related}</div>`
      + `<div class="card-image">${image}</div></article>`;
  };
  const bugs = ordered.filter(item => item.kind === 'bug'), improvements = ordered.filter(item => item.kind === 'improvement');

  // Score per aspect: 100 minus the points of its open problems; those problems are the path back to 100.
  const issues = [...ordered, ...automated];
  const scores = Object.entries(categories).map(([key, item]) => {
    const assessment = audit.assessments[key];
    const own = issues.filter(issue => issue.category === key).sort((a, b) => pointsOf(b) - pointsOf(a));
    const evaluated = assessment ? assessment.status !== 'not_applicable' : own.length > 0;
    return { label: item.label, assessment, own, score: evaluated ? Math.max(1, 100 - own.reduce((sum, issue) => sum + pointsOf(issue), 0)) : null };
  });
  const scored = scores.filter(item => item.score !== null);
  const overall = scored.length ? Math.round(scored.reduce((sum, item) => sum + item.score, 0) / scored.length) : null;
  const ranking = [...scores].sort((a, b) => (a.score ?? 101) - (b.score ?? 101)).map(item => {
    const status = item.assessment?.status ?? 'not_reviewed';
    const value = item.score === null ? `<span class="value none">${statusLabels[status]}</span>` : `<span class="value ${scoreLevel(item.score)}">${item.score}</span>`;
    const steps = item.own.length
      ? `<ol>${item.own.map(issue => `<li><a href="#${issue.anchor}">${escape(issue.title)}</a> · <strong>+${pointsOf(issue)}</strong></li>`).join('')}</ol>`
      : `<p>${item.score === null ? 'No se evaluó en esta auditoría.' : 'No se registraron problemas en lo que se revisó.'}</p>`;
    const caveat = status === 'partial' ? '<p>Revisión parcial: la nota puede bajar cuando se revise lo pendiente (ver "Qué se revisó").</p>' : '';
    return `<details class="aspect"><summary><span class="name">${escape(item.label)}<small>${statusLabels[status]} · ${item.own.length} ${item.own.length === 1 ? 'problema' : 'problemas'}</small></span>`
      + `<span class="bar">${item.score === null ? '' : `<i class="${scoreLevel(item.score)}" style="width:${item.score}%"></i>`}</span>${value}</summary>`
      + `<h4>Para llegar a 100</h4>${steps}${caveat}</details>`;
  }).join('');

  const top = [...ordered].sort((a, b) => priorities[a.severity] - priorities[b.severity] || a.number - b.number).slice(0, 5)
    .map(finding => `<li class="${finding.kind}"><span class="tag ${finding.kind}">${kindLabels[finding.kind]}</span><span class="tag ${finding.severity}">${severityLabels[finding.severity]}</span><a href="#${finding.anchor}">${escape(finding.title)}</a></li>`).join('');

  const coverage = Object.entries(categories).map(([key, item]) => {
    const assessment = audit.assessments[key] ?? { status: 'not_reviewed', notes: 'No se registró una evaluación de este aspecto.', evidence_ids: [] };
    return `<tr><th scope="row">${escape(item.label)}</th><td><span class="tag">${statusLabels[assessment.status]}</span></td>`
      + `<td>${escape(assessment.notes)}<details><summary>Qué se busca en este aspecto</summary><p>${escape(item.checks)}</p>${assessment.evidence_ids.length ? `<p>Evidencia: ${assessment.evidence_ids.map(evidenceLink).join(' · ')}</p>` : ''}</details></td></tr>`;
  }).join('');

  const gallery = audit.captures.map(capture => `<details id="capture-${capture.id}"><summary>${escape(capture.label)}<span>${escape(pathOf(capture.url))} · ${capture.viewport.width} × ${capture.viewport.height}</span></summary>${figure(capture)}`
    + `<p>${capture.axe ? `Revisión automática de accesibilidad: ${capture.axe.violations.length} ${capture.axe.violations.length === 1 ? 'regla incumplida' : 'reglas incumplidas'}.` : 'Sin revisión automática de accesibilidad en esta captura.'}</p></details>`).join('')
    + audit.lighthouse.map(run => `<details id="capture-${run.id}"><summary>Lighthouse · ${escape(run.device)}<span>${escape(run.final_url)} · ${escape(date(run.created_at))}</span></summary>`
      + `<p>Medición de laboratorio en un navegador aparte, sin la sesión iniciada del agente.</p>${metricsTable(run)}`
      + (run.screenshot ? `<figure><img class="shot" src="${escape(run.screenshot)}" alt="Estado final medido por Lighthouse" loading="lazy"><figcaption>Pantalla final que midió Lighthouse.</figcaption></figure>` : '')
      + (run.opportunities.length ? `<details><summary>Qué recomienda Lighthouse (${run.opportunities.length})</summary><ul>${run.opportunities.map(item => `<li>${escape(item.title)}${item.display_value ? ` · ${escape(item.display_value)}` : ''}</li>`).join('')}</ul></details>` : '')
      + `<p><a href="${run.id}-lighthouse.html">Abrir el informe original de Lighthouse</a></p></details>`).join('');

  const reviewed = Object.values(audit.assessments).filter(item => item.status === 'reviewed').length;
  const flows = audit.flows.length ? `<details><summary>Tareas revisadas (${audit.flows.length})</summary><ul>${audit.flows.map(flow => `<li>${escape(flow)}</li>`).join('')}</ul></details>` : '';
  const pages = [...new Set(ordered.map(pageOf))];
  const options = pairs => pairs.map(([value, label]) => `<option value="${escape(value)}">${escape(label)}</option>`).join('');
  const section = (id, title, lead, items) => items.length ? `<section data-group id="${id}"><h2>${title} (${items.length})</h2><p class="lead">${lead}</p>${items.map(card).join('')}</section>` : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(audit.title)} — UI Auditor</title><style>${styles}</style></head><body>
<svg class="sprites" aria-hidden="true"><defs>${sprites.join('')}</defs></svg>
<main><header><div class="eyebrow">UI Auditor · Evaluación de interfaz</div><h1>${escape(audit.title)}</h1><p><a href="${escape(audit.url)}">${escape(audit.url)}</a> · ${escape(date(audit.created_at))}</p>
<div class="stats"><div class="stat"><strong class="${overall === null ? '' : scoreLevel(overall)}">${overall ?? '—'}<small>/100</small></strong><span>Puntuación general (promedio de los aspectos evaluados)</span></div>
<div class="stat bug"><strong>${bugs.length}</strong><span>Errores: algo no funciona o muestra datos incorrectos</span></div>
<div class="stat imp"><strong>${improvements.length}</strong><span>Mejoras: funciona, pero se puede hacer más claro o cómodo</span></div>
<div class="stat"><strong>${automated.length}</strong><span>Problemas detectados automáticamente (accesibilidad y desbordamiento)</span></div>
<div class="stat"><strong>${reviewed}/${Object.keys(categories).length}</strong><span>Aspectos revisados por completo</span></div></div>
<details class="summary"><summary>Resumen del auditor: alcance, prioridades y limitaciones</summary>${prose(summary)}</details>
<nav aria-label="Secciones del reporte">${top ? '<a href="#start">Por dónde empezar</a>' : ''}<a href="#scores">Puntuación por aspecto</a>${bugs.length ? '<a href="#bugs">Errores</a>' : ''}${improvements.length ? '<a href="#improvements">Mejoras</a>' : ''}<a href="#automatic">Detección automática</a><a href="#coverage">Qué se revisó</a><a href="#evidence">Capturas</a><button type="button" onclick="window.print()">Imprimir / guardar PDF</button></nav></header>
${top ? `<h2 id="start">Por dónde empezar</h2><p class="lead">${ordered.length === 1 ? 'El problema' : `Los ${Math.min(5, ordered.length)} problemas`} de mayor prioridad.</p><ol class="top">${top}</ol>` : ''}
<h2 id="scores">Puntuación por aspecto</h2><p class="lead">Cada aspecto parte de 100 y resta puntos por cada problema abierto: crítica ${penalties.critical}, alta ${penalties.high}, media ${penalties.medium}, baja ${penalties.low} (la mitad si está por validar). Abre un aspecto para ver qué arreglar y cuántos puntos recupera cada arreglo.</p><div class="ranking">${ranking}</div>
<div class="legend"><div><span class="tag bug">Error</span><p>Algo no funciona, se contradice o muestra datos incorrectos.</p></div><div><span class="tag improvement">Mejora</span><p>Funciona, pero cuesta entenderlo o usarlo.</p></div>
<div><span class="tag high">Prioridad</span><p>${Object.entries(severityLabels).map(([key, label]) => `<strong>${label}</strong>: ${severityHelp[key]}`).join('. ')}.</p></div><div><span class="tag tentative">Por validar</span><p>Se observó, pero la causa o el impacto necesitan confirmación.</p></div></div>
<div class="findings">${ordered.length ? `<div class="filters" role="search"><label>Tipo <select data-filter="kind">${options([['all', 'Todos'], ['bug', 'Errores'], ['improvement', 'Mejoras']])}</select></label>
<label>Prioridad <select data-filter="severity">${options([['all', 'Todas'], ...Object.entries(severityLabels)])}</select></label>
<label>Pantalla <select data-filter="page">${options([['all', 'Todas'], ...pages.map(page => [page, page === 'lighthouse' ? 'Rendimiento (Lighthouse)' : pageNames.get(page) ?? page])])}</select></label>
<span>Mostrando <strong id="shown">${ordered.length}</strong> de ${ordered.length}</span></div>` : '<p>No se registraron hallazgos manuales. Revisa la cobertura antes de interpretar este resultado.</p>'}
${section('bugs', 'Errores', 'Cosas que no funcionan como deberían. Cada tarjeta muestra la zona exacta del problema y qué hacer.', bugs)}
${section('improvements', 'Mejoras posibles', 'Funciona, pero se puede hacer más claro, rápido o cómodo.', improvements)}</div>
<h2 id="automatic">Detectado automáticamente (${automated.length})</h2><p class="lead">En cada captura, axe revisa reglas de accesibilidad y el auditor comprueba si la página se sale de la pantalla. Cada entrada agrupa el mismo problema en todas las pantallas donde apareció.</p>${automated.map(item => item.html).join('') || '<p>No se detectaron problemas automáticos.</p>'}
<h2 id="coverage">Qué se revisó y qué quedó pendiente</h2><p class="lead">"Revisado" indica que el aspecto se evaluó; no certifica que todo esté bien.</p>${flows}<table class="coverage"><tbody>${coverage}</tbody></table>
<h2 id="evidence">Todas las capturas (${audit.captures.length + audit.lighthouse.length})</h2><div class="gallery">${gallery || '<p>No se capturaron estados de la aplicación.</p>'}</div>
<footer>Alcance: ${escape(audit.scope)}<br>Reporte local con imágenes incorporadas. Los datos técnicos (selectores, métricas por captura) quedan en audit.json. La revisión automática no reemplaza pruebas con personas, una auditoría completa de accesibilidad ni pruebas de seguridad.</footer></main>
<script>
const cards=[...document.querySelectorAll('.card')],filters=[...document.querySelectorAll('[data-filter]')];
const apply=()=>{let shown=0;cards.forEach(card=>{const ok=filters.every(filter=>filter.value==='all'||card.dataset[filter.dataset.filter]===filter.value);card.hidden=!ok;if(ok)shown++});document.getElementById('shown').textContent=shown;document.querySelectorAll('[data-group]').forEach(group=>{group.hidden=!group.querySelector('.card:not([hidden])')})};
filters.forEach(filter=>filter.addEventListener('change',apply));
const reveal=hash=>{const target=hash&&document.getElementById(decodeURIComponent(hash.slice(1)));if(target&&target.tagName==='DETAILS')target.open=true};
document.addEventListener('click',event=>{const link=event.target.closest('a[href^="#"]');if(link)reveal(link.hash)});reveal(location.hash);
</script></body></html>`;
}
