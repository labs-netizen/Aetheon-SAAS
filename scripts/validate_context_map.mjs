#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

let hasErrors = false;

function error(msg) {
  console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
  hasErrors = true;
}

function success(msg) {
  console.log(`\x1b[32m[PASS]\x1b[0m ${msg}`);
}

function warn(msg) {
  console.warn(`\x1b[33m[WARN]\x1b[0m ${msg}`);
}

console.log('--- Validating Codebase Context Map ---');

// 1. Check repository-graph.json parses and nodes exist
const graphPath = path.join(ROOT_DIR, 'docs', 'context', 'repository-graph.json');
if (!fs.existsSync(graphPath)) {
  error(`repository-graph.json not found at ${graphPath}`);
} else {
  try {
    const raw = fs.readFileSync(graphPath, 'utf8');
    const graph = JSON.parse(raw);
    success('repository-graph.json parsed successfully.');

    // Verify nodes / paths in graph
    const nodes = graph.nodes || graph.modules || (Array.isArray(graph) ? graph : []);
    let missingNodes = 0;
    if (Array.isArray(nodes)) {
      for (const node of nodes) {
        const filePath = node.path || node.file || (typeof node === 'string' ? node : null);
        if (filePath && typeof filePath === 'string' && !filePath.startsWith('http')) {
          const abs = path.resolve(ROOT_DIR, filePath);
          if (!fs.existsSync(abs)) {
            warn(`Graph node file does not exist: ${filePath}`);
            missingNodes++;
          }
        }
      }
    } else if (typeof nodes === 'object') {
      for (const [key, val] of Object.entries(nodes)) {
        const filePath = val.path || (val.file || key);
        if (typeof filePath === 'string' && (filePath.startsWith('src/') || filePath.startsWith('services/') || filePath.startsWith('supabase/'))) {
          const abs = path.resolve(ROOT_DIR, filePath);
          if (!fs.existsSync(abs)) {
            warn(`Graph node file does not exist: ${filePath}`);
            missingNodes++;
          }
        }
      }
    }
    if (missingNodes === 0) {
      success('All checked repository-graph.json nodes exist on disk.');
    } else {
      warn(`${missingNodes} graph nodes could not be located on disk.`);
    }
  } catch (err) {
    error(`Failed to parse repository-graph.json: ${err.message}`);
  }
}

// 2. Scan AGENTS.md and docs/context/**/*.md for forbidden machine-specific file:/// links
function checkLinksInDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      checkLinksInDir(full);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const content = fs.readFileSync(full, 'utf8');
      const fileUriMatches = content.match(/file:\/\/\/[^\s\)\"\']+/g);
      if (fileUriMatches) {
        error(`File ${path.relative(ROOT_DIR, full)} contains machine-specific file:/// links: ${fileUriMatches.slice(0, 3).join(', ')}`);
      }
    }
  }
}

const contextDir = path.join(ROOT_DIR, 'docs', 'context');
if (fs.existsSync(contextDir)) {
  checkLinksInDir(contextDir);
}
const agentsMd = path.join(ROOT_DIR, 'AGENTS.md');
if (fs.existsSync(agentsMd)) {
  const content = fs.readFileSync(agentsMd, 'utf8');
  const fileUriMatches = content.match(/file:\/\/\/[^\s\)\"\']+/g);
  if (fileUriMatches) {
    error(`AGENTS.md contains machine-specific file:/// links: ${fileUriMatches.slice(0, 3).join(', ')}`);
  }
}
if (!hasErrors) {
  success('No machine-specific file:/// links found in AGENTS.md and docs/context.');
}

// 3. Verify documented FastAPI routes match actual analytics routes
const analyticsMain = path.join(ROOT_DIR, 'services', 'analytics', 'main.py');
if (fs.existsSync(analyticsMain)) {
  const pyCode = fs.readFileSync(analyticsMain, 'utf8');
  const pyRouteMatches = pyCode.match(/@app\.(?:get|post|put|delete)\(\s*["']([^"']+)["']/g) || [];
  const actualPyRoutes = pyRouteMatches.map(m => {
    const matched = m.match(/["']([^"']+)["']/);
    return matched ? matched[1] : '';
  }).filter(Boolean);

  success(`Discovered FastAPI routes in main.py: ${actualPyRoutes.join(', ')}`);

  const apiMapPath = path.join(ROOT_DIR, 'docs', 'context', 'API_MAP.md');
  if (fs.existsSync(apiMapPath)) {
    const apiMapContent = fs.readFileSync(apiMapPath, 'utf8');
    for (const pyRoute of actualPyRoutes) {
      if (!apiMapContent.includes(pyRoute)) {
        warn(`API_MAP.md does not document discovered FastAPI route: ${pyRoute}`);
      }
    }
  }
}

if (hasErrors) {
  console.error('\n\x1b[31mContext map validation FAILED with errors.\x1b[0m');
  process.exit(1);
} else {
  console.log('\n\x1b[32mContext map validation PASSED.\x1b[0m');
  process.exit(0);
}
