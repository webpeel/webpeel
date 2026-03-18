/**
 * Source credibility scoring — lightweight, zero dependencies, no network calls.
 *
 * Actively investigates domain signals from the URL itself:
 *   - TLD trust score
 *   - HTTPS enforcement
 *   - Domain structure analysis
 *   - Brand/platform recognition (500+ known domains)
 *   - Content platform detection
 *
 * Score breakdown (0–100):
 *   TLD weight    0–20
 *   HTTPS         0–10
 *   Known domain  0–40
 *   Structure     0–15
 *   Platform      0–15
 */

export interface SourceCredibility {
  tier: 'official' | 'established' | 'community' | 'new' | 'suspicious';
  score: number;     // 0–100 composite score
  label: string;     // Human-readable short sentence
  signals: string[]; // Positive signals found
  warnings: string[]; // Concerns found
}

// ---------------------------------------------------------------------------
// TLD trust map: points (0–20)
// ---------------------------------------------------------------------------
const TLD_TRUST: Record<string, number> = {
  '.gov': 20, '.edu': 20, '.mil': 20,
  '.org': 14, '.net': 12, '.com': 12, '.io': 11,
  '.co': 10, '.us': 10, '.uk': 10, '.ca': 10, '.au': 10,
  '.de': 10, '.fr': 10, '.jp': 10, '.br': 10, '.in': 10,
  '.eu': 11, '.int': 15,
  '.info': 8, '.biz': 7, '.me': 8, '.tv': 8, '.app': 10,
  '.dev': 10, '.ai': 10, '.tech': 8, '.page': 8,
  '.blog': 7, '.news': 8, '.media': 8, '.press': 8,
  '.shop': 7, '.store': 7, '.online': 7, '.site': 6,
  '.website': 6, '.space': 5, '.club': 5, '.pro': 7,
  // Low-trust freebies
  '.tk': 1, '.ml': 1, '.ga': 1, '.cf': 1, '.gq': 1,
  '.xyz': 4, '.top': 3, '.loan': 2, '.click': 3, '.link': 4,
  '.win': 2, '.bid': 2, '.download': 2, '.racing': 2, '.review': 4,
  '.cc': 3, '.pw': 3, '.men': 2, '.party': 2, '.stream': 3,
};

// ---------------------------------------------------------------------------
// Suspicious TLDs (high-risk freebies used in phishing)
// ---------------------------------------------------------------------------
const SUSPICIOUS_TLDS = new Set(['.tk', '.ml', '.ga', '.cf', '.gq', '.win', '.bid', '.men', '.party', '.loan']);

// ---------------------------------------------------------------------------
// Official TLDs
// ---------------------------------------------------------------------------
const OFFICIAL_TLDS = new Set(['.gov', '.edu', '.mil', '.int']);

// ---------------------------------------------------------------------------
// Official hostnames (beyond .gov/.edu/.mil TLD)
// ---------------------------------------------------------------------------
const OFFICIAL_DOMAINS = new Set([
  // International organisations
  'who.int', 'un.org', 'worldbank.org', 'imf.org', 'oecd.org', 'europa.eu',
  'nato.int', 'wto.org', 'unicef.org', 'unhcr.org', 'icrc.org',
  // Academic / research
  'arxiv.org', 'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'jstor.org',
  'nature.com', 'science.org', 'cell.com', 'nejm.org', 'bmj.com',
  'thelancet.com', 'plos.org', 'springer.com', 'elsevier.com',
  'scholar.google.com', 'researchgate.net', 'semanticscholar.org',
  'acm.org', 'ieee.org',
  // Official tech documentation
  'docs.python.org', 'developer.mozilla.org', 'nodejs.org', 'rust-lang.org',
  'docs.microsoft.com', 'learn.microsoft.com', 'developer.apple.com',
  'developer.android.com', 'php.net', 'ruby-lang.org', 'golang.org', 'go.dev',
  // Health
  'mayoclinic.org', 'clevelandclinic.org', 'webmd.com',
  // Standards / specs
  'w3.org', 'ietf.org', 'rfc-editor.org', 'iso.org', 'ecma-international.org',
]);

