#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {codexConnector,modelObservation,decisionSchemaFor} from '../bridge/connectors/codex.js';
import {decisionTimeout} from '../bridge/options.js';
import {createNegotiationScenarios,evaluateNegotiationDecision} from '../bridge/fixtures/negotiation-scenarios.js';

const {values} = parseArgs({options:{
  live:{type:'boolean',default:false},model:{type:'string',default:'gpt-5.6-luna'},
  reasoning:{type:'string',default:'max'},repeat:{type:'string',default:'1'},
  scenarios:{type:'string'},'max-calls':{type:'string',default:'8'},
  'timeout-ms':{type:'string',default:'300000'},output:{type:'string'},
}});
const repeat=Number(values.repeat),maxCalls=Number(values['max-calls']);
if(!Number.isInteger(repeat)||repeat<1||repeat>3||!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>24)
  throw Error('Use repeat 1–3 and max-calls 1–24');
const timeoutMs=decisionTimeout(values['timeout-ms']);
const selection=values.scenarios?.split(',');
const catalogue=createNegotiationScenarios();
if(selection?.some(id=>!catalogue.some(s=>s.id===id)))throw Error('Unknown scenario ID');
const ids=catalogue.filter(s=>!selection||selection.includes(s.id)).map(s=>s.id);
if(ids.length*repeat>maxCalls)throw Error('Selected scenarios exceed max-calls; narrow selection or explicitly raise the cap');
const output=resolve(values.output||`data/negotiation-benchmark-${Date.now()}.json`);
const report={version:1,startedAt:new Date().toISOString(),live:values.live,
  model:values.model,reasoning:values.reasoning,repeat,maxCalls,timeoutMs,
  notes:['Synthetic private observations; fresh model context per case.',
    'Helpfulness is sampled behavior, not proof of universal strategic quality.',
    'Hard server gates are verified by deterministic tests, separately from these model judgments.',
    'No prompts, private strategic memory, context IDs or model transcripts are included.'],results:[]};
report.sources=Object.fromEntries(await Promise.all(['bridge/connectors/codex.js','bridge/negotiation-policy.js',
  'bridge/runner.js','bridge/fixtures/negotiation-scenarios.js','server/negotiation.js'].map(async path=>
  [path,createHash('sha256').update(await readFile(new URL(`../${path}`,import.meta.url))).digest('hex')])));
const persist=async()=>{await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});};
if(values.live)await codexConnector.ready();
for(let round=0;round<repeat;round++)for(const id of ids){
  const scenario=createNegotiationScenarios().find(item=>item.id===id);
  const projected=modelObservation(scenario.view);
  const started=Date.now();
  let row={scenario:id,round:round+1,description:scenario.description};
  if(!values.live)row={...row,dryRun:true,negotiationAvailable:decisionSchemaFor(scenario.view).properties.negotiation.type!=='null',
    relevantIncoming:projected.negotiations?.length||0,expected:scenario.expected};
  else try{
    const decision=await codexConnector.decide(scenario.view,{model:values.model,reasoning:values.reasoning,timeoutMs,
      memory:'',contextId:null,lastOutcome:null});
    const assessment=evaluateNegotiationDecision(scenario,decision);
    row={...row,latencyMs:Date.now()-started,passed:assessment.passed,checks:assessment.checks,
      action:decision.action,negotiation:decision.negotiation,publicReply:decision.publicReply,usage:decision.usage};
  }catch(error){row={...row,latencyMs:Date.now()-started,passed:false,error:error.message};}
  report.results.push(row);await persist();
  console.log(JSON.stringify({scenario:id,round:round+1,passed:row.passed,dryRun:row.dryRun,
    latencyMs:row.latencyMs,action:row.action?.type,negotiation:row.negotiation?.kind,error:row.error}));
}
report.finishedAt=new Date().toISOString();
report.summary={cases:report.results.length,passed:report.results.filter(r=>r.passed===true).length,
  failed:report.results.filter(r=>r.passed===false).length,
  proactiveInterests:report.results.filter(r=>r.negotiation?.kind==='interest'&&!r.negotiation.replyToId).length,
  realTrades:report.results.filter(r=>r.action?.type?.startsWith('trade')).length};
await persist();console.log(JSON.stringify({output,summary:report.summary}));
if(values.live&&report.summary.failed)process.exitCode=1;
