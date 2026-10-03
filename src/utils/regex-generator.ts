import { z } from 'zod';

export const regexGeneratorSchema = z.object({
    all: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    any: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    exclude: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    sample: z.string().max(10000).default(''),
}).strict().refine(v => v.all.length + v.any.length > 0, '请至少填写一个包含词');

function literal(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/\s/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function generateRegex(input: z.infer<typeof regexGeneratorSchema>) {
    const all = [...new Set(input.all)].map(literal);
    const any = [...new Set(input.any)].map(literal);
    const exclude = [...new Set(input.exclude)].map(literal);
    const pattern = '^' + (exclude.length ? `(?!.*(?:${exclude.join('|')}))` : '')
        + all.map(word => `(?=.*${word})`).join('')
        + (any.length ? `(?=.*(?:${any.join('|')}))` : '') + '.*$';
    const regex = `/${pattern}/is`;
    if (regex.length > 1000) throw new Error('规则太长，请减少关键词（最多 1000 字符）');
    return { regex, command: `/add ${regex}`, matched: new RegExp(pattern, 'is').test(input.sample) };
}
