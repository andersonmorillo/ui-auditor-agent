import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAuditor } from '../src/server.js';
import { startFixture } from './fixture.js';

const fixture = await startFixture();
const server = await createAuditor({ headless: true });
const client = new Client({ name: 'ui-auditor-demo', version: '1.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);
const call = async (name, args = {}) => {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
  if (response.isError) throw new Error(response.content[0].text);
  return response.content[0]?.type === 'text' ? response.content[0].text : null;
};
const json = async (name, args) => JSON.parse(await call(name, args));
try {
  const { audit_id } = await json('audit_start', { title: 'Demo: evaluación del panel de pedidos', url: fixture.url, flows: ['Consultar pedidos', 'Configurar notificaciones', 'Recuperarse de un correo inválido'], scope: 'Aplicación local de prueba con problemas intencionales. No es una evaluación de la aplicación del usuario.' });
  await call('browser_navigate', { url: fixture.url });
  const desktop = await json('audit_capture', { audit_id, label: 'Resumen de pedidos · escritorio' });
  await call('browser_click', { target: '#open-settings' });
  await call('browser_type', { target: '#email', text: 'correo-invalido' });
  await call('browser_click', { target: '#save' });
  const error = await json('audit_capture', { audit_id, label: 'Configuración · correo inválido', mask_selectors: ['#email'] });
  await json('audit_finding', { audit_id, category: 'feedback', severity: 'medium', title: 'El mensaje de resultado no anuncia el cambio a tecnologías de asistencia', observed: 'Después de guardar, el mensaje aparece en un párrafo sin role=alert ni aria-live.', impact: 'Una persona que use un lector de pantalla puede no enterarse del resultado sin buscar el mensaje.', recommendation: 'Usar un estado anunciado con aria-live; comprobar el anuncio con un lector de pantalla.', steps: ['Abrir Configuración', 'Escribir un correo inválido', 'Guardar cambios'], evidence_id: error.evidence_id, confidence: 'hypothesis', region: { x: 189, y: 830, width: 440, height: 50 } });
  await call('browser_resize', { width: 390, height: 844 });
  const mobile = await json('audit_capture', { audit_id, label: 'Panel · móvil', run_axe: false });
  await json('audit_assess', { audit_id, category: 'responsive', status: 'partial', notes: 'Revisados escritorio y móvil. Hay desbordamiento en móvil; tablet y orientación pendientes.', evidence_ids: [desktop.evidence_id, mobile.evidence_id] });
  await json('audit_assess', { audit_id, category: 'accessibility', status: 'partial', notes: 'axe detectó contraste y un campo sin etiqueta asociada. Teclado y lector de pantalla pendientes.', evidence_ids: [desktop.evidence_id, error.evidence_id] });
  await json('audit_assess', { audit_id, category: 'functionality', status: 'partial', notes: 'Se abrió la configuración y se comprobó el error de validación; guardado válido pendiente.', evidence_ids: [error.evidence_id] });
  if (process.argv.includes('--lighthouse')) {
    console.log('Ejecutando Lighthouse sobre la aplicación local de prueba…');
    const run = await json('audit_lighthouse', { audit_id, url: fixture.url, device: 'desktop' });
    await json('audit_assess', { audit_id, category: 'performance', status: 'partial', notes: 'Una navegación Lighthouse en escritorio; móvil y respuesta a interacciones pendientes.', evidence_ids: [run.evidence_id] });
  }
  const report = await json('audit_report', { audit_id, summary: 'La demostración registra evidencia real de navegación, validación de formularios, accesibilidad automática y adaptación móvil. Las prioridades iniciales son corregir las etiquetas y el contraste y eliminar el ancho mínimo que desborda en móvil. Las áreas no comprobadas aparecen como pendientes.' });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await call('browser_close');
  await client.close();
  await server.close();
  await fixture.close();
}
