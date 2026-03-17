/**
 * Job application pipeline — stealth automated job applications.
 * Uses the human behavior engine for natural interaction.
 *
 * Flow:
 *   1. Rate-limit check (daily limit)
 *   2. Launch persistent browser (preserves login cookies)
 *   3. Warmup browse (optional, looks human)
 *   4. Navigate to job posting naturally
 *   5. Detect & click Apply button
 *   6. Scan form fields & categorize
 *   7. Fill fields with human behavior
 *   8. Handle multi-step forms
 *   9. Review / dry-run / auto submit
 *  10. Log to ~/.webpeel/applications.json
 */

import { join } from 'path';
import { homedir } from 'os';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { chromium as stealthChromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { BrowserContext, Page } from 'playwright';
import {
  humanClick,
  humanClearAndType,
  humanScroll,
  humanDelay,
  humanRead,
  humanUploadFile,
  warmupBrowse,
} from './human.js';

// Apply stealth plugin once (idempotent)
stealthChromium.use(StealthPlugin());

// ── Profile & Options Types ────────────────────────────────────────────

export interface ApplyProfile {
  /** Full name */
  name: string;
  /** Email */
  email: string;
  /** Phone number */
  phone: string;
  /** LinkedIn profile URL */
  linkedin?: string;
  /** Portfolio/website URL */
  website?: string;
  /** City, State */
  location: string;
  /** Work authorization status (e.g. "US Citizen", "Permanent Resident", "H-1B", "Need Sponsorship") */
  workAuthorization: string;
  /** Years of experience */
  yearsExperience: number;
  /** Current/most recent title */
  currentTitle: string;
  /** Skills list */
  skills: string[];
  /** Education: degree, school (e.g. "B.S. Computer Science, MIT") */
  education: string;
  /** Path to resume file (PDF) */
  resumePath: string;
  /** Brief professional summary (for cover letter / LLM question generation) */
  summary: string;
  /** Desired salary range */
  salaryRange?: { min: number; max: number };
  /** Willing to relocate? */
  willingToRelocate?: boolean;
  /** Sponsorship needed? */
  needsSponsorship?: boolean;
}

export interface ApplyOptions {
  /** Job URL to apply to */
  url: string;
  /** Profile data */
  profile: ApplyProfile;
  /** Path to persistent browser session directory (cookies, localStorage) */
  sessionDir?: string;
  /** Mode: 'auto' (fully automated) | 'review' (pause before submit) | 'dry-run' (fill but don't submit) */
  mode?: 'auto' | 'review' | 'dry-run';
  /** LLM API key for generating tailored answers to custom questions */
  llmKey?: string;
  /** LLM provider: 'openai' | 'anthropic' (default: 'openai') */
  llmProvider?: string;
  /** Daily application limit (default: 8) */
  dailyLimit?: number;
  /** Timeout per application in ms (default: 120000) */
  timeout?: number;
  /** Browse the site naturally before applying (default: true) */
  warmup?: boolean;
  /** Warmup duration in ms (default: 15000-30000 random) */
  warmupDuration?: number;
  /** Callback for progress updates */
  onProgress?: (event: ApplyProgressEvent) => void;
}

export interface ApplyProgressEvent {
  stage: 'warmup' | 'navigating' | 'reading' | 'filling' | 'reviewing' | 'submitting' | 'done' | 'error';
  message: string;
  /** Form fields detected (during 'filling' stage) */
  fields?: DetectedField[];
  /** Answers generated for fields */
  answers?: Record<string, string>;
}

export interface DetectedField {
  /** Field type: text, email, tel, textarea, select, radio, checkbox, file */
  type: string;
  /** Label or placeholder text */
  label: string;
  /** CSS selector */
  selector: string;
  /** Select/radio options if applicable */
  options?: string[];
  /** Whether field is required */
  required: boolean;
  /** What we think this field is asking for */
  category:
    | 'name'
    | 'email'
    | 'phone'
    | 'linkedin'
    | 'website'
    | 'location'
    | 'work-auth'
    | 'experience'
    | 'salary'
    | 'education'
    | 'resume'
    | 'cover-letter'
    | 'skills'
    | 'custom-question'
    | 'unknown';
}

export interface ApplyResult {
  /** Whether the application was submitted */
  submitted: boolean;
  /** Job details extracted during the process */
  job: {
    title: string;
    company: string;
    location?: string;
    salary?: string;
  };
  /** Fields that were filled */
  fieldsFilled: number;
  /** Fields that needed LLM-generated answers */
  llmAnswers: number;
  /** Fields that couldn't be filled (unknown/ambiguous) */
  fieldsSkipped: string[];
  /** Any warnings */
  warnings: string[];
  /** Total time taken in ms */
  elapsed: number;
  /** Error if failed */
  error?: string;
}

// ── Application Tracker ────────────────────────────────────────────────

export interface ApplicationRecord {
  id: string;            // UUID
  url: string;
  company: string;
  title: string;
  location?: string;
  salary?: string;
  appliedAt: string;     // ISO-8601
  mode: 'auto' | 'review' | 'dry-run';
  status: 'applied' | 'interview' | 'rejected' | 'offer' | 'withdrawn';
  fieldsFilled: number;
  fieldsSkipped: string[];
  warnings: string[];
  notes?: string;
}

const WEBPEEL_DIR = join(homedir(), '.webpeel');
const APPLICATIONS_FILE = join(WEBPEEL_DIR, 'applications.json');

function ensureWebpeelDir(): void {
  if (!existsSync(WEBPEEL_DIR)) {
    mkdirSync(WEBPEEL_DIR, { recursive: true });
  }
}

export function loadApplications(): ApplicationRecord[] {
  ensureWebpeelDir();
  if (!existsSync(APPLICATIONS_FILE)) return [];
  try {
    const raw = readFileSync(APPLICATIONS_FILE, 'utf-8');
    return JSON.parse(raw) as ApplicationRecord[];
  } catch {
    return [];
  }
}

export function saveApplication(record: ApplicationRecord): void {
  ensureWebpeelDir();
  const existing = loadApplications();
  existing.push(record);
  writeFileSync(APPLICATIONS_FILE, JSON.stringify(existing, null, 2), 'utf-8');
}

export function getApplicationsToday(): number {
  const apps = loadApplications();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return apps.filter(a => a.appliedAt.startsWith(today)).length;
}

export function updateApplicationStatus(id: string, status: ApplicationRecord['status']): void {
  ensureWebpeelDir();
  const apps = loadApplications();
  const idx = apps.findIndex(a => a.id === id);
  if (idx >= 0) {
    apps[idx]!.status = status;
    writeFileSync(APPLICATIONS_FILE, JSON.stringify(apps, null, 2), 'utf-8');
  }
}

// ── Field Detection ────────────────────────────────────────────────────

interface RawField {
  type: string;
  label: string;
  placeholder: string;
  name: string;
  id: string;
  required: boolean;
  options: string[];
  selector: string;
}

/**
 * Categorize a field based on its label, type, name, and placeholder.
 */
function categorizeField(field: RawField): DetectedField['category'] {
  const label = field.label.toLowerCase();
  const placeholder = field.placeholder.toLowerCase();
  const name = field.name.toLowerCase();
  const id = field.id.toLowerCase();
  const combined = `${label} ${placeholder} ${name} ${id}`;

  // Input type shortcuts (most reliable signal)
  if (field.type === 'file') return 'resume';
  if (field.type === 'email') return 'email';
  if (field.type === 'tel') return 'phone';

  // Label/name matching — more specific first
  if (/\blinkedin\b/.test(combined)) return 'linkedin';
  if (/\bwebsite\b|\bportfolio\b|\bpersonal\s+site\b/.test(combined)) return 'website';
  if (/\bemail\b/.test(combined)) return 'email';
  if (/\bphone\b|\bcell\b|\bmobile\b|\btelephone\b/.test(combined)) return 'phone';
  if (/\bfull\s+name\b|\byour\s+name\b|\bfirst.*last\b/.test(combined)) return 'name';
  if (/\bfirst\s+name\b/.test(combined)) return 'name';
  if (/\blast\s+name\b|\bsurname\b/.test(combined)) return 'name';
  if (/\bname\b/.test(combined)) return 'name';
  if (/\blocation\b|\bcity\b|\bstate\b|\bzip\b|\bpostal\b|\baddress\b/.test(combined)) return 'location';
  if (/\bwork\s+auth|\bauthoriz|\bsponsorship\b|\bvisa\b|\blegal\s+status\b/.test(combined)) return 'work-auth';
  if (/\byears?\s+of\s+exp|\bexperience\b|\byears?\s+exp\b/.test(combined)) return 'experience';
  if (/\bsalary\b|\bcompensation\b|\bpay\s+range\b|\bexpected\s+pay\b/.test(combined)) return 'salary';
  if (/\beducation\b|\bdegree\b|\bschool\b|\buniversity\b|\bcollege\b/.test(combined)) return 'education';
  if (/\bresume\b|\bcv\b/.test(combined)) return 'resume';
  if (/\bcover\s+letter\b/.test(combined)) return 'cover-letter';
  if (/\bskill\b/.test(combined)) return 'skills';

  // Textarea with a meaningful label → likely a custom question
  if (field.type === 'textarea' && label.length > 10) return 'custom-question';

  // Select dropdown with options + meaningful label → likely custom question
  if (field.type === 'select' && field.options.length > 0 && label.length > 5) return 'custom-question';

  return 'unknown';
}

/**
 * Scan a page (or modal) for form fields and categorize them.
 * Uses page.evaluate() to access DOM elements.
 *
 * Note: all DOM API calls inside page.evaluate() use `any` since the project
 * does not include the DOM lib (lib: ["ES2022"] only). The code is correct at
 * runtime because it executes in the browser context.
 */
async function detectFields(page: Page): Promise<DetectedField[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawFields: RawField[] = await page.evaluate((): any => {
    // All variables here are `any` — this runs inside the browser, not Node.js
    const doc = (globalThis as any).document; // eslint-disable-line

    const elements: any[] = Array.from(
      doc.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
      )
    );

    return elements.map((el: any): any => {
      let label = '';

      // Strategy 1: <label for="id">
      if (el.id) {
        const labelEl = doc.querySelector(`label[for="${el.id as string}"]`);
        if (labelEl) label = String(labelEl.textContent || '').trim();
      }

      // Strategy 2: parent <label>
      if (!label) {
        const parentLabel = el.closest('label');
        if (parentLabel) {
          label = String(parentLabel.textContent || '')
            .replace(String(el.value || ''), '')
            .trim();
        }
      }

      // Strategy 3: aria-label
      if (!label) label = String(el.getAttribute('aria-label') || '');

      // Strategy 4: aria-labelledby
      if (!label) {
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const labelEl = doc.getElementById(String(labelledBy));
          if (labelEl) label = String(labelEl.textContent || '').trim();
        }
      }

      // Strategy 5: preceding sibling text
      if (!label) {
        const prev = el.previousElementSibling;
        if (prev && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(String(prev.tagName))) {
          label = String(prev.textContent || '').trim().slice(0, 100);
        }
      }

      // Build unique CSS selector
      let selector = '';
      const elId = String(el.id || '');
      const elName = String(el.name || '');
      const tagName = String(el.tagName).toLowerCase();

      if (elId) {
        selector = `#${elId}`;
      } else if (elName) {
        selector = `${tagName}[name="${elName}"]`;
      } else {
        const form = el.closest('form, [role="dialog"], [class*="modal"]');
        const container = form || doc.body;
        const sibs: any[] = Array.from(
          container.querySelectorAll(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
          )
        );
        const idx = sibs.indexOf(el);
        selector = `${tagName}:nth-child(${idx + 1})`;
      }

      // Collect <select> options
      const options: string[] = [];
      if (String(el.tagName) === 'SELECT') {
        const optEls: any[] = Array.from(el.options || []);
        for (const opt of optEls) {
          if (opt.value && opt.text) options.push(String(opt.text).trim());
        }
      }

      const fieldType = String(el.tagName) === 'SELECT'
        ? 'select'
        : String(el.tagName) === 'TEXTAREA'
          ? 'textarea'
          : String(el.type || 'text');

      return {
        type: fieldType,
        label: String(label).replace(/\s+/g, ' ').trim().slice(0, 150),
        placeholder: String(el.placeholder || ''),
        name: elName,
        id: elId,
        required:
          Boolean(el.hasAttribute('required')) ||
          el.getAttribute('aria-required') === 'true',
        options,
        selector,
      };
    });
  }) as RawField[];

  return rawFields.map(raw => ({
    type: raw.type,
    label: raw.label || raw.placeholder || raw.name || raw.id || '(unlabeled)',
    selector: raw.selector,
    options: raw.options.length > 0 ? raw.options : undefined,
    required: raw.required,
    category: categorizeField(raw),
  }));
}

