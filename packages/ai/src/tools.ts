import { z } from 'zod';
import { FINAL_OUTPUT_TOOL } from './adapters/shared';
import type { ReadTool, ToolDef } from './types';

const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** Programmer-error checks: only read tools, unique valid names, bounded results. */
export function assertReadTools(tools: readonly ReadTool[]): void {
  const seen = new Set<string>();
  for (const t of tools) {
    if (t.kind !== 'read') throw new TypeError(`tool ${String(t.name)} is not a read tool`);
    if (!TOOL_NAME.test(t.name)) throw new TypeError(`invalid tool name ${t.name}`);
    if (t.name === FINAL_OUTPUT_TOOL) throw new TypeError(`reserved tool name ${FINAL_OUTPUT_TOOL}`);
    if (seen.has(t.name)) throw new TypeError(`duplicate tool ${t.name}`);
    seen.add(t.name);
    if (!Number.isSafeInteger(t.maxResultBytes) || t.maxResultBytes <= 0) throw new TypeError(`tool ${t.name} needs a positive integer maxResultBytes`);
  }
}

export function toolDefs(tools: readonly ReadTool[]): ToolDef[] {
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.input) }));
}

export type ToolCheck =
  | { ok: true; tool: ReadTool; input: unknown }
  | { ok: false; code: 'tool_not_allowed' | 'invalid_tool_input' };

export function checkToolCall(call: { name: string; input: unknown }, tools: readonly ReadTool[]): ToolCheck {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { ok: false, code: 'tool_not_allowed' };
  const parsed = tool.input.safeParse(call.input);
  return parsed.success ? { ok: true, tool, input: parsed.data } : { ok: false, code: 'invalid_tool_input' };
}
