// 发现器信号源 2（spec #322 二期 T5）：静态能力枚举。
// 纯函数，零 I/O：调用方先读源码文本（见 harness/discover-sources.ts），这里只做轻解析。
// 不 import 前端模块（router.tsx/menu.ts 是 React/TSX，NodeNext 下不可直接 import）。

/** HTTP 方法枚举：实测只出现 GET/POST，其余按 NestJS 装饰器补齐。 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'ALL';

/** 一个控制器源文件（调用方读盘后传入文本）。 */
export interface ControllerSource {
  readonly file: string;
  readonly text: string;
}

/** 一条方法级 API 路由。path 为类前缀与方法路径拼接后的完整路径。 */
export interface ApiRoute {
  readonly file: string;
  readonly className: string;
  readonly controllerPath: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly line: number;
}

const CONTROLLER_RE = /@Controller\(\s*(?:'([^']*)')?\s*\)/;
const CLASS_NAME_RE = /export\s+class\s+(\w+)/;
const METHOD_ROUTE_RE = /@(Get|Post|Put|Patch|Delete|Options|Head|All)\(\s*'([^']*)'\s*\)/g;
const CONTROLLERS_SECTION_RE = /controllers:\s*\[([\s\S]*?)\]/;
const CONTROLLER_CLASS_TOKEN_RE = /\b([A-Za-z_$][\w$]*Controller)\b/g;

/** 控制器源码 → 导出类名；无 `export class` 返回 null。 */
export function controllerClassName(controllerSource: string): string | null {
  return CLASS_NAME_RE.exec(controllerSource)?.[1] ?? null;
}

/**
 * app.module.ts 源码 → `controllers:` 数组登记的控制器类名集合。
 * 注册是能力生效的前提：未登记的控制器文件不计能力。
 */
export function registeredControllerClasses(appModuleSource: string): Set<string> {
  const section = CONTROLLERS_SECTION_RE.exec(appModuleSource);
  const classes = new Set<string>();
  if (section === null) return classes;
  CONTROLLER_CLASS_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null = CONTROLLER_CLASS_TOKEN_RE.exec(section[1] ?? '');
  while (match !== null) {
    classes.add(match[1]);
    match = CONTROLLER_CLASS_TOKEN_RE.exec(section[1] ?? '');
  }
  return classes;
}

/** 字符下标换算 1 起始行号。 */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/** 拼接类前缀与方法路径为完整路由；空前缀/空方法路径都不产生空段。 */
function fullRoute(controllerPath: string, methodPath: string): string {
  const joined = [controllerPath, methodPath].filter((part) => part !== '').join('/');
  return `/${joined}`.replace(/\/+/g, '/');
}

/** NestJS 控制器装饰器源码 → 方法级路由清单（文件内按出现顺序）。 */
export function enumerateApiRoutes(sources: readonly ControllerSource[]): ApiRoute[] {
  const routes: ApiRoute[] = [];
  for (const source of sources) {
    const controller = CONTROLLER_RE.exec(source.text);
    const classMatch = CLASS_NAME_RE.exec(source.text);
    // 没有类装饰器即不是控制器文件；枚举器只认显式 @Controller。
    if (controller === null) continue;
    const controllerPath = controller[1] ?? '';
    const className = classMatch?.[1] ?? '';
    METHOD_ROUTE_RE.lastIndex = 0;
    let match: RegExpExecArray | null = METHOD_ROUTE_RE.exec(source.text);
    while (match !== null) {
      routes.push({
        file: source.file,
        className,
        controllerPath,
        method: match[1].toUpperCase() as HttpMethod,
        path: fullRoute(controllerPath, match[2] ?? ''),
        line: lineAt(source.text, match.index),
      });
      match = METHOD_ROUTE_RE.exec(source.text);
    }
  }
  return routes;
}

/** 一条 React Router 路由。fullPath 按祖先拼接；无 path 的路由继承父级。 */
export interface UiRoute {
  readonly id: string;
  readonly path: string | null;
  readonly fullPath: string | null;
  readonly index: boolean;
  readonly parentId: string | null;
  readonly line: number;
}

