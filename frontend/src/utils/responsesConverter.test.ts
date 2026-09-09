import { describe, expect, it } from 'vitest';
import { convertResponsesRequest, convertResponsesResponse } from './responsesConverter';

describe('responsesConverter', () => {
    describe('convertResponsesRequest', () => {
        it('handles null or undefined request', () => {
            const res = convertResponsesRequest(null);
            expect(res.messages).toEqual([]);
            expect(res.system).toBeUndefined();
        });

        it('handles string input and instructions', () => {
            const req = {
                instructions: 'Be helpful',
                input: 'Hello, world!'
            };
            const res = convertResponsesRequest(req);
            expect(res.system).toBe('Be helpful');
            expect(res.messages).toEqual([
                { role: 'user', content: 'Hello, world!' }
            ]);
        });

        it('handles structured array input', () => {
            const req = {
                instructions: 'Developer rules',
                input: [
                    {
                        type: 'message',
                        role: 'user',
                        content: [
                            { type: 'input_text', text: 'Analyze this image: ' },
                            { type: 'input_image', image_url: 'http://example.com/img.png' }
                        ]
                    },
                    {
                        type: 'function_call',
                        call_id: 'call_1',
                        name: 'get_weather',
                        arguments: '{"location": "Beijing"}'
                    },
                    {
                        type: 'function_call_output',
                        call_id: 'call_1',
                        output: 'Sunny'
                    },
                    {
                        type: 'reasoning',
                        summary: [
                            { type: 'summary_text', text: 'Thinking...' }
                        ]
                    }
                ]
            };

            const res = convertResponsesRequest(req);
            expect(res.system).toBe('Developer rules');
            expect(res.messages.length).toBe(4);

            // Text extraction from array content
            expect(res.messages[0]).toEqual({
                role: 'user',
                content: 'Analyze this image: '
            });

            // function_call transformation
            expect(res.messages[1]!.role).toBe('assistant');
            expect(res.messages[1]!.content).toBeNull();
            expect(res.messages[1]!.tool_calls).toEqual([
                {
                    id: 'call_1',
                    type: 'function',
                    function: {
                        name: 'get_weather',
                        arguments: '{"location": "Beijing"}'
                    }
                }
            ]);

            // function_call_output transformation
            expect(res.messages[2]).toEqual({
                role: 'tool',
                tool_call_id: 'call_1',
                content: 'Sunny'
            });

            // reasoning transformation
            expect(res.messages[3]).toEqual({
                role: 'assistant',
                content: null,
                reasoning_content: 'Thinking...'
            });
        });
    });

    describe('convertResponsesResponse', () => {
        it('handles null or undefined response', () => {
            expect(convertResponsesResponse(null)).toEqual([]);
        });

        it('handles output message reasoning and function calls', () => {
            const resData = {
                output: [
                    {
                        type: 'reasoning',
                        id: 'rs_1',
                        summary: [{ type: 'summary_text', text: 'Calculated 1 + 1.' }]
                    },
                    {
                        type: 'function_call',
                        id: 'fc_1',
                        call_id: 'tc_1',
                        name: 'calculate',
                        arguments: '{"expr": "1+1"}'
                    },
                    {
                        type: 'message',
                        id: 'msg_1',
                        role: 'assistant',
                        content: [
                            { type: 'output_text', text: 'The result is 2.' }
                        ]
                    }
                ]
            };

            const result = convertResponsesResponse(resData);
            expect(result.length).toBe(3);

            // Reasoning output
            expect(result[0]).toEqual({
                role: 'assistant',
                content: null,
                reasoning_content: 'Calculated 1 + 1.'
            });

            // Function call output
            expect(result[1]).toEqual({
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        id: 'tc_1',
                        type: 'function',
                        function: {
                            name: 'calculate',
                            arguments: '{"expr": "1+1"}'
                        }
                    }
                ]
            });

            // Message output
            expect(result[2]).toEqual({
                role: 'assistant',
                content: 'The result is 2.'
            });
        });
    });
});
