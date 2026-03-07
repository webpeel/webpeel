#!/usr/bin/env python3
"""Fix remaining console.log calls in search-provider.ts"""
import re

filepath = 'src/core/search-provider.ts'
with open(filepath) as f:
    content = f.read()

original = content

# Pattern 1: multi-line console.log with template literal
# console.log(\n  `[webpeel:search] ...`,\n  );
content = re.sub(
    r'console\.log\(\s*\n\s*`\[webpeel:search\] (.*?)`\s*(?:\+\s*.*?)?,\s*\n\s*\);',
    lambda m: f"log.debug(`{m.group(1).strip()}`);",
    content, flags=re.DOTALL
)

# Pattern 2: multi-line with concatenation
content = re.sub(
    r"console\.log\(\s*\n\s*`\[webpeel:search\] (.*?)`\s*\n\s*\+\s*(.*?)\n\s*\);",
    lambda m: f"log.debug(`{m.group(1).strip()}` + {m.group(2).strip()});",
    content, flags=re.DOTALL
)

# Pattern 3: single-line console.log with string literal
content = re.sub(
    r"console\.log\('\[webpeel:search\] (.*?)'\);",
    lambda m: f"log.debug('{m.group(1)}');",
    content
)

# Pattern 4: single-line with string + comma-args
content = re.sub(
    r"console\.log\('\[webpeel:search\] (.*?)',\s*(.*?)\);",
    lambda m: f"log.debug('{m.group(1)}', {m.group(2)});",
    content
)

# Pattern 5: single-line console.log with template literal
content = re.sub(
    r'console\.log\(`\[webpeel:search\] (.*?)`\);',
    lambda m: f"log.debug(`{m.group(1)}`);",
    content
)

with open(filepath, 'w') as f:
    f.write(content)

remaining = [(i+1, l) for i, l in enumerate(content.split('\n')) if 'console.' in l]
print(f"Modified. Remaining console.* lines: {len(remaining)}")
for lineno, line in remaining:
    print(f"  {lineno}: {line.strip()}")
