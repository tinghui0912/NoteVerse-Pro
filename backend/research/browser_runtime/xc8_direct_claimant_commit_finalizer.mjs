import {DirectConflictReservationFinalizer} from './xc2_r2_direct_conflict_finalizer.mjs';
import {minimumCostPairs} from './xc2_r1_bounded_finalizer.mjs';
import {digest} from './xc1_artifacts.mjs';

export const XC8_POLICY=Object.freeze({name:'DIRECT_CLAIMANT_COMMIT_RESERVATION',wMs:250,
  maximumFrozenGroupSpreadMs:20,strikeBoundMs:750,groupBoundMs:1250,extraBoundMs:1500,
  classification:'FIXED_DIRECT_CLAIMANT_OWN_COMMIT_NOT_RECURSIVE_COHORT_EXPANSION',
  correctAssignment:'UNCHANGED_R2_ANCHOR_ONLY_ONE_HOP_MAX_CARDINALITY_MIN_ABSOLUTE_ERROR_STABLE_IDS',
  wrong:'WAIT_LITERAL_CORRECT_CLAIMANT_OWN_FIXED_H_COMMIT_THEN_USE_ONLY_UNOWNED_RELEASED_EVIDENCE',
  finality:'IMMUTABLE_SINGLE_OWNER_NO_RETROACTIVE_REPAIR',freshness:'POST_XC2_DIAGNOSTIC_ONLY_NOT_FRESH_EVALUATION'});
const byId=(a,b)=>a.id.localeCompare(b.id);
const byTime=(a,b)=>a.time-b.time||byId(a,b);
const within=(a,b,w=250)=>Math.abs(a-b)<=w;
const immutable=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))immutable(x);Object.freeze(v);}return v;};

