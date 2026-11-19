const $ = id => document.getElementById(id);
let currentMode='text', latestResult=null, selectedImage=null, lang='en';
const translations={
 en:{welcome:'YOUR INFORMATION COMPANION',hello:'Hello',welcomeSub:"Let's make the internet a little clearer, one check at a time."},
 hi:{welcome:'आपका जानकारी साथी',hello:'नमस्ते',welcomeSub:'आइए, हर जाँच के साथ इंटरनेट को थोड़ा और स्पष्ट बनाएं।'},
 mr:{welcome:'तुमचा माहितीचा साथीदार',hello:'नमस्कार',welcomeSub:'चला, प्रत्येक तपासणीने इंटरनेट अधिक स्पष्ट बनवूया.'}
};
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500)}
function showSignup(){$('loginForm').classList.add('hidden');$('signupForm').classList.remove('hidden')}
function showLogin(){$('signupForm').classList.add('hidden');$('loginForm').classList.remove('hidden')}
function login(){const email=$('loginEmail').value.trim(),pw=$('loginPassword').value;if(!email.includes('@')||pw.length<3)return toast('Enter a valid email and password (3+ characters).');const saved=JSON.parse(localStorage.getItem('tlUser')||'null');const name=saved&&saved.email===email?saved.name:email.split('@')[0];startApp({name,email})}
function signup(){const name=$('signupName').value.trim(),email=$('signupEmail').value.trim(),pw=$('signupPassword').value;if(!name||!email.includes('@')||pw.length<3)return toast('Please complete all fields with a valid email and password.');localStorage.setItem('tlUser',JSON.stringify({name,email}));toast('Account created on this device.');startApp({name,email})}
function startApp(user){localStorage.setItem('tlSession',JSON.stringify(user));$('authView').classList.add('hidden');$('appView').classList.remove('hidden');$('userName').textContent=user.name;$('userEmail').textContent=user.email;$('helloName').textContent=user.name.split(' ')[0];$('userAvatar').textContent=user.name[0].toUpperCase();$('topAvatar').textContent=user.name[0].toUpperCase();$('todayDate').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});renderHistory();navigate('home')}
function logout(){localStorage.removeItem('tlSession');$('appView').classList.add('hidden');$('authView').classList.remove('hidden');showLogin()}
function navigate(page){document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));$('page-'+page).classList.remove('hidden');document.querySelectorAll('.nav-link').forEach(n=>n.classList.toggle('active',n.dataset.page===page));const names={home:'Overview',verify:'Verify content',history:'My history',assistant:'Ask TruthLens'};$('crumb').textContent=names[page];$('sidebar').classList.remove('open');if(page==='history')renderHistory()}
function toggleSidebar(){$('sidebar').classList.toggle('open')}
function toggleTheme(){document.body.classList.toggle('dark');localStorage.setItem('tlDark',document.body.classList.contains('dark')?'1':'0')}
if(localStorage.getItem('tlDark')==='1')document.body.classList.add('dark');
function setInputMode(mode){currentMode=mode;document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.mode===mode));['text','image','link','social'].forEach(m=>$(m+'Input').classList.toggle('hidden',m!==mode));$('resultPanel').classList.add('hidden')}
function previewImage(e){const f=e.target.files[0];if(!f)return;if(f.size>5*1024*1024){toast('Please choose an image smaller than 5 MB.');e.target.value='';return}selectedImage=f;const img=$('imagePreview');img.src=URL.createObjectURL(f);img.classList.remove('hidden')}
$('newsText').addEventListener('input',()=>$('charCount').textContent=$('newsText').value.length+' characters');
// Where the backend lives. Priority: config.js (production) > local-dev guess > same origin.
const API_BASE = (() => {
  const cfg = (window.TRUTHLENS_API_BASE || '').trim().replace(/\/+$/, '');
  if (cfg) return cfg;
  const local = ['localhost', '127.0.0.1', ''].includes(location.hostname);
  if (location.protocol === 'file:' || (local && location.port !== '8000')) return 'http://localhost:8000'; // Live Server etc.
  return ''; // served by the backend itself (http://localhost:8000)
})();
if (API_BASE) fetch(API_BASE + '/api/health').catch(() => {}); // wake a sleeping free-tier server early
const VERDICT_STYLE = {'True':['#3aa676','✓'],'Mostly True':['#6bb04f','✓'],'Misleading':['#e0ad59','!'],'False':['#d9534f','✕'],'Unverified':['#8591a4','?']};
async function apiPost(path, body, isForm){
 const opt = {method:'POST'};
 if(isForm){opt.body = body}else{opt.headers = {'Content-Type':'application/json'};opt.body = JSON.stringify(body)}
 let res;
 const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 150000);
 opt.signal = ctl.signal;
 try{res = await fetch(API_BASE + path, opt)}
 catch(e){throw new Error(e.name === 'AbortError' ? 'The server took too long to answer. Please try again.' : 'Cannot reach the TruthLens server. If it was idle, wait ~1 minute for it to wake up and retry.')}
 finally{clearTimeout(timer)}
 const data = await res.json().catch(()=>({}));
 if(!res.ok){const d = data.detail; throw new Error(typeof d === 'string' ? d : 'Something went wrong (' + res.status + ').')}
 return data;
}
async function runVerification(){
 let content = '', kind = currentMode, call;
 if(kind==='text'){content = $('newsText').value.trim();if(content.length<15)return toast('Please enter a little more content to review.');call = () => apiPost('/api/verify/text',{text:content,lang})}
 if(kind==='link'){content = $('newsLink').value.trim();if(!/^https?:\/\//i.test(content))return toast('Please enter a complete link starting with https://');call = () => apiPost('/api/verify/link',{url:content,lang})}
 if(kind==='social'){content = $('socialLink').value.trim();const cap = $('socialCaption').value.trim();if(!/^https?:\/\//i.test(content))return toast('Please paste a complete post or Reel link starting with https://');call = () => apiPost('/api/verify/social',{url:content,caption:cap,lang})}
 if(kind==='image'){if(!selectedImage)return toast('Please choose an image first.');content = selectedImage.name;const fd = new FormData();fd.append('file',selectedImage);fd.append('lang',lang);call = () => apiPost('/api/verify/image',fd,true)}
 const btn = $('verifyBtn'), original = btn.innerHTML;
 btn.disabled = true;btn.innerHTML = 'Checking… this can take up to a minute';
 try{
  const r = await call();
  latestResult = {content,kind,score:r.confidence,status:r.verdict,summary:r.summary,claims:r.claims||[],flags:r.red_flags||[],sources:r.sources||[],advice:r.advice||[],extracted:r.extracted||null,date:new Date().toLocaleString(),title:(r.extracted&&r.extracted.title)||content.slice(0,90)};
  showResult(latestResult);
  const history = JSON.parse(localStorage.getItem('tlHistory')||'[]');history.unshift(latestResult);
  try{localStorage.setItem('tlHistory',JSON.stringify(history.slice(0,30)))}catch(e){}
  renderHistory();toast('Your review is ready.');
 }catch(err){toast(err.message);alert(err.message)}
 finally{btn.disabled = false;btn.innerHTML = original}
}
function fillList(id, boxId, items, build){const ul = $(id);ul.innerHTML = '';items.forEach(i => ul.appendChild(build(i)));$(boxId).classList.toggle('hidden', !items.length)}
function showResult(r){
 const [color, icon] = VERDICT_STYLE[r.status] || VERDICT_STYLE['Unverified'];
 $('resultTitle').textContent = r.status;$('resultSubtitle').textContent = 'AI-assisted review, not an official ruling.';
 $('resultScore').textContent = r.score + '/100';$('resultStatus').textContent = icon;
 $('resultStatus').style.cssText = 'background:' + color + '22;color:' + color;
 $('meterFill').style.cssText = 'width:' + r.score + '%;background:' + color;
 $('resultSummary').textContent = r.summary || '';
 const ex = r.extracted;$('extractBox').classList.toggle('hidden', !ex);
 if(ex){$('resultExtract').textContent = (ex.platform ? ex.platform + (ex.uploader ? ' · ' + ex.uploader : '') + (ex.has_transcript ? ' · transcript found' : '') + '\n\n' : '') + (ex.preview || '')}
 const cl = $('resultClaims');cl.innerHTML = '';
 r.claims.forEach(c => {const d = document.createElement('div');d.className = 'claim-item';const b = document.createElement('b');b.textContent = c.claim;const pill = document.createElement('span');pill.className = 'claim-pill v-' + c.verdict.toLowerCase().replace(/\s+/g,'-');pill.textContent = c.verdict;const p = document.createElement('p');p.textContent = c.explanation;d.append(b,pill,p);cl.appendChild(d)});
 $('claimsBox').classList.toggle('hidden', !r.claims.length);
 fillList('resultFlags','flagsBox', r.flags, t => {const li = document.createElement('li');li.textContent = t;return li});
 fillList('resultSources','sourcesBox', r.sources, s => {const li = document.createElement('li');const a = document.createElement('a');a.href = s.url;a.target = '_blank';a.rel = 'noopener noreferrer';a.textContent = s.title;li.appendChild(a);return li});
 $('resultAdvice').innerHTML = (r.advice||[]).map(x => '<li>' + escapeHtml(x) + '</li>').join('');
 $('resultPanel').classList.remove('hidden');$('resultPanel').scrollIntoView({behavior:'smooth',block:'start'});
}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function downloadReport(){if(!latestResult)return toast('Complete a review first.');const r = latestResult;const w = window.open('','_blank');if(!w)return toast('Please allow pop-ups to create your PDF report.');
 const li = a => a.map(x => '<li>' + escapeHtml(x) + '</li>').join('');
 const claims = (r.claims||[]).map(c => '<li><b>' + escapeHtml(c.claim) + '</b> — <i>' + escapeHtml(c.verdict) + '</i><br>' + escapeHtml(c.explanation) + '</li>').join('');
 const sources = (r.sources||[]).filter(s => /^https?:\/\//.test(s.url)).map(s => '<li>' + escapeHtml(s.title) + '<br><small>' + escapeHtml(s.url) + '</small></li>').join('');
 w.document.write(`<!doctype html><html><head><title>TruthLens AI Report</title><style>body{font:14px Arial;color:#1c2942;padding:40px;max-width:750px;margin:auto}h1{color:#3556b7}small{color:#78849a}.tag{background:#eef2ff;padding:8px 12px;border-radius:20px;display:inline-block;font-weight:700}li{margin:12px 0;line-height:1.5}.content{background:#f5f7fb;padding:18px;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere}.foot{margin-top:40px;border-top:1px solid #ddd;padding-top:15px;color:#78849a;font-size:11px}@media print{button{display:none}}</style></head><body><h1>✳ TruthLens AI</h1><small>VERIFY BEFORE YOU SHARE · VERIFICATION REVIEW REPORT</small><hr><p><b>Assessment</b></p><span class="tag">${escapeHtml(r.status)}</span><p><b>Confidence:</b> ${r.score}/100</p><p><b>Content type:</b> ${escapeHtml(r.kind)}</p><p><b>Date:</b> ${escapeHtml(r.date)}</p><p>${escapeHtml(r.summary||'')}</p><h3>Submitted content</h3><div class="content">${escapeHtml(r.content)}</div>${claims?'<h3>Claims checked</h3><ul>'+claims+'</ul>':''}${(r.flags||[]).length?'<h3>Warning signs</h3><ul>'+li(r.flags)+'</ul>':''}${sources?'<h3>Sources</h3><ul>'+sources+'</ul>':''}<h3>Suggested next steps</h3><ul>${li(r.advice||[])}</ul><p class="foot">Important: This report was produced by an AI-assisted tool and may contain mistakes. It is not an official fact-check. Confirm important claims with reliable sources.</p><button onclick="window.print()">Print / Save as PDF</button><script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`);w.document.close()}
function kindIcon(k){return k==='image'?'▧':k==='link'?'↗':k==='social'?'▶':'▤'}
function renderHistory(){const arr=JSON.parse(localStorage.getItem('tlHistory')||'[]');const html=arr.map((r,i)=>`<div class="history-item"><div class="recent-symbol">${kindIcon(r.kind)}</div><div class="recent-detail"><b>${escapeHtml(r.title||r.content)}</b><small>${r.kind.toUpperCase()} · ${escapeHtml(r.date)}</small></div><span class="status-pill">${escapeHtml(r.status)}</span></div>`).join('');$('historyList').innerHTML=html||'<div class="history-empty">No checks yet. Your reviewed items will appear here.</div>';$('recentList').innerHTML=arr.slice(0,3).map(r=>`<div class="recent-item"><div class="recent-symbol">${kindIcon(r.kind)}</div><div class="recent-detail"><b>${escapeHtml(r.title||r.content)}</b><small>${escapeHtml(r.date)}</small></div><span class="status-pill">${escapeHtml(r.status)}</span></div>`).join('')||'<div class="empty-small">Your recent checks will appear here.</div>'}
function clearHistory(){if(confirm('Clear all saved review history from this browser?')){localStorage.removeItem('tlHistory');renderHistory();toast('History cleared.')}}
function setLanguage(v){lang=v;const t=translations[v];document.querySelectorAll('[data-i18n]').forEach(el=>{const k=el.dataset.i18n;if(t[k])el.textContent=t[k]});toast(v==='en'?'Language: English':v==='hi'?'भाषा: हिन्दी':'भाषा: मराठी');}
function addMessage(text,who){const div=document.createElement('div');div.className='chat-message '+who;const bubble=document.createElement('div');bubble.className='chat-bubble';bubble.textContent=text;div.appendChild(bubble);$('chatMessages').appendChild(div);$('chatMessages').scrollTop=$('chatMessages').scrollHeight}
function botReply(q){const s=q.toLowerCase();if(s.includes('fake')||s.includes('mislead'))return 'Look for emotional or urgent wording, check the original source, verify the date, and see whether multiple trustworthy news organisations report the same facts. A single clue is not proof that a story is fake.';if(s.includes('source')||s.includes('reliable'))return 'A reliable source usually identifies its author, provides evidence and links to original information, corrects mistakes, and has a clear editorial process. Cross-check important claims with independent sources.';if(s.includes('share')||s.includes('forward'))return 'Before sharing: pause, read the full story, check the date and source, search for independent confirmation, and avoid forwarding if you are unsure.';if(s.includes('score')||s.includes('result')||s.includes('percentage'))return 'The number shows how strong the evidence found was for the verdict. It is not a guarantee, so always check the listed sources yourself.';if(s.includes('image')||s.includes('photo'))return 'For an image, try reverse image search, check where it first appeared, inspect its date and context, and compare it with trusted reporting. TruthLens reads text in images but does not perform image forensics.';if(s.includes('language')||s.includes('marathi')||s.includes('hindi'))return 'Use the language selector in the top-right corner to switch the main interface between English, Hindi and Marathi. This starter version translates key dashboard text; full multilingual content needs more translation work.';return 'A good first step is to check who published the information, when it was published, and what evidence supports it. Compare it with more than one reliable source. Remember, this demo assistant provides general guidance, not a live fact-check.'}
let chatHistory = [];
async function sendChat(e){e.preventDefault();const input = $('chatInput'), q = input.value.trim();if(!q)return;addMessage(q,'user');input.value = '';
 let reply;
 try{const d = await apiPost('/api/chat',{message:q,history:chatHistory});reply = d.reply}catch(err){reply = botReply(q) + ' (Offline guidance: ' + err.message + ')'}
 chatHistory.push({role:'user',content:q},{role:'assistant',content:reply});addMessage(reply,'bot')}
function quickAsk(q){$('chatInput').value=q;$('chatInput').focus()}
function clearChat(){chatHistory = [];$('chatMessages').innerHTML='';addMessage("Hi again! What would you like help checking?",'bot')}
window.addEventListener('DOMContentLoaded',()=>{const session=JSON.parse(localStorage.getItem('tlSession')||'null');if(session)startApp(session);});
