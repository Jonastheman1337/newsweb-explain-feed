import test from "node:test";
import assert from "node:assert/strict";
import { createAssignments, summarizeReviews, dimensions } from "./sak-voice-review.mjs";

test("blind assignments are stable, balanced and independent of source order", () => {
  const cases=Array.from({length:12},(_,i)=>({id:"case-"+i}));
  const a=createAssignments(cases,"frozen-seed");
  assert.deepEqual(a,createAssignments([...cases].reverse(),"frozen-seed"));
  assert.equal(a.filter(x=>x.A==="candidate").length,6);
  assert.equal(new Set(a.map(x=>x.opaqueId)).size,12);
  assert.throws(()=>createAssignments([{id:"one"},{id:"one"}],"seed"));
});
function fixture(){
  const assignments=createAssignments(Array.from({length:12},(_,i)=>({id:"case-"+i})),"seed")
    .map(a=>({...a,outputHashA:"ha-"+a.caseId,outputHashB:"hb-"+a.caseId}));
  const mapping={runId:"run",assignmentHash:"assignment",assignments};
  const rows=assignments.map((a,i)=>{
    const winner=i<8?"candidate":"control";
    const choice=a.A===winner?"A":"B";
    return {id:a.opaqueId,outputHashA:a.outputHashA,outputHashB:a.outputHashB,verdict:choice,dimensions:Object.fromEntries(dimensions.map(d=>[d,choice]))};
  });
  return {mapping,reviews:{runId:"run",assignmentHash:"assignment",rows}};
}
test("summary uses the hidden assignment, never a fixed side, and leaves release to review",()=>{
  const {mapping,reviews}=fixture();
  const s=summarizeReviews(mapping,reviews);
  assert.equal(s.wins.candidate,8);assert.equal(s.wins.control,4);
  assert.equal(s.preferenceThresholdMet,true);assert.equal(s.complete,true);
  assert.equal(s.releaseDecision,"pending_editorial_and_source_review");
});
test("missing reviews and undecided comparisons are not counted as candidate wins",()=>{
  const {mapping,reviews}=fixture();
  reviews.rows=reviews.rows.slice(0,2);
  reviews.rows[0].verdict="both_bad";reviews.rows[1].verdict="tie";
  const s=summarizeReviews(mapping,reviews);
  assert.equal(s.complete,false);assert.equal(s.candidatePreference,null);
  assert.equal(s.preferenceThresholdMet,false);
});
test("foreign, duplicate, modified-output and malformed reviews are rejected",()=>{
  for(const mutate of [
    r=>r.runId="other",
    r=>r.rows.push(r.rows[0]),
    r=>r.rows[0].outputHashA="changed",
    r=>r.rows[0].verdict="candidate",
    r=>r.rows[0].dimensions.Klarspråk="unknown"
  ]){
    const {mapping,reviews}=fixture();mutate(reviews);
    assert.throws(()=>summarizeReviews(mapping,reviews));
  }
});
