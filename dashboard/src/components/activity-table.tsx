'use client';

import { Badge } from '@/components/ui/badge';
import { Activity } from 'lucide-react';

interface ApiRequest {
  id: string;
  url: string;
  status: 'success' | 'error';
  responseTime: number;
  mode: 'basic' | 'stealth';
  timestamp: string;
}

interface ActivityTableProps {
  requests?: ApiRequest[];
}

export function ActivityTable({ requests = [] }: ActivityTableProps) {
  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center mb-4">
          <Activity className="h-8 w-8 text-violet-600" />
        </div>
        <h3 className="text-lg font-semibold text-zinc-900 mb-2">No requests yet</h3>
        <p className="text-sm text-zinc-500 text-center max-w-md">
          Make your first API call to see activity here. Check out the{' '}
          <a href="https://github.com/JakeLiuMe/webpeel#readme" className="text-violet-600 hover:underline">
            documentation
          </a>{' '}
          to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-200">
            <th className="text-left py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">
              URL
            </th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">
              Status
            </th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">
              Time
            </th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">
              Mode
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 transition-colors">
              <td className="py-3 px-4">
                <a
                  href={request.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-zinc-900 hover:text-violet-600 transition-colors max-w-xs truncate block"
                >
                  {request.url}
                </a>
              </td>
              <td className="py-3 px-4">
                <Badge
                  variant={request.status === 'success' ? 'default' : 'destructive'}
                  className={request.status === 'success' 
                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' 
                    : ''
                  }
                >
                  {request.status}
                </Badge>
              </td>
              <td className="py-3 px-4">
                <span className="text-sm text-zinc-600">{request.responseTime}ms</span>
              </td>
              <td className="py-3 px-4">
                <Badge variant="secondary" className="bg-zinc-100 text-zinc-700">
                  {request.mode}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
