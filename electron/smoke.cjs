// Runs against an isolated project-local profile; no personal learning data is touched.
module.exports = async function smoke(win) {
  const result = await win.webContents.executeJavaScript(`(async()=>{
 const assert=(ok,message)=>{if(!ok)throw new Error(message)};
 const wait=()=>new Promise(r=>setTimeout(r,180));
 assert(document.title==='Verbatim','window title');
 assert(document.body.innerText.includes('Your next little breakthrough.'),'library rendered');
 assert(typeof window.require==='undefined','Node is isolated');
 assert(!!window.verbatim,'preload bridge');
 const now=new Date().toISOString();
 await window.verbatim.call('put',{table:'videos',record:{id:'dQw4w9WgXcQ',url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ',title:'Smoke test'}});
 const analysis={meaning:'To postpone.',contextMeaning:'The meeting will happen later.',partOfSpeech:'phrasal verb',tense:'Past simple',baseForm:'put off',isPhrasalVerb:true,grammarNotes:'Separable.',examples:['We put off the trip.'],tags:['phrasal verb']};
 await window.verbatim.call('put',{table:'entries',record:{id:'smoke',videoId:'dQw4w9WgXcQ',timestampMs:0,sentence:'They put off the meeting.',selection:'put off',definition:'To postpone.',analysis,tags:['phrasal verb'],status:'new',createdAt:now,updatedAt:now}});
 assert((await window.verbatim.call('list',{table:'entries'}))[0].analysis.isPhrasalVerb,'SQLite IPC roundtrip');
 const navigate=async(label)=>{const b=[...document.querySelectorAll('nav button,.sidebar-bottom button')].find(b=>b.textContent.includes(label));assert(b,'navigation '+label);b.click();await wait();window.dispatchEvent(new Event('verbatim:changed'));await wait()};
 await navigate('My notebook');assert(document.body.innerText.includes('The meeting will happen later.'),'context meaning shown');
 const grammar=document.querySelector('[aria-label="Filter by tag"]');assert([...grammar.options].some(o=>o.value==='phrasal verb'),'grammar filter');
 await window.verbatim.call('put',{table:'sessions',record:{id:'exercise-test',createdAt:now,topic:'Practice smoke',questions:[{type:'multiple-choice',prompt:'What does put off mean?',options:['postpone','start','finish','walk'],answer:'postpone',explanation:'It means postpone.'}],answers:[],completed:false,score:0}});
 await navigate('Exercises');assert(document.body.innerText.includes('Fill in the blank'),'exercise type selector');assert(document.body.innerText.includes('Multiple choice'),'multiple choice selector');
 const history=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Practice smoke'));assert(history,'exercise history');history.click();await wait();document.querySelector('input[type=radio]').click();await wait();[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Check answers')).click();await wait();assert(document.body.innerText.includes('1 / 1 correct'),'exercise grading');assert((await window.verbatim.call('list',{table:'sessions'}))[0].completed,'exercise result persisted');
 await navigate('Flashcards');assert(document.body.innerText.includes('put off'),'flashcard front');[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Reveal meaning')).click();await wait();assert(document.body.innerText.includes('The meeting will happen later.'),'flashcard meaning');
 const backup=await window.verbatim.call('backup');assert(backup.entries.length===1&&!JSON.stringify(backup).includes('api-key'),'backup content');
 await window.verbatim.call('import',backup);
 let rejected=false;try{await window.verbatim.call('import',{...backup,entries:[{}]})}catch{rejected=true}assert(rejected,'invalid import rejected');
 assert((await window.verbatim.call('list',{table:'entries'})).length===1,'invalid import leaves data intact');
 await navigate('Settings & data');assert(document.body.innerText.includes('Gemini 2.5 Flash-Lite'),'settings');
 return 'PASS: packaged renderer, sandbox, SQLite IPC, contextual meaning, grammar filter, exercises, flashcards and atomic backup validation';
 })()`);
  const fs = require("node:fs");
  const path = require("node:path");
  const screenshot = await win.webContents.capturePage();
  fs.writeFileSync(
    path.join(__dirname, "..", ".cache", "desktop-smoke.png"),
    screenshot.toPNG(),
  );
  console.log(result);
};
