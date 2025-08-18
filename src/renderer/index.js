
/* EMIAS Lite renderer (sanitized) */
(function(){
  "use strict";

  var $ = function(sel){ return document.querySelector(sel); };
  var $$ = function(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var DEFAULT_USERS = [
    { login: "nms", displayName: "НМС", role: "NMS", pin: "1111" },
    { login: "nmp", displayName: "НМП", role: "NMP", pin: "2222" },
    { login: "priyomka", displayName: "Приёмка", role: "PRIYOMKA", pin: "3333" },
    { login: "admin", displayName: "Администратор", role: "ADMIN", pin: "0000" }
  ];

  function hasApi(){
    try{
      return !!(window.api && window.api.auth && window.api.auth.login);
    }catch(e){ return false; }
  }

  var CURRENT_USER = null;

  function fillUsersToSelect(sel, list){
    sel.innerHTML = "";
    for (var i=0;i<list.length;i++){
      var u = list[i];
      var opt = document.createElement("option");
      opt.value = u.login;
      opt.textContent = (u.displayName + " (" + u.login + ")");
      sel.appendChild(opt);
    }
  }

  function showWarn(msg){
    var bar = document.getElementById("warnBar");
    if (!bar){
      bar = document.createElement("div");
      bar.id = "warnBar";
      bar.style.display = "none";
      bar.style.background = "#5b3b00";
      bar.style.color = "#ffe6b3";
      bar.style.padding = "8px 12px";
      bar.style.borderBottom = "1px solid #8a5e00";
      document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.textContent = msg;
    bar.style.display = "";
  }

  function roleToUnit(role){
    if (role === "NMS") return "NMS";
    if (role === "NMP") return "NMP";
    if (role === "PRIYOMKA") return "PRIYOMKA";
    return "NMS";
  }

  function applyRole(role){
    var allowed = { "dashboard":true, "patients":true, "workbook":true };
    if (role === "NMS") allowed["nms"] = true;
    if (role === "NMP") allowed["nmp"] = true;
    if (role === "PRIYOMKA") allowed["priyomka"] = true;
    if (role === "ADMIN"){
      allowed["nms"] = true; allowed["nmp"] = true; allowed["priyomka"] = true;
    }
    $$(".tab-btn").forEach(function(btn){
      var tab = btn.getAttribute("data-tab");
      btn.style.display = allowed[tab] ? "" : "none";
    });
    $$(".tab").forEach(function(s){
      s.style.display = allowed[s.id] ? "" : "none";
    });
    var firstBtn = $$(".tab-btn").find(function(b){ return b.style.display !== "none"; });
    if (firstBtn) firstBtn.click();
  }

  $$(".tab-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      $$(".tab-btn").forEach(function(b){ b.classList.remove("active"); });
      btn.classList.add("active");
      var tab = btn.getAttribute("data-tab");
      $$(".tab").forEach(function(t){ t.classList.remove("active"); });
      var section = document.getElementById(tab);
      if (section) section.classList.add("active");
      if (tab === "dashboard") refreshDashboard();
      if (tab === "nms" || tab === "nmp" || tab === "priyomka") loadUnit(tab.toUpperCase());
      if (tab === "patients") loadPatients();
      if (tab === "workbook") loadExcelConfig();
    });
  });

  async function refreshDashboard(){
    var cards = $("#cards");
    if (!hasApi()){
      if (cards) cards.innerHTML = '<div class="card"><b>Локальный режим:</b> статистика недоступна без БД.</div>';
      return;
    }
    try{
      var stats = await window.api.stats.today();
      var html = "";
      var units = [["NMS","НМС"],["NMP","НМП"],["PRIYOMKA","Приёмка"]];
      for (var i=0;i<units.length;i++){
        var k = units[i][0], label = units[i][1];
        var s = stats[k] || { total:0, closed:0 };
        html += '<div class="card"><h3>'+label+'</h3><div>Всего: <b>'+s.total+'</b> <span class="badge">закрыто: '+s.closed+'</span></div></div>';
      }
      cards.innerHTML = html;
    }catch(e){
      cards.innerHTML = '<div class="card">Ошибка загрузки статистики</div>';
    }
  }

  async function loadUnit(unit){
    var panel = document.querySelector('.unit-panel[data-unit="'+unit+'"]');
    if (!panel) return;
    if (!hasApi()){
      panel.innerHTML = '<div class="card">Локальный режим: визиты недоступны без БД.</div>';
      return;
    }
    panel.innerHTML =
      '<div class="left">'+
        '<div class="toolbar">'+
          '<input id="u_'+unit+'_patientId" placeholder="ID пациента для приёма">'+
          '<button id="u_'+unit+'_add">Открыть приём</button>'+
        '</div>'+
        '<table class="visits">'+
          '<thead><tr><th>Пациент</th><th>Статус</th><th>Примечание</th><th></th></tr></thead>'+
          '<tbody></tbody>'+
        '</table>'+
      '</div>'+
      '<div class="right">'+
        '<div class="card">'+
          '<h3>Подсказка</h3>'+
          '<p>Скопируйте ID пациента из списка пациентов и откройте приём. После завершения — закройте визит.</p>'+
        '</div>'+
      '</div>';

    panel.querySelector('#u_'+unit+'_add').onclick = async function(){
      var patientId = panel.querySelector('#u_'+unit+'_patientId').value.trim();
      if (!patientId){ alert("Укажите ID пациента"); return; }
      try{ await window.api.visits.add({ patientId: patientId, unit: unit, notes: "" }); await renderVisits(); await refreshDashboard(); }
      catch(e){ alert(e.message || String(e)); }
    };

    async function renderVisits(){
      var rows = await window.api.visits.listToday({ unit: unit });
      var tbody = panel.querySelector("tbody"); tbody.innerHTML = "";
      rows.forEach(function(r){
        var fio = (r.lastName + " " + r.firstName + " " + (r.middleName||"")).trim();
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td>'+fio+'<div style="font-size:11px;color:#9fb3d1">'+r.patientId+'</div></td>'+
          '<td>'+r.status+'</td>'+
          '<td>'+(r.notes||"")+'</td>'+
          '<td>'+(r.status==="open"?'<button class="close-btn">Закрыть</button>':"")+'</td>';
        if (r.status === "open"){
          tr.querySelector(".close-btn").onclick = async function(){
            var notes = prompt("Примечание (необязательно):", r.notes||"");
            await window.api.visits.close({ visitId: r.id, notes: notes });
            await renderVisits(); await refreshDashboard();
          };
        }
        tbody.appendChild(tr);
      });
    }
    renderVisits();
  }

  var patientsPage = 1;
  async function loadPatients(){
    var tbody = $("#patientsTable tbody"); if (!tbody) return;
    if (!hasApi()){ tbody.innerHTML = ""; return; }
    var query = ($("#search") && $("#search").value) ? $("#search").value.trim() : "";
    var res = await window.api.patients.list({ query: query, page: patientsPage, pageSize: 100 });
    tbody.innerHTML = "";
    res.rows.forEach(function(p){
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>"+(p.lastName||"")+"</td>"+
        "<td>"+(p.firstName||"")+"</td>"+
        "<td>"+(p.middleName||"")+"</td>"+
        "<td>"+(p.birthDate||"")+"</td>"+
        "<td>"+(p.phone||"")+"</td>"+
        '<td><button class="edit">Ред.</button></td>';
      tr.querySelector(".edit").onclick = function(){ openPatientModal(p); };
      tbody.appendChild(tr);
    });
  }
  document.addEventListener("input", function(e){
    if (e.target && e.target.id === "search"){ patientsPage = 1; loadPatients(); }
  });
  document.addEventListener("click", function(e){
    if (e.target && e.target.id === "addPatient"){
      if (!hasApi()){ alert("Добавление пациента недоступно без БД."); return; }
      openPatientModal(null);
    }
  });

  function openPatientModal(p){
    $("#modal").classList.remove("hidden");
    $("#p_id").value = (p && p.id) || "";
    $("#p_lastName").value = (p && p.lastName) || "";
    $("#p_firstName").value = (p && p.firstName) || "";
    $("#p_middleName").value = (p && p.middleName) || "";
    $("#p_birthDate").value = (p && p.birthDate) || "";
    $("#p_sex").value = (p && p.sex) || "";
    $("#p_phone").value = (p && p.phone) || "";
    $("#p_insurance").value = (p && p.insurance) || "";
  }
  document.addEventListener("click", function(e){
    if (e.target && e.target.id === "closeModal") $("#modal").classList.add("hidden");
  });
  document.getElementById("patientForm").onsubmit = async function(e){
    e.preventDefault();
    if (!hasApi()){ alert("Сохранение пациента недоступно без БД."); return; }
    var payload = {
      id: $("#p_id").value || undefined,
      lastName: $("#p_lastName").value.trim(),
      firstName: $("#p_firstName").value.trim(),
      middleName: ($("#p_middleName").value || "").trim() || null,
      birthDate: $("#p_birthDate").value || null,
      sex: $("#p_sex").value || null,
      phone: $("#p_phone").value || null,
      insurance: $("#p_insurance").value || null
    };
    try{
      if (payload.id) await window.api.patients.update(payload);
      else await window.api.patients.create(payload);
      $("#modal").classList.add("hidden");
      await loadPatients();
    }catch(err){ alert(err.message || String(err)); }
  };

  async function loadExcelConfig(){
    var el = $("#excelConfig"); if (!el) return;
    if (!hasApi()){ el.innerHTML = '<div class="card">Локальный режим: Excel недоступен без БД.</div>'; return; }
    var cfg = await window.api.excel.getConfig();
    if (!cfg || !cfg.filePath){
      el.innerHTML = '<div class="card">Файл не выбран</div>';
    } else {
      var mapping = {};
      try{ mapping = cfg.mappingJson ? JSON.parse(cfg.mappingJson) : {}; }catch(_){}
      var pairs = [];
      for (var k in mapping){ if (Object.prototype.hasOwnProperty.call(mapping,k)) pairs.push(k+" -> "+mapping[k]); }
      el.innerHTML =
        '<div class="card">'+
          '<div><b>Файл:</b> ' + cfg.filePath + '</div>'+
          '<div><b>Лист:</b> ' + (cfg.sheetName||"") + '</div>'+
          '<div><b>Колонки:</b> ' + (pairs.length ? pairs.join(", ") : "(определяются автоматически)") + '</div>'+
          '<div style="font-size:12px;color:#9fb3d1">Обновлено: ' + (cfg.updatedAt||"") + '</div>'+
        '</div>';
    }
  }

  async function bootAuth(){
    var sel = $("#loginSelect");
    sel.innerHTML = "";
    if (hasApi()){
      try{
        var users = await window.api.auth.listUsers();
        if (users && users.length) fillUsersToSelect(sel, users);
        else fillUsersToSelect(sel, DEFAULT_USERS);
      }catch(e){
        showWarn("Не удалось получить пользователей из БД: " + (e && e.message ? e.message : String(e)));
        fillUsersToSelect(sel, DEFAULT_USERS);
      }
    } else {
      showWarn("Локальный режим: preload/БД не активны, вход без сохранения данных.");
      fillUsersToSelect(sel, DEFAULT_USERS);
    }
    $("#authEnter").onclick = onLoginClick;
  }

  async function onLoginClick(){
    var sel = $("#loginSelect");
    var typed = ($("#loginInput") && $("#loginInput").value) ? $("#loginInput").value.trim() : "";
    var login = (sel && sel.options.length > 0) ? sel.value : typed;
    var pin = ($("#pinInput") && $("#pinInput").value) ? $("#pinInput").value : "";
    if (!login){ $("#authError").textContent = "Введите логин (nms/nmp/priyomka/admin)"; return; }

    try{
      var user;
      if (hasApi()){
        user = await window.api.auth.login({ login: login, pin: pin });
      } else {
        var found = DEFAULT_USERS.find(function(u){ return u.login.toLowerCase() === String(login).toLowerCase() && u.pin === pin; });
        if (!found) throw new Error("Неверный логин или PIN (локальный режим).");
        user = { login: found.login, displayName: found.displayName, role: found.role };
      }
      CURRENT_USER = user;
      $("#userBadge").textContent = (user.displayName + " • " + user.role);
      applyRole(user.role);
      $("#authOverlay").style.display = "none";
      refreshDashboard();
      loadUnit(roleToUnit(user.role));
      loadPatients();
      loadExcelConfig();
    }catch(e){
      $("#authError").textContent = (e && e.message) ? e.message : "Ошибка входа";
      setTimeout(function(){ $("#authError").textContent = ""; }, 3000);
    }
  }

  // Start
  bootAuth();

})();
