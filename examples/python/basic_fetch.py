"""
WebPeel — Basic Fetch Example (Python)

Fetches a webpage and prints its content as clean markdown.

Setup:
    pip install webpeel
    export WEBPEEL_API_KEY=wp_your_key_here

Run:
    python examples/python/basic_fetch.py
"""

import os
from webpeel import WebPeel

# Initialize the client with your API key
wp = WebPeel(api_key=os.environ["WEBPEEL_API_KEY"])

url = "https://news.ycombinator.com"
print(f"Fetching: {url}\n")

# Fetch the page — returns clean markdown by default
result = wp.fetch(url, format="markdown")

# Print the content
print(result.markdown)

# Print metadata
print("\n---")
print(f"Title:        {result.title}")
print(f"Word count:   {result.word_count:,}")
print(f"Fetched in:   {result.response_time}ms")

"""
Expected output:

Fetching: https://news.ycombinator.com

# Hacker News

## Top Stories

1. **Show HN: I built a terminal emulator in pure CSS** (382 points, 94 comments)
   https://example.com/css-terminal

2. **The unreasonable effectiveness of just showing up every day** (279 points, 67 comments)
   https://blog.example.com/showing-up

...

---
Title:        Hacker News
Word count:   1,842
Fetched in:   298ms
"""
