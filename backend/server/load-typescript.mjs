import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

// 仓库里一部分源码按 NodeNext 写成 .js 后缀，磁盘上的文件是 .ts。
export async function resolve(specifier, context, nextResolve) {
  const relativeJs = (specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js');
  if (!relativeJs) return nextResolve(specifier, context);
  const tsSpecifier = specifier.slice(0, -3) + '.ts';
  try {
    return await nextResolve(tsSpecifier, context);
  } catch {
    return nextResolve(specifier, context);
  }
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !url.split('?')[0].endsWith('.ts')) {
    return nextLoad(url, context);
  }
  const source = await readFile(fileURLToPath(url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      useDefineForClassFields: false,
    },
    fileName: fileURLToPath(url),
  });
  return {
    format: 'module',
    source: outputText,
    shortCircuit: true,
  };
}
