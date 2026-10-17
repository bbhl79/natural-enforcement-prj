/* 管理台 HTML 样板 v0.3 · 应用壳（P1）共用脚本
   菜单裁剪：每个菜单项在 data-requires 上写所需的许可（设计假设：会话查询返回本人允许的许可清单，#79 第 3 问选项 B，待定）。
   菜单可见不等于有权操作，服务端每次校验（#79、#91 用户故事 54）。许可原文只放在 data- 属性和注释里，不进用户可见文本。 */
var NE = (function(){
  var MENU = [
    {sec:'业务办理'},
    {id:'home', label:'工作台', href:'P1-shell.html', any:['*business']},
    {id:'clue', label:'线索', href:'#', any:['clue.read']},
    {id:'case', label:'案件', href:'#', any:['case.read']},
    {sec:'管理台'},
    {id:'admin', label:'管理台首页', href:'P3-admin-home.html', any:['org.tree.read','personnel.read','personnel.locked.read','audit.admin.read']},
    {id:'org', label:'机构', href:'P4-org-tree.html', any:['org.tree.read']},
    {id:'person', label:'人员', href:'P5-personnel-list.html', any:['personnel.read']},
    {id:'locked', label:'被锁人员', href:'P7-locked-personnel.html', any:['personnel.locked.read']},
    {id:'audit', label:'管理台留痕', href:'P8-admin-audit.html', any:['audit.admin.read']}
  ];
  var BIZ = ['clue.read','case.read'];
  var ADMIN_ALL = ['org.tree.read','org.unit.register','org.unit.rename','org.unit.deactivate','personnel.read','personnel.register','personnel.update','personnel.deactivate','personnel.restore','personnel.sessions.end','personnel.cert.update','personnel.locked.read','personnel.locked.release','personnel.password.reset','audit.admin.read','audit.admin.export'];
  var SESSIONS = {
    cityAdmin:{name:'周敏', code:'SJ0001', org:'广州市规划和自然资源局', roles:['系统管理'], perms:ADMIN_ALL},
    distAdmin:{name:'何静', code:'TH0102', org:'天河区分局', roles:['经办','系统管理'], perms:BIZ.concat(ADMIN_ALL)},
    handler:{name:'陈晓宁', code:'TH0315', org:'天河区分局石牌自然资源所', roles:['经办'], perms:BIZ},
    clerk:{name:'黄志远', code:'TH0201', org:'天河区分局', roles:['内勤'], perms:BIZ},
    supervisor:{name:'林清', code:'SJ0108', org:'广州市规划和自然资源局', roles:['监督'], perms:['case.read','audit.admin.read','audit.admin.export']},
    distSupervisor:{name:'郑岚', code:'HZ0109', org:'海珠区分局', roles:['监督'], perms:['case.read','audit.admin.read','audit.admin.export']}
  };
  function has(s,p){ return p==='*business' ? s.perms.some(function(x){return BIZ.indexOf(x)>=0;}) : s.perms.indexOf(p)>=0; }
  function can(s,p){ return s && s.perms.indexOf(p)>=0; }
  function state(states){ var q=new URLSearchParams(location.search).get('state'); return states[q]?q:Object.keys(states)[0]; }
  function demoBar(states,cur){
    var h='<div class="demo-bar" data-proto="state-switch"><b>样板状态（仅演示，不进正式界面）：</b>';
    Object.keys(states).forEach(function(k){ h+='<a href="?state='+k+'" class="'+(k===cur?'on':'')+'">'+states[k].label+'</a>'; });
    return h+'</div>';
  }
  var LOGO='<div class="logo"><svg width="18" height="18" viewBox="0 0 32 32"><path fill="#fff" d="M16 3 27 8v8.2c0 6.4-4.2 10.6-11 13.3C9.2 26.8 5 22.6 5 16.2V8L16 3z"/><path d="M11.2 16.1 14.3 19.2 20.9 12.6" stroke="#1f6b56" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
  function topbar(s){
    var u = s ? '<div class="user-chip"><div class="avatar">'+s.name[0]+'</div><div class="user-meta">'+s.name+'<br><span>'+s.org+' · '+s.roles.join('、')+'</span></div></div><button class="link-btn">退出</button>' : '';
    return '<header class="topbar"><div class="brand">'+LOGO+'<div><div class="brand-text">广州市规划和自然资源局监督监管与执法协同系统</div><div class="brand-sub">自然资源行政执法</div></div></div><div class="top-actions">'+u+'</div></header>';
  }
  function nav(s,active,loading){
    var h='<nav class="sidenav">';
    if(loading){ return h+'<div class="skel" style="width:70%"></div><div class="skel"></div><div class="skel" style="width:80%"></div><div class="skel" style="width:60%"></div></nav>'; }
    var pending=null;
    MENU.forEach(function(m){
      if(m.sec){ pending=m.sec; return; }
      if(!m.any.some(function(p){return has(s,p);})) return;
      if(pending){ h+='<div class="nav-section">'+pending+'</div>'; pending=null; }
      h+='<a class="nav-item'+(m.id===active?' active':'')+'" href="'+m.href+'" data-menu="'+m.id+'" data-requires="'+m.any.join(' ')+'"><span class="dot"></span>'+m.label+'</a>';
    });
    return h+'</nav>';
  }
  /* opts: {states, active, render(stateKey) -> {session, html, loading, bare}} */
  function mount(opts){
    var k=state(opts.states), st=opts.states[k], r=opts.render(k,st);
    var s=r.session===undefined?SESSIONS.cityAdmin:r.session;
    document.title=opts.title+' · '+st.label+' · 管理台样板 v0.3';
    document.body.setAttribute('data-state',k);
    var body = r.bare ? r.html : '<div class="shell">'+nav(s,opts.active,r.loading)+'<main class="main">'+r.html+'</main></div>';
    document.body.innerHTML = demoBar(opts.states,k) + topbar(r.loading?null:s) + body + (r.overlay||'');
  }
  function skelRows(n){ var h=''; for(var i=0;i<n;i++) h+='<div class="skel" style="width:'+(60+((i*13)%40))+'%"></div>'; return '<div class="card">'+h+'</div>'; }
  function errorCard(what){ return '<div class="card"><div class="empty"><div class="t">'+what+'没有加载出来</div><div>网络或服务暂时不可用，请稍后重试。问题持续时请联系本单位的系统管理人员。</div><div style="margin-top:14px"><button class="btn btn-primary">重新加载</button></div></div></div>'; }
  function deniedCard(what){ return '<div class="card"><div class="empty"><div class="t">你没有查看'+what+'的权限</div><div>如工作需要，请联系本单位的系统管理人员调整角色。</div><div style="margin-top:14px"><a class="btn" href="P1-shell.html">回到工作台</a></div></div></div>'; }
  function dialog(title,body,foot){ return '<div class="mask"><div class="dialog"><h3>'+title+'</h3>'+body+'<div class="foot">'+foot+'</div></div></div>'; }
  return {SESSIONS:SESSIONS, mount:mount, can:can, skelRows:skelRows, errorCard:errorCard, deniedCard:deniedCard, dialog:dialog};
})();
