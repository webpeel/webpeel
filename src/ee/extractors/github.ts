import type { DomainExtractResult } from './types.js';
import { fetchJson, fetchJsonWithRetry } from './shared.js';

// ---------------------------------------------------------------------------
// 3. GitHub extractor
// ---------------------------------------------------------------------------

export async function githubExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/').filter(Boolean);
  const domain = 'github.com';

  if (pathParts.length === 0) return null;

  const ghHeaders: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
  // Use GITHUB_TOKEN if available for higher rate limits (5000/hr vs 60/hr)
  const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (ghToken) ghHeaders.Authorization = `token ${ghToken}`;

  // User profile: /username (single segment)
  if (pathParts.length === 1) {
    const username = pathParts[0];
    const userData = await fetchJson(`https://api.github.com/users/${username}`, ghHeaders);
    if (!userData || userData.message === 'Not Found') return null;

    const structured: Record<string, any> = {
      login: userData.login,
      name: userData.name || userData.login,
      bio: userData.bio || '',
      company: userData.company || null,
      location: userData.location || null,
      blog: userData.blog || null,
      followers: userData.followers ?? 0,
      following: userData.following ?? 0,
      publicRepos: userData.public_repos ?? 0,
      created: userData.created_at,
      avatarUrl: userData.avatar_url,
    };

    const cleanContent = `## 👤 GitHub: ${structured.name} (@${structured.login})

${structured.bio ? structured.bio + '\n\n' : ''}📍 ${structured.location || 'N/A'}  |  💼 ${structured.company || 'N/A'}  |  🌐 ${structured.blog || 'N/A'}
👥 ${structured.followers} followers  |  Following: ${structured.following}  |  📦 ${structured.publicRepos} public repos`;

    return { domain, type: 'user', structured, cleanContent };
  }

  const owner = pathParts[0];
  const repo = pathParts[1];

  // Issue: /owner/repo/issues/123
  if (pathParts[2] === 'issues' && pathParts[3]) {
    const issueNumber = pathParts[3];
    const [issueData, commentsData] = await Promise.all([
      fetchJson(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, ghHeaders),
      fetchJson(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=20`, ghHeaders),
    ]);
    if (!issueData || issueData.message === 'Not Found') return null;

    const comments = Array.isArray(commentsData)
      ? commentsData.map((c: any) => ({
          author: c.user?.login || 'ghost',
          text: c.body || '',
          created: c.created_at,
        }))
      : [];

    const structured: Record<string, any> = {
      repo: `${owner}/${repo}`,
      number: issueData.number,
      title: issueData.title || '',
      author: issueData.user?.login || 'ghost',
      state: issueData.state,
      body: issueData.body || '',
      labels: (issueData.labels || []).map((l: any) => l.name),
      created: issueData.created_at,
      updated: issueData.updated_at,
      commentCount: issueData.comments ?? 0,
      comments,
    };

    const labelStr = structured.labels.length ? structured.labels.join(', ') : 'none';
    const commentsMd = comments.slice(0, 10).map((c: any) =>
      `**@${c.author}** (${c.created}):\n${c.text.slice(0, 300)}`
    ).join('\n\n---\n\n');

    const cleanContent = `## 🐛 Issue #${structured.number}: ${structured.title}

**Repo:** ${structured.repo}  |  **State:** ${structured.state}  |  **Author:** @${structured.author}
**Labels:** ${labelStr}  |  **Created:** ${structured.created}

${structured.body.slice(0, 800)}

---

### Comments (${structured.commentCount})

${commentsMd || '*No comments.*'}`;

    return { domain, type: 'issue', structured, cleanContent };
  }

  // Pull request: /owner/repo/pull/123
  if (pathParts[2] === 'pull' && pathParts[3]) {
    const prNumber = pathParts[3];
    const [prData, commentsData] = await Promise.all([
      fetchJson(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, ghHeaders),
      fetchJson(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=20`, ghHeaders),
    ]);
    if (!prData || prData.message === 'Not Found') return null;

    const comments = Array.isArray(commentsData)
      ? commentsData.map((c: any) => ({
          author: c.user?.login || 'ghost',
          text: c.body || '',
          created: c.created_at,
        }))
      : [];

    const structured: Record<string, any> = {
      repo: `${owner}/${repo}`,
      number: prData.number,
      title: prData.title || '',
      author: prData.user?.login || 'ghost',
      state: prData.state,
      merged: prData.merged ?? false,
      body: prData.body || '',
      labels: (prData.labels || []).map((l: any) => l.name),
      created: prData.created_at,
      updated: prData.updated_at,
      commentCount: prData.comments ?? 0,
      additions: prData.additions ?? 0,
      deletions: prData.deletions ?? 0,
      changedFiles: prData.changed_files ?? 0,
      headBranch: prData.head?.label || '',
      baseBranch: prData.base?.label || '',
      comments,
    };

    const labelStr = structured.labels.length ? structured.labels.join(', ') : 'none';
    const commentsMd = comments.slice(0, 8).map((c: any) =>
      `**@${c.author}** (${c.created}):\n${c.text.slice(0, 300)}`
    ).join('\n\n---\n\n');

    const cleanContent = `## 🔀 PR #${structured.number}: ${structured.title}

**Repo:** ${structured.repo}  |  **State:** ${structured.state}${structured.merged ? ' (merged)' : ''}  |  **Author:** @${structured.author}
**Labels:** ${labelStr}  |  **${structured.headBranch} → ${structured.baseBranch}**
**Changes:** +${structured.additions} / -${structured.deletions} across ${structured.changedFiles} files

${structured.body.slice(0, 800)}

---

### Comments (${structured.commentCount})

${commentsMd || '*No comments.*'}`;

    return { domain, type: 'pull_request', structured, cleanContent };
  }

  // Repository page: /owner/repo (and no deeper path we handle above)
  if (pathParts.length >= 2) {
    // Sequential fetches to avoid secondary rate limits on popular repos
    const repoData = await fetchJsonWithRetry(`https://api.github.com/repos/${owner}/${repo}`, ghHeaders, 2, 1000);
    if (!repoData) {
      console.warn(`[webpeel:github] repo API returned null for ${owner}/${repo}`);
      return null;
    }
    if (repoData.message) {
      console.warn(`[webpeel:github] repo API error for ${owner}/${repo}: ${repoData.message}`);
      if (repoData.message === 'Not Found') return null;
      if (repoData.message.includes('secondary rate limit') || repoData.message.includes('abuse')) return null;
    }
    const structured: Record<string, any> = {
      title: `${owner}/${repo}`,
      name: `${owner}/${repo}`,
      description: repoData.description || '',
      stars: repoData.stargazers_count ?? 0,
      forks: repoData.forks_count ?? 0,
      watchers: repoData.watchers_count ?? 0,
      language: repoData.language || null,
      topics: repoData.topics || [],
      license: repoData.license?.spdx_id || null,
      openIssues: repoData.open_issues_count ?? 0,
      lastPush: repoData.pushed_at,
      createdAt: repoData.created_at,
      defaultBranch: repoData.default_branch || 'main',
      homepage: repoData.homepage || null,
      archived: repoData.archived || false,
      fork: repoData.fork || false,
      url: repoData.html_url || `https://github.com/${owner}/${repo}`,
    };

    const topicsStr = structured.topics.length ? structured.topics.slice(0, 8).join(', ') : '';
    const updatedDate = structured.lastPush ? structured.lastPush.slice(0, 10) : 'N/A';
    const lines: string[] = [
      `# 💻 ${structured.name}`,
      '',
      structured.description ? `**${structured.description}**` : '*No description.*',
      '',
      `- ⭐ Stars: ${structured.stars.toLocaleString()} | 🍴 Forks: ${structured.forks.toLocaleString()} | 📝 Language: ${structured.language || 'N/A'}`,
      `- 📦 License: ${structured.license || 'None'} | 🔄 Updated: ${updatedDate}`,
      `- 📊 Open Issues: ${structured.openIssues}${structured.archived ? ' | ⚠️ ARCHIVED' : ''}`,
    ];
    if (topicsStr) lines.push(`- 🏷️ Topics: ${topicsStr}`);
    lines.push('');
    const links: string[] = [`[Repository](${structured.url})`];
    if (structured.homepage) links.push(`[Homepage](${structured.homepage})`);
    lines.push(`**Links:** ${links.join(' · ')}`);

    const cleanContent = lines.join('\n');
    return { domain, type: 'repository', structured, cleanContent };
  }

  return null;
}

