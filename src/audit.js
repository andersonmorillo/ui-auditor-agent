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
const base = { audit_id: id };
export const schemas = {
  audit_start: z.object({ title: text, url: z.url().refine(value => /^https?:\/\//.test(value), 'Usa una URL HTTP o HTTPS'), flows: z.array(text).max(30).default([]), scope: text.default('Evaluación exploratoria de la interfaz web') }),
  audit_capture: z.object({ ...base, label: text, run_axe: z.boolean().default(true), mask_selectors: z.array(text).max(30).default([]) }),
  audit_finding: z.object({ ...base, category: z.enum(Object.keys(categories)), severity: z.enum(['critical', 'high', 'medium', 'low']), title: text, observed: text, impact: text, recommendation: text, steps: z.array(text).min(1).max(30), evidence_id: id, confidence: z.enum(['confirmed', 'hypothesis']), region: z.object({ x: z.number().nonnegative(), y: z.number().nonnegative(), width: z.number().positive(), height: z.number().positive() }).optional() }),
  audit_assess: z.object({ ...base, category: z.enum(Object.keys(categories)), status: z.enum(['reviewed', 'partial', 'not_applicable']), notes: text, evidence_ids: z.array(id).max(100).default([]) }),
  audit_status: z.object(base),
  audit_lighthouse: z.object({ ...base, url: z.url().refine(value => /^https?:\/\//.test(value), 'Usa una URL HTTP o HTTPS'), device: z.enum(['mobile', 'desktop']).default('mobile') }),
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
  const evidence = audit.captures.find(capture => capture.id === input.evidence_id);
  if (!evidence) throw new Error('La evidencia debe pertenecer a esta auditoría. Usa audit_capture primero.');
  if (input.region && (input.region.x + input.region.width > evidence.viewport.width || input.region.y + input.region.height > evidence.viewport.height)) throw new Error('La región debe estar dentro de la captura del viewport.');
  const { audit_id, ...finding } = input;
  const result = { id: randomUUID(), ...finding, url: evidence.url, source };
  audit.findings.push(result);
  return result;
}

export function assess(audit, input) {
  if (input.status !== 'not_applicable' && !input.evidence_ids.length) throw new Error('Una evaluación revisada o parcial necesita al menos una evidencia.');
  if (input.evidence_ids.some(evidenceId => ![...audit.captures, ...(audit.lighthouse ?? [])].some(evidence => evidence.id === evidenceId))) throw new Error('La evidencia no pertenece a esta auditoría.');
  audit.assessments[input.category] = { status: input.status, notes: input.notes, evidence_ids: input.evidence_ids };
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const statusLabels = { reviewed: 'Revisado', partial: 'Parcial', not_applicable: 'No aplica', not_reviewed: 'Pendiente' };
const severityLabels = { critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja' };
const date = value => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' (Bogotá)';

export async function renderReport(root, audit, summary) {
  const images = new Map();
  for (const capture of audit.captures) images.set(capture.id, `data:image/png;base64,${(await readFile(path.join(auditDir(root, audit.id), `${capture.id}.png`))).toString('base64')}`);
  const figure = (capture, region) => {
    const box = region ? `<span class="annotation" style="left:${region.x / capture.viewport.width * 100}%;top:${region.y / capture.viewport.height * 100}%;width:${region.width / capture.viewport.width * 100}%;height:${region.height / capture.viewport.height * 100}%" aria-label="Área del hallazgo"></span>` : '';
    return `<figure><div class="image" style="max-width:${capture.viewport.width}px"><img src="${images.get(capture.id)}" alt="${escape(capture.label)}" loading="lazy">${box}</div><figcaption>${escape(capture.label)} · ${capture.viewport.width} × ${capture.viewport.height} · ${escape(capture.url)}</figcaption></figure>`;
  };
  const coverage = Object.entries(categories).map(([key, category]) => {
    const assessment = audit.assessments[key] ?? { status: 'not_reviewed', notes: 'No se registró una evaluación de este aspecto.', evidence_ids: [] };
    return `<tr><th scope="row">${escape(category.label)}</th><td>${statusLabels[assessment.status]}</td><td>${escape(assessment.notes)}<details><summary>Criterios y evidencia</summary><p>${escape(category.checks)}</p>${assessment.evidence_ids.map(evidenceId => `<a href="#capture-${evidenceId}">Ver captura</a>`).join(' · ')}</details></td></tr>`;
  }).join('');
  const priorities = { critical: 0, high: 1, medium: 2, low: 3 };
  const findings = [...audit.findings].sort((a, b) => priorities[a.severity] - priorities[b.severity]).map((finding, index) => {
    const capture = audit.captures.find(item => item.id === finding.evidence_id);
    return `<article data-severity="${finding.severity}"><div class="finding-heading"><span class="priority ${finding.severity}">${severityLabels[finding.severity]}</span><span>${escape(categories[finding.category].label)} · ${finding.confidence === 'confirmed' ? 'Observado' : 'Hipótesis'} · ${escape(finding.source)}</span></div><h3>${index + 1}. ${escape(finding.title)}</h3><p>${escape(finding.observed)}</p><dl><dt>Impacto</dt><dd>${escape(finding.impact)}</dd><dt>Mejora propuesta</dt><dd>${escape(finding.recommendation)}</dd></dl><details><summary>Cómo reproducir</summary><ol>${finding.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol></details>${figure(capture, finding.region)}</article>`;
  }).join('');
  const lighthouse = (audit.lighthouse ?? []).map(run => `<section id="capture-${run.id}" class="capture"><h3>Lighthouse · ${escape(run.device)}</h3><p>${escape(run.final_url)} · ${escape(date(run.created_at))}</p><p>Navegación en un navegador independiente, sin la sesión autenticada del agente. Puntuación de rendimiento: ${run.score === null ? 'No disponible' : Math.round(run.score * 100) + '/100'}.</p>${run.screenshot ? `<figure><img src="${escape(run.screenshot)}" alt="Estado final medido por Lighthouse" loading="lazy"><figcaption>Captura final de la navegación de Lighthouse.</figcaption></figure>` : ''}<pre>${escape(JSON.stringify(run.metrics, null, 2))}</pre><details><summary>Auditorías que requieren atención (${run.opportunities.length})</summary>${run.opportunities.map(item => `<h4>${escape(item.title)}</h4><p>${escape(item.display_value)}</p><p>${escape(item.description)}</p>`).join('')}</details><p><a href="${run.id}-lighthouse.html">Abrir informe original de Lighthouse</a></p></section>`).join('');
  const captures = audit.captures.map(capture => `<section id="capture-${capture.id}" class="capture"><h3>${escape(capture.label)}</h3>${figure(capture)}<p>${capture.axe ? `axe: ${capture.axe.violations.length} reglas con infracciones; ${capture.axe.incomplete.length} reglas requieren revisión manual.` : 'axe no se ejecutó en este estado.'}</p><details><summary>Métricas y comprobaciones</summary><pre>${escape(JSON.stringify({ metrics: capture.metrics, overflow: capture.overflow, axe_incomplete: capture.axe?.incomplete }, null, 2))}</pre><p>Mediciones de navegación de esta sesión. No son datos de campo ni una puntuación Lighthouse.</p></details></section>`).join('') + lighthouse;
  const reviewed = Object.values(audit.assessments).filter(item => item.status === 'reviewed').length;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(audit.title)} — UI Auditor</title><style>
  :root{font-family:system-ui,sans-serif;color:#17202d;background:#f3f5f7;line-height:1.6}*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:40px 24px}header{border-bottom:2px solid #17202d;padding-bottom:28px;margin-bottom:36px}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:#48586b}h1{font-size:clamp(28px,4vw,42px);line-height:1.2;margin:12px 0}h2{margin-top:44px}h3{font-size:21px;line-height:1.4}a{color:#164b94;overflow-wrap:anywhere}.summary{max-width:80ch;white-space:pre-wrap}.stats{display:flex;gap:32px;flex-wrap:wrap;margin-top:24px}.stats strong{font-size:28px;display:block}.stats span{font-size:13px;color:#48586b}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:12px 10px;border-bottom:1px solid #ccd3dc;vertical-align:top}th{min-width:130px}article{background:#fff;padding:24px;border:1px solid #ccd3dc;margin:20px 0;break-inside:avoid}.finding-heading{display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:13px;color:#48586b}.priority{padding:3px 10px;border:1px solid currentColor}.critical,.high{color:#97252a}.medium{color:#76510d}.low{color:#164b94}dl{display:grid;grid-template-columns:150px 1fr;gap:12px}dt{font-weight:600}dd{margin:0;white-space:pre-wrap}summary{cursor:pointer}figure{margin:24px 0 0}.image{position:relative;border:1px solid #ccd3dc;line-height:0}img{display:block;width:100%;height:auto}.annotation{position:absolute;border:3px solid #bf252e;pointer-events:none}figcaption{font-size:12px;color:#48586b;margin-top:8px;overflow-wrap:anywhere}.capture{margin:28px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#e8edf2;padding:16px;font-size:12px}nav{display:flex;gap:18px;flex-wrap:wrap}button,select{font:inherit;padding:8px;background:#fff;border:1px solid #9ba8b7}footer{margin-top:40px;padding-top:20px;border-top:1px solid #ccd3dc;font-size:13px;color:#48586b}[hidden]{display:none!important}@media(max-width:600px){main{padding:24px 14px}article{padding:16px}dl{grid-template-columns:1fr;gap:4px}table{font-size:13px}th,td{padding:8px 4px}th{min-width:0}}@media print{body{background:#fff}main{max-width:none;padding:0}button,.filters{display:none}article[hidden]{display:block!important}details{display:block}img{max-height:650px;object-fit:contain;object-position:left top}}
  </style></head><body><main><header><div class="eyebrow">UI Auditor · Evaluación exploratoria</div><h1>${escape(audit.title)}</h1><p><a href="${escape(audit.url)}">${escape(audit.url)}</a> · ${escape(date(audit.created_at))}</p><p class="summary">${escape(summary)}</p><div class="stats"><div><strong>${audit.findings.length}</strong><span>Hallazgos</span></div><div><strong>${audit.captures.length}</strong><span>Estados con evidencia</span></div><div><strong>${reviewed}/${Object.keys(categories).length}</strong><span>Aspectos marcados como revisados</span></div></div></header><nav aria-label="Secciones del reporte"><a href="#coverage">Cobertura</a><a href="#findings">Mejoras</a><a href="#evidence">Evidencia</a><button type="button" onclick="window.print()">Imprimir / guardar PDF</button></nav><h2>Alcance</h2><p>${escape(audit.scope)}</p>${audit.flows.length ? `<ul>${audit.flows.map(flow => `<li>${escape(flow)}</li>`).join('')}</ul>` : '<p>No se definieron flujos específicos.</p>'}<h2 id="coverage">Qué se evaluó</h2><p>Revisado indica una evaluación registrada por el agente; no significa que todo haya pasado ni certifica cumplimiento.</p><table><thead><tr><th>Aspecto</th><th>Estado</th><th>Observaciones</th></tr></thead><tbody>${coverage}</tbody></table><h2 id="findings">Mejoras priorizadas</h2><div class="filters"><label for="severity">Prioridad </label><select id="severity"><option value="all">Todas</option>${Object.entries(severityLabels).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></div>${findings || '<p>No se registraron hallazgos. Consulta la cobertura antes de interpretar este resultado.</p>'}<h2 id="evidence">Estados y capturas</h2>${captures || '<p>No se capturaron estados de la aplicación.</p>'}<footer>Reporte local con imágenes incorporadas. Las hipótesis necesitan validación. La revisión automática no reemplaza pruebas con personas, una auditoría completa de accesibilidad ni pruebas de seguridad.</footer></main><script>document.getElementById('severity').addEventListener('change',event=>{document.querySelectorAll('[data-severity]').forEach(item=>{item.hidden=event.target.value!=='all'&&item.dataset.severity!==event.target.value})})</script></body></html>`;
}
