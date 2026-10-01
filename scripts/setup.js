import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const serverPath = path.join(root, 'src', 'server.js');
for (const filename of ['.mcp.json', '.cursor/mcp.json']) {
  const destination = path.join(root, filename);
  let config = {};
  try { config = JSON.parse(await readFile(destination, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const existing = config.mcpServers?.['ui-auditor'];
  if (existing && existing.args?.[0] !== serverPath) throw new Error(`${filename} ya contiene otro ui-auditor; no se reemplazó.`);
  config.mcpServers = { ...config.mcpServers, 'ui-auditor': { ...existing, command: process.execPath, args: [serverPath] } };
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(config, null, 2) + '\n');
  console.log(`Configurado: ${destination}`);
}
console.log(`\nPara conectar Codex, ejecuta:\ncodex mcp add ui-auditor -- "${process.execPath}" "${serverPath}"`);
console.log('Claude Code y Cursor pueden cargar las configuraciones de este proyecto. Reinicia su sesión o recarga los MCP.');