interface RouteContext {
  readonly parent: RouteContext | null;
  readonly line: number;
  id: string | null;
  path: string | null;
  index: boolean;
  fullPath: string | null;
}

/** 去掉行内 `//` 注释，并统计字符串外的花括号数量（源码行内字符串不跨行）。 */
function analyzeLine(line: string): { code: string; opens: number; closes: number } {
  let code = '';
  let quote: string | null = null;
  let opens = 0;
  let closes = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote !== null) {
      code += ch;
      if (ch === '\\') {
        code += line[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      code += ch;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') break;
    if (ch === '{') opens += 1;
    if (ch === '}') closes += 1;
    code += ch;
  }
  return { code, opens, closes };
}

/** 相对路径片段按父级完整路径拼接；绝对片段直接生效。 */
function joinPath(parent: string | null, child: string): string {
  if (child.startsWith('/')) return child.replace(/\/+/g, '/');
  const base = parent === null || parent === '/' ? '/' : `${parent.replace(/\/+$/, '')}/`;
  return `${base}${child}`.replace(/\/+/g, '/');
}

/** 惰性计算完整路径：父级尚未收口时，父级字段已先赋值。 */
function effectiveFullPath(ctx: RouteContext): string {
  if (ctx.fullPath !== null) return ctx.fullPath;
  if (ctx.path === null) {
    ctx.fullPath = ctx.parent === null ? '/' : effectiveFullPath(ctx.parent);
  } else {
    ctx.fullPath = joinPath(ctx.parent === null ? null : effectiveFullPath(ctx.parent), ctx.path);
  }
  return ctx.fullPath;
}

/** router.tsx 源码 → 静态路由清单（只认 id 路由对象，保留父子关系与行号）。 */
export function enumerateUiRoutes(routerSource: string): UiRoute[] {
  const routes: UiRoute[] = [];
  const stack: RouteContext[] = [];
  const lines = routerSource.split('\n');

  lines.forEach((rawLine, index) => {
    const { code, opens, closes } = analyzeLine(rawLine);
    for (let i = 0; i < opens; i += 1) {
      const parent = stack.at(-1) ?? null;
      stack.push({
        parent,
        line: index + 1,
        id: null,
        path: null,
        index: false,
        fullPath: null,
      });
    }
    const top = stack.at(-1);
    if (top !== undefined && (opens > 0 || closes === 0)) {
      const id = /\bid:\s*['"]([^'"]+)['"]/.exec(code);
      const path = /\bpath:\s*['"]([^'"]*)['"]/.exec(code);
      if (id !== null && top.id === null) top.id = id[1];
      if (path !== null && top.path === null) top.path = path[1];
      if (/\bindex:\s*true/.test(code)) top.index = true;
    }
    for (let i = 0; i < closes; i += 1) {
      const ctx = stack.pop();
      if (ctx === undefined || ctx.id === null) continue;
      routes.push({
        id: ctx.id,
        path: ctx.path,
        fullPath: effectiveFullPath(ctx),
        index: ctx.index,
        parentId: ctx.parent?.id ?? null,
        line: ctx.line,
      });
    }
  });

  // 收口顺序是子先父后；按源码行号还原为声明顺序（父在前、同级按出现顺序）。
  return routes.sort((a, b) => a.line - b.line);
}

/** 线索中心视图（`/clue?view=` 的取值）。 */
export interface ClueView {
  readonly id: string;
  readonly label: string;
}

const CLUE_VIEW_RE = /\{\s*id:\s*'([^']+)'\s*,\s*label:\s*'([^']*)'\s*\}/g;

/** clueUrl.ts 源码 → CLUE_VIEWS 清单（menu.ts 展开 spread 所需）。 */
export function enumerateClueViews(clueUrlSource: string): ClueView[] {
  const views: ClueView[] = [];
  CLUE_VIEW_RE.lastIndex = 0;
  let match: RegExpExecArray | null = CLUE_VIEW_RE.exec(clueUrlSource);
  while (match !== null) {
    views.push({ id: match[1], label: match[2] });
    match = CLUE_VIEW_RE.exec(clueUrlSource);
  }
  return views;
}

/** 一条菜单条目（一级或二级）。 */
export interface MenuEntry {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly primary: string | null;
  readonly planned: boolean;
  readonly line: number;
}

/** 规划中占位登记表的一条。 */
export interface PlannedModuleEntry {
  readonly id: string;
  readonly primary: string;
  readonly label: string;
  readonly path: string;
  readonly inMenu: boolean;
  readonly line: number;
}

/** 菜单能力清单：一级入口、二级入口、规划占位登记表。 */
export interface MenuCapabilities {
  readonly primaries: readonly MenuEntry[];
  readonly secondaries: readonly MenuEntry[];
  readonly planned: readonly PlannedModuleEntry[];
}

/** 菜单枚举输入：menu.ts 源码 + 从 clueUrl.ts 解析出的视图清单。 */
export interface MenuSources {
  readonly menuSource: string;
  readonly clueViews: readonly ClueView[];
}

interface ParsedEntry {
  id: string;
  label: string;
  path: string;
  primary: string | null;
  inMenu: boolean;
  line: number;
}

/** 在单行内提取菜单条目字段（多行对象逐行累积）。 */
function fillEntry(entry: ParsedEntry, code: string, line: number): void {
  const id = /\bid:\s*['"]([^'"]+)['"]/.exec(code);
  const label = /\blabel:\s*['"]([^'"]*)['"]/.exec(code);
  const path = /\bpath:\s*['"]([^'"]*)['"]/.exec(code);
  const primary = /\bprimary:\s*['"]([^'"]+)['"]/.exec(code);
  const inMenu = /\binMenu:\s*(true|false)/.exec(code);
  if (id !== null && entry.id === '') {
    entry.id = id[1];
    entry.line = line;
  }
  if (label !== null && entry.label === '') entry.label = label[1];
  if (path !== null && entry.path === '') entry.path = path[1];
  if (primary !== null && entry.primary === null) entry.primary = primary[1];
  if (inMenu !== null) entry.inMenu = inMenu[1] === 'true';
}

/** 找数组字面量的起止行（`export const NAME ... = [` 到同级 `];`）。 */
function sectionRange(lines: readonly string[], name: string): { from: number; to: number } | null {
  const from = lines.findIndex((line) => new RegExp(`export const ${name}\\b`).test(line));
  if (from < 0) return null;
  for (let i = from; i < lines.length; i += 1) {
    if (lines[i].trim() === '];') return { from, to: i };
  }
  return null;
}

/** 单行起始的对象字面量 → 一条累积条目；非对象起始行返回 null。 */
function parseEntryAt(
  lines: readonly string[],
  from: number,
  to: number,
): { entry: ParsedEntry; end: number } | null {
  if (analyzeLine(lines[from]).opens === 0) return null;
  const entry: ParsedEntry = {
    id: '',
    label: '',
    path: '',
    primary: null,
    inMenu: false,
    line: from + 1,
  };
  let depth = 0;
  let i = from;
  while (i <= to) {
    const analyzed = analyzeLine(lines[i]);
    depth += analyzed.opens;
    fillEntry(entry, analyzed.code, i + 1);
    depth -= analyzed.closes;
    if (depth <= 0) break;
    i += 1;
  }
  return { entry, end: i };
}

/** 解析一个菜单数组区的对象字面量条目；spread 行本身不产条目。 */
function parseEntries(lines: readonly string[], from: number, to: number): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  let i = from;
  while (i <= to) {
    const parsed = parseEntryAt(lines, i, to);
    if (parsed === null) {
      i += 1;
      continue;
    }
    if (parsed.entry.id !== '') entries.push(parsed.entry);
    i = parsed.end + 1;
  }
  return entries;
}