// ---------------------------------------------------------------------------
// Established domains (score bonus 40 pts) — 500+ entries
// ---------------------------------------------------------------------------
const ESTABLISHED_DOMAINS = new Set([
  // ── Major Tech ──────────────────────────────────────────────────────────
  'google.com', 'apple.com', 'microsoft.com', 'amazon.com', 'meta.com',
  'netflix.com', 'spotify.com', 'adobe.com', 'salesforce.com', 'oracle.com',
  'ibm.com', 'intel.com', 'nvidia.com', 'amd.com', 'qualcomm.com',
  'cisco.com', 'vmware.com', 'sap.com', 'servicenow.com', 'workday.com',
  'zoom.us', 'slack.com', 'dropbox.com', 'box.com', 'atlassian.com',
  'jira.atlassian.com', 'confluence.atlassian.com',
  'twilio.com', 'sendgrid.com', 'mailchimp.com', 'hubspot.com',
  'zendesk.com', 'intercom.com', 'freshworks.com', 'docusign.com',
  'okta.com', 'auth0.com', 'cloudflare.com', 'fastly.com', 'akamai.com',
  'digitalocean.com', 'linode.com', 'vultr.com',
  'datadog.com', 'newrelic.com', 'splunk.com', 'elastic.co',
  'mongodb.com', 'redis.io', 'postgresql.org', 'mysql.com',
  'docker.com', 'kubernetes.io', 'helm.sh',
  'terraform.io', 'ansible.com', 'chef.io', 'puppet.com',
  'heroku.com', 'render.com', 'railway.app', 'fly.io',
  'supabase.com', 'planetscale.com', 'neon.tech', 'fauna.com',
  'firebase.google.com', 'expo.dev',
  'openai.com', 'anthropic.com', 'cohere.com', 'huggingface.co',
  'stability.ai', 'midjourney.com', 'replicate.com',
  'figma.com', 'sketch.com', 'invisionapp.com', 'zeplin.io',
  'notion.so', 'airtable.com', 'monday.com', 'asana.com', 'clickup.com',
  'trello.com', 'basecamp.com', 'linear.app', 'shortcut.com',
  'postman.com', 'insomnia.rest', 'swagger.io',
  'sentry.io', 'bugsnag.com', 'rollbar.com',
  'segment.com', 'mixpanel.com', 'amplitude.com', 'heap.io',
  'looker.com', 'tableau.com', 'powerbi.microsoft.com',
  'snowflake.com', 'databricks.com', 'dbt.com', 'fivetran.com', 'airbyte.com',
  'vercel.com', 'netlify.com',
  // ── Cloud / Hosting ──────────────────────────────────────────────────────
  'aws.amazon.com', 'cloud.google.com', 'azure.microsoft.com',
  'docs.aws.amazon.com', 'console.aws.amazon.com',
  // ── Developer Ecosystems ──────────────────────────────────────────────────
  'github.com', 'gitlab.com', 'bitbucket.org', 'sourcehut.com',
  'stackoverflow.com', 'superuser.com', 'serverfault.com',
  'npmjs.com', 'pypi.org', 'crates.io', 'packagist.org', 'rubygems.org',
  'nuget.org', 'pub.dev', 'hex.pm', 'opam.ocaml.org',
  'docs.rs', 'crates.io', 'pkg.go.dev',
  'codepen.io', 'jsfiddle.net', 'replit.com', 'glitch.com', 'codesandbox.io',
  'leetcode.com', 'hackerrank.com', 'codewars.com', 'exercism.org',
  'regex101.com', 'regexr.com',
  // ── Major Social ──────────────────────────────────────────────────────────
  'twitter.com', 'x.com', 'reddit.com', 'linkedin.com', 'instagram.com',
  'facebook.com', 'youtube.com', 'tiktok.com', 'snapchat.com', 'pinterest.com',
  'tumblr.com', 'mastodon.social', 'threads.net', 'discord.com', 'discord.gg',
  'twitch.tv', 'kick.com', 'vimeo.com', 'dailymotion.com',
  'quora.com', 'medium.com', 'substack.com', 'hashnode.com', 'dev.to',
  // ── Major News ────────────────────────────────────────────────────────────
  'nytimes.com', 'washingtonpost.com', 'theguardian.com', 'bbc.com', 'bbc.co.uk',
  'reuters.com', 'apnews.com', 'bloomberg.com', 'economist.com', 'ft.com',
  'wsj.com', 'cnn.com', 'foxnews.com', 'msnbc.com', 'nbcnews.com',
  'cbsnews.com', 'abcnews.go.com', 'npr.org', 'pbs.org',
  'time.com', 'usatoday.com', 'huffpost.com', 'vox.com', 'axios.com',
  'politico.com', 'thehill.com', 'rollcall.com', 'slate.com', 'salon.com',
  'theatlantic.com', 'newyorker.com', 'newrepublic.com',
  'motherjones.com', 'propublica.org', 'intercept.co',
  'aljazeera.com', 'dw.com', 'france24.com', 'rt.com',
  'spiegel.de', 'lemonde.fr', 'liberation.fr', 'lefigaro.fr',
  'elpais.com', 'elmundo.es', 'repubblica.it', 'corriere.it',
  'theglobeandmail.com', 'thestar.com', 'nationalpost.com',
  'smh.com.au', 'theage.com.au', 'abc.net.au',
  'timesofindia.com', 'hindustantimes.com', 'thehindu.com', 'ndtv.com',
  'scmp.com', 'channelnewsasia.com', 'straitstimes.com',
  'haaretz.com', 'timesofisrael.com', 'jpost.com',
  'techcrunch.com', 'wired.com', 'arstechnica.com', 'theverge.com',
  'engadget.com', 'gizmodo.com', 'cnet.com', 'pcmag.com', 'tomshardware.com',
  'anandtech.com', 'macrumors.com', '9to5mac.com', '9to5google.com',
  'androidcentral.com', 'windowscentral.com',
  'venturebeat.com', 'businessinsider.com', 'forbes.com', 'fortune.com',
  'inc.com', 'entrepreneur.com', 'fastcompany.com',
  // ── Finance ───────────────────────────────────────────────────────────────
  'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citibank.com',
  'capitalone.com', 'usbank.com', 'tdbank.com', 'pnc.com',
  'americanexpress.com', 'discover.com', 'synchrony.com',
  'paypal.com', 'stripe.com', 'square.com', 'braintree.com', 'adyen.com',
  'coinbase.com', 'binance.com', 'kraken.com', 'gemini.com', 'crypto.com',
  'robinhood.com', 'etrade.com', 'schwab.com', 'fidelity.com',
  'vanguard.com', 'blackrock.com', 'jpmorgan.com', 'goldmansachs.com',
  'morganstanley.com', 'ubs.com', 'credit-suisse.com', 'hsbc.com',
  'barclays.com', 'lloydsbank.com', 'natwest.com', 'santander.com',
  'transferwise.com', 'wise.com', 'revolut.com', 'monzo.com',
  'quickbooks.intuit.com', 'turbotax.intuit.com', 'mint.com', 'hrblock.com',
  'experian.com', 'equifax.com', 'transunion.com',
  // ── E-commerce / Retail ──────────────────────────────────────────────────
  'amazon.com', 'ebay.com', 'etsy.com', 'walmart.com', 'target.com',
  'bestbuy.com', 'costco.com', 'homedepot.com', 'lowes.com', 'wayfair.com',
  'shopify.com', 'bigcommerce.com', 'woocommerce.com', 'squarespace.com',
  'overstock.com', 'newegg.com', 'bhphotovideo.com', 'adorama.com',
  'aliexpress.com', 'alibaba.com', 'wish.com', 'dhgate.com',
  'zappos.com', 'nordstrom.com', 'macys.com', 'bloomingdales.com', 'gap.com',
  'nike.com', 'adidas.com', 'reebok.com', 'underarmour.com', 'lululemon.com',
  'ikea.com', 'crate.com', 'potterybarn.com', 'williams-sonoma.com',
  'chewy.com', 'petco.com', 'petsmart.com',
  'instacart.com', 'doordash.com', 'ubereats.com', 'grubhub.com',
  'opentable.com', 'yelp.com', 'tripadvisor.com',
  // ── Travel ────────────────────────────────────────────────────────────────
  'booking.com', 'expedia.com', 'airbnb.com', 'vrbo.com', 'kayak.com',
  'hotels.com', 'priceline.com', 'orbitz.com', 'travelocity.com',
  'delta.com', 'united.com', 'aa.com', 'southwest.com', 'jetblue.com',
  'marriott.com', 'hilton.com', 'hyatt.com', 'ihg.com', 'wyndham.com',
  'uber.com', 'lyft.com', 'waymo.com',
  // ── Education ─────────────────────────────────────────────────────────────
  'coursera.org', 'edx.org', 'khanacademy.org', 'udemy.com', 'udacity.com',
  'pluralsight.com', 'lynda.com', 'linkedin.com', 'skillshare.com',
  'codecademy.com', 'freecodecamp.org', 'theodinproject.com',
  'brilliant.org', 'duolingo.com', 'babbel.com', 'rosettastone.com',
  'cambridgeinternational.org',
  'britannica.com', 'encyclopedia.com',
  // ── Reference / Knowledge ─────────────────────────────────────────────────
  'wikipedia.org', 'wikimedia.org', 'wikihow.com', 'wikidata.org',
  'imdb.com', 'rottentomatoes.com', 'metacritic.com', 'goodreads.com',
  'nationalgeographic.com', 'smithsonianmag.com', 'history.com',
  'wolframalpha.com', 'dictionary.com', 'merriam-webster.com',
  'etymonline.com', 'thesaurus.com',
  'archive.org', 'waybackmachine.org',
  // ── Health ────────────────────────────────────────────────────────────────
  'webmd.com', 'mayoclinic.org', 'clevelandclinic.org', 'healthline.com',
  'medicalnewstoday.com', 'everydayhealth.com', 'drugs.com',
  'rxlist.com', 'medscape.com', 'uptodate.com', 'emedicinehealth.com',
  'psych.org', 'nami.org', 'betterhelp.com', 'talkspace.com',
  // ── Legal ─────────────────────────────────────────────────────────────────
  'law.cornell.edu', 'justia.com', 'findlaw.com', 'nolo.com', 'avvo.com',
  'legalzoom.com', 'rocket lawyer.com',
  // ── Government / Civic (beyond TLD) ──────────────────────────────────────
  'gov.uk', 'gc.ca', 'australia.gov.au',
  // ── Open Source / Misc Tech ──────────────────────────────────────────────
  'linux.org', 'kernel.org', 'gnu.org', 'apache.org', 'mozilla.org',
  'python.org', 'perl.org', 'haskell.org',
  'jquery.com', 'reactjs.org', 'react.dev', 'vuejs.org', 'angular.io',
  'svelte.dev', 'nextjs.org', 'nuxtjs.org', 'remix.run', 'astro.build',
  'tailwindcss.com', 'getbootstrap.com', 'mui.com', 'chakra-ui.com',
  'styled-components.com', 'emotion.sh',
  'vitejs.dev', 'webpack.js.org', 'rollupjs.org', 'esbuild.github.io',
  'babeljs.io', 'eslint.org', 'prettier.io', 'typescript.dev',
  'typescriptlang.org', 'deno.com', 'deno.land', 'bun.sh',
  'expressjs.com', 'fastify.io', 'nestjs.com', 'koajs.com', 'hapi.dev',
  'graphql.org', 'apollographql.com', 'trpc.io', 'grpc.io',
  'prisma.io', 'drizzle.team', 'typeorm.io', 'sequelize.org',
  'socket.io', 'feathersjs.com',
  'git-scm.com', 'gitkraken.com',
  'homebrew.sh', 'brew.sh', 'chocolatey.org', 'scoop.sh', 'winget.run',
  'ubuntu.com', 'debian.org', 'fedoraproject.org', 'archlinux.org',
  'redhat.com', 'suse.com', 'centos.org',
  // ── Security / Privacy ───────────────────────────────────────────────────
  'haveibeenpwned.com', 'virustotal.com', '1password.com', 'bitwarden.com',
  'lastpass.com', 'dashlane.com', 'nordvpn.com', 'expressvpn.com',
  'protonmail.com', 'proton.me', 'tutanota.com', 'fastmail.com',
  'letsencrypt.org', 'ssllabs.com', 'namecheap.com', 'godaddy.com',
  'porkbun.com', 'cloudflare.com', 'dnschecker.org',
  // ── Search ────────────────────────────────────────────────────────────────
  'google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'brave.com',
  'startpage.com', 'ecosia.org', 'kagi.com',
  // ── Productivity ─────────────────────────────────────────────────────────
  'gmail.com', 'outlook.com', 'office.com', 'office365.com',
  'docs.google.com', 'drive.google.com', 'calendar.google.com',
  'maps.google.com', 'translate.google.com',
  'evernote.com', 'onenote.com', 'bear.app', 'obsidian.md',
  'cal.com', 'calendly.com', 'doodle.com', 'when2meet.com',
  'loom.com', 'screen.studio', 'cleanshot.com',
  'canva.com', 'unsplash.com', 'pexels.com', 'pixabay.com',
  'shutterstock.com', 'gettyimages.com', 'istockphoto.com',
  'giphy.com', 'tenor.com',
  // ── Music / Media ─────────────────────────────────────────────────────────
  'soundcloud.com', 'bandcamp.com', 'last.fm', 'allmusic.com',
  'discogs.com', 'genius.com', 'azlyrics.com', 'musixmatch.com',
  'hulu.com', 'disneyplus.com', 'hbomax.com', 'max.com',
  'peacocktv.com', 'paramount.com', 'crunchyroll.com', 'funimation.com',
  'apple.com', 'music.apple.com',
  // ── Gaming ───────────────────────────────────────────────────────────────
  'steam.com', 'steampowered.com', 'epicgames.com', 'gog.com',
  'itch.io', 'roblox.com', 'minecraft.net', 'ea.com',
  'activision.com', 'blizzard.com', 'battle.net', 'ubisoft.com',
  'nintendo.com', 'playstation.com', 'xbox.com',
  'ign.com', 'gamespot.com', 'kotaku.com', 'polygon.com',
  'pcgamer.com', 'rockpapershotgun.com',
  // ── Science / Research ───────────────────────────────────────────────────
  'nasa.gov', 'esa.int', 'noaa.gov', 'nist.gov', 'usgs.gov',
  'epa.gov', 'energy.gov', 'nsf.gov',
  'acs.org', 'aps.org', 'aip.org', 'ams.org',
  'newsweek.com', 'scientificamerican.com', 'popularmechanics.com',
  'livescience.com', 'space.com', 'phys.org', 'sciencedaily.com',
  'technologyreview.com',
  // ── Mapping / Location ────────────────────────────────────────────────────
  'openstreetmap.org', 'mapbox.com', 'here.com', 'waze.com',
  'zillow.com', 'redfin.com', 'realtor.com', 'trulia.com', 'apartments.com',
  // ── HR / Recruiting ───────────────────────────────────────────────────────
  'indeed.com', 'glassdoor.com', 'monster.com', 'ziprecruiter.com',
  'careerbuilder.com', 'simplyhired.com', 'flexjobs.com', 'remote.com',
  'levels.fyi', 'teamblind.com', 'angellist.com', 'wellfound.com',
  // ── Misc established ─────────────────────────────────────────────────────
  'hbr.org', 'mckinsey.com', 'bcg.com', 'bain.com', 'deloitte.com',
  'pwc.com', 'kpmg.com', 'ey.com', 'accenture.com',
  'gartner.com', 'idc.com', 'forrester.com',
  'ted.com', 'masterclass.com',
  'change.org', 'gofundme.com', 'kickstarter.com', 'indiegogo.com',
  'patreon.com', 'ko-fi.com', 'buymeacoffee.com',
  'webpeel.dev',
]);

