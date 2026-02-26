"""
WebPeel — Batch Fetch Example (Python)

Fetches multiple URLs in parallel using the async client.
Great for research pipelines, competitor monitoring, and data collection.

Setup:
    pip install webpeel
    export WEBPEEL_API_KEY=wp_your_key_here

Run:
    python examples/python/batch_fetch.py
"""

import asyncio
import os
import time
from webpeel import AsyncWebPeel

# Initialize the async client
wp = AsyncWebPeel(api_key=os.environ["WEBPEEL_API_KEY"])

# URLs to fetch in parallel
URLS = [
    "https://stripe.com/pricing",
    "https://vercel.com/pricing",
    "https://netlify.com/pricing",
    "https://railway.app/pricing",
    "https://render.com/pricing",
]


async def fetch_one(url: str) -> dict:
    """Fetch a single URL and return a result dict."""
    try:
        result = await wp.fetch(url, format="markdown")
        return {
            "url": url,
            "title": result.title,
            "words": result.word_count,
            "time_ms": result.response_time,
            "status": "ok",
            "preview": result.markdown[:200] + "..." if len(result.markdown) > 200 else result.markdown,
        }
    except Exception as e:
        return {"url": url, "status": "error", "error": str(e)}


async def main():
    start = time.time()
    print(f"🚀 Fetching {len(URLS)} URLs in parallel...\n")

    # Fetch all URLs concurrently
    results = await asyncio.gather(*[fetch_one(url) for url in URLS])

    elapsed = time.time() - start

    # Print results
    for r in results:
        if r["status"] == "ok":
            print(f"✅ {r['url']}")
            print(f"   Title:  {r['title']}")
            print(f"   Words:  {r['words']:,}  |  Time: {r['time_ms']}ms")
            print(f"   Preview: {r['preview'][:100]}...")
        else:
            print(f"❌ {r['url']}: {r['error']}")
        print()

    # Summary
    ok = sum(1 for r in results if r["status"] == "ok")
    print(f"---")
    print(f"Fetched {ok}/{len(URLS)} pages in {elapsed:.1f}s total")
    print(f"Average: {elapsed / len(URLS):.2f}s per page (parallel)")


asyncio.run(main())

"""
Expected output:

🚀 Fetching 5 URLs in parallel...

✅ https://stripe.com/pricing
   Title:  Pricing & Fees | Stripe
   Words:  3,241  |  Time: 412ms
   Preview: # Stripe Pricing

   Integrated per-transaction pricing with no hidden fees...

✅ https://vercel.com/pricing
   Title:  Vercel Pricing
   Words:  2,108  |  Time: 389ms
   Preview: # Vercel Pricing

   Start building for free. Scale as you grow...

...

---
Fetched 5/5 pages in 1.2s total
Average: 0.24s per page (parallel)
"""
