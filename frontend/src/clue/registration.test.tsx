// 线索登记前端（#211；规格 E）。
// 测的是页面可见行为与纯函数：要件叠加的渲染、规范选择控件、缺件标红、
// 类型层缺件的确认清单，以及提交报文（multipart 与幂等键）。

import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClueRegisterForm, EMPTY_REGISTER_INPUT } from './ClueRegisterPage';
import {
  newIdempotencyKey,
  optionsOf,
  registerInputFromQuery,
  registerStepPath,
  requiredKeys,
  splitRules,
  submitRegistration,
  type ClueReference,
  type FormSchema,
  type FormSchemaItem,
  type RegisterInput,
} from './registration';

const REFERENCE: ClueReference = {
  result: 'listed',
  sources: [
    { code: '16', name: '日常巡查', group: '主动发现' },
    { code: '3', name: '群众举报', group: '群众举报' },
  ],
  types: [
    { code: 'land_approve_without_authority', name: '无权批准征收使用土地', domain: 'land' },
    { code: 'survey_other', name: '附录外其他', domain: 'survey' },
  ],
};

function item(partial: Partial<FormSchemaItem> & Pick<FormSchemaItem, 'key' | 'label'>): FormSchemaItem {
  return {
    group: '线索基本信息',
    required: false,
    timing: '录入时',
    consequence: '提示',
    basis: [],
    ...partial,
  };
}

const SCHEMA: FormSchema = {
  result: 'listed',
  declarationVersion: 'requirements-2026-10-24-01',
  source: { code: '16', name: '日常巡查', group: '主动发现' },
  domain: 'land',
  types: [],
  groups: [
    {
      name: '线索基本信息',
      items: [
        item({ key: 'clue.source', label: '线索来源（编码单选）', required: true, consequence: '阻断' }),
        item({ key: 'clue.domain', label: '法域', required: true, consequence: '阻断' }),
        item({ key: 'clue.location', label: '位置（空间对象，CGCS2000）', required: true, consequence: '阻断' }),
        item({ key: 'clue.received_at', label: '收到或发现的时间', required: true, consequence: '阻断' }),
        item({ key: 'clue.narrative', label: '反映的情况', required: true, consequence: '阻断' }),
        item({ key: 'clue.initial_types', label: '初步涉嫌违法类型（多值，可空）' }),
      ],
    },
    {
      name: '材料与标签',
      items: [
        item({ key: 'clue.materials', label: '随附材料', group: '材料与标签' }),
        item({ key: 'clue.tags', label: '标签（一组词）', group: '材料与标签' }),
      ],
    },
    {
      name: '主动发现',
      items: [
        item({ key: 'clue.finder', label: '发现人', group: '主动发现', required: true, consequence: '阻断' }),
        item({ key: 'clue.reporter_anonymous', label: '是否匿名', group: '群众举报', required: true, consequence: '阻断' }),
        item({ key: 'type.land_demo.subject_name', label: '违法主体名称（取值：名称｜无法确定）', group: '违法主体', required: true, consequence: '阻断' }),
      ],
    },
  ],
  items: [],
};

const INPUT: RegisterInput = {
  ...EMPTY_REGISTER_INPUT,
  sourceCode: '16',
  domain: 'land',
  values: { 'clue.narrative': '巡查发现硬化地面' },
};

/** 纯表单在内存路由里静态渲染（页面里有回线索中心的链接，链接要路由上下文）。 */
function render(props: Partial<React.ComponentProps<typeof ClueRegisterForm>> = {}): string {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <ClueRegisterForm
            reference={REFERENCE}
            schema={SCHEMA}
            input={INPUT}
            failure={null}
            busy={false}
            result={null}
            onInput={() => undefined}
            onSubmit={() => undefined}
            onSourceChange={() => undefined}
            onDomainChange={() => undefined}
            onTypesChange={() => undefined}
            {...props}
          />
        ),
      },
    ],
    { initialEntries: ['/'] },
  );
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('要件取值的读法', () => {
  it('声明里写明取值的按取值渲染，问句按是否渲染，其余按文本填', () => {
    expect(optionsOf({ label: '违法主体名称（取值：名称｜无法确定）' })).toEqual(['名称', '无法确定']);
    expect(optionsOf({ label: '是否匿名' })).toEqual(['是', '否']);
    expect(optionsOf({ label: '发现人' })).toBeNull();
  });
});

describe('缺件分层', () => {
  it('公共与来源层的阻断项与类型层缺件分开处理', () => {
    const split = splitRules(['clue.finder', 'type.land_demo.subject_name']);
    expect(split.blocking).toEqual(['clue.finder']);
    expect(split.typeGaps).toEqual(['type.land_demo.subject_name']);
  });

  it('必填集合取自后端声明，前端不另定口径', () => {
    expect(requiredKeys(SCHEMA.groups[0]!.items)).toEqual([
      'clue.source',
      'clue.domain',
      'clue.location',
      'clue.received_at',
      'clue.narrative',
    ]);
  });
});

