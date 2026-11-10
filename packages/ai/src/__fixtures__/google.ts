// Hand-authored, API-shaped generateContent responses (not recorded live). Re-check against real traffic before go-live.
const usageMetadata = { promptTokenCount: 120, candidatesTokenCount: 40, totalTokenCount: 160 };
const candidate = (parts: unknown[], finishReason: string | null = 'STOP') => ({ content: { role: 'model', parts }, ...(finishReason === null ? {} : { finishReason }) });

export const googleText = { candidates: [candidate([{ text: 'xin chao' }])], usageMetadata } as const;
export const googleJsonText = { candidates: [candidate([{ text: '{"summary":"ok"}' }])], usageMetadata } as const;
export const googleToolCalls = {
  candidates: [candidate([{ functionCall: { name: 'get_price', args: { symbol: 'FPT' } } }, { functionCall: { name: 'get_price', args: { symbol: 'VNM' } } }])],
  usageMetadata,
} as const;
export const googleFinalOutput = { candidates: [candidate([{ functionCall: { name: 'final_output', args: { summary: 'ok' } } }])], usageMetadata } as const;
export const googleWith = (parts: unknown[], finishReason: string | null = 'STOP', meta: unknown = usageMetadata) => ({ candidates: [candidate(parts, finishReason)], usageMetadata: meta });