// ── Job Info Detection ─────────────────────────────────────────────────

interface JobInfo {
  title: string;
  company: string;
  location?: string;
  salary?: string;
}

async function detectJobInfo(page: Page): Promise<JobInfo> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return page.evaluate((): any => {
    const doc = (globalThis as any).document; // eslint-disable-line

    const text = (sel: string): string =>
      String(doc.querySelector(sel)?.textContent || '').trim();

    const title =
      text('.job-details-jobs-unified-top-card__job-title') ||
      text('[data-testid="job-title"]') ||
      text('h1.topcard__title') ||
      text('h1') ||
      String(doc.title || '').split('|')[0]?.trim() ||
      '';

    const company =
      text('.job-details-jobs-unified-top-card__company-name') ||
      text('[data-testid="company-name"]') ||
      text('.topcard__org-name-link');

    const locationText =
      text('.job-details-jobs-unified-top-card__bullet') ||
      text('[data-testid="job-location"]') ||
      text('.topcard__flavor--bullet');

    const salaryEl =
      doc.querySelector('[class*="salary"]') ||
      doc.querySelector('[class*="compensation"]');
    const salary = String(salaryEl?.textContent || '').trim() || undefined;

    return {
      title,
      company,
      location: locationText || undefined,
      salary,
    };
  }) as Promise<JobInfo>;
}

