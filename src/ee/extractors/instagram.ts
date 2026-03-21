import { simpleFetch } from '../../core/fetcher.js';
import type { DomainExtractResult } from './types.js';
import { tryParseJson, fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 29. Instagram extractor (oEmbed)
// ---------------------------------------------------------------------------

export async function instagramExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const pathParts = new URL(url).pathname.split('/').filter(Boolean);
  const contentType = pathParts[0] === 'p' ? 'post' : pathParts[0] === 'reel' ? 'reel' : pathParts[0] === 'tv' ? 'igtv' : pathParts.length === 1 ? 'profile' : 'post';

  // --- Profile extraction via Instagram internal API (no auth needed) ---
  if (contentType === 'profile' && pathParts.length === 1) {
    const username = pathParts[0];
    try {
      const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
      const igHeaders = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-IG-App-ID': '936619743392459',
        'Accept': '*/*',
        'Referer': 'https://www.instagram.com/',
      };
      const apiResult = await simpleFetch(apiUrl, igHeaders['User-Agent'], 12000, igHeaders);
      const data = tryParseJson(apiResult?.html || '');
      const user = data?.data?.user;
      if (user && user.username) {
        const followers: number = user.edge_followed_by?.count ?? 0;
        const following: number = user.edge_follow?.count ?? 0;
        const postCount: number = user.edge_owner_to_timeline_media?.count ?? 0;
        const fmtNum = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);

        const structured: Record<string, any> = {
          username: user.username,
          fullName: user.full_name || '',
          bio: user.biography || '',
          followers,
          following,
          posts: postCount,
          verified: user.is_verified || false,
          isPrivate: user.is_private || false,
          profilePic: user.profile_pic_url_hd || user.profile_pic_url || '',
          externalUrl: user.external_url || (user.bio_links?.[0]?.url) || '',
          contentType: 'profile',
        };

        // Recent posts
        const edges: any[] = user.edge_owner_to_timeline_media?.edges || [];
        const postSections: string[] = [];
        for (const edge of edges.slice(0, 6)) {
          const node = edge?.node;
          if (!node) continue;
          const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || '';
          const likes: number = node.edge_liked_by?.count ?? node.edge_media_preview_like?.count ?? 0;
          const comments: number = node.edge_media_to_comment?.count ?? 0;
          const isVideo = node.is_video;
          const mediaType = isVideo ? '🎬' : '📸';
          const timestamp = node.taken_at_timestamp ? new Date(node.taken_at_timestamp * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
          const imgUrl = node.thumbnail_src || node.display_url || '';
          const captionSnippet = caption ? caption.slice(0, 150) + (caption.length > 150 ? '…' : '') : '';
          postSections.push(`### ${mediaType} ${timestamp}\n${captionSnippet}\n❤️ ${fmtNum(likes)} | 💬 ${fmtNum(comments)}${imgUrl ? `\n🖼 ${imgUrl}` : ''}`);
        }

        const verifiedBadge = structured.verified ? ' ✓' : '';
        const privateBadge = structured.isPrivate ? ' 🔒' : '';
        const bioLine = structured.bio ? `\n\n${structured.bio}` : '';
        const externalLine = structured.externalUrl ? `\n🌐 ${structured.externalUrl}` : '';
        const postsSection = postSections.length > 0 ? '\n\n## Recent Posts\n\n' + postSections.join('\n\n---\n\n') : '';

        const cleanContent = `# @${structured.username} on Instagram${verifiedBadge}${privateBadge}\n\n**${structured.fullName || structured.username}**${bioLine}${externalLine}\n\n👥 ${fmtNum(followers)} Followers | ${fmtNum(following)} Following | ${fmtNum(postCount)} Posts${postsSection}`;

        return { domain: 'instagram.com', type: 'profile', structured, cleanContent };
      }
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'Instagram profile API failed:', e instanceof Error ? e.message : e);
    }
  }

  // --- Post/Reel/IGTV: Try oEmbed API ---
  try {
    const oembedUrl = `https://graph.facebook.com/v22.0/instagram_oembed?url=${encodeURIComponent(url)}&fields=title,author_name,provider_name,thumbnail_url`;
    const data = await fetchJson(oembedUrl);

    // Also try noembed.com as fallback
    let resolvedData = data;
    if (!data || data.error) {
      const noembedUrl = `https://noembed.com/embed?url=${encodeURIComponent(url)}`;
      resolvedData = await fetchJson(noembedUrl);
    }
    if (!resolvedData || resolvedData.error) return null;

    const structured: Record<string, any> = {
      title: resolvedData.title || '',
      author: resolvedData.author_name || '',
      authorUrl: resolvedData.author_url || '',
      thumbnailUrl: resolvedData.thumbnail_url || '',
      contentType,
      provider: 'Instagram',
    };

    const typeEmoji = contentType === 'reel' ? '🎬' : contentType === 'post' ? '📸' : '📱';
    const titleText = structured.title || `Instagram ${contentType} by ${structured.author}`;
    const cleanContent = `## ${typeEmoji} Instagram ${contentType}: ${titleText}\n\n**Creator:** @${structured.author.replace('@', '')}\n**URL:** ${url}`;

    return { domain: 'instagram.com', type: contentType, structured, cleanContent };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Instagram oEmbed failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