describe('登记壳地址与门闸初值', () => {
  it('旧 /clue/register 归到工作台登记壳，步骤地址保留 clue 续办', () => {
    expect(registerStepPath(1)).toBe('/workbench/register?step=1');
    expect(registerStepPath(3, 'C1')).toBe('/workbench/register?step=3&clue=C1');
  });

  it('新办不预填法域；地址显式带来源法域时才回填', () => {
    expect(EMPTY_REGISTER_INPUT.domain).toBe('');
    expect(registerInputFromQuery(new URLSearchParams(''))).toEqual({
      sourceCode: '',
      domain: '',
      types: [],
    });
    expect(registerInputFromQuery(new URLSearchParams('sourceCode=16&domain=land&types=t1,t2'))).toEqual({
      sourceCode: '16',
      domain: 'land',
      types: ['t1', 't2'],
    });
  });
});

describe('录入表单', () => {
  it('开单门闸：来源与法域未选齐时卡内保留下拉与展开预告，不出现空态', () => {
    const html = render({ schema: null, input: EMPTY_REGISTER_INPUT });
    expect(html).toContain('data-role="register-gate"');
    expect(html).toContain('data-role="gate-preview"');
    expect(html).toContain('先选线索来源和法域');
    expect(html).toContain('请选择线索来源');
    expect(html).toContain('请选择法域');
    // 门闸未完成不出现保存按钮，也不退回只有文案的空态。
    expect(html).not.toContain('data-requires="clue.register"');
    expect(html).not.toContain('class="empty"');
  });

  it('按叠加后的要件渲染：来源与法域用选择控件，位置与材料用文件项', () => {
    const html = render();
    expect(html).toContain('线索来源');
    expect(html).toContain('发现人');
    expect(html).toContain('data-role="spatial-source"');
    expect(html).toContain('data-role="attachment"');
    expect(html).toContain('<select');
    expect(html).toContain('日常巡查（16）');
  });

  it('公共层或来源层阻断项缺失：标红并保留已填内容', () => {
    const html = render({
      failure: { status: 400, rules: ['clue.finder'] },
      input: { ...INPUT, values: { 'clue.narrative': '巡查发现硬化地面' } },
    });
    expect(html).toContain('data-error="clue.finder"');
    expect(html).toContain('巡查发现硬化地面');
    expect(html).toContain('data-role="blocking"');
  });

  it('类型层缺件：先给清单并提供确认保存，不按阻断处理', () => {
    const html = render({ failure: { status: 400, rules: ['type.land_demo.subject_name'] } });
    expect(html).toContain('data-role="type-gaps"');
    expect(html).toContain('确认并保存');
    expect(html).not.toContain('data-error="type.land_demo.subject_name"');
  });

  it('登记成功：回编号、状态与常驻缺件清单', () => {
    const html = render({
      result: {
        result: 'registered',
        id: 'C1',
        code: 'CL0000000001',
        status: 'in_pool',
        gaps: [{ key: 'type.land_demo.subject_name', label: '违法主体名称' }],
        hits: [],
      },
    });
    expect(html).toContain('CL0000000001');
    expect(html).toContain('data-role="registered"');
    expect(html).toContain('违法主体名称');
  });
});

describe('提交', () => {
  it('表单与全部文件一次提交，带幂等键', async () => {
    const calls: { url: string; key: string | null; body: FormData | null }[] = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        key: (init.headers as Record<string, string> | undefined)?.['idempotency-key'] ?? null,
        body: (init.body as FormData) ?? null,
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({ result: 'registered', id: 'C1', code: 'CL0000000001', status: 'in_pool', gaps: [], hits: [] }),
          { status: 201 },
        ),
      );
    });
    const file = new File([new Uint8Array([1, 2, 3])], '照片.png', { type: 'image/png' });
    const result = await submitRegistration(
      { dispatch: () => undefined, getState: () => ({ login: { phase: 'authenticated' } }) } as never,
      { ...INPUT, types: ['land_approve_without_authority'], attachments: [file] },
      'key-1',
    );
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/clues');
    expect(calls[0]?.key).toBe('key-1');
    const body = calls[0]?.body as FormData;
    expect(body.get('sourceCode')).toBe('16');
    expect(body.get('domain')).toBe('land');
    expect(body.get('types')).toBe('land_approve_without_authority');
    expect(body.get('values')).toContain('clue.narrative');
    expect((body.getAll('attachment') as File[]).map((item) => item.name)).toEqual(['照片.png']);
  });

  it('校验不通过：回缺件键，页面据此标红', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ result: 'non-compliant', rules: ['clue.finder'] }), { status: 400 }),
      ),
    );
    const result = await submitRegistration(
      { dispatch: () => undefined, getState: () => ({ login: { phase: 'authenticated' } }) } as never,
      INPUT,
      'key-2',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.rules).toEqual(['clue.finder']);
  });

  it('幂等键每次一枚，同一枚用于同一份报文的重复提交', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});
