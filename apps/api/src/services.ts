import { z } from 'zod';

const timeout = (ms = 8000) => AbortSignal.timeout(ms);
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: timeout(), headers: { accept: 'application/json', ...init?.headers } });
  if (!res.ok) throw Object.assign(new Error(`External service returned ${res.status}`), { status: res.status });
  return res.json() as Promise<T>;
}
export const packageNameSchema = z.string().trim().min(1).max(214).regex(/^(?:@(?:[a-z0-9][a-z0-9._~-]*)\/)?[a-z0-9][a-z0-9._~-]*$/i, 'Invalid npm package name');
export const versionSchema = z.string().trim().min(1).max(128).regex(/^[0-9A-Za-z.*+^~<>=| -]+$/, 'Invalid version');
export const npmPackage = async (name: string) => json<any>(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
export const npmSearch = async (q: string) => json<any>(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=20`);
const repoUrl = (repo: any): string | undefined => {
  const raw = typeof repo === 'string' ? repo : repo?.url;
  if (!raw || typeof raw !== 'string') return;
  const cleaned = raw.replace(/^git\+/, '').replace(/\.git$/, '');
  try { const u = new URL(cleaned); return u.hostname.toLowerCase() === 'github.com' ? `https://github.com/${u.pathname.split('/').filter(Boolean).slice(0, 2).join('/')}` : undefined; } catch { return; }
};
export async function githubInfo(repository: string | undefined) {
  if (!repository) return null;
  const path = repository.replace('https://github.com/', '').split('/').filter(Boolean);
  if (path.length !== 2) return null;
  const headers: Record<string,string> = { accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const [repo, commits, releases] = await Promise.all([
      json<any>(`https://api.github.com/repos/${path.map(encodeURIComponent).join('/')}`, { headers }),
      json<any[]>(`https://api.github.com/repos/${path.map(encodeURIComponent).join('/')}/commits?per_page=1`, { headers }),
      json<any[]>(`https://api.github.com/repos/${path.map(encodeURIComponent).join('/')}/releases?per_page=1`, { headers })
    ]);
    return { name: repo.full_name, url: repo.html_url, description: repo.description, stars: repo.stargazers_count, forks: repo.forks_count, openIssues: repo.open_issues_count, createdAt: repo.created_at, latestCommitAt: commits[0]?.commit?.committer?.date ?? null, latestRelease: releases[0]?.tag_name ?? null, latestReleaseAt: releases[0]?.published_at ?? null };
  } catch { return null; }
}
function freshness(date: unknown, graceDays: number, decayPerDay: number): number|null {
  if(typeof date!=='string')return null;
  const published=Date.parse(date);
  if(!Number.isFinite(published))return null;
  return Math.max(0,100-Math.max(0,(Date.now()-published)/86400000-graceDays)*decayPerDay);
}
export function healthScore(meta: any, gh: any) {
  const signals: { id: string; label: string; score: number | null; weight: number }[] = [
    { id:'maintenance', label:'Repository activity', score: freshness(gh?.latestCommitAt,30,0.3), weight:30 },
    { id:'release', label:'Release freshness', score: freshness(meta?.time?.[meta?.['dist-tags']?.latest],60,0.25), weight:25 },
    { id:'adoption', label:'Community adoption', score: gh&&Number.isFinite(gh.stars)&&gh.stars>=0 ? Math.min(100, Math.log10(gh.stars+1)*20) : null, weight:20 },
    { id:'metadata', label:'Metadata completeness', score: [meta?.description,meta?.license,meta?.repository,meta?.homepage].filter(Boolean).length*25, weight:15 },
    { id:'release-history', label:'Repository release history', score: gh ? (gh.latestReleaseAt ? 100 : 35) : null, weight:10 }
  ];
  const known = signals.filter(x => x.score !== null); const weight = known.reduce((s,x)=>s+x.weight,0);
  return { score: weight ? Math.round(known.reduce((s,x)=>s+(x.score as number)*x.weight,0)/weight) : null, complete: known.length === signals.length, signals, explanation: 'A heuristic based on public metadata and repository signals. Missing inputs are omitted and the remaining weights are renormalized. This is not a security assessment or a guarantee of quality.' };
}
export async function osvScan(name: string, version: string) {
  const result = await json<any>('https://api.osv.dev/v1/query', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ package:{name,ecosystem:'npm'}, version }) });
  return { scannedVersion: version, vulnerabilities: (result.vulns ?? []).map((v:any)=>({id:v.id,summary:v.summary ?? null,details:v.details ?? null,severity:v.severity?.map((s:any)=>s.score) ?? [],affected:(v.affected ?? []).map((a:any)=>({versions:a.versions??[],ranges:(a.ranges??[]).map((r:any)=>({type:r.type,events:r.events??[]}))})),references:v.references ?? []})) };
}
export { repoUrl };
