const base=import.meta.env.VITE_API_URL??'http://localhost:4000';
export async function api<T>(path:string, init?:RequestInit):Promise<T>{const r=await fetch(`${base}${path}`,{...init,credentials:'include',headers:{'content-type':'application/json',...init?.headers}});const body=await r.json();if(!r.ok)throw new Error(body?.error?.message??'Request failed');return body.data as T;}
export type SearchItem={name:string;version:string;description:string|null;keywords:string[];date:string|null};
export type PackageInfo={name:string;description:string|null;version:string|null;license:string|null;maintainers:{name:string}[];author?:{name?:string}|string|null;homepage:string|null;repository:string|null;keywords:string[];publishedAt:string|null;versions:string[];github:null|{name:string;url:string;stars:number;forks:number;openIssues:number;latestCommitAt:string|null;latestRelease:string|null;latestReleaseAt:string|null;description:string|null};health:{score:number|null;complete:boolean;signals:{id:string;label:string;score:number|null;weight:number}[];explanation:string}};
export const search=(q:string)=>api<SearchItem[]>(`/api/packages/search?q=${encodeURIComponent(q)}`);
export const getPackage=(name:string)=>api<PackageInfo>(`/api/packages/${encodeURIComponent(name)}`);
export const scan=(name:string,version:string)=>api<{scannedVersion:string;vulnerabilities:{id:string;summary:string|null;severity:string[];affected:{versions:string[];ranges:{type:string;events:{introduced?:string;fixed?:string;last_affected?:string}[]}[]}[];references:{url:string}[]}[]}>(`/api/packages/${encodeURIComponent(name)}/security?version=${encodeURIComponent(version)}`);
export const compare=(packages:string[])=>api<any[]>(`/api/packages/compare`,{method:'POST',body:JSON.stringify({packages})});
export const auth=(signup:boolean,form:{name?:string;email:string;password:string})=>api<{user:{id:string;name:string;email:string}}>(`/api/auth/${signup?'signup':'login'}`,{method:'POST',body:JSON.stringify(form)});
export const logout=()=>api<{loggedOut:boolean}>('/api/auth/logout',{method:'POST'});
export const me=()=>api<{user:{id:string;name:string;email:string}|null}>('/api/auth/me');
export type PackageSnapshot={version:string|null;healthScore:number|null;securitySummary:{scannedVersion:string;vulnerabilityIds:string[];count:number}|null;collectedAt:string};
export type TrackedPackage={id:string;packageName:string;monitoringEnabled:boolean;lastCheckedAt:string|null;lastError:string|null;latestSnapshot:PackageSnapshot|null;previousSnapshot:PackageSnapshot|null};
export const dashboard=()=>api<{tracked:TrackedPackage[];monitoring:{mode:'bullmq'|'development-fallback'|'disabled';intervalMs:number}}>('/api/dashboard');
export const addTracked=(packageName:string)=>api<{id:string;packageName:string}>('/api/tracked-packages',{method:'POST',body:JSON.stringify({packageName})});
export const removeTracked=(id:string)=>api<{deleted:boolean}>(`/api/tracked-packages/${encodeURIComponent(id)}`,{method:'DELETE'});
export const setMonitoring=(id:string,enabled:boolean)=>api<{id:string;monitoringEnabled:boolean}>(`/api/tracked-packages/${encodeURIComponent(id)}/monitoring`,{method:'PATCH',body:JSON.stringify({enabled})});