/** 跳过 spread 块（从当前行到花括号平衡为止），返回块末行下标。 */
function skipSpreadBlock(lines: readonly string[], from: number, to: number): number {
  const first = analyzeLine(lines[from]);
  let depth = first.opens - first.closes;
  let i = from;
  while (depth > 0 && i < to) {
    i += 1;
    const { opens, closes } = analyzeLine(lines[i]);
    depth += opens - closes;
  }
  return i;
}

/** menu.ts 源码（+ clue 视图）→ 静态菜单能力清单；`...spread` 两处按注入数据展开。 */
export function enumerateMenu(sources: MenuSources): MenuCapabilities {
  const lines = sources.menuSource.split('\n');
  const primaryRange = sectionRange(lines, 'PRIMARY_ENTRIES');
  const plannedRange = sectionRange(lines, 'PLANNED_MODULES');
  const secondaryRange = sectionRange(lines, 'SECONDARY_ENTRIES');

  const planned: PlannedModuleEntry[] =
    plannedRange === null
      ? []
      : parseEntries(lines, plannedRange.from, plannedRange.to).map((entry) => ({
          id: entry.id,
          primary: entry.primary ?? '',
          label: entry.label,
          path: entry.path,
          inMenu: entry.inMenu,
          line: entry.line,
        }));

  const primaries: MenuEntry[] =
    primaryRange === null
      ? []
      : parseEntries(lines, primaryRange.from, primaryRange.to).map((entry) => ({
          id: entry.id,
          label: entry.label,
          path: entry.path,
          primary: entry.id,
          planned: false,
          line: entry.line,
        }));

  const secondaries: MenuEntry[] = [];
  if (secondaryRange !== null) {
    for (let i = secondaryRange.from; i <= secondaryRange.to; i += 1) {
      const line = lines[i];
      if (/\.\.\.CLUE_VIEWS\b/.test(line)) {
        for (const view of sources.clueViews) {
          secondaries.push({
            id: `clue-${view.id}`,
            label: view.label,
            path: `/clue?view=${view.id}`,
            primary: 'clue',
            planned: false,
            line: i + 1,
          });
        }
        i = skipSpreadBlock(lines, i, secondaryRange.to);
        continue;
      }
      if (/\.\.\.PLANNED_MODULES\b/.test(line)) {
        for (const item of planned) {
          if (!item.inMenu) continue;
          secondaries.push({
            id: item.id,
            label: item.label,
            path: item.path,
            primary: item.primary,
            planned: true,
            line: i + 1,
          });
        }
        i = skipSpreadBlock(lines, i, secondaryRange.to);
        continue;
      }
      // 字面量条目：复用 parseEntryAt 的多行对象累积。
      const parsed = parseEntryAt(lines, i, secondaryRange.to);
      if (parsed === null) continue;
      if (parsed.entry.id !== '') {
        secondaries.push({
          id: parsed.entry.id,
          label: parsed.entry.label,
          path: parsed.entry.path,
          primary: parsed.entry.primary,
          planned: false,
          line: parsed.entry.line,
        });
      }
      i = parsed.end;
    }
  }

  return { primaries, secondaries, planned };
}

