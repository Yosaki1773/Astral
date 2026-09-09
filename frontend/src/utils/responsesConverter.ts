/**
 * 将 Responses API 格式的请求和响应数据转换为前端可视化对话所需的标准格式
 */

export interface NormalizedMessage {
    role: string;
    content: string | null;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
    tool_call_id?: string;
    reasoning_content?: string;
}

export interface ConversionResult {
    system?: string;
    messages: NormalizedMessage[];
}

/**
 * 转换 Responses 格式的请求数据为标准消息列表
 */
export function convertResponsesRequest(req: any): ConversionResult {
    const messages: NormalizedMessage[] = [];
    let system: string | undefined = undefined;

    if (!req) return { messages };

    // 1. instructions -> system message
    if (req.instructions) {
        system = req.instructions;
    }

    // 2. input
    if (req.input !== undefined) {
        if (typeof req.input === 'string') {
            messages.push({ role: 'user', content: req.input });
        } else if (Array.isArray(req.input)) {
            for (const item of req.input) {
                if (item.type === 'message') {
                    let contentStr = '';
                    if (typeof item.content === 'string') {
                        contentStr = item.content;
                    } else if (Array.isArray(item.content)) {
                        contentStr = item.content
                            .filter((p: any) => p.type === 'input_text' || p.type === 'output_text')
                            .map((p: any) => p.text || '')
                            .join('\n');
                    }
                    messages.push({ role: item.role || 'user', content: contentStr });
                } else if (item.type === 'function_call') {
                    messages.push({
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: item.call_id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                            type: 'function',
                            function: {
                                name: item.name || '',
                                arguments: item.arguments || '',
                            },
                        }],
                    });
                } else if (item.type === 'function_call_output') {
                    messages.push({
                        role: 'tool',
                        tool_call_id: item.call_id,
                        content: item.output || '',
                    });
                } else if (item.type === 'reasoning' && item.summary) {
                    const reasoningText = item.summary.map((s: any) => s.text || '').join('\n');
                    messages.push({
                        role: 'assistant',
                        content: null,
                        reasoning_content: reasoningText,
                    });
                }
            }
        }
    }

    return system ? { system, messages } : { messages };
}

/**
 * 转换 Responses 格式的响应数据为标准消息列表
 */
export function convertResponsesResponse(res: any): NormalizedMessage[] {
    const messages: NormalizedMessage[] = [];

    if (!res) return messages;

    if (res.output && Array.isArray(res.output)) {
        for (const item of res.output) {
            if (item.type === 'message') {
                let contentStr = '';
                if (typeof item.content === 'string') {
                    contentStr = item.content;
                } else if (Array.isArray(item.content)) {
                    contentStr = item.content
                        .filter((p: any) => p.type === 'output_text' || p.text !== undefined)
                        .map((p: any) => p.text || '')
                        .join('\n');
                }
                messages.push({ role: item.role || 'assistant', content: contentStr });
            } else if (item.type === 'function_call') {
                messages.push({
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                        id: item.call_id || item.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        type: 'function',
                        function: {
                            name: item.name || '',
                            arguments: item.arguments || '',
                        },
                    }],
                });
            } else if (item.type === 'reasoning' && item.summary) {
                const reasoningText = item.summary.map((s: any) => s.text || '').join('\n');
                messages.push({
                    role: 'assistant',
                    content: null,
                    reasoning_content: reasoningText,
                });
            }
        }
    }

    return messages;
}