// ── LLM Integration ────────────────────────────────────────────────────

async function callLLMForAnswer(
  question: string,
  profile: ApplyProfile,
  jobTitle: string,
  company: string,
  fieldOptions: string[] | undefined,
  llmKey: string,
  llmProvider: string
): Promise<string> {
  const prompt = `You are filling out a job application. Answer this screening question concisely and professionally.

Job: ${jobTitle} at ${company}
Question: "${question}"
${fieldOptions ? `Options: ${fieldOptions.join(', ')}` : ''}

Applicant profile:
- Name: ${profile.name}
- Title: ${profile.currentTitle}
- Experience: ${profile.yearsExperience} years
- Skills: ${profile.skills.join(', ')}
- Summary: ${profile.summary}

Answer (keep it concise, 1-3 sentences for text fields, or pick the best matching option for select/radio):`;

  const systemPrompt = 'You are a helpful job application assistant. Provide concise, professional answers.';

  if (llmProvider === 'anthropic') {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': llmKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-latest',
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });
    if (!resp.ok) throw new Error(`Anthropic API error: ${resp.status}`);
    const json = await resp.json() as Record<string, unknown>;
    const blocks = Array.isArray(json?.content) ? json.content : [];
    return (blocks as Array<Record<string, unknown>>)
      .map(b => String(b?.text ?? ''))
      .join('')
      .trim();
  } else {
    // Default: OpenAI
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    });
    if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status}`);
    const json = await resp.json() as Record<string, unknown>;
    const choices = json?.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    return String(message?.content ?? '').trim();
  }
}

// ── Form Navigation ────────────────────────────────────────────────────

/** Find the "Next" / "Continue" / "Review" button in a multi-step form. */
async function findNextButton(page: Page): Promise<string | null> {
  const selectors = [
    '[aria-label="Continue to next step"]',
    '[aria-label="Next"]',
    'button:text("Next")',
    'button:text("Continue")',
    'button:text("Review")',
    '[data-easy-apply-next-button]',
  ];

  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) return sel;
    } catch { /* continue */ }
  }

  // Text-based fallback
  const btns = await page.$$('button');
  for (const btn of btns) {
    const text = (await btn.textContent() || '').trim().toLowerCase();
    if ((text === 'next' || text === 'continue' || text === 'review') && await btn.isVisible()) {
      // Generate a selector for this button
      const id = await btn.getAttribute('id');
      if (id) return `#${id}`;
      const cls = await btn.getAttribute('class');
      if (cls) return `button.${cls.split(' ')[0]}`;
    }
  }
  return null;
}