// ---------------------------------------------------------------------------
// Community / content platforms — user content hosted on established infra
// ---------------------------------------------------------------------------
const COMMUNITY_PLATFORMS = new Map<string, string>([
  ['github.com', 'Community Content on GitHub'],
  ['github.io', 'Personal Site on GitHub Pages'],
  ['gitlab.com', 'Community Content on GitLab'],
  ['medium.com', 'Article on Medium'],
  ['substack.com', 'Newsletter on Substack'],
  ['hashnode.com', 'Blog on Hashnode'],
  ['dev.to', 'Article on DEV Community'],
  ['wordpress.com', 'Blog on WordPress'],
  ['blogspot.com', 'Blog on Blogger'],
  ['blogger.com', 'Blog on Blogger'],
  ['tumblr.com', 'Blog on Tumblr'],
  ['weebly.com', 'Site on Weebly'],
  ['wix.com', 'Site on Wix'],
  ['squarespace.com', 'Site on Squarespace'],
  ['webflow.io', 'Site on Webflow'],
  ['vercel.app', 'Deployed Project on Vercel'],
  ['netlify.app', 'Deployed Project on Netlify'],
  ['pages.dev', 'Deployed Project on Cloudflare Pages'],
  ['web.app', 'Firebase Hosted App'],
  ['firebaseapp.com', 'Firebase Hosted App'],
  ['herokuapp.com', 'App on Heroku'],
  ['replit.dev', 'Project on Replit'],
  ['glitch.me', 'Project on Glitch'],
  ['codesandbox.io', 'Sandbox on CodeSandbox'],
  ['stackblitz.com', 'Project on StackBlitz'],
  ['codepen.io', 'Pen on CodePen'],
  ['jsfiddle.net', 'Fiddle on JSFiddle'],
  ['notion.site', 'Notion Page'],
  ['gitbook.io', 'Docs on GitBook'],
  ['gitbook.com', 'Docs on GitBook'],
  ['readthedocs.io', 'Docs on Read the Docs'],
  ['readthedocs.org', 'Docs on Read the Docs'],
  ['reddit.com', 'Community Discussion on Reddit'],
  ['news.ycombinator.com', 'Discussion on Hacker News'],
  ['quora.com', 'Answer on Quora'],
  ['stackoverflow.com', 'Answer on Stack Overflow'],
  ['stackexchange.com', 'Answer on Stack Exchange'],
  ['producthunt.com', 'Launch on Product Hunt'],
  ['indiehackers.com', 'Post on Indie Hackers'],
  ['hackernoon.com', 'Article on HackerNoon'],
  ['lobste.rs', 'Discussion on Lobsters'],
  ['lobsters.rs', 'Discussion on Lobsters'],
  ['twitter.com', 'Post on X (Twitter)'],
  ['x.com', 'Post on X (Twitter)'],
  ['linkedin.com', 'Post on LinkedIn'],
  ['youtube.com', 'Video on YouTube'],
  ['vimeo.com', 'Video on Vimeo'],
  ['twitch.tv', 'Stream on Twitch'],
  ['soundcloud.com', 'Audio on SoundCloud'],
  ['bandcamp.com', 'Music on Bandcamp'],
  ['pinterest.com', 'Pin on Pinterest'],
  ['instagram.com', 'Post on Instagram'],
  ['tiktok.com', 'Video on TikTok'],
]);

