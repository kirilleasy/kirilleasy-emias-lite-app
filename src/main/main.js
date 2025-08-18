const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const XLSX = require("xlsx");
const { v4: uuidv4 } = require("uuid");

const appDataDir = path.join(process.resourcesPath || process.cwd(), "data");
if (!fs.existsSync(appDataDir)) fs.mkdirSync(appDataDir, { recursive: true });
const dbPath = path.join(appDataDir, "app.db");

const db = new Database(dbPath);
db.pragma("journal_mode = wal");

function initSchema() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS patients(
    id TEXT PRIMARY KEY,
    lastName TEXT NOT NULL,
    firstName TEXT NOT NULL,
    middleName TEXT,
    birthDate TEXT,
    sex TEXT,
    phone TEXT,
    insurance TEXT,
    externalId TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS visits(
    id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    unit TEXT NOT NULL CHECK(unit IN ('NMS','NMP','PRIYOMKA')),
    date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    notes TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY(patientId) REFERENCES patients(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_visits_date_unit ON visits(date, unit);
  CREATE TABLE IF NOT EXISTS users(
    id TEXT PRIMARY KEY,
    login TEXT UNIQUE,
    displayName TEXT,
    role TEXT NOT NULL CHECK(role IN ('NMS','NMP','PRIYOMKA','ADMIN')),
    pin TEXT
  );
  CREATE TABLE IF NOT EXISTS excel_config(
    id INTEGER PRIMARY KEY CHECK(id=1),
    filePath TEXT,
    sheetName TEXT,
    mappingJson TEXT,
    updatedAt TEXT
  );
  `);
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name.toLowerCase());
  if (!cols.includes("pin")) db.prepare("ALTER TABLE users ADD COLUMN pin TEXT").run();
}
initSchema();

function nowIso(){ return new Date().toISOString(); }

// AUTH
function seedUsers(){
  const c = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
  if (c === 0){
    const ins = db.prepare("INSERT INTO users(id,login,displayName,role,pin) VALUES (?,?,?,?,?)");
    ins.run(uuidv4(),"nms","НМС","NMS","1111");
    ins.run(uuidv4(),"nmp","НМП","NMP","2222");
    ins.run(uuidv4(),"priyomka","Приёмка","PRIYOMKA","3333");
    ins.run(uuidv4(),"admin","Администратор","ADMIN","0000");
  }
}
seedUsers(); // создаём пользователей при старте

ipcMain.handle("auth:listUsers", () => db.prepare("SELECT login, displayName, role FROM users ORDER BY role, login").all());
ipcMain.handle("auth:login", (e,{login,pin})=>{
  const row = db.prepare("SELECT id, login, displayName, role FROM users WHERE lower(login)=lower(?) AND pin=?").get(login,pin);
  if(!row) throw new Error("Неверный логин или PIN");
  return row;
});

// Patients
const stmtPatientInsert = db.prepare(`INSERT INTO patients
(id,lastName,firstName,middleName,birthDate,sex,phone,insurance,externalId,createdAt,updatedAt)
VALUES (@id,@lastName,@firstName,@middleName,@birthDate,@sex,@phone,@insurance,@externalId,@createdAt,@updatedAt)`);
const stmtPatientUpdate = db.prepare(`UPDATE patients SET
lastName=@lastName, firstName=@firstName, middleName=@middleName, birthDate=@birthDate,
sex=@sex, phone=@phone, insurance=@insurance, externalId=@externalId, updatedAt=@updatedAt
WHERE id=@id`);

ipcMain.handle("patients:list",(e,{query="",page=1,pageSize=50}={})=>{
  const offset=(page-1)*pageSize; const q=`%${query.trim()}%`;
  const rows=db.prepare(`
    SELECT * FROM patients
    WHERE lastName LIKE ? OR firstName LIKE ? OR middleName LIKE ? OR phone LIKE ?
    ORDER BY updatedAt DESC LIMIT ? OFFSET ?`).all(q,q,q,q,pageSize,offset);
  const total=db.prepare(`
    SELECT COUNT(*) as c FROM patients
    WHERE lastName LIKE ? OR firstName LIKE ? OR middleName LIKE ? OR phone LIKE ?`).get(q,q,q,q).c;
  return { rows,total,page,pageSize };
});
ipcMain.handle("patients:create",(e,patient)=>{
  const id=uuidv4(); const ts=nowIso();
  const row={ id,
    lastName: patient.lastName?.trim()||"",
    firstName: patient.firstName?.trim()||"",
    middleName: patient.middleName?.trim()||null,
    birthDate: patient.birthDate||null,
    sex: patient.sex||null, phone: patient.phone||null,
    insurance: patient.insurance||null, externalId: patient.externalId||null,
    createdAt: ts, updatedAt: ts };
  stmtPatientInsert.run(row); return row;
});
ipcMain.handle("patients:update",(e,patient)=>{
  if(!patient?.id) throw new Error("id required");
  const ts=nowIso(); stmtPatientUpdate.run({ ...patient, updatedAt: ts });
  return db.prepare("SELECT * FROM patients WHERE id=?").get(patient.id);
});

// Visits
ipcMain.handle("visits:add",(e,{patientId,unit,notes})=>{
  const id=uuidv4(); const ts=nowIso(); const date=new Date().toISOString().slice(0,10);
  db.prepare(`INSERT INTO visits(id,patientId,unit,date,status,notes,createdAt,updatedAt)
    VALUES(?,?,?,?,?,?,?,?)`).run(id,patientId,unit,date,"open",notes||null,ts,ts);
  return db.prepare("SELECT * FROM visits WHERE id=?").get(id);
});
ipcMain.handle("visits:listToday",(e,{unit})=>{
  const date=new Date().toISOString().slice(0,10);
  return db.prepare(`SELECT v.*, p.lastName, p.firstName, p.middleName
    FROM visits v JOIN patients p ON p.id=v.patientId
    WHERE v.date=? AND v.unit=? ORDER BY v.createdAt DESC`).all(date,unit);
});
ipcMain.handle("visits:close",(e,{visitId,notes})=>{
  const ts=nowIso();
  db.prepare("UPDATE visits SET status='closed', notes=COALESCE(?,notes), updatedAt=? WHERE id=?")
    .run(notes||null,ts,visitId);
  return db.prepare("SELECT * FROM visits WHERE id=?").get(visitId);
});

// Stats
ipcMain.handle("stats:today",()=>{
  const date=new Date().toISOString().slice(0,10);
  const rows=db.prepare(`
    SELECT unit, COUNT(*) as total,
           SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) as closed
    FROM visits WHERE date=? GROUP BY unit`).all(date);
  const map={ NMS:{total:0,closed:0}, NMP:{total:0,closed:0}, PRIYOMKA:{total:0,closed:0} };
  rows.forEach(r=>{ map[r.unit]={total:r.total,closed:r.closed}; });
  return map;
});

// Excel
function detectHeaderMap(headers){
  const norm = s => String(s||"").trim().toLowerCase();
  const variants = {
    lastName: ["фамилия","last name","surname","last"],
    firstName: ["имя","first name","first"],
    middleName: ["отчество","middle name","middle","patronymic"],
    birthDate: ["дата рождения","др","birthdate","date of birth","dob"],
    sex: ["пол","sex","gender"],
    phone: ["телефон","phone","tel","mobile","моб"],
    insurance: ["полис","страховка","insurance","oms","snils"]
  };
  const map={}; headers.forEach(h=>{
    const hN=norm(h);
    for(const key of Object.keys(variants)){
      if(variants[key].some(v=>hN.includes(v))) map[key]=h;
    }
  }); return map;
}
function readExcel(pathFile,sheetName){
  const wb=XLSX.readFile(pathFile);
  const ws=wb.Sheets[sheetName||wb.SheetNames[0]];
  const json=XLSX.utils.sheet_to_json(ws,{defval:null});
  const headers=XLSX.utils.sheet_to_json(ws,{header:1})[0]||[];
  return { json, headers, sheetName: sheetName||wb.SheetNames[0] };
}
function writeExcel(pathFile,sheetName,rows){
  let wb=fs.existsSync(pathFile)?XLSX.readFile(pathFile):XLSX.utils.book_new();
  const wsData=[["id","lastName","firstName","middleName","birthDate","sex","phone","insurance"]];
  rows.forEach(r=>wsData.push([r.id,r.lastName,r.firstName,r.middleName||"",r.birthDate||"",r.sex||"",r.phone||"",r.insurance||""]));
  const ws=XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb,ws,sheetName||"Patients");
  XLSX.writeFile(wb,pathFile);
}
ipcMain.handle("excel:selectWorkbook", async ()=>{
  const res = await dialog.showOpenDialog({ title:"Выберите Excel-файл", filters:[{name:"Excel",extensions:["xlsx","xlsm","xls"]}], properties:["openFile"] });
  if(res.canceled||!res.filePaths[0]) return null;
  const filePath=res.filePaths[0];
  const { headers, sheetName } = readExcel(filePath);
  const mapping = detectHeaderMap(headers);
  const ts=nowIso();
  db.prepare(`INSERT INTO excel_config(id,filePath,sheetName,mappingJson,updatedAt) VALUES(1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET filePath=excluded.filePath,sheetName=excluded.sheetName,mappingJson=excluded.mappingJson,updatedAt=excluded.updatedAt`
  ).run(filePath,sheetName,JSON.stringify(mapping),ts);
  return { filePath,sheetName,mapping };
});
ipcMain.handle("excel:getConfig",()=>db.prepare("SELECT * FROM excel_config WHERE id=1").get());
ipcMain.handle("excel:sync",(e,{direction})=>{
  const cfg=db.prepare("SELECT * FROM excel_config WHERE id=1").get();
  if(!cfg?.filePath) throw new Error("Excel не настроен");
  const mapping = cfg.mappingJson ? JSON.parse(cfg.mappingJson) : {};
  const report={ imported:0, updated:0, exported:0, sheet: cfg.sheetName };

  if(direction==="import"||direction==="both"){
    const { json, headers, sheetName } = readExcel(cfg.filePath, cfg.sheetName);
    const map = Object.keys(mapping).length ? mapping : detectHeaderMap(headers);
    const byId = db.prepare("SELECT * FROM patients WHERE id=?");
    const upsert = db.prepare(`INSERT INTO patients(id,lastName,firstName,middleName,birthDate,sex,phone,insurance,externalId,createdAt,updatedAt)
      VALUES(@id,@lastName,@firstName,@middleName,@birthDate,@sex,@phone,@insurance,@externalId,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET lastName=excluded.lastName,firstName=excluded.firstName,middleName=excluded.middleName,
      birthDate=excluded.birthDate,sex=excluded.sex,phone=excluded.phone,insurance=excluded.insurance,updatedAt=excluded.updatedAt`);
    const trx=db.transaction(rows=>{
      rows.forEach(r=>{
        const id = r.id || r.ID || uuidv4();
        const row = {
          id,
          lastName: r[map.lastName] ?? r.lastName ?? r["Фамилия"] ?? "",
          firstName: r[map.firstName] ?? r.firstName ?? r["Имя"] ?? "",
          middleName: r[map.middleName] ?? r.middleName ?? r["Отчество"] ?? null,
          birthDate: r[map.birthDate] ?? r.birthDate ?? r["Дата рождения"] ?? null,
          sex: r[map.sex] ?? r.sex ?? r["Пол"] ?? null,
          phone: r[map.phone] ?? r.phone ?? r["Телефон"] ?? null,
          insurance: r[map.insurance] ?? r.insurance ?? r["Полис"] ?? null,
          externalId: r.externalId || r["externalId"] || null,
          createdAt: nowIso(), updatedAt: nowIso()
        };
        const exists=byId.get(id); upsert.run(row);
        if(exists) report.updated++; else report.imported++;
      });
    }); trx(json);
    report.sheet=sheetName;
  }

  if(direction==="export"||direction==="both"){
    const rows=db.prepare("SELECT * FROM patients ORDER BY updatedAt DESC").all();
    writeExcel(cfg.filePath, cfg.sheetName || "Patients", rows);
    report.exported=rows.length;
  }
  db.prepare("UPDATE excel_config SET updatedAt=? WHERE id=1").run(nowIso());
  return report;
});

let mainWindow;
function createWindow(){
  mainWindow = new BrowserWindow({
    width:1200,height:800,
    webPreferences:{ contextIsolation:true, preload: path.join(__dirname,"preload.js") },
    title:"EMIAS Lite"
  });
  mainWindow.loadFile(path.join(__dirname,"../renderer/index.html"));
}
app.whenReady().then(()=>{ createWindow(); app.on("activate",()=>{ if(BrowserWindow.getAllWindows().length===0) createWindow(); }); });
app.on("window-all-closed",()=>{ if(process.platform!=="darwin") app.quit(); });