/** Research only. Does not modify or instantiate the production ledger. */
export class DirectClaimantCommitFinalizer extends DirectConflictReservationFinalizer {
  constructor(strikes){
    super(strikes);
    for(const g of this.groups.values())if(Math.max(...g.strikes.map(s=>s.time))-g.time>20+1e-8)throw new Error('XC8_GROUP_SPREAD_OUTSIDE_FROZEN_CONTRACT');
    this.publicationDigests=new Map();this.closedScope=null;this.sessionFailure=null;
  }
  publish(publication){
    if(this.sessionFailure)throw this.sessionFailure;
    const pub={...publication,observations:publication.observations.map(o=>({...o})).sort((a,b)=>a.observationId.localeCompare(b.observationId))};
    const d=digest(pub),old=this.publicationDigests.get(pub.publicationId);
    if(old){if(old!==d)throw new Error('XC8_PUBLICATION_ID_MUTATION');return this.snapshot();}
    if(this.closedScope)throw new Error('XC8_PUBLICATION_AFTER_TERMINAL');
    if(typeof pub.publicationId!=='string'||!pub.publicationId)throw new Error('XC8_PUBLICATION_ID_REQUIRED');
    try{const r=super.publish(pub);this.publicationDigests.set(pub.publicationId,d);return r;}
    catch(error){this.sessionFailure=error;throw error;}
  }
  groupHorizon(g){
    const local=[...this.observations.values()].filter(o=>!g.pitches.has(o.pitch)&&within(o.time,g.time));
    const ids=[...new Set(local.flatMap(o=>this.directCorrectClaimants(o).map(s=>s.id)))].sort();
    const claimants=this.strikes.filter(s=>ids.includes(s.id));
    // H(s) is the fixed R2 literal-cohort LOCAL window-coverage formula. Never
    // query a cohort member's H, commit status, or its group's completion.
    const required=Math.max(g.deadline,...g.strikes.map(s=>s.directRequiredFrontierMs),...claimants.map(s=>s.directRequiredFrontierMs));
    if(required>g.time+1250+1e-8)throw new Error('FAIL_PHASE_TRANSITIVE_FINALIZATION_REINTRODUCED');
    return{required,localIncompatibleObservationIds:local.map(o=>o.id).sort(),directCorrectClaimantIds:ids,
      directClaimantFixedCommits:claimants.map(s=>({strikeId:s.id,requiredFrontierMs:s.directRequiredFrontierMs}))};
  }
  commit(){
    // Identical anchor-only strike assignment to R2. Participation in a cohort
    // is provisional; only the eligible anchor becomes a semantic owner.
    const eligible=this.strikes.filter(s=>s.verdict==='PENDING'&&Math.min(s.directRequiredFrontierMs,this.terminal)<=this.frontier).sort(byTime);
    for(const anchor of eligible){
      const cohort=this.strikes.filter(s=>s.verdict==='PENDING'&&anchor.directCohortIds.includes(s.id)).sort(byId);
      const observations=this.residual().filter(o=>cohort.some(s=>o.pitch===s.pitch&&within(s.time,o.time))).sort(byId);
      const proposal=minimumCostPairs(cohort,observations,(s,o)=>within(s.time,o.time)?Math.abs(s.time-o.time):Infinity)
        .map(([i,j])=>({strikeId:cohort[i].id,observationId:observations[j].id}));
      const assigned=proposal.find(p=>p.strikeId===anchor.id);
      this.cohortSolves.push({anchorStrikeId:anchor.id,oneHopCohortIds:anchor.directCohortIds,optimizationPendingCohortIds:cohort.map(s=>s.id),
        requiredFrontierMs:Math.min(anchor.directRequiredFrontierMs,this.terminal),publicationId:this.pub.publicationId,
        provisionalProposalOnly:proposal,committedStrikeIds:[anchor.id]});
      if(assigned){const o=this.observations.get(assigned.observationId);this.claim(o.id,'MATCHED',anchor.id);
        anchor.verdict='MATCHED';anchor.matchedObservationId=o.id;anchor.timingOffsetMs=o.time-anchor.time;
      }else anchor.verdict=this.manual&&anchor.time+250>this.terminal?'NOT_REACHED':'MISSING';
      this.strikeWitnesses.push({strikeId:anchor.id,pitch:anchor.pitch,targetTimeMs:anchor.time,localDeadlineMs:anchor.time+250,
        requiredFrontierMs:Math.min(anchor.directRequiredFrontierMs,this.terminal),unclampedRequiredFrontierMs:anchor.directRequiredFrontierMs,
        oneHopCohortIds:anchor.directCohortIds,enablingPublicationId:this.pub.publicationId,enablingFrontierMs:this.frontier,
        availabilityTimeMs:this.availability,verdict:anchor.verdict,matchedObservationId:assigned?.observationId??null,
        terminalClamp:anchor.directRequiredFrontierMs>this.terminal});
    }
    this.updateReservations();
    const reserved=new Set(this.provisionalReservations.map(r=>r.observationId)),ready=[];
    for(const g of [...this.groups.values()].sort(byTime)){
      if(g.final||g.strikes.some(s=>s.verdict==='PENDING'))continue;
      if(g.strikes.some(s=>s.verdict==='NOT_REACHED')){g.final=true;continue;}
      const matched=g.strikes.filter(s=>s.verdict==='MATCHED').map(s=>s.matchedObservationId);
      if(matched.length===g.strikes.length){
        const h=Math.max(...g.strikes.map(s=>s.directRequiredFrontierMs));
        this.finish(g.id,g.id,'CORRECT',g.time,g.deadline,Math.min(h,this.terminal),matched,'OWN_STRIKES_IRREVERSIBLY_COMMITTED');
        const v=this.verdicts.at(-1);v.witness.unclampedRequiredFrontierMs=h;v.witness.terminalClamp=h>this.terminal;g.final=true;
      }else{
        const h=this.groupHorizon(g);
        if(this.frontier>=Math.min(h.required,this.terminal)){
          if(this.strikes.some(s=>h.directCorrectClaimantIds.includes(s.id)&&s.verdict==='PENDING'))throw new Error('XC8_DIRECT_CLAIMANT_NOT_RESOLVED_AT_FIXED_H');
          ready.push({...g,horizon:h});
        }
      }
    }
    const slots=ready.flatMap(g=>g.strikes.filter(s=>s.verdict==='MISSING').map(s=>({...g,slotId:s.id}))).sort((a,b)=>a.slotId.localeCompare(b.slotId));
    const residual=this.residual().filter(o=>!reserved.has(o.id)).sort(byId),wrong=new Map();
    for(const [i,j]of minimumCostPairs(slots,residual,(g,o)=>!g.pitches.has(o.pitch)&&within(g.time,o.time)?Math.abs(g.time-o.time):Infinity)){
      const g=slots[i],o=residual[j];
      if(this.directCorrectClaimants(o).some(s=>s.verdict==='PENDING'))throw new Error('XC8_WRONG_PREEMPTS_DIRECT_CORRECT_OWNER');
      if(!wrong.has(g.id))wrong.set(g.id,[]);wrong.get(g.id).push(o.id);this.claim(o.id,'WRONG',g.id);
    }
    for(const g of ready){
      const matched=g.strikes.filter(s=>s.verdict==='MATCHED').map(s=>s.matchedObservationId),incompatible=wrong.get(g.id)??[];
      this.finish(g.id,g.id,incompatible.length?'WRONG':matched.length?'INCOMPLETE_CHORD':'MISSING',g.time,g.deadline,
        Math.min(g.horizon.required,this.terminal),[...matched,...incompatible],'ALL_LITERAL_DIRECT_CORRECT_CLAIMANT_COMMITS_RESOLVED');
      const v=this.verdicts.at(-1);v.witness.directConflict=g.horizon;v.witness.unclampedRequiredFrontierMs=g.horizon.required;
      v.witness.terminalClamp=g.horizon.required>this.terminal;
      v.witness.directClaimantResolutions=g.horizon.directCorrectClaimantIds.map(id=>this.strikeWitnesses.find(s=>s.strikeId===id));
      v.witness.reservedLocalEvidenceNotConsumed=[];this.groups.get(g.id).final=true;
    }
    for(const o of this.residual().sort(byId)){
      const correct=this.directCorrectClaimants(o),groups=[...this.groups.values()].filter(g=>!g.pitches.has(o.pitch)&&within(g.time,o.time));
      const horizons=groups.map(g=>({groupId:g.id,...this.groupHorizon(g)}));
      const unclamped=Math.max(o.time,...correct.map(s=>s.directRequiredFrontierMs),...horizons.map(g=>g.required));
      const required=Math.min(unclamped,this.terminal);
      if(this.frontier<required||correct.some(s=>s.verdict==='PENDING')||groups.some(g=>!g.final))continue;
      if(unclamped>o.time+1500+1e-8)throw new Error('FAIL_PHASE_TRANSITIVE_FINALIZATION_REINTRODUCED');
      this.claim(o.id,'EXTRA',o.id);this.finish(o.id,undefined,'EXTRA',o.time,required,required,[o.id],'ALL_LITERAL_CORRECT_AND_LOCAL_WRONG_CLAIMS_RESOLVED');
      const v=this.verdicts.at(-1);v.witness.unclampedRequiredFrontierMs=unclamped;v.witness.terminalClamp=unclamped>this.terminal;
      v.witness.directExtraClaimants={correctStrikeIds:correct.map(s=>s.id),wrongGroups:horizons,boundFromObservationMs:1500};
    }
    this.updateReservations();
  }
  finish(...args){super.finish(...args);this.verdicts.at(-1).witness.policy=XC8_POLICY.name;}
  completeNaturalScope(frontier,availability){return this.completeScope(false,frontier,availability);}
  completeManualScope(frontier,availability){return this.completeScope(true,frontier,availability);}
  completeScope(manual,frontier,availability){
    const identity={manual,frontier,availability};
    if(this.closedScope){if(digest(identity)!==digest(this.closedScope))throw new Error('XC8_TERMINAL_IDENTITY_MUTATION');return this.snapshot();}
    if(!Number.isFinite(frontier)||frontier<this.frontier||!Number.isFinite(availability)||availability<this.availability)throw new Error('XC8_TERMINAL_FRONTIER');
    this.terminal=frontier;this.manual=manual;
    this.publish({publicationId:manual?'xc8:manual-completion':'xc8:natural-completion',analyzedThroughPerformanceMs:frontier,availabilityTimeMs:availability,observations:[]});
    if(this.provisionalReservations.length||this.strikes.some(s=>s.verdict==='PENDING')||this.residual().length)throw new Error('XC8_TERMINAL_RESERVATION_NOT_CLOSED');
    this.closedScope=identity;return this.snapshot();
  }
  snapshot(){return immutable(structuredClone({...super.snapshot(),completion:this.closedScope??null}));}
}
