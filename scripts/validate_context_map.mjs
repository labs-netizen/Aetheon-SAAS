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

console.log('--- Validating Codebase Context Map ---');

// =============================================================================
// 1. Validate repository-graph.json (existence, valid schema, graph paths)
// =============================================================================
const graphPath = path.join(ROOT_DIR, 'docs', 'context', 'repository-graph.json');
if (!fs.existsSync(graphPath)) {
  error(`repository-graph.json not found at ${graphPath}`);
} else {
  try {
    const raw = fs.readFileSync(graphPath, 'utf8');
    const graph = JSON.parse(raw);

    if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      error('repository-graph.json is invalid: must be an object with "nodes" and "edges" arrays.');
    } else {
      success('repository-graph.json parsed and verified structural schema.');

      let missingNodes = 0;
      for (const node of graph.nodes) {
        if (node.path && typeof node.path === 'string') {
          const abs = path.resolve(ROOT_DIR, node.path);
          if (!fs.existsSync(abs)) {
            error(`Graph node file does not exist on disk: ${node.path} (node id: ${node.id})`);
            missingNodes++;
          }
        }
      }

      if (missingNodes === 0) {
        success(`All ${graph.nodes.length} repository-graph.json nodes verified on disk.`);
      }
    }
  } catch (err) {
    error(`Failed to parse repository-graph.json: ${err.message}`);
  }
}

// =============================================================================
// 2. Scan AGENTS.md and docs/context/**/*.md for machine-specific file:/// links
// =============================================================================
function checkNoFileUris(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileUriMatches = content.match(/file:\/\/\/[^\s\)\"\']+/g);
  if (fileUriMatches) {
    error(`File ${path.relative(ROOT_DIR, filePath)} contains machine-specific file:/// links: ${fileUriMatches.slice(0, 3).join(', ')}`);
  }
}

function walkMarkdownFiles(dir, callback) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(full, callback);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      callback(full);
    }
  }
}

const contextDir = path.join(ROOT_DIR, 'docs', 'context');
walkMarkdownFiles(contextDir, checkNoFileUris);

const agentsMd = path.join(ROOT_DIR, 'AGENTS.md');
if (fs.existsSync(agentsMd)) {
  checkNoFileUris(agentsMd);
}

if (!hasErrors) {
  success('Zero machine-specific file:/// links found in AGENTS.md and docs/context.');
}

// =============================================================================
// 3. Scan AGENTS.md and docs/context/**/*.md for missing referenced repo paths
// =============================================================================
let missingRefs = 0;

function checkReferencedPaths(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // A. Markdown links: [text](target)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const rawTarget = match[2].trim().split('#')[0]; // strip anchor
    if (!rawTarget || rawTarget.startsWith('http://') || rawTarget.startsWith('https://') || rawTarget.startsWith('mailto:') || rawTarget.startsWith('#')) {
      continue;
    }
    const resolved = path.resolve(path.dirname(filePath), rawTarget);
    if (!fs.existsSync(resolved)) {
      error(`Referenced link target missing: "${rawTarget}" in ${path.relative(ROOT_DIR, filePath)}`);
      missingRefs++;
    }
  }

  // B. Backtick repo paths: `src/...`, `tests/...`, `services/...`, `supabase/...`, `docs/...`
  const codePathRegex = /`([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)`/g;
  while ((match = codePathRegex.exec(content)) !== null) {
    const target = match[1];
    if (
      target.startsWith('src/') ||
      target.startsWith('tests/') ||
      target.startsWith('services/') ||
      target.startsWith('supabase/') ||
      target.startsWith('docs/') ||
      target.startsWith('scripts/')
    ) {
      const resolved = path.resolve(ROOT_DIR, target);
      if (!fs.existsSync(resolved)) {
        error(`Referenced repository file path missing: "${target}" in ${path.relative(ROOT_DIR, filePath)}`);
        missingRefs++;
      }
    }
  }
}

walkMarkdownFiles(contextDir, checkReferencedPaths);
if (fs.existsSync(agentsMd)) {
  checkReferencedPaths(agentsMd);
}

if (missingRefs === 0) {
  success('All referenced repository paths and markdown links exist on disk.');
}

// =============================================================================
// 4. Verify documented FastAPI routes match actual analytics routes
// =============================================================================
const analyticsMain = path.join(ROOT_DIR, 'services', 'analytics', 'main.py');
if (!fs.existsSync(analyticsMain)) {
  error(`Analytics service main.py not found at ${analyticsMain}`);
} else {
  const pyCode = fs.readFileSync(analyticsMain, 'utf8');
  const pyRouteMatches = pyCode.match(/@app\.(?:get|post|put|delete)\(\s*["']([^"']+)["']/g) || [];
  const actualPyRoutes = pyRouteMatches.map(m => {
    const matched = m.match(/["']([^"']+)["']/);
    return matched ? matched[1] : '';
  }).filter(Boolean);

  success(`Discovered FastAPI routes in main.py: ${actualPyRoutes.join(', ')}`);

  const apiMapPath = path.join(ROOT_DIR, 'docs', 'context', 'API_MAP.md');
  if (!fs.existsSync(apiMapPath)) {
    error(`API_MAP.md not found at ${apiMapPath}`);
  } else {
    const apiMapContent = fs.readFileSync(apiMapPath, 'utf8');

    // Verify all actual routes are documented in API_MAP.md
    for (const pyRoute of actualPyRoutes) {
      if (!apiMapContent.includes(pyRoute)) {
        error(`API_MAP.md missing documentation for actual FastAPI route: ${pyRoute}`);
      }
    }

    // Verify documented routes in Section 2 actually exist in main.py
    const sec2Match = apiMapContent.match(/## 2\. Python FastAPI Analytics Microservice Endpoints[\s\S]*?(?=\n##|\n#|$)/);
    if (sec2Match) {
      const sec2Text = sec2Match[0];
      const docRouteMatches = sec2Text.match(/- `(?:GET|POST|PUT|DELETE)\s+([^`]+)`/g) || [];
      for (const m of docRouteMatches) {
        const routeMatch = m.match(/- `(?:GET|POST|PUT|DELETE)\s+([^`]+)`/);
        if (routeMatch) {
          const docRoute = routeMatch[1].trim();
          if (!actualPyRoutes.includes(docRoute)) {
            error(`API_MAP.md documents non-existent FastAPI route: ${docRoute}`);
          }
        }
      }
    }
  }

  // Also check module docs in docs/context/modules/*.md for stale /analytics/ routes
  walkMarkdownFiles(path.join(ROOT_DIR, 'docs', 'context', 'modules'), (moduleFile) => {
    const modContent = fs.readFileSync(moduleFile, 'utf8');
    const staleMatches = modContent.match(/\/analytics\/(?:forecast|dsm|renewables|bess)[a-zA-Z\-_/]*/g);
    if (staleMatches) {
      error(`Module doc ${path.relative(ROOT_DIR, moduleFile)} references obsolete /analytics/ FastAPI routes: ${staleMatches.join(', ')}`);
    }
  });
}

// =============================================================================
// Final Exit Gate
// =============================================================================
if (hasErrors) {
  console.error('\n\x1b[31mContext map validation FAILED with errors.\x1b[0m');
  process.exit(1);
} else {
  console.log('\n\x1b[32mContext map validation PASSED.\x1b[0m');
  process.exit(0);
}
