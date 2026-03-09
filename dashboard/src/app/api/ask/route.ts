import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

const WEBPEEL_API = process.env.NEXT_PUBLIC_API_URL || 'https://api.webpeel.dev';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { url, question } = await req.json();
    if (!url || !question) {
      return NextResponse.json({ error: 'url and question required' }, { status: 400 });
    }

    const apiToken = (session as any)?.apiToken;

    // Step 1: Fetch the page content via WebPeel API
    const fetchUrl = new URL(`${WEBPEEL_API}/v1/fetch`);
    fetchUrl.searchParams.set('url', url);
    fetchUrl.searchParams.set('format', 'markdown');

    const fetchRes = await fetch(fetchUrl.toString(), {
      headers: apiToken ? { 'Authorization': `Bearer ${apiToken}` } : {},
    });

    if (!fetchRes.ok) {
      const err = await fetchRes.json().catch(() => ({}));
      return NextResponse.json({
        error: err.error?.message || 'Failed to fetch page',
        title: null,
        answer: null,
      }, { status: fetchRes.status });
    }

    const pageData = await fetchRes.json();
    const content = pageData.content || pageData.markdown || pageData.text || '';
    const title = pageData.title;
    const tokens = pageData.tokens;
    const fetchTimeMs = pageData.fetchTimeMs;

    // Step 2: If we have an OpenAI key, use AI to answer
    if (OPENAI_API_KEY && content) {
      // Truncate to ~12K chars (~3K tokens) to keep costs minimal
      const maxChars = 12000;
      const truncated = content.length > maxChars
        ? content.slice(0, maxChars) + '\n\n[Content truncated for analysis]'
        : content;

      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant that answers questions based on the provided web page content. Answer concisely and accurately. If the content doesn\'t contain enough information to answer, say so honestly. Use markdown formatting for readability.',
            },
            {
              role: 'user',
              content: `Based on this web page content, please answer the following question:\n\n**Question:** ${question}\n\n**Page content:**\n${truncated}`,
            },
          ],
          temperature: 0.3,
          max_tokens: 500,
        }),
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        const aiAnswer = aiData.choices?.[0]?.message?.content || null;

        if (aiAnswer) {
          return NextResponse.json({
            answer: aiAnswer,
            title,
            tokens,
            fetchTimeMs,
            method: 'ai',
            question,
            model: 'gpt-4o-mini',
          });
        }
      }
      // If AI fails, fall through to BM25
    }

    // Step 3: Fallback — BM25 via /v1/fetch?question=
    const bm25Url = new URL(`${WEBPEEL_API}/v1/fetch`);
    bm25Url.searchParams.set('url', url);
    bm25Url.searchParams.set('format', 'markdown');
    bm25Url.searchParams.set('question', question);

    const bm25Res = await fetch(bm25Url.toString(), {
      headers: apiToken ? { 'Authorization': `Bearer ${apiToken}` } : {},
    });

    const bm25Data = await bm25Res.json();

    return NextResponse.json({
      answer: bm25Data.answer || `Here's what we found on the page:\n\n${(content || '').slice(0, 2000)}`,
      title: bm25Data.title || title,
      tokens: bm25Data.tokens || tokens,
      fetchTimeMs: bm25Data.fetchTimeMs || fetchTimeMs,
      method: 'bm25',
      question,
      content: content, // Include page content for display below answer
    });

  } catch (err: any) {
    return NextResponse.json({
      error: err.message || 'Internal error',
    }, { status: 500 });
  }
}