// ---------------------------------------------------------------------------
// Brand-category labels for established domains
// ---------------------------------------------------------------------------
const DOMAIN_CATEGORY: Record<string, string> = {
  // Tech
  'google.com': 'Established Technology Company',
  'apple.com': 'Established Technology Company',
  'microsoft.com': 'Established Technology Company',
  'amazon.com': 'Established E-commerce & Cloud Platform',
  'meta.com': 'Established Technology Company',
  'netflix.com': 'Established Streaming Service',
  'spotify.com': 'Established Music Streaming Service',
  'openai.com': 'Established AI Research Company',
  'anthropic.com': 'Established AI Research Company',
  'github.com': 'Established Developer Platform',
  'gitlab.com': 'Established Developer Platform',
  'stackoverflow.com': 'Established Developer Q&A Platform',
  'npmjs.com': 'Established Package Registry',
  'pypi.org': 'Established Package Registry',
  'docker.com': 'Established Container Platform',
  'vercel.com': 'Established Hosting Platform',
  'netlify.com': 'Established Hosting Platform',
  'cloudflare.com': 'Established CDN & Security Provider',
  'figma.com': 'Established Design Platform',
  'notion.so': 'Established Productivity Platform',
  'slack.com': 'Established Business Communication Platform',
  'zoom.us': 'Established Video Communication Platform',
  'adobe.com': 'Established Creative Software Company',
  // News
  'nytimes.com': 'Established News Organization',
  'washingtonpost.com': 'Established News Organization',
  'theguardian.com': 'Established News Organization',
  'bbc.com': 'Established News Organization',
  'bbc.co.uk': 'Established News Organization',
  'reuters.com': 'Established News Agency',
  'apnews.com': 'Established News Agency',
  'bloomberg.com': 'Established Financial News Organization',
  'economist.com': 'Established News Publication',
  'ft.com': 'Established Financial News Organization',
  'wsj.com': 'Established Financial News Organization',
  'cnn.com': 'Established News Organization',
  'npr.org': 'Established Public Radio',
  'techcrunch.com': 'Established Technology News Publication',
  'wired.com': 'Established Technology News Publication',
  'arstechnica.com': 'Established Technology News Publication',
  'theverge.com': 'Established Technology News Publication',
  // Finance
  'paypal.com': 'Established Payment Platform',
  'stripe.com': 'Established Payment Platform',
  'square.com': 'Established Payment Platform',
  'coinbase.com': 'Established Cryptocurrency Exchange',
  'chase.com': 'Established Financial Institution',
  'bankofamerica.com': 'Established Financial Institution',
  'wellsfargo.com': 'Established Financial Institution',
  // E-commerce
  'ebay.com': 'Established E-commerce Marketplace',
  'etsy.com': 'Established Handmade Marketplace',
  'walmart.com': 'Established Retail Company',
  'target.com': 'Established Retail Company',
  'bestbuy.com': 'Established Electronics Retailer',
  'shopify.com': 'Established E-commerce Platform',
  // Education
  'coursera.org': 'Established Online Education Platform',
  'edx.org': 'Established Online Education Platform',
  'khanacademy.org': 'Non-Profit Education Platform',
  'udemy.com': 'Established Online Learning Marketplace',
  'britannica.com': 'Established Reference Encyclopedia',
  'wikipedia.org': 'Open Encyclopedia (Community Edited)',
  // Reference
  'archive.org': 'Established Digital Archive',
  'wolframalpha.com': 'Established Computational Knowledge Engine',
  'imdb.com': 'Established Movie & TV Database',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTLD(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length < 2) return '';
  return '.' + parts.slice(-1)[0];
}