/** Find the "Submit" / "Submit Application" button. */
async function findSubmitButton(page: Page): Promise<string | null> {
  const selectors = [
    '[aria-label="Submit application"]',
    'button:text("Submit application")',
    'button:text("Submit Application")',
    '[data-easy-apply-submit-button]',
  ];

  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) return sel;
    } catch { /* continue */ }
  }

  // Text-based fallback
  const btns = await page.$$('button[type="submit"], button');
  for (const btn of btns) {
    const text = (await btn.textContent() || '').trim().toLowerCase();
    if (
      (text.includes('submit') || text === 'apply') &&
      !text.includes('next') &&
      await btn.isVisible()
    ) {
      const id = await btn.getAttribute('id');
      if (id) return `#${id}`;
      return 'button[type="submit"]';
    }
  }
  return null;
}

/** Find and click the Apply button on a job posting. Returns the type of apply flow detected. */
async function clickApplyButton(page: Page): Promise<'easy-apply' | 'external' | 'not-found'> {
  // LinkedIn Easy Apply
  const easyApplySelectors = [
    '.jobs-apply-button',
    '[aria-label="Easy Apply"]',
    'button:text("Easy Apply")',
  ];

  for (const sel of easyApplySelectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        await humanClick(page, sel);
        await humanDelay(1000, 2500);
        return 'easy-apply';
      }
    } catch { /* continue */ }
  }

  // External apply button
  const externalSelectors = [
    '[data-testid="apply-button"]',
    'a:text("Apply")',
    'button:text("Apply")',
  ];

  for (const sel of externalSelectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        await humanClick(page, sel);
        await humanDelay(1000, 2000);
        return 'external';
      }
    } catch { /* continue */ }
  }

  return 'not-found';
}

