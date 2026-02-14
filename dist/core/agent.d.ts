/**
 * Autonomous web research agent
 * Searches the web, fetches pages, and extracts structured data based on natural language prompts
 */
export interface AgentOptions {
    /** Natural language description of what data to extract */
    prompt: string;
    /** Optional URLs to start from */
    urls?: string[];
    /** JSON schema for structured output */
    schema?: Record<string, any>;
    /** LLM API key (BYOK - bring your own key) */
    llmApiKey: string;
    /** LLM API base URL (default: OpenAI) */
    llmApiBase?: string;
    /** LLM model (default: gpt-4o-mini) */
    llmModel?: string;
    /** Max pages to visit (default: 10) */
    maxPages?: number;
    /** Max credits/cost to spend */
    maxCredits?: number;
    /** Progress callback */
    onProgress?: (progress: AgentProgress) => void;
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
    sources: string[];
    pagesVisited: number;
    creditsUsed: number;
}
/**
 * Run autonomous web research agent
 */
export declare function runAgent(options: AgentOptions): Promise<AgentResult>;
//# sourceMappingURL=agent.d.ts.map