function extractSLD(hostname: string): string {
  // Returns registrable domain (e.g. "google.com")
  const parts = hostname.split('.');
  if (parts.length < 2) return hostname;
  return parts.slice(-2).join('.');
}

function countSubdomains(hostname: string): number {
  // www.example.com → 0 subdomains (www doesn't count)
  const stripped = hostname.replace(/^www\./, '');
  const parts = stripped.split('.');
  return Math.max(0, parts.length - 2);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Assess the credibility of a source URL.
 * Fully synchronous — no network calls.
 */
export function getSourceCredibility(url: string): SourceCredibility {
  const signals: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  // ── Parse URL ─────────────────────────────────────────────────────────────
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      tier: 'suspicious',
      score: 0,
      label: 'Invalid URL — Cannot Assess',
      signals: [],
      warnings: ['URL could not be parsed'],
    };
  }

  const protocol = parsedUrl.protocol; // 'https:' or 'http:'
  const rawHostname = parsedUrl.hostname.toLowerCase();
  const hostname = rawHostname.replace(/^www\./, '');
  const tld = extractTLD(hostname);
  const sld = extractSLD(hostname); // e.g. "google.com"
  const subdomainCount = countSubdomains(rawHostname);

  // ── 1. HTTPS check (0–10 pts) ─────────────────────────────────────────────
  if (protocol === 'https:') {
    score += 10;
    signals.push('HTTPS enforced');
  } else {
    warnings.push('HTTP only — no encryption');
  }

  // ── 2. TLD trust (0–20 pts) ───────────────────────────────────────────────
  const tldScore = TLD_TRUST[tld] ?? 5;
  score += tldScore;
  if (tldScore >= 18) {
    signals.push(`Trusted TLD (${tld})`);
  } else if (tldScore <= 3) {
    warnings.push(`High-risk TLD (${tld}) — commonly used in phishing`);
  }

  // ── 3. Official TLD shortcut ──────────────────────────────────────────────
  if (OFFICIAL_TLDS.has(tld) || OFFICIAL_DOMAINS.has(hostname) || OFFICIAL_DOMAINS.has(sld)) {
    const category = DOMAIN_CATEGORY[hostname] ?? DOMAIN_CATEGORY[sld] ?? 'Official Source';
    return {
      tier: 'official',
      score: Math.min(100, score + 40 + 15),
      label: tld === '.gov' ? 'Official Government Source' :
             tld === '.edu' ? 'Official Educational Institution' :
             tld === '.mil' ? 'Official Military Source' :
             tld === '.int' ? 'International Organization' :
             category,
      signals: [...signals, 'Official domain verified', `Trusted TLD (${tld})`].filter((v, i, a) => a.indexOf(v) === i),
      warnings,
    };
  }

  // ── 4. Domain structure (0–15 pts) ────────────────────────────────────────
  if (subdomainCount === 0) {
    score += 15;
    signals.push('Clean domain structure');
  } else if (subdomainCount === 1) {
    score += 10;
    signals.push('Standard subdomain structure');
  } else if (subdomainCount === 2) {
    score += 5;
  } else {
    // 3+ subdomains — possible phishing pattern
    score += 0;
    warnings.push(`Excessive subdomains (${subdomainCount}) — potential phishing indicator`);
  }

  // ── 5 & 6. Known domain + Community platform (mutually exclusive bonus) ──
  // Community platform detection — user content on a known hosting platform.
  // When the domain is a community platform, it gets the platform bonus (15 pts)
  // but NOT the established domain bonus (they're conceptually different tiers).
  const communityLabel = COMMUNITY_PLATFORMS.get(hostname) ?? COMMUNITY_PLATFORMS.get(sld);
  const isEstablished = ESTABLISHED_DOMAINS.has(hostname) || ESTABLISHED_DOMAINS.has(sld);

  if (communityLabel) {
    // Platform bonus only — user content hosted on verified infra
    score += 15;
    signals.push(`Hosted on verified platform (${sld})`);
  } else if (isEstablished) {
    // Full established domain bonus
    score += 40;
    signals.push('Recognized established domain');
  }

  // ── 7. Suspicious TLD ─────────────────────────────────────────────────────
  if (SUSPICIOUS_TLDS.has(tld)) {
    score = Math.min(score, 15); // Cap at suspicious tier
    warnings.push('Domain uses a free TLD associated with fraud');
  }

  // ── 8. Phishing keyword detection ─────────────────────────────────────────
  const phishingKeywords = ['paypal-', 'apple-', 'google-', 'microsoft-', 'amazon-',
    'bank-', 'login-', 'signin-', 'secure-', 'verify-', 'account-', 'update-',
    'support-', 'helpdesk-', '-login', '-signin', '-secure', '-verify', '-account',
    'paypal.', 'apple.', 'google.', 'microsoft.', 'amazon.'];
  const suspiciousPattern = phishingKeywords.some(kw => hostname.includes(kw) && !isEstablished && !communityLabel);
  if (suspiciousPattern) {
    score = Math.min(score, 19);
    warnings.push('Domain contains impersonation keywords — potential phishing');
  }

  // ── Clamp score ───────────────────────────────────────────────────────────
  score = Math.max(0, Math.min(100, score));

  // ── Tier assignment ───────────────────────────────────────────────────────
  let tier: SourceCredibility['tier'];
  if (score >= 90) tier = 'official';
  else if (score >= 60) tier = 'established';
  else if (score >= 40) tier = 'community';
  else if (score >= 20) tier = 'new';
  else tier = 'suspicious';

  // ── Label generation ──────────────────────────────────────────────────────
  let label: string;

  if (communityLabel) {
    label = communityLabel;
  } else if (isEstablished) {
    label = DOMAIN_CATEGORY[hostname] ?? DOMAIN_CATEGORY[sld] ?? labelFromTier(tier, hostname, tld);
  } else {
    label = labelFromTier(tier, hostname, tld);
  }

  return { tier, score, label, signals, warnings };
}

// ---------------------------------------------------------------------------
// Generate a useful fallback label based on tier + domain context
// ---------------------------------------------------------------------------
function labelFromTier(
  tier: SourceCredibility['tier'],
  _hostname: string,
  tld: string
): string {
  switch (tier) {
    case 'official':
      return 'Official Source';
    case 'established':
      return tld === '.org' ? 'Established Organization' :
             tld === '.net' ? 'Established Network Service' :
             tld === '.io'  ? 'Established Tech Service' :
             'Established Website';
    case 'community':
      return 'Community or Independent Website';
    case 'new':
      return 'Small or Recently Established Website';
    case 'suspicious':
      return SUSPICIOUS_TLDS.has(tld)
        ? `Free Domain TLD (${tld}) — Exercise Caution`
        : 'Unrecognized Domain — Exercise Caution';
    default:
      return 'Unknown Domain — Limited Verification Available';
  }
}
