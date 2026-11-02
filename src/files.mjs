import fs from 'node:fs';
import path from 'node:path';

export const forbidden = name => name === '.secrets' || name.startsWith('.env');
const ignored = new Set(['.git', '.gp-tmp', 'node_modules', 'coverage']);
export function walk(root) {
  root = safePath(root);
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (forbidden(entry.name) || ignored.has(entry.name)) continue;
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink: ${file}`);
    if (entry.isDirectory()) files.push(...walk(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}
export function safePath(file) {
  const full = path.resolve(file);
  let current = path.parse(full).root;
  for (const part of full.slice(current.length).split(path.sep).filter(Boolean)) {
    if (forbidden(part)) throw new Error(`Forbidden path: ${file}`);
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink: ${current}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return full;
}
export function inside(root, relative) {
  const result = path.resolve(root, relative);
  if (!result.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Path escapes destination: ${relative}`);
  return safePath(result);
}
