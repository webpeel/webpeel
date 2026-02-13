'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Button } from './ui/button';
import { CopyButton } from './copy-button';

interface ApiKeyDisplayProps {
  apiKey: string;
}

export function ApiKeyDisplay({ apiKey }: ApiKeyDisplayProps) {
  const [revealed, setRevealed] = useState(false);

  const displayKey = revealed ? apiKey : `${apiKey.slice(0, 12)}...${apiKey.slice(-4)}`;

  return (
    <div className="flex items-center gap-2 p-3 bg-zinc-50 border rounded-lg">
      <code className="flex-1 text-sm font-mono">{displayKey}</code>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setRevealed(!revealed)}
        className="gap-2"
      >
        {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        {revealed ? 'Hide' : 'Reveal'}
      </Button>
      <CopyButton text={apiKey} />
    </div>
  );
}
