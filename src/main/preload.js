const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("api",{
  auth:{ listUsers:()=>ipcRenderer.invoke("auth:listUsers"), login:(p)=>ipcRenderer.invoke("auth:login",p) },
  patients:{ list:(o)=>ipcRenderer.invoke("patients:list",o||{}), create:(p)=>ipcRenderer.invoke("patients:create",p), update:(p)=>ipcRenderer.invoke("patients:update",p) },
  visits:{ add:(p)=>ipcRenderer.invoke("visits:add",p), listToday:(p)=>ipcRenderer.invoke("visits:listToday",p), close:(p)=>ipcRenderer.invoke("visits:close",p) },
  stats:{ today:()=>ipcRenderer.invoke("stats:today") },
  excel:{ selectWorkbook:()=>ipcRenderer.invoke("excel:selectWorkbook"), getConfig:()=>ipcRenderer.invoke("excel:getConfig"), sync:(p)=>ipcRenderer.invoke("excel:sync",p) }
});
