import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { monitorIntervalMs, runDevelopmentMonitorCycle } from './monitoring.js';
import { githubInfo, healthScore, npmPackage, npmSearch, osvScan, packageNameSchema, repoUrl, versionSchema } from './services.js';

const app = express();
const prisma = new PrismaClient();
app.disable('x-powered-by');
app.use(helmet());
const webOrigin=process.env.WEB_ORIGIN ?? 'http://localhost:5173';
app.use(cors({ origin:webOrigin, credentials:true }));
app.use((req,res,next)=>{if(['POST','PUT','PATCH','DELETE'].includes(req.method)){const origin=req.get('origin');if(origin&&origin!==webOrigin)return res.status(403).json({error:{code:'ORIGIN_REJECTED',message:'Request origin is not allowed'}});}next();});
app.use(express.json({ limit: '32kb' }));
const asyncRoute = (fn: express.RequestHandler): express.RequestHandler => (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const decodedName = (raw: string|string[]) => packageNameSchema.parse(decodeURIComponent(Array.isArray(raw)?raw.join('/'):raw));
const monitoringMode = () => process.env.REDIS_URL ? 'bullmq' : process.env.NODE_ENV === 'production' ? 'disabled' : 'development-fallback';
async function trackedWithSnapshots(userId:string){
  const tracked=await prisma.trackedPackage.findMany({where:{userId},orderBy:{createdAt:'desc'}});
  const names=[...new Set(tracked.map(item=>item.packageName))];
  const snapshots=names.length?await prisma.packageSnapshot.findMany({where:{packageName:{in:names}},orderBy:{collectedAt:'desc'},take:names.length*2}):[];
  const grouped=new Map<string,typeof snapshots>();
  for(const snapshot of snapshots){const list=grouped.get(snapshot.packageName)??[];list.push(snapshot);grouped.set(snapshot.packageName,list);}
  return tracked.map(item=>({...item,latestSnapshot:grouped.get(item.packageName)?.[0]??null,previousSnapshot:grouped.get(item.packageName)?.[1]??null}));
}
const passwordSchema=z.string().min(10).refine(value=>Buffer.byteLength(value,'utf8')<=72,'Password must be no more than 72 UTF-8 bytes');
const cookieName='pp_session';
const secret=process.env.SESSION_SECRET;
function userFrom(req:express.Request):string|null{
  if(!secret)return null;
  const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`));
  if(!cookie)return null;
  try{return (jwt.verify(decodeURIComponent(cookie.slice(cookieName.length+1)),secret) as jwt.JwtPayload).sub??null;}catch{return null;}
}
function requireUser(req:express.Request,res:express.Response,next:express.NextFunction){const id=userFrom(req);if(!id)return res.status(401).json({error:{code:'UNAUTHENTICATED',message:'Sign in to continue'}});res.locals.userId=id;next();}
function setSession(res:express.Response,userId:string){if(!secret)throw new Error('SESSION_SECRET is not configured');const production=process.env.NODE_ENV==='production';const value=encodeURIComponent(jwt.sign({},secret,{subject:userId,expiresIn:'7d'}));res.setHeader('Set-Cookie',`${cookieName}=${value}; HttpOnly; SameSite=${production?'None':'Lax'}; Path=/; Max-Age=604800${production?'; Secure':''}`);}
function clearSession(res:express.Response){const production=process.env.NODE_ENV==='production';res.setHeader('Set-Cookie',`${cookieName}=; HttpOnly; SameSite=${production?'None':'Lax'}; Path=/; Max-Age=0${production?'; Secure':''}`);}
app.get('/api/health', (_req,res)=>res.json({ data:{status:'ok',service:'packagepulse-api',timestamp:new Date().toISOString()} }));
app.post('/api/auth/signup',asyncRoute(async(req,res)=>{if(!secret)return res.status(503).json({error:{code:'AUTH_UNAVAILABLE',message:'Authentication is not configured'}});const input=z.object({name:z.string().trim().min(1).max(80),email:z.string().trim().email().max(254),password:passwordSchema}).parse(req.body);const passwordHash=await bcrypt.hash(input.password,12);const user=await prisma.user.create({data:{name:input.name,email:input.email.toLowerCase(),passwordHash},select:{id:true,name:true,email:true}});setSession(res,user.id);res.status(201).json({data:{user}});}));
app.post('/api/auth/login',asyncRoute(async(req,res)=>{if(!secret)return res.status(503).json({error:{code:'AUTH_UNAVAILABLE',message:'Authentication is not configured'}});const input=z.object({email:z.string().email().max(254),password:z.string().min(1).refine(value=>Buffer.byteLength(value,'utf8')<=72,'Password must be no more than 72 UTF-8 bytes')}).parse(req.body);const user=await prisma.user.findUnique({where:{email:input.email.toLowerCase()}});if(!user||!await bcrypt.compare(input.password,user.passwordHash))return res.status(401).json({error:{code:'INVALID_CREDENTIALS',message:'Email or password is incorrect'}});setSession(res,user.id);res.json({data:{user:{id:user.id,name:user.name,email:user.email}}});}));
app.post('/api/auth/logout',(_req,res)=>{clearSession(res);res.json({data:{loggedOut:true}})});
app.get('/api/auth/me',requireUser,asyncRoute(async(_req,res)=>{const user=await prisma.user.findUnique({where:{id:res.locals.userId},select:{id:true,name:true,email:true}});res.json({data:{user}});}));
app.get('/api/tracked-packages',requireUser,asyncRoute(async(_req,res)=>{res.json({data:await trackedWithSnapshots(res.locals.userId)});}));
app.post('/api/tracked-packages',requireUser,asyncRoute(async(req,res)=>{const input=z.object({packageName:packageNameSchema}).parse(req.body);const item=await prisma.trackedPackage.upsert({where:{userId_packageName:{userId:res.locals.userId,packageName:input.packageName}},create:{userId:res.locals.userId,packageName:input.packageName},update:{}});res.status(201).json({data:item});}));
app.delete('/api/tracked-packages/:id',requireUser,asyncRoute(async(req,res)=>{const id=z.string().min(1).parse(req.params.id);const removed=await prisma.trackedPackage.deleteMany({where:{id,userId:res.locals.userId}});if(!removed.count)return res.status(404).json({error:{code:'NOT_FOUND',message:'Tracked package not found'}});res.json({data:{deleted:true}});}));
app.patch('/api/tracked-packages/:id/monitoring',requireUser,asyncRoute(async(req,res)=>{const id=z.string().min(1).parse(req.params.id);const {enabled}=z.object({enabled:z.boolean()}).parse(req.body);const changed=await prisma.trackedPackage.updateMany({where:{id,userId:res.locals.userId},data:{monitoringEnabled:enabled,lastError:null}});if(!changed.count)return res.status(404).json({error:{code:'NOT_FOUND',message:'Tracked package not found'}});res.json({data:{id,monitoringEnabled:enabled}});}));
app.get('/api/dashboard',requireUser,asyncRoute(async(_req,res)=>{const tracked=await trackedWithSnapshots(res.locals.userId);res.json({data:{tracked,monitoring:{mode:monitoringMode(),intervalMs:monitorIntervalMs}}});}));
app.get('/api/packages/search', asyncRoute(async(req,res)=>{
  const q=z.string().trim().min(1).max(100).parse(req.query.q);
  const result=await npmSearch(q);
  res.json({data:(result.objects??[]).map((x:any)=>({name:x.package.name,version:x.package.version,description:x.package.description??null,keywords:x.package.keywords??[],date:x.package.date??null,links:x.package.links??{}}))});
}));
app.get('/api/packages/:name', asyncRoute(async(req,res)=>{
  const name=decodedName(req.params.name); const meta=await npmPackage(name); const gh=await githubInfo(repoUrl(meta.repository));
  const latest=meta['dist-tags']?.latest;
  res.json({data:{name,description:meta.description??null,version:latest??null,license:typeof meta.license==='string'?meta.license:meta.license?.type??null,maintainers:meta.maintainers??[],author:meta.author??null,homepage:meta.homepage??null,repository:repoUrl(meta.repository)??null,keywords:meta.keywords??[],publishedAt:latest?meta.time?.[latest]??null:null,versions:Object.keys(meta.versions??{}),github:gh,health:healthScore(meta,gh)}});
}));
app.get('/api/packages/:name/versions', asyncRoute(async(req,res)=>{const meta=await npmPackage(decodedName(req.params.name));res.json({data:{latest:meta['dist-tags']?.latest??null,versions:Object.entries(meta.versions??{}).map(([version,pkg]:[string,any])=>({version,publishedAt:meta.time?.[version]??null,deprecated:pkg.deprecated??null}))}});}));
app.get('/api/packages/:name/security', asyncRoute(async(req,res)=>{const name=decodedName(req.params.name);const version=versionSchema.parse(req.query.version);res.json({data:await osvScan(name,version)});}));
app.get('/api/packages/:name/health', asyncRoute(async(req,res)=>{const name=decodedName(req.params.name);const meta=await npmPackage(name);const gh=await githubInfo(repoUrl(meta.repository));res.json({data:healthScore(meta,gh)});}));
app.post('/api/packages/compare', asyncRoute(async(req,res)=>{const input=z.object({packages:z.array(packageNameSchema).min(2).max(3)}).parse(req.body);const data=await Promise.all(input.packages.map(async name=>{try{const m=await npmPackage(name);const gh=await githubInfo(repoUrl(m.repository));return {name,description:m.description??null,version:m['dist-tags']?.latest??null,license:typeof m.license==='string'?m.license:m.license?.type??null,github:gh,health:healthScore(m,gh)};}catch{return {name,error:'Package data unavailable'};}}));res.json({data});}));
app.use((_req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'Route not found'}}));
app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{const e=err as Error & {status?:number;code?:string};if(e instanceof z.ZodError)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Invalid request',details:e.issues}});if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')return res.status(409).json({error:{code:'CONFLICT',message:'An account with this email already exists'}});if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2025')return res.status(404).json({error:{code:'NOT_FOUND',message:'Record not found'}});if(typeof e.code==='string'&&e.code.startsWith('P'))return res.status(503).json({error:{code:'DATABASE_UNAVAILABLE',message:'Persistent storage is unavailable'}});const upstreamStatus=(e as Error & {status?:number}).status;const status=upstreamStatus===404?404:upstreamStatus===429?503:502;res.status(status).json({error:{code:'UPSTREAM_ERROR',message:status===404?'Package not found':'Package data is temporarily unavailable'}});});
const port=Number(process.env.PORT??4000);app.listen(port,()=>console.log(`PackagePulse API listening on ${port}`));
if(!process.env.REDIS_URL&&process.env.NODE_ENV!=='production'){
  console.info(`Redis is not configured; using the single-process development monitor every ${monitorIntervalMs}ms.`);
  const timer=setInterval(()=>void runDevelopmentMonitorCycle().catch(()=>console.error('Development monitoring cycle failed.')),monitorIntervalMs);
  timer.unref();
}
