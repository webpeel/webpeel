export interface PipelineTiming {
  total: number;
  fetch: number;
  parse: number;
  prune: number;
  convert: number;
  metadata: number;
  readability?: number;
  quickAnswer?: number;
  domainExtract?: number;
  budget?: number;
}

export class Timer {
  private marks: Map<string, number> = new Map();
  private durations: Map<string, number> = new Map();
  private start: number;

  constructor() {
    this.start = Date.now();
  }

  mark(name: string): void {
    this.marks.set(name, Date.now());
  }

  end(name: string): number {
    const markTime = this.marks.get(name);
    if (!markTime) return 0;
    const duration = Date.now() - markTime;
    this.durations.set(name, duration);
    return duration;
  }

  toTiming(): PipelineTiming {
    return {
      total: Date.now() - this.start,
      fetch: this.durations.get('fetch') ?? 0,
      parse: this.durations.get('parse') ?? 0,
      prune: this.durations.get('prune') ?? 0,
      convert: this.durations.get('convert') ?? 0,
      metadata: this.durations.get('metadata') ?? 0,
      readability: this.durations.get('readability'),
      quickAnswer: this.durations.get('quickAnswer'),
      domainExtract: this.durations.get('domainExtract'),
      budget: this.durations.get('budget'),
    };
  }
}