// ── Field Filling ──────────────────────────────────────────────────────

/** Get the value to fill for a field based on its category and the applicant's profile. */
async function getFieldValue(
  field: DetectedField,
  profile: ApplyProfile,
  jobTitle: string,
  company: string,
  llmKey?: string,
  llmProvider?: string
): Promise<string | null> {
  switch (field.category) {
    case 'name':       return profile.name;
    case 'email':      return profile.email;
    case 'phone':      return profile.phone;
    case 'linkedin':   return profile.linkedin ?? null;
    case 'website':    return profile.website ?? null;
    case 'location':   return profile.location;
    case 'education':  return profile.education;
    case 'skills':     return profile.skills.join(', ');
    case 'experience': return String(profile.yearsExperience);
    case 'resume':     return null; // handled separately via file upload

    case 'salary':
      return profile.salaryRange ? String(profile.salaryRange.min) : null;

    case 'work-auth': {
      // Try to find matching option from the select's options list
      if (field.options && field.options.length > 0) {
        const target = profile.workAuthorization.toLowerCase();
        const match = field.options.find(opt =>
          opt.toLowerCase().includes(target) || target.includes(opt.toLowerCase().replace(/[^a-z\s]/g, ''))
        );
        return match ?? field.options[0] ?? profile.workAuthorization;
      }
      return profile.workAuthorization;
    }

    case 'cover-letter':
      return [
        profile.summary,
        '',
        `I am excited to apply for the ${jobTitle} position at ${company}. ` +
        `With ${profile.yearsExperience} years of experience as ${profile.currentTitle}, ` +
        `I am confident I would be a strong fit for this role.`,
      ].join('\n');

    case 'custom-question':
      if (llmKey) {
        try {
          return await callLLMForAnswer(
            field.label, profile, jobTitle, company,
            field.options, llmKey, llmProvider ?? 'openai'
          );
        } catch {
          return null; // gracefully skip if LLM fails
        }
      }
      return null;

    case 'unknown':
    default:
      return null;
  }
}

