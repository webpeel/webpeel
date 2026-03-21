import type { DomainExtractResult } from './types.js';
import { stripHtml, fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 8. Stack Overflow extractor (StackExchange API)
// ---------------------------------------------------------------------------

export async function stackOverflowExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;

  // Match /questions/12345/optional-slug
  const questionMatch = path.match(/\/questions\/(\d+)/);
  if (!questionMatch) return null;

  const questionId = questionMatch[1];

  try {
    const apiUrl = `https://api.stackexchange.com/2.3/questions/${questionId}?order=desc&sort=votes&site=stackoverflow&filter=withbody`;
    const data = await fetchJson(apiUrl);

    if (!data?.items?.[0]) return null;
    const q = data.items[0];

    // Also fetch answers
    let answers: any[] = [];
    try {
      const answersUrl = `https://api.stackexchange.com/2.3/questions/${questionId}/answers?order=desc&sort=votes&site=stackoverflow&filter=withbody&pagesize=5`;
      const answersData = await fetchJson(answersUrl);
      answers = answersData?.items || [];
    } catch { /* answers optional */ }

    const structured: Record<string, any> = {
      title: stripHtml(q.title || ''),
      questionId: q.question_id,
      score: q.score || 0,
      views: q.view_count || 0,
      answerCount: q.answer_count || 0,
      isAnswered: q.is_answered || false,
      tags: q.tags || [],
      askedBy: q.owner?.display_name || 'anonymous',
      askedDate: q.creation_date ? new Date(q.creation_date * 1000).toISOString() : undefined,
      acceptedAnswerId: q.accepted_answer_id || null,
      answers: answers.map(a => ({
        id: a.answer_id,
        score: a.score,
        isAccepted: a.is_accepted || false,
        body: stripHtml(a.body || '').substring(0, 2000),
        author: a.owner?.display_name || 'anonymous',
      })),
    };

    const questionBody = stripHtml(q.body || '').substring(0, 3000);
    const tagLine = structured.tags.length ? `**Tags:** ${structured.tags.join(', ')}` : '';

    let answersContent = '';
    for (const a of structured.answers.slice(0, 3)) {
      const acceptedMark = a.isAccepted ? ' ✅ Accepted' : '';
      answersContent += `\n\n---\n\n### Answer by ${a.author} (Score: ${a.score}${acceptedMark})\n\n${a.body}`;
    }

    const cleanContent = `# ${structured.title}\n\n**Score:** ${structured.score} | **Views:** ${structured.views?.toLocaleString()} | **Answers:** ${structured.answerCount}\n${tagLine}\n**Asked by:** ${structured.askedBy}\n\n## Question\n\n${questionBody}${answersContent}`;

    return { domain: 'stackoverflow.com', type: 'question', structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'StackOverflow API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

