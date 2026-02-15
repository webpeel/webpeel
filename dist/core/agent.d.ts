/**
 * Autonomous web research agent
 * Searches the web, fetches pages, and extracts structured data based on natural language prompts
 *
 * Supports:
 * - depth: "basic" (1 search, top 3) vs "thorough" (multi-step, up to 3 searches, top 10)
 * - maxSources: control how many sources to include (default 5, max 20)
 * - topic: "general" | "news" | "technical" | "academic" — adjusts queries & prioritization
 * - outputSchema: JSON Schema for structured output with validation
 * - streaming callbacks for SSE support
 */
export type AgentDepth = 'basic' | 'thorough';
export type AgentTopic = 'general' | 'news' | 'technical' | 'academic';
export interface AgentOptions {
    /** Natural language description of what data to extract */
    prompt: string;
    /** Optional URLs to start from */
    urls?: string[];
    /** JSON schema for structured output (legacy — prefer outputSchema) */
    schema?: Record<string, any>;
    /** JSON Schema for structured output with validation */
    outputSchema?: Record<string, any>;
    /** LLM API key (BYOK - bring your own key) */
    llmApiKey: string;
    /** LLM API base URL (default: OpenAI) */
    llmApiBase?: string;
    /** LLM model (default: gpt-4o-mini) */
    llmModel?: string;
    /** Max pages to visit (default: 10) — legacy param */
    maxPages?: number;
    /** Max sources to include (default 5, max 20) */
    maxSources?: number;
    /** Research depth: "basic" or "thorough" */
    depth?: AgentDepth;
    /** Topic filter */
    topic?: AgentTopic;
    /** Max credits/cost to spend */
    maxCredits?: number;
    /** Progress callback (legacy — still supported) */
    onProgress?: (progress: AgentProgress) => void;
    /** Streaming event callback for SSE */
    onEvent?: (event: AgentStreamEvent) => void;
}
export interface AgentProgress {
    status: 'searching' | 'visiting' | 'extracting' | 'done';
    currentUrl?: string;
    pagesVisited: number;
    message: string;
}
export interface AgentResult {
    success: boolean;
    data: any;
    /** The synthesised answer (text). Only present when no outputSchema. */
    answer?: string;
    sources: string[];
    sourcesDetailed?: Array<{
        url: string;
        title: string;
    }>;
    pagesVisited: number;
    creditsUsed: number;
    tokensUsed?: {
        input: number;
        output: number;
    };
}
/** Events emitted during streaming */
export type AgentStreamEvent = {
    type: 'step';
    action: 'searching';
    query: string;
} | {
    type: 'step';
    action: 'fetching';
    url: string;
} | {
    type: 'step';
    action: 'analyzing';
    summary: string;
} | {
    type: 'chunk';
    text: string;
} | {
    type: 'done';
    answer: string;
    sources: Array<{
        url: string;
        title: string;
    }>;
    tokensUsed: {
        input: number;
        output: number;
    };
};
/**
 * Run autonomous web research agent
 */
export declare function runAgent(options: AgentOptions): Promise<AgentResult>;
//# sourceMappingURL=agent.d.ts.map