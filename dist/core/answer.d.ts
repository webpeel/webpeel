/**
 * /answer core implementation
 *
 * Flow:
 * - search the web
 * - fetch top sources via WebPeel
 * - call an LLM (BYOK) to generate a cited answer
 */
import { type SearchProviderId } from './search-provider.js';
export type LLMProviderId = 'openai' | 'anthropic' | 'google';
export interface TokensUsed {
    input: number;
    output: number;
}
export interface AnswerCitation {
    title: string;
    url: string;
    snippet: string;
}
export interface AnswerRequest {
    question: string;
    searchProvider?: SearchProviderId;
    searchApiKey?: string;
    llmProvider: LLMProviderId;
    llmApiKey: string;
    llmModel?: string;
    maxSources?: number;
    stream?: boolean;
    /** Called with incremental text when stream=true */
    onChunk?: (text: string) => void;
    /** Optional AbortSignal */
    signal?: AbortSignal;
}
export interface AnswerResponse {
    answer: string;
    citations: AnswerCitation[];
    searchProvider: SearchProviderId;
    llmProvider: LLMProviderId;
    llmModel: string;
    tokensUsed: TokensUsed;
}
export declare function answerQuestion(req: AnswerRequest): Promise<AnswerResponse>;
//# sourceMappingURL=answer.d.ts.map