/**
 * The booking card ChatGPT shows for `request_service` (an MCP Apps view, served by server/lib/mcp.ts).
 *
 * It speaks the MCP Apps bridge by hand (JSON-RPC over postMessage: ui/initialize, tools/call,
 * ui/notifications/*), loads nothing from the network so the default CSP holds, and uses the
 * site's brand (tailwind.config.js: forest and amber, amber always with forest-900 text).
 *
 * It ends in a BOOKING WITHOUT PAYMENT (book_start_day), never a checkout link: ChatGPT plugins may
 * not sell a service (see mcp.ts). "Have Scoop Dogg contact me" sends a lead instead.
 * No price or phone number is written here; every figure arrives in the tool result.
 *
 * The script avoids `${}` and backticks so this file can hold it in one template literal.
 */
export const WIDGET_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{--forest:#1B4332;--forest-900:#0F2A1F;--forest-100:#E8F0EB;--forest-300:#95B8A2;--amber:#F4A024;--amber-hover:#E8911A}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--forest-900);background:transparent}
.card{border:1px solid var(--forest-300);border-radius:4px;overflow:hidden;background:#fff}
.head{background:var(--forest);color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.head b{font-family:Georgia,"DM Serif Display",serif;font-size:18px;font-weight:400}.head a{color:#fff;font-size:13px}
.body{padding:14px 16px;display:grid;gap:12px}label,.lab{font-size:13px;font-weight:600;display:block;margin-bottom:4px}
input,textarea{width:100%;padding:8px 10px;border:1px solid var(--forest-300);border-radius:2px;font:inherit;color:inherit}
#zip{width:8.5em}.row{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.seg{display:flex;gap:6px;flex-wrap:wrap}.seg button{padding:8px 12px;border:1px solid var(--forest-300);background:#fff;border-radius:2px;font:inherit;cursor:pointer;color:var(--forest-900)}
.seg button[aria-pressed="true"]{background:var(--forest);color:#fff;border-color:var(--forest)}.seg button[disabled]{opacity:.4;cursor:default}
.note{font-size:13px;color:#3a5246;min-height:1.2em}.price{background:var(--forest-100);padding:10px 12px;border-radius:2px}.price strong{font-size:20px}
.cta{display:inline-block;background:var(--amber);color:var(--forest-900);padding:11px 16px;border-radius:2px;border:0;font:inherit;font-weight:700;cursor:pointer}
.cta:hover{background:var(--amber-hover)}.cta[disabled]{opacity:.45;cursor:default}.small{font-size:12px;color:#3a5246}.hide{display:none!important}
.link{background:none;border:0;padding:0;color:var(--forest);text-decoration:underline;font:inherit;font-size:13px;cursor:pointer}.done{background:var(--forest-100);padding:12px;border-radius:2px}
</style></head><body>
<div class="card">
 <div class="head"><b id="biz">Scoop Dogg</b><a id="phone" href="#"></a></div>
 <div class="body" id="main">
  <div class="row"><div><label for="zip">Your ZIP code</label><input id="zip" inputmode="numeric" maxlength="5" placeholder="91360"></div><div class="note" id="zipnote"></div></div>
  <div id="step2" class="hide">
   <span class="lab">What do you need?</span><div class="seg" id="svc"><button data-s="weekly">Weekly pickup</button><button data-s="one-time">One-time cleanup</button></div>
  </div>
  <div id="weeklyopts" class="hide">
   <span class="lab">How many dogs?</span><div class="seg" id="dogs"></div>
   <span class="lab" style="margin-top:10px">When was the yard last cleaned?</span><div class="seg" id="last"></div>
  </div>
  <div id="onetimeopts" class="hide"><span class="lab">How much buildup?</span><div class="seg" id="tiers"></div></div>
  <div class="price hide" id="price"></div>
  <div id="daysrow" class="hide"><span class="lab">Pick a start day</span><div class="seg" id="days"></div></div>
  <form id="form" class="hide">
   <div class="grid"><div><label for="name">Name</label><input id="name" autocomplete="name" required></div><div><label for="tel">Phone</label><input id="tel" type="tel" autocomplete="tel" required></div></div>
   <div style="margin-top:8px"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required></div>
   <div style="margin-top:8px"><label for="addr">Service address</label><input id="addr" autocomplete="street-address" required></div>
   <div class="grid" style="margin-top:8px"><div><label for="gate">Gate code (optional)</label><input id="gate" maxlength="60"></div><div><label for="notes">Notes (optional)</label><input id="notes" maxlength="1000" placeholder="Dog names, side gate"></div></div>
   <div class="row" style="margin-top:10px"><button class="cta" id="send" type="submit">Book this day</button><span class="small">Nothing is charged here. Scoop Dogg confirms with you, then you pay on scoopdogg.net or on the day.</span></div>
   <div class="note" id="formnote"></div>
  </form>
  <div><button class="link" id="askbtn" type="button">Rather have Scoop Dogg contact you?</button></div>
  <form id="ask" class="hide">
   <div class="grid"><div><label for="aname">Name</label><input id="aname" required></div><div><label for="atel">Phone</label><input id="atel" type="tel" required></div></div>
   <div style="margin-top:8px"><label for="aemail">Email</label><input id="aemail" type="email" required></div>
   <div style="margin-top:8px"><label for="anotes">What do you need?</label><textarea id="anotes" rows="2" maxlength="1000"></textarea></div>
   <div class="row" style="margin-top:10px"><button class="cta" id="asend" type="submit">Send</button><span class="note" id="asknote"></span></div>
  </form>
  <span class="small" id="guarantee"></span>
 </div>
 <div class="body hide" id="sent"><div class="done" id="sentmsg"></div></div>
</div>
<script>
var pending={},nextId=1,data=null,st={zip:"",served:false,area:"",svc:"",dogs:0,last:"",tier:"",day:"",touched:false};
function $(id){return document.getElementById(id)}
function show(id,on){$(id).classList.toggle("hide",!on)}
function rpc(method,params){var id=nextId++;window.parent.postMessage({jsonrpc:"2.0",id:id,method:method,params:params},"*");
 return new Promise(function(res,rej){pending[id]={res:res,rej:rej};setTimeout(function(){if(pending[id]){delete pending[id];rej(new Error("timeout"))}},20000)})}
function notify(method,params){window.parent.postMessage({jsonrpc:"2.0",method:method,params:params},"*")}
function size(){notify("ui/notifications/size-changed",{height:document.body.scrollHeight})}
function call(name,args){return rpc("tools/call",{name:name,arguments:args}).then(function(r){if(r&&r.isError)throw new Error((r.content&&r.content[0]&&r.content[0].text)||"error");return r.structuredContent||{}})}
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function seg(id,items,cur,pick){var el=$(id);el.innerHTML="";items.forEach(function(it){var b=document.createElement("button");b.type="button";b.textContent=it.label;
 b.setAttribute("aria-pressed",String(it.key===cur));if(it.disabled)b.disabled=true;b.onclick=function(){st.touched=true;pick(it.key)};el.appendChild(b)})}
window.addEventListener("message",function(e){if(e.source!==window.parent)return;var m=e.data;if(!m||m.jsonrpc!=="2.0")return;
 if(m.id!==undefined&&pending[m.id]){var p=pending[m.id];delete pending[m.id];m.error?p.rej(m.error):p.res(m.result);return}
 if(m.method==="ui/notifications/tool-result")render(m.params&&m.params.structuredContent)});
function render(sc){if(!sc||!sc.weekly)return;data=sc;
 $("biz").textContent=sc.business;$("phone").textContent=sc.phone||"";$("phone").href="tel:"+String(sc.phone||"").replace(/[^\\d+]/g,"");
 $("guarantee").textContent=sc.guarantee?String(sc.guarantee).split(".")[0]+".":"";
 if(!st.touched&&sc.prefill){if(sc.prefill.dogs)st.dogs=sc.prefill.dogs;if(sc.prefill.service)st.svc=sc.prefill.service}
 if(sc.prefill&&sc.prefill.postal_code&&!st.zip){$("zip").value=sc.prefill.postal_code;onZip()}draw();size()}
function draw(){if(!data)return;show("step2",st.served);
 seg("svc",[{key:"weekly",label:"Weekly pickup"},{key:"one-time",label:"One-time cleanup"}],st.svc,function(k){st.svc=k;st.day="";draw();requote()});
 show("weeklyopts",st.served&&st.svc==="weekly");show("onetimeopts",st.served&&st.svc==="one-time");
 seg("dogs",data.weekly.map(function(w){return {key:w.dogs,label:w.dogs===4?"4+":String(w.dogs)}}),st.dogs,function(k){st.dogs=k;st.day="";draw();requote()});
 seg("last",data.last_cleaned,st.last,function(k){st.last=k;draw();requote()});
 seg("tiers",data.one_time.map(function(t){return {key:t.tier_id,label:t.label.split("(")[0].trim()+" · "+t.price}}),st.tier,function(k){st.tier=k;st.day="";draw();requote()});
 size()}
function onZip(){var z=$("zip").value.trim();st.touched=true;if(!/^\\d{5}$/.test(z)){$("zipnote").textContent="";return}
 st.zip=z;$("zipnote").textContent="Checking…";
 call("check_service_area",{postal_code:z}).then(function(sc){st.served=!!sc.served;st.area=sc.area||"";
  $("zipnote").textContent=sc.served?"✓ We come to "+sc.area:"Not on a route there yet — use the contact option below";
  if(!sc.served){show("price",false);show("daysrow",false);show("form",false)}draw();requote()})
 .catch(function(){$("zipnote").textContent="Could not check that just now — please call."})}
function choiceReady(){if(!st.served)return false;if(st.svc==="weekly")return st.dogs>0&&!!st.last;if(st.svc==="one-time"){var t=tierOf();return !!t&&!t.needs_quote}return false}
function tierOf(){return data.one_time.filter(function(t){return t.tier_id===st.tier})[0]}
function requote(){show("daysrow",false);show("form",false);
 if(st.svc==="one-time"&&tierOf()&&tierOf().needs_quote){show("price",true);$("price").innerHTML="That one needs a quick look first, so it has no online price. Use the contact option below and Scoop Dogg will quote it.";size();return}
 if(!choiceReady()){show("price",false);size();return}
 show("price",true);$("price").textContent="Pricing…";
 var args=st.svc==="weekly"?{postal_code:st.zip,dogs:st.dogs}:{postal_code:st.zip,tier_id:st.tier};
 call("get_price_and_start_days",args).then(function(q){
  var main=q.per_month?"<strong>"+esc(q.per_month)+"</strong>/month · weekly visits · no contract":"<strong>"+esc(q.first_charge)+"</strong> one-time cleanup";
  var off=q.discount&&q.discount!=="$0"?"<div>First month <b>"+esc(q.first_charge)+"</b> ("+esc(q.discount)+" off"+(q.offers&&q.offers.length?": "+esc(q.offers.join(", ")):"")+")</div>":"";
  var behind=st.svc==="weekly"&&(st.last==="month"||st.last==="longer")?"<div class='small'>A yard more than two weeks behind gets a catch-up first visit, added when Scoop Dogg confirms.</div>":"";
  $("price").innerHTML="<div>"+main+"</div>"+off+behind;
  var days=q.start_days||[];
  var items=days.map(function(d){return {key:d.date,label:d.label}});
  function pickDay(k){st.day=k;seg("days",items,st.day,pickDay);show("form",true);size()}
  seg("days",items,st.day,pickDay);
  show("daysrow",days.length>0);if(!days.length)$("price").innerHTML+="<div class='small'>No open days online right now — use the contact option below.</div>";size()})
 .catch(function(){$("price").textContent="Could not price that just now."})}
$("zip").addEventListener("input",onZip);
$("form").onsubmit=function(e){e.preventDefault();$("send").disabled=true;$("formnote").textContent="Booking…";
 var a={name:$("name").value,phone:$("tel").value,email:$("email").value,address:$("addr").value,postal_code:st.zip,start_date:st.day,gate_code:$("gate").value,notes:$("notes").value};
 if(st.svc==="weekly"){a.dogs=st.dogs;a.last_cleaned=st.last}else{a.tier_id=st.tier}
 call("book_start_day",a).then(function(sc){done("<b>Booked for "+esc(sc.start)+".</b> Nothing has been charged. Scoop Dogg will confirm with you, then you pay on scoopdogg.net or on the day.")})
 .catch(function(err){$("send").disabled=false;$("formnote").textContent=(err&&err.message)||"That did not go through — please call."})};
$("askbtn").onclick=function(){show("ask",true);size()};
$("ask").onsubmit=function(e){e.preventDefault();if(!/^\\d{5}$/.test(st.zip)){$("asknote").textContent="Enter your ZIP code first.";return}
 $("asend").disabled=true;$("asknote").textContent="Sending…";
 var a={name:$("aname").value,phone:$("atel").value,email:$("aemail").value,postal_code:st.zip,service:st.svc||"other",notes:$("anotes").value};if(st.svc==="weekly"&&st.dogs)a.dogs=st.dogs;
 call("submit_service_request",a).then(function(){done("<b>Sent.</b> "+esc(data.reply_promise||"Scoop Dogg will contact you.")+" Nothing has been booked or charged.")})
 .catch(function(err){$("asend").disabled=false;$("asknote").textContent=(err&&err.message)||"Could not send — please call."})};
function done(html){show("main",false);show("sent",true);$("sentmsg").innerHTML=html;size()}
rpc("ui/initialize",{protocolVersion:"2026-01-26",appInfo:{name:"scoop-dogg-booking",version:"1.0.0"},appCapabilities:{}}).then(function(){notify("ui/notifications/initialized",{})}).catch(function(){});
size();
</script></body></html>`;