/** Fill a single form field using appropriate human behavior functions. */
async function fillField(
  page: Page,
  field: DetectedField,
  value: string,
  warnings: string[]
): Promise<boolean> {
  try {
    if (field.type === 'select') {
      // Try by label text first, then by value
      await page.selectOption(field.selector, { label: value }).catch(async () => {
        await page.selectOption(field.selector, value).catch(() => { /* ignore */ });
      });
      return true;
    }

    if (field.type === 'file') {
      await humanUploadFile(page, field.selector, value);
      return true;
    }

    if (field.type === 'radio') {
      // Try clicking a radio with matching value
      const radioSel = `input[type="radio"][value="${value}"]`;
      const el = await page.$(radioSel);
      if (el && await el.isVisible()) {
        await humanClick(page, radioSel);
        return true;
      }
      // Try by label text
      const label = await page.$(`label:text("${value}")`);
      if (label) {
        const box = await label.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          return true;
        }
      }
      return false;
    }

    if (field.type === 'checkbox') {
      const lower = value.toLowerCase();
      if (lower === 'true' || lower === 'yes' || lower === '1') {
        const el = await page.$(field.selector);
        if (el && !(await el.isChecked())) {
          await humanClick(page, field.selector);
        }
        return true;
      }
      return false;
    }

    // Text, textarea, email, tel — use clear-and-type for reliability
    await humanClearAndType(page, field.selector, value);
    return true;
  } catch (err) {
    warnings.push(
      `Failed to fill "${field.label}": ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

// ── Main Entry Point ───────────────────────────────────────────────────

/**
 * Apply to a job with stealth human-like behavior.
 *
 * Default mode is 'review' — it fills the form and waits for your approval
 * before submitting. Use 'auto' for fully automated, 'dry-run' to see what
 * would be filled without actually clicking submit.
 *
 * Requires a persistent browser session for login state preservation.
 * On first run, the browser will open — log into LinkedIn, then the session
 * is saved to `~/.webpeel/sessions/linkedin/` for future runs.
 *
 * @example
 * ```typescript
 * const result = await applyToJob({
 *   url: 'https://linkedin.com/jobs/view/...',
 *   profile: myProfile,
 *   mode: 'review',
 * });
 * ```
 */
export async function applyToJob(options: ApplyOptions): Promise<ApplyResult> {
  const startTime = Date.now();
  const {
    url,
    profile,
    mode = 'review',
    llmKey,
    llmProvider = 'openai',
    dailyLimit = 8,
    timeout = 120_000,
    warmup: doWarmup = true,
    warmupDuration,
    onProgress,
  } = options;

  const progress = (
    stage: ApplyProgressEvent['stage'],
    message: string,
    extra?: Partial<ApplyProgressEvent>
  ): void => {
    onProgress?.({ stage, message, ...extra });
  };

  const result: ApplyResult = {
    submitted: false,
    job: { title: '', company: '' },
    fieldsFilled: 0,
    llmAnswers: 0,
    fieldsSkipped: [],
    warnings: [],
    elapsed: 0,
  };

  // ── 1. Rate limit check ────────────────────────────────────────────
  if (mode !== 'dry-run') {
    const todayCount = getApplicationsToday();
    if (todayCount >= dailyLimit) {
      const msg = `Daily application limit reached (${todayCount}/${dailyLimit}). Try again tomorrow.`;
      result.error = msg;
      result.elapsed = Date.now() - startTime;
      progress('error', msg);
      return result;
    }
  }

  // ── 2. Determine session directory ────────────────────────────────
  const isLinkedIn = url.includes('linkedin.com');
  const siteName = isLinkedIn
    ? 'linkedin'
    : (() => {
        try { return new URL(url).hostname.replace('www.', '').split('.')[0] ?? 'generic'; }
        catch { return 'generic'; }
      })();
  const sessionDir = options.sessionDir ?? join(homedir(), '.webpeel', 'sessions', siteName);
  mkdirSync(sessionDir, { recursive: true });

  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    // ── 3. Launch persistent browser ──────────────────────────────
    progress('navigating', 'Launching browser with persistent session...');

    context = await stealthChromium.launchPersistentContext(sessionDir, {
      headless: false, // visible so user can monitor (or log in on first run)
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    // context is guaranteed non-null here — assignment above throws on failure
    const existingPages = context!.pages();
    page = existingPages.length > 0 ? existingPages[0]! : await context!.newPage();

    // ── 4. Warmup phase ───────────────────────────────────────────
    if (doWarmup) {
      progress('warmup', 'Warming up with natural browsing...');
      try {
        const warmupUrl = isLinkedIn
          ? 'https://www.linkedin.com/feed/'
          : new URL(url).origin;

        await page.goto(warmupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await humanDelay(2000, 4000);

        const warmupMs = warmupDuration ?? Math.round(15000 + Math.random() * 15000);
        await warmupBrowse(page, warmupMs);
      } catch {
        result.warnings.push('Warmup phase failed — continuing without warmup');
      }
    }

    // ── 5. Navigate to job posting ────────────────────────────────
    progress('navigating', `Navigating to job posting...`);

    // Navigate via jobs home first (looks more natural than direct URL jump)
    if (isLinkedIn) {
      try {
        await page.goto('https://www.linkedin.com/jobs/', {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await humanDelay(1500, 3000);
        await humanScroll(page, { direction: 'down', amount: 200 });
        await humanDelay(800, 1500);
      } catch { /* ignore, proceed to actual URL */ }
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await humanDelay(1500, 3000);

    // ── 6. Read the job posting ───────────────────────────────────
    progress('reading', 'Reading job posting...');
    await humanRead(page, Math.round(4000 + Math.random() * 6000)); // 4-10s

    // Extract job info from the page
    result.job = await detectJobInfo(page);

    // ── 7. Click Apply button ─────────────────────────────────────
    progress('navigating', 'Clicking Apply button...');
    const applyType = await clickApplyButton(page);

    if (applyType === 'not-found') {
      result.warnings.push('Could not find Apply button — the form may be directly on the page');
    } else {
      result.warnings.push(`Apply type: ${applyType}`);
    }

    await humanDelay(1500, 3000);

    // ── 8. Multi-step form filling ────────────────────────────────
    progress('filling', 'Scanning and filling form...');

    let stepCount = 0;
    const MAX_STEPS = 10;
    const allAnswers: Record<string, string> = {};

    while (stepCount < MAX_STEPS) {
      stepCount++;

      const fields = await detectFields(page);
      progress('filling', `Step ${stepCount}: found ${fields.length} field(s)`, { fields });

      for (const field of fields) {
        if (field.category === 'unknown' && field.type !== 'select') {
          result.fieldsSkipped.push(field.label);
          continue;
        }

        await humanDelay(300, 800);

        // Resume file upload — special handling
        if (field.category === 'resume' && field.type === 'file') {
          try {
            await humanUploadFile(page, field.selector, profile.resumePath);
            result.fieldsFilled++;
            allAnswers[field.label] = `[File: ${profile.resumePath}]`;
          } catch (err) {
            result.warnings.push(
              `Resume upload failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
          continue;
        }

        const value = await getFieldValue(
          field, profile, result.job.title, result.job.company,
          llmKey, llmProvider
        );

        if (value === null) {
          result.fieldsSkipped.push(field.label);
          continue;
        }

        if (field.category === 'custom-question' && llmKey) {
          result.llmAnswers++;
        }

        const filled = await fillField(page, field, value, result.warnings);
        if (filled) {
          result.fieldsFilled++;
          allAnswers[field.label] = value.length > 80 ? value.slice(0, 77) + '...' : value;
        } else {
          result.fieldsSkipped.push(field.label);
        }

        await humanDelay(500, 1500);
      }

      // Check for submit button
      const submitBtn = await findSubmitButton(page);
      if (submitBtn) {
        progress('reviewing', 'Form complete — ready to submit', { answers: allAnswers });

        if (mode === 'dry-run') {
          console.log('\n📋 DRY-RUN — fields that would be filled:');
          for (const [label, value] of Object.entries(allAnswers)) {
            console.log(`  ✓ ${label}: ${value}`);
          }
          if (result.fieldsSkipped.length > 0) {
            console.log(`\n  ⚠️  Skipped: ${result.fieldsSkipped.join(', ')}`);
          }
          console.log('\n[Dry-run complete — NOT submitted]\n');
          result.submitted = false;
          break;
        }

        if (mode === 'review') {
          console.log('\n📋 Review — fields filled:');
          for (const [label, value] of Object.entries(allAnswers)) {
            console.log(`  ✓ ${label}: ${value}`);
          }
          if (result.fieldsSkipped.length > 0) {
            console.log(`\n  ⚠️  Skipped: ${result.fieldsSkipped.join(', ')}`);
          }
          console.log('\nPlease review the form in the browser window.');
          console.log('Press Enter to submit, or Ctrl+C to abort...');

          await new Promise<void>(resolve => {
            const onData = (_data: Buffer): void => {
              process.stdin.removeListener('data', onData);
              try { process.stdin.setRawMode(false); } catch { /* not a TTY */ }
              process.stdin.pause();
              resolve();
            };
            try { process.stdin.setRawMode(true); } catch { /* not a TTY */ }
            process.stdin.resume();
            process.stdin.once('data', onData);
          });
        }

        // ── 9. Submit ──────────────────────────────────────────────
        progress('submitting', 'Submitting application...');
        await humanClick(page, submitBtn);
        await humanDelay(2000, 4000);

        // Check for success confirmation text
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const submitted = await page.evaluate((): any => {
          const doc = (globalThis as any).document; // eslint-disable-line
          const body = String(doc.body?.textContent || '');
          return (
            body.includes('Application submitted') ||
            body.includes('application was sent') ||
            body.includes('successfully applied') ||
            body.includes('Thank you for applying') ||
            doc.querySelector('[class*="post-apply"]') !== null ||
            doc.querySelector('[aria-label*="Application submitted"]') !== null
          );
        }) as boolean;

        result.submitted = submitted;
        if (!submitted) {
          result.warnings.push('Could not confirm submission — check the browser window');
        }
        break;
      }

      // Look for Next/Continue button to advance to the next step
      const nextBtn = await findNextButton(page);
      if (!nextBtn) {
        result.warnings.push('No Next or Submit button found — stopping form traversal');
        break;
      }

      await humanClick(page, nextBtn);
      await humanDelay(1500, 3000);
    }

    if (stepCount >= MAX_STEPS) {
      result.warnings.push(`Reached form step limit (${MAX_STEPS}) — form may be unusually long`);
    }

    // ── 10. Log application ───────────────────────────────────────
    if (mode !== 'dry-run') {
      const record: ApplicationRecord = {
        id: randomUUID(),
        url,
        company: result.job.company,
        title: result.job.title,
        location: result.job.location,
        salary: result.job.salary,
        appliedAt: new Date().toISOString(),
        mode,
        status: 'applied',
        fieldsFilled: result.fieldsFilled,
        fieldsSkipped: result.fieldsSkipped,
        warnings: result.warnings,
      };
      saveApplication(record);
    }

    progress(
      'done',
      result.submitted
        ? '✅ Application submitted!'
        : mode === 'dry-run'
          ? '📋 Dry-run complete (not submitted)'
          : '📋 Application completed'
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.error = msg;
    progress('error', `Error: ${msg}`);
  } finally {
    // Close page but keep context alive (preserves session for next run)
    if (page && !page.isClosed()) {
      await page.close().catch(() => { /* ignore */ });
    }
    // DO NOT close context — this keeps the session/cookies alive
  }

  result.elapsed = Date.now() - startTime;
  return result;
}
