import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** @param {string} root @param {(filePath: string) => boolean} [predicate] */
export async function walkFiles(root, predicate = () => true) {
  const output = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && predicate(target)) output.push(target);
    }
  }
  try {
    if ((await stat(root)).isDirectory()) await visit(root);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  return output.sort();
}

/** @param {string} filePath */
export async function text(filePath) {
  return readFile(filePath, 'utf8');
}

/** @param {string} value */
export function relative(value) {
  return path.relative(process.cwd(), value).replaceAll('\\', '/');
}