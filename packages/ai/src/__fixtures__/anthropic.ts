// Hand-authored, API-shaped Messages responses (not recorded live). Re-check against real traffic before go-live.
const usage = { input_tokens: 120, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

export const anthropicText = { id: 'msg_1', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text: 'xin chao' }], stop_reason: 'end_turn', usage } as const;

export const anthropicToolUse = {
  ...anthropicText,
  content: [
    { type: 'text', text: 'checking' },
    { type: 'tool_use', id: 'toolu_1', name: 'get_price', input: { symbol: 'FPT' } },
    { type: 'tool_use', id: 'toolu_2', name: 'get_price', input: { symbol: 'VNM' } },
    { type: 'tool_use', id: 'toolu_3', name: 'get_price', input: { symbol: 'HPG' } },
  ],
  stop_reason: 'tool_use',
} as const;

export const anthropicFinalOutput = {
  ...anthropicText,
  content: [{ type: 'tool_use', id: 'toolu_f', name: 'final_output', input: { summary: 'ok' } }],
  stop_reason: 'tool_use',
} as const;

export const anthropicOneToolUse = { ...anthropicToolUse, content: [anthropicToolUse.content[1]] } as const;
