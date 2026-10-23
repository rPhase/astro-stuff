import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'site-output');

const ignored = new Set([
  'node_modules',
  'site-output',
  'dist',
  '.git',
  '.netlify',
]);

function isAstroProject(pkg, files) {
  return (
    Boolean(pkg.dependencies?.astro || pkg.devDependencies?.astro) ||
    files.some((file) => /^astro\.config\.(mjs|js|ts|cjs|mts|cts)$/.test(file))
  );
}

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  );
}

function displayName(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function createIndex(projects) {
  const links = projects
    .map(({ name }) => {
      const label = escapeHtml(displayName(name));
      const href = `/${encodeURIComponent(name)}/`;

      return `      <li><a href="${href}">${label} →</a></li>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="A collection of Astro projects and experiments.">
  <title>Astro Projects</title>
  <style>
    body {
      max-width: 900px;
      margin: 4rem auto;
      padding: 0 1.5rem;
      font: 16px/1.6 system-ui, sans-serif;
      color: #222;
      background: #fafafa;
    }
    h1 { margin-bottom: 0.5rem; }
    .projects {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      padding: 0;
      list-style: none;
    }
    .projects a {
      display: block;
      padding: 1.25rem;
      color: inherit;
      text-decoration: none;
      background: white;
      border: 1px solid #ddd;
      border-radius: 10px;
      transition: transform 150ms, border-color 150ms;
    }
    .projects a:hover {
      border-color: #777;
      transform: translateY(-2px);
    }
  </style>
</head>
<body>
  <h1>Astro Projects</h1>
  <p>A collection of projects, tutorials, and experiments.</p>
  ${
    projects.length
      ? `<ul class="projects">\n${links}\n    </ul>`
      : '<p>No Astro projects found yet.</p>'
  }
</body>
</html>
`;
}

async function findProjects() {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith('.') ||
      ignored.has(entry.name)
    ) {
      continue;
    }

    const projectDir = path.join(root, entry.name);

    let files;
    let pkg;

    try {
      files = await fs.readdir(projectDir);
      pkg = JSON.parse(
        await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'),
      );
    } catch {
      continue;
    }

    if (isAstroProject(pkg, files) && pkg.scripts?.build) {
      projects.push({ name: entry.name, projectDir });
    }
  }

  return projects.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

async function main() {
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });

  const projects = await findProjects();

  if (projects.length === 0) {
    throw new Error('No Astro projects with build scripts found.');
  }

  // Generate the directory page from discovered projects.
  await fs.writeFile(
    path.join(output, 'index.html'),
    createIndex(projects),
    'utf8',
  );

  for (const { name, projectDir } of projects) {
    const base = `/${name}/`;

    console.log(`\nBuilding ${name} with base ${base}`);

    const result = spawnSync(
      'pnpm',
      ['--dir', projectDir, 'run', 'build', '--', `--base=${base}`],
      {
        cwd: root,
        stdio: 'inherit',
        env: process.env,
        shell: process.platform === 'win32',
      },
    );

    if (result.error) throw result.error;

    if (result.status !== 0) {
      throw new Error(`Build failed for ${name}`);
    }

    const dist = path.join(projectDir, 'dist');

    try {
      await fs.access(path.join(dist, 'index.html'));
    } catch {
      throw new Error(`${name} did not generate dist/index.html`);
    }

    await fs.cp(dist, path.join(output, name), {
      recursive: true,
      force: true,
    });

    console.log(`Published ${name} to /${name}/`);
  }

  console.log(`\nBuilt ${projects.length} projects into ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