/** Feature Map 节点。path 为行内首个反引号包裹的 / 串（可含 query）。 */
export interface FeatureMapNode {
  readonly id: string;
  readonly name: string;
  readonly path: string | null;
  readonly line: number;
}

const FEATURE_NODE_RE = /^\|\s*`(nav\.[^`]+)`/;
const BACKTICK_RE = /`([^`]*)`/g;

/** feature-map.md 源码 → 地图节点清单；列数不齐，按行首 id + 行内首个路径容错提取。 */
export function enumerateFeatureMap(featureMapSource: string): FeatureMapNode[] {
  const nodes: FeatureMapNode[] = [];
  featureMapSource.split('\n').forEach((line, index) => {
    const idMatch = FEATURE_NODE_RE.exec(line);
    if (idMatch === null) return;
    const cells = line.split('|');
    const name = (cells[2] ?? '').replace(/`/g, '').trim();
    let path: string | null = null;
    BACKTICK_RE.lastIndex = 0;
    let token: RegExpExecArray | null = BACKTICK_RE.exec(line);
    while (token !== null) {
      if (token[1].startsWith('/')) {
        path = token[1];
        break;
      }
      token = BACKTICK_RE.exec(line);
    }
    nodes.push({ id: idMatch[1], name, path, line: index + 1 });
  });
  return nodes;
}
